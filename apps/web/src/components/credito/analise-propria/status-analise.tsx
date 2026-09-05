'use client'

import * as React from 'react'
import { Check, CircleDashed, Loader2, TriangleAlert } from 'lucide-react'
import {
  ESTAGIO_ANALISE_LABELS,
  type EstagioAnalise,
  type StatusAnalisePropria,
} from '@jobsiteos/core'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { brl } from './resultado'

/**
 * A banda de status: onde esta análise está AGORA, no tamanho de quem manda na tela.
 *
 * ─── POR QUE ELA É GRANDE ───────────────────────────────────────────────────
 * O estágio vinha num badge de 11px no canto direito, do mesmo tamanho de "da apólice" e
 * de qualquer outra tag. Mas ele não é uma qualificação da análise — ele é a resposta da
 * única pergunta que traz alguém a esta tela: "e aí, em que pé está?". Quando o dado mais
 * procurado tem o mesmo peso visual dos outros, a pessoa varre a tela inteira para achar
 * o que deveria ter visto de longe.
 *
 * ─── POR QUE ELA APARECE EM TODO ESTÁGIO ────────────────────────────────────
 * Inclusive quando não há nada acontecendo. Uma banda que só aparece em estados
 * "interessantes" ensina a pessoa a procurá-la, e a ausência dela vira ambiguidade: não
 * apareceu porque está tudo bem, ou porque a tela não carregou?
 *
 * ─── DUAS TRILHAS, UMA BANDA ────────────────────────────────────────────────
 * A esteira (o que a seguradora diz) e a análise proprietária (o que nós dizemos) correm
 * em paralelo — o 04j §6 dispara a nossa JUNTO do envio. São duas trilhas mesmo, e fingir
 * que são uma só produziria um passo a passo que mente em metade dos casos. Então: a
 * esteira manda no título, a nossa análise aparece como segunda linha com estado próprio,
 * e cada uma tem o seu passo a passo.
 */

// ─── A trilha da esteira ────────────────────────────────────────────────────

const PASSOS_ESTEIRA = ['Solicitada', 'Documentos', 'Enviada', 'Em análise', 'Decidida'] as const

/**
 * Dez estágios em cinco passos. `cancelada` não é passo: é um fim administrativo, e
 * desenhá-lo como "chegou ao fim da régua" leria como sucesso.
 *
 * Pendentes e recebidos dividem o passo "Documentos" — são o mesmo momento da esteira
 * visto de dois lados, e separá-los daria seis passos para contar a mesma história.
 */
function passoDaEsteira(estagio: EstagioAnalise): number {
  switch (estagio) {
    case 'rascunho':
    case 'solicitada':
      return 0
    case 'docs_pendentes':
    case 'docs_recebidos':
      return 1
    case 'enviada_seguradora':
      return 2
    case 'em_analise':
      return 3
    default:
      return 4
  }
}

type Tom = 'neutro' | 'andamento' | 'atencao' | 'bom' | 'ruim'

const TOM_TEXTO: Record<Tom, string> = {
  neutro: 'text-muted-foreground',
  andamento: 'text-sky-700 dark:text-sky-400',
  atencao: 'text-amber-700 dark:text-amber-500',
  bom: 'text-emerald-700 dark:text-emerald-500',
  ruim: 'text-red-700 dark:text-red-500',
}

const TOM_PONTO: Record<Tom, string> = {
  neutro: 'bg-muted-foreground/50',
  andamento: 'bg-sky-500',
  atencao: 'bg-amber-500',
  bom: 'bg-emerald-500',
  ruim: 'bg-red-500',
}

const TOM_BORDA: Record<Tom, string> = {
  neutro: 'border-border',
  andamento: 'border-sky-500/40 bg-sky-500/[0.04]',
  atencao: 'border-amber-500/50 bg-amber-500/[0.05]',
  bom: 'border-emerald-500/40 bg-emerald-500/[0.04]',
  ruim: 'border-red-500/50 bg-red-500/[0.05]',
}

/** O tom e a frase de cada estágio da esteira: o que ele significa e o que se espera. */
function leituraDaEsteira(estagio: EstagioAnalise): { tom: Tom; frase: string } {
  switch (estagio) {
    case 'rascunho':
      return { tom: 'neutro', frase: 'Ainda não foi solicitada. Nada foi pedido à seguradora.' }
    case 'solicitada':
      return { tom: 'andamento', frase: 'Na fila para envio. O envio à seguradora é um clique humano — e pode ser cobrado.' }
    case 'docs_pendentes':
      return { tom: 'atencao', frase: 'Faltam documentos. A seguradora costuma pedir por eles antes de decidir.' }
    case 'docs_recebidos':
      return { tom: 'andamento', frase: 'A pasta está completa. Daqui sai o envio à seguradora — e é no envio que se escolhe quais documentos vão junto.' }
    case 'enviada_seguradora':
      return { tom: 'andamento', frase: 'Pedido aberto na seguradora. O worker consulta a decisão de tempos em tempos.' }
    case 'em_analise':
      return { tom: 'andamento', frase: 'A seguradora está analisando. A tela se atualiza sozinha quando ela responder.' }
    case 'aprovada':
      return { tom: 'bom', frase: 'Aprovada — pela seguradora, ou pela nossa decisão quando ela não passou por lá. O que vale para operar é o limite operacional.' }
    case 'aprovada_parcial':
      return { tom: 'bom', frase: 'Aprovada por menos do que foi pedido.' }
    case 'negada':
      return { tom: 'ruim', frase: 'Negada. Operar assim mesmo é decisão nossa, e exige motivo escrito.' }
    case 'cancelada':
      return { tom: 'neutro', frase: 'Cancelada. Fim de linha administrativo, não uma decisão de risco.' }
  }
}

