'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ExternalLink, Play, X } from 'lucide-react'
import { type PainelVinculacao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { auditarVinculoAction, rodarVinculacaoAction } from '@/actions/qualidade'
import { ErroCarga, Vazio } from './comum'
import { brlDeCentavos, dataCurta, decimal, inteiro, mesCurto, pct } from './formato'
import { buscarVinculacao, qualidadeGestaoKeys } from './queries'

/**
 * VINCULAÇÃO (05C §10): a cascata que casa conversa sem dono com empresa.
 *
 * determinístico (grátis) → shortlist → Jev → Claude na banda cinzenta → fila humana.
 *
 * O que esta aba MEDE é o que o §10 pede: quanto resolveu sozinho, quanto foi para
 * humano, e a precisão do automático — que só se conhece AUDITANDO. Sem a amostra
 * mensal, "92% automático" pode ser 92% errado e ninguém saberia.
 *
 * A vinculação em si não se faz aqui: a fila humana leva à tela de não vinculadas da
 * Comunicação, que é onde o vínculo de verdade acontece (contato criado, threads irmãs,
 * ledger). Duas telas que vinculam seriam duas regras para divergir.
 */

const DIAS = 30

const ETAPA_LABELS: Record<string, string> = {
  deterministico: 'Determinístico (domínio, telefone, reunião)',
  jev: 'Jev',
  claude: 'Claude (banda cinzenta)',
  humano: 'Fila humana',
}

export function Vinculacao() {
  const q = useQuery({ queryKey: qualidadeGestaoKeys.vinculacao(DIAS), queryFn: () => buscarVinculacao(DIAS) })
  const [rodando, setRodando] = React.useState(false)
  const qc = useQueryClient()

  async function rodar() {
    setRodando(true)
    const r = await rodarVinculacaoAction()
    setRodando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success('Vinculação disparada. Os números atualizam quando o worker terminar.')
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.vinculacao(DIAS) })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Últimos {DIAS} dias.</p>
        <Button size="sm" variant="outline" disabled={rodando} onClick={() => void rodar()}>
          <Play className="mr-1 h-3.5 w-3.5" aria-hidden /> {rodando ? 'Disparando…' : 'Rodar agora'}
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <ErroCarga erro={q.error} oque="a vinculação" />
      ) : (
        <Painel p={q.data} />
      )}
    </div>
  )
}

