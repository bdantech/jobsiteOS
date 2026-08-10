'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { TIPO_VENDEDOR_LABELS, type TipoVendedorId } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarCarteira, buscarVendedoresVisiveis, comercialKeys } from './queries'

/**
 * A carteira de um vendedor — as empresas que são dele, e o número que prova por quê.
 *
 * A unidade da carteira é a HOLDING, e o que ela arrasta são as SPEs do grupo econômico
 * dela. Numa construtora é contra a SPE que se fatura, então tanto o volume quanto as
 * notas contam o grupo inteiro. A tela mostra as duas coisas — quantas SPEs existem e
 * quantas operações vieram por elas — porque um número que triplica sem explicação é um
 * número que ninguém confia.
 *
 * São duas carteiras diferentes, e a diferença é o que o vendedor recebe:
 *
 *   ORIGINAÇÃO  a empresa entrega NOTA. A coluna que importa é quantas NFs vivas ela tem
 *               no funil dele agora: uma empresa na carteira sem nota viva é uma linha de
 *               cadastro que não virou trabalho, e essa é a informação acionável.
 *
 *   PASSIVAS    a conta entrega VOLUME. A coluna que importa é quanto ela antecipou no
 *               mês, porque é literalmente o insumo da comissão dele. Sem esse número a
 *               tela seria um cadastro; com ele é uma prestação de contas.
 *
 * Nenhuma das duas se edita aqui. Carteira se monta em Configurações (pelo vendedor) ou
 * na ficha da empresa (pela conta) — dois caminhos já é o limite; um terceiro faria a
 * mesma decisão ter três lugares para divergir.
 */

const brl = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const mesDe = (competencia: string | undefined) =>
  competencia
    ? new Date(`${competencia}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : 'do mês'

export function CarteiraVendedor({ ehGestor }: { ehGestor: boolean }) {
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)

  const visiveis = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const { data, isPending } = useQuery({
    queryKey: comercialKeys.carteira(vendedorId),
    queryFn: () => buscarCarteira(vendedorId),
  })

  const seletor =
    (visiveis.data ?? []).length > 1 || ehGestor ? (
      <Select value={vendedorId ?? 'eu'} onValueChange={(v) => setVendedorId(v === 'eu' ? null : v)}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Ver carteira de…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eu">Minha carteira</SelectItem>
          {(visiveis.data ?? []).map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.nome} · {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null

  if (isPending) return <Skeleton className="h-64 w-full" />
  if (!data?.tem_acesso) {
    return <p className="text-sm text-muted-foreground">Sem acesso a esta carteira.</p>
  }

  const cabecalho = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Carteira</h1>
        <p className="text-sm text-muted-foreground">
          As empresas atribuídas a este vendedor, e o que cada uma produziu.
        </p>
      </div>
      {seletor}
    </div>
  )

  if (data.sem_vendedor) {
    return (
      <div className="space-y-4">
        {cabecalho}
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Seu usuário não está cadastrado como vendedor — você administra o módulo.
            {(visiveis.data ?? []).length > 0
              ? ' Use o seletor acima para abrir a carteira de alguém.'
              : ' Cadastre o primeiro vendedor em Configurações.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const totalPassivo = data.passivas.reduce((s, p) => s + Number(p.volume_mes ?? 0), 0)

  return (
    <div className="space-y-6">
      {cabecalho}

      {data.tipo === 'vendedor' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle className="text-base">Contas passivas</CardTitle>
              <span className="text-sm tabular-nums text-muted-foreground">
                {brl(totalPassivo)} antecipados em {mesDe(data.competencia)}
              </span>
            </div>
            <CardDescription>
              Contas que antecipam sozinhas. O volume delas no mês é o que gera a comissão —
              não há NF roteada nem funil. Conta <strong>a holding e as SPEs do grupo
              dela</strong>: é contra a SPE que a obra fatura. Para mudar quem gere, edite o
              vendedor em Configurações ou a conta na ficha da empresa.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.passivas.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma conta passiva na carteira — a comissão por volume será zero.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-normal">Empresa</th>
                      <th scope="col" className="px-3 py-2 font-normal">UF</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">SPEs</th>
                      <th scope="col" className="px-3 py-2 font-normal">Gere desde</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Volume no mês</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.passivas.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">
                          <Link href={`/empresas/${p.id}`} className="hover:underline">
                            {p.razao_social ?? p.cnpj}
                          </Link>
                          {/* A vigência é a fonte da comissão; `gestao_operacao` é o
                              rótulo da ficha. Se divergirem, quem paga é a vigência — e
                              a divergência precisa aparecer em vez de ficar implícita. */}
                          {p.gestao_operacao !== 'passivo' ? (
                            <Badge variant="destructive" className="ml-2 text-[10px]">
                              ficha não diz passiva
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{p.uf ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {p.spes || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                          {new Date(p.desde).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {brl(p.volume_mes)}
                          {/* De onde veio o volume. Sem isto, um valor que triplicou parece erro. */}
                          {p.operacoes_via_spe > 0 ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {p.operacoes_via_spe} via SPE
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.tipo === 'originador' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Empresas da carteira</CardTitle>
            <CardDescription>
              As NFs destas empresas — como sacado ou como fornecedor, <strong>e as das SPEs
              do grupo delas</strong> — são roteadas para este originador. Empresa sem NF viva
              não está entregando trabalho: vale revisar se ela ainda pertence à carteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.originacao.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Carteira vazia — nenhuma nota é roteada para ele.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-normal">Empresa</th>
                      <th scope="col" className="px-3 py-2 font-normal">UF</th>
                      <th scope="col" className="px-3 py-2 font-normal">Situação</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">SPEs</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">NFs vivas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.originacao.map((e) => (
                      <tr key={e.id}>
                        <td className="px-3 py-2">
                          <Link href={`/empresas/${e.id}`} className="hover:underline">
                            {e.razao_social ?? e.cnpj}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{e.uf ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {e.gestao_operacao === 'passivo' ? (
                            <Badge variant="destructive" className="text-[10px]">
                              virou passiva — a nota não é roteada
                            </Badge>
                          ) : e.estagio !== 'cliente' ? (
                            <Badge variant="secondary" className="text-[10px]">não é mais cliente ativo</Badge>
                          ) : (
                            'prospecção ativa'
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {e.spes || '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.nfs_vivas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.tipo === 'sdr' && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            SDR não tem carteira: as empresas dele chegam pela distribuição semanal e vivem no
            funil de reuniões, não numa lista fixa.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
