import { z } from 'zod'

/**
 * Cobrança extrajudicial e sinistro (Prompt 07) — vocabulário, settings e entradas.
 *
 * Mesmo estilo do Jurídico: tupla SCREAMING `as const` → enum zod → tipo → LABELS pt-BR,
 * e todo campo que chega à IA carrega `.describe()`. Os nomes levam o prefixo do
 * módulo (`COBRANCA_…`, `…Cobranca…`) porque tudo sai pelo mesmo barril do core, e um
 * `ESTAGIOS` daqui colidiria com o do Comercial em silêncio até o TS2308.
 */

const cnpjSchema = z.string().regex(/^\d{14}$/, 'CNPJ com 14 dígitos.')
const dataSchema = z.string().date()
const uuid = z.string().uuid()

// ─── Estágios e situações ───────────────────────────────────────────────────

export const COBRANCA_ESTAGIOS = [
  'rascunho',
  'notificada',
  'em_negociacao',
  'acordo_firmado',
  'acordo_em_cumprimento',
  'quitada',
  'judicializada',
  'encerrada_perda',
  'cancelada',
] as const
export const cobrancaEstagioSchema = z.enum(COBRANCA_ESTAGIOS)
export type CobrancaEstagio = z.infer<typeof cobrancaEstagioSchema>

export const COBRANCA_ESTAGIO_LABELS: Record<CobrancaEstagio, string> = {
  rascunho: 'Rascunho',
  notificada: 'Notificada',
  em_negociacao: 'Em negociação',
  acordo_firmado: 'Acordo firmado',
  acordo_em_cumprimento: 'Acordo em cumprimento',
  quitada: 'Quitada',
  judicializada: 'Judicializada',
  encerrada_perda: 'Encerrada com perda',
  cancelada: 'Cancelada',
}

/** Estágios terminais: não aparecem no kanban ativo e não aceitam movimento. */
export const COBRANCA_ESTAGIOS_ENCERRADOS: readonly CobrancaEstagio[] = ['quitada', 'encerrada_perda', 'cancelada']

/**
 * Para onde uma pessoa pode ARRASTAR o card. `notificada`, `acordo_firmado` e
 * `judicializada` são consequência de um ato (envio, acordo assinado, processo) e a RPC
 * recusa o movimento direto — a lista aqui só evita oferecer o botão.
 */
export const COBRANCA_ESTAGIOS_MOVIVEIS: readonly CobrancaEstagio[] = [
  'em_negociacao',
  'acordo_em_cumprimento',
  'quitada',
  'encerrada_perda',
  'cancelada',
]

export const COBRANCA_SITUACOES_TITULO = [
  'em_cobranca',
  'quitado',
  'acordado',
  'protestado',
  'sinistrado',
  'retirado',
] as const
export type CobrancaSituacaoTitulo = (typeof COBRANCA_SITUACOES_TITULO)[number]
export const COBRANCA_SITUACAO_TITULO_LABELS: Record<CobrancaSituacaoTitulo, string> = {
  em_cobranca: 'Em cobrança',
  quitado: 'Quitado',
  acordado: 'Em acordo',
  protestado: 'Protestado',
  sinistrado: 'Sinistrado',
  retirado: 'Retirado',
}

export const ESCOPOS_NOTIFICACAO = ['sacado', 'sacado_e_cedente'] as const
export const escopoNotificacaoSchema = z.enum(ESCOPOS_NOTIFICACAO)
export type EscopoNotificacao = z.infer<typeof escopoNotificacaoSchema>
export const ESCOPO_NOTIFICACAO_LABELS: Record<EscopoNotificacao, string> = {
  sacado: 'Só o sacado (matriz e SPEs)',
  sacado_e_cedente: 'Sacado e cedente',
}

export const PAPEIS_NOTIFICACAO_COBRANCA = ['sacado_matriz', 'sacado_filial', 'cedente_matriz', 'cedente_filial'] as const
export type PapelNotificacaoCobranca = (typeof PAPEIS_NOTIFICACAO_COBRANCA)[number]
export const PAPEL_NOTIFICACAO_COBRANCA_LABELS: Record<PapelNotificacaoCobranca, string> = {
  sacado_matriz: 'Sacado — matriz (consolidada)',
  sacado_filial: 'Sacado — SPE/filial',
  cedente_matriz: 'Cedente — matriz',
  cedente_filial: 'Cedente — filial',
}

