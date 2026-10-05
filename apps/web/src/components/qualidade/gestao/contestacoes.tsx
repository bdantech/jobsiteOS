'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Quote } from 'lucide-react'
import {
  ESCOPO_ANALISE_LABELS,
  PROVEDOR_ANALISE_LABELS,
  ROTULO_HUMANO_LABELS,
  ROTULOS_HUMANOS,
  VEREDITO_LABELS,
  VEREDITOS_CONTESTACAO,
  type ContestacaoFila,
  type RotuloHumano,
  type VereditoContestacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { decidirContestacaoAction } from '@/actions/qualidade'
import { cn } from '@/lib/utils'
import { ErroCarga, Vazio } from './comum'
import { dataHora, decimal, urlAnalise } from './formato'
import { buscarContestacoes, qualidadeGestaoKeys } from './queries'

/**
 * CONTESTAÇÕES (05C §9) — a fila do gestor.
 *
 * Contestar não apaga a nota: abre uma revisão. Cada cartão mostra, nesta ordem, o que o
 * MODELO disse (atendido ou não, com a probabilidade e quem decidiu), a CITAÇÃO que ele
 * usou e a orientação que o vendedor recebeu — e só então a justificativa do vendedor. A
 * ordem é de propósito: o gestor julga o item, não a pessoa que reclamou.
 *
 * O veredito tem três saídas, e só uma muda a nota:
 *   procedente       o item muda, a nota é recalculada — exige o rótulo certo
 *   improcedente     o item fica
 *   rubrica_ajustar  o defeito é da PERGUNTA: o item é marcado para reescrever
 *
 * E todo rótulo humano, em qualquer das três, entra no conjunto de calibração (§9). É
 * por isso que o rótulo é pedido mesmo quando é opcional: é ele que faz o loop girar.
 */
export function Contestacoes() {
  const [decididas, setDecididas] = React.useState(false)
  const abertas = useQuery({ queryKey: qualidadeGestaoKeys.contestacoes(true), queryFn: () => buscarContestacoes(true) })
  const recentes = useQuery({
    queryKey: qualidadeGestaoKeys.contestacoes(false),
    queryFn: () => buscarContestacoes(false),
    enabled: decididas,
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Contestações abertas
              {abertas.data ? <span className="ml-2 text-sm font-normal text-muted-foreground">({abertas.data.length})</span> : null}
            </CardTitle>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={decididas} onCheckedChange={setDecididas} aria-label="Ver decididas recentemente" />
              Ver decididas nos últimos 60 dias
            </label>
          </div>
          <CardDescription>
            Cada contestação é um vendedor esperando resposta. A mais antiga vem primeiro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {abertas.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : abertas.isError ? (
            <ErroCarga erro={abertas.error} oque="as contestações" />
          ) : abertas.data.length === 0 ? (
            <Vazio>Nenhuma contestação aberta.</Vazio>
          ) : (
            abertas.data.map((c) => <CartaoContestacao key={c.id} c={c} />)
          )}
        </CardContent>
      </Card>

      {decididas ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Decididas recentemente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentes.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : recentes.isError ? (
              <ErroCarga erro={recentes.error} oque="as contestações decididas" />
            ) : recentes.data.length === 0 ? (
              <Vazio>Nenhuma contestação decidida nos últimos 60 dias.</Vazio>
            ) : (
              [...recentes.data]
                .sort((a, b) => (b.revisada_em ?? '').localeCompare(a.revisada_em ?? ''))
                .map((c) => <CartaoContestacao key={c.id} c={c} />)
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/** "Atendeu (0,82 · Jev)" — o que o modelo concluiu, com a confiança e quem decidiu. */
function OqueOModeloDisse({ c }: { c: ContestacaoFila }) {
  const conclusao = !c.aplicavel ? 'Não se aplicava' : c.atendido === null ? 'Sem decisão' : c.atendido ? 'Atendeu' : 'Não atendeu'
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">O modelo disse: </span>
      <span className="font-medium">{conclusao}</span>
      <span className="text-muted-foreground">
        {c.prob_atendido !== null ? ` · P(atendido) ${decimal(c.prob_atendido)}` : ''}
        {c.provedor ? ` · ${PROVEDOR_ANALISE_LABELS[c.provedor]}` : ''}
      </span>
    </p>
  )
}

function CartaoContestacao({ c }: { c: ContestacaoFila }) {
  const decidida = c.veredito !== null
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">
            {c.rotulo}
            {c.etapa ? <span className="ml-2 text-xs font-normal text-muted-foreground">{c.etapa}</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {c.vendedor ?? 'Sem vendedor'} · {c.empresa_nome ?? 'Empresa sem nome'} · {ESCOPO_ANALISE_LABELS[c.escopo]} ·
            contestada em {dataHora(c.criada_em)}
            {c.contestado_por && c.contestado_por !== c.vendedor ? ` por ${c.contestado_por}` : ''}
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link href={urlAnalise(c.analise_id)} target="_blank">
            Ver análise <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
          </Link>
        </Button>
      </div>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Pergunta ao classificador: </span>
        {c.pergunta}
      </p>

      <OqueOModeloDisse c={c} />

      {c.citacao ? (
        <blockquote className="flex gap-2 border-l-2 pl-3 text-sm italic text-muted-foreground">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{c.citacao}</span>
        </blockquote>
      ) : null}
      {c.orientacao ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Orientação dada ao vendedor: </span>
          {c.orientacao}
        </p>
      ) : null}

      <div className="rounded-md border border-dashed p-3 text-sm">
        <p className="text-xs text-muted-foreground">Justificativa do vendedor</p>
        <p className="whitespace-pre-wrap">{c.justificativa || '—'}</p>
      </div>

      {decidida ? <Decisao c={c} /> : <FormDecisao c={c} />}
    </div>
  )
}

function Decisao({ c }: { c: ContestacaoFila }) {
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
      <p>
        <Badge variant={c.veredito === 'procedente' ? 'success' : c.veredito === 'rubrica_ajustar' ? 'warning' : 'neutral'}>
          {VEREDITO_LABELS[c.veredito!]}
        </Badge>
        <span className="ml-2 text-xs text-muted-foreground">em {dataHora(c.revisada_em)}</span>
      </p>
      {c.rotulo_humano ? (
        <p className="text-xs text-muted-foreground">
          Rótulo: {ROTULO_HUMANO_LABELS[c.rotulo_humano as RotuloHumano] ?? c.rotulo_humano}
        </p>
      ) : null}
      {c.resposta_gestor ? <p className="whitespace-pre-wrap">{c.resposta_gestor}</p> : null}
    </div>
  )
}

function FormDecisao({ c }: { c: ContestacaoFila }) {
  const qc = useQueryClient()
  const [veredito, setVeredito] = React.useState<VereditoContestacao | null>(null)
  const [rotulo, setRotulo] = React.useState<RotuloHumano | null>(null)
  const [resposta, setResposta] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const id = `contestacao-${c.id}`

  const faltaRotulo = veredito === 'procedente' && !rotulo

  async function decidir() {
    if (!veredito) return
    setEnviando(true)
    const r = await decidirContestacaoAction({
      id: c.id,
      veredito,
      resposta: resposta.trim() || undefined,
      rotulo_humano: rotulo ?? undefined,
    })
    setEnviando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success(
      veredito === 'procedente'
        ? 'Contestação aceita: o item foi corrigido e a nota recalculada.'
        : veredito === 'rubrica_ajustar'
          ? 'Item marcado para reescrever.'
          : 'Contestação revisada: o item fica como estava.',
    )
    // O prefixo inteiro: a nota recalculada muda a visão geral e o feedback do vendedor.
    void qc.invalidateQueries({ queryKey: ['qualidade'] })
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">Veredito</legend>
        <div className="flex flex-wrap gap-1.5">
          {VEREDITOS_CONTESTACAO.map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={veredito === v ? 'default' : 'outline'}
              className="h-8 text-xs"
              aria-pressed={veredito === v}
              onClick={() => setVeredito(v)}
            >
              {VEREDITO_LABELS[v]}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">
          Qual era a resposta certa?{' '}
          <span className="font-normal text-muted-foreground">
            {veredito === 'procedente' ? '(obrigatório quando procedente)' : '(opcional)'}
          </span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {ROTULOS_HUMANOS.map((r) => (
            <Button
              key={r}
              type="button"
              size="sm"
              variant={rotulo === r ? 'secondary' : 'outline'}
              className={cn('h-8 text-xs', rotulo === r && 'ring-2 ring-ring')}
              aria-pressed={rotulo === r}
              onClick={() => setRotulo(rotulo === r ? null : r)}
            >
              {ROTULO_HUMANO_LABELS[r]}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Todo rótulo entra no conjunto de calibração — é ele que ensina o sistema, mesmo quando a
          contestação é improcedente.
        </p>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor={`${id}-resposta`} className="text-xs">
          Resposta ao vendedor
        </Label>
        <Textarea
          id={`${id}-resposta`}
          value={resposta}
          maxLength={2000}
          onChange={(e) => setResposta(e.target.value)}
          placeholder="O vendedor lê isto na aba Feedback."
          className="min-h-[64px]"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {faltaRotulo ? <span className="text-xs text-muted-foreground">Escolha a resposta certa para aceitar.</span> : null}
        <Button size="sm" disabled={!veredito || faltaRotulo || enviando} onClick={() => void decidir()}>
          {enviando ? 'Salvando…' : 'Decidir'}
        </Button>
      </div>
    </div>
  )
}
