'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, CircleDashed, EyeOff, Loader2, MessageSquareWarning, Minus, X } from 'lucide-react'
import {
  ETAPAS_REUNIAO,
  PROVEDOR_ANALISE_LABELS,
  TIPO_INTERACAO_LABELS,
  VEREDITO_LABELS,
  formatarNota,
  type AnaliseDetalhe as AnaliseDetalheDados,
  type ItemAnalisado,
  type VereditoContestacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { contestarItemAction } from '@/actions/qualidade'
import { NotaBadge } from './nota'
import { qualidadeKeys } from './queries'

/**
 * A análise item a item (05C §6) — a mesma na aba Reunião, no modal de interação, na aba
 * Feedback e na tela do gestor.
 *
 * ─── A NOTA SE EXPLICA SOZINHA ──────────────────────────────────────────────
 * Ela é aritmética (Σ peso atendido ÷ Σ peso aplicável) e a tela mostra a conta, não só o
 * resultado. É isso que permite discordar de um ITEM em vez de discordar da nota inteira:
 * quem vê "0,62" e a lista que a produziu sabe exatamente qual linha contestar.
 *
 * ─── O QUE FALTOU VEM COM A CITAÇÃO ─────────────────────────────────────────
 * Cada item reprovado traz o trecho em que o classificador se apoiou e o que era
 * esperado. Sem a citação o feedback é sentença; com ela, é discutível — e discutir é o
 * que alimenta a calibração (§9).
 *
 * ─── SOMBRA ─────────────────────────────────────────────────────────────────
 * Item em sombra (pergunta ainda não calibrada) não entra na nota e o vendedor nem o
 * recebe — a RPC o tira. O gestor o vê, apagado e marcado, porque é olhando a sombra
 * trabalhar que ele decide se a pergunta está pronta.
 */

/** Itens de peso zero são registro (objeção, concorrente), não cobrança. */
const ehRegistro = (i: ItemAnalisado) => i.peso <= 0

/** O que entra na conta: aplicável, decidido, com peso — e fora da sombra, salvo na análise em sombra. */
function entraNaConta(i: ItemAnalisado, analiseEmSombra: boolean): boolean {
  return i.aplicavel && i.atendido !== null && i.peso > 0 && (analiseEmSombra || !i.em_sombra)
}

/**
 * A ordem das etapas: a da rubrica de reunião quando ela se aplica; nas outras, a ordem em
 * que a etapa aparece pela primeira vez nos itens. Etapa nula é "Geral", sempre por último.
 */
function agruparPorEtapa(itens: ItemAnalisado[]): Array<{ etapa: string; itens: ItemAnalisado[] }> {
  const grupos = new Map<string, ItemAnalisado[]>()
  for (const i of [...itens].sort((a, b) => a.ordem - b.ordem)) {
    const etapa = i.etapa?.trim() || 'Geral'
    grupos.set(etapa, [...(grupos.get(etapa) ?? []), i])
  }
  const pos = (e: string) => {
    const r = (ETAPAS_REUNIAO as readonly string[]).indexOf(e)
    if (e === 'Geral') return 1000
    return r >= 0 ? r : 100
  }
  return [...grupos.entries()]
    .map(([etapa, itens], ordem) => ({ etapa, itens, ordem }))
    .sort((a, b) => pos(a.etapa) - pos(b.etapa) || a.ordem - b.ordem)
    .map(({ etapa, itens }) => ({ etapa, itens }))
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const pesoLegivel = (p: number) => String(Math.round(p * 100) / 100).replace('.', ',')

export function AnaliseDetalhe({
  detalhe,
  ehGestor,
}: {
  detalhe: AnaliseDetalheDados
  /** Só muda o que se DESENHA (provedor, banda, sombra): o recorte já veio da RPC. */
  ehGestor: boolean
}) {
  const a = detalhe.analise
  const emSombra = a.modo === 'sombra'
  const avaliados = detalhe.itens.filter((i) => !ehRegistro(i))
  const registros = detalhe.itens.filter(ehRegistro)
  const grupos = agruparPorEtapa(avaliados)

  return (
    <div className="space-y-4">
      {emSombra ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong>Em sombra (rubrica não calibrada) — o vendedor não vê.</strong> A análise roda e
            fica gravada para a calibração; nenhuma nota dela chega a quem foi analisado enquanto as
            perguntas não passarem pela calibração.
          </span>
        </p>
      ) : null}

      <Resumo detalhe={detalhe} emSombra={emSombra} />
      <MemoriaDeCalculo
        itens={avaliados}
        emSombra={emSombra}
        ehGestor={ehGestor}
        scoreFinal={emSombra ? a.score_sombra : a.score}
      />

      {grupos.map((g) => (
        <section key={g.etapa} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.etapa}</h4>
          <ul className="divide-y divide-border rounded-md border border-border">
            {g.itens.map((i) => (
              <LinhaItem key={i.id} item={i} ehGestor={ehGestor} podeContestar={detalhe.pode_contestar} />
            ))}
          </ul>
        </section>
      ))}

      {registros.length > 0 ? (
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registros</h4>
          <p className="text-[11px] text-muted-foreground">
            O que a conversa trouxe e não vale nota: fica anotado para a gestão (objeções, concorrentes).
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {registros.map((i) => (
              <li key={i.id} className={cn('flex items-start justify-between gap-3 px-3 py-2 text-xs', i.em_sombra && 'opacity-60')}>
                <div className="min-w-0">
                  <p className="font-medium">{i.rotulo}</p>
                  {i.citacao ? <p className="mt-0.5 italic text-muted-foreground">“{i.citacao}”</p> : null}
                </div>
                <span className="shrink-0 text-right">
                  {!i.aplicavel
                    ? <span className="text-muted-foreground">não se aplicava</span>
                    : i.resultado ?? (i.atendido === null ? '—' : i.atendido ? 'Sim' : 'Não')}
                  {i.em_sombra && ehGestor ? (
                    <span className="block text-[10px] text-muted-foreground">item em sombra</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Resumo({ detalhe, emSombra }: { detalhe: AnaliseDetalheDados; emSombra: boolean }) {
  const a = detalhe.analise
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Aqui a nota JÁ é o detalhe: ela não abre nada, e por isso não é botão. Na análise
          em sombra não existe nota publicada — mostrar "sem avaliação" ao lado da nota que
          seria confundiria as duas; fica só a que seria, dita como tal.
        */}
        {emSombra ? (
          <span title="A nota que esta análise teria se a rubrica estivesse calibrada.">
            <NotaBadge score={a.score_sombra} prefixo="Nota que seria" className="text-sm" />
          </span>
        ) : (
          <NotaBadge score={a.score} prefixo="Nota" className="text-sm" />
        )}
        {a.itens_aplicaveis !== null ? (
          <span className="text-xs text-muted-foreground">
            {a.itens_atendidos ?? 0} de {a.itens_aplicaveis} itens aplicáveis atendidos
          </span>
        ) : null}
      </div>
      {a.explicacao ? <p className="text-sm">{a.explicacao}</p> : null}
      <p className="text-[11px] text-muted-foreground">
        {TIPO_INTERACAO_LABELS[a.tipo_interacao]} · rubrica versão {a.rubrica_versao}
        {a.rubrica_ativa ? '' : ' (versão anterior — a rubrica mudou depois desta análise)'} · analisada em{' '}
        {dataCurta(a.analisada_em)}
      </p>
    </div>
  )
}

/**
 * A conta, à vista. Um `<details>` porque quase ninguém precisa dela — mas quem precisa é
 * justamente quem vai discordar, e para essa pessoa ela é a tela inteira.
 */
function MemoriaDeCalculo({
  itens,
  emSombra,
  ehGestor,
  scoreFinal,
}: {
  itens: ItemAnalisado[]
  emSombra: boolean
  ehGestor: boolean
  scoreFinal: number | null
}) {
  const conta = itens.filter((i) => entraNaConta(i, emSombra))
  const total = conta.reduce((s, i) => s + i.peso, 0)
  const atendido = conta.reduce((s, i) => s + (i.atendido ? i.peso : 0), 0)
  const fora = itens.filter((i) => !i.aplicavel).length
  const pendentes = itens.filter((i) => i.aplicavel && i.atendido === null).length

  return (
    <details className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none font-medium">Memória de cálculo</summary>
      <div className="mt-2 space-y-2">
        {conta.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum item se aplicava a esta conversa — por isso ela fica sem avaliação, e não com zero.
          </p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {conta.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  {i.atendido ? (
                    <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Atendido" />
                  ) : (
                    <X className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-label="Não atendido" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{i.rotulo}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">peso {pesoLegivel(i.peso)}</span>
                </li>
              ))}
            </ul>
            <p className="tabular-nums">
              Pesos atendidos ÷ pesos aplicáveis = {pesoLegivel(atendido)} ÷ {pesoLegivel(total)} ={' '}
              <strong>{formatarNota(scoreFinal ?? (total > 0 ? atendido / total : null))}</strong>
            </p>
          </>
        )}
        <p className="text-muted-foreground">
          Itens que não se aplicavam a esta conversa{fora > 0 ? ` (${fora})` : ''} ficam fora do
          denominador: não contam nem a favor nem contra.
          {pendentes > 0
            ? ` ${pendentes === 1 ? 'Um item aguarda' : `${pendentes} itens aguardam`} revisão e também ficam fora até ela sair.`
            : ''}
          {/* Só o gestor recebe item em sombra; para o vendedor a frase falaria do que ele não vê. */}
          {ehGestor && !emSombra ? ' Itens em sombra (ainda em calibração) não entram na nota.' : ''}
        </p>
      </div>
    </details>
  )
}

function LinhaItem({
  item: i,
  ehGestor,
  podeContestar,
}: {
  item: ItemAnalisado
  ehGestor: boolean
  podeContestar: boolean
}) {
  const falhou = i.aplicavel && i.atendido === false
  const contestacaoAberta = Boolean(i.contestacao && !i.contestacao.veredito)

  return (
    <li className={cn('space-y-1.5 px-3 py-2.5 text-xs', i.em_sombra && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <IconeResultado item={i} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{i.rotulo}</span>
            {i.em_sombra && ehGestor ? <Badge variant="neutral" className="text-[10px]">item em sombra</Badge> : null}
            {i.revisao_pendente ? (
              <Badge variant="warning" className="text-[10px]" title="O classificador ficou em dúvida e a revisão ainda não saiu. Enquanto isso, o item fica fora da nota.">
                aguardando revisão
              </Badge>
            ) : null}
            {i.corrigido_em ? <Badge variant="info" className="text-[10px]">corrigido após contestação</Badge> : null}
            {ehGestor ? <SinaisDoGestor item={i} /> : null}
          </div>
          <p className="text-muted-foreground">{i.pergunta}</p>
          {!i.aplicavel ? (
            <p className="text-[11px] text-muted-foreground">Não se aplicava a esta conversa — fora da nota.</p>
          ) : i.tipo_resposta !== 'sim_nao' && i.resultado ? (
            <p className="text-[11px]">Resposta: {i.resultado}</p>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">peso {pesoLegivel(i.peso)}</span>
      </div>

      {falhou ? (
        <div className="ml-5 space-y-1">
          {i.citacao ? (
            <blockquote className="border-l-2 border-border pl-2 italic text-muted-foreground">“{i.citacao}”</blockquote>
          ) : null}
          <p>
            <span className="font-medium">O que era esperado: </span>
            {i.orientacao ?? i.orientacao_rubrica}
          </p>
        </div>
      ) : null}

      <div className="ml-5 flex flex-wrap items-center gap-2">
        {i.contestacao ? <StatusContestacao c={i.contestacao} /> : null}
        {podeContestar && !contestacaoAberta && !i.em_sombra ? (
          <ContestarBotao analiseItemId={i.id} rotulo={i.rotulo} />
        ) : null}
      </div>
    </li>
  )
}

function IconeResultado({ item: i }: { item: ItemAnalisado }) {
  if (!i.aplicavel) return <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Não se aplicava" />
  if (i.atendido === null) return <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Sem decisão" />
  return i.atendido ? (
    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Atendido" />
  ) : (
    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Não atendido" />
  )
}

/** O que só o gestor lê: quem decidiu o item e com quanta certeza. */
function SinaisDoGestor({ item: i }: { item: ItemAnalisado }) {
  return (
    <>
      {i.provedor ? (
        <Badge variant="outline" className="text-[10px] font-normal">
          {PROVEDOR_ANALISE_LABELS[i.provedor]}
          {i.prob_atendido !== null ? ` · ${Math.round(i.prob_atendido * 100)}%` : ''}
        </Badge>
      ) : null}
      {i.banda_cinzenta ? (
        <Badge variant="outline" className="text-[10px] font-normal" title="A probabilidade ficou perto do limiar; quem decidiu foi o Claude.">
          banda cinzenta
        </Badge>
      ) : null}
      {i.divergente ? (
        <Badge variant="warning" className="text-[10px]" title="O Claude discordou do Jev e mudou o resultado.">
          divergente
        </Badge>
      ) : null}
      {i.rotulo_humano ? (
        <Badge variant="info" className="text-[10px] font-normal" title={`Rótulo humano (${i.rotulo_humano.origem})`}>
          humano:{' '}
          {!i.rotulo_humano.aplicavel ? 'não se aplicava' : i.rotulo_humano.atendido ? 'atendeu' : 'não atendeu'}
        </Badge>
      ) : null}
    </>
  )
}

export function StatusContestacao({
  c,
}: {
  c: { veredito: VereditoContestacao | null; resposta_gestor?: string | null; criada_em?: string; justificativa?: string | null }
}) {
  if (!c.veredito) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <MessageSquareWarning className="h-3 w-3" aria-hidden />
        Contestado{c.criada_em ? ` em ${dataCurta(c.criada_em)}` : ''} — aguardando a gestão
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-1 text-[11px]',
        c.veredito === 'procedente' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground',
      )}
    >
      <MessageSquareWarning className="h-3 w-3" aria-hidden />
      Contestação: {VEREDITO_LABELS[c.veredito]}
      {c.resposta_gestor ? <span className="text-muted-foreground">— “{c.resposta_gestor}”</span> : null}
    </span>
  )
}

/**
 * Contestar não apaga a nota — abre uma revisão para a gestão (§9). A justificativa é
 * curta de propósito: uma frase basta para o gestor saber onde olhar, e um formulário
 * longo faria a pessoa desistir de discordar — que é o sinal que a calibração precisa.
 */
export function ContestarBotao({ analiseItemId, rotulo }: { analiseItemId: string; rotulo: string }) {
  const qc = useQueryClient()
  const [aberto, setAberto] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const curto = texto.trim().length < 5

  async function enviar() {
    if (curto) return
    setEnviando(true)
    const r = await contestarItemAction({ analise_item_id: analiseItemId, justificativa: texto.trim() })
    setEnviando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success('Contestação enviada. A gestão revisa e a resposta aparece aqui.')
    setAberto(false)
    setTexto('')
    await qc.invalidateQueries({ queryKey: qualidadeKeys.all })
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setAberto(true)}>
        Contestar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Contestar “{rotulo}”</DialogTitle>
            <DialogDescription>
              Diga em uma frase por que discorda. A nota não muda agora: a contestação vai para a
              gestão, e se ela der razão o item é corrigido e a nota recalculada.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Ex.: eu perguntei sobre o fluxo de caixa logo no começo da reunião."
            aria-label="Justificativa"
          />
          {texto.length > 0 && curto ? (
            <p className="text-[11px] text-destructive">Escreva pelo menos 5 caracteres.</p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void enviar()} disabled={curto || enviando}>
              {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Enviar contestação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
