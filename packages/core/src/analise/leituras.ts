import type { Supabase } from '../registry/types.js'
import type { Json } from '../types/database.js'
import { montarConfigQualidade, type CapturaStatus, type ConfigQualidade, type EscopoAnalise, type ModoAnalise, type ProvedorAnalise, type StatusCalibracao, type TipoInteracao, type TipoPendencia, type TipoResposta, type VereditoContestacao } from './tipos.js'

/**
 * As leituras da Inteligência de Conversas, com o formato que as RPCs (0283c) devolvem.
 * Ficam no core porque duas portas as usam: as telas e as ferramentas da barra de IA —
 * e as duas precisam ver a mesma coisa, com a mesma regra de quem vê o quê (que está
 * no banco, não aqui).
 */

// ─── Formatos ───────────────────────────────────────────────────────────────

export interface ParticipanteDetectado {
  nome: string | null
  email: string | null
  falou: boolean
}

export interface SegmentoTranscricao {
  falante: string
  texto: string
  inicio_s: number | null
  fim_s: number | null
}

export interface ResumoAnalise {
  id: string
  score: number | null
  modo: ModoAnalise
  score_sombra: number | null
  itens_aplicaveis: number | null
  itens_atendidos: number | null
  explicacao: string | null
}

export interface ReuniaoCaptura {
  captura_ligada: boolean
  evento: {
    id: string
    inicio_em: string
    duracao_min: number
    meet_url: string | null
    modalidade: string
    cancelado: boolean
  }
  reuniao: {
    id: string
    captura_status: CapturaStatus
    dispensada_motivo: string | null
    bot_entrou_em: string | null
    alerta_sem_bot_em: string | null
    transcricao_recebida_em: string | null
    transcricao_expurgada_em: string | null
    transcricao: string | null
    segmentos: SegmentoTranscricao[] | null
    resumo: string | null
    resumo_origem: 'fireflies' | 'claude' | null
    proximos_passos: string[]
    participantes: ParticipanteDetectado[] | null
    duracao_s: number | null
    url_fireflies: string | null
  } | null
  resgate: {
    enviados: string[]
    na_fila: boolean
    ultimo: { status: string; pedido_em: string; erro: string | null } | null
  }
  analise: ResumoAnalise | null
}

export interface ItemAnalisado {
  id: string
  item_id: string
  chave: string
  etapa: string | null
  ordem: number
  rotulo: string
  pergunta: string
  orientacao_rubrica: string
  tipo_resposta: TipoResposta
  peso: number
  aplicavel: boolean
  resultado: string | null
  prob_atendido: number | null
  atendido: boolean | null
  em_sombra: boolean
  banda_cinzenta: boolean
  divergente: boolean
  revisao_pendente: boolean
  citacao: string | null
  orientacao: string | null
  provedor: ProvedorAnalise | null
  contestado: boolean
  corrigido_em: string | null
  contestacao: {
    id: string
    justificativa: string | null
    veredito: VereditoContestacao | null
    resposta_gestor: string | null
    criada_em: string
    revisada_em: string | null
  } | null
  /** Só para gestor. */
  rotulo_humano: { aplicavel: boolean; atendido: boolean | null; resultado: string | null; origem: string } | null
}

export interface MensagemJanelaLida {
  id: string
  direcao: 'entrada' | 'saida'
  corpo: string | null
  assunto: string | null
  criado_em: string
  por_ia: boolean
}

export interface AnaliseDetalhe {
  analise: {
    id: string
    escopo: EscopoAnalise
    modo: ModoAnalise
    score: number | null
    score_sombra: number | null
    itens_aplicaveis: number | null
    itens_atendidos: number | null
    explicacao: string | null
    analisada_em: string
    publicada_em: string | null
    provedor: ProvedorAnalise
    caiu_para_claude: boolean
    custo_centavos: number | null
    rubrica_id: string
    rubrica_versao: number
    tipo_interacao: TipoInteracao
    rubrica_ativa: boolean
  }
  empresa: { id: string; nome: string | null } | null
  contato: { id: string; nome: string | null; cargo: string | null } | null
  vendedor: { id: string; nome: string; is_ia: boolean } | null
  pode_contestar: boolean
  interacao: {
    // reunião
    evento_id?: string
    titulo?: string | null
    inicio_em?: string
    venda_id?: string | null
    sdr_lead_id?: string | null
    url_fireflies?: string | null
    resumo?: string | null
    duracao_s?: number | null
    proximos_passos?: string[]
    participantes?: ParticipanteDetectado[] | null
    texto?: string | null
    // ligação
    telefone?: string | null
    iniciada_em?: string | null
    outcome?: string | null
    gravacao?: string | null
    turnos?: unknown
    // janela
    conversa_id?: string
    canal?: string
    identificador?: string
    inicio?: string | null
    fim?: string | null
    mensagens_qtd?: number | null
    mensagens?: MensagemJanelaLida[] | null
  } | null
  itens: ItemAnalisado[]
}

