import { z } from 'zod'

/**
 * Vocabulário do módulo Comercial (04g): estágios, rótulos e o contrato de cada
 * mutação. Uma fonte só para os dois funis, porque o kanban da web, a lista do celular
 * e a tool de IA precisam concordar sobre quais colunas existem e em que ordem.
 */

// ─── Gestão da operação ─────────────────────────────────────────────────────

export const GESTOES_OPERACAO = ['prospeccao_ativa', 'passivo'] as const
export type GestaoOperacao = (typeof GESTOES_OPERACAO)[number]

export const GESTAO_OPERACAO_LABELS: Record<GestaoOperacao, string> = {
  prospeccao_ativa: 'Prospecção ativa',
  passivo: 'Passivo',
}

export const GESTAO_OPERACAO_DESCRICOES: Record<GestaoOperacao, string> = {
  prospeccao_ativa: 'Alguém trabalha esta conta: as NFs entram no funil e geram abordagem.',
  passivo:
    'A conta antecipa sozinha. As NFs dela não geram outbox, não entram em carteira de ' +
    'originação e não contam na distribuição — só o volume, na comissão de quem a gere.',
}

/**
 * A pergunta ativo × passivo só existe para quem antecipa (ou antecipou) conosco.
 *
 * Numa empresa de mercado ela não tem resposta possível, e responder assim mesmo tem
 * efeito real: `passivo` a tira da distribuição do SDR — um rótulo sem sentido
 * bloquearia exatamente a prospecção que deveria acontecer. O banco garante isso com
 * CHECK e trigger; aqui é a mesma régua, para a tela não oferecer o que será recusado.
 */
export const ESTAGIOS_COM_GESTAO = ['cliente', 'ex_cliente'] as const

export function aceitaGestaoOperacao(empresa: { estagio?: string | null }): boolean {
  return ESTAGIOS_COM_GESTAO.includes((empresa.estagio ?? '') as (typeof ESTAGIOS_COM_GESTAO)[number])
}

// ─── Vendedores ─────────────────────────────────────────────────────────────

export const TIPOS_VENDEDOR = ['sdr', 'vendedor', 'originador'] as const
export type TipoVendedorId = (typeof TIPOS_VENDEDOR)[number]

export const TIPO_VENDEDOR_LABELS: Record<TipoVendedorId, string> = {
  sdr: 'SDR',
  vendedor: 'Vendedor (closer)',
  originador: 'Originador',
}

export const PAPEIS_CARTEIRA = ['originacao', 'gestao_passiva', 'sdr'] as const
export type PapelCarteira = (typeof PAPEIS_CARTEIRA)[number]

export const PAPEL_CARTEIRA_LABELS: Record<PapelCarteira, string> = {
  originacao: 'Originação',
  gestao_passiva: 'Gestão da conta passiva',
  sdr: 'Prospecção (SDR)',
}

// ─── Funil de SDR ───────────────────────────────────────────────────────────
/*
 * A ordem É a coluna do kanban, e ela segue o que ACONTECE: `no_show` vem logo depois de
 * `reuniao_agendada` porque é a coisa que acontece depois de agendar e antes de sentar.
 *
 * Fit NÃO está aqui. Ele é um julgamento sobre a empresa, feito depois do contato, e
 * continua valendo em qualquer etapa seguinte — um lead pode ter fit e ainda estar em
 * conversa. Como coluna, ele apagava a informação de até onde o lead tinha chegado:
 * quem morreu antes do primeiro contato e quem morreu depois de uma reunião viravam a
 * mesma linha no mesmo lugar.
 */
export const ESTAGIOS_SDR = [
  'a_contatar',
  'em_conversa',
  'reuniao_agendada',
  'no_show',
  'reuniao_realizada',
  'qualificada',
] as const
export type EstagioSdr = (typeof ESTAGIOS_SDR)[number]

export const ESTAGIO_SDR_LABELS: Record<EstagioSdr, string> = {
  a_contatar: 'A contatar',
  em_conversa: 'Em conversa',
  reuniao_agendada: 'Reunião agendada',
  no_show: 'No-show',
  reuniao_realizada: 'Reunião realizada',
  qualificada: 'Qualificada',
}

/** O julgamento sobre a empresa. `null` é um estado real: ainda não se falou com ela. */
export type Fit = boolean | null

export const FIT_LABELS: Record<'sim' | 'nao' | 'indefinido', string> = {
  sim: 'Com fit',
  nao: 'Sem fit',
  indefinido: 'Fit não avaliado',
}

export function rotuloFit(fit: Fit): string {
  return fit === true ? FIT_LABELS.sim : fit === false ? FIT_LABELS.nao : FIT_LABELS.indefinido
}

