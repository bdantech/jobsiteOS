'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  PROMOCAO_CAMADA_LABELS,
  promocaoCamadaSchema,
  type PromocaoCamada,
} from '@jobsiteos/core'
import { definirCamadaPromocaoAction } from '@/actions/mercado-regras'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** The four values, in pyramid order, straight from the schema core validates against. */
const CAMADAS_PROMOCAO = promocaoCamadaSchema.options

/**
 * The promotion threshold (§5.1): which layer auto-promotes a universe row into
 * `empresas`, where it gains a timeline, notes and events.
 *
 * Promotion is one-way in practice — a promoted company keeps its history even
 * if it later falls out of the layer — so raising the threshold does NOT unpromote
 * anyone. The copy says so, because "SOM" looks like a way to shrink `empresas`
 * and it is not.
 */

interface PromocaoCardProps {
  valorAtual: PromocaoCamada
}

export function PromocaoCard({ valorAtual }: PromocaoCardProps) {
  const [valor, setValor] = React.useState<PromocaoCamada>(valorAtual)
  const [salvando, setSalvando] = React.useState(false)

  // The server is the source of truth: a save elsewhere (or a failed save here)
  // must not leave this select showing a value nobody stored.
  React.useEffect(() => {
    setValor(valorAtual)
  }, [valorAtual])

  const alterado = valor !== valorAtual

  async function salvar() {
    setSalvando(true)
    const resultado = await definirCamadaPromocaoAction(valor)
    setSalvando(false)

    if (!resultado.ok) {
      setValor(valorAtual)
      toast.error(resultado.message)
      return
    }

    toast.success('Camada de promoção atualizada.', {
      description:
        resultado.data === 'manual'
          ? 'Nenhuma empresa será promovida automaticamente. A promoção passa a ser só manual.'
          : `A próxima reclassificação promove tudo que chegar em ${resultado.data.toUpperCase()}.`,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Promoção automática</CardTitle>
        <CardDescription>
          A partir de qual camada uma empresa do universo entra na base de Empresas, ganhando
          timeline, notas e eventos. Quem já foi promovido continua promovido — subir o limiar não
          remove ninguém.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={valor}
          onValueChange={(v) => setValor(v as PromocaoCamada)}
          disabled={salvando}
        >
          <SelectTrigger className="sm:max-w-md" aria-label="Camada de promoção">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAMADAS_PROMOCAO.map((camada) => (
              <SelectItem key={camada} value={camada}>
                {PROMOCAO_CAMADA_LABELS[camada]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button type="button" onClick={() => void salvar()} disabled={!alterado || salvando}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Salvar
        </Button>
      </CardContent>
    </Card>
  )
}
