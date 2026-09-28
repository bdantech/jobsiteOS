import { z } from 'zod'
import { agruparNotificacoes, ErroAgrupamento } from '../../cobranca/agrupamento.js'
import { atualizarDividaCobranca } from '../../cobranca/atualizacao.js'
import { hojeSaoPaulo } from '../../cobranca/datas.js'
import { simularParcelamento } from '../../cobranca/parcelamento.js'
import { buscarReconciliacaoCobranca, explicarReconciliacao } from '../../cobranca/reconciliacao.js'
import {
  CANAL_ENTREGA_LABELS,
  COBRANCA_ESTAGIOS_ENCERRADOS,
  COBRANCA_ESTAGIO_LABELS,
  PAPEL_NOTIFICACAO_COBRANCA_LABELS,
  SINISTRO_ESTAGIO_LABELS,
  checklistSinistroToolSchema,
  detalheCobrancaToolSchema,
  lerCobrancaConfig,
  listarCobrancasToolSchema,
  prazosApoliceToolSchema,
  rascunharNotificacaoToolSchema,
  simularAtualizacaoToolSchema,
  simularParcelamentoToolSchema,
  titulosEmAbertoToolSchema,
  type CanalEntrega,
  type CobrancaEstagio,
  type PapelNotificacaoCobranca,
  type ParametrosAtualizacao,
  type SinistroEstagio,
} from '../../cobranca/schemas.js'
import { formatCnpj } from '../../schemas/cnpj.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Cobrança (07): cobrança extrajudicial, protesto, acordo e sinistro.
 *
 * TODAS as tools são leitura ou rascunho (§14). Nenhuma envia notificação, protesta,
 * abre sinistro ou bloqueia sacado — e as descrições dizem isso ao modelo em vez de
 * deixar implícito: "rascunhei a notificação" lido em voz alta soa como "notifiquei o
 * devedor", e uma notificação extrajudicial tem consequência jurídica e de apólice.
 * O que exige ato devolve a `route` da tela onde a pessoa aperta o botão.
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })

