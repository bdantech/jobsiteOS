'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Loader2, Mic, MicOff, Radio } from 'lucide-react'
import {
  CAPTURA_STATUS_LABELS,
  MOTIVO_DISPENSA_LABELS,
  RESGATE_JANELA_MIN,
  RESGATE_LIMITE,
  estadoResgate,
  type CapturaStatus,
  type ReuniaoCaptura,
} from '@jobsiteos/core'
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
import { chamarBotAction, dispensarCapturaAction } from '@/actions/qualidade'
import { AnaliseModal, Participantes, ProximosPassos, duracaoLegivel } from './analise-modal'
import { NotaBadge } from './nota'
import { buscarCaptura, qualidadeKeys } from './queries'
import { TranscricaoComBusca } from './transcricao'

/**
 * A GRAVAÇÃO DA REUNIÃO, dentro da aba Reunião (05C §1, §6).
 *
 * ─── ANTES, DURANTE E DEPOIS ────────────────────────────────────────────────
 * A mesma seção responde três perguntas em três momentos. ANTES: "esta reunião vai ser
 * gravada?" — e a porta para dizer que não. DURANTE: "o gravador entrou?" — e o resgate
 * quando não entrou. DEPOIS: o que foi dito, o que ficou combinado e a análise.
 *
 * ─── O GRAVADOR QUE NÃO ENTROU NÃO PODE SER SILENCIOSO ──────────────────────
 * Sem o alerta, a falha de captura só aparece quando alguém procura a transcrição e não
 * acha — dias depois, sem conserto. Com ele, aparece enquanto a reunião ainda está
 * acontecendo, que é o único momento em que o "Chamar o bot agora" resolve.
 *
 * ─── O LIMITE DO FIREFLIES É DA CONTA, NÃO DA REUNIÃO ───────────────────────
 * São 3 resgates a cada 20 minutos para a conta central inteira. A tela mostra quantos
 * já foram usados e quando abre a próxima vaga, em vez de deixar a pessoa apertar e
 * receber um erro críptico do lado deles.
 */

const MOTIVOS_DA_PESSOA = ['nao_gravar', 'reuniao_interna', 'cliente_nao_autorizou'] as const
type MotivoDaPessoa = (typeof MOTIVOS_DA_PESSOA)[number]

const ESPERANDO_GRAVADOR: CapturaStatus[] = ['agendada', 'bot_entrou', 'sem_captura']

const TOM_STATUS: Record<CapturaStatus, 'info' | 'success' | 'warning' | 'neutral' | 'critical'> = {
  agendada: 'neutral',
  bot_entrou: 'info',
  transcrita: 'success',
  sem_captura: 'critical',
  dispensada: 'neutral',
}

const hora = (d: Date | string) =>
  new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** O relógio da tela: a janela do resgate abre e fecha sem ninguém recarregar. */
function useAgora(intervaloMs: number): number {
  const [agora, setAgora] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs])
  return agora
}

export function CapturaReuniao({ eventoId }: { eventoId: string }) {
  const agora = useAgora(15_000)
  const consulta = useQuery({
    queryKey: qualidadeKeys.captura(eventoId),
    queryFn: () => buscarCaptura(eventoId),
    // Durante a reunião o estado muda por webhook (o bot entrou, a fila andou): relê
    // de tempos em tempos. Fora dela, nada muda sozinho em minutos.
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d) return false
      const inicio = new Date(d.evento.inicio_em).getTime()
      const fim = inicio + d.evento.duracao_min * 60_000
      const agoraMs = Date.now()
      return agoraMs >= inicio - 15 * 60_000 && agoraMs <= fim + 60 * 60_000 ? 30_000 : false
    },
  })

  if (consulta.isLoading) {
    return (
      <section className="space-y-2 border-t pt-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
      </section>
    )
  }
  const d = consulta.data
  // Nulo = a RPC não deixou ver. A aba Reunião já disse o que havia para dizer.
  if (!d) return null

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Gravação e análise da reunião">
      <Corpo d={d} eventoId={eventoId} agora={agora} />
    </section>
  )
}

function Titulo({ children, status }: { children: React.ReactNode; status?: CapturaStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold">{children}</h3>
      {status ? (
        <Badge variant={TOM_STATUS[status]} className="text-[11px]">
          {CAPTURA_STATUS_LABELS[status]}
        </Badge>
      ) : null}
    </div>
  )
}

