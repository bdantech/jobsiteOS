import { zodToJsonSchema } from 'zod-to-json-schema'
import { adminModule } from './modules/admin.js'
import { empresasModule } from './modules/empresas.js'
import { mercadoModule } from './modules/mercado.js'
import { notificacoesModule } from './modules/notificacoes.js'
import type { AppModule, ModuleTool } from './types.js'

export * from './types.js'

/**
 * The single registry. It drives four things at once — web nav, mobile nav,
 * permissions, and AI capabilities — so a new module is exactly: (1) migration,
 * (2) screens on both platforms, (3) one entry in this array.
 */
// Order is the sidebar order. Mercado sits before Empresas because it is where
// the funnel starts: you find a company in the market before you work it.
export const MODULES: readonly AppModule[] = [
  mercadoModule,
  empresasModule,
  adminModule,
  notificacoesModule,
]

export const MODULE_IDS = MODULES.map((m) => m.id)

export function getModule(id: string): AppModule | undefined {
  return MODULES.find((m) => m.id === id)
}

/** Modules the user's perfil grants. Drives the web sidebar. */
export function grantedModules(grantedIds: readonly string[]): AppModule[] {
  return MODULES.filter((m) => grantedIds.includes(m.id))
}

/** Same, minus webOnly modules. Drives the mobile tab bar and "Mais" grid. */
export function grantedMobileModules(grantedIds: readonly string[]): AppModule[] {
  return grantedModules(grantedIds).filter((m) => !m.webOnly)
}

/**
 * Route guard, shared by the web middleware and the mobile root layout.
 * Longest-prefix match, so /empresas/<id> resolves to the `empresas` module.
 */
export function moduleForRoute(route: string): AppModule | undefined {
  return MODULES.filter((m) => route === m.route || route.startsWith(`${m.route}/`)).sort(
    (a, b) => b.route.length - a.route.length,
  )[0]
}

export function canAccessRoute(route: string, grantedIds: readonly string[]): boolean {
  const module = moduleForRoute(route)
  // Routes outside any module (login, /settings) are not the registry's business.
  if (!module) return true
  return grantedIds.includes(module.id)
}

// ─── AI ─────────────────────────────────────────────────────────────────────

/** Every tool the user's granted modules expose. The AI Bar sees nothing else. */
export function grantedTools(grantedIds: readonly string[]): ModuleTool[] {
  return grantedModules(grantedIds).flatMap((m) => m.tools)
}

/**
 * Registry ids are dotted ("empresas.search"), but Anthropic constrains tool
 * names to ^[a-zA-Z0-9_-]{1,128}$ — a dot is a 400 on the whole request, before
 * the model ever runs. So the wire name is the id with dots swapped for `__`.
 *
 * Keep tool ids free of `__` and this stays a bijection.
 */
export function toAnthropicToolName(id: string): string {
  return id.replace(/\./g, '__')
}

export function fromAnthropicToolName(name: string): string {
  return name.replace(/__/g, '.')
}

export function findTool(id: string, grantedIds: readonly string[]): ModuleTool | undefined {
  // Accepts either form, so a caller holding a tool_use block straight off the
  // wire ("empresas__search") does not have to know about the mapping.
  const wanted = fromAnthropicToolName(id)
  // Looked up within the GRANTED set, never the full registry: a model that
  // hallucinates a tool id it wasn't offered must not find it.
  return grantedTools(grantedIds).find((t) => t.id === wanted)
}

export interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** zod → JSON Schema, in the shape the Anthropic Messages API expects. */
export function toAnthropicTools(tools: readonly ModuleTool[]): AnthropicTool[] {
  return tools.map((tool) => {
    const schema = zodToJsonSchema(tool.inputSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }) as Record<string, unknown>

    // Anthropic rejects $schema inside input_schema.
    delete schema.$schema

    return {
      name: toAnthropicToolName(tool.id),
      description: tool.description,
      input_schema: schema,
    }
  })
}

/** Compact catalog injected into the system prompt so the model knows its reach. */
export function toolCatalog(grantedIds: readonly string[]): string {
  return grantedModules(grantedIds)
    .map((m) => {
      // The wire name, not the dotted id: the catalog must not tempt the model
      // into calling a name that does not exist in the tools block.
      const tools = m.tools.map((t) => `    - ${toAnthropicToolName(t.id)}: ${t.name}`).join('\n')
      return `  ${m.name} (${m.route})${tools ? `\n${tools}` : ''}`
    })
    .join('\n')
}
