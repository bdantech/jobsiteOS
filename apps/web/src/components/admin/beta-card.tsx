'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FlaskConical, Loader2 } from 'lucide-react'
import { BETA_PADRAO } from '@jobsiteos/core'
import { definirBetaAction } from '@/actions/reports'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { reportsKeys } from '@/components/reports/queries'

/**
 * O interruptor do modo beta (04m §5).
 *
 * A PRÉ-VISUALIZAÇÃO NÃO É ENFEITE. A tarja aparece para a empresa inteira no
 * instante em que este botão é salvo — não há rascunho, não há "só para mim". Ver
 * como fica antes de salvar é a única chance de perceber que o texto está pela
 * metade, e sem isso o primeiro leitor do erro é a companhia toda.
 */
export function BetaCard({ inicial }: { inicial: { habilitado: boolean; texto: string } }) {
  const qc = useQueryClient()
  const [habilitado, setHabilitado] = React.useState(inicial.habilitado)
  const [texto, setTexto] = React.useState(inicial.texto || BETA_PADRAO.texto)

  const salvar = useMutation({
    mutationFn: async () => {
      const r = await definirBetaAction({ habilitado, texto })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success(habilitado ? 'Modo beta ligado.' : 'Modo beta desligado.', {
        description: 'A tarja reflete em todas as sessões abertas, sem novo login.',
      })
      // A própria sessão de quem salvou também lê o estado pelo Realtime, mas o
      // invalidate garante o reflexo imediato mesmo se o socket estiver caído.
      void qc.invalidateQueries({ queryKey: reportsKeys.beta() })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  })

  const textoLimpo = texto.trim()
  const invalido = habilitado && textoLimpo.length === 0
  const mudou = habilitado !== inicial.habilitado || textoLimpo !== inicial.texto.trim()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" aria-hidden />
          Modo beta
        </CardTitle>
        <CardDescription>
          Uma tarja fixa no topo de todas as telas, na web e no celular. Sem botão de
          fechar: é o estado da plataforma, não um aviso que cada um dispensa quando quer.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="beta-habilitado" className="cursor-pointer">
            Mostrar a tarja para todo mundo
          </Label>
          <Switch id="beta-habilitado" checked={habilitado} onCheckedChange={setHabilitado} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="beta-texto">Texto</Label>
          <Input
            id="beta-texto"
            value={texto}
            maxLength={200}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={BETA_PADRAO.texto}
          />
          <p className="text-xs text-muted-foreground">
            {texto.length}/200 — precisa caber numa linha em telas de celular.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prévia</p>
          <div
            className="flex items-center justify-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-900 dark:text-amber-200"
            aria-hidden
          >
            <FlaskConical className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{textoLimpo || BETA_PADRAO.texto}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button disabled={!mudou || invalido || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Salvar
          </Button>
        </div>
        {invalido && (
          <p className="text-right text-xs text-destructive">
            Ligar sem texto deixaria uma tarja vazia no topo de todas as telas.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
