import { lerCobrancaConfig, type CobrancaConfig, type Tables, type Views } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras das telas de GESTÃO da Cobrança (painel, sinistros, protestos, modelos,
 * settings). As da esteira de cobranças (kanban, detalhe, nova) moram em `queries.ts`,
 * de outra frente; as chaves ficam sob o mesmo prefixo `cobranca` para uma escrita de
 * lá poder invalidar o painel daqui com um só `invalidateQueries`.
 */
export const gestaoKeys = {
  all: ['cobranca'] as const,
  gestor: () => [...gestaoKeys.all, 'gestor'] as const,
  painel: () => [...gestaoKeys.all, 'painel'] as const,
  relogio: () => [...gestaoKeys.all, 'relogio'] as const,
  boletoTrocado: () => [...gestaoKeys.all, 'boleto-trocado'] as const,
  bloqueados: () => [...gestaoKeys.all, 'bloqueados'] as const,
  insolvencias: () => [...gestaoKeys.all, 'insolvencias'] as const,
  sinistros: () => [...gestaoKeys.all, 'sinistros'] as const,
  sinistro: (id: string) => [...gestaoKeys.all, 'sinistro', id] as const,
  titulosVencidos: () => [...gestaoKeys.all, 'titulos-vencidos'] as const,
  protestos: () => [...gestaoKeys.all, 'protestos'] as const,
  modelos: () => [...gestaoKeys.all, 'modelos'] as const,
  config: () => [...gestaoKeys.all, 'config'] as const,
  apolices: () => [...gestaoKeys.all, 'apolices'] as const,
}

// ─── Gestor ─────────────────────────────────────────────────────────────────

/** "Sou gestor?" — só para esconder botão. A RPC de cada escrita decide de verdade. */
export async function buscarSouGestor(): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_cobranca_gestor')
  if (error) return false
  return data === true
}

// ─── Painel (§12) ───────────────────────────────────────────────────────────

export interface PainelGestor {
  gestor: true
  aging: { faixa: string; valor: number; qtd: number }[]
  em_cobranca: number
  recuperado_mes: number
  recuperado_12m: number
  taxa_recuperacao: number | null
  sinistros: { estagio: string; qtd: number; indenizacao_estimada: number | null; proximo_prazo: string | null }[]
  protestos: { situacao: string; qtd: number; custas: number | null }[]
  custos: { aprovados: number; nao_aprovados: number }
}

export type Painel = PainelGestor | { gestor: false }

export async function buscarPainel(): Promise<Painel> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_cobranca_painel')
  if (error) throw new Error(error.message)
  const p = (data ?? { gestor: false }) as unknown as Painel
  return p
}

export type LinhaRelogio = Views<'apolice_relogio'>

/**
 * O relógio inteiro. Não há paginação de propósito: o bloco é a primeira coisa que o
 * gestor vê, e um título a 3 dias do D+90 escondido na página 2 é exatamente o erro
 * que o bloco existe para impedir. O teto só protege a tela de um backfill.
 */
export async function buscarRelogio(): Promise<LinhaRelogio[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('apolice_relogio')
    .select('*')
    .order('dias_restantes', { ascending: true, nullsFirst: false })
    .limit(3000)
  if (error) throw new Error(error.message)
  return (data ?? []) as LinhaRelogio[]
}

/*
 * Os status "boleto trocado" da produção. A plataforma não reporta a liquidação
 * desses títulos pelo sacado: um título assim pode estar pago e continuar "aberto"
 * aqui. O relógio marca cada um para ninguém notificar a seguradora de um pago.
 */
const STATUS_BOLETO_TROCADO = [
  'BILLET_SWAPPED',
  'EXPIRED_BILL_SWAPPED',
  'EXTENDED_BILL_SWAPPED',
  'IN_EXTENSION_BILL_SWAPPED',
]

export async function buscarTitulosBoletoTrocado(): Promise<Set<string>> {
  const supabase = createClient()
  const { data } = await supabase
    .from('titulos')
    .select('id')
    .eq('status', 'aberto')
    .in('status_producao', STATUS_BOLETO_TROCADO)
    .limit(5000)
  return new Set((data ?? []).map((t) => t.id))
}

// ─── Cadastro (razão social por CNPJ) ───────────────────────────────────────