/**
 * Lead vivo: ninguém o encerrou e ele ainda não chegou ao fim natural do funil.
 *
 * `qualificada` é fim: o lead cumpriu o que tinha de cumprir e virou reunião do closer.
 * Não conta como carga do SDR, e a empresa não volta para a distribuição.
 */
export function leadEstaVivo(lead: { estagio: string; encerrado_em?: string | null }): boolean {
  return !lead.encerrado_em && lead.estagio !== 'qualificada'
}

export const MOTIVOS_ENCERRAMENTO_LEAD = ['sem_fit', 'expirado'] as const
export type MotivoEncerramentoLead = (typeof MOTIVOS_ENCERRAMENTO_LEAD)[number]

export const MOTIVO_ENCERRAMENTO_LEAD_LABELS: Record<MotivoEncerramentoLead, string> = {
  sem_fit: 'Sem fit',
  expirado: 'Expirado sem toque',
}

// ─── Funil do vendedor ──────────────────────────────────────────────────────

/*
 * O estágio diz ONDE o negócio está. Ganho e perdido NÃO estão aqui — são situação.
 *
 * Um negócio ganho pode estar em onboarding, e é lá que o trabalho continua. Como
 * coluna, "ganho" tirava o card da etapa onde o trabalho acontece e o punha numa caixa
 * de troféus — quem tocava o onboarding perdia o card de vista no momento em que ele
 * passou a exigir trabalho de verdade.
 */
export const ESTAGIOS_VENDA = [
  'reuniao_agendada',
  'reuniao_reagendada',
  'aguardando_documentacao',
  'em_analise_credito',
  'proposta_enviada',
  'preparacao_mou',
  'mou_assinado',
  'onboarding',
] as const
export type EstagioVenda = (typeof ESTAGIOS_VENDA)[number]

export const ESTAGIO_VENDA_LABELS: Record<EstagioVenda, string> = {
  reuniao_agendada: 'Reunião agendada',
  reuniao_reagendada: 'Reunião reagendada',
  aguardando_documentacao: 'Aguardando documentação',
  em_analise_credito: 'Em análise de crédito',
  proposta_enviada: 'Proposta enviada',
  preparacao_mou: 'Preparação do MOU',
  mou_assinado: 'MOU assinado',
  onboarding: 'Onboarding',
}

export const SITUACOES_VENDA = ['em_andamento', 'ganho', 'perdido'] as const
export type SituacaoVenda = (typeof SITUACOES_VENDA)[number]

export const SITUACAO_VENDA_LABELS: Record<SituacaoVenda, string> = {
  em_andamento: 'Em andamento',
  ganho: 'Ganho',
  perdido: 'Perdido',
}

/**
 * O que ainda é assunto do comercial.
 *
 * Perdido sai. Ganho CONTINUA no funil até a primeira operação — porque ganho sem
 * operação ainda é trabalho (onboarding, primeira nota, cadastro), e é justamente aí que
 * um negócio fechado morre por falta de acompanhamento. Depois da primeira antecipação
 * convertida vira rotina, e rotina não mora em funil.
 */
export function vendaNoFunil(v: {
  situacao: string
  primeira_operacao_em?: string | null
}): boolean {
  return v.situacao !== 'perdido' && !v.primeira_operacao_em
}

/**
 * O que a decisão da seguradora faz com o card — menos quando ela é parcial.
 *
 * Aprovada e negada são inequívocas, e deixar o vendedor mover à mão só adiciona atraso
 * entre a decisão e a próxima ação. Parcial não é: metade do limite pedido pode ser
 * ótimo ou inviável dependendo da operação, e essa leitura é de quem está na mesa.
 *
 * Note que aprovada move o ESTÁGIO e negada muda a SITUAÇÃO: aprovar é seguir adiante,
 * negar é encerrar onde está.
 */
export function efeitoDaDecisaoCredito(
  decisao: string,
): { estagio?: EstagioVenda; situacao?: SituacaoVenda } | null {
  if (decisao === 'aprovada') return { estagio: 'proposta_enviada' }
  if (decisao === 'negada') return { situacao: 'perdido' }
  return null
}

// ─── Contratos das mutações ─────────────────────────────────────────────────

const uuid = z.string().uuid()

/**
 * Cada escolha tem um dono diferente, e é por isso que são dois campos:
 *
 *   prospecção ativa → ORIGINADOR, que recebe as NFs da conta
 *   passivo          → CLOSER, que gere a conta e recebe pelo volume dela
 *
 * O originador é opcional: dá para declarar a conta ativa antes de decidir quem a
 * trabalha, e forçar a escolha aqui faria alguém escolher qualquer um só para salvar.
 * O gestor da passiva NÃO é — passiva sem gestor é conta órfã com rótulo.
 */
