'use client'

import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react'
import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXAS,
  FAIXA_LABELS,
  TIPAGENS,
  TIPAGEM_LABELS,
  type EstagioFunil,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/components/empresas/use-debounce'
import { cn } from '@/lib/utils'
import { formatarInteiro, formatarMoeda } from './format'
import { NotaCard } from './nota-card'
import {
  PAGINA_FUNIL,
  antecipacaoKeys,
  buscarConfig,
  buscarFornecedores,
  buscarFunil,
  type FiltrosFunil,
  type FornecedorFunil,
} from './queries'

/**
 * O Kanban do funil (§5).
 *
 * UMA CONSULTA POR COLUNA, não uma consulta grande fatiada no cliente: cada
 * coluna tem sua própria contagem exata e sua própria paginação, então "A
 * prospectar (4.812)" é o número verdadeiro mesmo quando só 40 cards estão
 * pintados. Fatiar no cliente daria a contagem do que foi baixado — que é
 * exatamente o número que ninguém quer.
 *
 * As colunas ABERTAS ficam lado a lado; convertida/perdida/expirada moram numa
 * coluna "Encerradas" só. Elas são o resultado, não trabalho — dar a cada uma sua
 * própria coluna encheria a tela de histórico e empurraria o que importa para
 * fora do viewport.
 *
 * NÃO tem drag-and-drop de propósito: mover para "perdida" exige motivo, e um
 * gesto de arrastar que abre um diálogo obrigatório é pior que um menu. O menu do
 * card faz a mesma coisa em dois cliques, com o motivo onde ele precisa estar.
 */

const COLUNAS: readonly (EstagioFunil | 'encerradas')[] = [...ESTAGIOS_ABERTOS, 'encerradas']

const TITULO_COLUNA: Record<string, string> = {
  ...ESTAGIO_FUNIL_LABELS,
  encerradas: 'Encerradas',
}

export function FunilKanban() {
  const [termo, setTermo] = React.useState('')
  const [faixa, setFaixa] = React.useState<Faixa | undefined>()
  const [tipagem, setTipagem] = React.useState<Tipagem | undefined>()
  const termoDebounced = useDebounce(termo, 350)

  const { data: config } = useQuery({
    queryKey: antecipacaoKeys.config(),
    queryFn: buscarConfig,
    staleTime: 10 * 60 * 1000,
  })
  const minimoOperavel =
    (config?.funil as { minimo_operavel_dias?: number } | undefined)?.minimo_operavel_dias ?? 7

  const base: FiltrosFunil = React.useMemo(
    () => ({ termo: termoDebounced || undefined, faixa, tipagem }),
    [termoDebounced, faixa, tipagem],
  )

  const colunas = useQueries({
    queries: COLUNAS.map((estagio) => ({
      queryKey: antecipacaoKeys.funil({ ...base, estagio }),
      queryFn: () => buscarFunil({ ...base, estagio }),
    })),
  })

  // O contexto de fornecedor de TODOS os cards pintados, numa leitura só. Sem
  // isto seria um N+1 de até 200 requisições para escrever "+3 notas".
  const cnpjs = React.useMemo(
    () =>
      colunas
        .flatMap((c) => c.data?.notas ?? [])
        .map((n) => n.fornecedor_cnpj)
        .filter((c): c is string => Boolean(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colunas.map((c) => c.dataUpdatedAt).join(',')],
  )

  const { data: fornecedores } = useQuery({
    queryKey: [...antecipacaoKeys.all, 'fornecedores-lote', cnpjs.length, cnpjs[0] ?? ''],
    queryFn: () => buscarFornecedores(cnpjs),
    enabled: cnpjs.length > 0,
  })

  const porCnpj = React.useMemo(() => {
    const m = new Map<string, FornecedorFunil>()
    for (const f of fornecedores ?? []) {
      if (f.fornecedor_cnpj) m.set(f.fornecedor_cnpj, f)
    }
    return m
  }, [fornecedores])

  const filtrando = Boolean(termoDebounced || faixa || tipagem)

  return (
    <div className="space-y-4">
      {/* ─── Filtros ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar por fornecedor, sacado, CNPJ ou número da nota"
            aria-label="Buscar no funil"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1">
          {FAIXAS.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={faixa === f ? 'default' : 'outline'}
              aria-pressed={faixa === f}
              onClick={() => setFaixa(faixa === f ? undefined : f)}
            >
              {FAIXA_LABELS[f]}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {TIPAGENS.map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={tipagem === t ? 'default' : 'outline'}
              aria-pressed={tipagem === t}
              onClick={() => setTipagem(tipagem === t ? undefined : t)}
            >
              {TIPAGEM_LABELS[t]}
            </Button>
          ))}
        </div>

        {filtrando && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTermo('')
              setFaixa(undefined)
              setTipagem(undefined)
            }}
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            Limpar
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => colunas.forEach((c) => void c.refetch())}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
          Atualizar
        </Button>
      </div>

      {/* ─── Colunas ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-5">
        {COLUNAS.map((estagio, i) => {
          const q = colunas[i]
          const notas = q?.data?.notas ?? []
          const total = q?.data?.total ?? 0
          const valor = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)

          return (
            <section key={estagio} className="flex min-w-0 flex-col gap-2">
              <header className="flex items-baseline justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                <h2 className="truncate text-sm font-medium">{TITULO_COLUNA[estagio]}</h2>
                <Badge variant="secondary" className="tabular-nums">
                  {q?.isPending ? '…' : formatarInteiro(total)}
                </Badge>
              </header>

              {notas.length > 0 && (
                <p className="px-1 text-xs tabular-nums text-muted-foreground">
                  {formatarMoeda(valor)}
                  {total > notas.length && ` nos ${notas.length} primeiros`}
                </p>
              )}

              <div className="flex flex-col gap-2">
                {q?.isPending ? (
                  <>
                    <Skeleton className="h-40 w-full rounded-lg" />
                    <Skeleton className="h-40 w-full rounded-lg" />
                  </>
                ) : q?.isError ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-center">
                    <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
                    <p className="text-xs text-muted-foreground">
                      {q.error instanceof Error ? q.error.message : 'Erro ao carregar.'}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : notas.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <p className="text-xs text-muted-foreground">
                      {filtrando ? 'Nada com estes filtros.' : 'Nenhuma nota aqui.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {notas.map((nota) => (
                      <NotaCard
                        key={nota.access_key}
                        nota={nota}
                        fornecedor={
                          nota.fornecedor_cnpj ? porCnpj.get(nota.fornecedor_cnpj) : undefined
                        }
                        minimoOperavel={minimoOperavel}
                      />
                    ))}
                    {total > notas.length && (
                      <p className="px-1 pb-2 text-xs text-muted-foreground">
                        Mostrando as {PAGINA_FUNIL} de maior receita esperada, de{' '}
                        {formatarInteiro(total)}. Refine os filtros para chegar às demais.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function FunilCarregando() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-3 lg:grid-cols-5">
        {COLUNAS.map((c) => (
          <Card key={c}>
            <CardContent className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export { COLUNAS as COLUNAS_FUNIL }
