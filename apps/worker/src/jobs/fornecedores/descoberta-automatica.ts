import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { agregarContatosDoFornecedor } from '../../../../../packages/core/src/fornecedores/contatos-xml.js'
import { dominioDeEmail } from '../../../../../packages/core/src/radar/dominio.js'
import { normalizarTelefoneBr } from '../../../../../packages/core/src/fornecedores/telefone.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { lerCustos, lerMaxNotasPorExtracao, lerTtlAutomatica } from './config.js'
import {
  atualizarResumo,
  cadastralDoFornecedor,
  dentroDoTtl,
  gravarContatos,
  registrarExecucao,
  type CadastralFornecedor,
  type ContatoParaGravar,
} from './descoberta.js'
import { tetoAutomatico } from './orcamento.js'
import { buscarNoGooglePlaces } from './provedores/google-places.js'
import { lerPaginaDeContato } from './provedores/site.js'

/**
 * Camadas 0+1 da cascata (§4.1): o que roda SOZINHO, para todo mundo, sem clique.
 *
 * A ordem é do mais barato e mais certo para o mais caro e mais incerto — e ela não
 * é intuição. Medido nos 688 fornecedores que entram pelo corte de volume:
 *
 *   XML da NF-e   telefone para 528 (77%), e-mail para 201 (29%)   custo zero
 *   Receita       telefone para  75 (11%), e-mail para  70 (10%)   custo zero
 *
 * O XML ganha por sete vezes e já está no nosso banco desde o Prompt 04. Rodar
 * qualquer provedor pago antes de esgotá-lo é pagar por 77% de informação que já
 * temos.
 *
 * O ÚNICO ITEM PAGO daqui é o Google Places, e ele sai do orçamento AUTOMÁTICO da
 * casa, nunca do teto de um originador: ninguém autorizou individualmente uma
 * varredura noturna, e debitá-la do saldo de alguém faria essa pessoa descobrir o
 * gasto no dia em que precisasse clicar.
 */

interface Alvo {
  fornecedor_cnpj: string
  originador_id: string | null
  sacados_principais: unknown
}

export interface ResultadoDescobertaAutomatica {
  processados: number
  contatosNovos: number
  semContato: number
  custo: number
  interrompidoPorOrcamento: boolean
}

