'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from 'lucide-react'
import {
  ESTAGIOS_CERTIFICADO,
  ESTAGIO_CERTIFICADO_AJUDA,
  ESTAGIO_CERTIFICADO_LABELS,
  formatCnpj,
  pctCobertura,
  type EstagioCertificado,
} from '@jobsiteos/core'
import {
  moverCertificadoCardAction,
  sincronizarFunilCertificadosAction,
} from '@/actions/certificado-funil'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  buscarFunilCertificados,
  buscarMotivosCertificado,
  funilCertificadosKeys,
  type CardCertificado,
  type CnpjDoCard,
} from './funil-queries'

/**
 * Funil de captura de certificados digitais (0116).
 *
 * O grid em /empresas/certificados mostra ONDE está a cegueira de NF-e. Esta tela é
 * onde alguém trabalha para fechá-la — e a diferença entre as duas é a diferença
 * entre uma foto e uma fila de trabalho. Os dois leem a mesma origem e se linkam.
 *
 * UM CARD POR CLIENTE, com as SPEs dentro. Hoje são 47 cards para 1.017 CNPJs, dos
 * quais 1.002 sem certificado. Um card por CNPJ seria uma fila de mil itens que
 * ninguém encara; a ligação, afinal, é uma só — com a construtora.
 *
 * O MAIOR CARD TEM 371 CNPJs. Por isso a lista só existe expandida, uma de cada vez,
 * e vem ORDENADA POR URGÊNCIA do servidor (matriz, depois descoberto, depois o que
 * vence antes). Num card desse tamanho a ordem é a interface.
 */

/** Só as colunas de trabalho. Ganho e perdido moram na gaveta de finalizados. */
const COLUNAS = ESTAGIOS_CERTIFICADO

function proxima(e: EstagioCertificado): EstagioCertificado | null {
  const i = COLUNAS.indexOf(e)
  // `pendente_spes` nunca é destino de botão: é a máquina que move para lá quando a
  // matriz fica coberta, e um humano empurrando um card sem matriz para essa coluna
  // faria o nome da coluna deixar de valer.
  const seguinte = COLUNAS[i + 1]
  return seguinte && seguinte !== 'pendente_spes' ? seguinte : null
}

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Dias até vencer, para o texto ao lado do CNPJ. Negativo vira "vencido". */
function prazo(iso: string | null): string {
  if (!iso) return 'sem certificado'
  const dias = Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (Number.isNaN(dias)) return 'sem certificado'
  if (dias < 0) return `vencido há ${Math.abs(dias)}d`
  if (dias === 0) return 'vence hoje'
  return `vence em ${dias}d`
}

function combina(c: { nome: string; cnpj: string }, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true
  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && c.cnpj.includes(digitos)) return true
  return c.nome.toLowerCase().includes(t)
}

/**
 * A barra de cobertura. Honesta de propósito: 2 de 371 desenha um fio, e é isso
 * mesmo. Arredondar para um mínimo visível faria "quase nada" e "um começo" ficarem
 * iguais — e o número ao lado existe justamente para a barra não precisar mentir.
 */
