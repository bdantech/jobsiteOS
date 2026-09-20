'use client'

import * as React from 'react'
import { FAIXA_SCORE_LABELS, type FaixaScore } from '@jobsiteos/core'
import { cn } from '@/lib/utils'

/**
 * O card de funil — um desenho só para Reuniões, Vendas e Certificados.
 *
 * ── POR QUE UM SHELL, E NÃO TRÊS CARDS ──────────────────────────────────────
 * Os três funis mostravam a mesma coisa de três jeitos: título em peso diferente,
 * badge em tamanho diferente, score ora em barra ora em número solto. Quem trabalha
 * nos três no mesmo dia relê o layout a cada troca de tela, e a releitura é o custo.
 *
 * O CONTEÚDO continua de cada funil — este arquivo não sabe o que é uma venda nem
 * o que é um certificado. Ele define a caixa, a hierarquia e a régua tipográfica;
 * cada funil enche os espaços.
 *
 * ── A HIERARQUIA É DELIBERADA ───────────────────────────────────────────────
 * Quem varre uma coluna faz uma pergunta por vez, nesta ordem:
 *   1. de quem é isto?      → título, o maior elemento
 *   2. quanto vale?         → o valor, logo abaixo e menor
 *   3. vale meu tempo?      → o score, isolado à direita num bloco com cor
 *   4. o que é isso?        → os chips, que só se leem quando os três acima passam
 * A barra embaixo repete o score em forma, não em número: a cor sozinha não pode
 * carregar o veredito, e o número sozinho não se compara entre dois cards de relance.
 */

// ─── A paleta ───────────────────────────────────────────────────────────────
//
// Semânticas do tema, e não os hexes do mock: o produto tem modo escuro e um
// `#E6F4EC` fixo vira um retângulo branco brilhante no escuro. A GEOMETRIA é a do
// mock; a paleta é a da casa.
//
// O tom é NOMEADO pelo que significa (bom/alerta/ruim), e não pela faixa que o
// produziu, porque as faixas de dois módulos colidem: `alta` é verde no score de
// crédito e âmbar na faixa da NF, e `media` é âmbar num e azul no outro. Mapear
// cor a partir da chave daria ao card da NF as cores do card de venda sem que
// nenhuma das duas telas estivesse errada.

export type TomDoScore = 'bom' | 'alerta' | 'ruim' | 'info' | 'neutro'

const TOM_BLOCO: Record<TomDoScore, string> = {
  bom: 'bg-emerald-100 dark:bg-emerald-500/15',
  alerta: 'bg-amber-100 dark:bg-amber-500/15',
  ruim: 'bg-red-100 dark:bg-red-500/15',
  info: 'bg-sky-100 dark:bg-sky-500/15',
  neutro: 'bg-muted',
}

const TOM_ROTULO: Record<TomDoScore, string> = {
  bom: 'text-emerald-800 dark:text-emerald-300',
  alerta: 'text-amber-800 dark:text-amber-300',
  ruim: 'text-red-800 dark:text-red-300',
  info: 'text-sky-800 dark:text-sky-300',
  neutro: 'text-muted-foreground',
}

const TOM_BARRA: Record<TomDoScore, string> = {
  bom: 'bg-emerald-500',
  alerta: 'bg-amber-500',
  ruim: 'bg-destructive',
  info: 'bg-sky-500',
  neutro: 'bg-muted-foreground/25',
}

/** As faixas do score de crédito, quando o card não diz o tom. */
const TOM_DA_FAIXA: Record<string, TomDoScore> = {
  alta: 'bom',
  media: 'alerta',
  improvavel: 'ruim',
  dados_insuficientes: 'neutro',
}

/**
 * O bloco de score, à direita do título.
 *
 * Largura fixa: os blocos de cards vizinhos têm de alinhar na vertical para a
 * coluna ser comparável de relance. Com largura de conteúdo, "87" e "—" desenham
 * caixas diferentes e o olho perde a régua.
 */
