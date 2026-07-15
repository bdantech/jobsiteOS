/**
 * POST /api/ai — the single AI backend. Web (cookie session) and mobile
 * (Authorization: Bearer <access_token>, because Expo has no cookies) both call
 * THIS route. The mobile client implements the same protocol described below.
 *
 * ── REQUEST ────────────────────────────────────────────────────────────────
 *   {
 *     messages: AiMessage[],                  // full transcript; see lib/ai/protocol.ts
 *     route?: string,                         // "/empresas/<id>" (web) or screen name (mobile)
 *     decisions?: Record<string, boolean>     // ONLY on a resume turn: tool_use id → confirmed?
 *   }
 *
 * The route is STATELESS: the client owns the transcript and replays it every
 * turn. Everything the server needs to resume a confirmation is derivable from
 * (transcript + decisions), so nothing is parked server-side between requests.
 *
 * ── RESPONSE ───────────────────────────────────────────────────────────────
 * text/event-stream. Frames are `event: <type>\ndata: <json>\n\n`, and `type` is
 * repeated inside the JSON so a client can just discriminate on the parsed body.
 *
 *   text              { delta }                                  assistant text, token by token
 *   tool_start        { id, tool, label, mutates }               "🔎 buscando empresas…"
 *   tool_result       { id, tool, label, ok, summary, links }    links[] = { route, label } → navigation
 *   confirm_required  { id, tool, label, question, fields }      a mutating tool is STAGED, not run
 *   message           { message }                                append verbatim to the transcript
 *   done              { stop }                                   end_turn | awaiting_confirmation | max_rounds
 *   error             { message }                                terminal; the stream ends after it
 *
 * ── THE CONFIRMATION HANDSHAKE (mutates: true) ─────────────────────────────
 * A mutating tool (empresas.create) is NEVER executed in the request that
 * proposes it. When the model asks for one, the server holds back the ENTIRE
 * tool round (read-only tools in the same round included — see run.ts), emits
 * `confirm_required` for each mutating call, and ends the turn with
 * `done { stop: "awaiting_confirmation" }`.
 *
 * The client shows Confirmar/Cancelar and then POSTs again with:
 *   - `messages`: the transcript INCLUDING the assistant turn carrying those
 *     tool_use blocks (it arrived as a `message` event), and
 *   - `decisions`: { "<tool_use id>": true|false } for every id it was asked about.
 *
 * The server recomputes the same plan from that transcript, runs the confirmed
 * calls, turns the cancelled ones into is_error tool_results ("o usuário
 * cancelou"), and continues the loop. A decision for an id that isn't pending is
 * ignored; a missing decision re-triggers `confirm_required` — absent consent is
 * never consent.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Tools offered = toAnthropicTools(grantedTools(grantedModuleIds)) — the caller's
 * granted tools only. Resolution goes through findTool(id, grantedModuleIds), so
 * a hallucinated or ungranted tool id simply is not found and comes back as an
 * is_error tool_result. Every input is re-validated against the tool's own zod
 * schema before execute(), and execute() receives the USER-SCOPED Supabase
 * client — so RLS applies to everything the model does.
 */
import { NextResponse } from 'next/server'
import { encodeAiEvent, aiRequestSchema, type AiEvent } from '@/lib/ai/protocol'
import { runAiTurn } from '@/lib/ai/run'
import { resolveAiSession } from '@/lib/ai/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Agentic loops with up to AI_MAX_TOOL_ROUNDS tool rounds outlive the 15s default. */
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  const session = await resolveAiSession(request)
  if (!session) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const parsed = aiRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Requisição inválida.' },
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AiEvent) => controller.enqueue(encoder.encode(encodeAiEvent(event)))

      try {
        for await (const event of runAiTurn({
          session,
          messages: parsed.data.messages,
          route: parsed.data.route,
          decisions: parsed.data.decisions ?? {},
          signal: request.signal,
        })) {
          send(event)
        }
      } catch (error) {
        // The client hung up (closed the AI Bar mid-answer): nothing to report.
        if (request.signal.aborted) {
          controller.close()
          return
        }
        console.error('[ai] turn failed', error)
        send({
          type: 'error',
          message: 'Falha ao falar com a IA. Tente novamente em instantes.',
        })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx/Vercel edge buffering would defeat the whole point of streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}
