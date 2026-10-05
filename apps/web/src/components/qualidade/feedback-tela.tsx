'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Info, Loader2 } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ESCOPO_ANALISE_LABELS,
  ETAPAS_REUNIAO,
  TIPO_INTERACAO_LABELS,
  TIPO_PENDENCIA_LABELS,
  paletaCategorica,
  type Feedback,
  type PendenciaQualidade,
  type TipoInteracao,
} from '@jobsiteos/core'
import { LinkEmAba } from '@/components/shell/link-em-aba'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { resolverPendenciaAction } from '@/actions/qualidade'
import { ContestarBotao, StatusContestacao } from './analise-detalhe'
import { AnaliseModal } from './analise-modal'
import { NotaBadge, rotuloDaNota, tomDaNota } from './nota'
import { buscarFeedback, buscarVendedoresFeedback, qualidadeKeys } from './queries'

/**
 * A ABA FEEDBACK (05C §7) — o painel do vendedor sobre as próprias conversas.
 *
 * ─── PUBLICADA SOZINHA, E POR ISSO DIZ DE ONDE VEIO ─────────────────────────
 * Ninguém revisa antes de chegar aqui. O cabeçalho fixo diz que é IA e diz o que fazer
 * quando ela errar — contestar —, porque é o único jeito de o erro voltar para o sistema
 * em vez de virar ressentimento contra a ferramenta.
 *
 * ─── A CITAÇÃO É O QUE TORNA O FEEDBACK DISCUTÍVEL ──────────────────────────
 * Cada item que faltou vem com o trecho em que a análise se apoiou e com o que era
 * esperado. "Faltou explorar a dor" sozinho é sentença; com a frase do cliente ao lado,
 * a pessoa pode concordar — ou mostrar que a frase não diz aquilo.
 *
 * ─── VER O DE OUTRO SEGUE OS ACESSOS DE HOJE ────────────────────────────────
 * O seletor lista quem a pessoa já pode ver no resto do Comercial: o gestor, todos —
 * inclusive os agentes de IA, na mesma régua; os demais, só quem estiver marcado para
 * eles em `vendedor_acessos` (0285). Sem ninguém marcado, não há seletor.
 */