export function ScoreDoCard({
  score,
  faixa,
  texto,
  tom: tomProprio,
  rotulo: rotuloProprio,
  sufixo,
}: {
  score: number | null
  faixa: string
  /**
   * A PALAVRA no lugar do número, para a medida que não é 0–100. A faixa de uma
   * NF é "Alta/Boa/Média" e não tem número por trás; escrever um 2 de 3 ali
   * inventaria uma precisão que a classificação não tem.
   */
  texto?: string
  tom?: TomDoScore
  /**
   * O rótulo sob o número. Por padrão é a faixa do score de crédito; os
   * Certificados passam o deles, porque ali o número é cobertura e chamá-lo de
   * "Alta" emprestaria o vocabulário de outra medida.
   */
  rotulo?: string
  sufixo?: string
}) {
  const rotulo = rotuloProprio ?? FAIXA_SCORE_LABELS[faixa as FaixaScore] ?? faixa
  const tom = tomProprio ?? TOM_DA_FAIXA[faixa] ?? 'neutro'
  const vazio = texto === undefined && score === null
  return (
    <div
      className={cn(
        'flex w-[54px] shrink-0 flex-col items-center gap-[3px] rounded-lg py-[7px]',
        TOM_BLOCO[tom],
      )}
      role="img"
      aria-label={
        texto !== undefined
          ? `${rotulo}: ${texto}`
          : `Score ${score === null ? 'indisponível' : `${Math.round(score)} de 100`}, faixa ${rotulo}`
      }
    >
      <span
        className={cn(
          'font-extrabold leading-none tracking-[-0.03em] tabular-nums text-foreground',
          // A palavra é mais larga que o número e tem de caber nos 54px sem quebrar.
          texto !== undefined ? 'text-[13px]' : 'text-[18px]',
        )}
      >
        {texto ?? (score === null ? '—' : Math.round(score))}
        {texto === undefined && score !== null && sufixo ? (
          <span className="text-[11px] font-bold">{sufixo}</span>
        ) : null}
      </span>
      <span className={cn('text-[9.5px] font-semibold leading-none', TOM_ROTULO[tom])}>
        {vazio ? 'sem dados' : rotulo}
      </span>
    </div>
  )
}

export type TomDoChip = 'neutro' | 'info' | 'alerta' | 'ruim' | 'destaque'

const CHIP_TOM: Record<TomDoChip, string> = {
  neutro: 'bg-muted text-muted-foreground',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  alerta: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  ruim: 'bg-destructive/10 text-destructive',
  destaque: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
}

/**
 * Um chip. Altura fixa de 22px para que uma linha com quatro deles não fique
 * serrilhada — chips de alturas diferentes é o detalhe que faz um card parecer
 * remendado sem que ninguém saiba dizer por quê.
 */
export function ChipDoCard({
  tom = 'neutro',
  forte = false,
  className,
  children,
}: {
  tom?: TomDoChip
  /** UF e origem vêm em peso maior: são etiqueta, não descrição. */
  forte?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-md px-[9px] text-[11px] leading-none',
        forte ? 'font-semibold' : 'font-medium',
        CHIP_TOM[tom],
        className,
      )}
    >
      {children}
    </span>
  )
}

export type TomDaTira = 'bom' | 'alerta' | 'ruim' | 'neutro'

const TIRA_TOM: Record<TomDaTira, { caixa: string; ponto: string }> = {
  bom: {
    caixa: 'border-emerald-600/25 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300',
    ponto: 'bg-emerald-500',
  },
  alerta: {
    caixa: 'border-amber-600/25 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
    ponto: 'bg-amber-500',
  },
  ruim: {
    caixa: 'border-destructive/25 bg-destructive/5 text-destructive',
    ponto: 'bg-destructive',
  },
  neutro: { caixa: 'border-border bg-muted/40 text-muted-foreground', ponto: 'bg-muted-foreground/50' },
}

/**
 * A tira do rodapé: UM fato que muda a decisão — limite aprovado, crédito negado,
 * certificado da matriz em dia.
 *
 * Fica FORA do corpo e abaixo do rodapé de propósito. É o último elemento lido, e
 * é o que faz o olho voltar para o card depois de já ter passado por ele.
 */
export function TiraDoCard({
  tom,
  children,
}: {
  tom: TomDaTira
  children: React.ReactNode
}) {
  const t = TIRA_TOM[tom]
  return (
    <div
      className={cn(
        'flex items-start gap-[7px] border-t px-4 py-2 text-[11.5px] font-semibold leading-snug',
        t.caixa,
      )}
    >
      <span className={cn('mt-[5px] size-[5px] shrink-0 rounded-full', t.ponto)} aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** As iniciais do dono, para o disco do rodapé. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '—'
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase()
  return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase()
}

export function DonoNoRodape({ nome }: { nome: string | null }) {
  if (!nome) return <span className="text-[11.5px] text-muted-foreground">Sem dono</span>
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span
        className="inline-flex size-[19px] shrink-0 items-center justify-center rounded-full bg-primary text-[8.5px] font-bold text-primary-foreground"
        aria-hidden
      >
        {iniciais(nome)}
      </span>
      <span className="truncate">{nome}</span>
    </span>
  )
}

export interface CardDoFunilProps {
  /** O que o leitor de tela anuncia no botão que cobre o card. */
  rotuloAbrir: string
  onAbrir: () => void
  titulo: React.ReactNode
  /** Logo abaixo do título, menor. O faturamento, o valor, o que der a escala. */
  valor?: React.ReactNode
  score?: {
    valor: number | null
    faixa: string
    texto?: string
    tom?: TomDoScore
    rotulo?: string
    sufixo?: string
  } | null
  /**
   * A barra, quando ela NÃO é o eco do score.
   *
   * O padrão é o score virar barra — a cor sozinha não carrega o veredito, e o
   * número sozinho não se compara entre dois cards de relance. Mas a faixa de uma
   * NF é categórica (Alta/Boa/Média) e uma barra de três degraus não diz nada,
   * enquanto o PRAZO da nota é a medida que escorre e decide se ainda dá para
   * operar. Quem tem uma medida melhor para a barra passa aqui a dela.
   */
  barra?: { pct: number; tom: TomDoScore } | null
  chips?: React.ReactNode
  /** Entre os chips e a barra. Conteúdo que só um dos funis tem. */
  children?: React.ReactNode
  rodapeEsquerda?: React.ReactNode
  rodapeDireita?: React.ReactNode
  tira?: React.ReactNode
  /** Apagado, para o que saiu do jogo (venda já operando, lead encerrado). */
  esmaecido?: boolean
  className?: string
}

