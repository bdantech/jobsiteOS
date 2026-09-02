'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bot, Link2Off, Mail, MessageCircle, Search, User } from 'lucide-react'
import { MODO_AGENTE_LABELS, OBJETIVO_LABELS, type ModoAgente, type ObjetivoConversa } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { marcarLidaAction } from '@/actions/comunicacao'
import { Compositor } from './compositor'
import { ProximoPasso } from './proximo-passo'
import { Thread } from './thread'
import {
  buscarConversas,
  contarNaoVinculadas,
  type AbaInbox,
  type ConversaInbox,
} from './queries'
import { desde, identificadorLegivel, intencaoLabel } from './format'

/**
 * O INBOX UNIFICADO (§4).
 *
 * ── DUAS COLUNAS, E A DA ESQUERDA NUNCA SOME ───────────────────────────────
 * Lista à esquerda, conversa à direita. A alternativa (lista → tela cheia da
 * conversa → voltar) faz perder o lugar na fila a cada resposta, e o inbox existe
 * para trabalhar uma fila.
 *
 * ── AS QUATRO ABAS SÃO QUATRO PERGUNTAS ────────────────────────────────────
 *   Não lidas       — o que chegou e ninguém viu.
 *   Minhas          — a minha carteira.
 *   Não vinculadas  — quem falou e não sabemos quem é. Tem tela própria porque a
 *                     ação ali não é responder, é identificar.
 *   Todas           — a visão de quem coordena.
 */
