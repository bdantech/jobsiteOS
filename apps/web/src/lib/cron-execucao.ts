import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * A execução de cron em curso nesta requisição (0272).
 *
 * `comRegistro` abre a linha em `cron_execucoes` e roda a rota dentro deste contexto;
 * `postar()` o lê para levar o id ao worker e anota aqui o que o worker respondeu. Um
 * contexto em vez de um parâmetro porque o caminho entre as duas pontas passa por
 * cinquenta funções `disparar…` que não têm nada a ver com isso.
 */
export interface ExecucaoCronEmCurso {
  id: string
  /** O worker assumiu o job e vai fechar a linha quando ele terminar. */
  acompanhado: boolean
  jobId: string | null
  /** O worker recusou com 409: o disparo anterior da mesma rotina ainda roda. */
  pulada: boolean
}

export const execucaoCron = new AsyncLocalStorage<ExecucaoCronEmCurso>()
