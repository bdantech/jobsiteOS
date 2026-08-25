'use client'

import { useQuery } from '@tanstack/react-query'
import { ESTAGIO_FORNECEDOR_LABELS, type EstagioFornecedor } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarPainelFornecedores, fornecedoresKeys } from './queries'
import { brl, brlExato, cnpjFormatado, rotuloConfianca, varianteConfianca } from './formato'

/**
 * Painel do originador (04l §5).
 *
 * Quatro números e um ranking, e a escolha dos quatro é a resposta a "o que eu faço
 * agora": quanto ainda há para pegar, quanto do meu orçamento sobrou, onde os cards
 * estão parados e quais valem a próxima ligação.
 *
 * O GASTO fica ao lado do potencial de propósito. Descoberta é o único lugar deste
 * sistema em que o originador gasta dinheiro sozinho, e ver os dois juntos é o que
 * transforma o teto de uma trava em uma decisão — "gastei R$ 12 e tenho R$ 4,3 milhões
 * de potencial na carteira" é uma frase que se lê de uma vez.
 */
export function PainelFornecedores({ originadorId }: { originadorId: string | null }) {
  const painel = useQuery({
    queryKey: fornecedoresKeys.painel(originadorId),
    queryFn: () => buscarPainelFornecedores(originadorId),
  })

  if (painel.isPending) return <Skeleton className="h-40 w-full" />
  const d = painel.data
  if (!d?.tem_acesso) return null

  const gasto = Number(d.gasto_mes ?? 0)
  const teto = Number(d.teto_mensal ?? 0)
  const pct = teto > 0 ? Math.min(100, Math.round((gasto / teto) * 100)) : 0

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs uppercase tracking-wide">
              Potencial na carteira
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(d.potencial_total)}</p>
            <p className="text-[11px] text-muted-foreground">
              Faturamento mensal estimado dos fornecedores ainda não cadastrados.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs uppercase tracking-wide">
              Gasto em descoberta
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brlExato(gasto)}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={pct >= 80 ? 'h-full bg-destructive' : 'h-full bg-primary'}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Teto do mês: {brlExato(teto)}. Dentro dele você aciona sozinho.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs uppercase tracking-wide">
              Por estágio
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {Object.entries(d.por_estagio ?? {}).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum fornecedor.</p>
            ) : (
              Object.entries(d.por_estagio ?? {}).map(([e, n]) => (
                <Badge key={e} variant="outline" className="text-[10px]">
                  {ESTAGIO_FORNECEDOR_LABELS[e as EstagioFornecedor] ?? e}: {n}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs uppercase tracking-wide">
              {d.sem_dono === null || d.sem_dono === undefined ? 'Contatos' : 'Sem dono'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.sem_dono === null || d.sem_dono === undefined ? (
              <p className="text-sm text-muted-foreground">
                A descoberta automática roda toda madrugada para os fornecedores da sua carteira.
              </p>
            ) : (
              <>
                <p className="text-2xl font-semibold">{d.sem_dono}</p>
                <p className="text-[11px] text-muted-foreground">
                  Fornecedores cujo sacado não tem originador titular na carteira de originação.
                  Enquanto ninguém os pegar, ninguém liga.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Os dez que mais valem</CardTitle>
          <CardDescription className="text-xs">
            Por potencial mensal do FORNECEDOR. O limite do sacado não entra: ele é o teto da
            operação, não do lead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(d.ranking ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada na carteira.</p>
          ) : (
            (d.ranking ?? []).map((r, i) => (
              <div key={r.fornecedor_cnpj} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="truncate">{r.nome}</span>
                  <Badge variant={varianteConfianca(r.melhor_confianca)} className="shrink-0 text-[10px]">
                    {r.contatos_encontrados
                      ? `${r.contatos_encontrados} · ${rotuloConfianca(r.melhor_confianca)}`
                      : 'sem contato'}
                  </Badge>
                </span>
                <span className="shrink-0 tabular-nums font-medium">{brl(r.potencial_mensal)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
