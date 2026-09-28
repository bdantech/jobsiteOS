import 'server-only'

import type { NextResponse } from 'next/server'
import { autorizarCron } from './auth'
import { execucaoCron, type ExecucaoCronEmCurso } from '@/lib/cron-execucao'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Toda rota de /api/cron/* passa por aqui: abre uma linha em `cron_execucoes` ANTES de
 * falar com o worker, e a fecha pelo que aconteceu (0272).
 *
 * Existe por causa de 28/09/2026: o worker estava fora do ar, a distribuição semanal
 * de SDR recebeu 502, e como o estado dos jobs vive na memória do worker, não sobrou
 * rastro nenhum. Com a linha aberta aqui, worker caído vira `falhou` com o motivo.
 *
 * Como a linha fecha:
 *   - rota respondeu erro          → `falhou`, com o `erro` do corpo;
 *   - worker recusou com 409       → `pulada` (o disparo anterior ainda roda);
 *   - worker assumiu o job         → fica `executando`, e o WORKER a fecha no fim;
 *   - qualquer outro sucesso       → `concluida` (o disparo foi aceito).
 *
 * NOT a route file — Next only treats `route.ts` as an endpoint.
 *
 * Registrar é best-effort: se o banco não aceitar a linha, a rotina roda do mesmo
 * jeito. Deixar de disparar a distribuição porque o registro falhou seria trocar um
 * problema de observação por um de verdade.
 */
export function comRegistro(
  handler: (request: Request) => Promise<NextResponse>,
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    // Chamada não autorizada não é execução: o próprio handler devolve o 401, e uma
    // varredura da internet não enche a tabela.
    if (!autorizarCron(request).ok) return handler(request)

    const path = new URL(request.url).pathname
    const admin = createAdminClient()

    const { data } = await admin.from('cron_execucoes').insert({ path }).select('id').single()
    if (!data) return handler(request)

    const ctx: ExecucaoCronEmCurso = { id: data.id, acompanhado: false, jobId: null, pulada: false }

    let resposta: NextResponse
    try {
      resposta = await execucaoCron.run(ctx, () => handler(request))
    } catch (erro) {
      await fechar(admin, ctx.id, 'falhou', erro instanceof Error ? erro.message : String(erro))
      throw erro
    }

    const corpo = (await resposta
      .clone()
      .json()
      .catch(() => null)) as { ok?: boolean; erro?: unknown } | null

    if (ctx.pulada) {
      await fechar(admin, ctx.id, 'pulada', motivo(corpo))
    } else if (resposta.status >= 400 || corpo?.ok === false) {
      await fechar(admin, ctx.id, 'falhou', motivo(corpo) ?? `A rota respondeu ${resposta.status}.`)
    } else if (ctx.acompanhado) {
      // Não mexe no status: o worker pode ter terminado (e fechado a linha) antes
      // desta resposta chegar aqui.
      await admin
        .from('cron_execucoes')
        .update({ acompanhado: true, job_id: ctx.jobId })
        .eq('id', ctx.id)
    } else {
      await fechar(admin, ctx.id, 'concluida', null)
    }

    return resposta
  }
}

function motivo(corpo: { erro?: unknown } | null): string | null {
  return typeof corpo?.erro === 'string' && corpo.erro ? corpo.erro.slice(0, 2000) : null
}

async function fechar(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  status: 'concluida' | 'falhou' | 'pulada',
  erro: string | null,
): Promise<void> {
  await admin
    .from('cron_execucoes')
    .update({ status, erro, terminado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'executando')
}
