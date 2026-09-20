'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Plus, RefreshCw, Search, X } from 'lucide-react'
import {
  ESTAGIOS_PROSPECCAO_ABERTOS,
  ESTAGIOS_PROSPECCAO_ENCERRADOS,
  ESTAGIO_PROSPECCAO_DESCRICOES,
  ESTAGIO_PROSPECCAO_LABELS,
  formatCnpj,
  type EstagioProspeccao,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE, STATUS_TEXTO } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/components/empresas/use-debounce'
import { buscarVendedoresVisiveis, comercialKeys } from '@/components/comercial/queries'
import { seguirFornecedorAction } from '@/actions/prospeccao'
import { cn } from '@/lib/utils'
import { formatarInteiro, formatarMoeda } from './format'
import { SacadoProspeccaoCard } from './sacado-prospeccao-card'
import {
  DialogoDescartar,
  DialogoEnriquecer,
  DialogoPedirPonte,
  DialogoReatribuir,
  DialogoSolicitarAnalise,
} from './prospeccao-dialogs'
import {
  CONFIG_PROSPECCAO_PADRAO,
  ORDENS_PROSPECCAO,
  buscarCedentesSeguidos,
  buscarConfigProspeccao,
  buscarFunilProspeccao,
  buscarPainelProspeccao,
  prospeccaoKeys,
  type OrdemProspeccao,
  type QuebraFornecedor,
  type SacadoProspeccao,
} from './prospeccao-queries'

/**
 * Sacados por NF (04r §5) — o funil de aquisição de sacado por fluxo observado.
 *
 * ─── POR QUE UM KANBAN PRÓPRIO, E NÃO O DO FUNIL DE NFs ─────────────────────
 *
 * Os dois leem a mesma nota, cada um por uma ponta. Lá o sacado tem crédito aprovado e a
 * pergunta é "o fornecedor vai antecipar?"; aqui o sacado não tem análise nenhuma, e a
 * pergunta é "conseguimos operar isso?". O gargalo é a ESTEIRA, não a conversa — e um
 * kanban emprestado faria o originador arrastar cards por colunas que não descrevem o
 * trabalho dele.
 *
 * O que é reusado é o que faz parecer a mesma casa: as primitivas de card, o painel do
 * topo, a régua de cores e a gramática de filtros.
 *
 * ─── AS QUATRO SAÍDAS FICAM FORA DAS COLUNAS ────────────────────────────────
 *
 * Aprovado, recusado, sem interesse e descartado são RESULTADO, não trabalho. Quatro
 * colunas de histórico empurrariam o que importa para fora do viewport — elas viram um
 * filtro, como as encerradas do funil de NFs.
 */

const TODOS = '__todos__'
const SEM_DONO = '__sem_dono__'

/** Quantos cards cada coluna pinta. O total do cabeçalho vem do `count`, não daqui. */
const POR_COLUNA = 25

function ColunaProspeccao({
  estagio,
  filtros,
  children,
}: {
  estagio: EstagioProspeccao
  filtros: Parameters<typeof buscarFunilProspeccao>[0]
  children: (sacado: SacadoProspeccao) => React.ReactNode
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: prospeccaoKeys.funil({ ...filtros, estagio }),
    queryFn: () => buscarFunilProspeccao({ ...filtros, estagio, limite: POR_COLUNA }),
  })

  return (
    <section className="flex w-[22rem] shrink-0 flex-col gap-2" aria-label={ESTAGIO_PROSPECCAO_LABELS[estagio]}>
      <header className="sticky top-0 z-10 rounded-md border bg-muted/60 px-3 py-2 backdrop-blur">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">{ESTAGIO_PROSPECCAO_LABELS[estagio]}</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {isPending ? '…' : formatarInteiro(data?.total ?? 0)}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {ESTAGIO_PROSPECCAO_DESCRICOES[estagio]}
        </p>
      </header>

      {isPending ? (
        <>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </>
      ) : null}

      {isError ? (
        <p className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">
          {error instanceof Error ? error.message : 'Erro ao carregar.'}
        </p>
      ) : null}

      {data?.linhas.map((s) => <React.Fragment key={s.id}>{children(s)}</React.Fragment>)}

      {data && data.linhas.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          Nada aqui.
        </p>
      ) : null}

      {data && data.total > data.linhas.length ? (
        // A ordenação vale sobre o que foi pintado. Dizer isso é o que impede alguém de
        // ler "os 25 maiores" como "todos".
        <p className="px-1 text-[11px] text-muted-foreground">
          Mostrando os {data.linhas.length} de maior valor esperado, de{' '}
          {formatarInteiro(data.total)}.
        </p>
      ) : null}
    </section>
  )
}

