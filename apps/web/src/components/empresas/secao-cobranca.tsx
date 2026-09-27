'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { COBRANCA_ESTAGIOS_ENCERRADOS, COBRANCA_ESTAGIO_LABELS, type CobrancaEstagio } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * A seção Cobrança da Company 360 (07 §11, §6.3.2).
 *
 * ── ELA SÓ APARECE QUANDO HÁ O QUE DIZER ────────────────────────────────────
 * Como a do Jurídico: bloqueio, cobrança viva, título vencido em aberto ou cobertura
 * que voltou depois de um pagamento. Uma empresa sem nada disso — a imensa maioria —
 * não ganha um card para dizer que está tudo bem.
 *
 * ── SÓ PARA QUEM TEM O MÓDULO ───────────────────────────────────────────────
 * O vendedor fica sabendo do bloqueio pelo selo do crédito e do funil; o motivo, a
 * cobrança e os títulos estão atrás da RLS da Cobrança, e uma seção que abriria vazia
 * (ou com link para /sem-acesso) para quem não tem o módulo é pior que nenhuma.
 *
 * ── A VOLTA DA COBERTURA É DINHEIRO (§6.3.2) ────────────────────────────────
 * Depois de um pagamento, a apólice volta a cobrir — mas a partir de QUANDO muda o
 * valor de toda cessão feita no meio. Pago em até 30 dias depois da parada de D+60 sem
 * cobrança, a cobertura volta retroativa (cl. 17700.20 a). Posto em cobrança, não há
 * retroatividade: ela volta para o que for cedido a partir do pagamento (cl. 17700.20 b).
 * A data fica aqui, na ficha do sacado, porque é aqui que o comercial olha antes de ceder.
 */

