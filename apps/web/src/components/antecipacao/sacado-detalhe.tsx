'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Building2, ExternalLink, FileText, SearchX, Sparkles, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FichaVoltar } from '@/components/ficha/ficha'
import { promoverEmpresaAction } from '@/actions/mercado'
import { cn } from '@/lib/utils'
import { NotaModal } from './documento/nota-modal'
import {
  FAIXA_BADGE,
  creditoBadge,
  formatarData,
  formatarInteiro,
  formatarMoeda,
  formatarMoedaExata,
  labelCredito,
} from './format'
import { antecipacaoKeys, buscarDetalheSacado, type NotaFunil } from './queries'
import type { Faixa } from '@jobsiteos/core'

/**
 * O sacado e as notas que ELE RECEBEU.
 *
 * Uma tela, dois caminhos de entrada, e por isso duas leituras agregadas: quem
 * chega pela aba "Por sacado" quer limite vs. demanda; quem chega por "a
 * prospectar" quer volume, desde quando e de quantos fornecedores. Mostrar só
 * metade dependendo da porta de entrada obrigaria a pessoa a voltar.
 *
 * A lista de notas é TABELA, não card: aqui a pergunta é "quanto e de quem", que
 * se responde varrendo uma coluna — e são até 200 linhas. Cada linha abre a nota.
 */