function Cobertura({ cobertos, total }: { cobertos: number; total: number }) {
  const pct = pctCobertura(cobertos, total) ?? 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{cobertos}</span> de{' '}
          <span className="tabular-nums">{total}</span> com certificado
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${pct}% coberto`}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** A lista de CNPJs dentro do card. Só monta quando expandida — são até 371. */
function ListaCnpjs({ cnpjs }: { cnpjs: CnpjDoCard[] }) {
  const [filtro, setFiltro] = React.useState('')
  const linhas = React.useMemo(
    () => cnpjs.filter((c) => combina({ nome: c.nome ?? '', cnpj: c.cnpj }, filtro)),
    [cnpjs, filtro],
  )

  return (
    <div className="space-y-1.5 border-t pt-2">
      {/* A busca só aparece quando a lista é grande o bastante para se perder nela. */}
      {cnpjs.length > 15 && (
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder={`Buscar entre ${cnpjs.length} CNPJs`}
          className="h-7 text-xs"
          aria-label="Buscar CNPJ dentro do card"
        />
      )}
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {linhas.map((c) => (
          <li key={c.cnpj} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                c.coberto ? 'bg-emerald-500' : 'bg-destructive',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={c.nome ?? c.cnpj}>
                {c.nome ?? '—'}
                {c.e_matriz ? (
                  <span className="ml-1 rounded bg-muted px-1 py-px text-[10px]">matriz</span>
                ) : null}
              </span>
              <span className="block font-mono tabular-nums text-muted-foreground">
                {formatCnpj(c.cnpj)} · {prazo(c.expires_at)}
              </span>
            </span>
          </li>
        ))}
        {linhas.length === 0 && (
          <li className="py-2 text-center text-xs text-muted-foreground">Nenhum CNPJ para “{filtro}”.</li>
        )}
      </ul>
    </div>
  )
}

function CardDoFunil({
  c,
  agindo,
  onMover,
  onPerder,
}: {
  c: CardCertificado
  agindo: boolean
  onMover: (c: CardCertificado, estagio: string) => void
  onPerder: (c: CardCertificado) => void
}) {
  const [aberto, setAberto] = React.useState(false)
  const seguinte = proxima(c.estagio as EstagioCertificado)

  return (
    <div className="space-y-2 rounded-md border p-2 text-sm">
      <div className="space-y-1">
        <Link href={`/empresas/${c.empresa_id}`} className="line-clamp-2 font-medium hover:underline">
          {c.nome}
        </Link>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatCnpj(c.cnpj)}</p>
      </div>

      {/*
       * O estado da MATRIZ vem antes do percentual, e em vermelho quando falta: é o
       * certificado que destrava a ingestão de NF-e do cliente inteiro. Um card 40%
       * coberto com a matriz descoberta está pior do que um 2% com a matriz em dia,
       * e o percentual sozinho diria o contrário.
       */}
      {c.matriz_coberta ? (
        <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Matriz em dia · {prazo(c.matriz_expira_em)}
        </p>
      ) : (
        <p className="text-[11px] font-medium text-destructive">
          Matriz sem certificado — nenhuma NF-e é ingerida
        </p>
      )}

      <Cobertura cobertos={c.cobertos} total={c.total} />

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        aria-expanded={aberto}
      >
        {aberto ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
        {c.total - 1} SPE(s) no grupo · {c.pendentes} pendente(s)
      </button>
      {aberto && <ListaCnpjs cnpjs={c.cnpjs} />}

      <div className="flex flex-wrap gap-1 pt-0.5">
        {seguinte && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={agindo}
            onClick={() => onMover(c, seguinte)}
          >
            {ESTAGIO_CERTIFICADO_LABELS[seguinte]}
            <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
          </Button>
        )}
        {/*
         * "Ganhei" desabilitado sem a matriz, com o motivo no title. O banco recusa de
         * qualquer jeito (`app_mover_certificado_card`); desabilitar aqui evita o
         * clique que só serve para receber um erro.
         */}
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={agindo || !c.matriz_coberta}
          title={c.matriz_coberta ? 'Marcar como ganho' : 'Sem o certificado da matriz não dá para ganhar'}
          onClick={() => onMover(c, 'ganho')}
        >
          Ganhei
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={agindo}
          onClick={() => onPerder(c)}
        >
          Perdi
        </Button>
      </div>
    </div>
  )
}

export function FunilCertificados() {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [agindo, setAgindo] = React.useState(false)
  const [sincronizando, setSincronizando] = React.useState(false)
  const [verFinalizados, setVerFinalizados] = React.useState(false)
  const [perdendo, setPerdendo] = React.useState<CardCertificado | null>(null)
  const [motivo, setMotivo] = React.useState<string>('')

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: funilCertificadosKeys.funil(),
    queryFn: buscarFunilCertificados,
  })
  const { data: motivos } = useQuery({
    queryKey: funilCertificadosKeys.motivos(),
    queryFn: buscarMotivosCertificado,
    staleTime: 60 * 60_000,
  })

  const cards = React.useMemo(
    () => (data?.cards ?? []).filter((c) => combina(c, termo)),
    [data, termo],
  )
  const abertos = cards.filter((c) => c.estagio !== 'ganho' && c.estagio !== 'perdido')
  const finalizados = cards.filter((c) => c.estagio === 'ganho' || c.estagio === 'perdido')

  async function mover(c: CardCertificado, estagio: string, perdidoMotivo?: string) {
    setAgindo(true)
    const r = await moverCertificadoCardAction({
      card_id: c.card_id,
      estagio,
      perdido_motivo: perdidoMotivo ?? null,
    })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      estagio === 'ganho'
        ? 'Certificado capturado.'
        : estagio === 'perdido'
          ? 'Marcado como perdido.'
          : `Movido para ${ESTAGIO_CERTIFICADO_LABELS[estagio as EstagioCertificado] ?? estagio}.`,
    )
    setPerdendo(null)
    setMotivo('')
    void qc.invalidateQueries({ queryKey: funilCertificadosKeys.all })
  }

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarFunilCertificadosAction()
    setSincronizando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    const { abertos: a, ganhos, reabertos } = r.data
    toast.success(
      a + ganhos + reabertos === 0
        ? 'Nada mudou — o funil já reflete os certificados de hoje.'
        : `${a} aberto(s), ${ganhos} ganho(s), ${reabertos} reaberto(s).`,
    )
    void qc.invalidateQueries({ queryKey: funilCertificadosKeys.all })
  }

  if (isPending) return <Skeleton className="h-96 w-full" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar o funil.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data?.tem_acesso) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Você não tem acesso ao módulo Comercial.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Funil de certificados digitais</CardTitle>
              <CardDescription>
                Entra sozinho quem não tem certificado ou tem menos de 30 dias de validade —
                matriz e SPEs. Sai quando o certificado aparece no sync.
                {data.sincronizado_em ? (
                  <> Último sync: {dataBr(data.sincronizado_em)}.</>
                ) : null}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/empresas/certificados">
                  <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Ver o grid
                  <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                </Link>
              </Button>
              <Button variant="outline" size="sm" disabled={sincronizando} onClick={() => void sincronizar()}>
                <RefreshCw className={cn('mr-1 h-3.5 w-3.5', sincronizando && 'animate-spin')} aria-hidden />
                Sincronizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar cliente por nome ou CNPJ"
              className="h-9 max-w-xs"
              aria-label="Buscar cliente no funil"
            />
            <Button
              variant={verFinalizados ? 'default' : 'outline'}
              size="sm"
              onClick={() => setVerFinalizados((v) => !v)}
            >
              <Trophy className="mr-1 h-3.5 w-3.5" aria-hidden />
              {verFinalizados ? 'Voltar ao funil' : `Finalizados (${finalizados.length})`}
            </Button>
          </div>

          {verFinalizados ? (
            <FinalizadosTabela
              linhas={finalizados}
              agindo={agindo}
              onReabrir={(c) => void mover(c, 'universo')}
            />
          ) : abertos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nada pendente no funil.</p>
              <p className="mt-1">
                Todo cliente na sua carteira está com os certificados em dia. A lista se enche
                sozinha quando um vencer ou um cliente novo entrar.
              </p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLUNAS.map((coluna) => {
                const itens = abertos.filter((c) => c.estagio === coluna)
                return (
                  <div key={coluna} className="w-72 shrink-0 space-y-2">
                    <div className="border-b pb-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-medium">{ESTAGIO_CERTIFICADO_LABELS[coluna]}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                        {ESTAGIO_CERTIFICADO_AJUDA[coluna]}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {itens.map((c) => (
                        <CardDoFunil
                          key={c.card_id}
                          c={c}
                          agindo={agindo}
                          onMover={(card, e) => void mover(card, e)}
                          onPerder={setPerdendo}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={perdendo !== null} onOpenChange={(o) => !o && setPerdendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Perder o certificado de {perdendo?.nome}</DialogTitle>
            <DialogDescription>
              O card sai do funil e só volta se o fato mudar — se o certificado aparecer, ou se
              um que já existia vencer. O motivo é obrigatório: é ele que ensina por que não
              conseguimos.
            </DialogDescription>
          </DialogHeader>
          <Select value={motivo} onValueChange={setMotivo}>
            <SelectTrigger aria-label="Motivo da perda">
              <SelectValue placeholder="Escolha o motivo" />
            </SelectTrigger>
            <SelectContent>
              {(motivos ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.motivo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPerdendo(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo || agindo}
              onClick={() => perdendo && void mover(perdendo, 'perdido', motivo)}
            >
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Ganhos e perdidos. Tabela e não kanban: aqui a pergunta é "o que aconteceu?". */
function FinalizadosTabela({
  linhas,
  agindo,
  onReabrir,
}: {
  linhas: CardCertificado[]
  agindo: boolean
  onReabrir: (c: CardCertificado) => void
}) {
  if (linhas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhum card finalizado ainda.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Cliente</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            <th className="px-3 py-2 font-medium">Motivo</th>
            <th className="px-3 py-2 text-right font-medium">Cobertura</th>
            <th className="px-3 py-2 font-medium">Em</th>
            <th className="px-3 py-2 text-right font-medium">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {linhas.map((c) => (
            <tr key={c.card_id}>
              <td className="max-w-[18rem] px-3 py-2">
                <Link href={`/empresas/${c.empresa_id}`} className="truncate font-medium hover:underline">
                  {c.nome}
                </Link>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">{formatCnpj(c.cnpj)}</p>
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={c.estagio === 'perdido' ? 'destructive' : 'default'}
                  className={cn(
                    c.estagio === 'ganho' &&
                      'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
                  )}
                >
                  {c.estagio === 'ganho' ? 'Ganho' : 'Perdido'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{c.perdido_motivo_label ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {c.cobertos}/{c.total}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {dataBr(c.ganho_em ?? c.perdido_em)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                {/*
                 * Reabrir à mão existe porque o automático só reage a FATO: o card volta
                 * sozinho quando um certificado vence, mas não quando alguém percebe que
                 * a perda foi registrada cedo demais.
                 */}
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={agindo}
                  onClick={() => onReabrir(c)}>
                  Reabrir
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
