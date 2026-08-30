'use client'

import * as React from 'react'
import { ExternalLink, Home, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * O botão de um toque (05A §5): "Enviar pela conta da casa" ou "Abrir no meu
 * WhatsApp".
 *
 * ── AS DUAS CONTINUAM EXISTINDO, E ISSO É DELIBERADO ───────────────────────
 * Enviar pela casa grava no ledger, passa pelo portão e mantém a thread. Abrir no
 * app é mais rápido, mais pessoal e continua sendo o certo para uma conversa que
 * já é íntima — e ele continua registrando o toque (`app_toque`), com a semântica
 * honesta de "o app abriu", não "a mensagem saiu".
 *
 * Tirar a segunda forçaria o vendedor a escolher entre o sistema e o jeito dele
 * de trabalhar, e nessa escolha o sistema perde: ele abriria o WhatsApp por fora
 * e o toque não seria registrado em lugar nenhum.
 *
 * ── A ESCOLHA É LEMBRADA POR USUÁRIO, EM `localStorage` ────────────────────
 * É preferência de interface por dispositivo, não configuração da casa: quem
 * trabalha no desktop com o WhatsApp Web aberto quer uma coisa; quem está no
 * celular quer outra. Guardá-la no servidor faria a preferência do desktop
 * atravessar para o telefone.
 */

const CHAVE = 'jobsiteos.comunicacao.preferencia-envio'
type Preferencia = 'casa' | 'app'

function lerPreferencia(): Preferencia {
  if (typeof window === 'undefined') return 'casa'
  try {
    const v = window.localStorage.getItem(CHAVE)
    return v === 'app' ? 'app' : 'casa'
  } catch {
    // Navegador com armazenamento bloqueado: a casa é o default, porque é o
    // caminho que deixa rastro.
    return 'casa'
  }
}

function gravarPreferencia(p: Preferencia): void {
  try {
    window.localStorage.setItem(CHAVE, p)
  } catch {
    /* Sem armazenamento, a escolha vale só para este clique. */
  }
}

export function BotaoDeToque({
  link,
  rotulo,
  onEnviarPelaCasa,
  onAbriuNoApp,
}: {
  /** `wa.me`, `tel:` ou `mailto:` — o caminho "meu app". */
  link: string
  rotulo: string
  /** Abre o compositor. Ausente = só o caminho do app (sem empresa vinculada). */
  onEnviarPelaCasa?: () => void
  /** Registra o `app_toque` no ledger. */
  onAbriuNoApp?: () => void
}) {
  const [preferencia, setPreferencia] = React.useState<Preferencia>('casa')
  React.useEffect(() => setPreferencia(lerPreferencia()), [])

  const abrirApp = () => {
    onAbriuNoApp?.()
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  if (!onEnviarPelaCasa) {
    return (
      <Button variant="ghost" size="sm" onClick={abrirApp}>
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {rotulo}
      </Button>
    )
  }

  const principal = preferencia === 'casa' ? onEnviarPelaCasa : abrirApp

  return (
    <div className="flex items-center">
      <Button variant="outline" size="sm" className="rounded-r-none" onClick={principal}>
        {preferencia === 'casa' ? (
          <Home className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        ) : (
          <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        {preferencia === 'casa' ? 'Enviar pela casa' : rotulo}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-l-none border-l-0 px-2">
            ▾<span className="sr-only">Escolher como enviar</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setPreferencia('casa')
              gravarPreferencia('casa')
              onEnviarPelaCasa()
            }}
          >
            <Home className="mr-2 h-3.5 w-3.5" aria-hidden />
            Enviar pela conta da casa
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setPreferencia('app')
              gravarPreferencia('app')
              abrirApp()
            }}
          >
            <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden />
            {rotulo}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
