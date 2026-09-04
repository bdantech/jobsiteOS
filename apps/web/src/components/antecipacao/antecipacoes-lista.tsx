'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  FileQuestion,
  Link2,
  RefreshCw,
  Scale,
  Search,
} from 'lucide-react'
import { MATCH_STATUS_LABELS, MOTIVO_MATCH_LABELS, formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sincronizarAntecipacoesAction } from '@/actions/antecipacao'
import { FilaRevisao } from './fila-revisao'
import { formatarData, formatarDataHora, formatarMoedaExata } from './format'
import {
  antecipacaoKeys,
  buscarAntecipacoes,
  buscarContasDosSacados,
  mapaDeContas,
  buscarStatusConversoes,
  LIMITE_ANTECIPACOES,
  type Antecipacao,
} from './queries'

/**
 * A tela das antecipações (04e §6).
 *
 * Ela abre na FILA, e não na tabela. A tabela responde "o que a plataforma
 * antecipou?", que é uma pergunta de auditoria; a fila responde "o que está
 * esperando por mim?", que é a única pergunta com prazo. Um caso em `revisao` é
 * receita real que o funil ainda não contou.
 *
 * A taxa de casamento automático fica no topo porque é o termômetro do motor: se
 * ela cai, não é a fila que cresce — é a régua que precisa mudar (série nova no
 * número, status novo na plataforma, tolerância curta demais).
 */

const JANELA_DIAS = 30

// ─── Cabeçalho: os números que dizem se o loop está fechando ────────────────

function Indicadores() {
  const { data, isPending } = useQuery({
    queryKey: antecipacaoKeys.conversoes(JANELA_DIAS),
    queryFn: () => buscarStatusConversoes(JANELA_DIAS),
  })

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }
  if (!data) return null

  const taxa = data.total > 0 ? (data.casadas / data.total) * 100 : null

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Indicador
        titulo="Casamento automático"
        valor={taxa === null ? '—' : `${taxa.toFixed(0)}%`}
        detalhe={`${data.casadas} de ${data.total} antecipações em ${JANELA_DIAS} dias`}
        icone={Link2}
      />
      <Indicador
        titulo="Convertidas"
        valor={String(data.convertidas)}
        detalhe={`${formatarMoedaExata(data.valor_convertido)} bruto${
          data.taxa_media ? ` · ${data.taxa_media}% a.m. real` : ''
        }`}
        icone={CheckCircle2}
      />
      <Indicador
        titulo="Aguardando revisão"
        valor={String(data.pendentes_revisao)}
        detalhe={
          data.sem_nf_definitivo > 0
            ? `+ ${data.sem_nf_definitivo} sem NF definitivo`
            : 'nenhum caso vencido'
        }
        icone={Scale}
        alerta={data.pendentes_revisao > 0}
      />
      <Indicador
        titulo="Conversões em disputa"
        valor={String(data.em_disputa)}
        detalhe="notas convertidas cuja antecipação voltou atrás"
        icone={AlertTriangle}
        alerta={data.em_disputa > 0}
      />
    </div>
  )
}

function Indicador({
  titulo,
  valor,
  detalhe,
  icone: Icone,
  alerta = false,
}: {
  titulo: string
  valor: string
  detalhe: string
  icone: typeof Link2
  alerta?: boolean
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icone className={`h-3.5 w-3.5 ${alerta ? 'text-amber-600 dark:text-amber-400' : ''}`} aria-hidden />
          {titulo}
        </div>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  )
}

// ─── A tela ─────────────────────────────────────────────────────────────────

type Modo = 'fila' | 'todas'

