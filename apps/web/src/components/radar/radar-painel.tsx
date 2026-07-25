'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CAMADA_LABELS, type Camada } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buscarCobertura,
  buscarGastoMes,
  buscarLotesRecentes,
  buscarOrcamento,
  radarKeys,
  type CoberturaCamada,
} from './queries'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0)

function Barra({ label, parte, total }: { label: string; parte: number; total: number }) {
  const p = pct(parte, total)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {parte.toLocaleString('pt-BR')} · {p}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function CoberturaCards({ dados }: { dados: CoberturaCamada[] }) {
  const ordem: Camada[] = ['som', 'sam', 'tam', 'universo']
  const porCamada = new Map(dados.map((d) => [d.camada, d]))
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {ordem.map((camada) => {
        const d = porCamada.get(camada) ?? { camada, total: 0, com_dominio: 0, com_contato: 0, com_protesto: 0 }
        return (
          <Card key={camada}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{CAMADA_LABELS[camada]}</CardTitle>
              <CardDescription>{d.total.toLocaleString('pt-BR')} empresas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Barra label="Domínio" parte={d.com_dominio} total={d.total} />
              <Barra label="Contato" parte={d.com_contato} total={d.total} />
              <Barra label="Protesto" parte={d.com_protesto} total={d.total} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function GastoDoMes() {
  const gasto = useQuery({ queryKey: radarKeys.gastoMes(), queryFn: buscarGastoMes })
  const orc = useQuery({ queryKey: radarKeys.orcamento(), queryFn: buscarOrcamento })
  const teto = orc.data?.teto_mensal_total ?? 0
  const g = gasto.data ?? 0
  const p = pct(g, teto)
  const alerta = teto > 0 && g >= teto * (orc.data?.alerta_percentual ?? 0.8)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Gasto do mês</CardTitle>
        <CardDescription>Enriquecimento pago vs. teto mensal</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold">{brl(g)}</span>
          <span className="text-sm text-muted-foreground">de {brl(teto)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={alerta ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'}
            style={{ width: `${Math.min(100, p)}%` }}
          />
        </div>
        {alerta && <p className="text-xs text-destructive">Atenção: acima de {Math.round((orc.data?.alerta_percentual ?? 0.8) * 100)}% do teto.</p>}
      </CardContent>
    </Card>
  )
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  executando: 'Executando',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  falhou: 'Falhou',
}

function LotesRecentes() {
  const lotes = useQuery({ queryKey: radarKeys.lotes(), queryFn: () => buscarLotesRecentes(8) })
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Lotes recentes</CardTitle>
          <CardDescription>Últimos enriquecimentos</CardDescription>
        </div>
        <Link href="/radar/lotes" className="text-sm text-primary hover:underline">
          Ver todos
        </Link>
      </CardHeader>
      <CardContent>
        {lotes.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (lotes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lote ainda.</p>
        ) : (
          <div className="divide-y divide-border">
            {(lotes.data ?? []).map((l) => (
              <Link
                key={l.id}
                href={`/radar/lotes/${l.id}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-muted/50"
              >
                <span className="truncate">{l.nome ?? `Lote de ${l.tipo}`}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="capitalize">{l.tipo}</span>
                  <span>{STATUS_LABEL[l.status] ?? l.status}</span>
                  <span>{brl(Number(l.custo_real) || 0)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function RadarPainel() {
  const cobertura = useQuery({ queryKey: radarKeys.cobertura(), queryFn: buscarCobertura })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Radar</h1>
        <p className="text-muted-foreground">Cobertura de enriquecimento, gasto do mês e lotes.</p>
      </div>

      {cobertura.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : cobertura.isError ? (
        <p className="text-sm text-destructive">Falha ao carregar a cobertura.</p>
      ) : (
        <CoberturaCards dados={cobertura.data ?? []} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <GastoDoMes />
        <LotesRecentes />
      </div>
    </div>
  )
}
