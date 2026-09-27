'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Um parâmetro da URL como estado — `?m=<id>` abre o modal do mandato, `?proposta=<id>`
 * destaca uma proposta.
 *
 * O modal NUNCA troca de página (padrão do 04p): quem está olhando o Ao vivo num monitor
 * não pode perder o feed para ver um mandato. Mas o mandato tem de ser LINKÁVEL — é o
 * link que vai na notificação de escalação e no evento da empresa
 * (`/agentes/mandatos?m=<id>`, gravado pela RPC). Por isso `router.replace`, e não
 * `push`: abrir e fechar dez mandatos não deixa dez entradas no botão Voltar.
 */
export function useParamDaUrl(chave: string): readonly [string | null, (valor: string | null) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const valor = params.get(chave)

  const definir = React.useCallback(
    (novo: string | null) => {
      const p = new URLSearchParams(params.toString())
      if (novo) p.set(chave, novo)
      else p.delete(chave)
      const qs = p.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [chave, params, pathname, router],
  )

  return [valor, definir] as const
}
