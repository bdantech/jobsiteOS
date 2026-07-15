import 'server-only'

import Anthropic from '@anthropic-ai/sdk'
import {
  AI_MAX_TOOL_ROUNDS,
  AI_MODEL,
  MutationError,
  fromAnthropicToolName,
  grantedTools,
  toAnthropicTools,
  type ToolContext,
} from '@jobsiteos/core'
import type {
  AiContentBlock,
  AiEvent,
  AiMessage,
  AiToolUseBlock,
} from './protocol'
import type { AiSession } from './session'
import { buildSystemPrompt } from './system-prompt'
import {
  collectLinks,
  confirmFields,
  planToolUses,
  serializeToolResult,
  summarizeToolResult,
  type ToolPlan,
} from './tools'

const MAX_OUTPUT_TOKENS = 2048

/**
 * @anthropic-ai/sdk 0.32 has no exported union for "a block you may send back"
 * (only the response-side `ContentBlock`), so name the three we actually emit.
 */
type AnthropicBlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam

export interface RunAiTurnOptions {
  session: AiSession
  messages: AiMessage[]
  route?: string
  /** tool_use id → user's verdict. Only present on a resume turn. */
  decisions: Record<string, boolean>
  signal: AbortSignal
}

/** Our wire blocks → Anthropic's. Same shape; this is just the type crossing. */
function toAnthropicMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map((block): AnthropicBlockParam => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text }
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          }
      }
    }),
  }))
}

/** Anthropic's assistant blocks → ours, so the client can replay them next turn. */
function toAiContentBlocks(content: Anthropic.ContentBlock[]): AiContentBlock[] {
  const blocks: AiContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') blocks.push({ type: 'text', text: block.text })
    else if (block.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    }
  }
  return blocks
}

function toolUseBlocksOf(content: Anthropic.ContentBlock[]): AiToolUseBlock[] {
  return content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    .map((block) => ({ type: 'tool_use', id: block.id, name: block.name, input: block.input }))
}

function errorResult(id: string, message: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: id, content: message, is_error: true }
}

/**
 * Runs one AI turn and streams it as protocol events.
 *
 * Statelessness is the design constraint: a mutating tool cannot be executed in
 * the same request that proposes it (the user hasn't seen it yet), and there is
 * no server-side session to park it in. So the turn simply *ends* at the
 * confirmation, and the follow-up request recomputes the identical plan from the
 * transcript plus `decisions`. Nothing about what will run is carried in client
 * state — the client only carries a yes/no keyed by tool_use id.
 */