// ─── A trilha da análise proprietária ───────────────────────────────────────

const PASSOS_PROPRIA = ['Protestos', 'Extração', 'Revisão', 'Cálculo', 'Parecer', 'Decisão'] as const

interface EstadoPropria {
  tom: Tom
  rotulo: string
  frase: string
  /** Índice do passo ATUAL. -1 = a trilha nem começou. */
  passo: number
  /** Verdadeiro enquanto o worker trabalha: acende o spinner. */
  trabalhando: boolean
}

function leituraDaPropria(
  status: StatusAnalisePropria | null,
  etapa: string | null,
  erro: string | null,
  recomendacao: string | null,
  decidida: boolean,
): EstadoPropria {
  if (status === null) {
    return {
      tom: 'neutro',
      rotulo: 'Não rodada',
      frase: 'Nossa análise dos documentos contábeis ainda não foi feita para esta esteira.',
      passo: -1,
      trabalhando: false,
    }
  }
  // A etapa gravada é o passo em que a corrida ESTÁ; o índice segue a ordem de
  // PASSOS_PROPRIA. Um mapa explícito, e não aritmética sobre a lista: acrescentar um
  // passo no meio — foi o que aconteceu com "Protestos" — não pode deslocar os outros em
  // silêncio.
  const PASSO_DA_ETAPA: Record<string, number> = { protestos: 0, extracao: 1, revisao: 2, calculo: 3 }

  if (status === 'falhou') {
    return {
      tom: 'ruim',
      rotulo: 'Falhou',
      frase: erro ?? 'A análise parou com erro.',
      passo: PASSO_DA_ETAPA[etapa ?? ''] ?? 1,
      trabalhando: false,
    }
  }
  if (status === 'processando') {
    const noCalculo = etapa === 'calculo'
    const nosProtestos = etapa === 'protestos'
    return {
      tom: 'andamento',
      rotulo: nosProtestos
        ? 'Consultando protestos'
        : noCalculo
          ? 'Calculando e escrevendo o parecer'
          : 'Lendo os documentos',
      frase: nosProtestos
        ? 'A consulta roda antes da leitura dos documentos, e o score é recalculado em seguida — é por ele que o protesto chega ao limite.'
        : noCalculo
          ? 'Os números já foram conferidos. O cálculo é determinístico e o parecer vem logo depois.'
          : 'A extração roda no worker e leva alguns minutos. A tela se atualiza sozinha.',
      passo: PASSO_DA_ETAPA[etapa ?? ''] ?? 1,
      trabalhando: true,
    }
  }
  if (status === 'aguardando_revisao') {
    return {
      tom: 'atencao',
      rotulo: 'Aguardando sua revisão',
      frase: 'Nada foi calculado ainda: os campos críticos precisam ser confirmados contra o trecho de origem.',
      passo: 2,
      trabalhando: false,
    }
  }
  // concluída
  if (decidida) {
    return {
      tom: recomendacao === 'operar' ? 'bom' : 'ruim',
      rotulo: 'Decisão registrada',
      frase: 'A análise está fechada e o limite operacional foi aplicado na esteira.',
      passo: 5,
      trabalhando: false,
    }
  }
  return {
    tom: recomendacao === 'operar' ? 'bom' : 'ruim',
    rotulo: recomendacao === 'operar' ? 'Concluída — OPERAR' : 'Concluída — NÃO OPERAR',
    frase: 'O cálculo está pronto e o parecer, escrito. Falta a decisão humana.',
    passo: 4,
    trabalhando: false,
  }
}

// ─── O passo a passo ────────────────────────────────────────────────────────

/**
 * Passos como texto com marcador, não como barra de progresso.
 *
 * Uma barra sugere que os passos têm a mesma duração e que o progresso é contínuo, e nem
 * uma coisa nem outra é verdade aqui: a extração leva minutos, a seguradora leva dias, e
 * a revisão leva o tempo de alguém abrir a tela. O que a pessoa precisa saber é em QUAL
 * passo está, não que fração do caminho andou.
 */
