'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, ExternalLink } from 'lucide-react'
import {
  ETAPAS_REUNIAO,
  TIPO_INTERACAO_LABELS,
  TIPO_VENDEDOR_LABELS,
  TIPOS_INTERACAO,
  formatarNota,
  type Agregado,
  type TipoInteracao,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Aviso, ErroCarga, Vazio } from './comum'
import { brlDeCentavos, dataCurta, inteiro, mesCurto, pct, urlAnalise } from './formato'
import { BarrasEtapa, BarrasObjecoes, LinhaEvolucao, type PontoEtapa, type PontoEvolucao } from './graficos'
import { buscarAgregado, qualidadeGestaoKeys } from './queries'

/**
 * VISÃO GERAL (05C §8): como o time está — e, na mesma tela, como o INSTRUMENTO está.
 *
 * ─── A TAXA DE CONTESTAÇÃO FICA AO LADO DAS NOTAS ───────────────────────────
 * Não numa aba de "saúde do sistema" que ninguém abre. Quem olha a nota de alguém
 * precisa ver, no mesmo relance, que o item que derrubou essa nota é contestado em 40%
 * das vezes. Item muito contestado é rubrica mal escrita, não vendedor ruim — e é isso
 * que impede o instrumento de ser usado contra as pessoas quando o defeito é dele.
 *
 * ─── NOTA SÓ DO QUE FOI PUBLICADO ───────────────────────────────────────────
 * A RPC só média análises publicadas; as em sombra aparecem como CONTAGEM ao lado, para o
 * gestor saber quanto ainda está fora da régua — nunca como nota.
 */

const PERIODOS = [30, 90, 180] as const

export function VisaoGeral() {
  const [dias, setDias] = React.useState<number>(90)
  const q = useQuery({ queryKey: qualidadeGestaoKeys.agregado(dias), queryFn: () => buscarAgregado(dias) })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Período" className="inline-flex rounded-md border p-0.5">
          {PERIODOS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={dias === p ? 'secondary' : 'ghost'}
              className="h-7 px-3 text-xs"
              aria-pressed={dias === p}
              onClick={() => setDias(p)}
            >
              {p} dias
            </Button>
          ))}
        </div>
        {q.data ? <StatusFila fila={q.data.fila} /> : null}
      </div>

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <ErroCarga erro={q.error} oque="a visão geral" />
      ) : (
        <Conteudo a={q.data} />
      )}
    </div>
  )
}

const ROTULO_FILA: Record<string, string> = {
  pendente: 'na fila',
  processando: 'processando',
  falhou: 'falharam',
  pulada: 'puladas',
  concluida: 'concluídas',
}

/** A fila de análise: o que ainda vai virar nota. Falha aparece em destaque — é trabalho parado. */
function StatusFila({ fila }: { fila: Agregado['fila'] }) {
  const f = fila ?? {}
  const ordem = ['pendente', 'processando', 'falhou', 'pulada', 'concluida']
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>Fila de análise:</span>
      {ordem.map((s) => (
        <Badge
          key={s}
          variant={s === 'falhou' && (f[s] ?? 0) > 0 ? 'critical' : 'neutral'}
          className="text-[11px] font-normal tabular-nums"
        >
          {inteiro(f[s] ?? 0)} {ROTULO_FILA[s]}
        </Badge>
      ))}
    </div>
  )
}

