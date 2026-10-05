'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { salvarAtalhos } from '@/actions/atalhos'
import type { VisaoDoUsuario } from '@/components/shell/abas-dos-modulos'

/**
 * Os atalhos fixados, vivos no cliente.
 *
 * Três lugares mexem neles — o alfinete da sidebar, o da barra de abas e a tela de
 * configurações — e os três precisam ver a mudança na hora, inclusive a sidebar que
 * está na tela enquanto a pessoa clica em Configurações. Por isso o estado mora no
 * shell, acima de todos, e não em cada um.
 *
 * A gravação é OTIMISTA: a sidebar muda no clique, e só volta atrás (com aviso) se o
 * servidor recusar. Esperar a ida e volta para um alfinete aparecer é o tipo de atraso
 * que faz a pessoa clicar de novo — e desfazer o que acabou de fazer.
 */

interface AtalhosContexto {
  fixados: readonly string[]
  visao: VisaoDoUsuario
  estaFixado: (href: string) => boolean
  alternar: (href: string) => void
  remover: (href: string) => void
  mover: (href: string, delta: -1 | 1) => void
}

const Contexto = React.createContext<AtalhosContexto | null>(null)

export function useAtalhos(): AtalhosContexto {
  const ctx = React.useContext(Contexto)
  if (!ctx) throw new Error('useAtalhos fora do AtalhosProvider')
  return ctx
}

const MAXIMO = 20

export function AtalhosProvider({
  iniciais,
  visao,
  children,
}: {
  iniciais: readonly string[]
  visao: VisaoDoUsuario
  children: React.ReactNode
}) {
  const [fixados, setFixados] = React.useState<readonly string[]>(iniciais)
  // A última lista CONFIRMADA pelo servidor: é para ela que se volta quando uma
  // gravação falha, e não para "o estado antes deste clique" — com dois cliques em voo,
  // aquele já seria uma lista que nunca existiu no banco.
  const confirmados = React.useRef<readonly string[]>(iniciais)
  // Gravações em sequência, nunca em paralelo: duas requisições concorrentes podem
  // chegar fora de ordem, e a lista mais velha venceria a mais nova.
  const fila = React.useRef<Promise<void>>(Promise.resolve())

  const gravar = React.useCallback((proxima: readonly string[]) => {
    setFixados(proxima)
    fila.current = fila.current.then(async () => {
      const r = await salvarAtalhos([...proxima])
      if (r.ok) {
        confirmados.current = r.atalhos
        return
      }
      setFixados(confirmados.current)
      toast.error(r.erro)
    })
  }, [])

  const valor = React.useMemo<AtalhosContexto>(() => {
    const estaFixado = (href: string) => fixados.includes(href)
    return {
      fixados,
      visao,
      estaFixado,
      alternar: (href) => {
        if (estaFixado(href)) {
          gravar(fixados.filter((h) => h !== href))
          return
        }
        if (fixados.length >= MAXIMO) {
          toast.error(`Dá para fixar até ${MAXIMO} atalhos. Desafixe algum antes.`)
          return
        }
        gravar([...fixados, href])
      },
      remover: (href) => gravar(fixados.filter((h) => h !== href)),
      mover: (href, delta) => {
        const i = fixados.indexOf(href)
        const j = i + delta
        if (i === -1 || j < 0 || j >= fixados.length) return
        const proxima = [...fixados]
        ;[proxima[i], proxima[j]] = [proxima[j]!, proxima[i]!]
        gravar(proxima)
      },
    }
  }, [fixados, visao, gravar])

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