/** Razão social dos CNPJs pedidos — a SPE raramente está em `empresas`. */
export async function buscarNomes(cnpjs: readonly string[]): Promise<Map<string, { razao_social: string | null; empresa_id: string | null }>> {
  const unicos = [...new Set(cnpjs.filter(Boolean))]
  if (!unicos.length) return new Map()
  const supabase = createClient()
  const { data } = await supabase.rpc('app_cobranca_cadastro', { p_cnpjs: unicos })
  return new Map((data ?? []).map((c) => [c.cnpj, { razao_social: c.razao_social, empresa_id: c.empresa_id }]))
}

// ─── Sacados bloqueados (§11) ───────────────────────────────────────────────

export interface GrupoBloqueado {
  sacado_matriz_cnpj: string
  razao_social: string | null
  empresa_id: string | null
  desde: string
  cnpjs: string[]
  cobrancas: Views<'cobranca_cards'>[]
  titulos: {
    id: string
    cobranca_id: string
    situacao: string
    quitado_em: string | null
    valor_recebido: number | null
    valor_face_snapshot: number
  }[]
  /** Títulos ainda não quitados nem retirados (quitação parcial não regulariza). */
  pendentes: number
  saldo_pendente: number
  total_recebido: number
  ultimo_pagamento: string | null
  protestos_a_retirar: {
    id: string
    cobranca_id: string | null
    situacao: string
    cartorio: string | null
    uf: string
  }[]
}

export async function buscarBloqueados(): Promise<GrupoBloqueado[]> {
  const supabase = createClient()
  const { data: bloqueios, error } = await supabase
    .from('cobranca_bloqueios_cnpj')
    .select('cnpj, sacado_matriz_cnpj, desde')
    .order('desde')
  if (error) throw new Error(error.message)
  if (!bloqueios?.length) return []

  const matrizes = [...new Set(bloqueios.map((b) => b.sacado_matriz_cnpj))]
  const [{ data: cards }, nomes] = await Promise.all([
    supabase.from('cobranca_cards').select('*').in('sacado_matriz_cnpj', matrizes).order('criada_em'),
    buscarNomes(matrizes),
  ])
  const cobrancas = (cards ?? []) as Views<'cobranca_cards'>[]
  const idsCobranca = cobrancas.map((c) => c.id).filter((id): id is string => id !== null)

  const [{ data: cts }, { data: remessas }] = idsCobranca.length
    ? await Promise.all([
        supabase
          .from('cobranca_titulos')
          .select('id, cobranca_id, situacao, quitado_em, valor_recebido, valor_face_snapshot')
          .in('cobranca_id', idsCobranca),
        supabase
          .from('protesto_remessas')
          .select('id, cobranca_id, uf')
          .eq('tipo', 'apresentacao')
          .in('cobranca_id', idsCobranca),
      ])
    : [{ data: [] }, { data: [] }]

  const idsRemessa = (remessas ?? []).map((r) => r.id)
  const { data: pts } = idsRemessa.length
    ? await supabase
        .from('protesto_titulos')
        .select('id, remessa_id, situacao, cartorio, instrucao_cancelamento_em, instrucao_nao_aplicavel_motivo')
        .in('remessa_id', idsRemessa)
        .in('situacao', ['enviado', 'apontado', 'protestado'])
        .is('instrucao_cancelamento_em', null)
    : { data: [] }
  const remessaPorId = new Map((remessas ?? []).map((r) => [r.id, r]))

  return matrizes.map((m) => {
    const doGrupo = bloqueios.filter((b) => b.sacado_matriz_cnpj === m)
    const cobs = cobrancas.filter((c) => c.sacado_matriz_cnpj === m)
    const ids = new Set(cobs.filter((c) => c.estagio !== 'cancelada').map((c) => c.id))
    const titulos = (cts ?? [])
      .filter((t) => ids.has(t.cobranca_id))
      .map((t) => ({ ...t, valor_face_snapshot: Number(t.valor_face_snapshot), valor_recebido: t.valor_recebido === null ? null : Number(t.valor_recebido) }))
    const pend = titulos.filter((t) => t.situacao !== 'quitado' && t.situacao !== 'retirado')
    const quitados = titulos.filter((t) => t.situacao === 'quitado')
    const protestos = (pts ?? [])
      .filter((p) => !p.instrucao_nao_aplicavel_motivo?.trim())
      .map((p) => ({ p, r: p.remessa_id ? remessaPorId.get(p.remessa_id) : undefined }))
      .filter(({ r }) => r && r.cobranca_id && cobs.some((c) => c.id === r.cobranca_id))
      .map(({ p, r }) => ({ id: p.id, cobranca_id: r!.cobranca_id, situacao: p.situacao, cartorio: p.cartorio, uf: r!.uf }))
    const nome = nomes.get(m)
    return {
      sacado_matriz_cnpj: m,
      razao_social: nome?.razao_social ?? cobs[0]?.sacado_razao_social ?? null,
      empresa_id: nome?.empresa_id ?? cobs[0]?.sacado_empresa_id ?? null,
      desde: doGrupo[0]?.desde ?? '',
      cnpjs: doGrupo.map((b) => b.cnpj),
      cobrancas: cobs,
      titulos,
      pendentes: pend.length,
      saldo_pendente: pend.reduce((s, t) => s + t.valor_face_snapshot, 0),
      total_recebido: quitados.reduce((s, t) => s + (t.valor_recebido ?? 0), 0),
      ultimo_pagamento: quitados.reduce<string | null>((max, t) => (t.quitado_em && (!max || t.quitado_em > max) ? t.quitado_em : max), null),
      protestos_a_retirar: protestos,
    }
  })
}