function Conteudo({ a }: { a: Agregado }) {
  const humanos = a.por_vendedor.filter((v) => !v.is_ia)
  const ias = a.por_vendedor.filter((v) => v.is_ia)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nota média por pessoa</CardTitle>
            <CardDescription>
              Humanos e agentes de IA na mesma régua. Só análises publicadas entram na nota; as em
              sombra (itens ainda não calibrados) aparecem como contagem. Nota vazia é &quot;sem avaliação
              aplicável&quot;, nunca zero.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {a.por_vendedor.length === 0 ? (
              <Vazio>Nenhuma análise no período.</Vazio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-normal">Pessoa</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Nota</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Reunião</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Ligação</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Conversa</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Publicadas</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Em sombra</th>
                      <th scope="col" className="px-3 py-2 text-right font-normal">Pendências</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {humanos.map((v) => (
                      <LinhaPessoa key={v.vendedor_id} v={v} />
                    ))}
                    {ias.length > 0 ? (
                      <tr className="bg-muted/40">
                        <th scope="rowgroup" colSpan={8} className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">
                          Agentes de IA
                        </th>
                      </tr>
                    ) : null}
                    {ias.map((v) => (
                      <LinhaPessoa key={v.vendedor_id} v={v} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <ContestacaoPorItem itens={a.contestacao_por_item} />
      </div>

      <PorTipo porEtapa={a.por_etapa} />

      <PorEtapa porEtapa={a.por_etapa} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Evolução semanal da nota</CardTitle>
          <CardDescription>
            Nota média publicada por semana. Comparar nota só vale dentro da mesma versão da
            rubrica: quando uma versão nova é ativada, a curva antes e depois mede réguas diferentes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {a.evolucao.length === 0 ? <Vazio>Sem notas publicadas no período.</Vazio> : <LinhaEvolucao pontos={pivotEvolucao(a.evolucao)} />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Objeções registradas</CardTitle>
            <CardDescription>O que os clientes levantaram nas ligações e conversas do período.</CardDescription>
          </CardHeader>
          <CardContent>
            {a.objecoes.length === 0 ? <Vazio>Nenhuma objeção registrada.</Vazio> : <BarrasObjecoes objecoes={a.objecoes} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Menções a concorrente</CardTitle>
            <CardDescription>Interações em que o cliente citou outra empresa de antecipação ou ERP.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {a.concorrentes.length === 0 ? (
              <Vazio>Nenhuma menção no período.</Vazio>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto text-sm">
                {a.concorrentes.map((c) => (
                  <li key={c.analise_id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.empresa_nome ?? 'Empresa sem nome'}</p>
                      <p className="text-xs text-muted-foreground">
                        {dataCurta(c.analisada_em)}
                        {c.vendedor ? ` · ${c.vendedor}` : ''}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 text-xs">
                      <Link href={urlAnalise(c.analise_id)}>
                        Ver análise <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Custo custo={a.custo} />
    </div>
  )
}

function LinhaPessoa({ v }: { v: Agregado['por_vendedor'][number] }) {
  return (
    <tr className="align-middle">
      <td className="px-3 py-2">
        <span className="font-medium">{v.nome}</span>
        {v.is_ia ? (
          <Badge variant="info" className="ml-2 text-[10px]">
            <Bot className="mr-0.5 h-3 w-3" aria-hidden /> IA
          </Badge>
        ) : null}
        <span className="ml-2 text-xs text-muted-foreground">{TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}</span>
      </td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatarNota(v.nota_media)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatarNota(v.nota_reuniao)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatarNota(v.nota_ligacao)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatarNota(v.nota_conversa)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{inteiro(v.analises)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{inteiro(v.em_sombra)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{inteiro(v.pendencias_abertas)}</td>
    </tr>
  )
}

/**
 * A saúde do instrumento. Ordenada pela taxa (a RPC já ordena); item marcado para
 * revisão de redação (`rubrica_ajustar` numa contestação) vem destacado — ele já foi
 * reconhecido como defeito da pergunta.
 */
function ContestacaoPorItem({ itens }: { itens: Agregado['contestacao_por_item'] }) {
  const comContestacao = itens.filter((i) => i.contestados > 0 || i.precisa_revisao)
  return (
    <Card className="xl:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Taxa de contestação por item</CardTitle>
        <CardDescription>
          <strong>Item muito contestado é rubrica mal escrita, não vendedor ruim.</strong> Antes de cobrar
          alguém por um item, veja aqui se o item se sustenta.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {comContestacao.length === 0 ? (
          <Vazio>Nenhum item contestado no período.</Vazio>
        ) : (
          <div className="max-h-[26rem] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-normal">Item</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Taxa</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal" title="Contestações procedentes">Proc.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {comContestacao.map((i) => (
                  <tr key={`${i.tipo_interacao}:${i.chave}`} className={cn(i.precisa_revisao && 'bg-amber-50/60 dark:bg-amber-950/20')}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{i.rotulo}</p>
                      <p className="text-xs text-muted-foreground">
                        {TIPO_INTERACAO_LABELS[i.tipo_interacao]} · {inteiro(i.contestados)} de {inteiro(i.avaliados)} avaliados
                      </p>
                      {i.precisa_revisao ? (
                        <Badge variant="warning" className="mt-1 text-[10px]">
                          <AlertTriangle className="mr-0.5 h-3 w-3" aria-hidden /> Pergunta marcada para reescrever
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{pct(i.taxa, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inteiro(i.procedentes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Por tipo de interação: a taxa de itens atendidos, ponderada pelo número de itens de
 * cada etapa. Não é a média das notas (essa está por pessoa, na tabela) — é a fração dos
 * itens aplicáveis que foram atendidos, que é o que se compara entre humano e IA sem que
 * um vendedor com muitas análises pese pelo time inteiro.
 */
function PorTipo({ porEtapa }: { porEtapa: Agregado['por_etapa'] }) {
  const linhas = TIPOS_INTERACAO.map((tipo) => {
    const doTipo = porEtapa.filter((e) => e.tipo_interacao === tipo)
    const media = (ia: boolean) => {
      const xs = doTipo.filter((e) => Boolean(e.is_ia) === ia && e.taxa !== null)
      const n = xs.reduce((s, e) => s + Number(e.itens), 0)
      return { taxa: n > 0 ? xs.reduce((s, e) => s + Number(e.taxa) * Number(e.itens), 0) / n : null, itens: n }
    }
    return { tipo, humano: media(false), ia: media(true) }
  }).filter((l) => l.humano.itens > 0 || l.ia.itens > 0)

  if (linhas.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Por tipo de interação</CardTitle>
        <CardDescription>Fração dos itens aplicáveis que foram atendidos, nas análises publicadas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {linhas.map((l) => (
          <div key={l.tipo} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{TIPO_INTERACAO_LABELS[l.tipo]}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Humanos</dt>
                <dd className="tabular-nums">
                  <span className="font-semibold">{pct(l.humano.taxa)}</span>{' '}
                  <span className="text-xs text-muted-foreground">({inteiro(l.humano.itens)} itens)</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Agentes de IA</dt>
                <dd className="tabular-nums">
                  <span className="font-semibold">{pct(l.ia.taxa)}</span>{' '}
                  <span className="text-xs text-muted-foreground">({inteiro(l.ia.itens)} itens)</span>
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Por etapa da rubrica: um gráfico por tipo de interação (small multiples), porque as
 * etapas são de rubricas diferentes — "Dor" da reunião e "Geral" da ligação não estão
 * na mesma régua e não podem dividir um eixo de categorias.
 */
function PorEtapa({ porEtapa }: { porEtapa: Agregado['por_etapa'] }) {
  const tipos = TIPOS_INTERACAO.filter((t) => porEtapa.some((e) => e.tipo_interacao === t))
  if (tipos.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Por etapa da rubrica</CardTitle>
        <CardDescription>
          Itens atendidos por etapa, ponderados pelo peso — humanos ao lado dos agentes de IA. Passe o
          mouse para ver quantos itens sustentam cada barra.
        </CardDescription>
      </CardHeader>
      <CardContent className={cn('grid gap-6', tipos.length > 1 && 'lg:grid-cols-2')}>
        {tipos.map((t) => (
          <div key={t} className="space-y-1">
            <p className="text-sm font-medium">{TIPO_INTERACAO_LABELS[t]}</p>
            <BarrasEtapa pontos={pontosEtapa(porEtapa, t)} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/*
 * `is_ia` nulo é análise sem vendedor amarrado; conta como humano, igual à evolução da
 * RPC (`coalesce(v.is_ia, false)`) — duas réguas diferentes para o mesmo nulo fariam os
 * dois gráficos discordarem.
 */
function pontosEtapa(porEtapa: Agregado['por_etapa'], tipo: TipoInteracao): PontoEtapa[] {
  const acc = new Map<string, PontoEtapa & { soma_h: number; soma_i: number }>()
  for (const e of porEtapa) {
    if (e.tipo_interacao !== tipo || e.taxa === null) continue
    const p = acc.get(e.etapa) ?? { etapa: e.etapa, humano: null, ia: null, itens_humano: 0, itens_ia: 0, soma_h: 0, soma_i: 0 }
    if (e.is_ia) {
      p.itens_ia += Number(e.itens)
      p.soma_i += Number(e.taxa) * Number(e.itens)
    } else {
      p.itens_humano += Number(e.itens)
      p.soma_h += Number(e.taxa) * Number(e.itens)
    }
    acc.set(e.etapa, p)
  }
  const ordem = tipo === 'reuniao' ? (ETAPAS_REUNIAO as readonly string[]) : []
  return [...acc.values()]
    .map(({ soma_h, soma_i, ...p }) => ({
      ...p,
      humano: p.itens_humano > 0 ? soma_h / p.itens_humano : null,
      ia: p.itens_ia > 0 ? soma_i / p.itens_ia : null,
    }))
    .sort((x, y) => {
      const ix = ordem.indexOf(x.etapa)
      const iy = ordem.indexOf(y.etapa)
      if (ix !== iy) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy)
      return x.etapa.localeCompare(y.etapa, 'pt-BR')
    })
}

function pivotEvolucao(evolucao: Agregado['evolucao']): PontoEvolucao[] {
  const acc = new Map<string, PontoEvolucao>()
  for (const e of evolucao) {
    const p = acc.get(e.semana) ?? { semana: e.semana, humano: null, ia: null, analises_humano: 0, analises_ia: 0 }
    if (e.is_ia) {
      p.ia = e.nota_media === null ? null : Number(e.nota_media)
      p.analises_ia = Number(e.analises)
    } else {
      p.humano = e.nota_media === null ? null : Number(e.nota_media)
      p.analises_humano = Number(e.analises)
    }
    acc.set(e.semana, p)
  }
  return [...acc.values()].sort((a, b) => a.semana.localeCompare(b.semana))
}

/**
 * Custo por mês e por provedor (§4.1, §8). A coluna que importa é a da QUEDA para o
 * Claude e a da banda cinzenta: o Jev é o braço barato, e banda larga demais anula a
 * economia — se a fração de itens decididos pelo Claude sobe, o `delta` está largo ou o
 * Jev está caindo, e as duas coisas se corrigem em lugares diferentes.
 *
 * O custo não respeita o seletor de período: são sempre os últimos 12 meses fechados por
 * mês, que é como a fatura chega.
 */
function Custo({ custo }: { custo: Agregado['custo'] }) {
  const ultimo = custo[0]
  const fracClaude =
    ultimo && Number(ultimo.itens_claude) + Number(ultimo.itens_jev) > 0
      ? Number(ultimo.itens_claude) / (Number(ultimo.itens_claude) + Number(ultimo.itens_jev))
      : null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Custo da análise</CardTitle>
        <CardDescription>
          Últimos 12 meses, por provedor. O Jev roda em tudo; o Claude entra nos itens reprovados, na
          banda cinzenta e quando o Jev cai.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        {custo.length === 0 ? (
          <Vazio>Nenhuma análise nos últimos 12 meses.</Vazio>
        ) : (
          <>
            {fracClaude !== null && fracClaude > 0.5 ? (
              <Aviso className="mx-4 mt-1">
                Em {mesCurto(ultimo!.mes)}, {pct(fracClaude)} dos itens foram decididos pelo Claude. Banda cinzenta
                larga ou Jev indisponível anulam a economia — confira o <em>delta</em> em Configurações.
              </Aviso>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-normal">Mês</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Análises</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Jev</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Claude</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Total</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Caíram p/ Claude</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Itens Jev</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Itens Claude</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Banda cinzenta</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {custo.map((c) => {
                    const total = Number(c.jev_centavos ?? 0) + Number(c.claude_centavos ?? 0)
                    return (
                      <tr key={c.mes}>
                        <td className="px-3 py-2 font-medium">{mesCurto(c.mes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inteiro(c.analises)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brlDeCentavos(c.jev_centavos)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{brlDeCentavos(c.claude_centavos)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{brlDeCentavos(total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inteiro(c.caiu_para_claude)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inteiro(c.itens_jev)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inteiro(c.itens_claude)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inteiro(c.itens_banda_cinzenta)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
