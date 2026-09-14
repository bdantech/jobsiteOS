'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Users,
  Video,
} from 'lucide-react'
import { MODALIDADE_REUNIAO_LABELS, type ModalidadeReuniao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { salvarReuniaoAction } from '@/actions/comercial'
import { buscarContatos } from '@/components/comunicacao/queries'
import { buscarReuniaoDoCard, comercialKeys, type ReuniaoDoCard } from './queries'

/**
 * A aba Reunião, nos dois funis.
 *
 * ─── POR QUE ELA PRECISA EXISTIR ────────────────────────────────────────────
 * Antes disto, "quando é a reunião" era uma linha de texto na aba Lead e mais
 * nada. Onde ela é, por qual link, quem foi convidado e se o cliente confirmou
 * não moravam em lugar nenhum — cada um desses dados vivia num WhatsApp, num
 * e-mail, ou na cabeça de quem marcou. Quem abria o card meia hora antes da
 * reunião não tinha como entrar nela pela plataforma.
 *
 * ─── ELA MOSTRA O ESTADO DA SINCRONIZAÇÃO, E ISSO NÃO É DETALHE TÉCNICO ────
 * A reclamação que originou tudo isto foi "não apareceu no Google Agenda". Uma
 * aba que mostrasse a reunião bonitinha e ficasse muda sobre o Google deixaria
 * essa pergunta exatamente onde ela estava. As três causas são diferentes e se
 * resolvem em lugares diferentes — ainda na fila, falhou por um motivo, ou o
 * anfitrião nunca conectou o Google — e a aba diz qual é.
 */

const MODALIDADES: ModalidadeReuniao[] = ['meet', 'presencial', 'telefone']

function quandoLegivel(iso: string): { data: string; distancia: string; passou: boolean } {
  const d = new Date(iso)
  const ms = d.getTime() - Date.now()
  const passou = ms < 0
  const abs = Math.abs(ms)
  const min = Math.round(abs / 60_000)
  const hora = Math.round(abs / 3_600_000)
  const dia = Math.round(abs / 86_400_000)
  const quanto = min < 60 ? `${min} min` : hora < 36 ? `${hora} h` : `${dia} dias`
  return {
    data: d.toLocaleString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    distancia: passou ? `há ${quanto}` : `em ${quanto}`,
    passou,
  }
}

/** `datetime-local` quer a hora LOCAL sem fuso; o ISO do banco vem em UTC. */
function paraInputLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface AbaReuniaoProps {
  vendaId?: string | null
  sdrLeadId?: string | null
  empresaId: string | null
}

export function AbaReuniao({ vendaId, sdrLeadId, empresaId }: AbaReuniaoProps) {
  const qc = useQueryClient()
  const chave = vendaId ?? sdrLeadId ?? 'nenhum'
  const [editando, setEditando] = React.useState(false)

  const reuniao = useQuery({
    queryKey: comercialKeys.reuniao(chave),
    queryFn: () => buscarReuniaoDoCard({ vendaId, sdrLeadId }),
    enabled: Boolean(vendaId || sdrLeadId),
  })

  if (reuniao.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  const r = reuniao.data
  if (!r) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Nenhuma reunião marcada neste card. Ela aparece aqui assim que o funil de reuniões
        agendar uma — com o horário, o link e quem foi convidado.
      </p>
    )
  }

  async function recarregar() {
    await qc.invalidateQueries({ queryKey: comercialKeys.reuniao(chave) })
    await qc.invalidateQueries({ queryKey: ['comercial', 'agenda'] })
  }

  return (
    <div className="space-y-4">
      <Cabecalho r={r} />
      <Onde r={r} />
      <Convidados r={r} />
      <EstadoDoGoogle r={r} />

      {editando ? (
        <FormularioReuniao
          r={r}
          empresaId={empresaId}
          aoFechar={() => setEditando(false)}
          aoSalvar={recarregar}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Editar reunião
          </Button>
          <CancelarReuniao r={r} aoCancelar={recarregar} />
        </div>
      )}
    </div>
  )
}