export function AntecipacoesLista({ idInicial }: { idInicial?: number }) {
  const qc = useQueryClient()
  // Abre na FILA: é a aba com prazo. Um link com `?id=` vem de uma notificação de
  // regressão ou de "sem NF", e esses casos vivem na fila — exceto os já
  // convertidos, que só existem em "todas".
  const [modo, setModo] = React.useState<Modo>('fila')
  const [termo, setTermo] = React.useState('')
  const [sincronizando, setSincronizando] = React.useState(false)

  const filtros = React.useMemo(
    () => ({ soPendencias: modo === 'fila', termo: termo.trim() || undefined }),
    [modo, termo],
  )

  const { data, isPending, isError, error } = useQuery({
    queryKey: antecipacaoKeys.antecipacoes(filtros),
    queryFn: () => buscarAntecipacoes(filtros),
  })

  /*
   * A CONTA de cada sacado da lista. O cabeçalho da linha mostra o cliente, não a
   * SPE: aqui o sacado é quase sempre uma SPE de obra, e "PRIDE 06 QD 04" não diz
   * a ninguém de qual cliente é a antecipação.
   *
   * Em lote, e depois da lista: são ~100 CNPJs distintos em mil linhas, e a
   * resolução por CNPJ custa meio milissegundo.
   */
  const cnpjs = React.useMemo(
    () => (data ?? []).map((a) => a.sacado_cnpj).filter((c): c is string => Boolean(c)),
    [data],
  )
  const { data: contas } = useQuery({
    queryKey: [...antecipacaoKeys.all, 'contas-lote-antecipacoes', cnpjs.length, filtros],
    queryFn: () => buscarContasDosSacados(cnpjs),
    enabled: cnpjs.length > 0,
    staleTime: 300_000,
  })
  const contaPorCnpj = React.useMemo(() => mapaDeContas(contas), [contas])

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarAntecipacoesAction()
    setSincronizando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.enfileirado
        ? 'Sync enfileirado. O casamento roda em seguida — recarregue em alguns minutos.'
        : (r.data.aviso ?? 'Não foi possível enfileirar.'),
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Antecipações</h1>
          <p className="text-sm text-muted-foreground">
            O que a plataforma antecipou de verdade, casado com as notas do funil. A conversão
            automática só acontece quando o casamento é inequívoco — o resto vem para cá.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void sincronizar()} disabled={sincronizando}>
          <RefreshCw className={`mr-2 h-4 w-4 ${sincronizando ? 'animate-spin' : ''}`} aria-hidden />
          Sincronizar agora
        </Button>
      </div>

      <Indicadores />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={modo} onValueChange={(v) => setModo(v as Modo)}>
          <TabsList>
            <TabsTrigger value="fila">Fila de revisão</TabsTrigger>
            <TabsTrigger value="todas">Todas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Fornecedor, sacado, CNPJ ou número do documento"
            className="pl-8"
          />
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            {error instanceof Error ? error.message : 'Falha ao carregar as antecipações.'}
          </CardContent>
        </Card>
      ) : isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (data ?? []).length === 0 ? (
        <Vazio modo={modo} />
      ) : (
        <div className="space-y-2">
          {(data as Antecipacao[]).map((a) => (
            <LinhaAntecipacao
              key={a.id_externo}
              antecipacao={a}
              conta={a.sacado_cnpj ? contaPorCnpj.get(a.sacado_cnpj) : null}
              destacada={a.id_externo === idInicial}
              onResolvida={() => void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })}
            />
          ))}
          {(data ?? []).length >= LIMITE_ANTECIPACOES && (
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Mostrando as {LIMITE_ANTECIPACOES} mais recentes. Use a busca para chegar às demais.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Vazio({ modo }: { modo: Modo }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          {modo === 'fila' ? (
            <CheckCircle2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          ) : (
            <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-1">
          <p className="font-medium">
            {modo === 'fila' ? 'Nada esperando por você' : 'Nenhuma antecipação sincronizada'}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {modo === 'fila'
              ? 'Todas as antecipações casaram com uma nota, ou foram resolvidas. É o estado em que a fila deve viver.'
              : 'O sync roda de 4 em 4 horas, encadeado ao de notas fiscais. Se a tela seguir vazia depois do próximo ciclo, confira as ingestões.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── A linha ────────────────────────────────────────────────────────────────

const MATCH_BADGE: Record<string, string> = {
  casada: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  revisao: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  sem_nf: 'bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200',
  ignorada: 'bg-muted text-muted-foreground',
  pendente: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
}

function LinhaAntecipacao({
  antecipacao: a,
  destacada,
  onResolvida,
  conta,
}: {
  antecipacao: Antecipacao
  destacada: boolean
  onResolvida: () => void
  /** O cliente a que a antecipação está amarrada, quando difere do sacado. */
  conta?: string | null
}) {
  const [filaAberta, setFilaAberta] = React.useState(destacada)
  const nomeSacado = a.sacado_nome ?? formatCnpj(a.sacado_cnpj)
  const precisaDecisao = a.match_status === 'revisao' || a.match_status === 'sem_nf'

  return (
    <Card className={destacada ? 'border-primary/50' : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-xs text-muted-foreground">#{a.id_externo}</span>
            <span className="truncate">{a.fornecedor_nome ?? formatCnpj(a.fornecedor_cnpj)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="truncate text-sm font-normal text-muted-foreground">
              {conta ?? nomeSacado}
            </span>
            {/* A SPE fica, menor: ela é quem paga o boleto e é o nome que aparece
                no relatório da plataforma. O que muda é a hierarquia. */}
            {conta && conta !== nomeSacado ? (
              <span className="truncate text-xs font-normal text-muted-foreground/70">
                via {nomeSacado}
              </span>
            ) : null}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="outline">{a.status}</Badge>
            <Badge className={MATCH_BADGE[a.match_status] ?? 'bg-muted'}>
              {MATCH_STATUS_LABELS[a.match_status as keyof typeof MATCH_STATUS_LABELS] ??
                a.match_status}
            </Badge>
            {a.convertida_em && <Badge variant="outline">Converteu a nota</Badge>}
            {a.regrediu_em && (
              <Badge variant="outline" className="gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Em disputa
              </Badge>
            )}
            {a.match_motivo && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline decoration-dotted underline-offset-2">
                    por quê?
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {MOTIVO_MATCH_LABELS[a.match_motivo as keyof typeof MOTIVO_MATCH_LABELS] ??
                    a.match_motivo}
                  {a.match_observacao ? ` — ${a.match_observacao}` : ''}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">{formatarMoedaExata(a.gross_value)}</p>
          <p className="text-xs text-muted-foreground">
            doc {a.document_number ?? '—'} · vence {formatarData(a.original_due_date)}
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <Campo rotulo="Criada na plataforma" valor={formatarDataHora(a.created_at_plataforma)} />
          <Campo
            rotulo="Taxa / prazo"
            valor={`${a.monthly_interest_rate ?? '—'}% a.m. · ${a.anticipation_days ?? '—'} dias`}
          />
          <Campo rotulo="Líquido" valor={formatarMoedaExata(a.net_value)} />
        </dl>

        {a.access_key_casada && (
          <p className="text-xs text-muted-foreground">
            Casada com a nota{' '}
            <span className="font-mono">{a.access_key_casada}</span>
            {a.match_confianca ? ` (${a.match_confianca})` : ''} em {formatarDataHora(a.match_em)}.
          </p>
        )}

        {(precisaDecisao || filaAberta) && (
          <>
            {!filaAberta ? (
              <Button size="sm" variant="outline" onClick={() => setFilaAberta(true)}>
                <Scale className="mr-2 h-4 w-4" aria-hidden />
                Resolver
              </Button>
            ) : (
              <FilaRevisao
                idExterno={a.id_externo}
                onFechar={() => setFilaAberta(false)}
                onResolvida={() => {
                  setFilaAberta(false)
                  onResolvida()
                }}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums">{valor}</dd>
    </div>
  )
}
