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
// A ordem É a coluna do kanban. `sem_fit`, `no_show` e `desqualificada` ficam no fim
// porque são saídas, não etapas — misturá-las na sequência faria a régua de progresso
// mentir sobre onde o lead está.

export const ESTAGIOS_SDR = [
  'a_contatar',
  'em_conversa',
  'com_fit',
  'reuniao_agendada',
  'reuniao_realizada',
  'qualificada',
  'no_show',
  'sem_fit',
  'desqualificada',
] as const
export type EstagioSdr = (typeof ESTAGIOS_SDR)[number]

export const ESTAGIO_SDR_LABELS: Record<EstagioSdr, string> = {
  a_contatar: 'A contatar',
  em_conversa: 'Em conversa',
  com_fit: 'Com fit',
  reuniao_agendada: 'Reunião agendada',
  reuniao_realizada: 'Reunião realizada',
  qualificada: 'Qualificada',
  no_show: 'No-show',
  sem_fit: 'Sem fit',
  desqualificada: 'Desqualificada',
}

/** Saiu do funil: não conta como carga do SDR nem volta na distribuição. */
export const ESTAGIOS_SDR_ENCERRADOS: readonly EstagioSdr[] = ['sem_fit', 'desqualificada', 'qualificada']

export function leadEstaVivo(estagio: string): boolean {
  return !(ESTAGIOS_SDR_ENCERRADOS as readonly string[]).includes(estagio)
}

// ─── Funil do vendedor ──────────────────────────────────────────────────────

export const ESTAGIOS_VENDA = [
  'reuniao_agendada',
  'reuniao_reagendada',
  'aguardando_documentacao',
  'em_analise_credito',
  'proposta_enviada',
  'preparacao_mou',
  'mou_assinado',
  'onboarding',
  'ganho',
  'perdido',
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
  ganho: 'Ganho',
  perdido: 'Perdido',
}

export const ESTAGIOS_VENDA_ENCERRADOS: readonly EstagioVenda[] = ['ganho', 'perdido']

export function vendaEstaViva(estagio: string): boolean {
  return !(ESTAGIOS_VENDA_ENCERRADOS as readonly string[]).includes(estagio)
}

/**
 * A decisão da seguradora move o card sozinha — menos quando ela é parcial.
 *
 * Aprovada e negada são inequívocas, e deixar o vendedor mover à mão só adiciona atraso
 * entre a decisão e a próxima ação. Parcial não é: metade do limite pedido pode ser
 * ótimo ou inviável dependendo da operação, e essa leitura é de quem está na mesa.
 */
export function estagioAposDecisaoCredito(decisao: string): EstagioVenda | null {
  if (decisao === 'aprovada') return 'proposta_enviada'
  if (decisao === 'negada') return 'perdido'
  return null
}

// ─── Contratos das mutações ─────────────────────────────────────────────────

const uuid = z.string().uuid()

export const definirGestaoSchema = z.object({
  empresa_id: uuid,
  gestao_operacao: z.enum(GESTOES_OPERACAO).nullable(),
  /** Obrigatório ao marcar passiva: passiva sem gestor é conta órfã com rótulo. */
  vendedor_gestao_id: uuid.nullable().optional(),
})
export type DefinirGestaoInput = z.infer<typeof definirGestaoSchema>

export const definirCarteiraSchema = z.object({
  empresa_id: uuid,
  papel: z.enum(PAPEIS_CARTEIRA),
  /** null libera a empresa: encerra a vigência sem abrir outra. */
  vendedor_id: uuid.nullable(),
})
export type DefinirCarteiraInput = z.infer<typeof definirCarteiraSchema>

export const moverLeadSchema = z
  .object({
    lead_id: uuid,
    estagio: z.enum(ESTAGIOS_SDR),
    sem_fit_motivo: uuid.nullable().optional(),
    reuniao_em: z.string().datetime({ offset: true }).nullable().optional(),
    vendedor_destino_id: uuid.nullable().optional(),
  })
  // As duas validações que o banco também faz. Aqui existem para a mensagem chegar ao
  // formulário no campo certo, em vez de voltar como exceção genérica do Postgres.
  .refine((v) => v.estagio !== 'sem_fit' || !!v.sem_fit_motivo, {
    message: 'Sem fit exige motivo.',
    path: ['sem_fit_motivo'],
  })
  .refine((v) => v.estagio !== 'reuniao_agendada' || (!!v.reuniao_em && !!v.vendedor_destino_id), {
    message: 'Agendar exige data e vendedor destino.',
    path: ['reuniao_em'],
  })
export type MoverLeadInput = z.infer<typeof moverLeadSchema>

export const moverVendaSchema = z
  .object({
    venda_id: uuid,
    estagio: z.enum(ESTAGIOS_VENDA),
    perdido_motivo: uuid.nullable().optional(),
    analise_credito_id: uuid.nullable().optional(),
  })
  .refine((v) => v.estagio !== 'perdido' || !!v.perdido_motivo, {
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