export const STATUS_NOTIFICACAO_COBRANCA = ['rascunho', 'pronta', 'enviada', 'entregue', 'falhou', 'respondida'] as const
export type StatusNotificacaoCobranca = (typeof STATUS_NOTIFICACAO_COBRANCA)[number]
export const STATUS_NOTIFICACAO_COBRANCA_LABELS: Record<StatusNotificacaoCobranca, string> = {
  rascunho: 'Rascunho',
  pronta: 'PDF pronto',
  enviada: 'Enviada',
  entregue: 'Entregue',
  falhou: 'Falhou',
  respondida: 'Respondida',
}

export const CANAIS_ENTREGA = ['email', 'whatsapp', 'correio_ar', 'cartorio_td', 'entrega_pessoal'] as const
export const canalEntregaSchema = z.enum(CANAIS_ENTREGA)
export type CanalEntrega = z.infer<typeof canalEntregaSchema>
export const CANAL_ENTREGA_LABELS: Record<CanalEntrega, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  correio_ar: 'Correio com AR',
  cartorio_td: 'Cartório de Títulos e Documentos',
  entrega_pessoal: 'Entrega pessoal',
}
/** Os que o sistema não envia: gera o PDF e a pessoa devolve rastreio e comprovante. */
export const CANAIS_ENTREGA_MANUAIS: readonly CanalEntrega[] = ['correio_ar', 'cartorio_td', 'entrega_pessoal']

export const STATUS_ENTREGA = ['pendente', 'enviado', 'entregue', 'recusado', 'devolvido', 'falhou'] as const
export type StatusEntrega = (typeof STATUS_ENTREGA)[number]
export const STATUS_ENTREGA_LABELS: Record<StatusEntrega, string> = {
  pendente: 'Na fila',
  enviado: 'Enviado',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  falhou: 'Falhou',
}

