'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pause, Play, RotateCcw, Zap } from 'lucide-react'
import {
  ESTADO_DISJUNTOR_LABELS,
  FERRAMENTAS,
  METRICA_DISJUNTOR_LABELS,
  type EstadoDisjuntor,
  type MetricaDisjuntor,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { pausarAgenteAction, reabrirDisjuntorAction, salvarDisjuntorAction } from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { dataHora, numeroBr, pct } from './gestao-format'
import { gestaoAgentesKeys, type AgenteIa, type Disjuntor } from './queries-gestao'

/**
 * O DISJUNTOR DE UM AGENTE (§9.2) e o botão de pausa — o que para o agente sem ninguém
 * precisar estar olhando, e o que o gestor aperta quando está.
 *
 * ─── REABERTURA SÓ MANUAL, COM MOTIVO ───────────────────────────────────────
 * O disjuntor abre sozinho (supressões, recusas, escalações ou falhas acima do limiar nas
 * últimas N ações) e NÃO fecha sozinho. Reabrir pede um motivo escrito porque é uma
 * decisão: "as ações que o abriram eram de uma lista ruim e a lista foi trocada" é uma
 * razão; "reabri para ver se passa" não é. O motivo vai para o evento e o audit_log, e
 * reabrir zera a janela — senão as mesmas ações o abririam de novo no ciclo seguinte.
 *
 * ─── LIMIAR É FRAÇÃO NO BANCO, PORCENTAGEM NA TELA ──────────────────────────
 * `limiar_supressao = 0.10` é "10% das últimas 20 ações". A tela lê e grava em %, e a
 * conversão fica aqui — um "10" gravado cru seria um limiar de 1000%, disjuntor que
 * nunca abre.
 */

const TOM_ESTADO: Record<EstadoDisjuntor, 'success' | 'warning' | 'critical'> = {
  ok: 'success',
  alerta: 'warning',
  aberto: 'critical',
}

const METRICAS: readonly MetricaDisjuntor[] = ['supressao', 'sem_interesse', 'escalacao', 'falha_tecnica']

interface UltimaAcao {
  em?: string
  ferramenta?: string
  sinal?: string
  intencao?: string
  erro?: string | null
}

function lerDetalhe(bruto: unknown): { ultimas: UltimaAcao[]; taxas: Partial<Record<MetricaDisjuntor, number>> | null } {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { ultimas: [], taxas: null }
  const d = bruto as { ultimas?: unknown; taxas?: unknown }
  const ultimas = Array.isArray(d.ultimas) ? (d.ultimas as UltimaAcao[]) : []
  const taxas = d.taxas && typeof d.taxas === 'object' ? (d.taxas as Partial<Record<MetricaDisjuntor, number>>) : null
  return { ultimas, taxas }
}

function rotuloFerramenta(id: string | undefined): string {
  if (!id) return '—'
  return (FERRAMENTAS as Record<string, { rotulo: string } | undefined>)[id]?.rotulo ?? id
}

function textoPct(fracao: number): string {
  return String(Math.round(fracao * 1000) / 10).replace('.', ',')
}

export function DisjuntorCard({ agente, disjuntor }: { agente: AgenteIa; disjuntor: Disjuntor | undefined }) {
  const qc = useQueryClient()
  const [reabrindo, setReabrindo] = React.useState(false)
  const [motivo, setMotivo] = React.useState('')
  const [pausando, setPausando] = React.useState(false)
  const [motivoPausa, setMotivoPausa] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  const [janela, setJanela] = React.useState('')
  const [limiares, setLimiares] = React.useState<Record<MetricaDisjuntor, string>>({
    supressao: '',
    sem_interesse: '',
    escalacao: '',
    falha_tecnica: '',
  })

  const chave = JSON.stringify(disjuntor ?? null)
  React.useEffect(() => {
    if (!disjuntor) return
    setJanela(String(disjuntor.janela_acoes))
    setLimiares({
      supressao: textoPct(Number(disjuntor.limiar_supressao)),
      sem_interesse: textoPct(Number(disjuntor.limiar_sem_interesse)),
      escalacao: textoPct(Number(disjuntor.limiar_escalacao)),
      falha_tecnica: textoPct(Number(disjuntor.limiar_falha_tecnica)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  const invalidar = () => void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.all })

  async function reabrir() {
    setEnviando(true)
    const r = await reabrirDisjuntorAction({ agente_id: agente.id, motivo: motivo.trim() })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Disjuntor reaberto. Os mandatos pausados por ele voltam a andar no próximo ciclo.')
    setReabrindo(false)
    setMotivo('')
    invalidar()
  }

  async function alternarPausa(pausar: boolean) {
    setEnviando(true)
    const r = await pausarAgenteAction({
      agente_id: agente.id,
      pausar,
      motivo: pausar ? motivoPausa.trim() || null : null,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(pausar ? `${agente.nome} pausado.` : `${agente.nome} retomado.`)
    setPausando(false)
    setMotivoPausa('')
    invalidar()
  }

  async function salvarLimiares() {
    const janelaN = Number(janela)
    if (!Number.isInteger(janelaN) || janelaN < 5 || janelaN > 500) {
      toast.error('A janela é um número inteiro de ações entre 5 e 500.')
      return
    }
    const valores: Record<string, number> = { janela_acoes: janelaN }
    for (const m of METRICAS) {
      const n = numeroBr(limiares[m])
      if (n === null || n < 0 || n > 100) {
        toast.error(`O limiar de ${METRICA_DISJUNTOR_LABELS[m]} é uma porcentagem entre 0 e 100.`)
        return
      }
      valores[`limiar_${m}`] = Math.round(n * 10) / 1000
    }
    setEnviando(true)
    const r = await salvarDisjuntorAction({ agente_id: agente.id, ...valores })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Limiares do disjuntor salvos.')
    invalidar()
  }

  const estado = (disjuntor?.estado ?? 'ok') as EstadoDisjuntor
  const detalhe = lerDetalhe(disjuntor?.aberto_detalhe)
  const pausado = agente.pausado_em !== null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4" aria-hidden /> Disjuntor e pausa
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={TOM_ESTADO[estado]}>{ESTADO_DISJUNTOR_LABELS[estado] ?? estado}</Badge>
            {pausado ? <Badge variant="warning">Pausado</Badge> : null}
          </div>
        </div>
        <CardDescription>
          Parada automática por contagem das últimas ações: acima de qualquer limiar, o agente para e
          os mandatos dele ficam pausados (não encerrados). Só volta quando alguém reabrir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disjuntor ? (
          <p className="text-sm text-muted-foreground">
            Este agente ainda não tem disjuntor — ele nasce no primeiro salvamento da persona, com os
            limiares padrão das Configurações.
          </p>
        ) : null}

        {estado === 'aberto' && disjuntor ? (
          <div className={cn('space-y-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.critical)}>
            <p className="font-medium">Aberto em {dataHora(disjuntor.aberto_em)}</p>
            {disjuntor.aberto_motivo ? <p>{disjuntor.aberto_motivo}</p> : null}
            {detalhe.ultimas.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide">Últimas ações que motivaram</p>
                <ul className="space-y-1 text-xs">
                  {detalhe.ultimas.map((u, i) => (
                    <li key={i} className="rounded bg-background/60 p-1.5">
                      <span className="font-medium">{rotuloFerramenta(u.ferramenta)}</span>
                      {u.sinal ? <span> · sinal {u.sinal.replace('_', ' ')}</span> : null}
                      {u.em ? <span className="opacity-80"> · {dataHora(u.em)}</span> : null}
                      {u.intencao ? <p className="opacity-90">{u.intencao}</p> : null}
                      {u.erro ? <p className="opacity-90">Erro: {u.erro}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setReabrindo(true)}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden /> Reabrir disjuntor
            </Button>
          </div>
        ) : null}

        {disjuntor?.reaberto_em ? (
          <p className="text-xs text-muted-foreground">Última reabertura manual: {dataHora(disjuntor.reaberto_em)}.</p>
        ) : null}

        {detalhe.taxas && estado !== 'aberto' ? (
          <p className="text-xs text-muted-foreground">
            Taxas na janela:{' '}
            {METRICAS.map((m) => `${METRICA_DISJUNTOR_LABELS[m]} ${pct(detalhe.taxas?.[m] ?? null)}`).join(' · ')}
          </p>
        ) : null}

        {disjuntor ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-5">
              <div className="space-y-1">
                <Label htmlFor={`janela-${agente.id}`} className="text-xs">
                  Janela (ações)
                </Label>
                <Input
                  id={`janela-${agente.id}`}
                  inputMode="numeric"
                  value={janela}
                  onChange={(e) => setJanela(e.target.value)}
                />
              </div>
              {METRICAS.map((m) => (
                <div key={m} className="space-y-1">
                  <Label htmlFor={`lim-${m}-${agente.id}`} className="text-xs first-letter:uppercase">
                    {METRICA_DISJUNTOR_LABELS[m]} (%)
                  </Label>
                  <Input
                    id={`lim-${m}-${agente.id}`}
                    inputMode="decimal"
                    value={limiares[m]}
                    onChange={(e) => setLimiares((l) => ({ ...l, [m]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Janela por contagem, não por tempo: com volume baixo, taxa por hora engana. Em 75% de
              qualquer limiar o estado vira “em alerta” — só aparece no cartão, não para nada.
            </p>
            <Button size="sm" variant="outline" disabled={enviando} onClick={() => void salvarLimiares()}>
              Salvar limiares
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {pausado ? (
            <>
              <p className="text-sm text-muted-foreground">
                Pausado em {dataHora(agente.pausado_em)}
                {agente.pausado_motivo ? ` — ${agente.pausado_motivo}` : ''}.
              </p>
              <Button size="sm" disabled={enviando} onClick={() => void alternarPausa(false)}>
                <Play className="mr-2 h-4 w-4" aria-hidden /> Retomar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={enviando} onClick={() => setPausando(true)}>
              <Pause className="mr-2 h-4 w-4" aria-hidden /> Pausar agente
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={reabrindo} onOpenChange={setReabrindo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir o disjuntor de {agente.nome}</DialogTitle>
            <DialogDescription>
              O agente volta a agir no próximo ciclo e os mandatos pausados pelo disjuntor retomam. A
              janela de contagem recomeça do zero. Diga o que mudou — fica registrado com o seu nome.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`motivo-${agente.id}`}>Motivo (obrigatório)</Label>
            <Textarea
              id={`motivo-${agente.id}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: a lista de telefones tinha números de outra empresa; o filtro foi corrigido."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReabrindo(false)}>
              Cancelar
            </Button>
            <Button disabled={motivo.trim().length < 5 || enviando} onClick={() => void reabrir()}>
              {enviando ? 'Reabrindo…' : 'Reabrir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pausando} onOpenChange={setPausando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pausar {agente.nome}</DialogTitle>
            <DialogDescription>
              O agente para de agir já no próximo ciclo. Os mandatos continuam abertos e retomam de
              onde estavam quando você retomar o agente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`pausa-${agente.id}`}>Motivo (opcional)</Label>
            <Input
              id={`pausa-${agente.id}`}
              value={motivoPausa}
              maxLength={300}
              onChange={(e) => setMotivoPausa(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPausando(false)}>
              Cancelar
            </Button>
            <Button disabled={enviando} onClick={() => void alternarPausa(true)}>
              {enviando ? 'Pausando…' : 'Pausar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