/** Uma rodada da camada automática para UM fornecedor. */
export async function descobertaAutomaticaDoFornecedor(
  alvo: Alvo,
  opcoes: { permitirPago: boolean; ttlDias: number; custoPlaces: number; maxNotas: number },
): Promise<{ novos: number; custo: number }> {
  const cadastral = await cadastralDoFornecedor(alvo.fornecedor_cnpj)
  let novos = 0
  let custo = 0

  // ── 1. XML das NF-e ───────────────────────────────────────────────────────
  const { data: notas } = await supabaseAdmin
    .from('notas_fiscais')
    .select('numero, emitida_em, raw_xml, sacado_cnpj')
    .eq('fornecedor_cnpj', alvo.fornecedor_cnpj)
    .not('raw_xml', 'is', null)
    .order('emitida_em', { ascending: false })
    .limit(opcoes.maxNotas)

  /*
   * Os domínios e telefones dos SACADOS entram como exclusão.
   *
   * O `infCpl` da nota do fornecedor traz, com frequência, o contato de quem RECEBE
   * ("Email do Destinatario: fernanda@imincorporadora.com.br" é uma linha real da
   * base). Gravá-lo como contato do fornecedor faria o originador escrever para a
   * incorporadora pedindo para falar com o fornecedor dela.
   */
  const sacadosCnpj = [...new Set((notas ?? []).map((n) => n.sacado_cnpj))]
  const { data: sacados } = sacadosCnpj.length
    ? await supabaseAdmin
        .from('mercado_universo')
        .select('email_rfb, telefone1_rfb, telefone2_rfb, dominio')
        .in('cnpj', sacadosCnpj)
    : { data: [] }

  const dominiosExcluidos = (sacados ?? [])
    .flatMap((s) => [s.dominio, dominioDeEmail(s.email_rfb)])
    .filter((d): d is string => Boolean(d))
  const telefonesExcluidos = (sacados ?? [])
    .flatMap((s) => [s.telefone1_rfb, s.telefone2_rfb])
    .filter((t): t is string => Boolean(t))

  const doXml = agregarContatosDoFornecedor(
    (notas ?? []).map((n) => ({ numero: n.numero, emitida_em: n.emitida_em, raw_xml: n.raw_xml })),
    { dddPadrao: cadastral.ddd, dominiosExcluidos, telefonesExcluidos },
  )

  if (doXml.length > 0) {
    const r = await gravarContatos(
      alvo.fornecedor_cnpj,
      doXml.map<ContatoParaGravar>((c) => ({
        tipo: c.tipo,
        valor: c.valor,
        original: c.original,
        confianca: c.confianca,
        evidencia: c.evidencia,
        frequencia: c.frequencia,
        ultima_vez_visto: c.ultima_vez_visto,
      })),
      'xml_nfe',
    )
    novos += r.novos
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'xml_nfe',
      status: 'sucesso', contatosNovos: r.novos, originadorId: alvo.originador_id,
    })
  } else {
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'xml_nfe',
      status: 'sem_dados', motivo: `${notas?.length ?? 0} notas com XML, nenhum contato do emitente.`,
      originadorId: alvo.originador_id,
    })
  }

  // ── 2. Cadastral da Receita ───────────────────────────────────────────────
  const daReceita = contatosDaReceita(cadastral)
  if (daReceita.length > 0) {
    const r = await gravarContatos(alvo.fornecedor_cnpj, daReceita, 'receita')
    novos += r.novos
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'receita',
      status: 'sucesso', contatosNovos: r.novos, originadorId: alvo.originador_id,
    })
  } else {
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'receita',
      status: 'sem_dados', originadorId: alvo.originador_id,
    })
  }

  // ── 3. Contatos que já temos na base (mesma empresa, promovida antes) ─────
  const daBase = await contatosJaConhecidos(alvo.fornecedor_cnpj, cadastral)
  if (daBase.length > 0) {
    const r = await gravarContatos(alvo.fornecedor_cnpj, daBase, 'site_empresa')
    novos += r.novos
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'contatos_base',
      status: 'sucesso', contatosNovos: r.novos, originadorId: alvo.originador_id,
    })
  }

  // ── 4. Página de contato do site ──────────────────────────────────────────
  const site = await lerPaginaDeContato(cadastral)
  if (site.contatos.length > 0) {
    const r = await gravarContatos(
      alvo.fornecedor_cnpj,
      site.contatos.map<ContatoParaGravar>((c) => ({ ...c, original: c.original })),
      'site_empresa',
    )
    novos += r.novos
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'site_empresa',
      status: 'sucesso', contatosNovos: r.novos, originadorId: alvo.originador_id,
    })
  } else {
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'site_empresa',
      status: site.motivo ? 'pulado' : 'sem_dados', motivo: site.motivo ?? null,
      originadorId: alvo.originador_id,
    })
  }

  // ── 5. Google Places (o único pago desta camada) ──────────────────────────
  if (!opcoes.permitirPago) {
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'google_places',
      status: 'pulado', motivo: 'Orçamento automático do mês esgotado.',
      originadorId: alvo.originador_id,
    })
  } else if (await dentroDoTtl(alvo.fornecedor_cnpj, 'google_places', opcoes.ttlDias)) {
    await registrarExecucao({
      cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'google_places',
      status: 'pulado', motivo: `Consultado há menos de ${opcoes.ttlDias} dias.`,
      originadorId: alvo.originador_id,
    })
  } else {
    const places = await buscarNoGooglePlaces(cadastral)
    if (!places.disponivel) {
      await registrarExecucao({
        cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'google_places',
        status: 'pulado', motivo: places.erro ?? null, originadorId: alvo.originador_id,
      })
    } else {
      // A consulta custa mesmo quando não acha: é ela que é cobrada, não o resultado.
      custo += opcoes.custoPlaces
      const r = places.contatos.length
        ? await gravarContatos(alvo.fornecedor_cnpj, places.contatos, 'google_places')
        : { novos: 0, total: 0 }
      novos += r.novos
      await registrarExecucao({
        cnpj: alvo.fornecedor_cnpj, camada: 'automatica', provedor: 'google_places',
        status: places.contatos.length ? 'sucesso' : places.erro ? 'erro' : 'sem_dados',
        motivo: places.erro ?? null, custo: opcoes.custoPlaces,
        contatosNovos: r.novos, originadorId: alvo.originador_id,
      })
    }
  }

  const resumo = await atualizarResumo(alvo.fornecedor_cnpj, {
    camada: 'automatica',
    marcarSemContato: true,
  })

  if (novos > 0) {
    await emitirEvento(null, EVENTO_TIPOS.FORNECEDOR_CONTATOS_ENCONTRADOS, {
      titulo: 'Contatos do fornecedor encontrados',
      resumo: `${novos} contato(s) novo(s) para ${alvo.fornecedor_cnpj}. Melhor confiança: ${resumo.melhor ?? '—'}.`,
      url: '/comercial/fornecedores',
      cnpj: alvo.fornecedor_cnpj,
      novos,
    })
  }

  return { novos, custo }
}