const moeda = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const dataBr = (v: string | null | undefined): string => {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

interface DadosCobrancaEmpresa {
  cobrancas: {
    id: string | null
    codigo: string | null
    estagio: string | null
    valor_em_aberto: number | null
    qtd_ativos: number | null
    dias_restantes: number | null
  }[]
  vencidos: { qtd: number; valor: number }
  volta: { cobertura_volta_em: string | null; restabelecimento_retroativo: boolean | null; pago_em: string | null } | null
}

async function buscarCobrancaDaEmpresa(empresaId: string, cnpj: string): Promise<DadosCobrancaEmpresa> {
  const supabase = createClient()
  const [cards, titulos, prazos] = await Promise.all([
    supabase
      .from('cobranca_cards')
      .select('id, codigo, estagio, valor_em_aberto, qtd_ativos, dias_restantes')
      .or(`sacado_matriz_cnpj.eq.${cnpj},sacado_empresa_id.eq.${empresaId}`)
      .not('estagio', 'in', `(${COBRANCA_ESTAGIOS_ENCERRADOS.join(',')})`)
      .order('criada_em', { ascending: false })
      .limit(20),
    supabase
      .from('cobranca_titulos_abertos')
      .select('valor_face, dias_atraso')
      .or(`sacado_matriz_cnpj.eq.${cnpj},sacado_cnpj.eq.${cnpj},sacado_empresa_id.eq.${empresaId}`)
      .gt('dias_atraso', 0)
      .limit(1000),
    // A volta mais recente, dos prazos já encerrados por pagamento no grupo.
    supabase
      .from('apolice_prazos')
      .select('cobertura_volta_em, restabelecimento_retroativo, pago_em, titulos!inner(sacado_matriz_cnpj)')
      .eq('status', 'encerrado_pagamento')
      .eq('titulos.sacado_matriz_cnpj', cnpj)
      .not('cobertura_volta_em', 'is', null)
      .order('cobertura_volta_em', { ascending: false })
      .limit(1),
  ])
  if (cards.error) throw new Error(cards.error.message)
  if (titulos.error) throw new Error(titulos.error.message)
  if (prazos.error) throw new Error(prazos.error.message)

  const linhas = titulos.data ?? []
  const volta = prazos.data?.[0] ?? null
  return {
    cobrancas: cards.data ?? [],
    vencidos: { qtd: linhas.length, valor: linhas.reduce((s, t) => s + Number(t.valor_face ?? 0), 0) },
    volta: volta
      ? {
          cobertura_volta_em: volta.cobertura_volta_em,
          restabelecimento_retroativo: volta.restabelecimento_retroativo,
          pago_em: volta.pago_em,
        }
      : null,
  }
}

export function SecaoCobranca({
  empresaId,
  cnpj,
  bloqueio,
  bloqueioMotivo,
  bloqueioEm,
  bloqueioCobrancaId,
  revisaoPosInadimplencia,
}: {
  empresaId: string
  cnpj: string
  bloqueio: boolean | null
  bloqueioMotivo: string | null
  bloqueioEm: string | null
  bloqueioCobrancaId: string | null
  revisaoPosInadimplencia: boolean | null
}) {
  const q = useQuery({
    queryKey: ['cobranca', 'da-empresa', empresaId, cnpj],
    queryFn: () => buscarCobrancaDaEmpresa(empresaId, cnpj),
  })

  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (q.isError) {
    return (
      <p className="text-xs text-destructive">
        {q.error instanceof Error ? q.error.message : 'Erro ao carregar a cobrança desta empresa.'}
      </p>
    )
  }

  const dados = q.data
  const cobrancas = dados?.cobrancas ?? []
  const vencidos = dados?.vencidos ?? { qtd: 0, valor: 0 }
  const volta = dados?.volta ?? null
  const temAlgo = Boolean(bloqueio) || Boolean(revisaoPosInadimplencia) || cobrancas.length > 0 || vencidos.qtd > 0 || volta !== null
  if (!temAlgo) return null

  return (
    <Card className={bloqueio ? 'border-destructive/40' : undefined}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wallet className="h-4 w-4" aria-hidden />
          Cobrança
        </CardTitle>
        {bloqueio ? (
          <Badge variant="critical">Grupo em cobrança</Badge>
        ) : revisaoPosInadimplencia ? (
          <Badge variant="warning">Regularizado · limite em revisão</Badge>
        ) : (
          <Badge variant="outline">sem bloqueio</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {bloqueio ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <p>
              <strong>{bloqueioMotivo ?? 'Em cobrança extrajudicial.'}</strong> Desde {dataBr(bloqueioEm)}.
            </p>
            <p className="mt-1 text-muted-foreground">
              O bloqueio é do grupo inteiro (matriz e SPEs): novas análises de crédito ficam suspensas, o funil
              não abre operação e as campanhas excluem o grupo até a regularização.
            </p>
            {bloqueioCobrancaId ? (
              <Link href={`/cobranca/cobrancas/${bloqueioCobrancaId}`} className="mt-1 inline-block font-medium underline underline-offset-2">
                Abrir a cobrança que bloqueou
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Títulos vencidos em aberto</div>
            <div className="text-lg font-semibold tabular-nums">
              {vencidos.qtd} · {moeda(vencidos.valor)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Cobranças ativas</div>
            <div className="text-lg font-semibold tabular-nums">{cobrancas.length}</div>
          </div>
        </div>

        {cobrancas.length > 0 ? (
          <div className="space-y-2">
            {cobrancas.map((c) => (
              <div
                key={c.id ?? c.codigo}
                className="flex items-center justify-between gap-3 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <Link href={`/cobranca/cobrancas/${c.id}`} className="min-w-0 hover:underline">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.codigo ?? '—'}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {COBRANCA_ESTAGIO_LABELS[c.estagio as CobrancaEstagio] ?? c.estagio}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.qtd_ativos ?? 0} título(s) ativo(s)
                    {c.dias_restantes !== null ? (
                      <span className={cn(c.dias_restantes <= 5 ? 'font-semibold text-destructive' : c.dias_restantes <= 15 ? 'text-amber-600 dark:text-amber-400' : '')}>
                        {' '}
                        · próximo prazo da apólice{' '}
                        {c.dias_restantes < 0 ? `vencido há ${-c.dias_restantes} d` : `em ${c.dias_restantes} d`}
                      </span>
                    ) : null}
                  </div>
                </Link>
                <span className="whitespace-nowrap text-sm tabular-nums">{moeda(c.valor_em_aberto)}</span>
              </div>
            ))}
          </div>
        ) : null}

        {volta ? (
          <p
            className={cn(
              'rounded-md border p-2 text-xs',
              volta.restabelecimento_retroativo
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-amber-500/30 bg-amber-500/5',
            )}
          >
            <strong>Cobertura da apólice:</strong>{' '}
            {volta.restabelecimento_retroativo
              ? `restabelecida com efeito retroativo (pagamento em ${dataBr(volta.pago_em)}, dentro de 30 dias da parada — cl. 17700.20 a). As cessões do intervalo voltaram a ser cobertas.`
              : `volta a valer para recebíveis cedidos a partir de ${dataBr(volta.cobertura_volta_em)}. O que foi cedido antes disso, durante a interrupção, NÃO está coberto.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