function Painel({ p }: { p: PainelVinculacao }) {
  const etapas = Object.entries(p.por_etapa ?? {}).map(([etapa, n]) => ({ etapa, n: Number(n) }))
  const total = etapas.reduce((s, e) => s + e.n, 0)
  const humano = etapas.find((e) => e.etapa === 'humano')?.n ?? 0
  const auto = total - humano
  const ordem = ['deterministico', 'jev', 'claude', 'humano']
  etapas.sort((a, b) => ordem.indexOf(a.etapa) - ordem.indexOf(b.etapa))
  const ultimaAuditoria = p.auditoria[0]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero titulo="Resolvido automaticamente" valor={pct(total > 0 ? auto / total : null)} nota={`${inteiro(auto)} de ${inteiro(total)} conversas`} />
        <Numero titulo="Na fila humana" valor={pct(total > 0 ? humano / total : null)} nota={`${inteiro(humano)} conversas`} />
        <Numero
          titulo="Precisão auditada"
          valor={ultimaAuditoria ? pct(ultimaAuditoria.auditadas > 0 ? ultimaAuditoria.corretas / ultimaAuditoria.auditadas : null) : '—'}
          nota={
            ultimaAuditoria
              ? `${mesCurto(ultimaAuditoria.mes)}: ${inteiro(ultimaAuditoria.corretas)} corretas de ${inteiro(ultimaAuditoria.auditadas)}`
              : 'nenhuma auditoria ainda'
          }
        />
        <Numero titulo="Custo" valor={brlDeCentavos(p.custo_centavos)} nota={`${inteiro(p.nao_resolviveis)} não resolvíveis (e-mail pessoal etc.)`} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Por etapa da cascata</CardTitle>
          <CardDescription>
            Onde cada conversa foi resolvida. Par na faixa incerta vai para humano, não para automático;
            e-mail pessoal é tratado como não resolvível em vez de forçado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {etapas.length === 0 ? (
            <Vazio>Nenhuma tentativa de vinculação no período.</Vazio>
          ) : (
            <ul className="space-y-2 text-sm">
              {etapas.map((e) => (
                <li key={e.etapa} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{ETAPA_LABELS[e.etapa] ?? e.etapa}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {inteiro(e.n)} · {pct(total > 0 ? e.n / total : null)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className={e.etapa === 'humano' ? 'h-2 bg-muted-foreground/60' : 'h-2 bg-primary'}
                      style={{ width: `${total > 0 ? (e.n / total) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {p.auditoria.length > 1 ? (
            <div className="mt-4 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Precisão auditada por mês</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {p.auditoria.map((a) => (
                  <li key={a.mes} className="tabular-nums">
                    {mesCurto(a.mes)}: {pct(a.auditadas > 0 ? a.corretas / a.auditadas : null)} ({a.corretas}/{a.auditadas})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Amostra amostra={p.amostra} />
      <FilaHumana fila={p.fila_humana} />
    </div>
  )
}

function Numero({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      <p className="text-xs text-muted-foreground">{nota}</p>
    </div>
  )
}

/**
 * A amostra do mês: vínculos AUTOMÁTICOS ainda não auditados, sorteados. A RPC sorteia
 * por um hash do id com o mês, então a amostra é estável dentro do mês — recarregar não
 * troca as dez por outras dez mais fáceis.
 */
function Amostra({ amostra }: { amostra: PainelVinculacao['amostra'] }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState<string | null>(null)

  async function auditar(id: string, correta: boolean) {
    setEnviando(id)
    const r = await auditarVinculoAction({ id, correta })
    setEnviando(null)
    if (!r.ok) return void toast.error(r.message)
    toast.success(correta ? 'Vínculo confirmado.' : 'Vínculo marcado como incorreto.')
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.vinculacao(DIAS) })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Auditoria do mês</CardTitle>
        <CardDescription>
          Uma amostra dos vínculos automáticos. Confira se a conversa é mesmo daquela empresa — é daqui que sai a
          precisão medida.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {amostra.length === 0 ? (
          <Vazio>Nada a auditar este mês.</Vazio>
        ) : (
          <ul className="divide-y text-sm">
            {amostra.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <p>
                    <span className="font-medium">{a.nome_sugerido ?? a.identificador_externo}</span>
                    <span className="text-muted-foreground"> ({a.canal} · {a.identificador_externo})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    → {a.empresa_nome ?? 'empresa sem nome'}
                    {a.cnpj ? ` · ${a.cnpj}` : ''} · {ETAPA_LABELS[a.etapa] ?? a.etapa}
                    {a.probabilidade !== null ? ` · p ${decimal(a.probabilidade)}` : ''} · {dataCurta(a.criada_em)}
                  </p>
                  {a.motivo ? <p className="text-xs text-muted-foreground">{a.motivo}</p> : null}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={enviando === a.id} onClick={() => void auditar(a.id, true)}>
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Correto
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={enviando === a.id} onClick={() => void auditar(a.id, false)}>
                    <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Incorreto
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** Valor potencial da candidata: o esperado mensal (ou faturamento ÷ 12), em reais. */
const brlValor = (v: number | null) =>
  v === null || !Number.isFinite(Number(v))
    ? null
    : `${Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}/mês`

function FilaHumana({ fila }: { fila: PainelVinculacao['fila_humana'] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Fila humana</CardTitle>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href="/comunicacao/nao-vinculadas">
              Abrir não vinculadas <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
            </Link>
          </Button>
        </div>
        <CardDescription>
          O que a cascata não resolveu, ordenado pelo valor potencial da melhor candidata. A vinculação é feita na
          tela de não vinculadas da Comunicação.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {fila.length === 0 ? (
          <Vazio>Fila vazia.</Vazio>
        ) : (
          <ul className="divide-y text-sm">
            {fila.map((n) => (
              <li key={n.id} className="space-y-1 px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p>
                    <span className="font-medium">{n.nome_sugerido ?? n.identificador_externo}</span>
                    <span className="text-muted-foreground"> ({n.canal} · {n.identificador_externo})</span>
                    {n.nao_resolvivel ? (
                      <Badge variant="neutral" className="ml-2 text-[10px]">
                        não resolvível
                      </Badge>
                    ) : null}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {inteiro(n.qtd_mensagens)} mensagem(ns) · última em {dataCurta(n.ultima_mensagem_em)}
                  </span>
                </div>
                {n.motivo ? <p className="text-xs text-muted-foreground">{n.motivo}</p> : null}
                {n.candidatas.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {n.candidatas.slice(0, 5).map((c) => (
                      <li key={c.empresa_id}>
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {c.nome_fantasia || c.razao_social || c.cnpj}
                          {brlValor(c.valor) ? <span className="ml-1 text-muted-foreground">{brlValor(c.valor)}</span> : null}
                        </Badge>
                      </li>
                    ))}
                    {n.candidatas.length > 5 ? (
                      <li className="text-xs text-muted-foreground">+{n.candidatas.length - 5}</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Sem candidatas.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