/**
 * O job em lote.
 *
 * Processa quem AINDA NÃO passou pela camada automática, ou passou há mais tempo que
 * o TTL. A ordem é por potencial: se o orçamento acabar no meio, ele acaba depois de
 * ter olhado os fornecedores que mais valem, não os que vieram primeiro no índice.
 */
export async function descobertaAutomaticaJob(limite = 200): Promise<ResultadoDescobertaAutomatica> {
  const [custos, ttlDias, maxNotas] = await Promise.all([
    lerCustos(),
    lerTtlAutomatica(),
    lerMaxNotasPorExtracao(),
  ])

  const corteTtl = new Date(Date.now() - ttlDias * 86_400_000).toISOString()
  const { data: alvos, error } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('fornecedor_cnpj, originador_id, sacados_principais')
    .not('estagio', 'in', '("cadastrado","sem_interesse")')
    .or(`descoberta_automatica_em.is.null,descoberta_automatica_em.lt.${corteTtl}`)
    .order('potencial_mensal', { ascending: false, nullsFirst: false })
    .limit(limite)
  if (error) throw new Error(`Falha ao listar alvos da descoberta: ${error.message}`)

  let processados = 0
  let contatosNovos = 0
  let semContato = 0
  let custoTotal = 0
  let interrompido = false

  for (const alvo of alvos ?? []) {
    const orc = await tetoAutomatico(custos.google_places)
    if (orc.alerta && !interrompido) {
      await emitirEvento(null, EVENTO_TIPOS.ORCAMENTO_DESCOBERTA_ALERTA, {
        titulo: 'Orçamento de descoberta em alerta',
        resumo: `A descoberta automática gastou ${orc.gasto.toFixed(2)} de ${orc.teto.toFixed(2)} no mês.`,
        url: '/comercial/admin',
        gasto: orc.gasto,
        teto: orc.teto,
      })
      await notificarPerfis(['Admin', 'Comercial'], {
        titulo: 'Orçamento de descoberta em alerta',
        corpo: `R$ ${orc.gasto.toFixed(2)} de R$ ${orc.teto.toFixed(2)} usados este mês.`,
        url: '/comercial/admin',
      })
    }

    /*
     * Estourar o orçamento NÃO interrompe o job — interrompe só o que é pago.
     *
     * As quatro primeiras etapas custam zero, e são as que trazem 77% dos telefones.
     * Parar tudo porque o Google Places acabou seria desligar o que funciona por
     * causa do que é acessório.
     */
    if (!orc.cabe) interrompido = true

    try {
      const r = await descobertaAutomaticaDoFornecedor(alvo as Alvo, {
        permitirPago: orc.cabe,
        ttlDias,
        custoPlaces: custos.google_places,
        maxNotas,
      })
      contatosNovos += r.novos
      custoTotal += r.custo
      if (r.novos === 0) semContato += 1
    } catch (e) {
      // Um fornecedor que falha não pode derrubar a rodada dos outros 199.
      logger.error({ cnpj: alvo.fornecedor_cnpj, erro: String(e) }, 'Descoberta automática falhou para um fornecedor.')
    }
    processados += 1
  }

  logger.info(
    { processados, contatosNovos, semContato, custo: custoTotal, interrompido },
    'Descoberta automática concluída.',
  )
  return {
    processados,
    contatosNovos,
    semContato,
    custo: custoTotal,
    interrompidoPorOrcamento: interrompido,
  }
}