const estagioLabel = (e: string | null) => (e ? (COBRANCA_ESTAGIO_LABELS[e as CobrancaEstagio] ?? e) : '—')
const MARCO_LABELS: Record<string, string> = {
  parada_cobertura: 'Parada automática de cobertura (D+60)',
  notificacao_seguradora: 'Prazo para notificar a seguradora (D+90)',
  data_perda: 'Data da Perda (D+180)',
  envio_sinistro: 'Prazo final de envio do sinistro',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const soDigitos = (s: string) => s.replace(/\D/g, '')

async function acharCobranca(ref: string, ctx: ToolContext) {
  const q = ctx.supabase.from('cobranca_cards').select('*')
  const { data, error } = UUID.test(ref) ? await q.eq('id', ref).maybeSingle() : await q.ilike('codigo', ref.trim()).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/** Construtora → CNPJ do cabeça do grupo, por CNPJ (qualquer SPE) ou por nome. */
async function grupoDaConstrutora(texto: string, ctx: ToolContext): Promise<{ matriz: string; nome: string | null } | null> {
  const cnpj = soDigitos(texto)
  const q = ctx.supabase.from('titulos').select('sacado_matriz_cnpj, sacado_nome, sacado_cnpj')
  const { data, error } =
    cnpj.length === 14
      ? await q.or(`sacado_cnpj.eq.${cnpj},sacado_matriz_cnpj.eq.${cnpj}`).limit(1)
      : await q.ilike('sacado_nome', `%${texto.trim()}%`).limit(1)
  if (error) throw new Error(error.message)
  const t = data?.[0]
  return t ? { matriz: t.sacado_matriz_cnpj, nome: t.sacado_nome } : null
}

async function listar(input: z.infer<typeof listarCobrancasToolSchema>, ctx: ToolContext) {
  let q = ctx.supabase
    .from('cobranca_cards')
    .select('id, codigo, estagio, sacado_razao_social, sacado_matriz_cnpj, qtd_titulos, qtd_spes, valor_face, valor_atualizado, dias_desde_notificacao, proximo_marco, proximo_marco_em, dias_restantes, responsavel_nome, responsavel_id, tem_protesto, tem_sinistro, tem_processo')
    .order('dias_restantes', { ascending: true, nullsFirst: false })
    .limit(200)
  if (input.estagio) q = q.eq('estagio', input.estagio)
  else q = q.not('estagio', 'in', `(${COBRANCA_ESTAGIOS_ENCERRADOS.join(',')})`)
  if (input.minhas) q = q.eq('responsavel_id', ctx.userId)
  if (input.sacado) {
    const d = soDigitos(input.sacado)
    q = d.length >= 8 ? q.like('sacado_matriz_cnpj', `${d}%`) : q.ilike('sacado_razao_social', `%${input.sacado.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  return {
    total: linhas.length,
    valor_face_total: brl(linhas.reduce((s, l) => s + Number(l.valor_face ?? 0), 0)),
    cobrancas: linhas.map((l) => ({
      codigo: l.codigo,
      estagio: estagioLabel(l.estagio),
      sacado: l.sacado_razao_social,
      titulos: l.qtd_titulos,
      spes: l.qtd_spes,
      valor_face: brl(l.valor_face),
      valor_atualizado: l.valor_atualizado === null ? 'ainda não calculado' : brl(l.valor_atualizado),
      dias_desde_notificacao: l.dias_desde_notificacao,
      proximo_prazo_apolice: l.proximo_marco
        ? `${MARCO_LABELS[l.proximo_marco] ?? l.proximo_marco} em ${l.proximo_marco_em} (${l.dias_restantes} dias)`
        : null,
      responsavel: l.responsavel_nome,
      selos: [l.tem_protesto && 'protesto', l.tem_sinistro && 'sinistro', l.tem_processo && 'processo'].filter(Boolean),
      route: `/cobranca/cobrancas/${l.id}`,
    })),
  }
}

async function detalhe(input: z.infer<typeof detalheCobrancaToolSchema>, ctx: ToolContext) {
  const c = await acharCobranca(input.cobranca, ctx)
  if (!c?.id) return { encontrada: false, aviso: `Nenhuma cobrança "${input.cobranca}".` }

  const [titulos, notifs, interacoes] = await Promise.all([
    ctx.supabase
      .from('cobranca_titulos')
      .select('id, situacao, valor_face_snapshot, vencimento_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot, quitado_em, titulos(numero, sacado_nome, cedente_nome)')
      .eq('cobranca_id', c.id),
    ctx.supabase
      .from('cobranca_notificacoes')
      .select('id, papel, destinatario_razao_social, rodada, status, enviada_em, valor_total, cobranca_notificacao_entregas(canal, status, codigo_rastreio)')
      .eq('cobranca_id', c.id)
      .order('rodada'),
    ctx.supabase.from('cobranca_interacoes').select('tipo, resumo, ocorrida_em').eq('cobranca_id', c.id).order('ocorrida_em', { ascending: false }).limit(10),
  ])
  for (const r of [titulos, notifs, interacoes]) if (r.error) throw new Error(r.error.message)

  return {
    codigo: c.codigo,
    estagio: estagioLabel(c.estagio),
    sacado: `${c.sacado_razao_social ?? ''} (${formatCnpj(c.sacado_matriz_cnpj ?? '')})`,
    valor_face: brl(c.valor_face),
    valor_em_aberto: brl(c.valor_em_aberto),
    valor_atualizado: c.valor_atualizado === null ? 'ainda não calculado' : `${brl(c.valor_atualizado)} (em ${c.valor_atualizado_em?.slice(0, 10)})`,
    processo: c.processo_cnj,
    proximo_prazo_apolice: c.proximo_marco ? `${MARCO_LABELS[c.proximo_marco] ?? c.proximo_marco} em ${c.proximo_marco_em}` : null,
    titulos: (titulos.data ?? []).map((t) => ({
      numero: (t.titulos as { numero: string | null } | null)?.numero ?? null,
      spe: (t.titulos as { sacado_nome: string | null } | null)?.sacado_nome ?? t.sacado_cnpj_snapshot,
      cedente: (t.titulos as { cedente_nome: string | null } | null)?.cedente_nome ?? t.cedente_cnpj_snapshot,
      vencimento: t.vencimento_snapshot,
      valor: brl(t.valor_face_snapshot),
      situacao: t.situacao,
    })),
    notificacoes: (notifs.data ?? []).map((n) => ({
      para: n.destinatario_razao_social,
      papel: PAPEL_NOTIFICACAO_COBRANCA_LABELS[n.papel as PapelNotificacaoCobranca] ?? n.papel,
      rodada: n.rodada,
      status: n.status,
      enviada_em: n.enviada_em,
      entregas: ((n.cobranca_notificacao_entregas as { canal: string; status: string; codigo_rastreio: string | null }[] | null) ?? []).map(
        (e) => `${CANAL_ENTREGA_LABELS[e.canal as CanalEntrega] ?? e.canal}: ${e.status}${e.codigo_rastreio ? ` (${e.codigo_rastreio})` : ''}`,
      ),
    })),
    ultimos_contatos: interacoes.data ?? [],
    route: `/cobranca/cobrancas/${c.id}`,
  }
}

async function titulosEmAberto(input: z.infer<typeof titulosEmAbertoToolSchema>, ctx: ToolContext) {
  const g = await grupoDaConstrutora(input.construtora, ctx)
  if (!g) return { encontrada: false, aviso: `Nenhum título cedido encontrado para "${input.construtora}".` }

  let q = ctx.supabase
    .from('cobranca_titulos_abertos')
    .select('id, numero, sacado_cnpj, sacado_nome, cedente_nome, vencimento, dias_atraso, valor_face, status_producao, cobranca_ativa_codigo')
    .eq('sacado_matriz_cnpj', g.matriz)
    .order('vencimento')
  if (input.atraso_minimo) q = q.gte('dias_atraso', input.atraso_minimo)
  const { data, error } = await q.limit(500)
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  const vencidos = linhas.filter((l) => (l.dias_atraso ?? 0) > 0)
  // A produção não marca a liquidação por título; o limite consumido do grupo diz quanto
  // do vencido segue de fato em aberto (0270). Falhar aqui não derruba a resposta.
  const rec = await buscarReconciliacaoCobranca(ctx.supabase, [g.matriz])
    .then((m) => m.get(g.matriz) ?? null)
    .catch(() => null)
  return {
    grupo: `${g.nome ?? ''} (matriz ${formatCnpj(g.matriz)})`,
    total: linhas.length,
    vencidos: vencidos.length,
    valor_vencido: brl(vencidos.reduce((s, l) => s + Number(l.valor_face ?? 0), 0)),
    plataforma: rec ? explicarReconciliacao(rec) : null,
    vencido_estimado_pela_plataforma: rec?.vencido_estimado === null || !rec ? null : brl(rec.vencido_estimado),
    aviso:
      'A produção não marca a liquidação por título: um título "aberto" aqui pode já ter sido pago. ' +
      'O campo `plataforma` diz o que o limite consumido do grupo indica; confira antes de cobrar.',
    titulos: linhas.map((l) => ({
      numero: l.numero,
      spe: l.sacado_nome,
      cedente: l.cedente_nome,
      vencimento: l.vencimento,
      dias_atraso: l.dias_atraso,
      valor_face: brl(l.valor_face),
      status_producao: l.status_producao,
      em_cobranca: l.cobranca_ativa_codigo,
    })),
    route: `/cobranca/nova?sacado=${g.matriz}`,
  }
}

async function lerConfig(ctx: ToolContext) {
  const { data, error } = await ctx.supabase.from('cobranca_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return lerCobrancaConfig(data ?? [])
}

async function lerTabelaIndices(ctx: ToolContext, indice: string): Promise<Record<string, number>> {
  if (indice === 'nenhum') return {}
  const { data, error } = await ctx.supabase.from('juridico_indices').select('competencia, valor').eq('indice', indice)
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((r) => [r.competencia, Number(r.valor)]))
}

async function simularAtualizacao(input: z.infer<typeof simularAtualizacaoToolSchema>, ctx: ToolContext) {
  const dataBase = input.data_base ?? hojeSaoPaulo()
  let titulos: { id: string; valor_face: number; vencimento: string; descricao: string | null }[] = []
  let parametros: ParametrosAtualizacao | null = null
  let rotulo = ''

  if (input.cobranca) {
    const c = await acharCobranca(input.cobranca, ctx)
    if (!c?.id) return { encontrada: false, aviso: `Nenhuma cobrança "${input.cobranca}".` }
    const { data, error } = await ctx.supabase
      .from('cobranca_titulos')
      .select('id, valor_face_snapshot, vencimento_snapshot, titulos(numero)')
      .eq('cobranca_id', c.id)
      .not('situacao', 'in', '(quitado,retirado)')
    if (error) throw new Error(error.message)
    titulos = (data ?? []).map((t) => ({
      id: t.id,
      valor_face: Number(t.valor_face_snapshot),
      vencimento: t.vencimento_snapshot,
      descricao: (t.titulos as { numero: string | null } | null)?.numero ?? null,
    }))
    parametros = {
      juros_mora_mes: Number(c.juros_mora_mes ?? 1),
      multa_pct: Number(c.multa_pct ?? 2),
      honorarios_pct: Number(c.honorarios_pct ?? 10),
      indice: (c.indice_correcao ?? 'igpm') as ParametrosAtualizacao['indice'],
      juros_pro_rata: c.juros_pro_rata ?? true,
    }
    rotulo = c.codigo ?? ''
  } else if (input.construtora) {
    const g = await grupoDaConstrutora(input.construtora, ctx)
    if (!g) return { encontrada: false, aviso: `Nenhum título cedido para "${input.construtora}".` }
    const { data, error } = await ctx.supabase
      .from('cobranca_titulos_abertos')
      .select('id, valor_face, vencimento, numero')
      .eq('sacado_matriz_cnpj', g.matriz)
      .lt('vencimento', dataBase)
    if (error) throw new Error(error.message)
    titulos = (data ?? []).map((t) => ({ id: t.id!, valor_face: Number(t.valor_face), vencimento: t.vencimento!, descricao: t.numero }))
    rotulo = g.nome ?? g.matriz
  } else {
    return { aviso: 'Informe a cobrança ou a construtora.' }
  }

  if (titulos.length === 0) return { aviso: 'Nenhum título vencido em aberto para atualizar.' }
  const p = parametros ?? (await lerConfig(ctx)).calculo
  const r = atualizarDividaCobranca(titulos, p, await lerTabelaIndices(ctx, p.indice), dataBase)

  return {
    referencia: rotulo,
    data_base: dataBase,
    parametros: `${p.indice.toUpperCase()}, juros ${p.juros_mora_mes}% a.m., multa ${p.multa_pct}%, honorários ${p.honorarios_pct}%`,
    principal: brl(r.principal),
    correcao: brl(r.correcao),
    juros: brl(r.juros),
    multa: brl(r.multa),
    honorarios: brl(r.honorarios),
    total_atualizado: brl(r.total),
    competencias_sem_indice: r.competencias_sem_indice,
    aviso: 'Simulação: nada foi gravado.',
  }
}

async function simularParcelamentoTool(input: z.infer<typeof simularParcelamentoToolSchema>) {
  const { comparar_com, ...base } = input
  const cenarios = [base, ...(comparar_com ?? []).map((c) => ({ ...c, valor: base.valor }))]
  return {
    aviso: 'Simulação: nada foi gravado. Para salvar o cenário e gerar a minuta, use a aba Acordo da cobrança.',
    cenarios: cenarios.map((c, i) => {
      const s = simularParcelamento(c)
      return {
        cenario: i + 1,
        sistema: s.sistema.toUpperCase(),
        entrada: brl(s.entrada),
        parcelas: `${s.qtd_parcelas}x ${s.periodicidade}`,
        primeira_parcela: brl(s.parcelas.find((p) => p.numero === 1)?.valor),
        ultima_parcela: brl(s.parcelas.at(-1)?.valor),
        juros_total: brl(s.juros_total),
        total_projetado: brl(s.valor_total_projetado),
        custo_vs_a_vista: brl(s.custo_parcelamento),
      }
    }),
  }
}

async function prazosApolice(input: z.infer<typeof prazosApoliceToolSchema>, ctx: ToolContext) {
  const janela = input.dias ?? 30
  let q = ctx.supabase
    .from('apolice_relogio')
    .select('titulo_id, numero, sacado_nome, sacado_matriz_cnpj, valor_face, proximo_marco, proximo_marco_em, dias_restantes, causa, cobranca_codigo, cobranca_id, notificado_seguradora_em')
    .lte('dias_restantes', janela)
    .order('dias_restantes')
    .limit(300)
  if (input.sacado) {
    const d = soDigitos(input.sacado)
    q = d.length >= 8 ? q.like('sacado_matriz_cnpj', `${d}%`) : q.ilike('sacado_nome', `%${input.sacado.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  const criticos = linhas.filter((l) => l.proximo_marco === 'notificacao_seguradora' && (l.dias_restantes ?? 99) <= 5)
  return {
    janela_dias: janela,
    total: linhas.length,
    criticos: criticos.length,
    aviso: criticos.length
      ? `${criticos.length} título(s) a 5 dias ou menos de perder o direito à indenização: a seguradora precisa ser notificada.`
      : undefined,
    prazos: linhas.map((l) => ({
      titulo: l.numero,
      sacado: l.sacado_nome,
      valor: brl(l.valor_face),
      marco: MARCO_LABELS[l.proximo_marco ?? ''] ?? l.proximo_marco,
      vence_em: l.proximo_marco_em,
      dias_restantes: l.dias_restantes,
      causa: l.causa,
      cobranca: l.cobranca_codigo,
      route: l.cobranca_id ? `/cobranca/cobrancas/${l.cobranca_id}` : '/cobranca',
    })),
  }
}

async function rascunharNotificacao(input: z.infer<typeof rascunharNotificacaoToolSchema>, ctx: ToolContext) {
  const c = await acharCobranca(input.cobranca, ctx)
  if (!c?.id) return { encontrada: false, aviso: `Nenhuma cobrança "${input.cobranca}".` }
  const { data, error } = await ctx.supabase
    .from('cobranca_titulos')
    .select('id, valor_face_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot, titulos(sacado_matriz_cnpj, cedente_matriz_cnpj)')
    .eq('cobranca_id', c.id)
    .not('situacao', 'in', '(quitado,retirado)')
  if (error) throw new Error(error.message)

  const titulos = (data ?? []).map((t) => {
    const tt = t.titulos as { sacado_matriz_cnpj: string; cedente_matriz_cnpj: string } | null
    return {
      id: t.id,
      valor: Number(t.valor_face_snapshot),
      sacado_cnpj: t.sacado_cnpj_snapshot,
      sacado_matriz_cnpj: tt?.sacado_matriz_cnpj ?? c.sacado_matriz_cnpj ?? '',
      cedente_cnpj: t.cedente_cnpj_snapshot,
      cedente_matriz_cnpj: tt?.cedente_matriz_cnpj ?? t.cedente_cnpj_snapshot,
    }
  })
  try {
    const grupos = agruparNotificacoes(titulos, {
      escopo: (c.escopo_notificacao ?? 'sacado') as 'sacado',
      notificarMatrizCedente: c.notificar_matriz_cedente ?? true,
    })
    const valor = new Map(titulos.map((t) => [t.id, t.valor]))
    return {
      aviso:
        'RASCUNHO: nada foi gerado nem enviado. Para gerar as minutas em PDF, revisar endereços e ' +
        'enviar, abra a cobrança — o envio exige o aceite do aviso da apólice.',
      codigo: c.codigo,
      notificacoes: grupos.map((g) => ({
        papel: PAPEL_NOTIFICACAO_COBRANCA_LABELS[g.papel],
        destinatario: formatCnpj(g.destinatario_cnpj),
        titulos: g.titulo_ids.length,
        valor_face: brl(g.titulo_ids.reduce((s, id) => s + (valor.get(id) ?? 0), 0)),
      })),
      route: `/cobranca/cobrancas/${c.id}?aba=notificacoes`,
    }
  } catch (e) {
    if (e instanceof ErroAgrupamento) return { aviso: e.message }
    throw e
  }
}

async function checklistSinistro(input: z.infer<typeof checklistSinistroToolSchema>, ctx: ToolContext) {
  const q = ctx.supabase.from('sinistros').select('id, codigo, estagio, data_perda, data_limite_envio, valor_total_face, indenizacao_estimada')
  const { data: s, error } = UUID.test(input.sinistro) ? await q.eq('id', input.sinistro).maybeSingle() : await q.ilike('codigo', input.sinistro.trim()).maybeSingle()
  if (error) throw new Error(error.message)
  if (!s) return { encontrado: false, aviso: `Nenhum sinistro "${input.sinistro}".` }

  const { data: docs, error: e2 } = await ctx.supabase
    .from('sinistro_documentos')
    .select('item, descricao, obrigatorio, origem, status, justificativa_ausencia')
    .eq('sinistro_id', s.id)
    .order('item')
  if (e2) throw new Error(e2.message)
  const pendentes = (docs ?? []).filter((d) => d.obrigatorio && d.status === 'pendente')
  return {
    codigo: s.codigo,
    estagio: SINISTRO_ESTAGIO_LABELS[s.estagio as SinistroEstagio] ?? s.estagio,
    data_perda: s.data_perda,
    prazo_envio: s.data_limite_envio,
    valor_face: brl(s.valor_total_face),
    indenizacao_estimada: brl(s.indenizacao_estimada),
    faltam: pendentes.map((d) => `${d.item}) ${d.descricao}${d.origem === 'sistema' ? ' — gerado pelo sistema ao montar o dossiê' : ''}`),
    completos: (docs ?? []).filter((d) => d.status !== 'pendente').map((d) => `${d.item}) ${d.descricao}`),
    route: `/cobranca/sinistros/${s.id}`,
  }
}

export const cobrancaModule: AppModule = {
  id: 'cobranca',
  name: 'Cobrança',
  icon: 'wallet',
  route: '/cobranca',
  group: 'operacoes',
  tools: [
    {
      id: 'cobranca.listar',
      name: 'Listar cobranças',
      description:
        'Lista as cobranças extrajudiciais (ativas por padrão), com estágio, valor, dias desde a notificação e o ' +
        'próximo prazo da apólice de seguro de crédito. Somente leitura.',
      inputSchema: listarCobrancasToolSchema,
      mutates: false,
      execute: (input, ctx) => listar(input as z.infer<typeof listarCobrancasToolSchema>, ctx),
    },
    {
      id: 'cobranca.detalhe',
      name: 'Detalhe da cobrança',
      description:
        'Detalhe de uma cobrança pelo código (COB-2026-0001): títulos, notificações e entregas, últimos contatos e ' +
        'próximo prazo da apólice. Somente leitura.',
      inputSchema: detalheCobrancaToolSchema,
      mutates: false,
      execute: (input, ctx) => detalhe(input as z.infer<typeof detalheCobrancaToolSchema>, ctx),
    },
    {
      id: 'cobranca.titulos_em_aberto',
      name: 'Títulos em aberto da construtora',
      description:
        'Títulos cedidos em aberto de uma construtora — o grupo inteiro (matriz e SPEs), a partir de qualquer CNPJ ou ' +
        'do nome. Mostra dias de atraso e se o título já está em cobrança. Somente leitura.',
      inputSchema: titulosEmAbertoToolSchema,
      mutates: false,
      execute: (input, ctx) => titulosEmAberto(input as z.infer<typeof titulosEmAbertoToolSchema>, ctx),
    },
    {
      id: 'cobranca.simular_atualizacao',
      name: 'Simular dívida atualizada',
      description:
        'Calcula o valor atualizado (correção, juros de mora, multa e honorários) de uma cobrança ou dos títulos ' +
        'vencidos de uma construtora, na data-base pedida. Simulação: não grava nada.',
      inputSchema: simularAtualizacaoToolSchema,
      mutates: false,
      execute: (input, ctx) => simularAtualizacao(input as z.infer<typeof simularAtualizacaoToolSchema>, ctx),
    },
    {
      id: 'cobranca.simular_parcelamento',
      name: 'Simular parcelamento',
      description:
        'Simula um acordo parcelado (Price ou SAC, entrada, periodicidade, juros ao mês) e compara até 3 cenários. ' +
        'Simulação: não grava nada nem gera minuta.',
      inputSchema: simularParcelamentoToolSchema,
      mutates: false,
      execute: (input) => simularParcelamentoTool(input as z.infer<typeof simularParcelamentoToolSchema>),
    },
    {
      id: 'cobranca.prazos_apolice',
      name: 'Prazos da apólice',
      description:
        'O relógio da apólice Atradius: o que vence nos próximos N dias (parada de cobertura, prazo de notificar a ' +
        'seguradora, Data da Perda, prazo de envio do sinistro), ordenado pelo mais urgente. Somente leitura.',
      inputSchema: prazosApoliceToolSchema,
      mutates: false,
      execute: (input, ctx) => prazosApolice(input as z.infer<typeof prazosApoliceToolSchema>, ctx),
    },
    {
      id: 'cobranca.rascunhar_notificacao',
      name: 'Rascunhar notificação',
      description:
        'Mostra quem receberia a notificação extrajudicial de uma cobrança (matriz, SPEs e, conforme o escopo, ' +
        'cedentes) e com quais títulos. NÃO gera o documento e NÃO envia: devolve o link para a pessoa gerar e enviar.',
      inputSchema: rascunharNotificacaoToolSchema,
      mutates: false,
      execute: (input, ctx) => rascunharNotificacao(input as z.infer<typeof rascunharNotificacaoToolSchema>, ctx),
    },
    {
      id: 'sinistro.checklist',
      name: 'Checklist do sinistro',
      description:
        'O que falta no dossiê de um sinistro (checklist da apólice, cl. 22208.00), com prazo de envio e indenização ' +
        'estimada. Somente leitura.',
      inputSchema: checklistSinistroToolSchema,
      mutates: false,
      execute: (input, ctx) => checklistSinistro(input as z.infer<typeof checklistSinistroToolSchema>, ctx),
    },
  ],
}
