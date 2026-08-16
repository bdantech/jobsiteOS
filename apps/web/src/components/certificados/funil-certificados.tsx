'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  RefreshCw,
  ShieldAlert,
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
import { buscarVendedoresVisiveis, comercialKeys } from '@/components/comercial/queries'
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
 * Funil de captura de certificados digitais (0116/0117).
 *
 * O grid em /empresas/certificados mostra ONDE está a cegueira de NF-e. Esta tela é
 * onde alguém trabalha para fechá-la — foto contra fila de trabalho. Os dois leem a
 * mesma origem e se linkam.
 *
 * UM CARD POR CLIENTE, com as SPEs dentro: são 1.017 CNPJs no escopo e a ligação é uma
 * só, com a construtora.
 *
 * O CARD NÃO TEM BOTÃO. Ele mostra nome, cobertura e nada mais; clicar abre o detalhe,
 * e é lá que se move, ganha e perde. Com quatro colunas lado a lado, três botões por
 * card multiplicavam por 47 uma decisão que se toma uma vez — e o que sobrava de
 * espaço era justamente o que o card tinha a dizer.
 */

const COLUNAS = ESTAGIOS_CERTIFICADO

function proxima(e: EstagioCertificado): EstagioCertificado | null {
  const i = COLUNAS.indexOf(e)
  // `pendente_spes` nunca é destino de botão: é a máquina que move para lá quando a
  // matriz fica coberta, e o RPC recusa um humano empurrando card sem matriz.
  const seguinte = COLUNAS[i + 1]
  return seguinte && seguinte !== 'pendente_spes' ? seguinte : null
}

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Dias até vencer. Negativo vira "vencido há N dias". */
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
 * A barra de cobertura. Honesta de propósito: 2 de 371 desenha um fio, e é isso mesmo.
 * Arredondar para um mínimo visível faria "quase nada" e "um começo" ficarem iguais —
 * e o número ao lado existe para a barra não precisar mentir.
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

