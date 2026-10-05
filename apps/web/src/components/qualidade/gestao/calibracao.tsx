'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import {
  ESCOPO_ANALISE_LABELS,
  STATUS_CALIBRACAO_LABELS,
  TIPO_INTERACAO_LABELS,
  TIPOS_INTERACAO,
  type AnaliseDetalhe,
  type RubricaLida,
  type StatusCalibracao,
  type TipoInteracao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { overrideLimiarAction, pedirRecalibracaoAction, rotularAnaliseAction } from '@/actions/qualidade'
import { cn } from '@/lib/utils'
import { Aviso, ErroCarga, Vazio } from './comum'
import { dataCurta, dataHora, decimal, inteiro, numeroBr, pct, textoDeNumero } from './formato'
import { CurvaPR } from './graficos'
import { InteracaoTexto } from './interacao-texto'
import {
  buscarAnaliseComTexto,
  buscarConfigQualidade,
  buscarParaRotular,
  buscarRubricas,
  qualidadeGestaoKeys,
} from './queries'

/**
 * CALIBRAÇÃO (05C §5) — etapa obrigatória. Nenhuma nota chega a um vendedor antes dela.
 *
 * Duas metades:
 *
 * (a) ROTULAGEM. O gestor lê a interação e responde item a item, com a MESMA pergunta
 *     que vai ao classificador — e, quando o item tem condição de aplicabilidade, a
 *     condição vem antes, igual ao classificador. A resposta do modelo NÃO aparece: ver
 *     o "atendeu (0,81)" antes de responder ancora o rótulo, e um rótulo ancorado na
 *     saída do modelo mede o modelo contra ele mesmo. Só o rótulo humano que já existe
 *     (de uma rotulagem anterior ou de uma contestação) volta preenchido.
 *
 * (b) RELATÓRIO. Por item de cada versão: estado, F1, precisão, recall, amostras e o
 *     limiar com a sua origem — e a curva que justifica o limiar. Item com F1 abaixo do
 *     mínimo é "pergunta mal formulada": a leitura correta é que o defeito é da rubrica.
 */
export function Calibracao() {
  const [tipo, setTipo] = React.useState<TipoInteracao>('reuniao')
  const rubricas = useQuery({ queryKey: qualidadeGestaoKeys.rubricas(), queryFn: buscarRubricas })
  const config = useQuery({ queryKey: qualidadeGestaoKeys.config(), queryFn: buscarConfigQualidade })

  const doTipo = (rubricas.data ?? []).filter((r) => r.tipo_interacao === tipo)
  const ativa = doTipo.find((r) => r.ativa) ?? null

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Tipo de interação" className="inline-flex flex-wrap rounded-md border p-0.5">
        {TIPOS_INTERACAO.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tipo === t ? 'secondary' : 'ghost'}
            className="h-7 px-3 text-xs"
            aria-pressed={tipo === t}
            onClick={() => setTipo(t)}
          >
            {TIPO_INTERACAO_LABELS[t]}
          </Button>
        ))}
      </div>

      {rubricas.isPending || config.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : rubricas.isError ? (
        <ErroCarga erro={rubricas.error} oque="as rubricas" />
      ) : (
        <>
          <Rotulagem
            key={tipo}
            tipo={tipo}
            ativa={ativa}
            minAmostras={config.data?.calibracao.min_amostras_calibracao ?? 20}
          />
          <Relatorio rubricas={doTipo} f1Minimo={config.data?.calibracao.f1_minimo ?? 0.7} />
        </>
      )}
    </div>
  )
}

// ─── (a) Rotulagem ──────────────────────────────────────────────────────────