function Passos({
  passos,
  atual,
  tom,
  concluido,
}: {
  passos: readonly string[]
  /** -1 = nenhum passo alcançado ainda. */
  atual: number
  tom: Tom
  /** Verdadeiro quando o passo atual é o FIM (nada mais vem depois). */
  concluido?: boolean
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
      {passos.map((p, i) => {
        const passou = i < atual || (concluido && i <= atual)
        const eAtual = i === atual
        return (
          <li key={p} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="mr-1 text-muted-foreground/40">›</span>}
            <span
              aria-hidden
              className={cn(
                'inline-flex size-3.5 items-center justify-center rounded-full',
                passou ? TOM_PONTO[tom] : eAtual ? TOM_PONTO[tom] : 'bg-muted',
                !passou && !eAtual && 'ring-1 ring-inset ring-border',
              )}
            >
              {passou ? <Check className="size-2.5 text-white" /> : null}
            </span>
            <span
              className={cn(
                eAtual ? cn('font-medium', TOM_TEXTO[tom]) : 'text-muted-foreground',
                !passou && !eAtual && 'text-muted-foreground/60',
              )}
            >
              {p}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ─── A banda ────────────────────────────────────────────────────────────────

export function StatusAnalise({
  estagio,
  statusPropria,
  etapa,
  erro,
  recomendacao,
  limiteRecomendado,
  limiteAprovado,
  limiteOperacional,
  decisaoFinal,
  acao,
}: {
  estagio: EstagioAnalise
  statusPropria: StatusAnalisePropria | null
  etapa: string | null
  erro: string | null
  recomendacao: string | null
  limiteRecomendado: number | null
  limiteAprovado: number | null
  limiteOperacional: number | null
  decisaoFinal: string | null
  /** O botão que move a análise adiante. Vive aqui, ao lado do estado que ele muda. */
  acao?: React.ReactNode
}) {
  const esteira = leituraDaEsteira(estagio)
  const propria = leituraDaPropria(statusPropria, etapa, erro, recomendacao, decisaoFinal !== null)
  /*
   * Só a DECISÃO fecha a régua. `cancelada` para no último passo sem os vistos: uma
   * fila de cinco marcas verdes lê como "chegou ao fim", e ela não chegou — foi
   * arquivada no caminho.
   */
  const fim = ['aprovada', 'aprovada_parcial', 'negada'].includes(estagio)

  /**
   * Os números que aparecem: só os que EXISTEM.
   *
   * Uma tira fixa com três células e dois traços ensina que a tela está incompleta. Aqui
   * a ausência de um número é a ausência da célula — e o que sobra é o que já se sabe.
   */
  const numeros = [
    limiteOperacional !== null && {
      label: 'Nosso limite operacional',
      valor: brl(limiteOperacional),
      forte: true,
    },
    limiteAprovado !== null && { label: 'Aprovado pela seguradora', valor: brl(limiteAprovado) },
    limiteRecomendado !== null &&
      limiteOperacional === null && {
        label: 'Recomendado pela nossa análise',
        valor: brl(limiteRecomendado),
        forte: true,
      },
  ].filter(Boolean) as Array<{ label: string; valor: string; forte?: boolean }>

  return (
    <Card className={cn('border', TOM_BORDA[esteira.tom])}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn('inline-block size-2.5 shrink-0 rounded-full', TOM_PONTO[esteira.tom])}
              />
              <p className={cn('text-2xl font-semibold leading-none tracking-tight', TOM_TEXTO[esteira.tom])}>
                {ESTAGIO_ANALISE_LABELS[estagio]}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{esteira.frase}</p>
          </div>

          {numeros.length > 0 && (
            <dl className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-2">
              {numeros.map((n) => (
                <div key={n.label} className="text-right">
                  <dd className={cn('tabular-nums', n.forte ? 'text-xl font-semibold' : 'text-base font-medium')}>
                    {n.valor}
                  </dd>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{n.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>

        <Passos passos={PASSOS_ESTEIRA} atual={passoDaEsteira(estagio)} tom={esteira.tom} concluido={fim} />

        {/*
         * A nossa análise, separada por uma linha: é a outra trilha, e misturá-la com a
         * da seguradora faria parecer que uma depende da outra. Elas correm em paralelo.
         */}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-t pt-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Nossa análise
              </span>
              {propria.trabalhando ? (
                <Loader2 className={cn('size-3.5 animate-spin', TOM_TEXTO[propria.tom])} aria-hidden />
              ) : propria.tom === 'ruim' && statusPropria === 'falhou' ? (
                <TriangleAlert className={cn('size-3.5', TOM_TEXTO[propria.tom])} aria-hidden />
              ) : propria.passo < 0 ? (
                <CircleDashed className="size-3.5 text-muted-foreground" aria-hidden />
              ) : null}
              <span className={cn('text-sm font-medium', TOM_TEXTO[propria.tom])}>
                {propria.rotulo}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{propria.frase}</p>
            {propria.passo >= 0 && (
              <div className="pt-1">
                <Passos
                  passos={PASSOS_PROPRIA}
                  atual={propria.passo}
                  tom={propria.tom}
                  concluido={propria.passo === 5}
                />
              </div>
            )}
          </div>

          {acao ? <div className="flex shrink-0 flex-wrap gap-2">{acao}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}
