'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  ESTADOS_MANDATO,
  ESTADOS_TERMINAIS,
  TIPOS_MANDATO,
  TIPO_MANDATO_LABELS,
  type EstadoMandato,
} from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CabecalhoDaColuna,
  CardDoFunil,
  ChipDoCard,
  ColunaVazia,
  DonoNoRodape,
  TiraDoCard,
} from '@/components/comercial/card-funil'
import { daqui, dataHora, estadoLabel, motivoLabel, pct, reais, tipoLabel } from './format'
import { MandatoModal } from './mandato-modal'
import { useParamDaUrl } from './mandato-url'
import { PropostasPendentes } from './propostas-pendentes'
import {
  agentesOpKeys,
  buscarMandatosKanban,
  LIMITE_TERMINAIS,
  nomeDaEmpresa,
  personaDoAgente,
  useAgentes,
  useAgentesRealtime,
  usePermissoesAgentes,
  type MandatoDoKanban,
} from './queries-operacao'

/**
 * Mandatos (§11.2): as propostas aguardando aprovação no topo e o kanban por estado.
 *
 * Mesmo shell de card dos funis do Comercial (`CardDoFunil`): quem trabalha nos dois lê a
 * mesma hierarquia — de quem é, o que vale, o que está correndo.
 *
 * ─── SEM ARRASTAR ───────────────────────────────────────────────────────────
 * O estado de um mandato é consequência do que o agente faz (em andamento, aguardando
 * retorno, concluído) ou de uma ação humana com efeito colateral (assumir passa as
 * conversas a uma pessoa; encerrar grava motivo). Arrastar ofereceria pular o efeito.
 * As ações humanas moram no modal, que é onde está o contexto para tomá-las.
 *
 * ─── AS COLUNAS TERMINAIS ───────────────────────────────────────────────────
 * Concluído, encerrado e "com um humano" começam recolhidas e mostram os 30 mais
 * recentes: são o histórico, não a fila de trabalho. Abertas, ajudam a responder "o que
 * aconteceu com aquele mandato de ontem?" — que é para isso que existem.
 */

const FAIXAS_PRIORIDADE = [
  { id: 'alta', rotulo: 'Prioridade alta (70+)', de: 70, ate: 100 },
  { id: 'media', rotulo: 'Prioridade média (40–69)', de: 40, ate: 69 },
  { id: 'baixa', rotulo: 'Prioridade baixa (<40)', de: 0, ate: 39 },
] as const

