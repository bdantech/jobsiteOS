import pino from 'pino'
import { env } from './env.js'

/**
 * Secrets never reach a log line: the redact list covers the headers and fields
 * that could carry one, and no code path logs `env` itself.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
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