// ─── Insolvências ───────────────────────────────────────────────────────────

export type Insolvencia = Tables<'cobranca_insolvencias'> & { razao_social: string | null }

export async function buscarInsolvencias(): Promise<Insolvencia[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_insolvencias')
    .select('*')
    .order('confirmada')
    .order('data_decisao', { ascending: false })
  if (error) throw new Error(error.message)
  const nomes = await buscarNomes((data ?? []).map((i) => i.sacado_matriz_cnpj))
  return (data ?? []).map((i) => ({ ...i, razao_social: nomes.get(i.sacado_matriz_cnpj)?.razao_social ?? null }))
}

// ─── Sinistros (§7) ─────────────────────────────────────────────────────────

export type SinistroLinha = Tables<'sinistros'> & { sacado_razao_social: string | null; cobranca_codigo: string | null }

export async function buscarSinistros(): Promise<SinistroLinha[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sinistros')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  const idsCob = [...new Set(linhas.map((s) => s.cobranca_id).filter((x): x is string => !!x))]
  const [nomes, { data: cobs }] = await Promise.all([
    buscarNomes(linhas.map((s) => s.sacado_matriz_cnpj)),
    idsCob.length
      ? supabase.from('cobrancas').select('id, codigo').in('id', idsCob)
      : Promise.resolve({ data: [] as { id: string; codigo: string | null }[] }),
  ])
  const codigo = new Map((cobs ?? []).map((c) => [c.id, c.codigo]))
  return linhas.map((s) => ({
    ...s,
    sacado_razao_social: nomes.get(s.sacado_matriz_cnpj)?.razao_social ?? null,
    cobranca_codigo: s.cobranca_id ? (codigo.get(s.cobranca_id) ?? null) : null,
  }))
}

export interface SinistroTituloDetalhe {
  titulo_id: string
  valor_face: number
  valor_cedido: number | null
  numero: string | null
  externo_id: string | null
  sacado_cnpj: string | null
  sacado_nome: string | null
  cedente_nome: string | null
  vencimento: string | null
  coberto_apolice: boolean | null
  status: string | null
  status_producao: string | null
}

export interface NotificacaoProva {
  id: string
  papel: string
  destinatario_razao_social: string
  destinatario_cnpj: string
  rodada: number
  status: string
  enviada_em: string | null
  entregas: { id: string; canal: string; status: string; codigo_rastreio: string | null; comprovante_path: string | null; confirmado_em: string | null }[]
  tem_prova: boolean
}

export interface SinistroDetalhe {
  sinistro: Tables<'sinistros'>
  sacado_razao_social: string | null
  apolice: Tables<'apolices'> | null
  cobranca: { id: string; codigo: string | null; escopo_notificacao: string; estagio: string } | null
  titulos: SinistroTituloDetalhe[]
  documentos: Tables<'sinistro_documentos'>[]
  solicitacoes: Tables<'sinistro_solicitacoes'>[]
  custos: Tables<'sinistro_custos'>[]
  notificacoes: NotificacaoProva[]
  /** Soma do que já entrou por títulos quitados nas cobranças do grupo: sugestão de "pagamentos". */
  pagamentos_do_grupo: number
  limite_credito_vigente: number | null
}

