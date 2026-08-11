'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Flame, Gauge, TrendingUp } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { buscarPotencialLimite, empresasKeys, type PotencialLimite } from './queries'

/**
 * Potencial de aumento de limite — onde concedemos pouco para o tamanho do cliente.
 *
 * A RÉGUA É O NOSSO PRÓPRIO COMPORTAMENTO, não uma política escrita: `ratio_limite`
 * é a MEDIANA de limite ÷ faturamento medida na carteira real (0073). Um cliente
 * muito abaixo dela não está fora de uma regra — está sendo tratado diferente de
 * como tratamos os comparáveis dele, e isso é uma pergunta que alguém consegue
 * responder.
 *
 * A FORMA É UM DUMBBELL, um par de pontos por empresa ligados pelo espaço entre
 * eles. É o desenho certo para "de X para Y por item": a barra É a oportunidade, e
 * ela ordena a lista sem precisar de uma coluna dizendo o mesmo número. Um gráfico
 * de dispersão mostraria a correlação melhor e a AÇÃO pior — aqui a pergunta não é
 * "existe correlação?", é "em quem eu mexo primeiro?".
 *
 * Duas séries, uma cor: concedido é sólido (é fato), potencial é vazado (é
 * estimativa). A distinção não é decorativa — misturar fato e estimativa no mesmo
 * peso visual é como um número calibrado vira uma promessa.
 */

