'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarExClientesAnalise, empresasKeys, type ExClientesAnalise } from './queries'

/**
 * Ex-clientes na aba Análise: quantos são, quantos dá para reconquistar, e por quê
 * saíram.
 *
 * Só os NÃO OCULTOS entram. O que alguém escondeu da lista não pode voltar pela
 * porta dos indicadores — um número que contradiz a tela ao lado destrói a
 * confiança nos dois.
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
  }))

  if (resto.length > 0) {
    fatias.push({
      motivo: `Outros (${resto.length} motivos)`,
      total: resto.reduce((s, d) => s + d.total, 0),
      retornoPossivel: null,
      cor: CORES[Math.min(principais.length, CORES.length - 1)]!,
    })
  }

  const totalSemResposta = semResposta.reduce((s, d) => s + d.total, 0)
  if (totalSemResposta > 0) {
    fatias.push({ motivo: 'Sem motivo registrado', total: totalSemResposta, retornoPossivel: null, cor: CINZA })
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

function Donut({ fatias, total }: { fatias: Fatia[]; total: number }) {
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
          <path key={f.motivo} d={arco(inicio, fim, 46, 30)} fill={f.cor}>
            <title>{`${f.motivo}: ${f.total} (${Math.round((f.total / total) * 100)}%)`}</title>
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

function Indicador({
  rotulo,
  valor,
  ajuda,
  tom,
}: {
  rotulo: string
  valor: number
  ajuda: string
  tom?: 'bom' | 'ruim'
}) {
  const cor = tom === 'bom' ? 'text-emerald-700 dark:text-emerald-300' : tom === 'ruim' ? 'text-destructive' : ''
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>
    </div>
  )
}

export function ExClientesAnaliseCard() {
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
              Quem foi cliente e não tem mais análise de crédito vigente. Não conta os que
              foram ocultados da lista.
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
          <Indicador rotulo="Ex-clientes" valor={data.total} ajuda="Fora os ocultos." />
          <Indicador
            rotulo="Com chance de retorno"
            valor={data.com_retorno}
            tom="bom"
            ajuda="Saíram por preço, limite, concorrente ou fricção — coisas que uma proposta nova resolve."
          />
          <Indicador
            rotulo="Sem chance"
            valor={data.sem_retorno}
            tom="ruim"
            ajuda="Default, encerramento de atividades ou crédito cancelado. Não é preço que traz de volta."
          />
        </div>

        {/*
         * O aviso vem ANTES do gráfico quando quase ninguém foi classificado: um
         * donut de uma cor só, com 91% de "sem motivo registrado", parece um defeito
         * de dado quando na verdade é trabalho que ainda não foi feito.
         */}
        {semMotivo > 0 && (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <strong className="text-foreground">{semMotivo}</strong> de {data.total} ainda sem
            motivo classificado — e por isso fora das duas contas acima. A classificação é feita
            na lista de ex-clientes ou na ficha da empresa, e é ela que transforma este quadro
            numa resposta.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-6">
          <Donut fatias={fatias} total={data.total} />

          {/*
           * A legenda carrega contagem e percentual porque no tema claro três dos
           * matizes ficam abaixo de 3:1 contra a superfície — cor sozinha não pode
           * ser o único canal. E o selo "sem retorno" repete em texto o que a cor
           * não diz: quais fatias são perda definitiva.
           */}
          <ul className="min-w-56 flex-1 space-y-1.5">
            {fatias.map((f) => (
              <li key={f.motivo} className="flex items-center gap-2 text-sm">
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
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
