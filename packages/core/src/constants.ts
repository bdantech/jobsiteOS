/**
 * ONE OS navy. The single brand colour across web (shadcn) and mobile (NativeWind).
 *
 * It is very dark — hsl(220, 35%, 18%) — which is why it is the SIDEBAR surface in
 * both themes rather than a primary element in dark mode: against the dark-mode
 * background it contrasts at 1.37:1, and the WCAG floor for a UI element is 3:1.
 * The dark theme keeps the hue (220°) and lifts the lightness to 66%. See
 * apps/web/src/app/globals.css.
 */
export const BRAND_ACCENT = '#1e293f'

/** Anthropic model behind the AI Bar on both platforms. */
export const AI_MODEL = 'claude-sonnet-4-6'

/** Cap on tool-use round trips in one AI turn, so a tool loop can't run away. */
export const AI_MAX_TOOL_ROUNDS = 8

/** Event types emitted so far. Each module appends its own. */
export const EVENTO_TIPOS = {
  // Fundação
  EMPRESA_CRIADA: 'empresa.criada',
  ESTAGIO_ALTERADO: 'estagio.alterado',
  NOTA_CRIADA: 'nota.criada',

  // Mercado
  CAMADA_ALTERADA: 'camada.alterada',
  EMPRESA_PROMOVIDA: 'empresa.promovida',
  MERCADO_INGESTAO_CONCLUIDA: 'mercado.ingestao_concluida',
  MERCADO_INGESTAO_FALHOU: 'mercado.ingestao_falhou',
  IMPORTACAO_CONCLUIDA: 'importacao.concluida',
  IMPORTACAO_REVISAO_PENDENTE: 'importacao.revisao_pendente',

  // Radar (enriquecimento)
  DOMINIO_RESOLVIDO: 'dominio.resolvido',
  CONTATOS_ENRIQUECIDOS: 'contatos.enriquecidos',
  PROTESTO_DETECTADO: 'protesto.detectado',
  PROTESTO_AGRAVADO: 'protesto.agravado',
  GRUPO_PROTESTO_AGRAVADO: 'grupo.protesto_agravado',
  LOTE_AGUARDANDO_APROVACAO: 'lote.aguardando_aprovacao',
  LOTE_CONCLUIDO: 'lote.concluido',
  ORCAMENTO_ALERTA: 'orcamento.alerta',
  ORCAMENTO_ESTOURADO: 'orcamento.estourado',
  CLIENTE_NOVO_DETECTADO: 'cliente.novo_detectado',
  CLIENTE_DORMENTE: 'cliente.dormente',
  CLIENTE_LIMITE_QUASE_ESGOTADO: 'cliente.limite_quase_esgotado',
  CLIENTE_STATUS_OPERACIONAL_ALTERADO: 'cliente.status_operacional_alterado',
  CLIENTE_REATIVADO: 'cliente.reativado',
} as const

export type EventoTipo = (typeof EVENTO_TIPOS)[keyof typeof EVENTO_TIPOS]

/**
 * pt-BR labels for the Company 360 timeline and the notifications bell.
 *
 * The Mercado events with no empresa_id (ingestão, importação) are SYSTEM events:
 * they carry `payload.titulo` and `payload.url`, which the fan-out trigger
 * (migration 0014) prefers over the company-derived title.
 */
export const EVENTO_LABELS: Record<string, string> = {
  'empresa.criada': 'Empresa criada',
  'estagio.alterado': 'Estágio alterado',
  'nota.criada': 'Nota adicionada',
  'camada.alterada': 'Camada alterada',
  'empresa.promovida': 'Promovida do universo',
  'mercado.ingestao_concluida': 'Ingestão concluída',
  'mercado.ingestao_falhou': 'Ingestão falhou',
  'importacao.concluida': 'Importação concluída',
  'importacao.revisao_pendente': 'Importação aguardando revisão',
  'dominio.resolvido': 'Domínio resolvido',
  'contatos.enriquecidos': 'Contatos enriquecidos',
  'protesto.detectado': 'Protesto detectado',
  'protesto.agravado': 'Protesto agravado',
  'grupo.protesto_agravado': 'Protesto do grupo agravado',
  'lote.aguardando_aprovacao': 'Lote aguardando aprovação',
  'lote.concluido': 'Lote concluído',
  'orcamento.alerta': 'Orçamento em alerta',
  'orcamento.estourado': 'Orçamento estourado',
  'cliente.novo_detectado': 'Novo cliente detectado',
  'cliente.dormente': 'Cliente dormente',
  'cliente.limite_quase_esgotado': 'Limite quase esgotado',
  'cliente.status_operacional_alterado': 'Status operacional alterado',
  'cliente.reativado': 'Cliente reativado',
}

/** Which layer auto-promotes into `empresas`. Settings override it (§5.1). */
export const CAMADA_PROMOCAO_PADRAO = 'sam'
