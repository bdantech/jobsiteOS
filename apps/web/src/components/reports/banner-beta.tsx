'use client'

import { FlaskConical } from 'lucide-react'
import { useBeta } from './use-beta'

/**
 * A tarja de beta (§5): fundo âmbar discreto, texto curto, SEM botão de fechar.
 *
 * A ausência do "x" é a decisão que dá sentido ao componente. Isto não é uma
 * notificação — é o estado da plataforma. Se desse para fechar, cada pessoa veria
 * uma coisa diferente e o aviso deixaria de significar "você está usando um
 * sistema em beta" para significar "você ainda não clicou no x".
 *
 * `role="status"`, não `alert`: leitores de tela anunciam sem interromper o que
 * a pessoa está fazendo — que é exatamente a intenção de um aviso permanente.
 */
export function BannerBeta() {
  const beta = useBeta()
  if (!beta.habilitado) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-900 dark:text-amber-200"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">{beta.texto}</span>
    </div>
  )
}
