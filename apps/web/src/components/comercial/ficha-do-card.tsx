'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FAIXA_SCORE_LABELS, type FaixaScore } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { buscarSubmissoesDaEmpresa, comercialKeys, type VendaComEmpresa } from './queries'

/**
 * A ficha da empresa DENTRO do card do funil.
 *
 * Quem varre uma coluna de negócios decide em qual mexer antes de abrir qualquer um — e
 * até aqui decidia pelo nome e pela UF. As quatro coisas que mudam essa decisão são o
 * score (chance de passar no crédito), o tamanho (faturamento), o QUE a empresa é
 * (construtora paga fornecedor; fornecedor cede recebível — são conversas opostas) e como
 * ela chegou (quem veio sozinho já quer alguma coisa).
 *
 * Elas estavam todas a dois cliques, na aba Empresa de cada card.
 */

const FAIXA_CLASSE: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  improvavel: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
  dados_insuficientes: 'bg-muted text-muted-foreground',
}

const FAIXA_BARRA: Record<string, string> = {
  alta: 'bg-emerald-500',
  media: 'bg-amber-500',
  improvavel: 'bg-destructive',
  dados_insuficientes: 'bg-muted-foreground/40',
}

const TIPO_LABEL: Record<string, string> = {
  construtora: 'Construtora',
  incorporadora: 'Incorporadora',
  fornecedor: 'Fornecedor',
  subempreiteiro: 'Subempreiteiro',
}