export async function buscarSinistro(id: string): Promise<SinistroDetalhe | null> {
  const supabase = createClient()
  const { data: s, error } = await supabase.from('sinistros').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!s) return null

  const [st, docs, sols, custos, apolice, cobranca, nomes, cobsGrupo, limites] = await Promise.all([
    supabase.from('sinistro_titulos').select('titulo_id, valor_face, valor_cedido').eq('sinistro_id', id),
    supabase.from('sinistro_documentos').select('*').eq('sinistro_id', id).order('item'),
    supabase.from('sinistro_solicitacoes').select('*').eq('sinistro_id', id).order('solicitada_em', { ascending: false }),
    supabase.from('sinistro_custos').select('*').eq('sinistro_id', id).order('data', { ascending: false }),
    supabase.from('apolices').select('*').eq('id', s.apolice_id).maybeSingle(),
    s.cobranca_id
      ? supabase.from('cobrancas').select('id, codigo, escopo_notificacao, estagio').eq('id', s.cobranca_id).maybeSingle()
      : Promise.resolve({ data: null }),
    buscarNomes([s.sacado_matriz_cnpj]),
    supabase.from('cobrancas').select('id').eq('sacado_matriz_cnpj', s.sacado_matriz_cnpj),
    supabase
      .from('titulos')
      .select('limite_credito_vigente')
      .eq('sacado_matriz_cnpj', s.sacado_matriz_cnpj)
      .not('limite_credito_vigente', 'is', null)
      .order('limite_credito_vigente', { ascending: false })
      .limit(1),
  ])

  const idsTitulo = (st.data ?? []).map((t) => t.titulo_id).filter((x): x is string => !!x)
  const idsCobGrupo = (cobsGrupo.data ?? []).map((c) => c.id)
  const [tits, quitados, notifs] = await Promise.all([
    idsTitulo.length
      ? supabase
          .from('titulos')
          .select('id, numero, externo_id, sacado_cnpj, sacado_nome, cedente_nome, vencimento, coberto_apolice, status, status_producao')
          .in('id', idsTitulo)
      : Promise.resolve({ data: [] }),
    idsCobGrupo.length
      ? supabase.from('cobranca_titulos').select('valor_recebido').eq('situacao', 'quitado').in('cobranca_id', idsCobGrupo)
      : Promise.resolve({ data: [] as { valor_recebido: number | null }[] }),
    s.cobranca_id
      ? supabase
          .from('cobranca_notificacoes')
          .select(
            'id, papel, destinatario_razao_social, destinatario_cnpj, rodada, status, enviada_em, cobranca_notificacao_entregas(id, canal, status, codigo_rastreio, comprovante_path, confirmado_em)',
          )
          .eq('cobranca_id', s.cobranca_id)
          .in('status', ['enviada', 'entregue', 'respondida', 'falhou'])
          .order('rodada')
      : Promise.resolve({ data: [] }),
  ])

  const porId = new Map((tits.data ?? []).map((t) => [t.id, t]))
  const limite = limites.data?.[0]?.limite_credito_vigente

  return {
    sinistro: s,
    sacado_razao_social: nomes.get(s.sacado_matriz_cnpj)?.razao_social ?? null,
    apolice: apolice.data ?? null,
    cobranca: cobranca.data ?? null,
    titulos: (st.data ?? []).map((l) => {
      const t = l.titulo_id ? porId.get(l.titulo_id) : undefined
      return {
        titulo_id: l.titulo_id ?? '',
        valor_face: Number(l.valor_face),
        valor_cedido: l.valor_cedido === null ? null : Number(l.valor_cedido),
        numero: t?.numero ?? null,
        externo_id: t?.externo_id ?? null,
        sacado_cnpj: t?.sacado_cnpj ?? null,
        sacado_nome: t?.sacado_nome ?? null,
        cedente_nome: t?.cedente_nome ?? null,
        vencimento: t?.vencimento ?? null,
        coberto_apolice: t?.coberto_apolice ?? null,
        status: t?.status ?? null,
        status_producao: t?.status_producao ?? null,
      }
    }),
    documentos: docs.data ?? [],
    solicitacoes: sols.data ?? [],
    custos: custos.data ?? [],
    notificacoes: (notifs.data ?? []).map((n) => {
      const entregas = n.cobranca_notificacao_entregas ?? []
      return {
        id: n.id,
        papel: n.papel,
        destinatario_razao_social: n.destinatario_razao_social,
        destinatario_cnpj: n.destinatario_cnpj,
        rodada: n.rodada,
        status: n.status,
        enviada_em: n.enviada_em,
        entregas,
        tem_prova: entregas.some((e) => e.status === 'entregue'),
      }
    }),
    pagamentos_do_grupo: (quitados.data ?? []).reduce((acc, q) => acc + Number(q.valor_recebido ?? 0), 0),
    limite_credito_vigente: limite === null || limite === undefined ? null : Number(limite),
  }
}