export function SacadosPorNf({ ehGestor = false }: { ehGestor?: boolean }) {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [uf, setUf] = React.useState<string>(TODOS)
  const [fornecedor, setFornecedor] = React.useState<string>(TODOS)
  const [ordem, setOrdem] = React.useState<OrdemProspeccao>('valor_esperado')
  const [scoreMin, setScoreMin] = React.useState<string>('')
  const [recorrenciaMin, setRecorrenciaMin] = React.useState<string>('')
  const [originador, setOriginador] = React.useState<string>(TODOS)
  const [verEncerrados, setVerEncerrados] = React.useState(false)
  const [cnpjSeguir, setCnpjSeguir] = React.useState('')
  const [seguindo, setSeguindo] = React.useState(false)

  const [descartando, setDescartando] = React.useState<SacadoProspeccao | null>(null)
  const [analisando, setAnalisando] = React.useState<SacadoProspeccao | null>(null)
  const [enriquecendo, setEnriquecendo] = React.useState<SacadoProspeccao | null>(null)
  const [reatribuindo, setReatribuindo] = React.useState<SacadoProspeccao | null>(null)
  const [pedindoPonte, setPedindoPonte] = React.useState<{
    sacado: SacadoProspeccao
    fornecedor: QuebraFornecedor
  } | null>(null)

  const termoDebounced = useDebounce(termo, 350)

  const { data: config = CONFIG_PROSPECCAO_PADRAO } = useQuery({
    queryKey: prospeccaoKeys.config(),
    queryFn: buscarConfigProspeccao,
  })
  const { data: seguidos = [] } = useQuery({
    queryKey: prospeccaoKeys.seguidos(),
    queryFn: buscarCedentesSeguidos,
  })
  const { data: vendedores = [] } = useQuery({
    queryKey: comercialKeys.visiveis(),
    queryFn: buscarVendedoresVisiveis,
    enabled: ehGestor,
  })

  const originadorId = originador === TODOS || originador === SEM_DONO ? undefined : originador
  const { data: painel } = useQuery({
    queryKey: prospeccaoKeys.painel(originadorId ?? null),
    queryFn: () => buscarPainelProspeccao(originadorId ?? null),
  })

  const filtros = React.useMemo(
    () => ({
      termo: termoDebounced || undefined,
      uf: uf === TODOS ? undefined : uf,
      fornecedorCnpj: fornecedor === TODOS ? undefined : fornecedor,
      scoreMin: scoreMin ? Number(scoreMin) : undefined,
      recorrenciaMin: recorrenciaMin ? Number(recorrenciaMin) : undefined,
      originadorId,
      semDono: originador === SEM_DONO ? true : undefined,
      ordem,
    }),
    [termoDebounced, uf, fornecedor, scoreMin, recorrenciaMin, originadorId, originador, ordem],
  )

  const limpar = () => {
    setTermo('')
    setUf(TODOS)
    setFornecedor(TODOS)
    setScoreMin('')
    setRecorrenciaMin('')
    setOriginador(TODOS)
  }
  const temFiltro =
    Boolean(termo) || uf !== TODOS || fornecedor !== TODOS || Boolean(scoreMin) ||
    Boolean(recorrenciaMin) || originador !== TODOS

  async function seguir() {
    const limpo = cnpjSeguir.replace(/\D/g, '')
    if (limpo.length !== 14) {
      toast.error('Informe um CNPJ com 14 dígitos.')
      return
    }
    setSeguindo(true)
    const r = await seguirFornecedorAction({ fornecedor_cnpj: limpo, seguir: true })
    setSeguindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setCnpjSeguir('')
    toast.success('Cedente seguido. O funil está sendo recalculado — recarregue em instantes.')
    void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
  }

  const colunas = verEncerrados ? ESTAGIOS_PROSPECCAO_ENCERRADOS : ESTAGIOS_PROSPECCAO_ABERTOS

  const renderCard = (s: SacadoProspeccao) => (
    <SacadoProspeccaoCard
      sacado={s}
      config={config}
      ehGestor={ehGestor}
      onDescartar={setDescartando}
      onSolicitarAnalise={setAnalisando}
      onEnriquecer={setEnriquecendo}
      onReatribuir={ehGestor ? setReatribuindo : undefined}
      onPedirPonte={(sacado, f) => setPedindoPonte({ sacado, fornecedor: f })}
    />
  )

  return (
    <div className="space-y-4">
      {/* ── Painel do originador (§5) ─────────────────────────────────────── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
          <div>
            <p className="text-xs text-muted-foreground">Sacados no funil</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatarInteiro(painel?.sacados ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Volume observado</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatarMoeda(painel?.volume_observado ?? 0)}
            </p>
          </div>
          <div>
            <p
              className="text-xs text-muted-foreground"
              title="O que sobrevive à esteira: só as notas com prazo suficiente para existirem no dia em que o limite sair."
            >
              Valor operável
            </p>
            <p className={cn('text-lg font-semibold tabular-nums', STATUS_TEXTO.success)}>
              {formatarMoeda(painel?.valor_operavel ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor esperado / mês</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatarMoeda(painel?.valor_esperado_mensal ?? 0)}
            </p>
          </div>
          <div>
            <p
              className="text-xs text-muted-foreground"
              title="Cards parados esperando a esteira decidir. É o número que responde 'por que meu funil não anda?'."
            >
              Travados na esteira
            </p>
            <p
              className={cn(
                'text-lg font-semibold tabular-nums',
                (painel?.travados_na_esteira ?? 0) > 0 ? STATUS_TEXTO.warning : '',
              )}
            >
              {formatarInteiro(painel?.travados_na_esteira ?? 0)}
            </p>
          </div>
        </CardContent>
      </Card>

      {/*
       * A AUSÊNCIA PRECISA SER EXPLICADA.
       *
       * Este funil só enxerga notas de cedentes SEGUIDOS, e medido em 20/09/2026 apenas 1
       * dos 130 cedentes que emitem contra sacados não cadastrados tem titular vigente na
       * carteira. Sem este aviso, uma tela vazia se lê como "não há oportunidade" quando
       * na verdade é "ninguém segue ninguém ainda".
       */}
      {seguidos.length === 0 ? (
        <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Você ainda não segue nenhum cedente</p>
            <p className="text-muted-foreground">
              O funil se enche com as notas que <strong>os seus cedentes</strong> emitem contra
              construtoras que ainda não são clientes. Siga um CNPJ abaixo, ou ganhe a
              titularidade dele na carteira de originação — as duas contam, e uma não apaga a
              outra.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Filtros e o botão Seguir ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Construtora ou CNPJ"
            className="pl-8"
            aria-label="Buscar sacado"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-ordem">
            Ordenar por
          </Label>
          <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemProspeccao)}>
            <SelectTrigger id="prospeccao-ordem" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ORDENS_PROSPECCAO).map(([id, o]) => (
                <SelectItem key={id} value={id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-cedente">
            Cedente
          </Label>
          <Select value={fornecedor} onValueChange={setFornecedor}>
            <SelectTrigger id="prospeccao-cedente" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os que sigo</SelectItem>
              {seguidos.map((s) => (
                <SelectItem key={`${s.fornecedor_cnpj}-${s.origem}`} value={s.fornecedor_cnpj}>
                  {formatCnpj(s.fornecedor_cnpj)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-uf">
            UF
          </Label>
          <Input
            id="prospeccao-uf"
            value={uf === TODOS ? '' : uf}
            onChange={(e) => setUf(e.target.value.toUpperCase() || TODOS)}
            placeholder="Todas"
            maxLength={2}
            className="w-20"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-score">
            Score mín.
          </Label>
          <Input
            id="prospeccao-score"
            type="number"
            min={0}
            max={100}
            value={scoreMin}
            onChange={(e) => setScoreMin(e.target.value)}
            className="w-24"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-recorrencia">
            Recorrência mín.
          </Label>
          <Input
            id="prospeccao-recorrencia"
            type="number"
            min={0}
            max={config.janelas.janela_recorrencia_meses}
            value={recorrenciaMin}
            onChange={(e) => setRecorrenciaMin(e.target.value)}
            className="w-28"
          />
        </div>

        {ehGestor ? (
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="prospeccao-dono">
              Originador
            </Label>
            <Select value={originador} onValueChange={setOriginador}>
              <SelectTrigger id="prospeccao-dono" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                <SelectItem value={SEM_DONO}>Sem dono (fila do gestor)</SelectItem>
                {vendedores.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {temFiltro ? (
          <Button variant="ghost" size="sm" onClick={limpar}>
            <X className="mr-1 h-3.5 w-3.5" aria-hidden />
            Limpar
          </Button>
        ) : null}

        <Button
          variant={verEncerrados ? 'default' : 'outline'}
          size="sm"
          onClick={() => setVerEncerrados((v) => !v)}
        >
          {verEncerrados ? 'Ver funil ativo' : 'Ver encerrados'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })}
          aria-label="Recarregar"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {/* ── Seguir um cedente ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="prospeccao-seguir">
            Seguir um cedente
          </Label>
          <Input
            id="prospeccao-seguir"
            value={cnpjSeguir}
            onChange={(e) => setCnpjSeguir(e.target.value)}
            placeholder="CNPJ do cedente"
            className="w-56 font-mono"
          />
        </div>
        <Button size="sm" disabled={seguindo} onClick={() => void seguir()}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          {seguindo ? 'Seguindo…' : 'Seguir'}
        </Button>
        <p className="flex-1 text-xs text-muted-foreground">
          Seguir um cedente traz para o seu funil <strong>todas</strong> as construtoras contra
          as quais ele emite e que ainda não são clientes. Quem é titular do cedente na carteira
          já segue automaticamente — e perder a titularidade não apaga o seguir manual.
        </p>
        {seguidos.length > 0 ? (
          <Badge variant="outline" className="text-xs">
            {formatarInteiro(seguidos.length)} seguido
            {seguidos.length === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      {/* ── O kanban ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {colunas.map((estagio) => (
          <ColunaProspeccao key={estagio} estagio={estagio} filtros={filtros}>
            {renderCard}
          </ColunaProspeccao>
        ))}
      </div>

      <DialogoDescartar sacado={descartando} config={config} onFechar={() => setDescartando(null)} />
      <DialogoSolicitarAnalise sacado={analisando} onFechar={() => setAnalisando(null)} />
      <DialogoEnriquecer sacado={enriquecendo} onFechar={() => setEnriquecendo(null)} />
      <DialogoReatribuir sacado={reatribuindo} onFechar={() => setReatribuindo(null)} />
      <DialogoPedirPonte alvo={pedindoPonte} config={config} onFechar={() => setPedindoPonte(null)} />
    </div>
  )
}
