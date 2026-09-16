import { normalizarTelefoneBr } from '../../../../../packages/core/src/fornecedores/telefone.js'
import {
  montarPedidoDeLigacao,
  type ContatoDaLigacao,
  type FatosDaLigacao,
  type MotivoNaoLigar,
} from '../../../../../packages/core/src/voz/pedido.js'
import { lerConfigVoz } from '../../voz/config.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Quem a Ana vai ligar hoje — e, para cada nota que ficou de fora, por quê.
 *
 * ── DUAS SAÍDAS, NENHUMA SILENCIOSA ────────────────────────────────────────
 * O job grava `a_enviar` para o que passou e `recusada` + `motivo_recusa` para o
 * que não passou. A segunda metade é a que importa no começo: sem ela, "a Ana
 * não ligou para ninguém hoje" é um mistério, e o time vai procurar bug onde
 * existe regra — hoje quase tudo cai em `sem_iof`, porque a estimativa do funil
 * não calcula IOF (ver o PR).
 *
 * ── A NOTA É A UNIDADE, E É DIFERENTE DA OUTBOX ────────────────────────────
 * O toque por mensagem é por FORNECEDOR (ninguém recebe um WhatsApp por nota).
 * A ligação é por NOTA: a conversa inteira gira em torno de "a nota 8812, da
 * construtora tal, que vence dia tal" — é assim que a Ana abre, e é o que dá a
 * ela o direito de estar ligando. Agrupar notas diluiria justamente isso.
 */

export interface ResultadoGeracaoVoz {
  candidatas: number
  enfileiradas: number
  recusadas: number
  motivos: Record<string, number>
}

interface LinhaFunil {
  access_key: string
  numero: string | null
  serie: string | null
  emitida_em: string | null
  vencimento: string | null
  vencimento_origem: string | null
  valor: number
  taxa_usada: number | null
  receita_esperada: number | null
  status_sync: string | null
  operavel: boolean | null
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  fornecedor_empresa_id: string | null
  fornecedor_cadastrado: boolean | null
  fornecedor_suprimido: boolean | null
  sacado_cnpj: string
  sacado_nome: string | null
  sacado_razao_social: string | null
  contato_fornecedor: unknown
}

const COLUNAS =
  'access_key, numero, serie, emitida_em, vencimento, vencimento_origem, valor, taxa_usada, ' +
  'receita_esperada, status_sync, operavel, fornecedor_cnpj, fornecedor_nome, ' +
  'fornecedor_empresa_id, fornecedor_cadastrado, fornecedor_suprimido, sacado_cnpj, ' +
  'sacado_nome, sacado_razao_social, contato_fornecedor'

/**
 * O PROCON não é coluna de `contatos` — chega como texto na evidência do
 * enriquecimento ("Nova Vida TI · telefone da empresa (celular, no Procon)").
 * Ler daí é feio e é o único sinal que existe hoje; enquanto for assim, é melhor
 * ler feio do que ligar para quem está na lista.
 */
async function telefonesNoProcon(cnpj: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('contatos_descobertos')
    .select('valor, evidencia')
    .eq('fornecedor_cnpj', cnpj)
    .in('tipo', ['telefone', 'whatsapp'])
  const marcados = new Set<string>()
  for (const linha of data ?? []) {
    if ((linha.evidencia ?? '').toLowerCase().includes('procon')) {
      marcados.add((linha.valor ?? '').replace(/\D/g, ''))
    }
  }
  return marcados
}

async function suprimidosPorTelefone(): Promise<Set<string>> {
  const hoje = new Date().toISOString().slice(0, 10)
  const { data } = await supabaseAdmin
    .from('supressao')
    .select('valor')
    .in('escopo', ['telefone', 'whatsapp'])
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
  return new Set((data ?? []).map((s) => s.valor))
}

/** Ponto focal primeiro — a mesma hierarquia da outbox (§3.2). */
async function escolherContato(
  nota: LinhaFunil,
  bloqueados: Set<string>,
  procon: Set<string>,
): Promise<ContatoDaLigacao | null> {
  const candidatos: ContatoDaLigacao[] = []

  if (nota.fornecedor_empresa_id) {
    const { data } = await supabaseAdmin
      .from('contatos')
      .select('id, nome, cargo, email, telefone, whatsapp, ponto_focal, base_legal, nao_e_o_decisor')
      .eq('empresa_id', nota.fornecedor_empresa_id)
      .order('ponto_focal', { ascending: false })
    for (const c of data ?? []) {
      const tel = normalizarTelefoneBr(c.whatsapp ?? c.telefone)
      if (!tel.valido || !tel.e164) continue
      candidatos.push({
        nome: c.nome,
        cargo: c.cargo,
        telefone_e164: tel.e164,
        email: c.email,
        base_legal: c.base_legal,
        no_procon: procon.has(tel.e164.replace(/\D/g, '')),
      })
    }
  }

  // O contato que veio no XML da NF é o último recurso — `contatos` é curado.
  // A base legal dele é `dado_publico_nfe` pela mesma regra da 0144/0196.
  const doPayload = nota.contato_fornecedor as { name?: string; phone?: string } | null
  if (doPayload?.phone) {
    const tel = normalizarTelefoneBr(doPayload.phone)
    if (tel.valido && tel.e164) {
      candidatos.push({
        nome: doPayload.name ?? nota.fornecedor_nome,
        telefone_e164: tel.e164,
        base_legal: 'dado_publico_nfe',
        no_procon: procon.has(tel.e164.replace(/\D/g, '')),
      })
    }
  }

  const livre = candidatos.find((c) => !bloqueados.has((c.telefone_e164 ?? '').replace(/\D/g, '')))
  return livre ?? candidatos[0] ?? null
}

