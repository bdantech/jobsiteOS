import pino from 'pino'
import { env } from './env.js'

/**
 * Secrets never reach a log line: the redact list covers the headers and fields
 * that could carry one, and no code path logs `env` itself.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  /**
   * O nível vai como RÓTULO ("error"), não como número (50).
   *
   * O pino emite o número por padrão, e o Railway não o traduz: um `logger.error` chegava
   * lá marcado como `severity: info`, igual a qualquer outra linha. Isso esvazia a única
   * coisa que um log de produção precisa entregar rápido — "me mostre só o que quebrou" —
   * e faz um job que falha todo dia parecer um job que roda todo dia.
   */
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'WORKER_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
    ],
    censor: '[redigido]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
})

export type Logger = pino.Logger