export function Inbox({
  meuVendedorId,
  conversaInicial,
}: {
  meuVendedorId: string | null
  /** Vem do deep link `/comunicacao/<id>` (notificação, push, timeline). */
  conversaInicial?: string
}) {
  const params = useSearchParams()
  const qc = useQueryClient()
  /*
   * Chegar por deep link abre em "Todas": a conversa apontada pode não ser da
   * carteira de quem clicou (um gestor abrindo o link de um alerta), e abrir numa
   * aba que a filtra faria o link parecer quebrado.
   */
  const [aba, setAba] = React.useState<AbaInbox>(
    conversaInicial ? 'todas' : meuVendedorId ? 'minhas' : 'nao_lidas',
  )
  const [canal, setCanal] = React.useState<string>('todos')
  const [busca, setBusca] = React.useState('')
  const [selecionada, setSelecionada] = React.useState<string | null>(
    conversaInicial ?? params.get('conversa'),
  )

  const conversas = useQuery({
    queryKey: ['comunicacao', 'inbox', aba, canal, meuVendedorId],
    queryFn: () =>
      buscarConversas(
        { aba, canal: canal === 'todos' ? undefined : (canal as 'whatsapp' | 'email') },
        meuVendedorId,
      ),
  })

  const pendentes = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'contagem'],
    queryFn: contarNaoVinculadas,
  })

  const lista = React.useMemo(() => {
    const linhas = conversas.data ?? []
    const t = busca.trim().toLowerCase()
    if (!t) return linhas
    return linhas.filter((c) =>
      [c.empresa_nome, c.contato_nome, c.identificador_externo, c.ultima_preview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    )
  }, [conversas.data, busca])

  /*
   * A CONVERSA ABERTA SOBREVIVE A SER LIDA.
   *
   * `atual` saía de `lista.find(...)`, e na aba "Não lidas" isso se autodestruía:
   * abrir marcava como lida, a consulta era invalidada, a linha deixava de casar
   * com `nao_lidas > 0` e sumia da lista — levando junto o painel de leitura. A
   * pessoa clicava numa mensagem e a mensagem fechava na cara dela.
   *
   * Guardar a última encontrada resolve sem mexer no filtro do servidor: a aba
   * continua sendo "o que falta ler", e o que está aberto continua aberto até
   * alguém escolher outra coisa.
   */
  const ultimaAberta = React.useRef<ConversaInbox | null>(null)
  const encontrada = lista.find((c) => c.id === selecionada) ?? null
  if (encontrada) ultimaAberta.current = encontrada
  const atual = encontrada ?? (ultimaAberta.current?.id === selecionada ? ultimaAberta.current : null)

  /*
   * E a LINHA dela também fica. Um painel aberto cuja linha sumiu da lista deixa a
   * seleção sem lugar na tela — a pessoa lê uma conversa que a lista jura não
   * existir. Ela volta a sumir sozinha assim que outra for escolhida.
   */
  const listaExibida = React.useMemo(
    () => (atual && !encontrada ? [atual, ...lista] : lista),
    [atual, encontrada, lista],
  )

  // Abrir uma conversa é lê-la. Deixar o contador aceso depois de a pessoa ter
  // lido faria o inbox mentir sobre o que falta.
  React.useEffect(() => {
    if (!atual || !atual.id || (atual.nao_lidas ?? 0) === 0) return
    void marcarLidaAction({ id: atual.id }).then(() =>
      qc.invalidateQueries({ queryKey: ['comunicacao', 'inbox'] }),
    )
  }, [atual, qc])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={aba} onValueChange={(v) => setAba(v as AbaInbox)}>
          <TabsList>
            <TabsTrigger value="nao_lidas">Não lidas</TabsTrigger>
            <TabsTrigger value="minhas" disabled={!meuVendedorId}>
              Minhas
            </TabsTrigger>
            <TabsTrigger value="todas">Todas</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar no conteúdo"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={canal} onValueChange={setCanal}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os canais</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/*
        A fila de identificação aparece DESTACADA ao logar (§4) e não como uma aba
        discreta: uma mensagem de um decisor que ninguém identificou é a forma mais
        barata de perder um negócio.
      */}
      {(pendentes.data ?? 0) > 0 ? (
        <Link
          href="/comunicacao/nao-vinculadas"
          className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm hover:bg-amber-500/10"
        >
          <Link2Off className="h-4 w-4 text-amber-600" aria-hidden />
          <span className="font-medium">
            {pendentes.data} conversa{pendentes.data === 1 ? '' : 's'} aguardando identificação
          </span>
          <span className="text-muted-foreground">— alguém falou e não sabemos quem é.</span>
        </Link>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border">
          {conversas.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : listaExibida.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {aba === 'nao_lidas' ? 'Nada por ler.' : 'Nenhuma conversa aqui.'}
            </p>
          ) : (
            <ul className="divide-y">
              {listaExibida.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelecionada(c.id)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      selecionada === c.id && 'bg-muted',
                    )}
                  >
                    <LinhaConversa c={c} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 rounded-lg border p-4">
          {atual ? <Conversa c={atual} /> : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Escolha uma conversa à esquerda.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function LinhaConversa({ c }: { c: ConversaInbox }) {
  const Icone = c.canal === 'email' ? Mail : MessageCircle
  const intencao = intencaoLabel(c.ultima_triagem)
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium">
            {c.contato_nome ?? identificadorLegivel(c.canal ?? '', c.identificador_externo ?? '')}
          </span>
          {c.responsavel_is_ia ? <Bot className="h-3 w-3 shrink-0 text-primary" aria-label="Carteira da IA" /> : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{desde(c.ultima_mensagem_em)}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{c.empresa_nome ?? 'Empresa não identificada'}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {c.ultima_por_ia ? '🤖 ' : ''}
          {c.ultima_preview ?? '—'}
        </p>
        {(c.nao_lidas ?? 0) > 0 ? (
          <Badge className="h-4 min-w-4 justify-center px-1 text-[10px]">{c.nao_lidas}</Badge>
        ) : null}
      </div>
      {intencao ? (
        <Badge variant="outline" className="mt-1 h-4 px-1 text-[10px]">
          {intencao}
        </Badge>
      ) : null}
    </>
  )
}

function Conversa({ c }: { c: ConversaInbox }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {c.contato_nome ?? identificadorLegivel(c.canal ?? '', c.identificador_externo ?? '')}
            {c.contato_cargo ? <span className="text-muted-foreground"> — {c.contato_cargo}</span> : null}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {c.empresa_id ? (
              <Link href={`/empresas/${c.empresa_id}`} className="hover:underline">
                {c.empresa_nome ?? 'Ver empresa'}
              </Link>
            ) : (
              'Empresa não identificada'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.objetivo ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              {OBJETIVO_LABELS[c.objetivo as ObjetivoConversa] ?? c.objetivo}
            </Badge>
          ) : null}
          <Badge variant="outline" className="h-5 gap-1 text-[10px]">
            <Bot className="h-3 w-3" aria-hidden />
            {MODO_AGENTE_LABELS[(c.modo_agente ?? '') as ModoAgente] ?? c.modo_agente}
          </Badge>
          {c.responsavel_nome ? (
            <Badge variant="outline" className="h-5 gap-1 text-[10px]">
              <User className="h-3 w-3" aria-hidden />
              {c.responsavel_nome}
            </Badge>
          ) : null}
        </div>
      </div>

      {c.sugestao_id ? (
        <ProximoPasso
          sugestaoId={c.sugestao_id}
          acao={c.sugestao_acao}
          conteudo={c.sugestao_conteudo}
          justificativa={c.sugestao_justificativa}
          confianca={c.sugestao_confianca}
        />
      ) : null}

      <Thread conversaId={c.id} />

      {c.empresa_id ? (
        <Compositor empresaId={c.empresa_id} contatoIdInicial={c.contato_id} />
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Esta conversa ainda não está vinculada a uma empresa.{' '}
          <Link href="/comunicacao/nao-vinculadas" className="underline">
            Identificar
          </Link>
        </p>
      )}
    </div>
  )
}
