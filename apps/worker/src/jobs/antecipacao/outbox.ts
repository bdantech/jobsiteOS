import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  formatarMoeda,
  renderizarTemplate,
} from '../../../../../packages/core/src/antecipacao/economia.js'
import {
  ESTAGIOS_ABERTOS,
  FAIXAS,
  type Canal,
  type Faixa,
} from '../../../../../packages/core/src/antecipacao/schemas.js'
import type { Tables, TablesInsert } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerConfigDisparo } from '../../antecipacao/config.js'

/**
 * Geração da outbox em MODO SOMBRA (§6). Roda depois de cada reclassificação.
 *
 * NADA É ENVIADO NESTE PROMPT. O job produz exatamente o que SERIA enviado, na
 * `mensagens_outbox` com status `pendente_envio`, para que a régua possa ser
 * validada por um humano antes de qualquer canal existir. É de propósito que a
 * fila seja o entregável: ligar canais primeiro e conferir depois é como se
 * queima uma base de contatos.
 *
 * O agrupamento é por FORNECEDOR, nunca por nota: ninguém recebe um toque por
 * nota fiscal, recebe um toque pelo conjunto de notas vivas.
 *
 * Três portas, nesta ordem, e cada uma existe por um motivo diferente:
 *   supressão → é um pedido explícito de não ser abordado (ou LGPD);
 *   cooldown  → protege a relação, e conta TOQUE MANUAL do vendedor também, para
 *               que a régua não atropele quem acabou de falar com a pessoa;
 *   contato   → sem canal válido não há mensagem; o descarte com motivo
 *               `sem_contato` é insumo direto para um lote do Radar.
 */

export interface ResultadoOutbox {
  faixas_ativas: string[]
  fornecedores_avaliados: number
  geradas: number
  descartadas_sem_contato: number
  pulados_supressao: number
  pulados_cooldown: number
}

interface ContatoEscolhido {
  id: string | null
  valor: string
  ponto_focal: boolean
}

export async function gerarOutbox(): Promise<ResultadoOutbox> {
  const cfg = await lerConfigDisparo()

  const { data: disparos } = await supabaseAdmin.from('faixa_disparos').select('*')
  const ativos = (disparos ?? []).filter((d) => d.email_habilitado || d.whatsapp_habilitado)

  const acc: ResultadoOutbox = {
    faixas_ativas: ativos.map((d) => d.faixa),
    fornecedores_avaliados: 0,
    geradas: 0,
    descartadas_sem_contato: 0,
    pulados_supressao: 0,
    pulados_cooldown: 0,
  }

  if (ativos.length === 0) {
    logger.info('Nenhuma faixa com canal habilitado — outbox não tem o que gerar.')
    return acc
  }

  // Round-robin por conta de WhatsApp, contínuo dentro da execução: distribuir o
  // volume entre os números é o que evita queimar um só quando os envios ligarem.
  let rr = 0

  for (const faixa of FAIXAS) {
    const disparo = ativos.find((d) => d.faixa === faixa)
    if (!disparo) continue

    const fornecedores = await fornecedoresElegiveis(faixa)
    acc.fornecedores_avaliados += fornecedores.length

    for (const f of fornecedores) {
      if (f.fornecedor_suprimido) {
        acc.pulados_supressao++
        continue
      }

      const cooldownDias = disparo.cooldown_dias ?? cfg.cooldown_dias_padrao
      if (await emCooldown(f.fornecedor_cnpj, cooldownDias, cfg.considerar_toque_manual)) {
        acc.pulados_cooldown++
        continue
      }

      const notas = await notasDoFornecedor(f.fornecedor_cnpj, faixa)
      if (notas.length === 0) continue

      const vars = {
        fornecedor_nome: f.fornecedor_nome ?? f.fornecedor_cnpj,
        qtd_notas: String(notas.length),
        valor_total: formatarMoeda(notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)),
        sacado_principal: sacadoPrincipal(notas),
        receita_estimada_fornecedor: formatarMoeda(
          notas.reduce((s, n) => s + Number(n.receita_esperada ?? 0), 0),
        ),
      }
      const valorTotal = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
      const accessKeys = notas.map((n) => n.access_key)

      for (const canal of canaisHabilitados(disparo)) {
        const contato = await escolherContato(f.fornecedor_empresa_id, canal)

        if (!contato) {
          await registrar({
            canal,
            faixa,
            fornecedor: f,
            accessKeys,
            valorTotal,
            destinatario: null,
            contatoId: null,
            pontoFocal: false,
            whatsappContaId: null,
            assunto: null,
            corpo: null,
            status: 'descartada',
            motivoDescarte: 'sem_contato',
          })
          acc.descartadas_sem_contato++
          continue
        }

        const contas = disparo.whatsapp_contas ?? []
        const whatsappContaId =
          canal === 'whatsapp' && contas.length > 0 ? (contas[rr++ % contas.length] ?? null) : null

        const template =
          canal === 'email' ? (disparo.template_email ?? '') : (disparo.template_whatsapp ?? '')

        await registrar({
          canal,
          faixa,
          fornecedor: f,
          accessKeys,
          valorTotal,
          destinatario: contato.valor,
          contatoId: contato.id,
          pontoFocal: contato.ponto_focal,
          whatsappContaId,
          assunto: canal === 'email' ? renderizarTemplate(disparo.assunto_email ?? '', vars) : null,
          corpo: renderizarTemplate(template, vars),
          status: 'pendente_envio',
          motivoDescarte: null,
        })
        acc.geradas++
      }
    }
  }

  logger.info(acc, 'Geração da outbox (modo sombra) concluída.')
  return acc
}

