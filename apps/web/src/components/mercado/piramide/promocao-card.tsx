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
import { promoverAgoraAction } from '@/actions/mercado-promocao'
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
  const [promovendo, setPromovendo] = React.useState(false)

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
          ? 'Nenhuma empresa será promovida. A promoção só acontece quando você clica em Promover.'
          : `Ao clicar em Promover, tudo que estiver em ${resultado.data.toUpperCase()} ou acima entra na base.`,
    })
  }

  async function promoverAgora() {
    setPromovendo(true)
    const resultado = await promoverAgoraAction()
    setPromovendo(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    toast.success('Promoção iniciada.', { description: resultado.message, duration: 8000 })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Promoção para Empresas</CardTitle>
        <CardDescription>
          A partir de qual camada uma empresa do universo pode entrar na base de Empresas (ganhando
          timeline, notas e eventos). A promoção NÃO é mais automática: escolha o limiar e clique em
          Promover para levar quem ainda não está na base. Quem já foi promovido continua — isto não
          remove ninguém.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={valor}
          onValueChange={(v) => setValor(v as PromocaoCamada)}
          disabled={salvando || promovendo}
        >
          <SelectTrigger className="sm:max-w-xs" aria-label="Camada de promoção">
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

        <Button
          type="button"
          variant="outline"
          onClick={() => void salvar()}
          disabled={!alterado || salvando || promovendo}
        >
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Salvar limiar
        </Button>

        <Button
          type="button"
          onClick={() => void promoverAgora()}
          disabled={salvando || promovendo || alterado || valorAtual === 'manual'}
          className="sm:ml-auto"
        >
          {promovendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Promover agora
        </Button>
      </CardContent>
    </Card>
  )
}