export async function gerarFilaDeVoz(): Promise<ResultadoGeracaoVoz> {
  const cfg = await lerConfigVoz()
  const agora = new Date()
  const motivos: Record<string, number> = {}
  const conta = (m: MotivoNaoLigar): void => {
    motivos[m] = (motivos[m] ?? 0) + 1
  }

  if (!cfg.ligada) {
    logger.info('Voz desligada na config; nada a gerar.')
    return { candidatas: 0, enfileiradas: 0, recusadas: 0, motivos }
  }

  const { data: notas, error } = await supabaseAdmin
    .from('notas_funil')
    .select(COLUNAS)
    .in('faixa', cfg.faixas)
    .in('estagio_funil', ['a_prospectar', 'em_prospeccao'])
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(cfg.maximo_por_rodada)

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler o funil para a fila de voz.')
    return { candidatas: 0, enfileiradas: 0, recusadas: 0, motivos }
  }

  const bloqueados = await suprimidosPorTelefone()
  let enfileiradas = 0
  let recusadas = 0

  for (const bruta of (notas ?? []) as unknown as LinhaFunil[]) {
    // Já existe linha para esta nota? A `access_key` é PK: nunca duas ligações
    // pela mesma nota, nem quando o job roda duas vezes no mesmo minuto.
    const { rowCount } = await pool.query('select 1 from voz_ligacoes where access_key = $1', [
      bruta.access_key,
    ])
    if (rowCount) continue

    const procon = await telefonesNoProcon(bruta.fornecedor_cnpj)
    const contato = await escolherContato(bruta, bloqueados, procon)
    const telefoneDigitos = (contato?.telefone_e164 ?? '').replace(/\D/g, '')

    const fatos: FatosDaLigacao = {
      killSwitch: cfg.kill_switch,
      suprimido: Boolean(bruta.fornecedor_suprimido) || bloqueados.has(telefoneDigitos),
      contato,
      nota: {
        access_key: bruta.access_key,
        numero: bruta.numero,
        serie: bruta.serie,
        emitida_em: bruta.emitida_em,
        vencimento: bruta.vencimento,
        vencimento_origem: bruta.vencimento_origem as FatosDaLigacao['nota']['vencimento_origem'],
        valor: Number(bruta.valor),
        taxa_am: bruta.taxa_usada === null ? null : Number(bruta.taxa_usada),
        // A view não diz se a taxa caiu no default; enquanto não disser, a
        // ausência de taxa é o único sinal (ver §2.2 do PR).
        taxa_padrao: false,
        valor_desconto: bruta.receita_esperada === null ? null : Number(bruta.receita_esperada),
        // DECISÃO EM ABERTO: o funil não calcula IOF. Enquanto for assim, o
        // portão recusa com `sem_iof` em vez de a Ana prometer a mais.
        valor_iof: null,
        valor_liquido:
          bruta.receita_esperada === null ? null : Number(bruta.valor) - Number(bruta.receita_esperada),
        cancelada: (bruta.status_sync ?? '').toLowerCase().includes('cancel'),
        operavel: bruta.operavel,
      },
      fornecedor: {
        razao_social: bruta.fornecedor_nome ?? '',
        cnpj: bruta.fornecedor_cnpj,
      },
      sacado: {
        razao_social: bruta.sacado_razao_social ?? bruta.sacado_nome ?? '',
        cnpj: bruta.sacado_cnpj,
      },
      cadastro: { ativo: Boolean(bruta.fornecedor_cadastrado), pendencias: [] },
      validade_proposta: new Date(agora.getTime() + cfg.validade_dias * 86_400_000)
        .toISOString()
        .slice(0, 10),
      agora,
    }

    const montado = montarPedidoDeLigacao(fatos)
    if (!montado.ok) {
      conta(montado.motivo)
      recusadas++
      await pool.query(
        `insert into voz_ligacoes (access_key, fornecedor_cnpj, contato_id, telefone, status, motivo_recusa)
         values ($1, $2, null, $3, 'recusada', $4)
         on conflict (access_key) do nothing`,
        [bruta.access_key, bruta.fornecedor_cnpj, contato?.telefone_e164 ?? null, montado.motivo],
      )
      continue
    }

    enfileiradas++
    await pool.query(
      `insert into voz_ligacoes (access_key, fornecedor_cnpj, telefone, status, pedido)
       values ($1, $2, $3, 'a_enviar', $4)
       on conflict (access_key) do nothing`,
      [bruta.access_key, bruta.fornecedor_cnpj, montado.pedido.telefone, montado.pedido],
    )
  }

  const resultado = { candidatas: notas?.length ?? 0, enfileiradas, recusadas, motivos }
  logger.info(resultado, 'Fila de voz gerada.')
  return resultado
}
