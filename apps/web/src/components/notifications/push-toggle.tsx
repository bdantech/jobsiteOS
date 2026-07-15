'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { registrarPushWebSchema } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  enviarNotificacaoDeTeste,
  registrarPushWeb,
  removerPushWeb,
} from '@/actions/notificacoes'

/**
 * VAPID keys are base64url; PushManager wants raw bytes. atob deals in standard
 * base64, so the alphabet has to be translated and the padding restored.
 *
 * Returns the ArrayBuffer rather than the Uint8Array view: `BufferSource` is
 * `ArrayBufferView<ArrayBuffer> | ArrayBuffer`, and a bare `new Uint8Array(n)`
 * types as `Uint8Array<ArrayBufferLike>` (ArrayBufferLike admits
 * SharedArrayBuffer), which does not satisfy it.
 */
function base64UrlParaBytes(base64Url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return buffer
}

type Estado =
  | 'verificando'
  | 'nao_suportado'
  | 'nao_configurado'
  | 'bloqueado'
  | 'inativo'
  | 'ativo'

const CHAVE_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

async function registrarServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  // register() resolves as soon as the SW is registered, which can be before it
  // is active. pushManager.subscribe() on an installing worker throws.
  await navigator.serviceWorker.ready
  return registration
}

export function PushToggle() {
  const [estado, setEstado] = React.useState<Estado>('verificando')
  const [ocupado, setOcupado] = React.useState(false)
  const [testando, setTestando] = React.useState(false)

  React.useEffect(() => {
    let cancelado = false

    const verificar = async () => {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        // Notably: iOS Safari only exposes PushManager to installed PWAs.
        if (!cancelado) setEstado('nao_suportado')
        return
      }

      if (CHAVE_PUBLICA === undefined || CHAVE_PUBLICA.length === 0) {
        if (!cancelado) setEstado('nao_configurado')
        return
      }

      if (Notification.permission === 'denied') {
        if (!cancelado) setEstado('bloqueado')
        return
      }

      try {
        const registration = await registrarServiceWorker()
        const inscricao = await registration.pushManager.getSubscription()
        if (!cancelado) setEstado(inscricao === null ? 'inativo' : 'ativo')
      } catch {
        if (!cancelado) setEstado('nao_suportado')
      }
    }

    void verificar()
    return () => {
      cancelado = true
    }
  }, [])

  const ativar = async () => {
    if (CHAVE_PUBLICA === undefined) return
    setOcupado(true)

    try {
      const permissao = await Notification.requestPermission()
      if (permissao !== 'granted') {
        setEstado(permissao === 'denied' ? 'bloqueado' : 'inativo')
        toast.error('Permissão negada', {
          description: 'Autorize as notificações no navegador para ativar o push.',
        })
        return
      }

      const registration = await registrarServiceWorker()

      // Reuse the browser's existing subscription when there is one: calling
      // subscribe() twice with the same key returns the same subscription, but
      // an old subscription made with a DIFFERENT key throws instead.
      const existente = await registration.pushManager.getSubscription()
      const inscricao =
        existente ??
        (await registration.pushManager.subscribe({
          // Chrome requires this: every push must result in a visible notification.
          userVisibleOnly: true,
          applicationServerKey: base64UrlParaBytes(CHAVE_PUBLICA),
        }))

      const parsed = registrarPushWebSchema.safeParse(inscricao.toJSON())
      if (!parsed.success) {
        await inscricao.unsubscribe()
        toast.error('O navegador devolveu uma inscrição inválida.')
        setEstado('inativo')
        return
      }

      const resultado = await registrarPushWeb(parsed.data)
      if (!resultado.ok) {
        // Don't leave a live browser subscription the server doesn't know about:
        // it would receive nothing and the toggle would lie about being on.
        await inscricao.unsubscribe()
        toast.error(resultado.erro)
        setEstado('inativo')
        return
      }

      setEstado('ativo')
      toast.success('Notificações push ativadas neste dispositivo.')
    } catch {
      setEstado('inativo')
      toast.error('Não foi possível ativar as notificações push.')
    } finally {
      setOcupado(false)
    }
  }

  const desativar = async () => {
    setOcupado(true)

    try {
      const registration = await navigator.serviceWorker.ready
      const inscricao = await registration.pushManager.getSubscription()

      if (inscricao !== null) {
        // Server first: if we unsubscribed the browser and then failed to tell
        // the server, it would keep pushing to a dead endpoint forever.
        const resultado = await removerPushWeb(inscricao.endpoint)
        if (!resultado.ok) {
          toast.error(resultado.erro)
          return
        }
        await inscricao.unsubscribe()
      }

      setEstado('inativo')
      toast.success('Notificações push desativadas neste dispositivo.')
    } catch {
      toast.error('Não foi possível desativar as notificações push.')
    } finally {
      setOcupado(false)
    }
  }

  const testar = async () => {
    setTestando(true)
    try {
      const resultado = await enviarNotificacaoDeTeste()
      if (!resultado.ok) {
        toast.error(resultado.erro)
        return
      }
      toast.success('Notificação de teste enviada.', {
        description:
          resultado.webPushEnviados > 0
            ? 'Ela deve aparecer no sino e como push neste dispositivo.'
            : 'Ela aparece no sino. Ative o push para recebê-la também fora do app.',
      })
    } catch {
      toast.error('Não foi possível enviar a notificação de teste.')
    } finally {
      setTestando(false)
    }
  }

  if (estado === 'verificando') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
    )
  }

  const indisponivel =
    estado === 'nao_suportado' || estado === 'nao_configurado' || estado === 'bloqueado'

  const descricao: Record<Estado, string> = {
    verificando: '',
    nao_suportado:
      'Este navegador não suporta notificações push. No iOS, adicione o JobsiteOS à tela de início.',
    nao_configurado: 'O push não está configurado neste ambiente (VAPID ausente).',
    bloqueado:
      'As notificações estão bloqueadas para este site. Libere-as nas permissões do navegador.',
    inativo: 'Receba avisos mesmo com o JobsiteOS fechado.',
    ativo: 'Ativado neste dispositivo. Cada navegador precisa ser ativado separadamente.',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="push-web" className="text-sm font-medium">
            Notificações push
          </Label>
          <p className="text-sm text-muted-foreground">{descricao[estado]}</p>
        </div>
        <Switch
          id="push-web"
          checked={estado === 'ativo'}
          disabled={indisponivel || ocupado}
          onCheckedChange={(marcado) => void (marcado ? ativar() : desativar())}
          aria-label="Ativar notificações push neste dispositivo"
        />
      </div>

      <Button variant="outline" size="sm" onClick={() => void testar()} disabled={testando}>
        <Send className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
        {testando ? 'Enviando…' : 'Enviar notificação de teste'}
      </Button>
    </div>
  )
}
