'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Sparkles, UserPlus } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { promoverEmpresaAction } from '@/actions/mercado'
import { formatarData, formatarInteiro, formatarMoeda } from './format'
import { antecipacaoKeys, buscarSacadosAProspectar } from './queries'

/**
 * Sacados a prospectar — o FLYWHEEL INVERSO (§5).
 *
 * Construtoras que NÃO estão na plataforma mas recebem notas de fornecedores que
 * já operam com a gente. Cada linha é uma porta que um fornecedor já abriu: ele
 * confia na plataforma, e a construtora do outro lado já está no fluxo de
 * documentos. É o lead mais quente que existe nesta base, e ele aparece de graça
 * como subproduto do sync de NFs.
 *
 * Ranqueados por volume agregado, porque é o volume que paga a abordagem.
 */
export function SacadosProspectar() {
  const qc = useQueryClient()
  const [promovendo, setPromovendo] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.prospectar(),
    queryFn: buscarSacadosAProspectar,
  })

  async function promover(cnpj: string) {
    setPromovendo(cnpj)
    const r = await promoverEmpresaAction({ cnpj })
    setPromovendo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Empresa promovida para a base — já dá para trabalhá-la em Empresas.')
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.prospectar() })
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base">Sacados a prospectar</CardTitle>
        </div>
        <CardDescription>
          Construtoras fora da plataforma que recebem notas de fornecedores que já antecipam com a
          gente. Cada uma é uma porta aberta por quem já confia na operação.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Construtora</TableHead>
                <TableHead>UF</TableHead>
                <TableHead className="text-right">Notas</TableHead>
                <TableHead className="text-right">Fornecedores que já operam</TableHead>
                <TableHead className="text-right">Valor agregado</TableHead>
                <TableHead>Última nota</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    Nenhum sacado nesta condição ainda. Ela aparece quando um fornecedor que já
                    antecipou emite nota contra uma construtora fora da plataforma.
                  </TableCell>
                </TableRow>
              )}

              {data.map((s) => (
                <TableRow key={s.sacado_cnpj}>
                  <TableCell className="max-w-[18rem]">
                    <p className="truncate font-medium">{s.sacado_nome ?? '—'}</p>
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">
                      {s.sacado_cnpj ? formatCnpj(s.sacado_cnpj) : '—'}
                    </p>
                  </TableCell>
                  <TableCell>{s.sacado_uf ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarInteiro(s.notas)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatarInteiro(s.fornecedores_operando)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatarMoeda(s.valor_agregado)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatarData(s.ultima_nota_em)}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.sacado_empresa_id ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/empresas/${s.sacado_empresa_id}`}>
                          <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Abrir ficha
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={promovendo === s.sacado_cnpj}
                        onClick={() => s.sacado_cnpj && void promover(s.sacado_cnpj)}
                      >
                        <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
                        {promovendo === s.sacado_cnpj ? 'Promovendo…' : 'Promover'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
