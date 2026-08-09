'use client'

import * as React from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

/**
 * Recarrega algumas queries por um tempo, depois para.
 *
 * Existe porque quase toda ação cara desta ficha é ASSÍNCRONA: o worker responde 202
 * e trabalha em segundo plano. Invalidar uma vez, no clique, não adianta — o dado
 * ainda não existe. Sem isso, o toast diz "recarregue em alguns instantes" e a pessoa
 * recarrega a página na mão, o que sempre foi um pedido de desculpas disfarçado de
 * instrução.
 *
 * O intervalo NÃO é adaptativo de propósito: consultar o Apollo leva segundos, o
 * DirectD leva mais, e um backoff esperto erraria os dois de formas diferentes.
 * Recarregar a cada 5s por um minuto cobre os dois casos e custa uma consulta leve.
 */
export function usePollInvalidar(chaves: readonly QueryKey[]) {
  const qc = useQueryClient()
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // As chaves entram na renderização como array novo a cada render; guardar numa ref
  // evita recriar o callback (e reiniciar o polling) sem que nada tenha mudado.
  const chavesRef = React.useRef(chaves)
  chavesRef.current = chaves

  const parar = React.useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  // Sair da tela no meio do polling não pode deixar um intervalo rodando contra um
  // componente desmontado.
  React.useEffect(() => parar, [parar])

  const iniciar = React.useCallback(
    (vezes = 12, intervaloMs = 5_000) => {
      parar()
      let n = 0
      timer.current = setInterval(() => {
        n++
        for (const chave of chavesRef.current) void qc.invalidateQueries({ queryKey: chave })
        if (n >= vezes) parar()
      }, intervaloMs)
    },
    [parar, qc],
  )

  return { iniciar, parar }
}