function Corpo({ d, eventoId, agora }: { d: ReuniaoCaptura; eventoId: string; agora: number }) {
  const r = d.reuniao

  if (!d.captura_ligada || !r) {
    return (
      <>
        <Titulo>Gravação</Titulo>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <MicOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Captura desligada: esta reunião não é gravada nem transcrita pelo Fireflies.
            {!d.captura_ligada ? ' A gravação automática ainda não foi ligada pela gestão.' : ''}
          </span>
        </p>
      </>
    )
  }

  const inicio = new Date(d.evento.inicio_em).getTime()
  const fim = inicio + d.evento.duracao_min * 60_000
  const antes = agora < inicio
  // A mesma janela da RPC: dez minutos antes até o fim marcado.
  const naJanela = agora >= inicio - 10 * 60_000 && agora <= fim
  const transcrita = r.captura_status === 'transcrita' || Boolean(r.transcricao_recebida_em)

  return (
    <>
      <Titulo status={r.captura_status}>Gravação e análise</Titulo>

      {d.evento.cancelado ? (
        <p className="text-xs text-muted-foreground">Reunião cancelada — nada será gravado.</p>
      ) : null}

      {r.captura_status === 'dispensada' ? <Dispensada r={r} /> : null}

      {r.alerta_sem_bot_em && !transcrita && r.captura_status !== 'dispensada' ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>O gravador não entrou na reunião</strong> (alerta às {hora(r.alerta_sem_bot_em)}).
            {naJanela
              ? ' Use "Chamar o bot agora" abaixo enquanto a reunião acontece — depois que ela acaba, não há como recuperar a gravação.'
              : ' Sem gravação, esta reunião não terá transcrição nem análise.'}
          </span>
        </div>
      ) : null}

      {antes && !d.evento.cancelado && (r.captura_status === 'agendada' || r.captura_status === 'dispensada') ? (
        <NaoGravar d={d} eventoId={eventoId} />
      ) : null}

      {naJanela && !d.evento.cancelado && ESPERANDO_GRAVADOR.includes(r.captura_status) ? (
        <Resgate d={d} eventoId={eventoId} agora={agora} />
      ) : null}

      {r.captura_status === 'bot_entrou' && r.bot_entrou_em ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Radio className="h-3.5 w-3.5 text-sky-600" aria-hidden />
          Gravador na reunião desde {hora(r.bot_entrou_em)}. A transcrição chega alguns minutos depois do fim.
        </p>
      ) : null}

      {transcrita ? <Depois d={d} /> : null}
    </>
  )
}

function Dispensada({ r }: { r: NonNullable<ReuniaoCaptura['reuniao']> }) {
  const motivo = r.dispensada_motivo ? (MOTIVO_DISPENSA_LABELS[r.dispensada_motivo] ?? r.dispensada_motivo) : null
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <MicOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Esta reunião não será gravada{motivo ? `: ${motivo.toLowerCase()}` : ''}.</span>
    </p>
  )
}

/**
 * "Não gravar esta reunião" — e a volta. Só antes de começar: depois que o gravador
 * entrou, a gravação já existe e dispensá-la seria fingir que não.
 */
function NaoGravar({ d, eventoId }: { d: ReuniaoCaptura; eventoId: string }) {
  const qc = useQueryClient()
  const r = d.reuniao!
  const [motivo, setMotivo] = React.useState<MotivoDaPessoa>('nao_gravar')
  const [salvando, setSalvando] = React.useState(false)
  const dispensada = r.captura_status === 'dispensada'
  // Dispensa automática (sem link, captura desligada para a pessoa) não se desfaz daqui:
  // a causa está em outro lugar, e "voltar a gravar" só daria erro.
  const podeVoltar = dispensada && (MOTIVOS_DA_PESSOA as readonly string[]).includes(r.dispensada_motivo ?? '')

  async function mudar(dispensar: boolean) {
    setSalvando(true)
    const res = await dispensarCapturaAction({ evento_id: eventoId, dispensar, motivo: dispensar ? motivo : undefined })
    setSalvando(false)
    if (!res.ok) return void toast.error(res.message)
    toast.success(dispensar ? 'Esta reunião não será gravada.' : 'A reunião volta a ser gravada.')
    await qc.invalidateQueries({ queryKey: qualidadeKeys.captura(eventoId) })
  }

  if (dispensada && !podeVoltar) return null

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      {dispensada ? (
        <Button size="sm" variant="outline" onClick={() => void mudar(false)} disabled={salvando}>
          {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mic className="mr-1 h-3.5 w-3.5" aria-hidden />}
          Voltar a gravar
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoDaPessoa)}>
            <SelectTrigger className="h-8 w-56 text-xs" aria-label="Motivo para não gravar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTIVOS_DA_PESSOA.map((m) => (
                <SelectItem key={m} value={m}>
                  {MOTIVO_DISPENSA_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => void mudar(true)} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <MicOff className="mr-1 h-3.5 w-3.5" aria-hidden />}
            Não gravar esta reunião
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        A mudança reenvia o convite do Google Agenda: o gravador do Fireflies sai (ou volta) da
        lista de convidados, e é isso que decide se ele entra na reunião.
      </p>
    </div>
  )
}