export const TIPOS_INTERACAO_COBRANCA = ['ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'nota'] as const
export type TipoInteracaoCobranca = (typeof TIPOS_INTERACAO_COBRANCA)[number]
export const TIPO_INTERACAO_COBRANCA_LABELS: Record<TipoInteracaoCobranca, string> = {
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  reuniao: 'Reunião',
  visita: 'Visita',
  nota: 'Anotação',
}

// ─── Modelos ────────────────────────────────────────────────────────────────

export const TIPOS_MODELO_COBRANCA = [
  'notificacao_sacado',
  'notificacao_cedente',
  'reiteracao',
  'confissao_divida_simples',
  'confissao_divida_aval',
  'confissao_divida_af',
  'confissao_divida_garantia_real',
] as const
export const tipoModeloCobrancaSchema = z.enum(TIPOS_MODELO_COBRANCA)
export type TipoModeloCobranca = z.infer<typeof tipoModeloCobrancaSchema>
export const TIPO_MODELO_COBRANCA_LABELS: Record<TipoModeloCobranca, string> = {
  notificacao_sacado: 'Notificação ao sacado',
  notificacao_cedente: 'Notificação ao cedente',
  reiteracao: 'Reiteração',
  confissao_divida_simples: 'Confissão de dívida — simples',
  confissao_divida_aval: 'Confissão de dívida — com aval',
  confissao_divida_af: 'Confissão de dívida — alienação fiduciária',
  confissao_divida_garantia_real: 'Confissão de dívida — garantia real',
}

// ─── Atualização da dívida (§9.1) ───────────────────────────────────────────

export const INDICES_COBRANCA = ['igpm', 'ipca', 'inpc', 'nenhum'] as const
export const indiceCobrancaSchema = z.enum(INDICES_COBRANCA)
export type IndiceCobranca = z.infer<typeof indiceCobrancaSchema>
export const INDICE_COBRANCA_LABELS: Record<IndiceCobranca, string> = {
  igpm: 'IGP-M',
  ipca: 'IPCA',
  inpc: 'INPC',
  nenhum: 'Sem correção',
}

/** Percentuais em "pontos": 1 = 1% a.m., 2 = 2% — o mesmo formato do Jurídico. */
export const parametrosAtualizacaoSchema = z.object({
  juros_mora_mes: z.number().min(0).max(20).describe('Juros de mora, % ao mês.'),
  multa_pct: z.number().min(0).max(100).describe('Multa, %.'),
  honorarios_pct: z.number().min(0).max(100).describe('Honorários, % sobre o subtotal.'),
  indice: indiceCobrancaSchema.describe('Índice de correção monetária.'),
  juros_pro_rata: z.boolean().describe('Juros pro rata die (true) ou por mês cheio (false).'),
})
export type ParametrosAtualizacao = z.infer<typeof parametrosAtualizacaoSchema>

export const PARAMETROS_ATUALIZACAO_PADRAO: ParametrosAtualizacao = {
  juros_mora_mes: 1,
  multa_pct: 2,
  honorarios_pct: 10,
  indice: 'igpm',
  juros_pro_rata: true,
}

// ─── Parcelamento (§9.2) ────────────────────────────────────────────────────

export const SISTEMAS_AMORTIZACAO = ['price', 'sac'] as const
export const sistemaAmortizacaoSchema = z.enum(SISTEMAS_AMORTIZACAO)
export type SistemaAmortizacao = z.infer<typeof sistemaAmortizacaoSchema>
export const SISTEMA_AMORTIZACAO_LABELS: Record<SistemaAmortizacao, string> = { price: 'Price', sac: 'SAC' }

export const PERIODICIDADES_ACORDO = ['mensal', 'quinzenal', 'semanal'] as const
export const periodicidadeAcordoSchema = z.enum(PERIODICIDADES_ACORDO)
export type PeriodicidadeAcordo = z.infer<typeof periodicidadeAcordoSchema>
export const PERIODICIDADE_ACORDO_LABELS: Record<PeriodicidadeAcordo, string> = {
  mensal: 'Mensal',
  quinzenal: 'Quinzenal',
  semanal: 'Semanal',
}

export const simulacaoParcelamentoSchema = z.object({
  valor: z.number().positive().describe('Valor atualizado a parcelar (à vista), em reais.'),
  entrada: z.number().min(0).default(0).describe('Entrada em reais. Use `entrada_pct` para percentual.'),
  entrada_pct: z.number().min(0).max(100).optional().describe('Entrada como % do valor (substitui `entrada`).'),
  qtd_parcelas: z.number().int().min(1).max(360).describe('Número de parcelas (sem contar a entrada).'),
  primeira_parcela: dataSchema.describe('Vencimento da primeira parcela, AAAA-MM-DD.'),
  periodicidade: periodicidadeAcordoSchema.default('mensal'),
  juros_mes: z.number().min(0).max(20).default(0).describe('Juros do parcelamento, % ao mês.'),
  sistema: sistemaAmortizacaoSchema.default('price'),
})
export type SimulacaoParcelamentoInput = z.input<typeof simulacaoParcelamentoSchema>

// ─── Sinistro e protesto ────────────────────────────────────────────────────

export const SINISTRO_ESTAGIOS = [
  'preparacao',
  'notificado',
  'enviado',
  'em_analise',
  'docs_pendentes',
  'aceito',
  'recusado',
  'indenizado',
  'encerrado',
] as const
export type SinistroEstagio = (typeof SINISTRO_ESTAGIOS)[number]
export const SINISTRO_ESTAGIO_LABELS: Record<SinistroEstagio, string> = {
  preparacao: 'Em preparação',
  notificado: 'Seguradora notificada',
  enviado: 'Enviado',
  em_analise: 'Em análise',
  docs_pendentes: 'Documentos pendentes',
  aceito: 'Aceito',
  recusado: 'Recusado',
  indenizado: 'Indenizado',
  encerrado: 'Encerrado',
}

export const CAUSAS_SINISTRO = ['mora_prolongada', 'insolvencia'] as const
export type CausaSinistro = (typeof CAUSAS_SINISTRO)[number]
export const CAUSA_SINISTRO_LABELS: Record<CausaSinistro, string> = {
  mora_prolongada: 'Mora prolongada',
  insolvencia: 'Insolvência',
}

export const PROTESTO_SITUACOES = [
  'enviado',
  'apontado',
  'protestado',
  'pago_em_cartorio',
  'retirado',
  'sustado',
  'rejeitado',
] as const
export const protestoSituacaoSchema = z.enum(PROTESTO_SITUACOES)
export type ProtestoSituacao = z.infer<typeof protestoSituacaoSchema>
export const PROTESTO_SITUACAO_LABELS: Record<ProtestoSituacao, string> = {
  enviado: 'Enviado',
  apontado: 'Apontado',
  protestado: 'Protestado',
  pago_em_cartorio: 'Pago em cartório',
  retirado: 'Retirado',
  sustado: 'Sustado',
  rejeitado: 'Rejeitado',
}

// ─── Settings (§13) ─────────────────────────────────────────────────────────

export const COBRANCA_CONFIG_CHAVES = ['cobranca', 'calculo', 'apolice', 'protesto', 'regularizacao', 'credor'] as const
export type CobrancaConfigChave = (typeof COBRANCA_CONFIG_CHAVES)[number]

export const configCobrancaGeralSchema = z.object({
  dias_inicio_cobranca: z.number().int().min(1).max(365),
  prazo_pagamento_dias: z.number().int().min(1).max(90),
  prazo_pagamento_uteis: z.boolean(),
  dias_para_reiteracao: z.number().int().min(1).max(180),
  estagio_que_bloqueia: z.enum(['notificada', 'em_negociacao', 'acordo_firmado', 'judicializada']),
  motivos_encerramento: z.array(z.string().min(2)).max(30),
  canais_padrao: z.array(canalEntregaSchema),
})
export type ConfigCobrancaGeral = z.infer<typeof configCobrancaGeralSchema>

export const configCobrancaCalculoSchema = parametrosAtualizacaoSchema
export type ConfigCobrancaCalculo = ParametrosAtualizacao

export const configCobrancaApoliceSchema = z.object({
  alertas_dias: z.object({
    parada_cobertura: z.number().int().min(1),
    notificacao_seguradora: z.number().int().min(1),
    notificacao_critica: z.number().int().min(1),
    data_perda: z.number().int().min(1),
    envio_sinistro: z.array(z.number().int().min(1)).max(5),
  }),
  alertar_titulos_fora_de_cobranca: z.boolean(),
  contato_seguradora: z.object({ nome: z.string().nullable(), email: z.string().email().nullable() }),
  modo_envio: z.enum(['manual', 'api']),
})
export type ConfigCobrancaApolice = z.infer<typeof configCobrancaApoliceSchema>

export const convenioProtestoSchema = z.object({
  uf: z.string().regex(/^[A-Z]{2}$/),
  cra: z.string().min(2),
  modo: z.enum(['portal_manual', 'api']),
  ativo: z.boolean(),
  /** Referência ao segredo no Vault — nunca a credencial. */
  credencial_ref: z.string().nullable().optional(),
})
export type ConvenioProtesto = z.infer<typeof convenioProtestoSchema>

export const configCobrancaProtestoSchema = z.object({
  convenios: z.array(convenioProtestoSchema),
  custas_padrao: z.number().min(0).nullable(),
  retirar_protesto_ao_quitar: z.boolean(),
  justificativa_nao_retirar: z.string().nullable(),
})
export type ConfigCobrancaProtesto = z.infer<typeof configCobrancaProtestoSchema>

export const configCobrancaRegularizacaoSchema = z.object({
  restaurar_limite_automaticamente: z.boolean(),
})

export const configCobrancaCredorSchema = z.object({
  razao_social: z.string().min(2),
  cnpj: cnpjSchema,
  /** Texto livre (banco, agência, conta, PIX) que entra em `{{dados_pagamento}}`. */
  dados_pagamento: z.string().nullable(),
})
export type ConfigCobrancaCredor = z.infer<typeof configCobrancaCredorSchema>

export interface CobrancaConfig {
  cobranca: ConfigCobrancaGeral
  calculo: ConfigCobrancaCalculo
  apolice: ConfigCobrancaApolice
  protesto: ConfigCobrancaProtesto
  regularizacao: z.infer<typeof configCobrancaRegularizacaoSchema>
  credor: ConfigCobrancaCredor
}

export const COBRANCA_CONFIG_PADRAO: CobrancaConfig = {
  cobranca: {
    dias_inicio_cobranca: 15,
    prazo_pagamento_dias: 5,
    prazo_pagamento_uteis: true,
    dias_para_reiteracao: 15,
    estagio_que_bloqueia: 'notificada',
    motivos_encerramento: [],
    canais_padrao: ['email', 'correio_ar'],
  },
  calculo: PARAMETROS_ATUALIZACAO_PADRAO,
  apolice: {
    alertas_dias: {
      parada_cobertura: 45,
      notificacao_seguradora: 75,
      notificacao_critica: 85,
      data_perda: 150,
      envio_sinistro: [300, 345],
    },
    alertar_titulos_fora_de_cobranca: true,
    contato_seguradora: { nome: null, email: null },
    modo_envio: 'manual',
  },
  protesto: { convenios: [], custas_padrao: null, retirar_protesto_ao_quitar: true, justificativa_nao_retirar: null },
  regularizacao: { restaurar_limite_automaticamente: false },
  credor: { razao_social: 'CONSTRUCREDIT SECURITIZADORA S/A', cnpj: '43738268000138', dados_pagamento: null },
}

/**
 * Lê as linhas de `cobranca_config` sobre o padrão, chave a chave. Uma chave ausente ou
 * malformada cai no padrão INTEIRO daquela seção — completar campo a campo misturaria
 * uma seção salva por uma versão antiga com defaults de outra.
 */
export function lerCobrancaConfig(linhas: readonly { chave: string; valor: unknown }[]): CobrancaConfig {
  const mapa = new Map(linhas.map((l) => [l.chave, l.valor]))
  const secao = <T>(chave: CobrancaConfigChave, schema: z.ZodType<T>, padrao: T): T => {
    const r = schema.safeParse(mapa.get(chave))
    return r.success ? r.data : padrao
  }
  return {
    cobranca: secao('cobranca', configCobrancaGeralSchema, COBRANCA_CONFIG_PADRAO.cobranca),
    calculo: secao('calculo', configCobrancaCalculoSchema, COBRANCA_CONFIG_PADRAO.calculo),
    apolice: secao('apolice', configCobrancaApoliceSchema, COBRANCA_CONFIG_PADRAO.apolice),
    protesto: secao('protesto', configCobrancaProtestoSchema, COBRANCA_CONFIG_PADRAO.protesto),
    regularizacao: secao('regularizacao', configCobrancaRegularizacaoSchema, COBRANCA_CONFIG_PADRAO.regularizacao),
    credor: secao('credor', configCobrancaCredorSchema, COBRANCA_CONFIG_PADRAO.credor),
  }
}

// ─── Entradas das escritas (RPCs app_cobranca_*) ────────────────────────────

export const criarCobrancaSchema = z.object({
  titulo_ids: z.array(uuid).min(1, 'Selecione ao menos um título.'),
  escopo_notificacao: escopoNotificacaoSchema.default('sacado'),
  notificar_matriz_cedente: z.boolean().default(true),
  responsavel_id: uuid.optional(),
  juros_mora_mes: z.number().min(0).max(20).optional(),
  multa_pct: z.number().min(0).max(100).optional(),
  honorarios_pct: z.number().min(0).max(100).optional(),
  indice_correcao: indiceCobrancaSchema.optional(),
  juros_pro_rata: z.boolean().optional(),
  data_base: dataSchema.optional(),
  observacoes: z.string().max(4000).optional(),
})
export type CriarCobrancaInput = z.input<typeof criarCobrancaSchema>

export const atualizarCobrancaSchema = z.object({
  id: uuid,
  responsavel_id: uuid.nullable().optional(),
  juros_mora_mes: z.number().min(0).max(20).optional(),
  multa_pct: z.number().min(0).max(100).optional(),
  honorarios_pct: z.number().min(0).max(100).optional(),
  indice_correcao: indiceCobrancaSchema.optional(),
  juros_pro_rata: z.boolean().optional(),
  data_base: dataSchema.optional(),
  escopo_notificacao: escopoNotificacaoSchema.optional(),
  notificar_matriz_cedente: z.boolean().optional(),
  observacoes: z.string().max(4000).nullable().optional(),
  valor_atualizado: z.number().min(0).optional(),
})
export type AtualizarCobrancaInput = z.input<typeof atualizarCobrancaSchema>

export const enderecoDestinatarioSchema = z.object({
  logradouro: z.string().nullable().optional(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  municipio: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
  cep: z.string().nullable().optional(),
  /** true quando alguém editou o cadastral da Receita. */
  editado: z.boolean().optional(),
})
export type EnderecoDestinatario = z.infer<typeof enderecoDestinatarioSchema>

export const notificacaoParaSalvarSchema = z.object({
  papel: z.enum(PAPEIS_NOTIFICACAO_COBRANCA),
  destinatario_cnpj: cnpjSchema,
  destinatario_empresa_id: uuid.nullable().optional(),
  destinatario_razao_social: z.string().min(1),
  destinatario_endereco: enderecoDestinatarioSchema.nullable().optional(),
  modelo_id: uuid.nullable().optional(),
  cobranca_titulo_ids: z.array(uuid).min(1),
  valor_total_atualizado: z.number().nullable().optional(),
  memoria_calculo: z.unknown().optional(),
  prazo_pagamento_dias: z.number().int().min(1).max(90),
  prazo_expira_em: dataSchema.nullable().optional(),
})
export type NotificacaoParaSalvar = z.infer<typeof notificacaoParaSalvarSchema>

export const salvarNotificacoesSchema = z.object({
  cobranca_id: uuid,
  rodada: z.number().int().min(1),
  notificacoes: z.array(notificacaoParaSalvarSchema).min(1),
  valor_atualizado: z.number().min(0).optional(),
})
export type SalvarNotificacoesInput = z.input<typeof salvarNotificacoesSchema>

export const editarNotificacaoCobrancaSchema = z.object({
  id: uuid,
  destinatario_endereco: enderecoDestinatarioSchema.nullable().optional(),
  destinatario_razao_social: z.string().min(1).optional(),
  modelo_id: uuid.nullable().optional(),
  prazo_pagamento_dias: z.number().int().min(1).max(90).optional(),
  prazo_expira_em: dataSchema.optional(),
})
export type EditarNotificacaoCobrancaInput = z.input<typeof editarNotificacaoCobrancaSchema>

/** O texto exato do aviso (§6.4). Vai no audit_log junto do aceite. */
export const AVISO_APOLICE_COBRANCA =
  'Atenção — efeito na apólice. Colocar valores deste sacado em cobrança é uma circunstância de ' +
  'Interrupção Automática de Cobertura (cl. 17700.20 b). A partir de agora, novos recebíveis cedidos ' +
  'contra este sacado não estarão cobertos até que os valores em aberto sejam pagos. Após o pagamento, ' +
  'a cobertura volta a valer para recebíveis cedidos a partir da data do pagamento.'

export const aceitarAvisoApoliceSchema = z.object({
  cobranca_id: uuid,
  aceite: z.literal(true, { errorMap: () => ({ message: 'Marque o aceite do aviso da apólice.' }) }),
  texto: z.string().default(AVISO_APOLICE_COBRANCA),
})
export type AceitarAvisoApoliceInput = z.input<typeof aceitarAvisoApoliceSchema>

export const enviarNotificacaoCobrancaSchema = z.object({
  notificacao_id: uuid,
  envios: z
    .array(
      z.object({
        canal: z.enum(['email', 'whatsapp']),
        contato_id: uuid,
        whatsapp_conta_id: uuid.optional(),
      }),
    )
    .min(1, 'Escolha ao menos um destinatário.'),
  assunto: z.string().max(300).optional(),
  mensagem: z.string().max(4000).optional(),
})
export type EnviarNotificacaoCobrancaInput = z.input<typeof enviarNotificacaoCobrancaSchema>

export const registrarEntregaSchema = z.object({
  id: uuid.optional(),
  notificacao_id: uuid.optional(),
  canal: z.enum(['correio_ar', 'cartorio_td', 'entrega_pessoal']).optional(),
  destino: z.string().max(500).optional(),
  codigo_rastreio: z.string().max(120).optional(),
  comprovante_path: z.string().optional(),
  status: z.enum(['enviado', 'entregue', 'recusado', 'devolvido']).default('enviado'),
  enviado_em: z.string().optional(),
  confirmado_em: z.string().optional(),
  observacao: z.string().max(2000).optional(),
})
export type RegistrarEntregaInput = z.input<typeof registrarEntregaSchema>

export const moverCobrancaSchema = z.object({
  cobranca_id: uuid,
  estagio: cobrancaEstagioSchema,
  motivo: z.string().max(1000).optional(),
})
export type MoverCobrancaInput = z.input<typeof moverCobrancaSchema>

export const quitarTituloCobrancaSchema = z.object({
  id: uuid,
  quitado_em: dataSchema.optional(),
  valor_recebido: z.number().positive().optional(),
})
export type QuitarTituloCobrancaInput = z.input<typeof quitarTituloCobrancaSchema>

export const idCobrancaTituloSchema = z.object({ id: uuid })

export const registrarInteracaoCobrancaSchema = z.object({
  cobranca_id: uuid,
  tipo: z.enum(TIPOS_INTERACAO_COBRANCA),
  resumo: z.string().min(2).max(4000),
  ocorrida_em: z.string().optional(),
})
export type RegistrarInteracaoCobrancaInput = z.input<typeof registrarInteracaoCobrancaSchema>

export const regularizarSacadoSchema = z.object({ sacado_matriz_cnpj: cnpjSchema })

const CNJ = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/
export const vincularProcessoCobrancaSchema = z.object({
  cobranca_id: uuid,
  numero_cnj: z.string().regex(CNJ, 'Número CNJ no formato 0000000-00.0000.0.00.0000.'),
})
export const criarProcessoCobrancaSchema = vincularProcessoCobrancaSchema.extend({
  valor_causa: z.number().positive().optional(),
  comarca: z.string().max(200).optional(),
  uf: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  data_distribuicao: dataSchema.optional(),
  observacoes: z.string().max(2000).optional(),
})

export const salvarModeloCobrancaSchema = z.object({
  id: uuid.optional(),
  tipo: tipoModeloCobrancaSchema.optional(),
  nome: z.string().min(2).max(160).optional(),
  corpo_markdown: z.string().min(20),
})
export type SalvarModeloCobrancaInput = z.input<typeof salvarModeloCobrancaSchema>

export const arquivarModeloCobrancaSchema = z.object({ familia_id: uuid })

export const definirCobrancaConfigSchema = z.object({
  chave: z.enum(COBRANCA_CONFIG_CHAVES),
  valor: z.record(z.unknown()),
})

export const salvarApoliceSchema = z.object({
  id: uuid.optional(),
  seguradora: z.string().optional(),
  numero: z.string().min(2),
  segurado_cnpj: cnpjSchema,
  vigencia_inicio: dataSchema,
  vigencia_fim: dataSchema,
  percentagem_segurada: z.number().gt(0).max(1),
  periodo_espera_dias: z.number().int().min(1),
  prazo_maximo_credito_dias: z.number().int().min(1),
  periodo_max_prorrogacao_dias: z.number().int().min(1),
  prazo_notificacao_apos_prorrogacao_dias: z.number().int().min(1),
  prazo_envio_sinistro_meses: z.number().int().min(1),
  prazo_documentos_complementares_dias: z.number().int().min(1),
  franquia: z.number().min(0),
  responsabilidade_maxima: z.number().min(0).nullable().optional(),
  ativa: z.boolean().optional(),
})
export type SalvarApoliceInput = z.input<typeof salvarApoliceSchema>

export const registrarInsolvenciaSchema = z.object({
  sacado_matriz_cnpj: cnpjSchema,
  tipo: z.enum(['recuperacao_judicial', 'falencia', 'outro']),
  data_decisao: dataSchema,
  numero_cnj: z.string().regex(CNJ).optional(),
  observacao: z.string().max(2000).optional(),
})

export const salvarAcordoSchema = z.object({
  cobranca_id: uuid,
  valor_atualizado: z.number().positive(),
  memoria_calculo: z.unknown(),
  entrada: z.number().min(0),
  qtd_parcelas: z.number().int().min(1).max(360),
  periodicidade: periodicidadeAcordoSchema,
  juros_parcelamento_mes: z.number().min(0).max(20),
  sistema: sistemaAmortizacaoSchema,
  primeira_parcela: dataSchema,
  valor_total_projetado: z.number().positive(),
  parcelas: z.array(z.unknown()).min(1),
  modelo_minuta_id: uuid.optional(),
  dados_minuta: z.record(z.unknown()).optional(),
})
export type SalvarAcordoInput = z.input<typeof salvarAcordoSchema>

export const avalistaSchema = z.object({
  nome: z.string().min(2),
  cpf: z.string().regex(/^\d{11}$/, 'CPF com 11 dígitos.'),
  estado_civil: z.string().min(2),
  endereco: z.string().min(5),
  conjuge: z.string().optional(),
})
export type Avalista = z.infer<typeof avalistaSchema>

export const dadosMinutaSchema = z.object({
  avalistas: z.array(avalistaSchema).optional(),
  bem_garantia: z.string().max(4000).optional(),
  foro: z.string().max(200).optional(),
  testemunhas: z.array(z.object({ nome: z.string().min(2), cpf: z.string().regex(/^\d{11}$/) })).max(4).optional(),
})
export type DadosMinuta = z.infer<typeof dadosMinutaSchema>

export const atualizarDadosMinutaSchema = z.object({
  acordo_id: uuid,
  dados_minuta: dadosMinutaSchema,
  modelo_minuta_id: uuid.optional(),
})

export const anexarAcordoAssinadoSchema = z.object({ acordo_id: uuid, documento_assinado_path: z.string().min(3) })
export const cancelarAcordoSchema = z.object({ acordo_id: uuid })

export const criarSinistroSchema = z.object({
  cobranca_id: uuid.optional(),
  titulo_ids: z.array(uuid).optional(),
  causa: z.enum(CAUSAS_SINISTRO).optional(),
  data_perda: dataSchema.optional(),
  responsavel_id: uuid.optional(),
})
export const documentoSinistroSchema = z.object({
  sinistro_id: uuid,
  item: z.string().regex(/^[a-p]$/),
  acao: z.enum(['anexar', 'nao_aplicavel', 'reabrir']),
  arquivo_path: z.string().optional(),
  arquivo_hash: z.string().optional(),
  justificativa: z.string().max(2000).optional(),
})
export const moverSinistroSchema = z.object({
  sinistro_id: uuid,
  estagio: z.enum(['notificado', 'enviado', 'em_analise', 'docs_pendentes', 'aceito', 'recusado', 'indenizado', 'encerrado']),
  data: dataSchema.optional(),
  protocolo_externo: z.string().max(200).optional(),
  motivo_recusa: z.string().max(2000).optional(),
  indenizacao_recebida: z.number().min(0).optional(),
  modo_envio: z.enum(['manual', 'api']).optional(),
  justificativa_prova_entrega: z.string().max(2000).optional(),
})
export const solicitacaoSinistroSchema = z.object({
  id: uuid.optional(),
  sinistro_id: uuid.optional(),
  descricao: z.string().min(3).max(2000).optional(),
  solicitada_em: dataSchema.optional(),
  respondida_em: dataSchema.optional(),
})
export const custoSinistroSchema = z.object({
  sinistro_id: uuid.optional(),
  cobranca_id: uuid.optional(),
  descricao: z.string().min(2).max(500),
  valor: z.number().positive(),
  data: dataSchema.optional(),
  aprovado_pela_seguradora: z.boolean().default(false),
  aprovacao_referencia: z.string().max(300).optional(),
  comprovante_path: z.string().optional(),
})
export const estimativaSinistroSchema = z.object({
  sinistro_id: uuid,
  perda_segurada_estimada: z.number(),
  indenizacao_estimada: z.number().min(0),
  valor_recebido_parcial: z.number().min(0).optional(),
  memoria_perda: z.unknown(),
})

export const criarRemessaProtestoSchema = z.object({
  cobranca_id: uuid,
  uf: z.string().regex(/^[A-Z]{2}$/),
  cra: z.string().min(2),
  modo: z.enum(['portal_manual', 'api']).default('portal_manual'),
  cobranca_titulo_ids: z.array(uuid).min(1),
})
export const anexarArquivoProtestoSchema = z.object({
  remessa_id: uuid,
  arquivo_path: z.string().optional(),
  retorno_path: z.string().optional(),
})
export const marcarRemessaEnviadaSchema = z.object({
  remessa_id: uuid,
  protocolo: z.string().max(120).optional(),
  enviada_em: z.string().optional(),
})
export const atualizarTituloProtestoSchema = z.object({
  protesto_titulo_id: uuid,
  situacao: protestoSituacaoSchema.optional(),
  cartorio: z.string().max(200).optional(),
  protocolo_cartorio: z.string().max(120).optional(),
  data_protesto: dataSchema.optional(),
  certidao_path: z.string().optional(),
  custas: z.number().min(0).optional(),
  motivo_rejeicao: z.string().max(1000).optional(),
})
export type AtualizarTituloProtestoInput = z.input<typeof atualizarTituloProtestoSchema>
export const processarRetornoProtestoSchema = z.object({
  remessa_id: uuid,
  retorno_path: z.string().optional(),
  linhas: z.array(atualizarTituloProtestoSchema).min(1),
})
export const instrucaoCancelamentoSchema = z.object({
  cobranca_id: uuid,
  protesto_titulo_ids: z.array(uuid).min(1),
  tipo: z.enum(['cancelamento', 'desistencia']).optional(),
  nao_aplicavel_motivo: z.string().min(5).max(1000).optional(),
})

// ─── Tools (AI bar) — todas read-only ou draft-only (§14) ───────────────────

export const listarCobrancasToolSchema = z.object({
  estagio: cobrancaEstagioSchema.optional().describe('Filtra por estágio. Omita para as ativas.'),
  sacado: z.string().optional().describe('Trecho da razão social ou CNPJ do sacado.'),
  minhas: z.boolean().optional().describe('Só as cobranças em que eu sou o responsável.'),
})
export const detalheCobrancaToolSchema = z.object({
  cobranca: z.string().describe('Código (COB-2026-0001) ou id da cobrança.'),
})
export const titulosEmAbertoToolSchema = z.object({
  construtora: z.string().min(3).describe('Razão social ou CNPJ da construtora (qualquer SPE resolve para o grupo).'),
  atraso_minimo: z.number().int().min(0).optional().describe('Só títulos com pelo menos N dias de atraso.'),
})
export const simularAtualizacaoToolSchema = z.object({
  cobranca: z.string().optional().describe('Código ou id de uma cobrança existente.'),
  construtora: z.string().optional().describe('Ou: construtora cujos títulos em aberto serão atualizados.'),
  data_base: dataSchema.optional().describe('Data-base da atualização. Padrão: hoje.'),
})
export const simularParcelamentoToolSchema = simulacaoParcelamentoSchema.extend({
  comparar_com: z
    .array(simulacaoParcelamentoSchema.omit({ valor: true }))
    .max(2)
    .optional()
    .describe('Até 2 cenários adicionais para comparar lado a lado (mesmo valor).'),
})
export const prazosApoliceToolSchema = z.object({
  dias: z.number().int().min(1).max(365).optional().describe('Janela: marcos que vencem nos próximos N dias. Padrão 30.'),
  sacado: z.string().optional().describe('Filtra por razão social ou CNPJ do sacado.'),
})
export const rascunharNotificacaoToolSchema = z.object({
  cobranca: z.string().describe('Código ou id da cobrança. Gera rascunho, NÃO envia.'),
})
export const checklistSinistroToolSchema = z.object({
  sinistro: z.string().describe('Código (SIN-2026-0001) ou id do sinistro.'),
})