function Cabecalho({ r }: { r: ReuniaoDoCard }) {
  const q = quandoLegivel(r.inicio_em)
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-base font-semibold capitalize tabular-nums">{q.data}</span>
      <span className={cn('text-xs', q.passou ? 'text-muted-foreground' : 'text-foreground')}>
        {q.distancia} · {r.duracao_min} min
      </span>
      {/* Reunião no passado que ninguém marcou como realizada nem como no-show é
          uma pendência, e o card não pode deixá-la parecida com uma futura. */}
      {q.passou ? (
        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
          já passou
        </Badge>
      ) : null}
    </div>
  )
}

function Onde({ r }: { r: ReuniaoDoCard }) {
  const [copiado, setCopiado] = React.useState(false)
  const modalidade = MODALIDADE_REUNIAO_LABELS[r.modalidade as ModalidadeReuniao] ?? r.modalidade

  if (r.modalidade === 'meet') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <Video className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="font-medium">{modalidade}</span>
        </div>
        {r.meet_url ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="truncate rounded bg-muted px-2 py-1 text-xs">{r.meet_url}</code>
            <Button size="sm" variant="outline" className="h-7" asChild>
              <a href={r.meet_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                Entrar
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={async () => {
                await navigator.clipboard.writeText(r.meet_url ?? '')
                setCopiado(true)
                setTimeout(() => setCopiado(false), 1500)
              }}
            >
              {copiado ? (
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
              )}
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        ) : (
          /* A sala nasce no Google, junto com o evento. Sem link aqui, o que falta
             é a sincronização — e o bloco do Google logo abaixo diz o motivo. */
          <p className="text-xs text-muted-foreground">
            A sala ainda não foi criada — ela nasce junto com o evento no Google Agenda.
          </p>
        )}
      </div>
    )
  }

  if (r.modalidade === 'a_definir') {
    return (
      <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <span>
          Onde esta reunião acontece ainda não foi definido — ela foi marcada antes de a
          plataforma perguntar isso. Editando e escolhendo <strong>Google Meet</strong>, a sala é
          criada e o convite sai para quem estiver na lista.
        </span>
      </p>
    )
  }

  return (
    <div className="flex items-start gap-2 text-sm">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <span className="font-medium">{modalidade}</span>
        {r.local ? <p className="text-muted-foreground">{r.local}</p> : null}
      </div>
    </div>
  )
}

function Convidados({ r }: { r: ReuniaoDoCard }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
        Participantes
      </div>
      <ul className="space-y-1 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          <span>{r.anfitriao.nome}</span>
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
            anfitrião
          </Badge>
        </li>
        {r.acompanhantes.map((a) => (
          <li key={a.vendedor_id} className="flex flex-wrap items-center gap-2">
            <span>{a.nome}</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
              acompanha
            </Badge>
          </li>
        ))}
        {r.participantes.map((p) => (
          <li key={p.email} className="flex flex-wrap items-center gap-2">
            <span>{p.nome || p.email}</span>
            <span className="text-xs text-muted-foreground">{p.email}</span>
            <Badge
              variant="outline"
              className="border-sky-500/40 px-1.5 py-0 text-[10px] font-normal text-sky-700 dark:text-sky-300"
            >
              cliente
            </Badge>
          </li>
        ))}
      </ul>
      {r.participantes.length === 0 ? (
        /* O ponto do pedido era convidar o cliente pela plataforma. Uma reunião sem
           ninguém do lado de lá é uma reunião que o cliente não sabe que tem. */
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Ninguém do cliente foi convidado — edite para escolher quem recebe o convite do
          Google com o link.
        </p>
      ) : null}
    </div>
  )
}

/**
 * O bloco que responde "por que não está no meu Google Agenda".
 *
 * Quatro estados, e cada um aponta para um lugar diferente: conectar o Google,
 * reconectar (o consentimento antigo não tinha agenda), esperar a fila, ou ler o
 * erro. Um bloco genérico de "erro de sincronização" serviria para nenhum deles.
 */