function canaisHabilitados(d: Tables<'faixa_disparos'>): Canal[] {
  const canais: Canal[] = []
  if (d.email_habilitado) canais.push('email')
  if (d.whatsapp_habilitado) canais.push('whatsapp')
  return canais
}

type FornecedorElegivel = {
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  fornecedor_empresa_id: string | null
  fornecedor_suprimido: boolean | null
}

async function fornecedoresElegiveis(faixa: Faixa): Promise<FornecedorElegivel[]> {
  const { data, error } = await supabaseAdmin
    .from('antecipacao_fornecedores')
    .select('fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_suprimido')
    .eq('melhor_faixa', faixa)
    .order('receita_esperada_total', { ascending: false, nullsFirst: false })
    .limit(2000)
  if (error) {
    logger.error({ faixa, erro: error.message }, 'Falha ao listar fornecedores elegíveis.')
    return []
  }
  return (data ?? []).filter(
    (f): f is FornecedorElegivel => typeof f.fornecedor_cnpj === 'string',
  )
}

async function notasDoFornecedor(cnpj: string, faixa: Faixa) {
  const { data } = await supabaseAdmin
    .from('notas_funil')
    .select('access_key, valor, receita_esperada, sacado_nome, sacado_cnpj')
    .eq('fornecedor_cnpj', cnpj)
    .eq('faixa', faixa)
    .in('estagio_funil', [...ESTAGIOS_ABERTOS])
    .limit(200)
  return (data ?? []).filter((n): n is typeof n & { access_key: string } => Boolean(n.access_key))
}

/** O sacado com o maior valor agregado — é dele que a mensagem fala. */
function sacadoPrincipal(notas: { valor: number | null; sacado_nome: string | null; sacado_cnpj: string | null }[]): string {
  const porSacado = new Map<string, number>()
  for (const n of notas) {
    const chave = n.sacado_nome ?? n.sacado_cnpj ?? '—'
    porSacado.set(chave, (porSacado.get(chave) ?? 0) + Number(n.valor ?? 0))
  }
  const melhor = [...porSacado.entries()].sort((a, b) => b[1] - a[1])[0]
  return melhor?.[0] ?? '—'
}

/**
 * Cooldown por FORNECEDOR: a última mensagem na outbox e — quando a config manda
 * — o último `toque.manual` registrado pelo app do vendedor.
 */