export interface FaltaFeedback {
  id: string
  chave: string
  rotulo: string
  etapa: string | null
  pergunta: string
  citacao: string | null
  orientacao: string
  contestado: boolean
  veredito: VereditoContestacao | null
}

export interface PendenciaQualidade {
  id: string
  tipo: TipoPendencia
  descricao: string
  citacao: string | null
  prazo_em: string | null
  criada_em: string
  empresa_id: string | null
  empresa_nome: string | null
  conversa_id: string | null
  analise_id: string
  evento_id: string | null
}

export interface Feedback {
  vendedor: { id: string; nome: string; is_ia: boolean; tipo: string }
  resumo: { analises: number; nota_media: number | null; sem_avaliacao: number }
  em_sombra: number
  ultimas: Array<{
    id: string
    escopo: EscopoAnalise
    score: number | null
    explicacao: string | null
    itens_aplicaveis: number | null
    itens_atendidos: number | null
    analisada_em: string
    rubrica_versao: number
    tipo_interacao: TipoInteracao
    empresa_nome: string | null
    empresa_id: string | null
    faltas: FaltaFeedback[]
  }>
  piores_itens: Array<{
    chave: string
    rotulo: string
    etapa: string | null
    orientacao: string
    aplicaveis: number
    atendidos: number
    taxa: number
  }>
  pendencias: PendenciaQualidade[]
  evolucao: Array<{
    tipo_interacao: TipoInteracao
    versao: number
    semana: string
    etapa: string
    taxa: number | null
    analises: number
  }>
}

export interface Agregado {
  por_vendedor: Array<{
    vendedor_id: string
    nome: string
    is_ia: boolean
    tipo: string
    analises: number
    em_sombra: number
    nota_media: number | null
    nota_reuniao: number | null
    nota_ligacao: number | null
    nota_conversa: number | null
    pendencias_abertas: number
  }>
  por_etapa: Array<{ tipo_interacao: TipoInteracao; etapa: string; is_ia: boolean | null; taxa: number | null; itens: number }>
  objecoes: Array<{ objecao: string; n: number }>
  concorrentes: Array<{ analise_id: string; analisada_em: string; empresa_id: string | null; empresa_nome: string | null; vendedor: string | null }>
  evolucao: Array<{ semana: string; is_ia: boolean; nota_media: number | null; analises: number }>
  contestacao_por_item: Array<{
    chave: string
    rotulo: string
    tipo_interacao: TipoInteracao
    avaliados: number
    contestados: number
    taxa: number | null
    procedentes: number
    precisa_revisao: boolean
  }>
  custo: Array<{
    mes: string
    analises: number
    jev_centavos: number
    claude_centavos: number
    caiu_para_claude: number
    itens_claude: number
    itens_jev: number
    itens_banda_cinzenta: number
  }>
  fila: Record<string, number> | null
}

export interface ContestacaoFila {
  id: string
  analise_id: string
  analise_item_id: string
  justificativa: string | null
  criada_em: string
  veredito: VereditoContestacao | null
  resposta_gestor: string | null
  rotulo_humano: string | null
  revisada_em: string | null
  contestado_por: string | null
  vendedor: string | null
  escopo: EscopoAnalise
  empresa_nome: string | null
  chave: string
  rotulo: string
  pergunta: string
  etapa: string | null
  atendido: boolean | null
  aplicavel: boolean
  citacao: string | null
  orientacao: string | null
  prob_atendido: number | null
  provedor: ProvedorAnalise | null
}

export interface FilaRotulagem {
  rotuladas: number
  fila: Array<{
    id: string
    escopo: EscopoAnalise
    modo: ModoAnalise
    analisada_em: string
    rubrica_versao: number
    empresa_nome: string | null
    vendedor_nome: string | null
    rotulos_feitos: number
  }>
}

export interface PainelVinculacao {
  por_etapa: Record<string, number>
  nao_resolviveis: number
  custo_centavos: number
  auditoria: Array<{ mes: string; auditadas: number; corretas: number }>
  amostra: Array<{
    id: string
    etapa: string
    probabilidade: number | null
    motivo: string | null
    criada_em: string
    canal: string
    identificador_externo: string
    nome_sugerido: string | null
    empresa_nome: string | null
    cnpj: string | null
  }>
  fila_humana: Array<{
    id: string
    canal: string
    identificador_externo: string
    nome_sugerido: string | null
    qtd_mensagens: number
    ultima_mensagem_em: string
    motivo: string | null
    nao_resolvivel: boolean
    candidatas: Array<{ empresa_id: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string; valor: number | null }>
  }>
}

export interface SeloNota {
  analise_id: string
  score: number | null
  escopo: EscopoAnalise
  analisada_em: string
  itens_aplicaveis: number | null
  itens_atendidos: number | null
  explicacao: string | null
}

