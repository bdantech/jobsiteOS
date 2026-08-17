'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Scale, ShieldAlert } from 'lucide-react'
import {
  DECISOES_FINAIS,
  DECISAO_FINAL_LABELS,
  QUADRANTE_LABELS,
  QUADRANTE_LEITURA,
  motivoObrigatorio,
  type DecisaoFinal,
  type Quadrante,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { registrarDecisaoAction } from '@/actions/credito-analise'
import { analisePropriaKeys } from './queries'
import { brl } from './resultado'

/**
 * O confronto com a seguradora e a decisão (04j §7).
 *
 * ─── POR QUE AS DUAS LEITURAS FICAM LADO A LADO ─────────────────────────────
 * Uma tela que mostrasse só o número final esconderia a única informação que importa:
 * QUEM discorda de quem. "Nós aprovamos e ela não" é a decisão que só um FIDC com dado
 * próprio consegue tomar; "ela aprovou e nós não" é alerta de complacência. São situações
 * opostas e produzem o mesmo número na tela se ninguém as separar.
 *
 * ─── O MOTIVO É OBRIGATÓRIO FORA DO CAMINHO TRIVIAL ─────────────────────────
 * `motivoObrigatorio()` do core é o mesmo predicado do CHECK da migração 0122. Aqui ele
 * serve para desabilitar o botão antes do clique; lá, para o banco recusar o que passar.
 * Os dois existem: um dá a mensagem, o outro dá a garantia.
 */

const CORES_QUADRANTE: Record<Quadrante, string> = {
  ambos_aprovam: 'border-emerald-500/40 bg-emerald-500/5',
  ambos_negam: 'border-muted bg-muted/30',
  so_nos: 'border-amber-500/50 bg-amber-500/5',
  so_seguradora: 'border-red-500/50 bg-red-500/5',
}

/** O caminho trivial de cada quadrante, pré-selecionado. Divergência não tem trivial. */
function decisaoSugerida(q: Quadrante | null): DecisaoFinal | '' {
  if (q === 'ambos_aprovam') return 'operar_com_cobertura'
  if (q === 'ambos_negam') return 'nao_operar'
  return ''
}

export function Confronto({
  analiseId,
  analiseCreditoId,
  quadrante,
  nossaRecomendacao,
  nossoLimite,
  seguradoraStatus,
  seguradoraLimite,
  decisaoAtual,
  decisaoLimite,
  decisaoMotivo,
  decidaEm,
}: {
  analiseId: string
  analiseCreditoId: string
  quadrante: Quadrante | null
  nossaRecomendacao: string | null
  nossoLimite: number | null
  seguradoraStatus: string | null
  seguradoraLimite: number | null
  decisaoAtual: DecisaoFinal | null
  decisaoLimite: number | null
  decisaoMotivo: string | null
  decidaEm: string | null
}) {
  const qc = useQueryClient()
  const [decisao, setDecisao] = React.useState<DecisaoFinal | ''>(
    decisaoAtual ?? decisaoSugerida(quadrante),
  )
  // Quando ambos aprovam, o limite sugerido é o MENOR dos dois — a cobertura é o teto real.
  const sugerido =
    quadrante === 'ambos_aprovam' && nossoLimite !== null && seguradoraLimite !== null
      ? Math.min(nossoLimite, seguradoraLimite)
      : (nossoLimite ?? seguradoraLimite)
  const [limite, setLimite] = React.useState(
    String(decisaoLimite ?? (sugerido !== null ? Math.round(sugerido) : '')),
  )
  const [motivo, setMotivo] = React.useState(decisaoMotivo ?? '')
  const [salvando, setSalvando] = React.useState(false)

  const exigeMotivo = decisao !== '' && motivoObrigatorio(quadrante, decisao)
  const semMotivo = exigeMotivo && motivo.trim().length === 0
  const naoOpera = decisao === 'nao_operar'

  async function registrar() {
    if (decisao === '') return
    setSalvando(true)
    const r = await registrarDecisaoAction({
      id: analiseId,
      decisao_final: decisao,
      decisao_limite: naoOpera ? null : Number(limite.replace(/\D/g, '')) || null,
      decisao_motivo: motivo.trim() || null,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Decisão registrada. O limite operacional foi aplicado na esteira.')
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })
  }

  return (
    <div className="space-y-4">
      <Card className={quadrante ? CORES_QUADRANTE[quadrante] : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" aria-hidden />
            {quadrante ? QUADRANTE_LABELS[quadrante] : 'Sem confronto ainda'}
          </CardTitle>
          <CardDescription>
            {quadrante
              ? QUADRANTE_LEITURA[quadrante]
              : 'O quadrante só existe quando as duas leituras estão prontas: a nossa análise concluída e uma resposta da seguradora.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Nossa análise</p>
              <p className="text-sm font-medium">
                {nossaRecomendacao === 'operar' ? 'OPERAR' : nossaRecomendacao ? 'NÃO OPERAR' : '—'}
              </p>
              <p className="text-lg font-semibold tabular-nums">{brl(nossoLimite)}</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Seguradora</p>
              <p className="text-sm font-medium">{seguradoraStatus ?? '—'}</p>
              <p className="text-lg font-semibold tabular-nums">{brl(seguradoraLimite)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Decisão</CardTitle>
            {decisaoAtual && (
              <Badge variant="outline">
                {DECISAO_FINAL_LABELS[decisaoAtual]}
                {decidaEm ? ` · ${new Date(decidaEm).toLocaleDateString('pt-BR')}` : ''}
              </Badge>
            )}
          </div>
          <CardDescription>
            Registrada por gente do perfil Crédito. Grava o <strong>limite operacional</strong> na
            esteira — o limite da seguradora não é tocado, porque são duas verdades diferentes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="decisao">O que fazemos</Label>
              <Select value={decisao} onValueChange={(v) => setDecisao(v as DecisaoFinal)}>
                <SelectTrigger id="decisao">
                  <SelectValue placeholder="Escolha…" />
                </SelectTrigger>
                <SelectContent>
                  {DECISOES_FINAIS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DECISAO_FINAL_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="limite">Limite operacional</Label>
              <Input
                id="limite"
                inputMode="numeric"
                value={naoOpera ? '' : limite}
                disabled={naoOpera}
                onChange={(e) => setLimite(e.target.value)}
                placeholder={naoOpera ? 'não se aplica' : 'em reais'}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="motivo">
              Motivo{exigeMotivo ? <span className="ml-1 text-destructive">*</span> : ' (opcional)'}
            </Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder={
                exigeMotivo
                  ? 'Esta decisão diverge do caminho trivial do quadrante. Escreva por quê — é o que alguém vai ler daqui a seis meses.'
                  : 'Contexto adicional, se houver.'
              }
            />
            {semMotivo && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <ShieldAlert className="h-3 w-3" aria-hidden />
                Sem motivo, esta decisão não pode ser registrada.
              </p>
            )}
          </div>

          <Button onClick={() => void registrar()} disabled={decisao === '' || semMotivo || salvando}>
            {salvando ? 'Registrando…' : decisaoAtual ? 'Atualizar decisão' : 'Registrar decisão'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