async function emCooldown(
  cnpj: string,
  dias: number,
  considerarToqueManual: boolean,
): Promise<boolean> {
  if (dias <= 0) return false
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()

  const { data: msg } = await supabaseAdmin
    .from('mensagens_outbox')
    .select('id')
    .eq('fornecedor_cnpj', cnpj)
    .in('status', ['pendente_envio', 'aprovada', 'enviada'])
    .gte('criada_em', desde)
    .limit(1)
    .maybeSingle()
  if (msg) return true

  if (!considerarToqueManual) return false

  const { data: toque } = await supabaseAdmin
    .from('empresa_eventos')
    .select('id')
    .eq('tipo', EVENTO_TIPOS.TOQUE_MANUAL)
    .eq('payload->>cnpj', cnpj)
    .gte('criado_em', desde)
    .limit(1)
    .maybeSingle()
  return toque !== null
}

/**
 * A hierarquia do §3.2, e ela vale em todo lugar: PONTO FOCAL primeiro; senão, o
 * melhor contato com canal válido. Um destinatário suprimido individualmente
 * (e-mail/telefone na lista) é pulado mesmo que a empresa não esteja suprimida.
 */
async function escolherContato(
  empresaId: string | null,
  canal: Canal,
): Promise<ContatoEscolhido | null> {
  if (!empresaId) return null

  const { data: contatos } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, email, telefone, whatsapp, ponto_focal, senioridade')
    .eq('empresa_id', empresaId)
    .order('ponto_focal', { ascending: false })
  if (!contatos?.length) return null

  const hoje = new Date().toISOString().slice(0, 10)
  const { data: suprimidos } = await supabaseAdmin
    .from('supressao')
    .select('escopo, valor')
    .in('escopo', canal === 'email' ? ['email'] : ['whatsapp', 'telefone'])
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
  const bloqueados = new Set((suprimidos ?? []).map((s) => s.valor))

  for (const c of contatos) {
    const bruto = canal === 'email' ? c.email : (c.whatsapp ?? c.telefone)
    if (!bruto) continue
    const normalizado = canal === 'email' ? bruto.trim().toLowerCase() : bruto.replace(/\D/g, '')
    if (normalizado === '' || bloqueados.has(normalizado)) continue
    return { id: c.id, valor: normalizado, ponto_focal: c.ponto_focal ?? false }
  }
  return null
}

async function registrar(args: {
  canal: Canal
  faixa: Faixa
  fornecedor: FornecedorElegivel
  accessKeys: string[]
  valorTotal: number
  destinatario: string | null
  contatoId: string | null
  pontoFocal: boolean
  whatsappContaId: string | null
  assunto: string | null
  corpo: string | null
  status: 'pendente_envio' | 'descartada'
  motivoDescarte: string | null
}): Promise<void> {
  const linha: TablesInsert<'mensagens_outbox'> = {
    canal: args.canal,
    faixa: args.faixa,
    fornecedor_cnpj: args.fornecedor.fornecedor_cnpj,
    fornecedor_nome: args.fornecedor.fornecedor_nome,
    fornecedor_empresa_id: args.fornecedor.fornecedor_empresa_id,
    destinatario: args.destinatario,
    destinatario_contato_id: args.contatoId,
    destinatario_ponto_focal: args.pontoFocal,
    whatsapp_conta_id: args.whatsappContaId,
    access_keys: args.accessKeys,
    valor_total: args.valorTotal,
    assunto: args.assunto,
    corpo: args.corpo,
    status: args.status,
    motivo_descarte: args.motivoDescarte,
  }

  const { error } = await supabaseAdmin.from('mensagens_outbox').insert(linha)
  if (error) {
    logger.error({ cnpj: args.fornecedor.fornecedor_cnpj, erro: error.message }, 'Falha ao gravar na outbox.')
    return
  }

  if (args.status === 'pendente_envio') {
    await emitirEvento(args.fornecedor.fornecedor_empresa_id, EVENTO_TIPOS.OUTBOX_MENSAGEM_GERADA, {
      resumo:
        `Mensagem de ${args.canal} gerada (modo sombra) para ` +
        `${args.fornecedor.fornecedor_nome ?? args.fornecedor.fornecedor_cnpj}: ` +
        `${args.accessKeys.length} nota(s), ${formatarMoeda(args.valorTotal)}.`,
      canal: args.canal,
      faixa: args.faixa,
      access_keys: args.accessKeys,
    })
  }
}