export const definirGestaoSchema = z
  .object({
    empresa_id: uuid,
    gestao_operacao: z.enum(GESTOES_OPERACAO).nullable(),
    vendedor_gestao_id: uuid.nullable().optional(),
    vendedor_originacao_id: uuid.nullable().optional(),
  })
  .refine((v) => v.gestao_operacao !== 'passivo' || !!v.vendedor_gestao_id, {
    message: 'Conta passiva precisa de um closer que a gere.',
    path: ['vendedor_gestao_id'],
  })
  .refine((v) => !v.vendedor_originacao_id || v.gestao_operacao === 'prospeccao_ativa', {
    message: 'Originador só se define em conta de prospecção ativa.',
    path: ['vendedor_originacao_id'],
  })
export type DefinirGestaoInput = z.infer<typeof definirGestaoSchema>

/**
 * A carteira de contas passivas de um closer, como CONJUNTO.
 *
 * Conjunto e não delta: um delta obrigaria a tela a saber o que mudou desde que
 * carregou, e duas abas abertas gravariam metade da intenção cada uma. Mandar a lista
 * inteira faz a última gravação ser a verdade, que é o que a pessoa espera.
 */
export const definirCarteiraPassivaSchema = z.object({
  vendedor_id: uuid,
  empresa_ids: z.array(uuid).default([]),
})
export type DefinirCarteiraPassivaInput = z.infer<typeof definirCarteiraPassivaSchema>

export const definirCarteiraSchema = z.object({
  empresa_id: uuid,
  papel: z.enum(PAPEIS_CARTEIRA),
  /** null libera a empresa: encerra a vigência sem abrir outra. */
  vendedor_id: uuid.nullable(),
})
export type DefinirCarteiraInput = z.infer<typeof definirCarteiraSchema>

/**
 * Mover de estágio, julgar o fit, ou os dois na mesma chamada.
 *
 * `estagio` e `fit` são ambos opcionais porque são coisas independentes: marcar sem fit
 * não move o card (o estágio é o que diz até onde ele chegou), e mover não obriga a
 * julgar.
 */
export const moverLeadSchema = z
  .object({
    lead_id: uuid,
    estagio: z.enum(ESTAGIOS_SDR).optional(),
    fit: z.boolean().optional(),
    sem_fit_motivo: uuid.nullable().optional(),
    reuniao_em: z.string().datetime({ offset: true }).nullable().optional(),
    vendedor_destino_id: uuid.nullable().optional(),
  })
  // As validações que o banco também faz. Aqui existem para a mensagem chegar ao
  // formulário no campo certo, em vez de voltar como exceção genérica do Postgres.
  .refine((v) => v.estagio !== undefined || v.fit !== undefined, {
    message: 'Informe o estágio, o fit, ou os dois.',
    path: ['estagio'],
  })
  .refine((v) => v.fit !== false || !!v.sem_fit_motivo, {
    message: 'Sem fit exige motivo.',
    path: ['sem_fit_motivo'],
  })
  .refine((v) => v.estagio !== 'reuniao_agendada' || (!!v.reuniao_em && !!v.vendedor_destino_id), {
    message: 'Agendar exige data e vendedor destino.',
    path: ['reuniao_em'],
  })
export type MoverLeadInput = z.infer<typeof moverLeadSchema>

/** Mover de estágio, mudar a situação, ou os dois. São coisas independentes. */
export const moverVendaSchema = z
  .object({
    venda_id: uuid,
    estagio: z.enum(ESTAGIOS_VENDA).optional(),
    situacao: z.enum(SITUACOES_VENDA).optional(),
    perdido_motivo: uuid.nullable().optional(),
    analise_credito_id: uuid.nullable().optional(),
  })
  .refine((v) => v.estagio !== undefined || v.situacao !== undefined, {
    message: 'Informe o estágio, a situação, ou os dois.',
    path: ['estagio'],
  })
  .refine((v) => v.situacao !== 'perdido' || !!v.perdido_motivo, {
    message: 'Perder exige motivo.',
    path: ['perdido_motivo'],
  })
export type MoverVendaInput = z.infer<typeof moverVendaSchema>

export const atribuirNfSchema = z.object({
  access_key: z.string().min(10),
  vendedor_id: uuid.nullable(),
})
export type AtribuirNfInput = z.infer<typeof atribuirNfSchema>

export const mudarStatusComissaoSchema = z.object({
  vendedor_id: uuid,
  competencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['aprovado', 'pago']),
})
export type MudarStatusComissaoInput = z.infer<typeof mudarStatusComissaoSchema>

// ─── Config ─────────────────────────────────────────────────────────────────

export const FONTES_DISTRIBUICAO = ['som', 'som_sam', 'som_sam_tam'] as const
export type FonteDistribuicao = (typeof FONTES_DISTRIBUICAO)[number]

