'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, MessageSquare } from 'lucide-react'
import { criarNotaSchema } from '@jobsiteos/core'
import { criarNotaAction } from '@/actions/empresas'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDataHora, formatRelativo, iniciais } from './format'
import { buscarNotas, empresasKeys } from './queries'

function NotasCarregando() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmpresaNotas({ empresaId }: { empresaId: string }) {
  const [conteudo, setConteudo] = React.useState('')
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const queryClient = useQueryClient()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.notas(empresaId),
    queryFn: () => buscarNotas(empresaId),
  })

  async function adicionar(event: React.FormEvent) {
    event.preventDefault()

    const payload = { empresa_id: empresaId, conteudo }
    const parsed = criarNotaSchema.safeParse(payload)
    if (!parsed.success) {
      setErro(parsed.error.flatten().fieldErrors.conteudo?.[0] ?? 'Nota inválida.')
      return
    }

    setErro(null)
    setSalvando(true)
    const resultado = await criarNotaAction(payload)
    setSalvando(false)

    if (!resultado.ok) {
      setErro(resultado.fieldErrors?.conteudo?.[0] ?? resultado.message)
      return
    }

    setConteudo('')
    // criarNota also wrote a `nota.criada` event, so the timeline is stale too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: empresasKeys.notas(empresaId) }),
      queryClient.invalidateQueries({ queryKey: empresasKeys.eventos(empresaId) }),
    ])
    toast.success('Nota adicionada.')
  }

  const notas = data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notas</CardTitle>
        <CardDescription>
          O que a equipe sabe sobre esta empresa. Visível para todos com acesso ao módulo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <form onSubmit={adicionar} className="space-y-2">
          <Textarea
            value={conteudo}
            onChange={(event) => {
              setConteudo(event.target.value)
              if (erro) setErro(null)
            }}
            placeholder="Escreva uma nota…"
            rows={3}
            maxLength={5000}
            aria-invalid={erro !== null}
            aria-label="Nova nota"
            disabled={salvando}
          />
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-destructive" role="alert">
              {erro}
            </p>
            <Button type="submit" size="sm" disabled={salvando || conteudo.trim().length === 0}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Adicionar nota
            </Button>
          </div>
        </form>

        <Separator />

        {isPending ? (
          <NotasCarregando />
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Não foi possível carregar as notas</p>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro desconhecido.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : notas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="rounded-full bg-muted p-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm text-muted-foreground">
              Nenhuma nota ainda. Seja o primeiro a registrar algo.
            </p>
          </div>
        ) : (
          <ul className="space-y-5">
            {notas.map((nota) => {
              // A note outlives its author: autor_usuario_id has no FK to
              // `usuarios`, so a removed user leaves the note intact and nameless.
              const autor = nota.autor_nome ?? 'Usuário removido'
              return (
                <li key={nota.id} className="flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs">{iniciais(autor)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{autor}</span>
                      <time
                        dateTime={nota.criado_em}
                        title={formatDataHora(nota.criado_em)}
                        className="text-xs text-muted-foreground"
                      >
                        {formatRelativo(nota.criado_em)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm">{nota.conteudo}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