const CABECALHO =
  'Análise gerada por IA a partir das suas conversas. Use o botão Contestar quando discordar — é assim que o sistema aprende.'

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`)

/** Troca um parâmetro da URL sem empilhar histórico nem rolar a tela. */
function useParametroUrl() {
  const router = useRouter()
  return React.useCallback(
    (chave: string, valor: string | null) => {
      const p = new URLSearchParams(window.location.search)
      if (valor) p.set(chave, valor)
      else p.delete(chave)
      const qs = p.toString()
      router.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [router],
  )
}

export function FeedbackTela({
  ehGestor,
  meuVendedorId,
  vendedorInicial,
  analiseInicial,
}: {
  ehGestor: boolean
  meuVendedorId: string | null
  vendedorInicial: string | null
  analiseInicial: string | null
}) {
  const trocarParametro = useParametroUrl()
  const [vendedorId, setVendedorId] = React.useState<string | null>(vendedorInicial ?? meuVendedorId)
  const [analiseAberta, setAnaliseAberta] = React.useState<string | null>(analiseInicial)

  const vendedores = useQuery({
    queryKey: qualidadeKeys.vendedores(),
    queryFn: buscarVendedoresFeedback,
  })
  // Seletor só quando há mais de uma pessoa visível: para quem vê só a si, ele seria um
  // controle com uma opção.
  const podeEscolher = (vendedores.data?.length ?? 0) > 1

  // O gestor sem ficha de vendedor abre no primeiro nome — e não numa tela vazia que
  // parece defeito (o mesmo critério do Meu Dia).
  React.useEffect(() => {
    if (ehGestor && !vendedorId && vendedores.data?.[0]) setVendedorId(vendedores.data[0].id)
  }, [ehGestor, vendedorId, vendedores.data])

  // Sem escolha, sempre o próprio: a RPC resolve "eu" sem parâmetro. Com escolha, quem
  // decide se a pessoa escolhida pode ser lida continua sendo a RPC.
  const alvo = podeEscolher ? vendedorId : null
  const feedback = useQuery({
    queryKey: qualidadeKeys.feedback(alvo),
    queryFn: () => buscarFeedback(alvo),
    enabled: !vendedores.isLoading && (!podeEscolher || Boolean(vendedorId)),
  })

  const f = feedback.data
  // Contestar é de quem teve a conversa: o gestor olhando o feedback de outro não contesta por ele.
  const podeContestar = Boolean(f && meuVendedorId && f.vendedor.id === meuVendedorId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Feedback</h1>
          {f && f.vendedor.id !== meuVendedorId ? (
            <p className="text-sm text-muted-foreground">
              {f.vendedor.nome}
              {f.vendedor.is_ia ? ' (agente de IA)' : ''}
            </p>
          ) : null}
        </div>
        {podeEscolher ? (
          <Select
            value={vendedorId ?? undefined}
            onValueChange={(v) => {
              setVendedorId(v)
              trocarParametro('vendedor', v)
            }}
          >
            <SelectTrigger className="h-9 w-64" aria-label="Ver o feedback de">
              <SelectValue placeholder="Escolha um vendedor" />
            </SelectTrigger>
            <SelectContent>
              {(vendedores.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.nome}
                  {v.is_ia ? ' · IA' : ''}
                  {v.id === meuVendedorId ? ' (você)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{CABECALHO}</span>
      </p>

      {feedback.isLoading || (ehGestor && !vendedorId && vendedores.isLoading) ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : feedback.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar o feedback: {(feedback.error as Error).message}
        </p>
      ) : !f ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {ehGestor && !vendedorId
            ? 'Escolha um vendedor para ver o feedback.'
            : 'Não há feedback disponível para esta pessoa.'}
        </p>
      ) : (
        <>
          <Resumo f={f} />
          <Ultimas f={f} podeContestar={podeContestar} onAbrir={setAnaliseAberta} />
          <Pendencias pendencias={f.pendencias} onAbrir={setAnaliseAberta} />
          <PioresItens itens={f.piores_itens} />
          <Evolucao serie={f.evolucao} />
        </>
      )}

      {analiseAberta ? (
        <AnaliseModal
          analiseId={analiseAberta}
          aberto
          onOpenChange={(aberto) => {
            if (aberto) return
            setAnaliseAberta(null)
            // A notificação abriu por `?analise=`: fechar não pode reabrir no próximo refresh.
            if (analiseAberta === analiseInicial) trocarParametro('analise', null)
          }}
        />
      ) : null}
    </div>
  )
}

function Bloco({
  titulo,
  descricao,
  children,
  id,
}: {
  titulo: string
  descricao?: string
  children: React.ReactNode
  id?: string
}) {
  return (
    <section id={id} className="space-y-2.5 rounded-lg border border-border bg-card p-4">
      <header>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
      </header>
      {children}
    </section>
  )
}

function Resumo({ f }: { f: Feedback }) {
  const media = f.resumo.nota_media
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/*
        A média não é a nota de UMA conversa, então não abre um item a item — ela leva à
        lista que a compõe. Um número sem caminho para o porquê é exatamente o que a
        regra do módulo proíbe.
      */}
      <a
        href="#ultimas"
        className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
        aria-label={`Nota média ${rotuloDaNota(media)} — ver as interações que a compõem`}
      >
        <p className="text-xs text-muted-foreground">Nota média (30 dias)</p>
        <p className="mt-1">
          <Badge variant={tomDaNota(media)} className="text-base tabular-nums">
            {rotuloDaNota(media)}
          </Badge>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">Ver as interações que a compõem</p>
      </a>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Interações analisadas (30 dias)</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{f.resumo.analises}</p>
        {f.resumo.sem_avaliacao > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {f.resumo.sem_avaliacao} sem avaliação aplicável — não contam na média
          </p>
        ) : null}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Em calibração</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{f.em_sombra}</p>
        <p className="text-[11px] text-muted-foreground">
          ainda sem nota: rubrica em calibração. Elas aparecem aqui quando a rubrica for publicada.
        </p>
      </div>
    </div>
  )
}

function Ultimas({
  f,
  podeContestar,
  onAbrir,
}: {
  f: Feedback
  podeContestar: boolean
  onAbrir: (id: string) => void
}) {
  return (
    <Bloco
      id="ultimas"
      titulo="Suas últimas interações"
      descricao="Cada uma com a nota e o que faltou — o trecho da conversa e o que era esperado."
    >
      {f.ultimas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma interação analisada ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {f.ultimas.map((u) => (
            <li key={u.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <NotaBadge score={u.score} analiseId={u.id} />
                <span className="text-sm font-medium">{ESCOPO_ANALISE_LABELS[u.escopo]}</span>
                {u.empresa_id ? (
                  <LinkEmAba
                    href={`/empresas/${u.empresa_id}`}
                    tituloDaAba={u.empresa_nome ?? 'Empresa'}
                    className="text-sm underline-offset-2 hover:underline"
                  >
                    {u.empresa_nome ?? 'Empresa'}
                  </LinkEmAba>
                ) : (
                  <span className="text-sm text-muted-foreground">{u.empresa_nome ?? 'Sem empresa vinculada'}</span>
                )}
                <span className="text-xs text-muted-foreground">{dataCurta(u.analisada_em)}</span>
                {u.itens_aplicaveis !== null ? (
                  <span className="text-xs text-muted-foreground">
                    {u.itens_atendidos ?? 0} de {u.itens_aplicaveis} itens atendidos
                  </span>
                ) : null}
                <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => onAbrir(u.id)}>
                  Ver item a item
                </Button>
              </div>
              {u.explicacao ? <p className="text-xs text-muted-foreground">{u.explicacao}</p> : null}
              {u.faltas.length > 0 ? (
                <ul className="space-y-2">
                  {u.faltas.map((falta) => (
                    <li key={falta.id} className="space-y-1 rounded-md border border-border bg-muted/20 p-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">Faltou: {falta.rotulo}</span>
                        {falta.etapa ? <Badge variant="neutral" className="text-[10px]">{falta.etapa}</Badge> : null}
                      </div>
                      {falta.citacao ? (
                        <blockquote className="border-l-2 border-border pl-2 italic text-muted-foreground">
                          “{falta.citacao}”
                        </blockquote>
                      ) : null}
                      <p>
                        <span className="font-medium">O que era esperado: </span>
                        {falta.orientacao}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {falta.contestado ? (
                          <StatusContestacao c={{ veredito: falta.veredito }} />
                        ) : podeContestar ? (
                          <ContestarBotao analiseItemId={falta.id} rotulo={falta.rotulo} />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  )
}

/**
 * O que ficou parado do NOSSO lado. É a parte de maior valor prático do módulo (§7): cada
 * pendência também vira item do Meu Dia, e resolver aqui tira de lá.
 */
function Pendencias({
  pendencias,
  onAbrir,
}: {
  pendencias: PendenciaQualidade[]
  onAbrir: (id: string) => void
}) {
  const qc = useQueryClient()
  const router = useRouter()
  const [ocupada, setOcupada] = React.useState<string | null>(null)

  async function resolver(p: PendenciaQualidade, descartar: boolean) {
    setOcupada(p.id)
    const r = await resolverPendenciaAction({ id: p.id, descartar })
    setOcupada(null)
    if (!r.ok) return void toast.error(r.message)
    toast.success(descartar ? 'Pendência descartada.' : 'Pendência resolvida.')
    await qc.invalidateQueries({ queryKey: qualidadeKeys.all })
    router.refresh()
  }

  return (
    <Bloco
      titulo="Pendências detectadas"
      descricao="Pergunta sem resposta, retorno fora do prazo, compromisso combinado. Cada uma também está no seu Meu Dia."
    >
      {pendencias.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada parado do nosso lado.</p>
      ) : (
        <ul className="divide-y divide-border">
          {pendencias.map((p) => {
            const vencida = p.prazo_em ? new Date(p.prazo_em).getTime() < Date.now() : false
            return (
              <li key={p.id} className="flex flex-wrap items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{TIPO_PENDENCIA_LABELS[p.tipo]}</Badge>
                    {p.empresa_nome ? <span className="text-xs font-medium">{p.empresa_nome}</span> : null}
                    {p.prazo_em ? (
                      <span className={cn('text-[11px]', vencida ? 'text-destructive' : 'text-muted-foreground')}>
                        {vencida ? 'venceu em' : 'prazo'} {dataCurta(p.prazo_em)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm">{p.descricao}</p>
                  {p.citacao ? (
                    <blockquote className="border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                      “{p.citacao}”
                    </blockquote>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {p.conversa_id ? (
                    <Button size="sm" variant="outline" className="h-7" asChild>
                      <LinkEmAba href={`/comunicacao/${p.conversa_id}`} tituloDaAba={p.empresa_nome ?? 'Conversa'}>
                        Abrir a conversa
                      </LinkEmAba>
                    </Button>
                  ) : p.empresa_id ? (
                    <Button size="sm" variant="outline" className="h-7" asChild>
                      <LinkEmAba href={`/empresas/${p.empresa_id}`} tituloDaAba={p.empresa_nome ?? 'Empresa'}>
                        Abrir a empresa
                      </LinkEmAba>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => onAbrir(p.analise_id)}>
                    Ver a análise
                  </Button>
                  <Button size="sm" className="h-7" disabled={ocupada === p.id} onClick={() => void resolver(p, false)}>
                    {ocupada === p.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                    Resolver
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-muted-foreground"
                    disabled={ocupada === p.id}
                    onClick={() => void resolver(p, true)}
                  >
                    Descartar
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Bloco>
  )
}

function PioresItens({ itens }: { itens: Feedback['piores_itens'] }) {
  return (
    <Bloco
      titulo="Onde você mais perde pontos"
      descricao="Os itens com a pior taxa de atendimento nos últimos 30 dias, com a orientação da rubrica."
    >
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum item se repete como falha nos últimos 30 dias.
        </p>
      ) : (
        <ul className="space-y-3">
          {itens.map((i) => (
            <li key={i.chave} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {i.rotulo}
                  {i.etapa ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{i.etapa}</span> : null}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  atendido em {i.atendidos} de {i.aplicaveis} ({pct(i.taxa)})
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`Taxa de atendimento ${pct(i.taxa)}`}
              >
                <div className="h-full rounded-full bg-red-500/70" style={{ width: `${Math.max(2, i.taxa * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">O que se espera: </span>
                {i.orientacao}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  )
}