export function MandatosKanban() {
  const [mandatoAberto, setMandatoAberto] = useParamDaUrl('m')
  const [proposta] = useParamDaUrl('proposta')
  useAgentesRealtime('mandatos')

  const permissoes = usePermissoesAgentes()
  const agentes = useAgentes()
  const mandatos = useQuery({ queryKey: agentesOpKeys.kanban(), queryFn: buscarMandatosKanban, refetchInterval: 60_000 })

  const [agente, setAgente] = React.useState('todos')
  const [tipo, setTipo] = React.useState('todos')
  const [empresa, setEmpresa] = React.useState('')
  const [prioridade, setPrioridade] = React.useState('todas')
  const [abertas, setAbertas] = React.useState<Set<EstadoMandato>>(new Set())

  const nomePor = React.useMemo(
    () => new Map((agentes.data ?? []).map((a) => [a.id, personaDoAgente(a).nome])),
    [agentes.data],
  )

  const todos = React.useMemo(() => mandatos.data ?? [], [mandatos.data])
  const termo = empresa.trim().toLowerCase()
  const faixa = FAIXAS_PRIORIDADE.find((f) => f.id === prioridade)

  const visiveis = todos.filter((m) => {
    if (agente !== 'todos' && m.agente_id !== agente) return false
    if (tipo !== 'todos' && m.tipo !== tipo) return false
    if (faixa && (m.prioridade < faixa.de || m.prioridade > faixa.ate)) return false
    if (termo) {
      const nome = `${m.empresas?.razao_social ?? ''} ${m.empresas?.nome_fantasia ?? ''} ${m.codigo ?? ''}`.toLowerCase()
      if (!nome.includes(termo)) return false
    }
    return true
  })

  const porEstado = new Map<string, MandatoDoKanban[]>()
  for (const m of visiveis) porEstado.set(m.estado, [...(porEstado.get(m.estado) ?? []), m])
  // Na fila de trabalho, o que o ciclo vai pegar primeiro vem primeiro (prioridade, depois
  // a próxima ação mais cedo). Nas terminais, o que terminou por último.
  for (const [estado, lista] of porEstado) {
    if (ESTADOS_TERMINAIS.includes(estado as EstadoMandato)) {
      lista.sort((a, b) => (b.encerrado_em ?? '').localeCompare(a.encerrado_em ?? ''))
    } else {
      lista.sort(
        (a, b) =>
          b.prioridade - a.prioridade ||
          (a.proxima_acao_em ?? '9999').localeCompare(b.proxima_acao_em ?? '9999'),
      )
    }
  }

  function alternar(estado: EstadoMandato) {
    setAbertas((atual) => {
      const nova = new Set(atual)
      if (nova.has(estado)) nova.delete(estado)
      else nova.add(estado)
      return nova
    })
  }

  return (
    <div className="space-y-4">
      <PropostasPendentes
        gestor={permissoes.data?.gestor === true}
        destacada={proposta}
        onAbrirMandato={setMandatoAberto}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mandatos</CardTitle>
          <CardDescription>
            {visiveis.length} de {todos.length} mandato(s). Em curso aparecem todos; as colunas terminais mostram os{' '}
            {LIMITE_TERMINAIS} mais recentes de cada estado.
          </CardDescription>
          <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              placeholder="Empresa ou código (MDT-…)"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              aria-label="Filtrar por empresa"
            />
            <Select value={agente} onValueChange={setAgente}>
              <SelectTrigger aria-label="Agente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os agentes</SelectItem>
                {(agentes.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {personaDoAgente(a).nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger aria-label="Tipo de mandato">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {TIPOS_MANDATO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_MANDATO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={prioridade} onValueChange={setPrioridade}>
              <SelectTrigger aria-label="Prioridade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Qualquer prioridade</SelectItem>
                {FAIXAS_PRIORIDADE.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {mandatos.isPending ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : mandatos.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {mandatos.error instanceof Error ? mandatos.error.message : 'Erro ao carregar os mandatos.'}
              </p>
            </div>
          ) : todos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum mandato ainda.</p>
              <p className="mt-1">
                Mandatos nascem de três jeitos: por regra (Configurações → regras de mandato, que nascem
                desligadas), pelo botão &quot;Delegar ao agente&quot; na empresa, na NF ou no funil comercial, ou
                por proposta de outro mandato aprovada acima.
              </p>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-3">
              {ESTADOS_MANDATO.map((estado) => {
                const itens = porEstado.get(estado) ?? []
                const terminal = ESTADOS_TERMINAIS.includes(estado)
                if (terminal && !abertas.has(estado)) {
                  return (
                    <button
                      key={estado}
                      type="button"
                      onClick={() => alternar(estado)}
                      className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-lg border border-dashed py-3 text-xs text-muted-foreground hover:bg-muted/50"
                      title={`Mostrar ${estadoLabel(estado)}`}
                      aria-label={`Mostrar a coluna ${estadoLabel(estado)} (${itens.length})`}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
                      <span className="font-semibold tabular-nums text-foreground">{itens.length}</span>
                      <span className="[writing-mode:vertical-rl]">{estadoLabel(estado)}</span>
                    </button>
                  )
                }
                return (
                  <div key={estado} className="w-[290px] shrink-0 space-y-3">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <CabecalhoDaColuna titulo={estadoLabel(estado)} total={itens.length} />
                      </div>
                      {terminal ? (
                        <button
                          type="button"
                          onClick={() => alternar(estado)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          aria-label={`Recolher ${estadoLabel(estado)}`}
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      {itens.map((m) => (
                        <CardDoMandato
                          key={m.id}
                          m={m}
                          agente={nomePor.get(m.agente_id) ?? null}
                          onAbrir={() => setMandatoAberto(m.id)}
                        />
                      ))}
                      {itens.length === 0 && <ColunaVazia>Nenhum mandato</ColunaVazia>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <MandatoModal mandatoId={mandatoAberto} onFechar={() => setMandatoAberto(null)} />
    </div>
  )
}

/**
 * O card do mandato. A barra é o GASTO contra o orçamento — é o limite que encerra mais
 * mandatos em silêncio. A tira responde "o que vem agora": a próxima ação do plano com a
 * hora, ou o motivo, quando terminou ou está pausado.
 */
function CardDoMandato({
  m,
  agente,
  onAbrir,
}: {
  m: MandatoDoKanban
  agente: string | null
  onAbrir: () => void
}) {
  const terminal = ESTADOS_TERMINAIS.includes(m.estado as EstadoMandato)
  const gasto = pct(m.gasto_centavos, m.orcamento_centavos)

  return (
    <CardDoFunil
      rotuloAbrir={`Abrir mandato ${m.codigo ?? ''} de ${nomeDaEmpresa(m.empresas)}`}
      onAbrir={onAbrir}
      esmaecido={terminal}
      titulo={nomeDaEmpresa(m.empresas)}
      valor={
        <span className="line-clamp-2 text-[12px] font-normal text-muted-foreground" title={m.objetivo}>
          {m.objetivo}
        </span>
      }
      chips={
        <>
          <ChipDoCard forte>{m.codigo ?? '—'}</ChipDoCard>
          <ChipDoCard tom="info">{tipoLabel(m.tipo)}</ChipDoCard>
          {m.prioridade >= 70 ? <ChipDoCard tom="alerta">Prioridade {m.prioridade}</ChipDoCard> : null}
          {m.origem === 'escalonamento' ? <ChipDoCard>Por proposta</ChipDoCard> : null}
        </>
      }
      barra={{ pct: gasto, tom: gasto >= 95 ? 'ruim' : gasto >= 80 ? 'alerta' : 'bom' }}
      rodapeEsquerda={<DonoNoRodape nome={agente} />}
      rodapeDireita={
        <span title="Gasto / orçamento · ações / máximo">
          {reais(m.gasto_centavos)} / {reais(m.orcamento_centavos)} · {m.acoes_executadas}/{m.max_acoes}
        </span>
      }
      tira={<TiraDoMandato m={m} terminal={terminal} />}
    />
  )
}

function TiraDoMandato({ m, terminal }: { m: MandatoDoKanban; terminal: boolean }) {
  if (terminal) {
    const motivo = motivoLabel(m.motivo_encerramento)
    return (
      <TiraDoCard tom={m.estado === 'concluido' ? 'bom' : m.estado === 'escalado' ? 'alerta' : 'neutro'}>
        {motivo ?? estadoLabel(m.estado)}
        {m.encerrado_em ? ` · ${dataHora(m.encerrado_em)}` : ''}
      </TiraDoCard>
    )
  }
  if (m.estado === 'pausado') {
    return <TiraDoCard tom="alerta">Pausado{m.pausado_motivo ? ` · ${PAUSA[m.pausado_motivo] ?? m.pausado_motivo}` : ''}</TiraDoCard>
  }
  if (m.proxima_acao_em) {
    return (
      <TiraDoCard tom="neutro">
        Próxima ação {daqui(m.proxima_acao_em)} <span className="font-normal">({dataHora(m.proxima_acao_em)})</span>
      </TiraDoCard>
    )
  }
  return null
}

const PAUSA: Record<string, string> = {
  orcamento_esgotado: 'orçamento esgotado',
  disjuntor_aberto: 'disjuntor aberto',
  agente_pausado: 'agente pausado',
  manual: 'por uma pessoa',
}
