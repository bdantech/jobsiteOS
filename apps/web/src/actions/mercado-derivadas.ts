'use server'

import { getSessionContext, isAdmin } from '@/lib/auth'
import { dispararDerivadas } from '@/lib/mercado/worker'

/**
 * Recalcula SPEs, grupos econômicos e métricas sobre o que já está ingerido.
 *
 * Arquivo próprio com UM export, pela mesma disciplina de `mercado-worker.ts`: todo
 * export de um módulo 'use server' é um endpoint público, e um arquivo com um export só
 * é um arquivo em que a checagem de admin não tem como ser esquecida.
 *
 * Por que existe: as três derivadas só rodavam encadeadas na importação da Receita. Em
 * 10/08/2026 a Receita passou a publicar o sócio PJ com 8 dígitos (a raiz) em vez de 14,
 * o filtro das derivadas exigia 14, e o grafo de grupos desabou — a Pride caiu de 398
 * membros para 23. Corrigir o filtro sem poder recalcular significaria esperar a próxima
 * importação mensal, ou refazer 100 milhões de linhas para reexecutar um cálculo de
 * minutos.
 */
export type DerivadasResult = { ok: true; message: string } | { ok: false; message: string }

export async function recalcularDerivadasAction(): Promise<DerivadasResult> {
  const context = await getSessionContext()
  if (!context || !isAdmin(context)) {
    return { ok: false, message: 'Só um admin recalcula as derivadas do Mercado.' }
  }

  const r = await dispararDerivadas()
  return r.ok
    ? {
        ok: true,
        message: 'Recálculo disparado: SPEs, grupos econômicos e métricas. Leva alguns minutos.',
      }
    : { ok: false, message: r.message }
}
