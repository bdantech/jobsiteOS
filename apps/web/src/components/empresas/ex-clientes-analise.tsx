'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, TrendingDown } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buscarExClientesAnalise,
  buscarExClientesLista,
  empresasKeys,
  type ExClientesAnalise,
  type RecorteExClientes,
} from './queries'

/**
 * Ex-clientes na aba Análise: quantos são, quantos dá para reconquistar, e por quê
 * saíram.
 *
 * CONTA EXATAMENTE AS LINHAS DA LISTA — nem uma a mais. O recorte é `na_lista`
 * (0115): matriz, não-SPE, não-oculta. Antes daquela migração este card descontava
 * os ocultos mas não as filiais e SPEs, e dizia 139 enquanto a lista ao lado mostrava
 * 72. Um número que contradiz a tela ao lado destrói a confiança nos dois, e a
 * correção não é acertar a conta aqui: é não ter uma segunda definição.
 *
 * A CLASSIFICAÇÃO DE RETORNO mora no banco (`motivos_perda.retorno_possivel`), não
 * aqui: a lista de motivos é editável por admin, e uma regra em TS chaveada por
 * texto de rótulo quebraria no dia em que alguém corrigisse um acento.
 */

/** Quantas fatias o donut aguenta. Acima disso, some tudo numa só. */
const FATIAS_MAX = 6

/**
 * Os seis matizes categóricos do tema, em ORDEM FIXA (globals.css). Nunca ciclados:
 * a sétima categoria vira "Outros", porque um matiz gerado é indistinguível de um
 * existente sob daltonismo — e aí a legenda mente.
 */
const CORES = [
  'hsl(var(--cat-1))',
  'hsl(var(--cat-2))',
  'hsl(var(--cat-3))',
  'hsl(var(--cat-4))',
  'hsl(var(--cat-5))',
  'hsl(var(--cat-6))',
] as const

/** Cinza para o que não é resposta: "não classificado" não é uma causa de churn. */
const CINZA = 'hsl(var(--muted-foreground) / 0.35)'

interface Fatia {
  motivo: string
  total: number
  retornoPossivel: boolean | null
  cor: string
  /**
   * Os motivos que esta fatia SOMA. Uma fatia normal tem um; "Outros (N motivos)" e
   * "Sem motivo registrado" têm vários — e é por isso que o recorte viaja como lista e
   * não como rótulo: clicar numa fatia agregada tem de abrir exatamente as linhas que
   * ela somou, não uma aproximação por nome.
   */
  motivosOrigem: string[]
}

/** O recorte que o diálogo está mostrando. */
interface Recorte {
  titulo: string
  ajuda: string
  recorte: RecorteExClientes
  motivos: string[]
}

const NAO_E_RESPOSTA = new Set(['Não classificado', 'Motivo desconhecido'])

/**
 * Recorta a distribuição em no máximo seis fatias.
 *
 * O donut só é legível até ~6 segmentos, e há 14 motivos possíveis. O excedente vai
 * para "Outros" em vez de virar matiz novo. Os que não são resposta ("Não
 * classificado", "Motivo desconhecido") vão para o fim e ficam cinzas, porque não
 * competem com as causas de verdade — sem isso, o maior pedaço do gráfico seria a
 * ausência de dado pintada como se fosse informação.
 */
function montarFatias(distribuicao: ExClientesAnalise['distribuicao']): Fatia[] {
  const causas = distribuicao.filter((d) => !NAO_E_RESPOSTA.has(d.motivo))
  const semResposta = distribuicao.filter((d) => NAO_E_RESPOSTA.has(d.motivo))

  const cabem = Math.max(0, FATIAS_MAX - (semResposta.length > 0 ? 1 : 0))
  const principais = causas.slice(0, cabem)
  const resto = causas.slice(cabem)

  const fatias: Fatia[] = principais.map((d, i) => ({
    motivo: d.motivo,
    total: d.total,
    retornoPossivel: d.retorno_possivel,
    cor: CORES[i % CORES.length]!,
    motivosOrigem: [d.motivo],
  }))

  if (resto.length > 0) {
    fatias.push({
      motivo: `Outros (${resto.length} motivos)`,
      total: resto.reduce((s, d) => s + d.total, 0),
      retornoPossivel: null,
      cor: CORES[Math.min(principais.length, CORES.length - 1)]!,
      motivosOrigem: resto.map((d) => d.motivo),
    })
  }

  const totalSemResposta = semResposta.reduce((s, d) => s + d.total, 0)
  if (totalSemResposta > 0) {
    fatias.push({
      motivo: 'Sem motivo registrado',
      total: totalSemResposta,
      retornoPossivel: null,
      cor: CINZA,
      motivosOrigem: semResposta.map((d) => d.motivo),
    })
  }

  return fatias
}