/**
 * Escuro ou claro — a paleta categórica do core tem passos próprios para cada fundo. O
 * tema da web é por CLASSE no `<html>` (tailwind `darkMode: 'class'`), então é ela que se
 * observa, e não a preferência do sistema.
 */
function useEscuro(): boolean {
  const [escuro, setEscuro] = React.useState(false)
  React.useEffect(() => {
    const raiz = document.documentElement
    const ler = () => setEscuro(raiz.classList.contains('dark') || raiz.dataset.theme === 'dark')
    ler()
    const obs = new MutationObserver(ler)
    obs.observe(raiz, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])
  return escuro
}

function ordemEtapa(e: string): number {
  if (e === 'Geral') return 1000
  const i = (ETAPAS_REUNIAO as readonly string[]).indexOf(e)
  return i >= 0 ? i : 100
}

/**
 * A evolução por etapa, DENTRO da mesma versão de rubrica.
 *
 * Nota de versões diferentes não se compara: é régua diferente. Por isso um gráfico por
 * versão, e o aviso quando o período atravessa uma troca — juntar as duas numa linha só
 * desenharia uma "melhora" ou uma "piora" que é só a régua mudando.
 */
function Evolucao({ serie }: { serie: Feedback['evolucao'] }) {
  const paleta = paletaCategorica(useEscuro())

  const porTipo = React.useMemo(() => {
    const m = new Map<TipoInteracao, Map<number, Feedback['evolucao']>>()
    for (const p of serie) {
      const versoes = m.get(p.tipo_interacao) ?? new Map<number, Feedback['evolucao']>()
      versoes.set(p.versao, [...(versoes.get(p.versao) ?? []), p])
      m.set(p.tipo_interacao, versoes)
    }
    return [...m.entries()].map(([tipo, versoes]) => ({
      tipo,
      versoes: [...versoes.entries()].sort((a, b) => a[0] - b[0]),
    }))
  }, [serie])

  return (
    <Bloco
      titulo="Evolução"
      descricao="A taxa de atendimento por etapa da rubrica, semana a semana (últimos 180 dias)."
    >
      {porTipo.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ainda não há semanas suficientes para uma evolução.</p>
      ) : (
        <div className="space-y-6">
          {porTipo.map(({ tipo, versoes }) => (
            <div key={tipo} className="space-y-2">
              <h3 className="text-sm font-medium">{TIPO_INTERACAO_LABELS[tipo]}</h3>
              {versoes.length > 1 ? (
                <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    Mudar a rubrica reinicia a comparação histórica: o período atravessa{' '}
                    {versoes.length} versões, e cada uma tem o seu gráfico. Não compare a nota de uma
                    versão com a de outra.
                  </span>
                </p>
              ) : null}
              {versoes.map(([versao, pontos]) => (
                <GraficoVersao
                  key={versao}
                  titulo={versoes.length > 1 ? `Versão ${versao}` : null}
                  pontos={pontos}
                  paleta={paleta}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Bloco>
  )
}

function GraficoVersao({
  titulo,
  pontos,
  paleta,
}: {
  titulo: string | null
  pontos: Feedback['evolucao']
  paleta: string[]
}) {
  const etapas = [...new Set(pontos.map((p) => p.etapa))].sort((a, b) => ordemEtapa(a) - ordemEtapa(b))
  const semanas = [...new Set(pontos.map((p) => p.semana))].sort()
  const linhas = semanas.map((s) => {
    const linha: Record<string, string | number | null> = {
      semana: new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    }
    for (const e of etapas) {
      const p = pontos.find((x) => x.semana === s && x.etapa === e)
      linha[e] = p && p.taxa !== null ? Math.round(p.taxa * 100) : null
    }
    return linha
  })

  return (
    <figure className="space-y-1">
      {titulo ? <figcaption className="text-xs font-medium text-muted-foreground">{titulo}</figcaption> : null}
      <div className="h-56 w-full text-muted-foreground" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={linhas} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.15} vertical={false} />
            <XAxis dataKey="semana" tick={{ fill: 'currentColor', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: 'currentColor', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v) => (typeof v === 'number' ? `${v}%` : '—')}
              labelFormatter={(l) => `Semana de ${l}`}
              contentStyle={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 6,
                fontSize: 12,
                color: 'hsl(var(--popover-foreground))',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {etapas.map((e, k) => (
              <Line
                key={e}
                type="monotone"
                dataKey={e}
                name={e}
                stroke={paleta[k % paleta.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* O mesmo dado em texto, para leitor de tela: o gráfico acima é só desenho. */}
      <table className="sr-only">
        <caption>Taxa de atendimento por etapa e semana{titulo ? ` — ${titulo}` : ''}</caption>
        <thead>
          <tr>
            <th scope="col">Semana</th>
            {etapas.map((e) => (
              <th key={e} scope="col">{e}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={String(l.semana)}>
              <th scope="row">{l.semana}</th>
              {etapas.map((e) => (
                <td key={e}>{l[e] === null ? '—' : `${l[e]}%`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