export const FONTE_DISTRIBUICAO_LABELS: Record<FonteDistribuicao, string> = {
  som: 'Só o SOM',
  som_sam: 'SOM + SAM',
  som_sam_tam: 'SOM + SAM + TAM',
}

/** As camadas que cada fonte abre. É esta lista que o job de distribuição consulta. */
export const CAMADAS_DA_FONTE: Record<FonteDistribuicao, readonly string[]> = {
  som: ['som'],
  som_sam: ['som', 'sam'],
  som_sam_tam: ['som', 'sam', 'tam'],
}

// ─── Cadastro (04g §9 — a tela escreve por RPC, com audit) ──────────────────

export const salvarVendedorSchema = z
  .object({
    id: uuid.optional(),
    nome: z.string().trim().min(2, 'Nome muito curto.'),
    tipo: z.enum(TIPOS_VENDEDOR),
    usuario_id: uuid.nullable().optional(),
    is_ia: z.boolean().default(false),
    whatsapp_conta_id: uuid.nullable().optional(),
    email_remetente: z.string().email('E-mail inválido.').nullable().optional().or(z.literal('')),
    settings: z.record(z.unknown()).default({}),
    ativo: z.boolean().default(true),
  })
  // O mesmo CHECK da tabela, aqui só para a mensagem chegar no campo certo.
  .refine((v) => !!v.usuario_id || v.is_ia, {
    message: 'Escolha o usuário, ou marque como vendedor de IA.',
    path: ['usuario_id'],
  })
export type SalvarVendedorInput = z.infer<typeof salvarVendedorSchema>

export const salvarTerritorioSchema = z
  .object({
    vendedor_id: uuid,
    ufs: z.array(z.string().trim().length(2, 'UF tem 2 letras.')).default([]),
    faturamento_min: z.number().nonnegative().nullable().optional(),
    faturamento_max: z.number().nonnegative().nullable().optional(),
  })
  .refine((v) => !v.faturamento_min || !v.faturamento_max || v.faturamento_min <= v.faturamento_max, {
    message: 'O mínimo não pode ser maior que o máximo.',
    path: ['faturamento_max'],
  })
export type SalvarTerritorioInput = z.infer<typeof salvarTerritorioSchema>

/**
 * Parâmetros por tipo. SDR é valor por reunião; os outros dois, por milhão.
 *
 * Validar aqui evita o erro silencioso mais caro deste módulo: gravar
 * `valor_por_reuniao` numa regra de originador faz o cálculo não achar o parâmetro,
 * devolver null, e a pessoa simplesmente não receber — sem erro nenhum.
 */
export const salvarRegraSchema = z
  .object({
    tipo_vendedor: z.enum(TIPOS_VENDEDOR),
    vendedor_id: uuid.nullable().optional(),
    valor: z.number().positive('O valor tem de ser positivo.'),
    vigente_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .transform((v) => ({
    tipo_vendedor: v.tipo_vendedor,
    vendedor_id: v.vendedor_id ?? null,
    vigente_de: v.vigente_de,
    parametros:
      v.tipo_vendedor === 'sdr' ? { valor_por_reuniao: v.valor } : { valor_por_milhao: v.valor },
  }))
export type SalvarRegraInput = z.input<typeof salvarRegraSchema>

/** O nome do parâmetro que cada tipo usa — a tela rotula o campo com isto. */
export const PARAMETRO_DA_REGRA: Record<TipoVendedorId, { chave: string; rotulo: string }> = {
  sdr: { chave: 'valor_por_reuniao', rotulo: 'Valor por reunião agendada' },
  originador: { chave: 'valor_por_milhao', rotulo: 'Valor por milhão convertido' },
  vendedor: { chave: 'valor_por_milhao', rotulo: 'Valor por milhão de volume passivo' },
}

export const salvarAcessoSchema = z.object({
  vendedor_id: uuid,
  pode_ver_vendedor_id: uuid,
  conceder: z.boolean().default(true),
})
export type SalvarAcessoInput = z.infer<typeof salvarAcessoSchema>

export const salvarConfigSchema = z.object({
  chave: z.enum(['distribuicao', 'painel', 'passivos', 'comissao']),
  valor: z.record(z.unknown()),
})
export type SalvarConfigInput = z.infer<typeof salvarConfigSchema>

export const salvarMotivoSchema = z.object({
  id: uuid.optional(),
  contexto: z.enum(['funil_vendedor', 'sdr_sem_fit']),
  motivo: z.string().trim().min(2),
  ordem: z.number().int().optional(),
  ativo: z.boolean().optional(),
})
export type SalvarMotivoInput = z.infer<typeof salvarMotivoSchema>
