'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { definirExClienteMotivoAction } from '@/actions/radar'
import { buscarExCliente, buscarMotivosSaida, radarKeys } from '@/components/radar/queries'
import { empresasKeys } from './queries'
import { formatData } from './format'

/**
 * Por que este cliente saiu — na ficha, e não só na lista (04h §2).
 *
 * O sync detecta a SAÍDA (a última análise aprovada venceu e ninguém renovou) e
 * grava "Motivo desconhecido". O porquê é conhecimento humano, e quem o tem quase
 * sempre é quem está abrindo esta ficha para entender o histórico da empresa antes
 * de uma ligação — pedir que essa pessoa vá até outra tela para registrar o que
 * acabou de lembrar é como o motivo continua desconhecido.
 *
 * O card só existe quando o estágio é `ex_cliente`. Mostrá-lo em cliente ativo
 * sugeriria uma perda que não houve.
 */
export function ExClienteMotivo({
  empresaId,
  desde,
  motivoId,
  observacao,
}: {
  empresaId: string
  desde: string | null
  motivoId: string | null
  observacao: string | null
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState<string | null>(motivoId)
  const [obs, setObs] = React.useState(observacao ?? '')
  const [salvando, setSalvando] = React.useState(false)

  const { data: motivos } = useQuery({
    queryKey: radarKeys.motivosSaida(),
    queryFn: buscarMotivosSaida,
    staleTime: 60 * 60_000,
  })

  // A linha da view traz a SUGESTÃO com a evidência — calculada, nunca gravada.
  const { data: linha } = useQuery({
    queryKey: radarKeys.exCliente(empresaId),
    queryFn: () => buscarExCliente(empresaId),
  })

  const naoClassificado = !motivoId || linha?.ex_cliente_motivo_label === 'Motivo desconhecido'
  const sugestao = naoClassificado && linha?.motivo_sugerido ? linha : null

  const sujo = motivo !== motivoId || obs.trim() !== (observacao ?? '')

  async function salvar() {
    if (!motivo) return
    setSalvando(true)
    const r = await definirExClienteMotivoAction({
      empresa_id: empresaId,
      motivo_id: motivo,
      observacao: obs.trim() || null,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Motivo registrado.')
    void qc.invalidateQueries({ queryKey: empresasKeys.detalhe(empresaId) })
    void qc.invalidateQueries({ queryKey: radarKeys.all })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base">Saída do cliente</CardTitle>
        </div>
        <CardDescription>
          {desde ? (
            <>
              A última análise de crédito aprovada venceu em{' '}
              <strong>{formatData(desde)}</strong> e não foi renovada.{' '}
            </>
          ) : null}
          O sistema detecta o fato; o motivo é conhecimento de quem acompanhou a conta — e é o
          que responde “por que perdemos clientes?”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="motivo-saida">Motivo</Label>
          <Select value={motivo ?? undefined} onValueChange={setMotivo} disabled={salvando}>
            <SelectTrigger id="motivo-saida" aria-label="Motivo da saída">
              <SelectValue placeholder="Escolha o motivo" />
            </SelectTrigger>
            <SelectContent>
              {(motivos ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.motivo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/*
           * Pré-preenche, humano confirma. O botão só coloca a sugestão no campo —
           * quem grava é o "Salvar motivo" abaixo. Um clique que já persistisse
           * transformaria "sugestão" em "decisão automática com passo extra".
           */}
          {sugestao && motivo !== sugestao.motivo_sugerido ? (
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setMotivo(sugestao.motivo_sugerido)}
                className="font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
              >
                Usar sugestão: {sugestao.motivo_sugerido_label}
              </button>{' '}
              — {sugestao.motivo_sugerido_evidencia}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="obs-saida">Observação (opcional)</Label>
          <Textarea
            id="obs-saida"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Com quem falamos, o que disseram, o que mudaria a decisão."
            disabled={salvando}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void salvar()} disabled={salvando || !motivo || !sujo}>
            {salvando ? 'Salvando…' : 'Salvar motivo'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