function Rotulagem({ tipo, ativa, minAmostras }: { tipo: TipoInteracao; ativa: RubricaLida | null; minAmostras: number }) {
  const fila = useQuery({ queryKey: qualidadeGestaoKeys.paraRotular(tipo), queryFn: () => buscarParaRotular(tipo) })
  const [aberta, setAberta] = React.useState<string | null>(null)

  const rotuladas = fila.data?.rotuladas ?? 0
  const progresso = Math.min(1, rotuladas / Math.max(1, minAmostras))
  // Memorizado: o painel repreenche as respostas quando a lista muda, e uma lista nova a
  // cada render apagaria o que o gestor acabou de marcar.
  const itensAtivos = React.useMemo(() => (ativa?.itens ?? []).filter((i) => i.ativo), [ativa])

  function proxima() {
    const lista = fila.data?.fila ?? []
    const idx = lista.findIndex((a) => a.id === aberta)
    const seguinte = lista.slice(idx + 1).find((a) => a.rotulos_feitos === 0) ?? lista[idx + 1] ?? null
    setAberta(seguinte?.id ?? null)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rotular interações — {TIPO_INTERACAO_LABELS[tipo]}</CardTitle>
        <CardDescription>
          Leia a interação e responda cada item como o classificador responderia. A resposta do modelo
          fica escondida de propósito: ver o que ele disse antes ancora o seu rótulo.
        </CardDescription>
        <div className="space-y-1 pt-1">
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{inteiro(rotuladas)}</span> interações rotuladas de mínimo{' '}
            <span className="tabular-nums">{inteiro(minAmostras)}</span>
            {rotuladas >= minAmostras ? ' — amostra mínima atingida.' : '.'}
          </p>
          <div
            className="h-2 w-full max-w-md overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={minAmostras}
            aria-valuenow={rotuladas}
            aria-label="Interações rotuladas"
          >
            <div className="h-2 rounded-full bg-primary" style={{ width: `${progresso * 100}%` }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ativa ? (
          <Aviso>
            Não há rubrica ATIVA para {TIPO_INTERACAO_LABELS[tipo].toLowerCase()}. Ative uma versão na aba
            Rubricas — a rotulagem responde às perguntas da versão ativa.
          </Aviso>
        ) : fila.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : fila.isError ? (
          <ErroCarga erro={fila.error} oque="a fila de rotulagem" />
        ) : aberta ? (
          <PainelRotulo
            key={aberta}
            analiseId={aberta}
            tipo={tipo}
            itens={itensAtivos}
            versaoAtiva={ativa.versao}
            onFechar={() => setAberta(null)}
            onProxima={proxima}
          />
        ) : fila.data.fila.length === 0 ? (
          <Vazio>Nenhuma interação analisada deste tipo ainda.</Vazio>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {fila.data.fila.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50"
                  onClick={() => setAberta(a.id)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.empresa_nome ?? 'Empresa sem nome'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ESCOPO_ANALISE_LABELS[a.escopo]} · {a.vendedor_nome ?? 'sem vendedor'} · {dataCurta(a.analisada_em)} · v
                      {a.rubrica_versao}
                    </span>
                  </span>
                  {a.rotulos_feitos > 0 ? (
                    <Badge variant="success" className="shrink-0 text-[10px]">
                      {a.rotulos_feitos} rótulo(s)
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="shrink-0 text-[10px]">
                      sem rótulo
                    </Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

type ItemAtivo = RubricaLida['itens'][number]

/** A resposta do gestor a um item: aplicável? e a resposta à pergunta do item. */
interface Resposta {
  aplicavel: boolean | null
  /** sim_nao: 'sim' | 'nao'; escolha: a opção; score: 'sim' | 'nao' (atendeu?). */
  resposta: string | null
}

/**
 * O que "atendido" significa para a resposta dada. O gestor responde a PERGUNTA, não
 * "atendeu?": em "alguma pergunta do cliente ficou sem resposta?", atender é responder
 * NÃO — e pedir "atendeu?" ao lado dessa pergunta é como se erra rótulo. Quem traduz
 * resposta em atendido é o `atende` do item, a mesma regra do classificador.
 */
function atendidoDe(it: ItemAtivo, resposta: string | null): boolean | null {
  if (resposta === null) return null
  if (it.tipo_resposta === 'escolha') {
    if (!it.atende || it.atende.length === 0) return null // informativo: grava a escolha, não pontua
    return it.atende.includes(resposta)
  }
  if (it.tipo_resposta === 'score') return resposta === 'sim'
  const atende = it.atende && it.atende.length > 0 ? it.atende : ['sim']
  return atende.includes(resposta)
}

/** O rótulo que já existe volta como resposta — a única coisa pré-preenchida. */
function respostaDoRotulo(it: ItemAtivo, r: NonNullable<AnaliseDetalhe['itens'][number]['rotulo_humano']>): Resposta {
  if (!r.aplicavel) return { aplicavel: false, resposta: null }
  if (it.tipo_resposta === 'escolha') return { aplicavel: true, resposta: r.resultado }
  if (it.tipo_resposta === 'score') return { aplicavel: true, resposta: r.atendido === null ? null : r.atendido ? 'sim' : 'nao' }
  if (r.resultado === 'sim' || r.resultado === 'nao') return { aplicavel: true, resposta: r.resultado }
  if (r.atendido === null) return { aplicavel: true, resposta: null }
  const atendeSim = !it.atende || it.atende.length === 0 || it.atende.includes('sim')
  return { aplicavel: true, resposta: r.atendido === atendeSim ? 'sim' : 'nao' }
}

function completo(it: ItemAtivo, r: Resposta | undefined): boolean {
  if (!r) return false
  const aplicavel = it.condicao_aplicabilidade ? r.aplicavel : true
  if (aplicavel === null) return false
  return aplicavel === false || r.resposta !== null
}

function PainelRotulo({
  analiseId,
  tipo,
  itens,
  versaoAtiva,
  onFechar,
  onProxima,
}: {
  analiseId: string
  tipo: TipoInteracao
  itens: ItemAtivo[]
  versaoAtiva: number
  onFechar: () => void
  onProxima: () => void
}) {
  const qc = useQueryClient()
  const det = useQuery({ queryKey: qualidadeGestaoKeys.analise(analiseId), queryFn: () => buscarAnaliseComTexto(analiseId) })
  const [respostas, setRespostas] = React.useState<Record<string, Resposta>>({})
  const [salvando, setSalvando] = React.useState(false)

  // Pré-preenche SÓ com o rótulo humano existente, UMA vez por análise. A trava segura o
  // refetch de foco da janela: voltar de outra aba no meio da rotulagem não pode apagar
  // o que ainda não foi salvo.
  const carregadaEm = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!det.data) return
    if (carregadaEm.current === analiseId) return
    carregadaEm.current = analiseId
    const porChave = new Map(det.data.itens.map((i) => [i.chave, i.rotulo_humano]))
    const ini: Record<string, Resposta> = {}
    for (const it of itens) {
      const r = porChave.get(it.chave)
      if (r) ini[it.chave] = respostaDoRotulo(it, r)
    }
    setRespostas(ini)
  }, [det.data, itens, analiseId])

  const feitos = itens.filter((it) => completo(it, respostas[it.chave])).length

  function definir(chave: string, parcial: Partial<Resposta>) {
    setRespostas((a) => ({ ...a, [chave]: { aplicavel: null, resposta: null, ...a[chave], ...parcial } }))
  }

  async function salvar(irParaProxima: boolean) {
    const rotulos = itens
      .filter((it) => completo(it, respostas[it.chave]))
      .map((it) => {
        const r = respostas[it.chave]!
        const aplicavel = it.condicao_aplicabilidade ? r.aplicavel === true : true
        if (!aplicavel) return { chave: it.chave, aplicavel: false, atendido: null, resultado: null }
        return {
          chave: it.chave,
          aplicavel: true,
          atendido: atendidoDe(it, r.resposta),
          // O resultado cru vai junto: na escolha é a opção; no sim/não é a resposta à pergunta.
          resultado: it.tipo_resposta === 'score' ? null : r.resposta,
        }
      })
    if (rotulos.length === 0) return void toast.error('Responda pelo menos um item antes de salvar.')
    setSalvando(true)
    const res = await rotularAnaliseAction({ analise_id: analiseId, rotulos })
    setSalvando(false)
    if (!res.ok) return void toast.error(res.message)
    toast.success(`${res.data} rótulo(s) salvos. Eles entram na próxima calibração.`)
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.paraRotular(tipo) })
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.analise(analiseId) })
    if (irParaProxima) onProxima()
  }

  if (det.isPending) return <Skeleton className="h-96 w-full" />
  if (det.isError) return <ErroCarga erro={det.error} oque="a interação" />
  if (!det.data) {
    return (
      <div className="space-y-2">
        <Aviso>Esta análise não está acessível.</Aviso>
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Voltar à fila
        </Button>
      </div>
    )
  }

  const d = det.data
  // Agrupado por etapa, na ordem da rubrica — a leitura é a mesma da pré-visualização.
  const grupos: Array<{ etapa: string; itens: ItemAtivo[] }> = []
  for (const it of itens) {
    const etapa = it.etapa ?? 'Geral'
    const g = grupos.find((x) => x.etapa === etapa)
    if (g) g.itens.push(it)
    else grupos.push({ etapa, itens: [it] })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-medium">{d.empresa?.nome ?? 'Empresa sem nome'}</p>
          <p className="text-xs text-muted-foreground">
            {ESCOPO_ANALISE_LABELS[d.analise.escopo]} · {d.vendedor?.nome ?? 'sem vendedor'}
            {d.vendedor?.is_ia ? ' (IA)' : ''} · {dataHora(d.interacao?.inicio_em ?? d.interacao?.iniciada_em ?? d.interacao?.fim ?? d.analise.analisada_em)}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Voltar à fila
        </Button>
      </div>

      {d.analise.rubrica_versao !== versaoAtiva ? (
        <p className="text-xs text-muted-foreground">
          Esta interação foi analisada com a versão {d.analise.rubrica_versao}; as perguntas abaixo são da versão
          ativa ({versaoAtiva}). O rótulo é guardado pela chave do item, e é reaproveitado por qualquer versão que
          tenha a mesma chave.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-[34rem] overflow-hidden rounded-md border">
          <InteracaoTexto d={d} />
        </div>

        <div className="flex h-[34rem] flex-col rounded-md border">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {grupos.map((g) => (
              <section key={g.etapa} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.etapa}</h4>
                {g.itens.map((it) => (
                  <ItemRotulo key={it.id} it={it} r={respostas[it.chave]} onMudar={(p) => definir(it.chave, p)} />
                ))}
              </section>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {feitos} de {itens.length} itens respondidos
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={salvando} onClick={() => void salvar(false)}>
                Salvar
              </Button>
              <Button size="sm" disabled={salvando} onClick={() => void salvar(true)}>
                {salvando ? 'Salvando…' : 'Salvar e próxima'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Opcoes({
  valores,
  rotulos,
  atual,
  onEscolher,
  rotuloGrupo,
}: {
  valores: string[]
  rotulos?: Record<string, string>
  atual: string | null
  onEscolher: (v: string) => void
  rotuloGrupo: string
}) {
  return (
    <div role="radiogroup" aria-label={rotuloGrupo} className="flex flex-wrap gap-1.5">
      {valores.map((v) => (
        <Button
          key={v}
          type="button"
          role="radio"
          aria-checked={atual === v}
          size="sm"
          variant={atual === v ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={() => onEscolher(v)}
        >
          {rotulos?.[v] ?? v}
        </Button>
      ))}
    </div>
  )
}

const SIM_NAO = { sim: 'Sim', nao: 'Não' }

function ItemRotulo({ it, r, onMudar }: { it: ItemAtivo; r: Resposta | undefined; onMudar: (p: Partial<Resposta>) => void }) {
  const temCondicao = !!it.condicao_aplicabilidade
  const aplicavel = temCondicao ? (r?.aplicavel ?? null) : true
  const atendido = aplicavel ? atendidoDe(it, r?.resposta ?? null) : null
  const feito = completo(it, r)

  return (
    <div className={cn('space-y-2 rounded-md border p-3', feito && 'border-primary/40')}>
      <p className="text-sm font-medium">{it.rotulo}</p>

      {temCondicao ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Aplicável?</span> {it.condicao_aplicabilidade}
          </p>
          <Opcoes
            valores={['sim', 'nao']}
            rotulos={SIM_NAO}
            atual={r?.aplicavel === null || r?.aplicavel === undefined ? null : r.aplicavel ? 'sim' : 'nao'}
            onEscolher={(v) => onMudar({ aplicavel: v === 'sim', ...(v === 'nao' ? { resposta: null } : {}) })}
            rotuloGrupo={`Aplicabilidade de ${it.rotulo}`}
          />
        </div>
      ) : null}

      {aplicavel ? (
        <div className="space-y-1">
          <p className="text-sm">{it.pergunta}</p>
          {it.tipo_resposta === 'escolha' ? (
            <Opcoes
              valores={it.opcoes ?? []}
              atual={r?.resposta ?? null}
              onEscolher={(v) => onMudar({ resposta: v })}
              rotuloGrupo={it.rotulo}
            />
          ) : it.tipo_resposta === 'score' ? (
            <Opcoes
              valores={['sim', 'nao']}
              rotulos={{ sim: 'Atendeu', nao: 'Não atendeu' }}
              atual={r?.resposta ?? null}
              onEscolher={(v) => onMudar({ resposta: v })}
              rotuloGrupo={it.rotulo}
            />
          ) : (
            <Opcoes
              valores={['sim', 'nao']}
              rotulos={SIM_NAO}
              atual={r?.resposta ?? null}
              onEscolher={(v) => onMudar({ resposta: v })}
              rotuloGrupo={it.rotulo}
            />
          )}
          {r?.resposta ? (
            <p className="text-[11px] text-muted-foreground">
              {atendido === null ? 'Item informativo: grava a resposta, não pontua.' : atendido ? '→ conta como atendido' : '→ conta como não atendido'}
            </p>
          ) : null}
        </div>
      ) : aplicavel === false ? (
        <p className="text-[11px] text-muted-foreground">Não se aplica: o item sai do denominador.</p>
      ) : null}
    </div>
  )
}

// ─── (b) Relatório de calibração ────────────────────────────────────────────

const VARIANTE_STATUS: Record<StatusCalibracao, 'success' | 'warning' | 'neutral'> = {
  publicado: 'success',
  sombra_f1: 'warning',
  inativo_amostras: 'neutral',
  nao_calibrado: 'neutral',
}

function Relatorio({ rubricas, f1Minimo }: { rubricas: RubricaLida[]; f1Minimo: number }) {
  const [versaoId, setVersaoId] = React.useState<string | null>(null)
  const atual = rubricas.find((r) => r.id === versaoId) ?? rubricas.find((r) => r.ativa) ?? rubricas[0] ?? null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Relatório de calibração</CardTitle>
          {rubricas.length > 1 ? (
            <select
              aria-label="Versão da rubrica"
              value={atual?.id ?? ''}
              onChange={(e) => setVersaoId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {rubricas.map((r) => (
                <option key={r.id} value={r.id}>
                  v{r.versao} — {r.nome}
                  {r.ativa ? ' (ativa)' : ''}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <CardDescription>
          O limiar de cada item é o ponto que maximiza o F1 sobre as faltas rotuladas. Item com F1 abaixo de{' '}
          {decimal(f1Minimo)} fica em sombra como pergunta mal formulada: o defeito é da rubrica, não do
          vendedor. Item sem amostras suficientes fica inativo — nunca com limiar chutado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!atual ? <Vazio>Nenhuma rubrica deste tipo.</Vazio> : <RelatorioVersao r={atual} />}
      </CardContent>
    </Card>
  )
}

function EstadoRubrica({ r }: { r: RubricaLida }) {
  const publicados = r.itens.filter((i) => i.ativo && i.status_calibracao === 'publicado').length
  const ativos = r.itens.filter((i) => i.ativo).length
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">
        v{r.versao} — {r.nome}
      </span>
      {r.ativa ? <Badge>Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}
      {r.calibrada_em && publicados > 0 ? (
        <Badge variant="success">
          Calibrada em {dataCurta(r.calibrada_em)} · {publicados} de {ativos} itens publicam
        </Badge>
      ) : (
        <Badge variant="warning">Em sombra — analisa e grava, não publica nota</Badge>
      )}
      {r.recalibrar_pedido_em ? (
        <Badge variant="info">Recalibração pedida em {dataHora(r.recalibrar_pedido_em)}</Badge>
      ) : null}
    </div>
  )
}

function RelatorioVersao({ r }: { r: RubricaLida }) {
  const qc = useQueryClient()
  const [pedindo, setPedindo] = React.useState(false)
  const [aberto, setAberto] = React.useState<string | null>(null)
  const [override, setOverride] = React.useState<ItemAtivo | null>(null)

  async function recalibrar() {
    setPedindo(true)
    const res = await pedirRecalibracaoAction({ rubrica_id: r.id })
    setPedindo(false)
    if (!res.ok) return void toast.error(res.message)
    toast.success('Recalibração pedida. O worker roda em instantes; atualize em alguns minutos.')
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.rubricas() })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EstadoRubrica r={r} />
        <Button size="sm" variant="outline" disabled={pedindo} onClick={() => void recalibrar()}>
          <RefreshCw className={cn('mr-1 h-3.5 w-3.5', pedindo && 'animate-spin')} aria-hidden />
          Recalibrar agora
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="w-8 px-2 py-2" />
              <th scope="col" className="px-3 py-2 font-normal">Item</th>
              <th scope="col" className="px-3 py-2 font-normal">Estado</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">F1</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Precisão</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Recall</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Amostras</th>
              <th scope="col" className="px-3 py-2 font-normal">Limiar</th>
              <th scope="col" className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.itens.map((it) => {
              const expandido = aberto === it.id
              const curva = it.calibracao?.curva ?? []
              return (
                <React.Fragment key={it.id}>
                  <tr className={cn('align-top', !it.ativo && 'opacity-60')}>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        aria-label={expandido ? 'Fechar curva' : 'Ver curva'}
                        aria-expanded={expandido}
                        className="rounded p-0.5 hover:bg-muted"
                        onClick={() => setAberto(expandido ? null : it.id)}
                      >
                        {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{it.rotulo}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.etapa ?? 'Geral'} · <code>{it.chave}</code>
                        {!it.ativo ? ' · desativado' : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={VARIANTE_STATUS[it.status_calibracao]} className="text-[10px]">
                        {STATUS_CALIBRACAO_LABELS[it.status_calibracao]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{decimal(it.f1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(it.precisao)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(it.recall)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {inteiro(it.n_amostras)}
                      {it.calibracao?.n_faltas !== undefined ? (
                        <span className="block text-[11px] text-muted-foreground">{inteiro(it.calibracao.n_faltas)} faltas</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className="tabular-nums">{decimal(it.limiar)}</span>
                      {it.limiar_origem ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {it.limiar_origem === 'override' ? 'override do gestor' : 'calibração'}
                        </span>
                      ) : null}
                      {it.limiar_origem === 'override' && it.limiar_override_motivo ? (
                        <span className="block max-w-[14rem] text-[11px] italic text-muted-foreground">
                          “{it.limiar_override_motivo}”
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOverride(it)}>
                        Override
                      </Button>
                    </td>
                  </tr>
                  {expandido ? (
                    <tr>
                      <td colSpan={9} className="bg-muted/20 px-4 py-3">
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Pergunta: </span>
                            {it.pergunta}
                          </p>
                          {it.calibracao?.motivo ? <p className="text-xs">{it.calibracao.motivo}</p> : null}
                          {it.calibrado_em ? (
                            <p className="text-xs text-muted-foreground">Calibrado em {dataHora(it.calibrado_em)}.</p>
                          ) : null}
                          {curva.length > 0 ? (
                            <CurvaPR curva={curva} limiar={it.limiar} />
                          ) : (
                            <p className="text-xs text-muted-foreground">Sem curva: o item ainda não tem amostras suficientes.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <DialogoOverride item={override} onFechar={() => setOverride(null)} />
    </div>
  )
}

/**
 * O limiar só é escrito pela calibração ou por override EXPLÍCITO, com quem e por quê
 * (§5.3). O motivo é obrigatório e fica visível ao lado do limiar, para o próximo
 * gestor não achar que aquele número saiu da curva.
 */
function DialogoOverride({ item, onFechar }: { item: ItemAtivo | null; onFechar: () => void }) {
  const qc = useQueryClient()
  const [limiar, setLimiar] = React.useState('')
  const [motivo, setMotivo] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    if (item) {
      setLimiar(textoDeNumero(item.limiar))
      setMotivo('')
    }
  }, [item])

  async function salvar() {
    if (!item) return
    const n = numeroBr(limiar)
    if (n === null || n <= 0 || n >= 1) return void toast.error('O limiar fica entre 0 e 1 (ex.: 0,62).')
    if (motivo.trim().length < 5) return void toast.error('O override exige o motivo.')
    setEnviando(true)
    const r = await overrideLimiarAction({ item_id: item.id, limiar: n, motivo: motivo.trim() })
    setEnviando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success('Limiar alterado por override.')
    void qc.invalidateQueries({ queryKey: qualidadeGestaoKeys.rubricas() })
    onFechar()
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override do limiar — {item?.rotulo}</DialogTitle>
          <DialogDescription>
            Substitui o limiar da calibração por um escolhido à mão. Fica registrado quem mudou e por quê, e a
            próxima calibração volta a escrever o limiar pela curva.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="override-limiar" className="text-xs">
              Limiar (entre 0 e 1)
            </Label>
            <Input id="override-limiar" inputMode="decimal" value={limiar} onChange={(e) => setLimiar(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-motivo" className="text-xs">
              Motivo (obrigatório)
            </Label>
            <Textarea
              id="override-motivo"
              value={motivo}
              maxLength={500}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: a curva tem só 3 faltas apontadas acima de 0,6; segurar até ter mais amostras."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={enviando} onClick={() => void salvar()}>
            {enviando ? 'Salvando…' : 'Aplicar override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
