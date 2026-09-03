'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Bot,
  EyeOff,
  Link2Off,
  Mail,
  MessageCircle,
  Search,
  Smartphone,
  Undo2,
  User,
} from 'lucide-react'
import { MODO_AGENTE_LABELS, OBJETIVO_LABELS, type ModoAgente, type ObjetivoConversa } from '@jobsiteos/core'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { marcarLidaAction, ocultarConversaAction, reexibirConversaAction } from '@/actions/comunicacao'
import { Compositor } from './compositor'
import { ProximoPasso } from './proximo-passo'
import { Thread } from './thread'
import {
  buscarConversas,
  buscarOcultas,
  buscarResponsaveisInbox,
  contarNaoVinculadas,
  type AbaInbox,
  type ConversaInbox,
  type ConversaOculta,
} from './queries'
import { desde, identificadorLegivel, intencaoLabel } from './format'

/**
 * COMO CHAMAR QUEM ESTÁ DO OUTRO LADO, na ordem em que a certeza cai.
 *
 * O contato oficial primeiro, porque foi conferido por gente. Depois o `pushName`
 * — o nome que a própria pessoa escolheu no WhatsApp, que o inbox tinha guardado
 * o tempo todo na fila de identificação sem nunca mostrar. Só no fim o
 * identificador, e mesmo esse formatado.
 *
 * A ordem importa mais do que parece: desde que o WhatsApp passou a endereçar por
 * LID, o último recurso é uma sequência de quinze dígitos que não é telefone de
 * ninguém — e uma lista de conversas identificadas assim é uma lista que ninguém
 * consegue ler.
 */
function comoChamar(c: ConversaInbox): string {
  return (
    c.contato_nome ??
    c.nome_sugerido ??
    identificadorLegivel(c.canal ?? '', c.identificador_externo ?? '')
  )
}

/**
 * A INICIAL DE QUEM ATENDE, na lateral de cada linha.
 *
 * Num inbox onde todas as conversas se parecem, a pergunta que se faz varrendo a
 * fila é "isso é meu?". Ela estava respondida só no painel da direita, ou seja,
 * depois de abrir — e abrir marca como lida. A inicial responde antes do clique.
 *
 * A cor sai do NOME e não de uma sequência: o mesmo vendedor tem a mesma cor em
 * qualquer filtro, em qualquer ordem, hoje e amanhã. Uma paleta atribuída por
 * posição na lista trocaria de cor a cada reordenação, que é pior que não ter cor.
 */
const CORES_DONO = [
  'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-200',
] as const

/** Duas letras: a primeira do primeiro nome e a do último. "Rodrigo Alves" → RA. */
function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  const primeira = partes[0]![0] ?? ''
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : ''
  return (primeira + ultima).toUpperCase()
}

function corDoNome(nome: string): string {
  let soma = 0
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 997
  return CORES_DONO[soma % CORES_DONO.length]!
}