const brl = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** Compacto para caber nos rótulos diretos do gráfico. */
function brlCurto(n: number | null | undefined): string {
  const v = Number(n)
  if (n == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1_000_000)
    return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

const pctRatio = (r: number | null | undefined) =>
  r == null || !Number.isFinite(Number(r))
    ? '—'
    : `${(Number(r) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/** Limite esgotado: o cliente parou de operar por causa do NOSSO teto, não da demanda. */
const ESGOTADO = 0.99

/**
 * Ancoragem do rótulo direto. Centralizar em 3% do eixo joga metade do texto para fora
 * do gráfico — e é exatamente onde os melhores casos caem, porque o que os torna bons é
 * o concedido ser pequeno. Nas bordas o rótulo passa a alinhar pela ponta.
 */
function ancorarRotulo(x: number): { style: React.CSSProperties; classe: string } {
  if (x < 10) return { style: { left: '0%' }, classe: 'translate-x-0' }
  if (x > 90) return { style: { right: '0%' }, classe: 'translate-x-0' }
  return { style: { left: `${x}%` }, classe: '-translate-x-1/2' }
}

/** Quantas linhas o gráfico mostra. O resto continua no rodapé, contado. */
const NO_GRAFICO = 12

/**
 * Confiança do limite potencial. Herdada do faturamento (0073): se o faturamento é
 * estimado, o potencial é o mesmo chute com outra unidade — e precisa dizer isso ao
 * lado do número, não num rodapé que ninguém lê.
 */
const CONFIANCA_ROTULO: Record<string, string> = {
  alta: 'confiança alta',
  media: 'confiança média',
  baixa: 'confiança baixa',
}

function Tile({
  icone: Icone,
  valor,
  rotulo,
  nota,
  tom,
}: {
  icone: typeof TrendingUp
  valor: string
  rotulo: string
  nota?: string
  tom?: 'alerta'
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icone className={cn('h-4 w-4', tom === 'alerta' && 'text-amber-600 dark:text-amber-400')} aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">{rotulo}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {nota ? <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p> : null}
    </div>
  )
}

export function PotencialLimite() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: empresasKeys.potencialLimite(),
    queryFn: buscarPotencialLimite,
  })

  const comEspaco = React.useMemo(
    () => (data?.empresas ?? []).filter((e) => Number(e.espaco ?? 0) > 0),
    [data],
  )

  if (isPending) return <Skeleton className="h-96 w-full" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Não foi possível carregar o potencial de limite.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const total = data.empresas.length
  const somaEspaco = comEspaco.reduce((s, e) => s + Number(e.espaco ?? 0), 0)
  const esgotados = comEspaco.filter((e) => Number(e.consumed_pct ?? 0) >= ESGOTADO).length
  const noTeto = comEspaco.filter(
    (e) => Number(e.limite_potencial ?? 0) >= Number(e.faturamento_anual ?? 0) * 0.149,
  ).length

  const mostradas = comEspaco.slice(0, NO_GRAFICO)
  // Eixo comum às duas séries: sem ele, "concedido" e "potencial" viveriam em escalas
  // diferentes e a barra entre eles não seria o espaço — seria um desenho.
  const escala = Math.max(...mostradas.map((e) => Number(e.limite_potencial ?? 0)), 1)
  const marcas = [0, 0.25, 0.5, 0.75, 1]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base">Potencial de aumento de limite</CardTitle>
        </div>
        <CardDescription>
          A régua é o <strong>nosso próprio comportamento</strong>: concedemos a mediana de{' '}
          <strong>{pctRatio(data.ratioMediano)}</strong> do faturamento anual
          {data.nDeclarantes > 0 ? ` (medido em ${data.nDeclarantes} clientes declarantes)` : null}. Quem
          está muito abaixo disso não fere uma regra — está sendo tratado diferente dos comparáveis
          dele, e vale entender por quê.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile
            icone={TrendingUp}
            valor={comEspaco.length.toLocaleString('pt-BR')}
            rotulo="Com espaço"
            nota={`de ${total.toLocaleString('pt-BR')} clientes comparáveis`}
          />
          <Tile icone={Gauge} valor={brl(somaEspaco)} rotulo="Espaço somado" nota="limite potencial − concedido" />
          <Tile
            icone={Flame}
            valor={esgotados.toLocaleString('pt-BR')}
            rotulo="Limite esgotado"
            nota="em 100% de consumo — travados pelo nosso teto"
            tom={esgotados > 0 ? 'alerta' : undefined}
          />
        </div>

        {comEspaco.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhum cliente com espaço de limite hoje. Isso só é conclusivo para quem tem faturamento
            e limite conhecidos — os demais não entram na comparação.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Legenda: são duas séries, então ela é obrigatória — e o formato do ponto
                repete a distinção, para que ela não dependa só da cor. */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                Concedido hoje
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full border-2 border-primary bg-background"
                  aria-hidden
                />
                Potencial estimado
              </span>
              <span className="ml-auto">Eixo até {brlCurto(escala)}</span>
            </div>

            <div className="space-y-1">
              {mostradas.map((e) => (
                <LinhaDumbbell key={e.cnpj ?? e.empresa_id} empresa={e} escala={escala} marcas={marcas} />
              ))}
            </div>

            {comEspaco.length > NO_GRAFICO ? (
              <p className="text-xs text-muted-foreground">
                Mostrando as {NO_GRAFICO} de maior espaço.{' '}
                {(comEspaco.length - NO_GRAFICO).toLocaleString('pt-BR')} outras têm espaço menor.
              </p>
            ) : null}
          </div>
        )}

        {/*
         * O teto do potencial precisa ser dito, senão o gráfico mente por omissão: quem
         * bate no cap de 15% do faturamento (ou no absoluto) aparece com espaço MENOR
         * que o real, e é justamente o topo da lista.
         */}
        {noTeto > 0 ? (
          <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-xs', STATUS_SUPERFICIE.info)}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {noTeto} empresa(s) batem no teto do limite potencial (15% do faturamento, com um
              absoluto por cima). Para elas o espaço mostrado é o mínimo, não o total — o número real
              é maior.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function LinhaDumbbell({
  empresa: e,
  escala,
  marcas,
}: {
  empresa: PotencialLimite
  escala: number
  marcas: readonly number[]
}) {
  const concedido = Number(e.limite_concedido ?? 0)
  const potencial = Number(e.limite_potencial ?? 0)
  const consumo = Number(e.consumed_pct ?? 0)
  const esgotado = consumo >= ESGOTADO

  const xConcedido = Math.min(100, (concedido / escala) * 100)
  const xPotencial = Math.min(100, (potencial / escala) * 100)
  const rotuloConcedido = ancorarRotulo(xConcedido)
  const rotuloPotencial = ancorarRotulo(xPotencial)

  const titulo = [
    e.nome ?? '—',
    `Concedido ${brl(concedido)}`,
    `Potencial ${brl(potencial)}`,
    `Espaço ${brl(e.espaco)}`,
    `Faturamento ${brl(e.faturamento_anual)} · concedemos ${pctRatio(e.ratio_concedido)} dele`,
    e.score_faixa ? `Score ${Number(e.score_credito ?? 0).toFixed(0)} (${e.score_faixa})` : 'Sem score',
  ].join(' · ')

  return (
    <div className="grid grid-cols-[minmax(0,16rem)_1fr] items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/50">
      <div className="min-w-0">
        {e.empresa_id ? (
          <Link href={`/empresas/${e.empresa_id}`} className="block truncate text-sm font-medium hover:underline">
            {e.nome ?? '—'}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium">{e.nome ?? '—'}</span>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{e.cnpj ? formatCnpj(e.cnpj) : '—'}</span>
          <span aria-hidden>·</span>
          {/* O ratio é o coração da tela: quanto do faturamento DELE nós concedemos. */}
          <span className="tabular-nums" title="Limite concedido dividido pelo faturamento anual.">
            {pctRatio(e.ratio_concedido)} do fat.
          </span>
          {e.score_faixa && e.score_faixa !== 'dados_insuficientes' ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">score {Number(e.score_credito ?? 0).toFixed(0)}</span>
            </>
          ) : null}
          {/* Status nunca é só cor: vem com ícone e palavra. */}
          {esgotado ? (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
              <Flame className="h-3 w-3" aria-hidden />
              limite esgotado
            </span>
          ) : null}
          {e.limite_confianca && e.limite_confianca !== 'alta' ? (
            <span title="A confiança do potencial é herdada do faturamento: uma multiplicação não cria informação.">
              {CONFIANCA_ROTULO[e.limite_confianca] ?? e.limite_confianca}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative h-9" title={titulo}>
        {/* Grade recessiva: referência, não desenho. */}
        <div className="absolute inset-0" aria-hidden>
          {marcas.map((m) => (
            <div
              key={m}
              className="absolute top-0 h-full border-l border-border/40"
              style={{ left: `${m * 100}%` }}
            />
          ))}
        </div>

        {/* A barra É a oportunidade: o espaço entre o que damos e o que caberia. */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/25"
          style={{ left: `${xConcedido}%`, width: `${Math.max(0, xPotencial - xConcedido)}%` }}
          aria-hidden
        />

        {/* Concedido: sólido, porque é fato. */}
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${xConcedido}%` }}
          aria-hidden
        />
        {/* Potencial: vazado, porque é estimativa. */}
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
          style={{ left: `${xPotencial}%` }}
          aria-hidden
        />

        {/*
         * Rótulos diretos nas duas pontas — seletivos, não um número em cada ponto. Em
         * linhas separadas (topo/base) porque quando o espaço é pequeno os dois pontos
         * quase se tocam, e dois números na mesma altura viram um borrão.
         */}
        <span
          className={cn(
            'absolute top-0 text-[10px] tabular-nums text-muted-foreground',
            rotuloConcedido.classe,
          )}
          style={rotuloConcedido.style}
        >
          {brlCurto(concedido)}
        </span>
        <span
          className={cn('absolute bottom-0 text-[10px] font-medium tabular-nums', rotuloPotencial.classe)}
          style={rotuloPotencial.style}
        >
          {brlCurto(potencial)}
        </span>

        <span className="sr-only">
          {e.nome}: concedido {brl(concedido)}, potencial estimado {brl(potencial)}, espaço{' '}
          {brl(e.espaco)}.
        </span>
      </div>
    </div>
  )
}
