'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Link2Off, X } from 'lucide-react'
import { CONFIG_COMUNICACAO_PADRAO } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { buscarConfig, contarNaoVinculadas } from './queries'

/**
 * A fila de identificação, destacada AO LOGAR e ao voltar depois de um tempo
 * fora (§4).
 *
 * ── POR QUE ELA MORA NA CASCA, E NÃO NUMA HOME ─────────────────────────────
 * O sistema não tem home: quem entra cai no primeiro módulo liberado. Uma
 * mensagem de um decisor que ninguém identificou é a forma mais barata de perder
 * um negócio, e ela não pode depender de a pessoa abrir a tela certa.
 *
 * ── O CONTADOR MUDOU DE LUGAR ──────────────────────────────────────────────
 * Havia um ícone com badge ao lado do sino, na barra do topo, e ele competia com
 * as notificações sem ser uma delas: dois contadores lado a lado, de coisas
 * diferentes, é como se ensina a não olhar nenhum dos dois. O contador agora fica
 * colado em "Não vinculadas", no menu da Comunicação — onde o número e o destino
 * do clique são a mesma coisa.
 *
 * O que sobra aqui é o ALERTA, que é outro problema: ele existe para alcançar
 * quem NÃO está na Comunicação. Aparece na primeira carga da sessão e quando a
 * pessoa volta depois da inatividade configurada (default 4h) — e some quando ela
 * o fecha. Um alerta grande que reaparece a cada render é um alerta que se aprende
 * a ignorar em dois dias.
 */

const CHAVE_ULTIMO_FOCO = 'jobsiteos.comunicacao.ultimo-foco'

function agoraMs(): number {
  return Date.now()
}

function lerUltimoFoco(): number | null {
  try {
    const v = window.sessionStorage.getItem(CHAVE_ULTIMO_FOCO)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function gravarUltimoFoco(): void {
  try {
    window.sessionStorage.setItem(CHAVE_ULTIMO_FOCO, String(agoraMs()))
  } catch {
    /* Sem armazenamento, o alerta aparece só na primeira carga. */
  }
}

export function AvisoNaoVinculadas({ temModulo }: { temModulo: boolean }) {
  const [alertaAberto, setAlertaAberto] = React.useState(false)

  const contagem = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem'],
    queryFn: contarNaoVinculadas,
    enabled: temModulo,
    // Volta a perguntar quando a aba ganha foco: é o mesmo gatilho do alerta.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })

  const config = useQuery({
    queryKey: ['comunicacao', 'config'],
    queryFn: buscarConfig,
    enabled: temModulo,
    staleTime: 10 * 60_000,
  })

  const horas = Number(
    (config.data?.inatividade_horas as number | undefined) ??
      CONFIG_COMUNICACAO_PADRAO.inatividade_horas,
  )

  // Primeira carga da sessão: o alerta abre. Depois, só quando a pessoa volta de
  // um tempo fora maior que a inatividade configurada.
  React.useEffect(() => {
    if (!temModulo) return
    const ultimo = lerUltimoFoco()
    if (ultimo === null) setAlertaAberto(true)
    gravarUltimoFoco()

    const aoFocar = () => {
      const anterior = lerUltimoFoco()
      gravarUltimoFoco()
      if (anterior !== null && agoraMs() - anterior > horas * 3_600_000) {
        setAlertaAberto(true)
      }
    }
    window.addEventListener('focus', aoFocar)
    return () => window.removeEventListener('focus', aoFocar)
  }, [temModulo, horas])

  const total = contagem.data ?? 0
  if (!temModulo || total === 0) return null

  if (!alertaAberto) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-amber-500/50 bg-background p-3 shadow-lg">
      <div className="flex items-start gap-3">
        <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {total} conversa{total === 1 ? '' : 's'} aguardando identificação
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Alguém falou com a gente e o sistema não soube quem é.
          </p>
          <Button size="sm" className="mt-2" asChild onClick={() => setAlertaAberto(false)}>
            <Link href="/comunicacao/nao-vinculadas">Identificar agora</Link>
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => setAlertaAberto(false)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">Fechar</span>
        </Button>
      </div>
    </div>
  )
}