function InicialDoDono({ nome, isIa }: { nome: string | null; isIa: boolean }) {
  /*
   * Sem dono é um ESTADO, não um espaço vazio: é a conversa que ninguém atende, e
   * ela some numa lista onde a ausência é representada por nada. Traço em círculo
   * pontilhado — presente na varredura, e claramente diferente de uma inicial.
   */
  if (!nome) {
    return (
      <span
        title="Sem responsável — ninguém atende esta conversa"
        aria-label="Sem responsável"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed text-[11px] text-muted-foreground"
      >
        —
      </span>
    )
  }
  return (
    <span
      title={isIa ? `${nome} (IA)` : nome}
      aria-label={`Responsável: ${nome}`}
      className={cn(
        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
        corDoNome(nome),
      )}
    >
      {isIa ? <Bot className="h-3.5 w-3.5" aria-hidden /> : iniciaisDe(nome)}
    </span>
  )
}

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
  const [dono, setDono] = React.useState<string>('todos')
  const [busca, setBusca] = React.useState('')
  const [selecionada, setSelecionada] = React.useState<string | null>(
    conversaInicial ?? params.get('conversa'),
  )

  const conversas = useQuery({
    queryKey: ['comunicacao', 'inbox', aba, canal, dono, meuVendedorId],
    queryFn: () =>
      buscarConversas(
        {
          aba,
          canal: canal === 'todos' ? undefined : (canal as 'whatsapp' | 'email'),
          vendedorId: dono === 'todos' ? undefined : dono,
        },
        meuVendedorId,
      ),
  })

  // Os donos que existem no inbox. Fora da chave do filtro de propósito: a lista
  // de opções não pode encolher porque alguém escolheu uma delas.
  const donos = useQuery({
    queryKey: ['comunicacao', 'inbox', 'responsaveis'],
    queryFn: buscarResponsaveisInbox,
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
      // `nome_sugerido` entra na busca porque é por ele que a conversa aparece na
      // lista enquanto ninguém a identificou: procurar por "Marcelo" e não achar o
      // "Marcelo" que está na tela é o tipo de defeito que faz abandonar a busca.
      [c.empresa_nome, c.contato_nome, c.nome_sugerido, c.identificador_externo, c.ultima_preview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    )
  }, [conversas.data, busca])

  const ocultas = useQuery({ queryKey: ['comunicacao', 'ocultas'], queryFn: buscarOcultas })

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
          {/*
            O filtro por dono convive com a aba "Minhas" em vez de substituí-la:
            "Minhas" é um clique para a pergunta que se faz o dia inteiro, e este
            select é para a de quem coordena — "como está a fila do Fabio?".
          */}
          <Select value={dono} onValueChange={setDono}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              {(donos.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nome}
                </SelectItem>
              ))}
              <SelectItem value="sem_dono">Sem responsável</SelectItem>
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

      {(ocultas.data?.length ?? 0) > 0 ? (
        <ListaOcultas
          linhas={ocultas.data ?? []}
          onMudou={() => void qc.invalidateQueries({ queryKey: ['comunicacao'] })}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border bg-card">
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

        <div className="min-w-0 rounded-lg border bg-card p-4">
          {atual ? (
            <Conversa
              c={atual}
              onOcultada={() => {
                setSelecionada(null)
                ultimaAberta.current = null
                void qc.invalidateQueries({ queryKey: ['comunicacao'] })
              }}
            />
          ) : (
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
    <div className="flex gap-2">
      <InicialDoDono nome={c.responsavel_nome} isIa={c.responsavel_is_ia === true} />
      <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium" title={c.identificador_externo ?? undefined}>
            {comoChamar(c)}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{desde(c.ultima_mensagem_em)}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{c.empresa_nome ?? 'Empresa não identificada'}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {/*
          A última mensagem saiu do aparelho? Um ícone, e não uma linha a mais: o
          que a pessoa precisa saber ao varrer a fila é que ALGUÉM já respondeu —
          por onde foi é detalhe da bolha.
        */}
        {c.ultima_origem === 'celular' ? (
          <Smartphone className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Respondida pelo celular" />
        ) : null}
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
      </div>
    </div>
  )
}

function Conversa({ c, onOcultada }: { c: ConversaInbox; onOcultada: () => void }) {
  const [ocultando, setOcultando] = React.useState(false)

  async function ocultar() {
    if (!c.id) return
    setOcultando(true)
    const r = await ocultarConversaAction({ conversa_id: c.id })
    setOcultando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Conversa ocultada — só para você.', {
      description: 'Ela continua no inbox do resto do time. Para trazê-la de volta, use "Ocultas" no topo.',
    })
    onOcultada()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {comoChamar(c)}
            {c.contato_cargo ? <span className="text-muted-foreground"> — {c.contato_cargo}</span> : null}
          </p>
          {/*
            O identificador embaixo do nome, sempre — é o que a pessoa confere
            antes de responder, e num inbox de WhatsApp confundir dois "Marcelo"
            custa caro. Quando o provedor não mandou número, dizer isso é mais
            honesto que exibir o LID como se fosse um telefone.
          */}
          <p className="truncate text-xs text-muted-foreground">
            {identificadorLegivel(c.canal ?? '', c.identificador_externo ?? '')}
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
          {/*
            Ocultar fica AQUI e não na linha da lista: é uma decisão sobre uma
            conversa que a pessoa acabou de ler, não um botão para varrer a fila
            sem olhar. E é reversível — o bloco "Ocultas" no topo traz de volta.
          */}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={ocultando}
            onClick={() => void ocultar()}
          >
            <EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden />
            Ocultar
          </Button>
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

/**
 * O QUE EU CALEI — e como desfazer.
 *
 * Existe porque a ocultação é de verdade: a policy do banco esconde a conversa,
 * e sem esta lista a pessoa não teria caminho de volta. "Ocultar" viraria
 * "apagar", que é a diferença entre uma preferência e um estrago.
 *
 * Fica recolhido por padrão. Uma lista de coisas que alguém pediu para não ver,
 * aberta no topo do inbox, é a negação do próprio pedido.
 */
function ListaOcultas({
  linhas,
  onMudou,
}: {
  linhas: ConversaOculta[]
  onMudou: () => void
}) {
  const [aberto, setAberto] = React.useState(false)

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">
          {linhas.length} conversa{linhas.length === 1 ? '' : 's'} oculta{linhas.length === 1 ? '' : 's'}
        </span>
        <span className="text-muted-foreground">
          — só para você. O time continua vendo.
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{aberto ? 'recolher' : 'ver'}</span>
      </button>

      {aberto ? (
        <ul className="divide-y border-t">
          {linhas.map((o) => (
            <li key={o.conversa_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {o.contato_nome ?? identificadorLegivel(o.canal, o.identificador_externo)}
                {o.empresa_nome ? (
                  <span className="text-muted-foreground"> — {o.empresa_nome}</span>
                ) : null}
                {o.motivo ? <span className="text-muted-foreground"> · {o.motivo}</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {desde(o.ultima_mensagem_em)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={async () => {
                  const r = await reexibirConversaAction({ conversa_id: o.conversa_id })
                  if (!r.ok) {
                    toast.error(r.message)
                    return
                  }
                  onMudou()
                }}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                Mostrar de novo
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
