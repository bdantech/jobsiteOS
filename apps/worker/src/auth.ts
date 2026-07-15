import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { env } from './env.js'

/**
 * Bearer WORKER_SECRET on every route.
 *
 * `fornecido === esperado` would be a timing oracle: string comparison in V8
 * short-circuits on the first differing byte, so an attacker can measure their way
 * to the secret one character at a time. Comparing SHA-256 digests instead gives
 * two buffers of the same, fixed length — timingSafeEqual throws on mismatched
 * lengths, which would otherwise leak the secret's length — and the comparison
 * takes the same time whatever the input.
 */
export function segredoConfere(fornecido: string, esperado: string): boolean {
  const a = createHash('sha256').update(fornecido, 'utf8').digest()
  const b = createHash('sha256').update(esperado, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export function exigirSegredo(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? ''
  const [esquema, token] = header.split(' ')

  if (esquema?.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ erro: 'Autenticação obrigatória.' })
    return
  }

  if (!segredoConfere(token, env.WORKER_SECRET)) {
    res.status(401).json({ erro: 'Credencial inválida.' })
    return
  }

  next()
}