function brlCurto(v: number | null | undefined): string {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `R$ ${(n / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (n >= 1000) return `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/**
 * Inbound é quem chegou sozinho. O sinal forte é a origem do LEAD; a origem da empresa
 * entra como segunda leitura, porque um negócio criado à mão sobre uma empresa que veio
 * do formulário continua sendo um negócio que começou com a pessoa nos procurando.
 */
export function ehInbound(v: Pick<VendaComEmpresa, 'empresas' | 'sdr_leads'>): boolean {
  return v.sdr_leads?.origem === 'inbound' || v.empresas?.origem === 'formulario'
}

/** Os campos que a tira lê. Tanto `vendas.empresas` quanto `sdr_leads.empresas` os têm. */
export interface EmpresaDaFicha {
  tipo: string | null
  faturamento_anual: number | null
  faturamento_origem: string | null
  score_credito: number | null
  score_faixa: string | null
}

export interface FichaDoCardProps {
  empresa: EmpresaDaFicha | null
  /**
   * O badge Inbound/Outbound. Ligado no Funil de Vendas, DESLIGADO no de Reuniões.
   *
   * Não é preferência: no card de reuniões já existe a <TagOrigem>, que diz a mesma
   * coisa com mais precisão — ela distingue as TRÊS origens do lead (Outbound,
   * Formulário, Manual), enquanto este badge colapsa tudo em dois. Mostrar os dois
   * juntos seria repetir a informação, e repetir pela versão mais pobre.
   */
  origem?: 'inbound' | 'outbound' | null
}

/**
 * A tira compacta do card: barra e número do score, faturamento, o que a empresa é, e de
 * onde ela veio. Uma linha e meia — o card do funil não comporta mais que isso, e o
 * detalhe continua nas abas.
 *
 * Recebe a EMPRESA, e não a venda: o Funil de Reuniões usa a mesma tira, e lá o que
 * existe é um `sdr_leads`. Amarrá-la a `VendaComEmpresa` obrigaria a inventar uma venda
 * falsa para desenhar o card de um lead.
 */
export function FichaDoCard({ empresa: e, origem }: FichaDoCardProps) {
  if (!e) return null

  const faixa = e.score_faixa ?? 'dados_insuficientes'
  const score = e.score_credito === null ? null : Number(e.score_credito)
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score))
  const declarado = e.faturamento_origem === 'declarado_cliente'
  const inbound = origem === 'inbound'

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums leading-none">
          {score === null ? '—' : Math.round(score)}
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Score de crédito ${score === null ? 'indisponível' : Math.round(score)} de 100, faixa ${
            FAIXA_SCORE_LABELS[faixa as FaixaScore] ?? faixa
          }`}
        >
          <div className={cn('h-full rounded-full', FAIXA_BARRA[faixa])} style={{ width: `${pct}%` }} />
        </div>
        {/* O rótulo da faixa ao lado da barra: a cor sozinha não pode carregar o veredito. */}
        <Badge className={cn('shrink-0 px-1.5 py-0 text-[10px] font-normal', FAIXA_CLASSE[faixa])}>
          {FAIXA_SCORE_LABELS[faixa as FaixaScore] ?? faixa}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span
          className="tabular-nums"
          title={declarado ? 'Faturamento declarado pelo cliente' : 'Faturamento estimado pelo modelo'}
        >
          {brlCurto(e.faturamento_anual)}
          {/* Declarado e estimado não valem o mesmo, e a tela não pode fingir que sim. */}
          <span className="ml-1 opacity-70">{declarado ? 'declarado' : 'est.'}</span>
        </span>
        {e.tipo ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            {TIPO_LABEL[e.tipo] ?? e.tipo}
          </Badge>
        ) : null}
        {origem ? (
          <Badge
            variant="outline"
            className={cn(
              'px-1.5 py-0 text-[10px] font-normal',
              inbound && 'border-sky-500/40 text-sky-700 dark:text-sky-300',
            )}
          >
            {inbound ? 'Inbound' : 'Outbound'}
          </Badge>
        ) : null}
      </div>
    </div>
  )
}

// ─── A aba do formulário ────────────────────────────────────────────────────

const INTENCAO_LABEL: Record<string, string> = {
  cedente: 'Quer antecipar recebíveis',
  sacado: 'Quer pagar fornecedores',
  parceiro: 'Parceria',
  outro: 'Outro',
}

/**
 * O que o lead escreveu, palavra por palavra.
 *
 * Ele já estava gravado em `formulario_submissoes.dados` desde o primeiro dia e não
 * aparecia em lugar nenhum do Comercial — quem ia atender lia sobre a empresa tudo o que
 * o sistema descobriu sozinho e nada do que a pessoa se deu ao trabalho de digitar.
 *
 * Os rótulos vêm do `campos_snapshot`, a cópia do formulário no instante do envio: o
 * formulário é editável e a submissão não, então ler as perguntas de hoje mostraria a
 * pergunta errada para uma resposta antiga.
 */
export function AbaFormulario({ empresaId }: { empresaId: string | null }) {
  const q = useQuery({
    queryKey: comercialKeys.submissoes(empresaId ?? ''),
    queryFn: () => buscarSubmissoesDaEmpresa(empresaId!),
    enabled: Boolean(empresaId),
  })

  if (!empresaId) return <Vazio>Este negócio não tem empresa vinculada.</Vazio>
  if (q.isPending) return <Skeleton className="h-40 w-full rounded-lg" />
  if (q.isError) {
    return <Vazio>{q.error instanceof Error ? q.error.message : 'Erro ao carregar.'}</Vazio>
  }
  if ((q.data ?? []).length === 0) {
    return (
      <Vazio>
        Esta empresa não chegou por formulário. O que se sabe dela veio de prospecção ou de
        enriquecimento — a aba Empresa tem tudo isso.
      </Vazio>
    )
  }

  return (
    <div className="space-y-4">
      {(q.data ?? []).map((s) => (
        <section key={s.id} className="rounded-lg border">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{s.formulario ?? 'Formulário'}</p>
              {s.intencao ? (
                <p className="text-[11px] text-muted-foreground">
                  {INTENCAO_LABEL[s.intencao] ?? s.intencao}
                </p>
              ) : null}
            </div>
            <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {new Date(s.criada_em).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </header>

          <dl className="divide-y">
            {s.respostas.map((r) => (
              <div key={r.chave} className="flex items-baseline gap-3 px-3 py-2">
                <dt className="w-40 shrink-0 text-[11px] text-muted-foreground">{r.label}</dt>
                <dd className="min-w-0 flex-1 break-words text-sm">{r.valor}</dd>
              </div>
            ))}
          </dl>

          {(s.campanha.length > 0 || s.pagina_url) && (
            <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
              {s.campanha.map((c) => (
                <span key={c.rotulo}>
                  {c.rotulo}: <span className="text-foreground">{c.valor}</span>
                </span>
              ))}
              {s.pagina_url ? <span className="truncate">Página: {s.pagina_url}</span> : null}
            </footer>
          )}
        </section>
      ))}
    </div>
  )
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}