export interface TituloVencido {
  id: string
  numero: string | null
  externo_id: string
  sacado_cnpj: string
  sacado_nome: string | null
  sacado_matriz_cnpj: string
  cedente_nome: string | null
  valor_face: number
  vencimento: string
  dias_atraso: number | null
  coberto_apolice: boolean
  cobranca_ativa_id: string | null
  cobranca_ativa_codigo: string | null
}

/** Os vencidos em aberto, para escolher o grupo e os títulos de um sinistro novo. */
export async function buscarTitulosVencidos(): Promise<TituloVencido[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_titulos_abertos')
    .select(
      'id, numero, externo_id, sacado_cnpj, sacado_nome, sacado_matriz_cnpj, cedente_nome, valor_face, vencimento, dias_atraso, coberto_apolice, cobranca_ativa_id, cobranca_ativa_codigo',
    )
    .gt('dias_atraso', 0)
    .order('vencimento')
    .limit(5000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((t) => ({
    id: t.id ?? '',
    numero: t.numero,
    externo_id: t.externo_id ?? '',
    sacado_cnpj: t.sacado_cnpj ?? '',
    sacado_nome: t.sacado_nome,
    sacado_matriz_cnpj: t.sacado_matriz_cnpj ?? '',
    cedente_nome: t.cedente_nome,
    valor_face: Number(t.valor_face ?? 0),
    vencimento: t.vencimento ?? '',
    dias_atraso: t.dias_atraso,
    coberto_apolice: t.coberto_apolice ?? true,
    cobranca_ativa_id: t.cobranca_ativa_id,
    cobranca_ativa_codigo: t.cobranca_ativa_codigo,
  }))
}

// ─── Protestos (§8) ─────────────────────────────────────────────────────────

export interface ProtestoLinha {
  id: string
  remessa_id: string | null
  situacao: string
  cartorio: string | null
  protocolo_cartorio: string | null
  data_protesto: string | null
  custas: number | null
  certidao_path: string | null
  motivo_rejeicao: string | null
  instrucao_cancelamento_em: string | null
  instrucao_nao_aplicavel_motivo: string | null
  atualizado_em: string
  uf: string | null
  cra: string | null
  cobranca_id: string | null
  cobranca_codigo: string | null
  sacado_razao_social: string | null
  cobranca_titulo_situacao: string | null
  titulo_numero: string | null
  valor_face: number | null
  /** Título quitado na cobrança e protesto ainda de pé sem instrução: dano moral em potencial. */
  retirada_pendente: boolean
}

export interface ProtestosGlobais {
  remessas: (Tables<'protesto_remessas'> & { cobranca_codigo: string | null; qtd_titulos: number })[]
  titulos: ProtestoLinha[]
}

export async function buscarProtestos(): Promise<ProtestosGlobais> {
  const supabase = createClient()
  const [{ data: remessas, error }, { data: pts }] = await Promise.all([
    supabase.from('protesto_remessas').select('*').order('criado_em', { ascending: false }).limit(1000),
    supabase.from('protesto_titulos').select('*').order('atualizado_em', { ascending: false }).limit(5000),
  ])
  if (error) throw new Error(error.message)

  const idsCob = [...new Set((remessas ?? []).map((r) => r.cobranca_id).filter((x): x is string => !!x))]
  const idsCt = [...new Set((pts ?? []).map((p) => p.cobranca_titulo_id).filter((x): x is string => !!x))]
  const [{ data: cards }, { data: cts }] = await Promise.all([
    idsCob.length
      ? supabase.from('cobranca_cards').select('id, codigo, sacado_razao_social').in('id', idsCob)
      : Promise.resolve({ data: [] as { id: string | null; codigo: string | null; sacado_razao_social: string | null }[] }),
    idsCt.length
      ? supabase.from('cobranca_titulos').select('id, situacao, valor_face_snapshot, titulo_id').in('id', idsCt)
      : Promise.resolve({ data: [] as { id: string; situacao: string; valor_face_snapshot: number; titulo_id: string }[] }),
  ])
  const idsTit = [...new Set((cts ?? []).map((c) => c.titulo_id))]
  const { data: tits } = idsTit.length
    ? await supabase.from('titulos').select('id, numero, externo_id').in('id', idsTit)
    : { data: [] as { id: string; numero: string | null; externo_id: string }[] }

  const cobPorId = new Map((cards ?? []).map((c) => [c.id, c]))
  const remPorId = new Map((remessas ?? []).map((r) => [r.id, r]))
  const ctPorId = new Map((cts ?? []).map((c) => [c.id, c]))
  const titPorId = new Map((tits ?? []).map((t) => [t.id, t]))

  const titulos: ProtestoLinha[] = (pts ?? []).map((p) => {
    const r = p.remessa_id ? remPorId.get(p.remessa_id) : undefined
    const cob = r?.cobranca_id ? cobPorId.get(r.cobranca_id) : undefined
    const ct = p.cobranca_titulo_id ? ctPorId.get(p.cobranca_titulo_id) : undefined
    const t = ct ? titPorId.get(ct.titulo_id) : undefined
    const aberto = ['enviado', 'apontado', 'protestado'].includes(p.situacao)
    return {
      id: p.id,
      remessa_id: p.remessa_id,
      situacao: p.situacao,
      cartorio: p.cartorio,
      protocolo_cartorio: p.protocolo_cartorio,
      data_protesto: p.data_protesto,
      custas: p.custas === null ? null : Number(p.custas),
      certidao_path: p.certidao_path,
      motivo_rejeicao: p.motivo_rejeicao,
      instrucao_cancelamento_em: p.instrucao_cancelamento_em,
      instrucao_nao_aplicavel_motivo: p.instrucao_nao_aplicavel_motivo,
      atualizado_em: p.atualizado_em,
      uf: r?.uf ?? null,
      cra: r?.cra ?? null,
      cobranca_id: r?.cobranca_id ?? null,
      cobranca_codigo: cob?.codigo ?? null,
      sacado_razao_social: cob?.sacado_razao_social ?? null,
      cobranca_titulo_situacao: ct?.situacao ?? null,
      titulo_numero: t?.numero ?? t?.externo_id ?? null,
      valor_face: ct ? Number(ct.valor_face_snapshot) : null,
      retirada_pendente:
        r?.tipo === 'apresentacao' &&
        aberto &&
        ct?.situacao === 'quitado' &&
        !p.instrucao_cancelamento_em &&
        !p.instrucao_nao_aplicavel_motivo?.trim(),
    }
  })

  return {
    remessas: (remessas ?? []).map((r) => ({
      ...r,
      cobranca_codigo: r.cobranca_id ? (cobPorId.get(r.cobranca_id)?.codigo ?? null) : null,
      qtd_titulos: (pts ?? []).filter((p) => p.remessa_id === r.id).length,
    })),
    titulos,
  }
}

// ─── Modelos (§5) ───────────────────────────────────────────────────────────

export async function buscarModelos(): Promise<Tables<'cobranca_modelos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_modelos')
    .select('*')
    .order('tipo')
    .order('familia_id')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Settings (§13) ─────────────────────────────────────────────────────────