function EstadoDoGoogle({ r }: { r: ReuniaoDoCard }) {
  const g = r.google

  const base = 'flex items-start gap-2 rounded-md border p-3 text-xs'

  if (!g.conta) {
    return (
      <p className={cn(base, 'border-dashed text-muted-foreground')}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        <span>
          <strong>{r.anfitriao.nome}</strong> não conectou o Google, então esta reunião existe só
          no calendário interno. Conectando em <strong>Comunicação › Configurações</strong>, ela vai
          para o Google Agenda com sala do Meet e convite para o cliente.
        </span>
      </p>
    )
  }

  if (!g.tem_escopo_agenda) {
    return (
      <p className={cn(base, 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200')}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          A conexão de <strong>{g.conta}</strong> é anterior à integração de agenda e não inclui a
          permissão de calendário. Reconectar em <strong>Comunicação › Configurações</strong> é o que
          falta — o e-mail continua funcionando enquanto isso.
        </span>
      </p>
    )
  }

  if (g.erro) {
    return (
      <p className={cn(base, 'border-destructive/40 bg-destructive/5 text-destructive')}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{g.erro}</span>
      </p>
    )
  }

  if (g.pendente) {
    return (
      <p className={cn(base, 'border-dashed text-muted-foreground')}>
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        <span>Indo para o Google Agenda de {g.conta}. Leva alguns segundos.</span>
      </p>
    )
  }

  if (g.evento_id) {
    return (
      <p className={cn(base, 'border-emerald-500/40 text-emerald-800 dark:text-emerald-300')}>
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          No Google Agenda de {g.conta}
          {g.sincronizado_em
            ? ` desde ${new Date(g.sincronizado_em).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : ''}
          . Os convidados receberam o convite por e-mail.
        </span>
      </p>
    )
  }

  return (
    <p className={cn(base, 'border-dashed text-muted-foreground')}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Ainda não foi para o Google Agenda. Salvar a reunião a põe na fila.</span>
    </p>
  )
}

function CancelarReuniao({ r, aoCancelar }: { r: ReuniaoDoCard; aoCancelar: () => Promise<void> }) {
  const [confirmando, setConfirmando] = React.useState(false)
  const [indo, setIndo] = React.useState(false)

  if (!confirmando) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirmando(true)}>
        Cancelar reunião
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {/* O cancelamento avisa quem foi convidado — é metade do motivo de
            cancelar por aqui em vez de apagar da agenda à mão. */}
        Avisa os convidados pelo Google. Confirma?
      </span>
      <Button
        size="sm"
        variant="destructive"
        disabled={indo}
        onClick={async () => {
          setIndo(true)
          const res = await salvarReuniaoAction({ id: r.id, cancelar: true })
          setIndo(false)
          if (!res.ok) return toast.error(res.message)
          toast.success('Reunião cancelada. Os convidados foram avisados.')
          setConfirmando(false)
          await aoCancelar()
        }}
      >
        Cancelar reunião
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
        Voltar
      </Button>
    </div>
  )
}

function FormularioReuniao({
  r,
  empresaId,
  aoFechar,
  aoSalvar,
}: {
  r: ReuniaoDoCard
  empresaId: string | null
  aoFechar: () => void
  aoSalvar: () => Promise<void>
}) {
  const [modalidade, setModalidade] = React.useState<ModalidadeReuniao>(
    (MODALIDADES as string[]).includes(r.modalidade) ? (r.modalidade as ModalidadeReuniao) : 'meet',
  )
  const [salvando, setSalvando] = React.useState(false)
  const [escolhidos, setEscolhidos] = React.useState<Set<string>>(
    () => new Set(r.participantes.map((p) => p.email.toLowerCase())),
  )

  const contatos = useQuery({
    // A mesma chave do compositor: a lista de contatos é a mesma, e duas chaves
    // para os mesmos dados fariam a aba mostrar um contato que a outra já não vê.
    queryKey: ['comunicacao', 'contatos', empresaId],
    queryFn: () => buscarContatos(empresaId ?? ''),
    enabled: Boolean(empresaId),
  })

  /*
   * Só contato COM E-MAIL entra na lista.
   *
   * Convite do Google é um e-mail — não há como convidar um WhatsApp. Mostrar um
   * contato sem endereço com a caixa desabilitada ensinaria a pessoa a procurar
   * ali o que nunca vai estar; quem não tem e-mail aparece na contagem de fora,
   * que é o que diz o que fazer a respeito (cadastrar o e-mail na ficha).
   */
  const comEmail = (contatos.data ?? []).filter((c) => Boolean(c.email))
  const semEmail = (contatos.data ?? []).length - comEmail.length

  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const quando = String(fd.get('quando') ?? '')
        const participantes = comEmail
          .filter((c) => escolhidos.has((c.email ?? '').toLowerCase()))
          .map((c) => ({ contato_id: c.id, nome: c.nome, email: (c.email ?? '').toLowerCase() }))

        setSalvando(true)
        const res = await salvarReuniaoAction({
          id: r.id,
          inicio_em: quando ? new Date(quando).toISOString() : undefined,
          duracao_min: Number(fd.get('duracao') ?? r.duracao_min),
          modalidade,
          local: modalidade === 'meet' ? null : String(fd.get('local') ?? '').trim() || null,
          descricao: String(fd.get('descricao') ?? '').trim() || null,
          participantes,
        })
        setSalvando(false)
        if (!res.ok) return toast.error(res.message)
        toast.success(
          participantes.length > 0
            ? 'Reunião salva. O convite vai para os participantes pelo Google.'
            : 'Reunião salva.',
        )
        aoFechar()
        await aoSalvar()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="quando">Quando</Label>
          <Input
            id="quando"
            name="quando"
            type="datetime-local"
            defaultValue={paraInputLocal(r.inicio_em)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="duracao">Duração (min)</Label>
          <Input
            id="duracao"
            name="duracao"
            type="number"
            min={15}
            max={480}
            step={15}
            defaultValue={r.duracao_min}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Onde</Label>
        <div className="flex flex-wrap gap-2">
          {MODALIDADES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant={modalidade === m ? 'secondary' : 'outline'}
              onClick={() => setModalidade(m)}
            >
              {MODALIDADE_REUNIAO_LABELS[m]}
            </Button>
          ))}
        </div>
        {modalidade === 'meet' ? (
          <p className="text-xs text-muted-foreground">
            A sala é criada pelo Google ao salvar, e o link vai dentro do convite.
          </p>
        ) : (
          <Input
            name="local"
            defaultValue={r.local ?? ''}
            placeholder={
              modalidade === 'presencial'
                ? 'Endereço — "Av. Brigadeiro Faria Lima 3.000, 12º andar"'
                : 'Telefone que vai ser chamado'
            }
            required={modalidade === 'presencial'}
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="descricao">Pauta (vai no convite)</Label>
        <Textarea id="descricao" name="descricao" rows={2} defaultValue={r.descricao ?? ''} />
      </div>

      <div className="space-y-1.5">
        <Label>Quem do cliente é convidado</Label>
        {!empresaId ? (
          <p className="text-xs text-muted-foreground">Card sem empresa — não há contatos a convidar.</p>
        ) : contatos.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : comEmail.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum contato desta empresa tem e-mail cadastrado. O convite do Google é um e-mail —
            cadastre um na ficha da empresa para poder convidar.
          </p>
        ) : (
          <div className="space-y-1">
            {comEmail.map((c) => {
              const email = (c.email ?? '').toLowerCase()
              const marcado = escolhidos.has(email)
              return (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() =>
                      setEscolhidos((atual) => {
                        const proximo = new Set(atual)
                        if (marcado) proximo.delete(email)
                        else proximo.add(email)
                        return proximo
                      })
                    }
                  />
                  <span>{c.nome ?? email}</span>
                  <span className="text-xs text-muted-foreground">{email}</span>
                  {c.ponto_focal ? (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      focal
                    </Badge>
                  ) : null}
                </label>
              )
            })}
            {semEmail > 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">
                {semEmail} contato{semEmail > 1 ? 's' : ''} desta empresa sem e-mail cadastrado —
                não dá para convidar por agenda.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar reunião'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
