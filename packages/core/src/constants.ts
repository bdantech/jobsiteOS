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
}

/** Which layer auto-promotes into `empresas`. Settings override it (§5.1). */
export const CAMADA_PROMOCAO_PADRAO = 'sam'
