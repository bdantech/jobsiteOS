/**
 * O drill-down do report semanal (04u §4): o catálogo.
 *
 * Padrão único para o report inteiro — clicou num número, abre a lista dos registros que o
 * formam. Os registros vêm de `app_report_detalhe()` no banco; o que mora AQUI é o que
 * precisa ser igual na tela, no CSV e no link do PDF: o título, a REGRA do número (coorte,
 * janela ou estoque, e de qual período), as colunas, e o valor que o report exibe para
 * aquele recorte — que é contra o que o total da lista é conferido.
 *
 * `jsonb` não guarda a ordem das chaves, então a ordem das colunas não pode vir do banco:
 * ela é declarada aqui.
 */
import {
  CAMPO_DO_FATO,
  FIT_AQUISICAO_LABELS,
  ORIGEM_AQUISICAO_LABELS,
  totalDoBloco,
  type FatoReuniao,
  type FitAquisicao,
  type OrigemAquisicao,
} from './aquisicao.js'
import { ETAPA_FUNIL_LABELS, type EtapaFunil, type ReportSemanal } from './semanal.js'

// ─── Coorte × janela × estoque ──────────────────────────────────────────────

/**
 * Todo número do report declara o que é (04u §1).
 *
 *   coorte .... um grupo fixado pela data de ENTRADA, acompanhado até hoje
 *   janela .... eventos que ACONTECERAM no período, de gente de qualquer época
 *   estoque ... o que EXISTE num instante; não tem "o da semana", tem "o de tal dia"
 *
 * "Realizados 3" (coorte) ao lado de "Reuniões realizadas 32" (janela) sem essa palavra faz
 * qualquer gestor concluir que o report está quebrado. Os dois estão certos.
 */
export type NaturezaNumero = 'coorte' | 'janela' | 'estoque'

export const NATUREZA_LABELS: Record<NaturezaNumero, string> = {
  coorte: 'Coorte',
  janela: 'Janela',
  estoque: 'Estoque',
}

export const NATUREZA_EXPLICA: Record<NaturezaNumero, string> = {
  coorte: 'Coorte — dos leads distribuídos nesta semana, até onde chegaram',
  janela: 'Na semana, independentemente de quando o lead entrou',
  estoque: 'Estoque — o que existia na data do retrato',
}

// ─── O catálogo ─────────────────────────────────────────────────────────────

export const CHAVES_DETALHE = [
  'volume_convertido', 'vop_operado', 'receita', 'limite_ocioso',
  'funil_etapa', 'fit_avaliados', 'reunioes_realizadas', 'no_shows', 'mous', 'ciclo',
  'nf_faixa', 'nf_capturadas', 'nf_expiradas', 'nf_travadas',
  'contas_paradas', 'carteira_gestor', 'cert_balde', 'cert_topo',
  'time_vendedor', 'atencao', 'aq_leads', 'aq_reunioes',
] as const
export type ChaveDetalhe = (typeof CHAVES_DETALHE)[number]

export type ParamsDetalhe = Record<string, string>

/** O que identifica UM número clicável: a chave, os parâmetros e, se não for a do report, a semana. */
export interface AlvoDetalhe {
  chave: ChaveDetalhe
  params?: ParamsDetalhe
  /** Só quando a semana NÃO é a do report aberto — as células do histórico de Aquisição. */
  inicio?: string
  fim?: string
}

export type TipoColuna = 'texto' | 'brl' | 'numero' | 'data' | 'datahora' | 'link'

export interface ColunaDetalhe {
  chave: string
  rotulo: string
  tipo?: TipoColuna
}

export interface ContextoDetalhe {
  inicio: string
  fim: string
  /** A data em que os estoques foram lidos. */
  retrato: string
  params: ParamsDetalhe
}

export interface DefDetalhe {
  titulo: (p: ParamsDetalhe) => string
  natureza: NaturezaNumero
  /** A frase que vai no cabeçalho do modal, para a lista poder ser conferida contra o total. */
  regra: (c: ContextoDetalhe) => string
  colunas: ColunaDetalhe[]
  /** O que se compara com o número clicado: a CONTAGEM de linhas ou a SOMA de um valor. */
  medida: 'total' | 'soma'
}