// ─── Fontes locais ──────────────────────────────────────────────────────────

function contatosDaReceita(c: CadastralFornecedor): ContatoParaGravar[] {
  const out: ContatoParaGravar[] = []

  if (c.email_rfb) {
    const e = c.email_rfb.trim().toLowerCase()
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) {
      out.push({
        tipo: 'email',
        valor: e,
        original: c.email_rfb,
        confianca: 'media',
        evidencia: 'Cadastro da Receita Federal (email_rfb)',
      })
    }
  }

  for (const bruto of [c.telefone1_rfb, c.telefone2_rfb]) {
    if (!bruto) continue
    const tel = normalizarTelefoneBr(bruto, { dddPadrao: c.ddd })
    if (!tel.e164) continue
    out.push({
      tipo: 'telefone',
      valor: tel.e164,
      original: bruto,
      /*
       * Média, e não alta, apesar de ser cadastro oficial: o telefone da Receita é o
       * que o contador escreveu na abertura da empresa e ninguém nunca mais atualizou.
       * O `emit` da NF-e é declarado a cada nota emitida — tem data.
       */
      confianca: 'media',
      evidencia: 'Cadastro da Receita Federal (telefone_rfb)',
    })
  }

  return out
}

/**
 * Contatos que já temos: da própria ficha, se ela existir, e das empresas do MESMO
 * domínio corporativo (filiais e SPEs do grupo compartilham domínio).
 */
async function contatosJaConhecidos(
  cnpj: string,
  cadastral: CadastralFornecedor,
): Promise<ContatoParaGravar[]> {
  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('id')
    .eq('cnpj', cnpj)
    .maybeSingle()

  const ids: string[] = []
  if (empresa?.id) ids.push(empresa.id)

  if (cadastral.dominio) {
    const { data: irmas } = await supabaseAdmin
      .from('empresas')
      .select('id')
      .eq('dominio', cadastral.dominio)
      .limit(20)
    for (const i of irmas ?? []) if (!ids.includes(i.id)) ids.push(i.id)
  }
  if (ids.length === 0) return []

  const { data: contatos } = await supabaseAdmin
    .from('contatos')
    .select('nome, cargo, email, telefone, whatsapp')
    .in('empresa_id', ids)
    .limit(50)

  const out: ContatoParaGravar[] = []
  for (const c of contatos ?? []) {
    if (c.email) {
      out.push({
        tipo: 'email', valor: c.email.trim().toLowerCase(), original: c.email,
        nome_pessoa: c.nome, cargo: c.cargo, confianca: 'media',
        evidencia: 'Contato já cadastrado na base',
      })
    }
    for (const [tipo, bruto] of [['telefone', c.telefone], ['whatsapp', c.whatsapp]] as const) {
      if (!bruto) continue
      const tel = normalizarTelefoneBr(bruto, { dddPadrao: cadastral.ddd })
      if (!tel.e164) continue
      out.push({
        tipo, valor: tel.e164, original: bruto, nome_pessoa: c.nome, cargo: c.cargo,
        confianca: 'media', evidencia: 'Contato já cadastrado na base',
      })
    }
  }
  return out
}