export async function* runAiTurn(options: RunAiTurnOptions): AsyncGenerator<AiEvent> {
  const { session, decisions, signal } = options
  const ids = session.grantedModuleIds

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não está configurada.')

  const anthropic = new Anthropic({ apiKey })
  const messages = toAnthropicMessages(options.messages)

  // The model is offered the granted tools ONLY. A tool from a module this
  // perfil doesn't grant is never described to it, and — via findTool in
  // planToolUse — could not be executed even if it guessed the name.
  const tools = grantedTools(ids)
  const anthropicTools: Anthropic.Tool[] = toAnthropicTools(tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as unknown as Anthropic.Tool.InputSchema,
  }))

  const system = buildSystemPrompt({
    nome: session.nome,
    perfil: session.perfil,
    route: options.route,
    grantedModuleIds: ids,
  })

  const ctx: ToolContext = { userId: session.userId, supabase: session.supabase }

  /**
   * Executes a round of plans and appends the tool_result turn.
   *
   * Every tool_use block MUST get a tool_result back — the API rejects a turn
   * with a dangling one — so failures, refusals and cancellations all come back
   * as `is_error` results rather than being dropped.
   */
  async function* executePlans(plans: ToolPlan[]): AsyncGenerator<AiEvent> {
    const results: Anthropic.ToolResultBlockParam[] = []

    for (const plan of plans) {
      const id = plan.block.id
      const tool = plan.kind === 'unknown' ? undefined : plan.tool
      const label = tool?.name ?? plan.block.name

      yield {
        type: 'tool_start',
        id,
        // The registry id ("empresas.search"), not the wire name Anthropic saw
        // ("empresas__search" — dots are illegal in a tool name). Clients key off
        // the canonical id; the `__` form is an artefact of the API boundary and
        // should not escape it.
        tool: tool?.id ?? fromAnthropicToolName(plan.block.name),
        label,
        mutates: tool?.mutates ?? false,
      }

      if (plan.kind === 'unknown') {
        const message = `Ferramenta "${plan.block.name}" não existe ou não está liberada para este usuário.`
        results.push(errorResult(id, message))
        yield { type: 'tool_result', id, tool: plan.block.name, label, ok: false, summary: message, links: [] }
        continue
      }

      if (plan.kind === 'invalid') {
        const message = `Entrada inválida para ${plan.tool.name}: ${plan.message}`
        results.push(errorResult(id, message))
        yield { type: 'tool_result', id, tool: plan.block.name, label, ok: false, summary: message, links: [] }
        continue
      }

      if (plan.kind === 'confirm' && decisions[id] !== true) {
        // Reached when the user pressed Cancelar (false) — and, defensively, if a
        // decision went missing: absent consent is never consent.
        const message =
          'O usuário cancelou esta ação. Não execute de novo sem um novo pedido explícito dele.'
        results.push(errorResult(id, message))
        yield {
          type: 'tool_result',
          id,
          tool: plan.block.name,
          label,
          ok: false,
          summary: 'Cancelado pelo usuário',
          links: [],
        }
        continue
      }

      try {
        const output = await plan.tool.execute(plan.input, ctx)
        results.push({ type: 'tool_result', tool_use_id: id, content: serializeToolResult(output) })
        yield {
          type: 'tool_result',
          id,
          tool: plan.block.name,
          label,
          ok: true,
          summary: summarizeToolResult(output),
          links: collectLinks(output),
        }
      } catch (error) {
        // MutationError messages are written for humans and are safe to show.
        // Anything else is an internal failure: log it, don't leak it.
        const message =
          error instanceof MutationError
            ? error.message
            : `Falha ao executar ${plan.tool.name}. Tente novamente.`
        if (!(error instanceof MutationError)) {
          console.error(`[ai] tool ${plan.block.name} failed`, error)
        }
        results.push(errorResult(id, message))
        yield { type: 'tool_result', id, tool: plan.block.name, label, ok: false, summary: message, links: [] }
      }
    }

    messages.push({ role: 'user', content: results })
    yield {
      type: 'message',
      message: {
        role: 'user',
        content: results.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.tool_use_id,
          content: typeof result.content === 'string' ? result.content : '',
          is_error: result.is_error,
        })),
      },
    }
  }

  // ── Resume: the transcript ends on an assistant turn that asked for tools ──
  // The client is coming back with the user's verdicts. Re-derive the plans and
  // run the round that was held back.
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant' && Array.isArray(last.content)) {
    const pending = last.content
      .filter((block): block is Anthropic.ToolUseBlockParam => block.type === 'tool_use')
      .map((block): AiToolUseBlock => ({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      }))

    if (pending.length > 0) {
      const plans = planToolUses(pending, ids)
      const undecided = plans.filter(
        (plan) => plan.kind === 'confirm' && !(plan.block.id in decisions),
      )

      if (undecided.length > 0) {
        // The client resumed without deciding everything. Ask again rather than
        // guessing — and never default a mutation to "yes".
        for (const plan of undecided) {
          if (plan.kind !== 'confirm') continue
          yield {
            type: 'confirm_required',
            id: plan.block.id,
            tool: plan.block.name,
            label: plan.tool.name,
            question: `A IA quer executar "${plan.tool.name}" — confirmar?`,
            fields: confirmFields(plan.input),
          }
        }
        yield { type: 'done', stop: 'awaiting_confirmation' }
        return
      }

      yield* executePlans(plans)
    }
  }

  // ── Agentic loop ──────────────────────────────────────────────────────────
  for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round++) {
    const stream = anthropic.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      },
      { signal },
    )

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', delta: event.delta.text }
      }
    }

    const final = await stream.finalMessage()
    messages.push({ role: 'assistant', content: final.content })
    yield { type: 'message', message: { role: 'assistant', content: toAiContentBlocks(final.content) } }

    if (final.stop_reason !== 'tool_use') {
      yield { type: 'done', stop: 'end_turn' }
      return
    }

    const plans = planToolUses(toolUseBlocksOf(final.content), ids)

    // If ANY tool in this round mutates, the whole round is held back — nothing
    // runs, not even the read-only tools alongside it. That keeps the resume
    // path a pure recomputation (no half-executed round to reconcile) and means
    // a mutation is never executed in the same request that proposed it.
    const needsConfirmation = plans.filter((plan) => plan.kind === 'confirm')

    if (needsConfirmation.length > 0) {
      for (const plan of plans) {
        yield {
          type: 'tool_start',
          id: plan.block.id,
          tool: plan.kind === 'unknown' ? fromAnthropicToolName(plan.block.name) : plan.tool.id,
          label: plan.kind === 'unknown' ? plan.block.name : plan.tool.name,
          mutates: plan.kind === 'confirm',
        }
      }
      for (const plan of needsConfirmation) {
        if (plan.kind !== 'confirm') continue
        yield {
          type: 'confirm_required',
          id: plan.block.id,
          tool: plan.block.name,
          label: plan.tool.name,
          question: `A IA quer executar "${plan.tool.name}" — confirmar?`,
          fields: confirmFields(plan.input),
        }
      }
      yield { type: 'done', stop: 'awaiting_confirmation' }
      return
    }

    yield* executePlans(plans)
  }

  // Ran out of rounds with the model still asking for tools.
  yield { type: 'done', stop: 'max_rounds' }
}
