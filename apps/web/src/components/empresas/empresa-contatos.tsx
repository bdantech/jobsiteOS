'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Mail, MessageCircle, Phone, Star, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { definirPontoFocalAction } from '@/actions/antecipacao'
import { cn } from '@/lib/utils'
import { buscarContatos, empresasKeys } from './queries'

/**
 * Contatos da empresa, com a curadoria do PONTO FOCAL (§3.2).
 *
 * O ponto focal existe porque "melhor contato disponível" é um heurística, e um
 * heurística escolhe o estagiário do financeiro quando ele é o único com e-mail
 * preenchido. Marcar um ponto focal é a forma de um humano dizer "fale com esta
 * pessoa" — e a hierarquia inteira do sistema (outbox da Antecipação, botões de
 * contato no mobile) passa a respeitar isso.
 *
 * No máximo um por empresa, garantido por índice parcial único. Marcar outro
 * desmarca o anterior NA MESMA TRANSAÇÃO (RPC app_definir_ponto_focal): duas
 * chamadas do cliente deixariam uma janela em que a segunda falha e a empresa fica
 * sem ponto focal nenhum.
 */
export function EmpresaContatos({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient()
  const [marcando, setMarcando] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.contatos(empresaId),
    queryFn: () => buscarContatos(empresaId),
  })

  async function alternar(id: string, atual: boolean) {
    setMarcando(id)
    const r = await definirPontoFocalAction({ id, ponto_focal: !atual })
    setMarcando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(atual ? 'Ponto focal removido.' : 'Ponto focal definido.')
    void qc.invalidateQueries({ queryKey: empresasKeys.contatos(empresaId) })
    void qc.invalidateQueries({ queryKey: empresasKeys.eventos(empresaId) })
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar os contatos.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contatos</CardTitle>
        <CardDescription>
          O ponto focal é quem toda abordagem procura primeiro — outbox da Antecipação e botões de
          contato no app. Só um por empresa; marcar outro desmarca o anterior.
        </CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        {data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <UserRound className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Nenhum contato conhecido</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Contatos chegam pelo enriquecimento do Radar (lote de contatos) ou por importação de
                lista.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {data.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex flex-wrap items-start justify-between gap-3 px-6 py-4',
                  c.ponto_focal && 'bg-amber-50/60 dark:bg-amber-950/20',
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.nome ?? 'Sem nome'}</p>
                    {c.ponto_focal && (
                      <Badge className="gap-1 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                        <Star className="h-3 w-3 fill-current" aria-hidden />
                        Ponto focal
                      </Badge>
                    )}
                    {c.senioridade && <Badge variant="outline">{c.senioridade}</Badge>}
                  </div>

                  {c.cargo && <p className="text-sm text-muted-foreground">{c.cargo}</p>}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden />
                        {c.email}
                      </a>
                    )}
                    {c.telefone && (
                      <a
                        href={`tel:${c.telefone.replace(/\D/g, '')}`}
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {c.telefone}
                      </a>
                    )}
                    {c.whatsapp && (
                      <a
                        href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {c.whatsapp}
                      </a>
                    )}
                  </div>
                </div>

                <Button
                  variant={c.ponto_focal ? 'secondary' : 'outline'}
                  size="sm"
                  disabled={marcando === c.id}
                  onClick={() => void alternar(c.id, c.ponto_focal)}
                  aria-pressed={c.ponto_focal}
                >
                  <Star className={cn('mr-1 h-3.5 w-3.5', c.ponto_focal && 'fill-current')} aria-hidden />
                  {marcando === c.id
                    ? 'Salvando…'
                    : c.ponto_focal
                      ? 'Remover ponto focal'
                      : 'Definir ponto focal'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