function Resgate({ d, eventoId, agora }: { d: ReuniaoCaptura; eventoId: string; agora: number }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState(false)
  const estado = estadoResgate(d.resgate.enviados.map((s) => new Date(s)), new Date(agora))
  const ultimo = d.resgate.ultimo

  if (!d.evento.meet_url) {
    return (
      <p className="text-xs text-muted-foreground">
        Sem link de conferência, não há onde chamar o gravador.
      </p>
    )
  }

  async function chamar() {
    setEnviando(true)
    const r = await chamarBotAction({ evento_id: eventoId })
    setEnviando(false)
    if (!r.ok) return void toast.error(r.message)
    toast.success(
      r.data.ja_na_fila
        ? 'O pedido já estava na fila — o gravador é chamado assim que houver vaga.'
        : 'Pedido enviado. O gravador deve entrar em instantes.',
    )
    await qc.invalidateQueries({ queryKey: qualidadeKeys.captura(eventoId) })
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void chamar()}
          disabled={enviando || !estado.disponivel || d.resgate.na_fila}
        >
          {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Mic className="mr-1 h-3.5 w-3.5" aria-hidden />}
          Chamar o bot agora
        </Button>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {estado.usados} de {RESGATE_LIMITE} resgates usados nos últimos {RESGATE_JANELA_MIN} minutos
        </span>
      </div>
      {!estado.disponivel && estado.proximo_em ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Próximo resgate disponível às {hora(estado.proximo_em)} — o Fireflies aceita só {RESGATE_LIMITE} a
          cada {RESGATE_JANELA_MIN} minutos para a conta inteira.
        </p>
      ) : null}
      {d.resgate.na_fila ? (
        <p className="text-[11px] text-muted-foreground">
          Pedido na fila: o gravador é chamado assim que houver vaga.
        </p>
      ) : null}
      {ultimo ? (
        <p className="text-[11px] text-muted-foreground">
          Último pedido às {hora(ultimo.pedido_em)}: {STATUS_RESGATE[ultimo.status] ?? ultimo.status}
          {ultimo.erro ? <span className="text-destructive"> — {ultimo.erro}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

const STATUS_RESGATE: Record<string, string> = {
  na_fila: 'na fila',
  enviado: 'enviado ao Fireflies',
  falhou: 'falhou',
  cancelado: 'cancelado',
}

function Depois({ d }: { d: ReuniaoCaptura }) {
  const r = d.reuniao!
  const [modal, setModal] = React.useState(false)
  const a = d.analise

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {duracaoLegivel(r.duracao_s) ? (
          <span>
            <span className="text-muted-foreground">Duração: </span>
            {duracaoLegivel(r.duracao_s)}
          </span>
        ) : null}
        {r.url_fireflies ? (
          <Button size="sm" variant="outline" className="h-7" asChild>
            <a href={r.url_fireflies} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
              Abrir no Fireflies
            </a>
          </Button>
        ) : null}
      </div>

      <Participantes lista={r.participantes} />

      {/* A análise logo depois de quem participou: é a pergunta que traz a pessoa aqui. */}
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <p className="text-xs font-medium">Análise da reunião</p>
        {a ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <NotaBadge
                score={a.modo === 'sombra' ? a.score_sombra : a.score}
                analiseId={a.id}
                prefixo={a.modo === 'sombra' ? 'Nota que seria' : 'Nota'}
              />
              {a.modo === 'sombra' ? (
                <Badge variant="outline" className="text-[10px]">
                  Em sombra (rubrica não calibrada) — o vendedor não vê
                </Badge>
              ) : null}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setModal(true)}>
                Ver item a item
              </Button>
            </div>
            {a.explicacao ? <p className="text-xs">{a.explicacao}</p> : null}
            {modal ? <AnaliseModal analiseId={a.id} aberto={modal} onOpenChange={setModal} /> : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            A análise ainda não saiu — ela roda alguns minutos depois da transcrição.
          </p>
        )}
      </div>

      {r.resumo ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">
            Resumo{' '}
            <span className="font-normal text-muted-foreground">
              ({r.resumo_origem === 'claude' ? 'gerado pelo Claude a partir da transcrição' : 'do Fireflies'})
            </span>
          </p>
          <p className="whitespace-pre-wrap text-xs">{r.resumo}</p>
        </div>
      ) : null}

      <ProximosPassos passos={r.proximos_passos} />

      {r.transcricao_expurgada_em ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          A transcrição foi apagada em{' '}
          {new Date(r.transcricao_expurgada_em).toLocaleDateString('pt-BR')} pela política de
          retenção. A análise continua valendo — ela guarda as citações em que se apoiou.
        </p>
      ) : r.transcricao || (r.segmentos && r.segmentos.length > 0) ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Transcrição</p>
          <TranscricaoComBusca segmentos={r.segmentos} texto={r.transcricao} />
        </div>
      ) : null}
    </div>
  )
}