/** A lista de CNPJs. Só existe dentro do modal — são até 371 por cliente. */
function ListaCnpjs({ cnpjs }: { cnpjs: CnpjDoCard[] }) {
  const [filtro, setFiltro] = React.useState('')
  const linhas = React.useMemo(
    () => cnpjs.filter((c) => combina({ nome: c.nome ?? '', cnpj: c.cnpj }, filtro)),
    [cnpjs, filtro],
  )

  return (
    <div className="space-y-2">
      {cnpjs.length > 15 && (
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder={`Buscar entre ${cnpjs.length} CNPJs`}
          className="h-8 text-xs"
          aria-label="Buscar CNPJ dentro do card"
        />
      )}
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
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

/**
 * O card na coluna. Só leitura: nome, CNPJ, cobertura e um selo quando a matriz falta.
 *
 * O selo substituiu a frase "Matriz sem certificado — nenhuma NF-e é ingerida", que
 * aparecia em quase todo card e por isso não era mais lida. A informação continua
 * (é a que decide se dá para ganhar), agora do tamanho de um selo; a frase inteira
 * mora no modal, onde é lida uma vez e importa.
 */
function CardDoFunil({ c, onAbrir }: { c: CardCertificado; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="w-full space-y-2 rounded-md border p-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-2 font-medium">{c.nome}</p>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">{formatCnpj(c.cnpj)}</p>
        </div>
        {c.matriz_coberta ? (
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Matriz em dia" />
        ) : (
          <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" aria-label="Matriz sem certificado" />
        )}
      </div>
      <Cobertura cobertos={c.cobertos} total={c.total} />
    </button>
  )
}

/** O detalhe do card: onde se lê o que falta e onde se move, ganha ou perde. */
function DetalheDoCard({
  c,
  agindo,
  motivos,
  onFechar,
  onMover,
}: {
  c: CardCertificado
  agindo: boolean
  motivos: { id: string; motivo: string }[]
  onFechar: () => void
  onMover: (estagio: string, perdidoMotivo?: string) => void
}) {
  const [perdendo, setPerdendo] = React.useState(false)
  const [motivo, setMotivo] = React.useState('')
  const seguinte = proxima(c.estagio as EstagioCertificado)
  const encerrado = c.estagio === 'ganho' || c.estagio === 'perdido'

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="pr-6">{c.nome}</DialogTitle>
        <DialogDescription className="font-mono tabular-nums">{formatCnpj(c.cnpj)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {encerrado
              ? c.estagio === 'ganho'
                ? 'Ganho'
                : `Perdido${c.perdido_motivo_label ? ` · ${c.perdido_motivo_label}` : ''}`
              : ESTAGIO_CERTIFICADO_LABELS[c.estagio as EstagioCertificado]}
          </Badge>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href={`/empresas/${c.empresa_id}`}>
              Company 360
              <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
            </Link>
          </Button>
        </div>

        {/*
         * Aqui a frase completa cabe: é lida uma vez, ao abrir o card que se vai
         * trabalhar, e é ela que explica por que o botão "Ganhei" está desligado.
         */}
        {c.matriz_coberta ? (
          <p className="flex items-center gap-1.5 rounded-md border border-emerald-600/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Certificado da matriz em dia — {prazo(c.matriz_expira_em)}.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Matriz sem certificado — nenhuma NF-e desta empresa é ingerida.
          </p>
        )}

        <Cobertura cobertos={c.cobertos} total={c.total} />

        <div className="space-y-1.5">
          <p className="text-xs font-medium">
            {c.total - 1} SPE(s) no grupo · {c.pendentes} pendente(s)
          </p>
          <ListaCnpjs cnpjs={c.cnpjs} />
        </div>

        {perdendo && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground">
              O card sai do funil e só volta se o fato mudar — se o certificado aparecer, ou se
              um que já existia vencer. O motivo é obrigatório: é ele que ensina por que não
              conseguimos.
            </p>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger aria-label="Motivo da perda" className="h-9">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {motivos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.motivo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
        <div className="flex flex-wrap gap-2">
          {encerrado ? (
            <Button size="sm" variant="outline" disabled={agindo} onClick={() => onMover('universo')}>
              Reabrir
            </Button>
          ) : perdendo ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setPerdendo(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!motivo || agindo}
                onClick={() => onMover('perdido', motivo)}
              >
                Marcar como perdido
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" disabled={agindo} onClick={() => setPerdendo(true)}>
                Perdi
              </Button>
              {seguinte && (
                <Button size="sm" variant="outline" disabled={agindo} onClick={() => onMover(seguinte)}>
                  {ESTAGIO_CERTIFICADO_LABELS[seguinte]}
                  <ChevronRight className="ml-0.5 h-3 w-3" aria-hidden />
                </Button>
              )}
              {/*
               * Desabilitado sem a matriz, com o motivo no title. O banco recusa de
               * qualquer jeito; desabilitar evita o clique que só serve para receber
               * um erro.
               */}
              <Button
                size="sm"
                disabled={agindo || !c.matriz_coberta}
                title={c.matriz_coberta ? 'Marcar como ganho' : 'Sem o certificado da matriz não dá para ganhar'}
                onClick={() => onMover('ganho')}
              >
                Ganhei
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </DialogContent>
  )
}

export function FunilCertificados({ ehGestor }: { ehGestor: boolean }) {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [agindo, setAgindo] = React.useState(false)
  const [sincronizando, setSincronizando] = React.useState(false)
  const [verFinalizados, setVerFinalizados] = React.useState(false)
  const [abertoId, setAbertoId] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: funilCertificadosKeys.funil(vendedorId),
    queryFn: () => buscarFunilCertificados(vendedorId),
  })
  const { data: motivos } = useQuery({
    queryKey: funilCertificadosKeys.motivos(),
    queryFn: buscarMotivosCertificado,
    staleTime: 60 * 60_000,
  })
  // Só os originadores: são eles que têm carteira, e oferecer um closer num filtro que
  // lê `vendedor_carteira` seria oferecer uma opção que sempre volta vazia.
  const { data: visiveis } = useQuery({
    queryKey: comercialKeys.visiveis(),
    queryFn: buscarVendedoresVisiveis,
    enabled: ehGestor,
  })
  const originadores = (visiveis ?? []).filter((v) => v.tipo === 'originador')

  const cards = React.useMemo(
    () => (data?.cards ?? []).filter((c) => combina(c, termo)),
    [data, termo],
  )
  const abertos = cards.filter((c) => c.estagio !== 'ganho' && c.estagio !== 'perdido')
  const finalizados = cards.filter((c) => c.estagio === 'ganho' || c.estagio === 'perdido')
  const aberto = (data?.cards ?? []).find((c) => c.card_id === abertoId) ?? null

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
    setAbertoId(null)
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
                {data.sincronizado_em ? <> Último sync: {dataBr(data.sincronizado_em)}.</> : null}
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
            {/*
             * O filtro do gestor, como nos outros funis: sem ele o recorte por carteira
             * é invisível para quem administra — e o que é invisível parece quebrado.
             * Quem não é gestor não vê o seletor porque para ele não há escolha: o RPC
             * devolve a própria carteira e ignora o argumento.
             */}
            {ehGestor && originadores.length > 0 && (
              <Select
                value={vendedorId ?? 'todos'}
                onValueChange={(v) => setVendedorId(v === 'todos' ? null : v)}
              >
                <SelectTrigger className="h-9 w-56" aria-label="Filtrar por originador">
                  <SelectValue placeholder="Todos os originadores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os originadores</SelectItem>
                  {originadores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
            <FinalizadosTabela linhas={finalizados} onAbrir={(c) => setAbertoId(c.card_id)} />
          ) : abertos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {vendedorId ? 'Nada pendente nesta carteira.' : 'Nada pendente no funil.'}
              </p>
              <p className="mt-1">
                A lista se enche sozinha quando um certificado vencer ou um cliente novo entrar.
              </p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLUNAS.map((coluna) => {
                const itens = abertos.filter((c) => c.estagio === coluna)
                return (
                  <div key={coluna} className="w-72 shrink-0 space-y-2">
                    {/*
                     * ALTURA FIXA no cabeçalho. As ajudas têm uma, duas ou três linhas,
                     * e sem isto cada coluna começava numa altura diferente: a régua
                     * horizontal virava escada e os cards não se comparavam de relance.
                     */}
                    <div className="flex h-16 flex-col justify-between border-b pb-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-xs font-medium">{ESTAGIO_CERTIFICADO_LABELS[coluna]}</p>
                        <span className="text-xs tabular-nums text-muted-foreground">{itens.length}</span>
                      </div>
                      <p className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                        {ESTAGIO_CERTIFICADO_AJUDA[coluna]}
                      </p>
                    </div>
                    <div className="space-y-2">
                      {itens.map((c) => (
                        <CardDoFunil key={c.card_id} c={c} onAbrir={() => setAbertoId(c.card_id)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={aberto !== null} onOpenChange={(o) => !o && setAbertoId(null)}>
        {aberto && (
          <DetalheDoCard
            c={aberto}
            agindo={agindo}
            motivos={motivos ?? []}
            onFechar={() => setAbertoId(null)}
            onMover={(estagio, m) => void mover(aberto, estagio, m)}
          />
        )}
      </Dialog>
    </div>
  )
}

/** Ganhos e perdidos. Tabela e não kanban: aqui a pergunta é "o que aconteceu?". */
function FinalizadosTabela({
  linhas,
  onAbrir,
}: {
  linhas: CardCertificado[]
  onAbrir: (c: CardCertificado) => void
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
          </tr>
        </thead>
        <tbody className="divide-y">
          {linhas.map((c) => (
            <tr
              key={c.card_id}
              className="cursor-pointer hover:bg-accent/40"
              onClick={() => onAbrir(c)}
            >
              <td className="max-w-[18rem] px-3 py-2">
                <p className="truncate font-medium">{c.nome}</p>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