export async function buscarCobrancaConfig(): Promise<CobrancaConfig> {
  const supabase = createClient()
  const { data, error } = await supabase.from('cobranca_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return lerCobrancaConfig(data ?? [])
}

export async function buscarApolices(): Promise<Tables<'apolices'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('apolices').select('*').order('vigencia_inicio', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Arquivos ───────────────────────────────────────────────────────────────

export async function urlAssinada(caminho: string): Promise<string | null> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from('cobrancas')
    .createSignedUrl(caminho, 300, { download: caminho.split('/').pop() ?? true })
  if (error) return null
  return data.signedUrl
}

/** SHA-256 no navegador: o hash que vai para o índice do dossiê é o do arquivo que subiu. */
async function sha256(arquivo: File): Promise<string | undefined> {
  try {
    const buf = await arquivo.arrayBuffer()
    const dig = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

/**
 * Upload no bucket privado `cobrancas`, sempre com `upsert: false`: o bucket não tem
 * política de UPDATE e o que foi para o dossiê não se sobrescreve. Timestamp no nome
 * para dois envios do mesmo arquivo conviverem.
 */
export async function subirArquivoCobranca(pasta: string, arquivo: File): Promise<{ caminho: string; hash?: string }> {
  const supabase = createClient()
  const caminho = `${pasta.replace(/\/$/, '')}/${Date.now()}-${arquivo.name.replace(/[^\w.\-]/g, '_')}`
  const [hash, up] = await Promise.all([
    sha256(arquivo),
    supabase.storage.from('cobrancas').upload(caminho, arquivo, { upsert: false }),
  ])
  if (up.error) throw new Error(up.error.message)
  return { caminho, hash }
}
