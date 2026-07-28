'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Clock, ExternalLink, Sparkles, UserPlus } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { promoverEmpresaAction } from '@/actions/mercado'
import { cn } from '@/lib/utils'
import { formatarData, formatarInteiro, formatarMoeda } from './format'
import {
  antecipacaoKeys,
  buscarSacadosAProspectar,
  contarSacadosSemCnae,
  type SacadoProspectar,
} from './queries'

/**
 * Sacados a prospectar — construtoras que recebem NF e não estão na plataforma.
 *
 * O RECORTE É POR CNAE (divisões 41/42/43), e é ele que separa oportunidade de
 * ruído: sem o filtro, a lista vira "todo CNPJ que já apareceu como destinatário"
 * — posto de gasolina, papelaria, o contador do fornecedor.
 *
 * A regra ANTERIOR era "fornecedor que já antecipou", e não funcionava:
 * `clientes_onepay` só contém construtoras (os sacados), então casar o CNPJ do
 * FORNECEDOR contra ela era um predicado quase sempre falso. Aquele sinal não
 * sumiu — virou a coluna "de quem já antecipa", um indicador de temperatura
 * DENTRO da lista em vez de um portão na entrada dela.
 *
 * Ranqueado por valor agregado: é o volume que paga a abordagem.
 */
export function SacadosProspectar() {
  const qc = useQueryClient()
  const [promovendo, setPromovendo] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.prospectar(),
    queryFn: buscarSacadosAProspectar,
  })

  const { data: pendentes = 0 } = useQuery({
    queryKey: antecipacaoKeys.prospectarPendentes(),
    queryFn: contarSacadosSemCnae,
  })

  async function promover(cnpj: string) {
    setPromovendo(cnpj)
    const r = await promoverEmpresaAction({ cnpj })
    setPromovendo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Construtora promovida para a base — já dá para trabalhá-la em Empresas.')
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

  const total = data.reduce((s, r) => s + Number(r.valor_agregado ?? 0), 0)

  return (
    <div className="space-y-4">
      {/*
       * A ausência precisa ser explicada. O recorte por CNAE cria uma janela entre
       * a nota chegar e o lookup cadastral responder — sem este aviso, uma lista
       * curta parece "não há oportunidade" quando na verdade é "ainda não sabemos".
       */}
      {pendentes > 0 ? (
        <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {formatarInteiro(pendentes)} sacado{pendentes > 1 ? 's' : ''} ainda sem CNAE
            </p>
            <p>
              Eles não aparecem aqui até o lookup cadastral responder — o job diário consome a fila,
              ou você pode rodá-lo agora em{' '}
              <Link href="/antecipacao/config" className="font-medium underline">
                Configurações
              </Link>
              . Só entram na lista os que forem construção (CNAE 41, 42 ou 43).
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">Sacados a prospectar</CardTitle>
          </div>
          <CardDescription>
            Construtoras (CNAE 41, 42 ou 43) que recebem notas fiscais e <strong>não estão</strong>{' '}
            na plataforma, ranqueadas por valor recebido.
            {data.length > 0 ? (
              <>
                {' '}
                {formatarInteiro(data.length)} construtora{data.length > 1 ? 's' : ''} somando{' '}
                {formatarMoeda(total)} em notas.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Construtora</TableHead>
                  <TableHead>CNAE</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Notas</TableHead>
                  <TableHead className="text-right">Fornecedores</TableHead>
                  <TableHead className="text-right">De quem já antecipa</TableHead>
                  <TableHead className="text-right">Valor recebido</TableHead>
                  <TableHead>Última nota</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      Nenhuma construtora nesta condição ainda. A lista se enche quando o sync
                      trouxer notas cujo destinatário tenha CNAE de construção e não esteja na
                      plataforma.
                    </TableCell>
                  </TableRow>
                )}

                {data.map((s: SacadoProspectar) => (
                  <TableRow key={s.sacado_cnpj}>
                    <TableCell className="max-w-[18rem]">
                      <Link
                        href={`/antecipacao/sacados/${s.sacado_cnpj}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {s.sacado_nome ?? '—'}
                      </Link>
                      <p className="font-mono text-xs tabular-nums text-muted-foreground">
                        {s.sacado_cnpj ? formatCnpj(s.sacado_cnpj) : '—'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {s.sacado_cnae_principal ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[s.sacado_municipio, s.sacado_uf].filter(Boolean).join(' / ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(s.notas)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(s.fornecedores)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        (s.notas_de_quem_ja_antecipou ?? 0) > 0 && 'font-medium text-emerald-700 dark:text-emerald-300',
                      )}
                      title="Notas emitidas por fornecedores que já antecipam com a gente — cada uma é uma porta de entrada."
                    >
                      {formatarInteiro(s.notas_de_quem_ja_antecipou)}
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
                            Ficha
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
    </div>
  )
}