const dm = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a?.slice(2) ?? ''}`
}
const periodo = (c: ContextoDetalhe) => `${dm(c.inicio)} a ${dm(c.fim)}`

const FAIXA_LABELS: Record<string, string> = {
  alta: 'Alta', boa: 'Boa', media: 'Média', sem_faixa: 'Sem faixa',
}

export const ATENCAO_LABELS: Record<string, string> = {
  limites_reduzidos: 'Limites reduzidos pela seguradora',
  protestos_novos: 'Protestos novos em clientes',
  certificados_vencendo_30d: 'Certificados vencendo em 30 dias',
  processos_com_movimento: 'Processos com movimentação relevante',
  lotes_aguardando: 'Lotes de enriquecimento aguardando aprovação',
  sugestoes_perfil_pendentes: 'Sugestões do Perfil pendentes',
  ex_clientes_sem_motivo: 'Ex-clientes sem motivo registrado',
  fornecedores_sem_contato: 'Fornecedores sem contato',
  antecipacoes_travadas: 'Antecipações travadas',
}

/** Quatro itens de "Exige atenção" são evento da semana; os outros são fila acumulada. */
const ATENCAO_DE_JANELA = new Set([
  'limites_reduzidos', 'protestos_novos', 'processos_com_movimento', 'ex_clientes_sem_motivo',
])

const BALDE_LABELS: Record<string, string> = {
  validos: 'Certificados válidos',
  vencendo: 'Certificados vencendo em 30 dias',
  sem: 'Contas sem certificado',
}

export const FATO_REUNIAO_LABELS: Record<FatoReuniao, string> = {
  agendada: 'Reuniões agendadas na semana',
  realizada: 'Reuniões realizadas na semana',
  cancelada: 'Reuniões canceladas na semana',
  remarcada: 'Reuniões remarcadas na semana',
  no_show: 'No-shows da semana',
  sem_captura: 'Realizadas sem captura',
  sem_desfecho: 'Reuniões sem desfecho registrado',
}

const REGRA_DO_FATO: Record<FatoReuniao, string> = {
  agendada: 'reuniões MARCADAS no período, aconteçam quando acontecerem. Remarcar não conta de novo',
  realizada: 'reuniões que ACONTECERAM no período, com transcrição ou desfecho registrado, marcadas quando tenham sido',
  cancelada: 'reuniões canceladas no período',
  remarcada: 'remarcações feitas no período',
  no_show: 'leads marcados como no-show no período',
  sem_captura: 'reuniões realizadas no período sem transcrição do Fireflies e sem o gravador na chamada',
  sem_desfecho: 'reuniões cuja hora passou no período e ninguém registrou realização nem no-show',
}

const COLUNAS_OPERACAO: ColunaDetalhe[] = [
  { chave: 'cedente', rotulo: 'Cedente' },
  { chave: 'sacado', rotulo: 'Sacado' },
  { chave: 'nf', rotulo: 'NF' },
  { chave: 'valor', rotulo: 'Valor cedido', tipo: 'brl' },
  { chave: 'convertida_em', rotulo: 'Convertida em', tipo: 'data' },
  { chave: 'responsavel', rotulo: 'Responsável' },
]

const COLUNAS_NF: ColunaDetalhe[] = [
  { chave: 'nf', rotulo: 'NF' },
  { chave: 'sacado', rotulo: 'Sacado' },
  { chave: 'fornecedor', rotulo: 'Fornecedor' },
  { chave: 'valor', rotulo: 'Valor', tipo: 'brl' },
  { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
  { chave: 'estagio', rotulo: 'Estágio' },
  { chave: 'capturada_em', rotulo: 'Capturada em', tipo: 'data' },
]

const COLUNAS_CARTEIRA: ColunaDetalhe[] = [
  { chave: 'cliente', rotulo: 'Cliente' },
  { chave: 'gestor', rotulo: 'Gestor' },
  { chave: 'ocioso', rotulo: 'Ocioso', tipo: 'brl' },
  { chave: 'limite', rotulo: 'Limite', tipo: 'brl' },
  { chave: 'ultima_operacao', rotulo: 'Última operação', tipo: 'data' },
  { chave: 'dias_sem_operar', rotulo: 'Dias sem operar', tipo: 'numero' },
  { chave: 'volume_acumulado', rotulo: 'Volume acumulado', tipo: 'brl' },
  { chave: 'status', rotulo: 'Status' },
]

export const DETALHES: Record<ChaveDetalhe, DefDetalhe> = {
  volume_convertido: {
    titulo: () => 'Volume convertido',
    natureza: 'janela',
    regra: (c) => `Operações convertidas de ${periodo(c)}. O número é a soma do valor cedido.`,
    colunas: COLUNAS_OPERACAO,
    medida: 'soma',
  },
  vop_operado: {
    titulo: () => 'VOP operado',
    natureza: 'janela',
    regra: (c) =>
      `Operações convertidas de ${periodo(c)}. VOP = valor cedido × dias de antecipação ÷ dias de referência; o número é a soma.`,
    colunas: [
      { chave: 'cedente', rotulo: 'Cedente' },
      { chave: 'sacado', rotulo: 'Sacado' },
      { chave: 'nf', rotulo: 'NF' },
      { chave: 'valor', rotulo: 'Valor cedido', tipo: 'brl' },
      { chave: 'dias', rotulo: 'Dias', tipo: 'numero' },
      { chave: 'vop', rotulo: 'VOP', tipo: 'brl' },
      { chave: 'convertida_em', rotulo: 'Convertida em', tipo: 'data' },
    ],
    medida: 'soma',
  },
  receita: {
    titulo: () => 'Receita gerada',
    natureza: 'janela',
    regra: (c) =>
      `Operações convertidas de ${periodo(c)}. A receita é o spread total de cada operação; a plataforma não o envia separado em juros e TAC.`,
    colunas: [
      { chave: 'cedente', rotulo: 'Cedente' },
      { chave: 'sacado', rotulo: 'Sacado' },
      { chave: 'nf', rotulo: 'NF' },
      { chave: 'valor', rotulo: 'Valor cedido', tipo: 'brl' },
      { chave: 'receita', rotulo: 'Receita (spread)', tipo: 'brl' },
      { chave: 'taxa_am', rotulo: 'Taxa a.m. (%)', tipo: 'numero' },
      { chave: 'dias', rotulo: 'Dias', tipo: 'numero' },
      { chave: 'retencao', rotulo: 'Retenção', tipo: 'brl' },
      { chave: 'liquido', rotulo: 'Líquido', tipo: 'brl' },
      { chave: 'convertida_em', rotulo: 'Convertida em', tipo: 'data' },
    ],
    medida: 'soma',
  },
  limite_ocioso: {
    titulo: () => 'Limite ocioso',
    natureza: 'estoque',
    regra: (c) => `Sacados com limite disponível em ${dm(c.retrato)}. O número é a soma do ocioso.`,
    colunas: [
      { chave: 'cliente', rotulo: 'Sacado' },
      { chave: 'limite', rotulo: 'Limite aprovado', tipo: 'brl' },
      { chave: 'utilizado', rotulo: 'Utilizado', tipo: 'brl' },
      { chave: 'ocioso', rotulo: 'Ocioso', tipo: 'brl' },
      { chave: 'aprovado_em', rotulo: 'Aprovado em', tipo: 'data' },
      { chave: 'dias_sem_operar', rotulo: 'Dias sem operar', tipo: 'numero' },
    ],
    medida: 'soma',
  },
  funil_etapa: {
    titulo: (p) => `Funil — ${ETAPA_FUNIL_LABELS[p.etapa as EtapaFunil] ?? p.etapa}`,
    natureza: 'coorte',
    regra: (c) =>
      `Dos leads distribuídos de ${periodo(c)}, os que chegaram a "${ETAPA_FUNIL_LABELS[c.params.etapa as EtapaFunil] ?? c.params.etapa}" até hoje.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'origem', rotulo: 'Origem' },
      { chave: 'distribuido_em', rotulo: 'Distribuído em', tipo: 'data' },
      { chave: 'estagio', rotulo: 'Estágio atual' },
      { chave: 'fit', rotulo: 'Fit' },
      { chave: 'reuniao_em', rotulo: 'Reunião', tipo: 'datahora' },
      { chave: 'responsavel', rotulo: 'Responsável' },
    ],
    medida: 'total',
  },
  fit_avaliados: {
    titulo: () => 'Taxa de fit — leads avaliados',
    natureza: 'janela',
    regra: (c) =>
      `Leads cujo fit foi definido de ${periodo(c)}, tenham entrado quando tenham entrado. A taxa é com fit ÷ avaliados.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'origem', rotulo: 'Origem' },
      { chave: 'fit', rotulo: 'Veredito' },
      { chave: 'motivo', rotulo: 'Motivo' },
      { chave: 'avaliado_em', rotulo: 'Avaliado em', tipo: 'datahora' },
      { chave: 'avaliador', rotulo: 'Quem avaliou' },
      { chave: 'distribuido_em', rotulo: 'Entrou em', tipo: 'data' },
    ],
    medida: 'total',
  },
  reunioes_realizadas: {
    titulo: () => 'Reuniões realizadas',
    natureza: 'janela',
    regra: (c) =>
      `Mudanças de estágio para "reunião realizada" ou "qualificada" de ${periodo(c)}. Conta TRANSIÇÕES: o lead que passa pelas duas na mesma semana aparece duas vezes.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'de', rotulo: 'De' },
      { chave: 'para', rotulo: 'Para' },
      { chave: 'quando', rotulo: 'Quando', tipo: 'datahora' },
      { chave: 'condutor', rotulo: 'Quem conduziu' },
      { chave: 'transcricao', rotulo: 'Transcrição', tipo: 'link' },
    ],
    medida: 'total',
  },
  no_shows: {
    titulo: () => 'No-shows não remarcados',
    natureza: 'estoque',
    regra: (c) => `Leads cujo último estágio em ${dm(c.retrato)} era no-show, sem reagendamento e sem encerramento.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'origem', rotulo: 'Origem' },
      { chave: 'reuniao_em', rotulo: 'Reunião era', tipo: 'datahora' },
      { chave: 'no_show_em', rotulo: 'No-show em', tipo: 'data' },
      { chave: 'condutor', rotulo: 'Vendedor' },
      { chave: 'responsavel', rotulo: 'SDR' },
    ],
    medida: 'total',
  },
  mous: {
    titulo: () => 'MOUs',
    natureza: 'janela',
    regra: (c) => `Vendas que passaram para MOU assinado ou onboarding de ${periodo(c)}.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'de', rotulo: 'De' },
      { chave: 'para', rotulo: 'Para' },
      { chave: 'quando', rotulo: 'Quando', tipo: 'datahora' },
      { chave: 'responsavel', rotulo: 'Vendedor' },
    ],
    medida: 'total',
  },
  ciclo: {
    titulo: () => 'Ciclo 1º contato → 1ª operação',
    natureza: 'estoque',
    regra: (c) =>
      `Todos os negócios que completaram o ciclo até ${dm(c.retrato)} — acumulado, não só os da semana. O número é a média da duração.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'primeiro_contato', rotulo: '1º contato', tipo: 'data' },
      { chave: 'primeira_operacao', rotulo: '1ª operação', tipo: 'data' },
      { chave: 'duracao_dias', rotulo: 'Duração (dias)', tipo: 'numero' },
      { chave: 'responsavel', rotulo: 'Vendedor' },
    ],
    medida: 'total',
  },
  nf_faixa: {
    titulo: (p) =>
      `NFs — faixa ${FAIXA_LABELS[p.faixa ?? ''] ?? p.faixa} · ${p.serie === 'doze' ? '12 meses' : 'semana'}`,
    natureza: 'coorte',
    regra: (c) =>
      c.params.serie === 'doze'
        ? `Notas da faixa capturadas nos 12 meses até ${dm(c.fim)}. A barra é quantas delas já converteram.`
        : `Notas da faixa capturadas de ${periodo(c)}. A barra é quantas delas já converteram.`,
    colunas: COLUNAS_NF,
    medida: 'total',
  },
  nf_capturadas: {
    titulo: () => 'NFs capturadas',
    natureza: 'janela',
    regra: (c) => `Notas que entraram no sistema de ${periodo(c)}.`,
    colunas: COLUNAS_NF,
    medida: 'total',
  },
  nf_expiradas: {
    titulo: () => 'Expirou sem trabalho',
    natureza: 'janela',
    regra: (c) => `Notas que passaram para "expirada" de ${periodo(c)}, da maior para a menor. O número é a soma do valor.`,
    colunas: [
      { chave: 'nf', rotulo: 'NF' },
      { chave: 'sacado', rotulo: 'Sacado' },
      { chave: 'fornecedor', rotulo: 'Fornecedor' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'brl' },
      { chave: 'vencimento', rotulo: 'Vencimento', tipo: 'data' },
      { chave: 'estagio_em', rotulo: 'Expirou em', tipo: 'data' },
      { chave: 'faixa', rotulo: 'Faixa' },
    ],
    medida: 'soma',
  },
  nf_travadas: {
    titulo: () => 'Antecipações travadas',
    natureza: 'estoque',
    regra: (c) => `Antecipações abertas e paradas há 3 dias ou mais em ${dm(c.retrato)}. O cedente abriu e não concluiu.`,
    colunas: [
      { chave: 'cedente', rotulo: 'Cedente' },
      { chave: 'sacado', rotulo: 'Sacado' },
      { chave: 'nf', rotulo: 'NF' },
      { chave: 'status', rotulo: 'Status' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'brl' },
      { chave: 'dias_parada', rotulo: 'Dias parada', tipo: 'numero' },
    ],
    medida: 'total',
  },
  contas_paradas: {
    titulo: () => 'Carteiras que não estão performando',
    natureza: 'estoque',
    regra: (c) =>
      `As 25 maiores em ${dm(c.retrato)}: ocioso acima de R$ 50 mil, com 30 dias sem operar ou apontamento do temperature report.`,
    colunas: COLUNAS_CARTEIRA,
    medida: 'total',
  },
  carteira_gestor: {
    titulo: (p) => `Carteira parada — ${p.gestor ?? 'Sem gestor'}`,
    natureza: 'estoque',
    regra: (c) =>
      `Das 25 maiores contas paradas em ${dm(c.retrato)}, as deste gestor. A barra é a soma do ocioso delas.`,
    colunas: COLUNAS_CARTEIRA,
    medida: 'soma',
  },
  cert_balde: {
    titulo: (p) => BALDE_LABELS[p.balde ?? ''] ?? 'Certificados',
    natureza: 'estoque',
    regra: (c) =>
      c.params.balde === 'validos'
        ? `CNPJs com certificado válido e ao menos 30 dias de folga em ${dm(c.retrato)}.`
        : c.params.balde === 'vencendo'
          ? `CNPJs com certificado válido em ${dm(c.retrato)} que vence nos 30 dias seguintes.`
          : `CNPJs sem certificado, ou com ele já vencido, em ${dm(c.retrato)}. A NF escondida é estimativa e só aparece na matriz.`,
    colunas: [
      { chave: 'conta', rotulo: 'Conta' },
      { chave: 'cnpj', rotulo: 'CNPJ' },
      { chave: 'tipo', rotulo: 'Matriz / SPE' },
      { chave: 'validade', rotulo: 'Validade', tipo: 'data' },
      { chave: 'nf_escondida_mes', rotulo: 'NF escondida / mês', tipo: 'brl' },
    ],
    medida: 'total',
  },
  cert_topo: {
    titulo: () => 'As maiores sem certificado',
    natureza: 'estoque',
    regra: (c) =>
      `As contas sem nenhum certificado em ${dm(c.retrato)}, pelo que escondem. O valor é estimado a partir do faturamento.`,
    colunas: [
      { chave: 'grupo', rotulo: 'Conta' },
      { chave: 'cnpjs_no_grupo', rotulo: 'CNPJs', tipo: 'numero' },
      { chave: 'cnpjs_sem_certificado', rotulo: 'Sem certificado', tipo: 'numero' },
      { chave: 'faturamento_estimado', rotulo: 'Faturamento estimado', tipo: 'brl' },
      { chave: 'faturamento_origem', rotulo: 'Origem do faturamento' },
      { chave: 'invisivel_mes', rotulo: 'Invisível por mês', tipo: 'brl' },
    ],
    medida: 'soma',
  },
  time_vendedor: {
    titulo: (p) => `Time — ${p.nome ?? 'conversões'}`,
    natureza: 'janela',
    regra: (c) =>
      `Lançamentos de comissão desta pessoa de ${periodo(c)}. É a ATRIBUIÇÃO, não o total operado: conta sem vendedor opera e não gera lançamento. A barra é a soma do VOP.`,
    colunas: [
      { chave: 'cedente', rotulo: 'Cedente' },
      { chave: 'nf', rotulo: 'NF' },
      { chave: 'papel', rotulo: 'Papel' },
      { chave: 'valor_cedido', rotulo: 'Valor cedido', tipo: 'brl' },
      { chave: 'dias', rotulo: 'Dias', tipo: 'numero' },
      { chave: 'vop', rotulo: 'VOP atribuído', tipo: 'brl' },
      { chave: 'comissao', rotulo: 'Comissão', tipo: 'brl' },
      { chave: 'evento_em', rotulo: 'Data', tipo: 'data' },
    ],
    medida: 'soma',
  },
  atencao: {
    titulo: (p) => ATENCAO_LABELS[p.item ?? ''] ?? 'Exige atenção',
    natureza: 'janela',
    regra: (c) =>
      ATENCAO_DE_JANELA.has(c.params.item ?? '')
        ? `Ocorrências de ${periodo(c)}.`
        : `Fila aberta em ${dm(c.retrato)} — acumulada, não só da semana.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'fornecedor', rotulo: 'Fornecedor' },
      { chave: 'conta', rotulo: 'Conta' },
      { chave: 'processo', rotulo: 'Processo' },
      { chave: 'lote', rotulo: 'Lote' },
      { chave: 'regra', rotulo: 'Regra' },
      { chave: 'sugestao', rotulo: 'Sugestão' },
      { chave: 'tipo', rotulo: 'Tipo' },
      { chave: 'antes', rotulo: 'Limite antes', tipo: 'brl' },
      { chave: 'depois', rotulo: 'Limite depois', tipo: 'brl' },
      { chave: 'protestos', rotulo: 'Protestos', tipo: 'numero' },
      { chave: 'movimentacoes', rotulo: 'Movimentações', tipo: 'numero' },
      { chave: 'itens', rotulo: 'Itens', tipo: 'numero' },
      { chave: 'valor', rotulo: 'Valor', tipo: 'brl' },
      { chave: 'volume_90d', rotulo: 'Volume 90 dias', tipo: 'brl' },
      { chave: 'potencial_mensal', rotulo: 'Potencial mensal', tipo: 'brl' },
      { chave: 'validade', rotulo: 'Validade', tipo: 'data' },
      { chave: 'quando', rotulo: 'Quando', tipo: 'data' },
    ],
    medida: 'total',
  },
  aq_leads: {
    titulo: (p) =>
      `Aquisição — ${ORIGEM_AQUISICAO_LABELS[(p.origem ?? 'total') as OrigemAquisicao | 'total'] ?? p.origem}` +
      ` · ${FIT_AQUISICAO_LABELS[(p.fit ?? 'total') as FitAquisicao | 'total'] ?? p.fit}`,
    natureza: 'coorte',
    regra: (c) =>
      `Leads distribuídos de ${periodo(c)}, com o fit que têm HOJE. O lead conta na semana em que entrou, não na em que foi avaliado.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'contato', rotulo: 'Contato' },
      { chave: 'origem', rotulo: 'Origem' },
      { chave: 'responsavel', rotulo: 'Responsável' },
      { chave: 'distribuido_em', rotulo: 'Entrada', tipo: 'data' },
      { chave: 'estagio', rotulo: 'Estágio atual' },
      { chave: 'fit', rotulo: 'Fit' },
    ],
    medida: 'total',
  },
  aq_reunioes: {
    titulo: (p) =>
      (FATO_REUNIAO_LABELS[p.fato as FatoReuniao] ?? 'Reuniões') +
      (p.origem && p.origem !== 'total'
        ? ` — ${ORIGEM_AQUISICAO_LABELS[p.origem as OrigemAquisicao] ?? p.origem}`
        : ''),
    natureza: 'janela',
    regra: (c) => `De ${periodo(c)}: ${REGRA_DO_FATO[c.params.fato as FatoReuniao] ?? 'reuniões do período'}.`,
    colunas: [
      { chave: 'empresa', rotulo: 'Empresa' },
      { chave: 'contato', rotulo: 'Contato' },
      { chave: 'origem', rotulo: 'Origem' },
      { chave: 'responsavel', rotulo: 'Responsável' },
      { chave: 'distribuido_em', rotulo: 'Entrada', tipo: 'data' },
      { chave: 'estagio', rotulo: 'Estágio atual' },
      { chave: 'inicio_em', rotulo: 'Data e hora', tipo: 'datahora' },
      { chave: 'condutor', rotulo: 'Quem conduziu' },
      { chave: 'agendada_em', rotulo: 'Marcada em', tipo: 'data' },
    ],
    medida: 'total',
  },
}

/**
 * A natureza do número DAQUELE alvo. Só "Exige atenção" varia por parâmetro: quatro itens
 * são evento da semana e cinco são fila acumulada.
 */
export function naturezaDoAlvo(alvo: Pick<AlvoDetalhe, 'chave' | 'params'>): NaturezaNumero {
  if (alvo.chave === 'atencao') {
    return ATENCAO_DE_JANELA.has(alvo.params?.item ?? '') ? 'janela' : 'estoque'
  }
  return DETALHES[alvo.chave].natureza
}

export function ehChaveDetalhe(v: unknown): v is ChaveDetalhe {
  return typeof v === 'string' && (CHAVES_DETALHE as readonly string[]).includes(v)
}

/**
 * As colunas que a lista realmente tem. "Exige atenção" declara a união das colunas dos
 * nove itens; mostrar dezoito cabeçalhos para preencher quatro é ruído.
 */
export function colunasPresentes(
  colunas: readonly ColunaDetalhe[],
  linhas: readonly Record<string, unknown>[],
): ColunaDetalhe[] {
  if (linhas.length === 0) return [...colunas]
  return colunas.filter((c) => linhas.some((l) => c.chave in l))
}

// ─── O número que o report exibe para o recorte ─────────────────────────────

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * O valor que o report mostra para aquele alvo — a referência contra a qual o total da
 * lista é conferido. Divergência é BUG, não arredondamento (04u §4.1).
 *
 * `null` = o report aberto não tem como responder (alvo de outra semana, ou report antigo
 * sem o bloco). Aí o modal não compara nada, em vez de acusar divergência que não houve.
 */
export function esperadoNoReport(r: ReportSemanal, alvo: AlvoDetalhe): number | null {
  if (alvo.inicio && alvo.fim && (alvo.inicio !== r.periodo.inicio || alvo.fim !== r.periodo.fim)) {
    return null
  }
  const p = alvo.params ?? {}
  const c = r.comercial.comercial
  switch (alvo.chave) {
    case 'volume_convertido': return n(r.operacao.kpis.volume_convertido.semana)
    case 'vop_operado': return n(r.operacao.kpis.vop_operado.semana)
    case 'receita': return n(r.operacao.kpis.receita.semana)
    case 'limite_ocioso': return n(r.operacao.kpis.limite_ocioso.foto)
    case 'funil_etapa': return n(r.comercial.funil.semana?.[p.etapa as EtapaFunil])
    case 'fit_avaliados': return n(c.fit_avaliados)
    case 'reunioes_realizadas': return n(c.reunioes_realizadas)
    case 'no_shows': return n(c.no_shows_nao_remarcados)
    case 'mous': return n(c.mous)
    case 'ciclo': return n(c.ciclo_medio_base)
    case 'nf_faixa': {
      const f = r.operacao.nf.por_faixa.find((x) => x.faixa === p.faixa)
      return f ? n(p.serie === 'doze' ? f.entradas_12m : f.entradas_semana) : 0
    }
    case 'nf_capturadas': return n(r.operacao.nf.capturadas.semana)
    case 'nf_expiradas': return n(r.operacao.nf.valor_expirado.semana)
    case 'nf_travadas': return n(r.operacao.nf.travadas.total)
    case 'contas_paradas': return r.carteira.listas.nao_performando.length
    case 'carteira_gestor':
      return r.carteira.listas.nao_performando
        .filter((x) => String(x.gestor ?? 'Sem gestor') === (p.gestor ?? 'Sem gestor'))
        .reduce((s, x) => s + n(x.ocioso), 0)
    case 'cert_balde': {
      const ce = r.carteira.certificados
      if (p.balde === 'validos') return n(ce.cobertos)
      if (p.balde === 'vencendo') return n(ce.vencendo_30d)
      // `sem_certificado` do report inclui os que estão vencendo; o balde, não.
      return n(ce.sem_certificado) - n(ce.vencendo_30d)
    }
    case 'cert_topo': return n(r.carteira.certificados.invisivel.total_mes_do_topo)
    case 'time_vendedor':
      return n(r.comercial.time.vendedores.find((v) => v.vendedor_id === p.vendedor_id)?.vop)
    case 'atencao': return n(r.carteira.atencao[p.item ?? ''])
    case 'aq_leads': {
      if (!r.aquisicao) return null
      const linhas = p.origem && p.origem !== 'total'
        ? r.aquisicao.origens.filter((o) => o.origem === p.origem)
        : r.aquisicao.origens
      const t = totalDoBloco({ origens: linhas })
      if (p.fit && p.fit !== 'total') return n(t[p.fit as FitAquisicao])
      return t.com_fit + t.sem_fit + t.nao_avaliado
    }
    case 'aq_reunioes': {
      if (!r.aquisicao) return null
      const campo = CAMPO_DO_FATO[p.fato as FatoReuniao]
      if (!campo) return null
      const linhas = p.origem && p.origem !== 'total'
        ? r.aquisicao.origens.filter((o) => o.origem === p.origem)
        : r.aquisicao.origens
      return n(totalDoBloco({ origens: linhas })[campo])
    }
  }
}

/** O número da lista bate com o do report? Centavo a centavo, sem tolerância. */
export function detalheBate(esperado: number | null, obtido: number): boolean {
  if (esperado === null) return true
  return Math.round(esperado * 100) === Math.round(obtido * 100)
}

// ─── Deep link (04u §4.1: o PDF não clica) ──────────────────────────────────

const PREFIXO_PARAM = 'p.'

/**
 * O link que abre o report web com o modal já aberto.
 *
 * No PDF cada número ganha um "ver no sistema" apontando para cá. `execucao` fixa o
 * snapshot daquele envio: quem abre o e-mail de três semanas atrás cai na semana do e-mail,
 * e não na semana fechada mais recente.
 */
export function linkDoDetalhe(base: string, alvo: AlvoDetalhe, execucaoId?: string | null): string {
  const q = new URLSearchParams()
  if (execucaoId) q.set('execucao', execucaoId)
  q.set('detalhe', alvo.chave)
  if (alvo.inicio && alvo.fim) {
    q.set('de', alvo.inicio)
    q.set('ate', alvo.fim)
  }
  for (const [k, v] of Object.entries(alvo.params ?? {})) q.set(PREFIXO_PARAM + k, v)
  return `${base.replace(/\/$/, '')}/comercial/relatorios/semanal?${q.toString()}`
}

/** O inverso: o que a página lê da querystring. Chave desconhecida vira `null`, não erro. */
export function lerLinkDoDetalhe(
  q: { get(nome: string): string | null; forEach(fn: (valor: string, nome: string) => void): void },
): { execucaoId: string | null; alvo: AlvoDetalhe | null } {
  const execucaoId = q.get('execucao')
  const chave = q.get('detalhe')
  if (!ehChaveDetalhe(chave)) return { execucaoId, alvo: null }
  const params: ParamsDetalhe = {}
  q.forEach((valor, nome) => {
    if (nome.startsWith(PREFIXO_PARAM)) params[nome.slice(PREFIXO_PARAM.length)] = valor
  })
  const de = q.get('de')
  const ate = q.get('ate')
  const data = /^\d{4}-\d{2}-\d{2}$/
  return {
    execucaoId,
    alvo: {
      chave, params,
      ...(de && ate && data.test(de) && data.test(ate) ? { inicio: de, fim: ate } : {}),
    },
  }
}

// ─── Células e CSV ──────────────────────────────────────────────────────────

/** Os valores que o banco devolve como código e a tela mostra como palavra. */
const ROTULO_VALOR: Record<string, Record<string, string>> = {
  origem: {
    inbound: 'Inbound', distribuicao: 'Outbound (distribuição)', manual: 'Outbound (manual)',
    sem_origem: 'Sem origem',
  },
  fit: { com_fit: 'Com fit', sem_fit: 'Sem fit', nao_avaliado: 'Ainda não avaliado' },
  estagio: {
    a_contatar: 'A contatar', em_conversa: 'Em conversa', reuniao_agendada: 'Reunião agendada',
    no_show: 'No-show', reuniao_realizada: 'Reunião realizada', qualificada: 'Qualificada',
    convertida: 'Convertida', expirada: 'Expirada',
  },
  de: {
    a_contatar: 'A contatar', em_conversa: 'Em conversa', reuniao_agendada: 'Reunião agendada',
    no_show: 'No-show', reuniao_realizada: 'Reunião realizada', qualificada: 'Qualificada',
  },
  para: {
    reuniao_realizada: 'Reunião realizada', qualificada: 'Qualificada',
    mou_assinado: 'MOU assinado', onboarding: 'Onboarding',
  },
  faixa: FAIXA_LABELS,
}

const dataBr = (v: unknown, comHora: boolean): string => {
  const s = String(v)
  // Data pura (`2026-10-11`) não passa por fuso: `new Date()` a leria como UTC e a
  // mostraria no dia anterior em São Paulo.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

/** O texto de uma célula. No CSV o dinheiro sai como número, para a planilha poder somar. */
export function celulaDoDetalhe(col: ColunaDetalhe, valor: unknown, modo: 'tela' | 'csv' = 'tela'): string {
  if (valor === null || valor === undefined || valor === '') return modo === 'csv' ? '' : '—'
  switch (col.tipo) {
    case 'brl': {
      const v = Number(valor)
      if (!Number.isFinite(v)) return String(valor)
      return modo === 'csv'
        ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
        : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    }
    case 'numero': {
      const v = Number(valor)
      if (!Number.isFinite(v)) return String(valor)
      return v.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: modo !== 'csv' })
    }
    case 'data': return dataBr(valor, false)
    case 'datahora': return dataBr(valor, true)
    default: return ROTULO_VALOR[col.chave]?.[String(valor)] ?? String(valor)
  }
}

const escaparCsv = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * O CSV de uma lista. Separador `;` e vírgula decimal: é o que o Excel em pt-BR abre certo
 * sem assistente de importação. Quem grava o arquivo põe o BOM na frente.
 */
export function csvDoDetalhe(
  colunas: readonly ColunaDetalhe[],
  linhas: readonly Record<string, unknown>[],
): string {
  const cab = colunas.map((c) => escaparCsv(c.rotulo)).join(';')
  const corpo = linhas.map((l) =>
    colunas.map((c) => escaparCsv(celulaDoDetalhe(c, l[c.chave], 'csv'))).join(';'),
  )
  return [cab, ...corpo].join('\r\n')
}

/** `report-volume-convertido-2026-10-05.csv` */
export function nomeDoCsv(alvo: AlvoDetalhe, inicio: string): string {
  const sufixo = Object.values(alvo.params ?? {})
    .filter((v) => /^[a-z0-9_]+$/i.test(v) && v.length <= 24)
    .join('-')
  return `report-${alvo.chave.replace(/_/g, '-')}${sufixo ? `-${sufixo.replace(/_/g, '-')}` : ''}-${inicio}.csv`
}

export interface RespostaDetalhe {
  chave: string
  total: number
  soma: number
  limite: number
  offset: number
  linhas: Record<string, unknown>[]
}

/** O valor da resposta que se compara com o número clicado. */
export function medidaDoDetalhe(chave: ChaveDetalhe, resp: Pick<RespostaDetalhe, 'total' | 'soma'>): number {
  return DETALHES[chave].medida === 'soma' ? Number(resp.soma) : Number(resp.total)
}

/** Paginação do modal: 50 por página, e nunca além do teto configurado (04u §4.1). */
export const LINHAS_POR_PAGINA = 50

export function paginasDoDetalhe(total: number, teto: number): { paginas: number; cortado: boolean } {
  const visiveis = Math.min(total, Math.max(teto, LINHAS_POR_PAGINA))
  return { paginas: Math.max(Math.ceil(visiveis / LINHAS_POR_PAGINA), 1), cortado: total > visiveis }
}
