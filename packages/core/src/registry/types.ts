import type { SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import type { Database } from '../types/database.js'

export type Supabase = SupabaseClient<Database>

/**
 * Everything a tool needs to act *as the calling user*.
 *
 * `supabase` is deliberately the user-scoped (anon-key + session) client, never
 * the service-role one: tools run with RLS applied, so a tool cannot reach data
 * the user could not reach by hand. A tool that needs to escalate must say so
 * explicitly by taking its own client — none currently do.
 */
export interface ToolContext {
  userId: string
  supabase: Supabase
}

export interface ModuleTool<TInput = unknown, TOutput = unknown> {
  /** Stable, dotted, unique across all modules. e.g. "empresas.search" */
  id: string
  /** Human label, pt-BR. Shown in the AI Bar's tool-activity line. */
  name: string
  /** Becomes the Anthropic tool description — write it for the model, not for a human. */
  description: string
  /** Converted to JSON Schema for Anthropic, and used to validate before execute(). */
  inputSchema: z.ZodType<TInput>
  /** Server-only. Never call this from a client bundle. */
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>
  /** If true, the AI must get explicit user confirmation before executing. */
  mutates: boolean
}

export interface AppModule {
  /** Matches perfil_modulos.modulo_id in the database. */
  id: string
  name: string
  /** Icon token, resolved per platform: lucide-react (web) / lucide-react-native (mobile). */
  icon: string
  /** Web route. Mobile maps it onto its own navigator via the linking config. */
  route: string
  tools: ModuleTool[]
  /**
   * Module has no mobile implementation. Mobile navigation must skip it, and the
   * mobile route guard must refuse it even if a deep link points there.
   */
  webOnly?: boolean
}