export interface RubricaLida {
  id: string
  tipo_interacao: TipoInteracao
  nome: string
  versao: number
  ativa: boolean
  ativada_em: string | null
  calibrada_em: string | null
  recalibrar_pedido_em: string | null
  descricao: string | null
  criada_em: string
  itens: Array<{
    id: string
    ordem: number
    chave: string
    etapa: string | null
    rotulo: string
    pergunta: string
    tipo_resposta: TipoResposta
    opcoes: string[] | null
    atende: string[] | null
    peso: number
    condicao_aplicabilidade: string | null
    limiar: number | null
    limiar_origem: 'calibracao' | 'override' | null
    limiar_override_motivo: string | null
    status_calibracao: StatusCalibracao
    f1: number | null
    precisao: number | null
    recall: number | null
    n_amostras: number | null
    calibracao: { curva?: Array<{ limiar: number; precisao: number; recall: number; f1: number; apontadas: number }>; motivo?: string; n_faltas?: number } | null
    calibrado_em: string | null
    orientacao: string
    gera_pendencia: TipoPendencia | null
    precisa_revisao: boolean
    ativo: boolean
  }>
}

// ─── Leituras ───────────────────────────────────────────────────────────────

async function rpc<T>(s: Supabase, nome: string, p: unknown): Promise<T> {
  const { data, error } = await s.rpc(nome as never, { p: p as Json } as never)
  if (error) throw new Error(error.message)
  return data as T
}

export const lerReuniaoCaptura = (s: Supabase, eventoId: string) =>
  rpc<ReuniaoCaptura | null>(s, 'app_reuniao_captura', { evento_id: eventoId })

export const lerAnalise = (s: Supabase, analiseId: string, incluirTexto = false) =>
  rpc<AnaliseDetalhe | null>(s, 'app_qualidade_analise', { analise_id: analiseId, incluir_texto: incluirTexto })

export const lerFeedback = (s: Supabase, a: { vendedor_id?: string | null; dias?: number; limite?: number } = {}) =>
  rpc<Feedback | null>(s, 'app_qualidade_feedback', a)

export const lerAgregado = (s: Supabase, dias = 90) => rpc<Agregado>(s, 'app_qualidade_agregado', { dias })

export const lerContestacoes = (s: Supabase, abertas = true) =>
  rpc<ContestacaoFila[]>(s, 'app_qualidade_contestacoes', { abertas })

export const lerParaRotular = (s: Supabase, tipo: TipoInteracao, limite = 30) =>
  rpc<FilaRotulagem>(s, 'app_qualidade_para_rotular', { tipo_interacao: tipo, limite })

export const lerVinculacao = (s: Supabase, dias = 30) => rpc<PainelVinculacao>(s, 'app_qualidade_vinculacao', { dias })

export const lerSelo = (s: Supabase, alvo: { empresa_id?: string; conversa_id?: string; evento_id?: string }) =>
  rpc<SeloNota | null>(s, 'app_qualidade_selo', alvo)

export const lerSugestoesCadastro = (s: Supabase, empresaId: string) =>
  rpc<Array<{ id: string; campo: string; valor_atual: string | null; valor_sugerido: string; contato_id: string | null; contato_nome: string | null; analise_id: string | null; criada_em: string }>>(
    s,
    'app_empresa_sugestoes',
    { empresa_id: empresaId },
  )

export async function lerConfigQualidade(s: Supabase): Promise<ConfigQualidade> {
  const { data, error } = await s.from('qualidade_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return montarConfigQualidade(data ?? [])
}

export async function lerRubricas(s: Supabase, tipo?: TipoInteracao): Promise<RubricaLida[]> {
  let q = s
    .from('rubricas')
    .select(
      'id, tipo_interacao, nome, versao, ativa, ativada_em, calibrada_em, recalibrar_pedido_em, descricao, criada_em, itens:rubrica_itens(id, ordem, chave, etapa, rotulo, pergunta, tipo_resposta, opcoes, atende, peso, condicao_aplicabilidade, limiar, limiar_origem, limiar_override_motivo, status_calibracao, f1, precisao, recall, n_amostras, calibracao, calibrado_em, orientacao, gera_pendencia, precisa_revisao, ativo)',
    )
    .order('tipo_interacao')
    .order('versao', { ascending: false })
  if (tipo) q = q.eq('tipo_interacao', tipo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    ...(r as unknown as RubricaLida),
    itens: [...((r as unknown as RubricaLida).itens ?? [])].sort((a, b) => a.ordem - b.ordem),
  }))
}

export async function lerPessoasQualidade(s: Supabase) {
  const { data, error } = await s.rpc('app_qualidade_pessoas')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function lerSegredosQualidade(s: Supabase) {
  const { data, error } = await s.rpc('app_qualidade_segredos')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** A nota como se lê na tela: "0,62". Nula é "sem avaliação aplicável", nunca zero. */
export function formatarNota(score: number | null | undefined): string {
  if (score === null || score === undefined) return '—'
  return score.toFixed(2).replace('.', ',')
}
