import 'server-only'

import {
  ESTAGIO_LABELS,
  TIPO_EMPRESA_LABELS,
  findTool,
  formatCnpj,
  isValidCnpj,
  type ModuleTool,
} from '@jobsiteos/core'
import type { AiConfirmField, AiLink, AiToolUseBlock } from './protocol'

/**
 * What the server decided to do with one tool_use block the model produced.
 *
 * A plan is derived *purely* from (tool_use block + the caller's granted module
 * ids), never from server memory. That is what makes the confirmation round-trip
 * work across two stateless HTTP requests: the resume call recomputes the exact
 * same plan from the same transcript.
 */
export type ToolPlan =
  /** Hallucinated id, or a real tool the user's perfil does not grant. */
  | { kind: 'unknown'; block: AiToolUseBlock }
  /** The tool exists, but the model's input does not satisfy its own zod schema. */
  | { kind: 'invalid'; block: AiToolUseBlock; tool: ModuleTool; message: string }
  /** Read-only. Safe to run without asking. */
  | { kind: 'run'; block: AiToolUseBlock; tool: ModuleTool; input: unknown }
  /** mutates: true. Runs ONLY after an explicit user decision for this exact tool_use id. */
  | { kind: 'confirm'; block: AiToolUseBlock; tool: ModuleTool; input: unknown }

/**
 * findTool() is scoped to the granted set, so a hallucinated — or simply
 * ungranted — tool id resolves to nothing and lands in `unknown`. That is the
 * whole permission check: there is no path from a tool name in a model response
 * to an execute() the user isn't entitled to.
 */
export function planToolUse(block: AiToolUseBlock, grantedModuleIds: string[]): ToolPlan {
  const tool = findTool(block.name, grantedModuleIds)
  if (!tool) return { kind: 'unknown', block }

  // Validate with the tool's OWN schema before executing. The JSON Schema we
  // hand Anthropic is advisory; this is the enforcement — and it also applies
  // the schema's transforms (CNPJ normalisation, defaults) so execute() gets
  // exactly the shape it declared.
  const parsed = tool.inputSchema.safeParse(block.input)
  if (!parsed.success) {
    const message = parsed.error.errors
      .map((e) => `${e.path.join('.') || 'entrada'}: ${e.message}`)
      .join('; ')
    return { kind: 'invalid', block, tool, message }
  }

  return {
    kind: tool.mutates ? 'confirm' : 'run',
    block,
    tool,
    input: parsed.data,
  }
}

export function planToolUses(blocks: AiToolUseBlock[], grantedModuleIds: string[]): ToolPlan[] {
  return blocks.map((block) => planToolUse(block, grantedModuleIds))
}

// ─── Presentation of tool inputs and outputs ────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  cnpj: 'CNPJ',
  razao_social: 'Razão social',
  nome_fantasia: 'Nome fantasia',
  tipo: 'Tipo',
  estagio: 'Estágio',
  uf: 'UF',
  municipio: 'Município',
  cnae_principal: 'CNAE principal',
  porte: 'Porte',
  erp_atual: 'ERP atual',
  erp_mrr: 'MRR do ERP',
  erp_canal_venda: 'Canal de venda do ERP',
  termo: 'Termo',
  limite: 'Limite',
  corpo: 'Conteúdo',
  empresa_id: 'Empresa',
}

function humanizeKey(key: string): string {
  const label = FIELD_LABELS[key]
  if (label) return label
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') {
    return key === 'erp_mrr'
      ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : String(value)
  }
  if (typeof value !== 'string') return JSON.stringify(value)

  if (key === 'cnpj' && isValidCnpj(value)) return formatCnpj(value)
  if (key === 'estagio' && value in ESTAGIO_LABELS) {
    return ESTAGIO_LABELS[value as keyof typeof ESTAGIO_LABELS]
  }
  if (key === 'tipo' && value in TIPO_EMPRESA_LABELS) {
    return TIPO_EMPRESA_LABELS[value as keyof typeof TIPO_EMPRESA_LABELS]
  }
  return value
}

/** The staged input of a mutating tool, rendered for the Confirmar/Cancelar card. */
export function confirmFields(input: unknown): AiConfirmField[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  return Object.entries(input as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({ label: humanizeKey(key), value: formatValue(key, value) }))
}

/** One pt-BR line for the tool-activity row. Never the raw payload. */
export function summarizeToolResult(result: unknown): string {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const record = result as Record<string, unknown>
    if (typeof record.total === 'number') {
      return record.total === 1 ? '1 resultado' : `${record.total} resultados`
    }
    if (typeof record.razao_social === 'string') return record.razao_social
  }
  if (Array.isArray(result)) {
    return result.length === 1 ? '1 resultado' : `${result.length} resultados`
  }
  return 'Concluído'
}

const LINK_LABEL_KEYS = ['razao_social', 'nome_fantasia', 'nome', 'titulo'] as const

/**
 * Pulls navigable records out of a tool result: any object carrying a `route`
 * string. Tools opt in simply by including `route` (empresas.search does), so
 * navigation needs no per-tool wiring here — a future module gets it for free.
 */
export function collectLinks(result: unknown, depth = 0, acc: AiLink[] = []): AiLink[] {
  if (depth > 4 || acc.length >= 12 || result === null || typeof result !== 'object') return acc

  if (Array.isArray(result)) {
    for (const item of result) collectLinks(item, depth + 1, acc)
    return acc
  }

  const record = result as Record<string, unknown>
  if (typeof record.route === 'string' && record.route.startsWith('/')) {
    const labelKey = LINK_LABEL_KEYS.find((key) => typeof record[key] === 'string')
    const label = labelKey ? String(record[labelKey]) : record.route
    if (!acc.some((link) => link.route === record.route)) {
      acc.push({ route: record.route, label })
    }
  }

  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') collectLinks(value, depth + 1, acc)
  }
  return acc
}

const MAX_TOOL_RESULT_CHARS = 8_000

/** Tool output as the model sees it. Truncated so one fat result can't blow the context. */
export function serializeToolResult(result: unknown): string {
  const json = JSON.stringify(result ?? null)
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json
  return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [resultado truncado: use filtros mais específicos]`
}
