'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CornerDownLeft,
  Hourglass,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAiChat, type AiItem } from './use-ai-chat'

/**
 * How a result the AI surfaced gets opened.
 *
 * The shell owns the Zustand tab store, so it injects this — typically
 * `(route, label) => openTab({ route, title: label })`. Left out, we fall back
 * to a plain router.push, which keeps the AI Bar usable (and testable) on its
 * own instead of hard-coupling it to the shell's store shape.
 */
export type OpenRoute = (route: string, label: string) => void

export interface AiBarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRoute?: OpenRoute
}

const SUGESTOES = [
  'Quantas empresas estão no estágio lead?',
  'Busque a construtora com CNPJ 12.345.678/0001-95',
  'Liste os fornecedores de SP',
]

export function AiBar({ open, onOpenChange, onOpenRoute }: AiBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { items, status, error, send, decide, reset } = useAiChat(pathname)
  const [draft, setDraft] = useState('')

  const bottom = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [items, status])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const streaming = status === 'streaming'
  const awaitingConfirmation = status === 'awaiting_confirmation'
  const blocked = streaming || awaitingConfirmation

  function submit(text: string) {
    if (blocked) return
    setDraft('')
    void send(text)
  }

  function openRoute(route: string, label: string) {
    if (onOpenRoute) onOpenRoute(route, label)
    else router.push(route)
    onOpenChange(false)
  }

  // Nothing rendered yet for this turn: the model is thinking, not silent.
  const showThinking =
    streaming && items[items.length - 1]?.kind !== 'assistant'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[8%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="h-4 w-4 text-brand" aria-hidden />
          <DialogTitle className="text-sm font-medium">Assistente</DialogTitle>
          <DialogDescription className="sr-only">
            Converse com a IA do JobsiteOS. Ela usa apenas os módulos liberados para você.
          </DialogDescription>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto mr-6 h-7 gap-1.5 text-xs text-muted-foreground"
              onClick={reset}
              disabled={streaming}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Nova conversa
            </Button>
          )}
        </div>

        <div className="max-h-[55vh] min-h-[8rem] space-y-3 overflow-y-auto px-4 py-4">
          {items.length === 0 && !error ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pergunte sobre a sua carteira, peça para abrir uma empresa ou para cadastrar uma
                nova. Ações que gravam dados sempre pedem sua confirmação.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGESTOES.map((sugestao) => (
                  <button
                    key={sugestao}
                    type="button"
                    onClick={() => submit(sugestao)}
                    className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {sugestao}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {items.map((item) => (
            <AiItemRow key={item.key} item={item} onDecide={decide} onOpenRoute={openRoute} />
          ))}

          {showThinking ? (
            <div className="space-y-2" aria-label="A IA está respondendo" aria-live="polite">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          <div ref={bottom} />
        </div>

        <Separator />

        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit(draft)
          }}
        >
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={blocked}
            placeholder={
              awaitingConfirmation
                ? 'Confirme ou cancele a ação acima para continuar…'
                : 'Pergunte alguma coisa…'
            }
            className="border-0 shadow-none focus-visible:ring-0"
            aria-label="Mensagem para a IA"
          />
          <Button
            type="submit"
            size="sm"
            disabled={blocked || draft.trim().length === 0}
            className="gap-1.5"
          >
            {streaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
            )}
            Enviar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface AiItemRowProps {
  item: AiItem
  onDecide: (id: string, approved: boolean) => void
  onOpenRoute: OpenRoute
}

function AiItemRow({ item, onDecide, onOpenRoute }: AiItemRowProps) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
            {item.text}
          </p>
        </div>
      )

    case 'assistant':
      return <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.text}</p>

    case 'tool':
      return (
        <div className="space-y-1.5">
          <div
            className={cn(
              'flex items-center gap-2 text-xs',
              item.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {item.status === 'running' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : item.status === 'pending' ? (
              <Hourglass className="h-3.5 w-3.5" aria-hidden />
            ) : item.status === 'ok' ? (
              <Check className="h-3.5 w-3.5 text-brand" aria-hidden />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            )}
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span>
              {item.label}
              {item.status === 'running' ? '…' : ''}
              {item.status === 'pending' ? ' — aguardando confirmação' : ''}
              {item.summary ? ` — ${item.summary}` : ''}
            </span>
          </div>

          {item.links.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pl-6">
              {item.links.map((link) => (
                <button
                  key={link.route}
                  type="button"
                  onClick={() => onOpenRoute(link.route, link.label)}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:border-brand hover:text-brand"
                >
                  {link.label}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )

    case 'confirm':
      return (
        <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
          <p className="text-sm font-medium">{item.question}</p>

          {item.fields.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              {item.fields.map((field) => (
                <div key={field.label} className="contents">
                  <dt className="text-muted-foreground">{field.label}</dt>
                  <dd className="font-medium">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {item.status === 'pending' ? (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => onDecide(item.id, true)}>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => onDecide(item.id, false)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Cancelar
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {item.status === 'confirmed' ? 'Confirmado por você.' : 'Cancelado por você.'}
            </p>
          )}
        </div>
      )
  }
}