export function SacadoDetalhe({ cnpj }: { cnpj: string }) {
  const [nota, setNota] = React.useState<NotaFunil | null>(null)
  const [promovendo, setPromovendo] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.sacado(cnpj),
    queryFn: () => buscarDetalheSacado(cnpj),
  })

  async function promover() {
    setPromovendo(true)
    const r = await promoverEmpresaAction({ cnpj })
    setPromovendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Construtora promovida para a base — já dá para trabalhá-la em Empresas.')
    void refetch()
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar o sacado.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { sacado, prospect, notas } = data

  if (notas.length === 0) {
    return (
      <div className="space-y-4">
        <FichaVoltar href="/antecipacao/sacados">Sacados</FichaVoltar>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="rounded-full bg-muted p-3">
              <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-lg font-medium">Nenhuma nota para este CNPJ</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ele pode não ter notas sincronizadas, ou você pode não ter acesso a elas.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const primeira = notas[0]
  const nome = prospect?.sacado_nome ?? sacado?.sacado_nome ?? primeira?.sacado_nome ?? formatCnpj(cnpj)
  const empresaId = sacado?.sacado_empresa_id ?? prospect?.sacado_empresa_id ?? primeira?.sacado_empresa_id ?? null
  const naPlataforma = primeira?.sacado_cadastrado ?? false

  const valorTotal = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const fornecedores = new Set(notas.map((n) => n.fornecedor_cnpj).filter(Boolean)).size
  const demanda = Number(sacado?.demanda_pipeline ?? 0)
  const disponivel = Number(sacado?.available_limit ?? 0)

  return (
    <div className="space-y-4">
      <FichaVoltar href={prospect ? '/antecipacao/prospectar' : '/antecipacao/sacados'}>
        {prospect ? 'Sacados a prospectar' : 'Por sacado'}
      </FichaVoltar>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">{nome}</CardTitle>
              <CardDescription className="font-mono tabular-nums">
                {formatCnpj(cnpj)}
                {prospect?.sacado_municipio || prospect?.sacado_uf
                  ? ` · ${[prospect.sacado_municipio, prospect.sacado_uf].filter(Boolean).join(' / ')}`
                  : ''}
              </CardDescription>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {naPlataforma ? (
                  <Badge variant="secondary">Na plataforma</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1">
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Fora da plataforma
                  </Badge>
                )}
                {prospect?.sacado_cnae_principal ? (
                  <Badge variant="outline" className="font-mono">
                    CNAE {prospect.sacado_cnae_principal}
                  </Badge>
                ) : null}
                {primeira?.sacado_credito_status ? (
                  <Badge className={creditoBadge(primeira.sacado_credito_status)}>
                    {labelCredito(primeira.sacado_credito_status)}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 gap-2">
              {empresaId ? (
                <Button variant="outline" asChild>
                  <Link href={`/empresas/${empresaId}`}>
                    <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                    Company 360
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" disabled={promovendo} onClick={() => void promover()}>
                  <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                  {promovendo ? 'Promovendo…' : 'Promover para Empresas'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Notas recebidas</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarInteiro(notas.length)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Valor recebido</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarMoeda(valorTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Fornecedores</dt>
              <dd className="text-lg font-medium tabular-nums">{formatarInteiro(fornecedores)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {prospect ? 'Notas de quem já antecipa' : 'Pipeline em faixa'}
              </dt>
              <dd className="text-lg font-medium tabular-nums">
                {prospect
                  ? formatarInteiro(prospect.notas_de_quem_ja_antecipou)
                  : formatarMoeda(demanda)}
              </dd>
            </div>
          </dl>

          {/* Capacidade só faz sentido para quem JÁ tem crédito analisado. */}
          {sacado && demanda > 0 ? (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Limite vs. demanda do pipeline
              </p>
              <p className="mt-1 text-sm tabular-nums">
                {formatarMoeda(demanda)} em notas em faixa contra{' '}
                {formatarMoeda(disponivel)} de limite disponível
                {demanda > disponivel ? (
                  <span className="ml-1 font-medium text-destructive">
                    — excede {formatarMoeda(demanda - disponivel)}
                  </span>
                ) : (
                  <span className="ml-1 text-muted-foreground">— cabe</span>
                )}
              </p>
            </div>
          ) : null}

          {prospect ? (
            <p className="text-xs text-muted-foreground">
              Recebe notas desde {formatarData(prospect.primeira_nota_em)}; a última em{' '}
              {formatarData(prospect.ultima_nota_em)}.
              {(prospect.notas_de_quem_ja_antecipou ?? 0) > 0 ? (
                <>
                  {' '}
                  <strong className="text-foreground">
                    {formatarInteiro(prospect.notas_de_quem_ja_antecipou)}
                  </strong>{' '}
                  dessas notas vêm de fornecedores que já antecipam com a gente — cada um é uma
                  porta de entrada.
                </>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">
              Notas recebidas ({formatarInteiro(notas.length)})
            </CardTitle>
          </div>
          <CardDescription>Clique numa linha para abrir a nota.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nota</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Faixa</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notas.map((n) => (
                  <TableRow
                    key={n.access_key}
                    onClick={() => setNota(n)}
                    className="cursor-pointer"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setNota(n)
                    }}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {n.tipo_nf ?? 'NFe'}
                        </Badge>
                        <span className="tabular-nums">
                          {n.numero ?? '—'}
                          {n.serie ? `/${n.serie}` : ''}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[18rem]">
                      <Link
                        href={`/antecipacao/fornecedores/${n.fornecedor_cnpj}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate hover:underline"
                      >
                        {n.fornecedor_nome ?? n.fornecedor_cnpj}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatarData(n.emitida_em)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatarData(n.vencimento)}
                    </TableCell>
                    <TableCell>
                      {n.faixa ? (
                        <Badge className={FAIXA_BADGE[n.faixa as Faixa]}>{n.faixa}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {n.faixa_motivo ?? '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn('text-right font-medium tabular-nums')}>
                      {formatarMoedaExata(n.valor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {notas.length >= 200 ? (
            <p className="border-t px-6 py-3 text-xs text-muted-foreground">
              Mostrando as 200 notas mais recentes.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {nota?.access_key ? (
        <NotaModal
          accessKey={nota.access_key}
          titulo={`Nota ${nota.numero ?? nota.access_key}${nota.serie ? `/${nota.serie}` : ''}`}
          subtitulo={`${nota.fornecedor_nome ?? nota.fornecedor_cnpj} → ${nome}`}
          aberto
          onOpenChange={(v) => !v && setNota(null)}
        />
      ) : null}

      {!naPlataforma && !empresaId ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" aria-hidden />
          Esta construtora ainda não existe na base de Empresas. Promover cria a ficha e a timeline
          — não fala com ninguém.
        </p>
      ) : null}
    </div>
  )
}