export function CardDoFunil({
  rotuloAbrir,
  onAbrir,
  titulo,
  valor,
  score,
  barra,
  chips,
  children,
  rodapeEsquerda,
  rodapeDireita,
  tira,
  esmaecido,
  className,
}: CardDoFunilProps) {
  const barraFinal =
    barra ??
    (score
      ? {
          pct: score.valor == null ? 0 : Math.max(0, Math.min(100, score.valor)),
          tom: score.tom ?? TOM_DA_FAIXA[score.faixa] ?? 'neutro',
        }
      : null)

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[10px] border bg-card shadow-[0_1px_2px_rgba(5,14,64,0.05)]',
        'transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[0_4px_12px_rgba(5,14,64,0.08)]',
        'focus-within:ring-1 focus-within:ring-ring',
        esmaecido && 'opacity-70',
        className,
      )}
    >
      {/*
        O card INTEIRO abre, e a área clicável é um <button> de verdade esticado
        sobre ele — não um onClick no <div>. A diferença aparece em tudo que não é
        mouse: o botão entra na ordem de tabulação, responde a Enter e Espaço, e é
        anunciado por nome em vez de silêncio.

        `z-0` e não um z alto: o que for interativo dentro do card (trocar dono,
        abrir a empresa) sobe com `z-10` e continua clicável por cima dele.
      */}
      <button
        type="button"
        aria-label={rotuloAbrir}
        onClick={onAbrir}
        className="absolute inset-0 z-0 focus:outline-none"
      />

      <div className="flex flex-col gap-[11px] p-[14px]">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
            {/*
              `text-pretty`: o título quebra em duas linhas na maioria das razões
              sociais, e o padrão deixa uma palavra órfã na segunda. `line-clamp-2`
              porque a terceira linha empurraria o score para fora do alinhamento
              da coluna.
            */}
            <h3 className="line-clamp-2 text-pretty text-[13.5px] font-bold leading-[1.35] tracking-[-0.005em] text-foreground">
              {titulo}
            </h3>
            {valor ? (
              <span className="text-[12.5px] font-semibold tabular-nums text-foreground">{valor}</span>
            ) : null}
          </div>
          {score !== undefined && score !== null ? (
            <ScoreDoCard
              score={score.valor}
              faixa={score.faixa}
              texto={score.texto}
              tom={score.tom}
              rotulo={score.rotulo}
              sufixo={score.sufixo}
            />
          ) : null}
        </div>

        {chips ? <div className="flex flex-wrap gap-[5px]">{chips}</div> : null}
        {children}
      </div>

      {/*
        A barra do score, largura total e sem cantos: ela é a base do corpo, não um
        elemento dentro dele. Some quando não há score — uma barra vazia diz "zero",
        e "não sei" não é zero.
      */}
      {barraFinal ? (
        <div className="h-1 w-full bg-muted" aria-hidden>
          <div
            className={cn('h-full', TOM_BARRA[barraFinal.tom])}
            style={{ width: `${Math.max(0, Math.min(100, barraFinal.pct))}%` }}
          />
        </div>
      ) : null}

      {rodapeEsquerda || rodapeDireita ? (
        <div className="flex items-center justify-between gap-2.5 border-t bg-muted/30 px-[14px] py-[9px]">
          <span className="min-w-0">{rodapeEsquerda}</span>
          {rodapeDireita ? (
            <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-muted-foreground">
              {rodapeDireita}
            </span>
          ) : null}
        </div>
      ) : null}

      {tira}
    </div>
  )
}

/**
 * O cabeçalho de uma coluna do Kanban e a contagem.
 *
 * O número vem num disco, e não solto ao lado do nome: numa fileira de sete colunas
 * o olho procura a contagem primeiro, e um número solto se confunde com o nome da
 * coluna vizinha.
 */
export function CabecalhoDaColuna({
  titulo,
  total,
}: {
  titulo: React.ReactNode
  /** ReactNode, e não number, porque a contagem chega como "…" enquanto carrega. */
  total: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b-2 px-0.5 pb-2.5">
      <span className="truncate text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {titulo}
      </span>
      <span className="inline-flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">
        {total}
      </span>
    </div>
  )
}

export function ColunaVazia({ children = 'Nenhum card' }: { children?: React.ReactNode }) {
  return (
    <p className="rounded-[10px] border border-dashed bg-muted/30 p-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  )
}