/** Um arco do donut, em coordenadas de um círculo de raio 1 centrado na origem. */
function arco(inicio: number, fim: number, raioExterno: number, raioInterno: number): string {
  const p = (angulo: number, r: number) => {
    const rad = (angulo - 90) * (Math.PI / 180)
    return [50 + r * Math.cos(rad), 50 + r * Math.sin(rad)]
  }
  const [x1, y1] = p(inicio, raioExterno)
  const [x2, y2] = p(fim, raioExterno)
  const [x3, y3] = p(fim, raioInterno)
  const [x4, y4] = p(inicio, raioInterno)
  const maior = fim - inicio > 180 ? 1 : 0
  return [
    `M ${x1} ${y1}`,
    `A ${raioExterno} ${raioExterno} 0 ${maior} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${raioInterno} ${raioInterno} 0 ${maior} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

function Donut({
  fatias,
  total,
  onAbrir,
}: {
  fatias: Fatia[]
  total: number
  onAbrir: (f: Fatia) => void
}) {
  let acumulado = 0
  // 2px de superfície entre fatias: sem o vão, dois matizes vizinhos encostam e a
  // fronteira some justamente para quem tem dificuldade de distingui-los.
  const VAO = fatias.length > 1 ? 1.5 : 0

  return (
    <svg viewBox="0 0 100 100" className="h-44 w-44 shrink-0" role="img" aria-label="Distribuição dos motivos de saída">
      {fatias.map((f) => {
        const angulo = (f.total / total) * 360
        const inicio = acumulado
        acumulado += angulo
        const fim = Math.max(inicio, acumulado - VAO)
        return (
          <path
            key={f.motivo}
            d={arco(inicio, fim, 46, 30)}
            fill={f.cor}
            className="cursor-pointer outline-none transition-opacity hover:opacity-80"
            onClick={() => onAbrir(f)}
          >
            <title>{`${f.motivo}: ${f.total} (${Math.round((f.total / total) * 100)}%) — clique para ver quem`}</title>
          </path>
        )
      })}
      {/* O total no miolo: é a pergunta que o gráfico responde antes das fatias. */}
      <text x="50" y="48" textAnchor="middle" className="fill-foreground text-[13px] font-semibold tabular-nums">
        {total}
      </text>
      <text x="50" y="58" textAnchor="middle" className="fill-muted-foreground text-[6px]">
        ex-clientes
      </text>
    </svg>
  )
}

/**
 * O indicador é um BOTÃO. Um número que não abre é um número em que se acredita ou não
 * se acredita; abrindo, vira a lista de quem ligar — que é o que se queria desde o
 * começo. Vale inclusive para o zero: "nenhum com chance de retorno" merece a mesma
 * confirmação que os outros, e uma lista vazia é resposta.
 */
function Indicador({
  rotulo,
  valor,
  ajuda,
  tom,
  onAbrir,
}: {
  rotulo: string
  valor: number
  ajuda: string
  tom?: 'bom' | 'ruim'
  onAbrir: () => void
}) {
  const cor = tom === 'bom' ? 'text-emerald-700 dark:text-emerald-300' : tom === 'ruim' ? 'text-destructive' : ''
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
    </button>
  )
}

const brl = (n: number | null) =>
  n === null || !Number.isFinite(Number(n))
    ? null
    : Number(n).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        notation: 'compact',
        maximumFractionDigits: 1,
      })

function dataBr(iso: string | null): string | null {
  if (!iso) return null
  const [a, m, d] = iso.split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

/** A lista por trás do indicador clicado — mesmo desenho do drill-down do mapa. */
function ListaDialog({ alvo, onOpenChange }: { alvo: Recorte | null; onOpenChange: (a: boolean) => void }) {
  const aberto = alvo !== null
  const q = useQuery({
    queryKey: empresasKeys.exClientesLista(alvo?.recorte ?? '', alvo?.motivos ?? []),
    queryFn: () => buscarExClientesLista(alvo!.recorte, alvo!.motivos),
    enabled: aberto,
  })

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle className="pr-6">{alvo?.titulo ?? ''}</DialogTitle>
          <DialogDescription>{alvo?.ajuda ?? ''}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {q.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (q.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum ex-cliente neste recorte.</p>
          ) : (
            <ul className="space-y-1">
              {(q.data ?? []).map((c) => {
                const nome = c.nome ?? formatCnpj(c.cnpj)
                const meta = [c.uf, dataBr(c.ex_cliente_desde), brl(c.ultimo_limite)]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li key={c.cnpj} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      {c.empresa_id ? (
                        <Link
                          href={`/empresas/${c.empresa_id}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {nome}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium">{nome}</span>
                      )}
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatCnpj(c.cnpj)}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{c.motivo}</span>
                      {/*
                       * O selo repete em texto o que o recorte já dizia — e continua
                       * necessário: nas listas por motivo (donut) e em "todos", a
                       * chance de retorno não está no título do diálogo.
                       */}
                      {c.retorno_possivel === false && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">sem retorno</span>
                      )}
                      {meta ? <span>· {meta}</span> : null}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ExClientesAnaliseCard() {
  const [alvo, setAlvo] = React.useState<Recorte | null>(null)
  const { data, isPending } = useQuery({
    queryKey: empresasKeys.exClientesAnalise(),
    queryFn: buscarExClientesAnalise,
  })

  if (isPending) return <Skeleton className="h-64 w-full" />
  if (!data || data.total === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum ex-cliente detectado ainda.
        </CardContent>
      </Card>
    )
  }

  const fatias = montarFatias(data.distribuicao)
  const semMotivo = data.indefinido

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Ex-clientes</CardTitle>
            </div>
            <CardDescription>
              Quem foi cliente e não tem mais análise de crédito vigente. Mesmo recorte da
              lista: sem filiais, sem SPEs e sem o que foi ocultado à mão.
            </CardDescription>
          </div>
          <Link
            href="/empresas?tab=clientes"
            className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver a lista <ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Indicador
            rotulo="Ex-clientes"
            valor={data.total}
            ajuda="Só clientes principais."
            onAbrir={() =>
              setAlvo({
                titulo: 'Ex-clientes',
                ajuda: 'Quem foi cliente e não tem mais análise vigente. Sem filiais, SPEs ou ocultos.',
                recorte: 'todos',
                motivos: [],
              })
            }
          />
          <Indicador
            rotulo="Com chance de retorno"
            valor={data.com_retorno}
            tom="bom"
            ajuda="Saíram por preço, limite, concorrente ou fricção — coisas que uma proposta nova resolve."
            onAbrir={() =>
              setAlvo({
                titulo: 'Com chance de retorno',
                ajuda: 'Saíram por motivo que uma proposta nova resolve.',
                recorte: 'com_retorno',
                motivos: [],
              })
            }
          />
          <Indicador
            rotulo="Sem chance"
            valor={data.sem_retorno}
            tom="ruim"
            ajuda="Default, encerramento de atividades ou crédito cancelado. Não é preço que traz de volta."
            onAbrir={() =>
              setAlvo({
                titulo: 'Sem chance de retorno',
                ajuda: 'Default, encerramento de atividades ou crédito cancelado.',
                recorte: 'sem_retorno',
                motivos: [],
              })
            }
          />
        </div>

        {/*
         * O aviso vem ANTES do gráfico quando quase ninguém foi classificado: um
         * donut de uma cor só, com 91% de "sem motivo registrado", parece um defeito
         * de dado quando na verdade é trabalho que ainda não foi feito.
         */}
        {semMotivo > 0 && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() =>
                setAlvo({
                  titulo: 'Ainda sem motivo classificado',
                  ajuda: 'Fora das duas contas acima até alguém dizer por que saíram.',
                  recorte: 'indefinido',
                  motivos: [],
                })
              }
              className="font-bold text-foreground underline-offset-2 hover:underline"
            >
              {semMotivo}
            </button>{' '}
            de {data.total} ainda sem motivo classificado — e por isso fora das duas contas
            acima. A classificação é feita na lista de ex-clientes ou na ficha da empresa, e é
            ela que transforma este quadro numa resposta.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-6">
          <Donut
            fatias={fatias}
            total={data.total}
            onAbrir={(f) =>
              setAlvo({
                titulo: f.motivo,
                ajuda: `${f.total} de ${data.total} ex-clientes saíram por este motivo.`,
                recorte: 'motivos',
                motivos: f.motivosOrigem,
              })
            }
          />

          {/*
           * A legenda carrega contagem e percentual porque no tema claro três dos
           * matizes ficam abaixo de 3:1 contra a superfície — cor sozinha não pode
           * ser o único canal. E o selo "sem retorno" repete em texto o que a cor
           * não diz: quais fatias são perda definitiva.
           */}
          <ul className="min-w-56 flex-1 space-y-1.5">
            {fatias.map((f) => (
              <li key={f.motivo}>
                {/*
                 * A legenda também abre. Ela é o alvo grande e rotulado do gráfico —
                 * uma fatia de 1% é um alvo de poucos pixels, e num donut é a legenda
                 * que se lê primeiro de qualquer forma.
                 */}
                <button
                  type="button"
                  onClick={() =>
                    setAlvo({
                      titulo: f.motivo,
                      ajuda: `${f.total} de ${data.total} ex-clientes saíram por este motivo.`,
                      recorte: 'motivos',
                      motivos: f.motivosOrigem,
                    })
                  }
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: f.cor }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate" title={f.motivo}>
                    {f.motivo}
                  </span>
                  {f.retornoPossivel === false && (
                    <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                      sem retorno
                    </span>
                  )}
                  <span className="shrink-0 tabular-nums">{f.total}</span>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {Math.round((f.total / data.total) * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <ListaDialog alvo={alvo} onOpenChange={(a) => !a && setAlvo(null)} />
    </Card>
  )
}
