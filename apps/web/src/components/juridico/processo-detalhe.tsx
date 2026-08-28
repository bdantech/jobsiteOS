'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CircleAlert,
  ExternalLink,
  Link2Off,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  BENCHMARK_FASES_PADRAO,
  ORIGENS_RECUPERACAO,
  ORIGEM_RECUPERACAO_LABELS,
  PARAMETROS_CALCULO_PADRAO,
  SITUACAO_INTERNA_LABELS,
  TIPOS_CUSTO,
  TIPOS_PRAZO,
  TIPO_CUSTO_LABELS,
  TIPO_PRAZO_LABELS,
  COLUNAS_JURIDICO,
  formatCnpj,
  type BenchmarkFases,
  type OrigemRecuperacao,
  type ParametrosCalculo,
  type SituacaoInterna,
  type TipoCusto,
  type TipoPrazo,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  atualizarAgoraAction,
  atualizarProcessoAction,
  concluirPrazoAction,
  registrarCustoAction,
  registrarRecuperacaoAction,
  removerOperacaoAction,
  salvarOperacaoAction,
  salvarPrazoAction,
} from '@/actions/juridico'
import { CalculoCard } from './calculo-card'
import { Cronograma } from './cronograma'
import { ParecerCard } from './parecer-card'
import { brl, data, dataHora, faseLabel, haDias } from './format'
import {
  buscarAdvogados,
  buscarCalculos,
  buscarCustos,
  buscarEnvolvidos,
  buscarFasesDetectadas,
  buscarJuridicoConfig,
  buscarMovimentacoes,
  buscarOperacoes,
  buscarPareceres,
  buscarPrazos,
  buscarProcesso,
  buscarProcessoBruto,
  buscarRecuperacoes,
  juridicoKeys,
} from './queries'

/**
 * O detalhe do processo (08 §8).
 *
 * A capa e o cronograma ficam FORA das abas: são o que responde "onde este processo
 * está" e some-los ao trocar de aba é o caminho mais curto para alguém registrar uma
 * custa no processo errado — a mesma razão pela qual a Company 360 fixa a identidade.
 */

const SEM_VALOR = '—'

export function ProcessoDetalhe({ numeroCnj }: { numeroCnj: string }) {
  const qc = useQueryClient()
  const [aba, setAba] = React.useState('movimentacoes')
  const [atualizando, setAtualizando] = React.useState(false)

  const processo = useQuery({
    queryKey: juridicoKeys.processo(numeroCnj),
    queryFn: () => buscarProcesso(numeroCnj),
  })
  const bruto = useQuery({
    queryKey: [...juridicoKeys.processo(numeroCnj), 'bruto'],
    queryFn: () => buscarProcessoBruto(numeroCnj),
  })
  const movimentacoes = useQuery({
    queryKey: juridicoKeys.movimentacoes(numeroCnj),
    queryFn: () => buscarMovimentacoes(numeroCnj),
  })
  const fases = useQuery({
    queryKey: [...juridicoKeys.movimentacoes(numeroCnj), 'fases'],
    queryFn: () => buscarFasesDetectadas(numeroCnj),
  })
  const envolvidos = useQuery({
    queryKey: juridicoKeys.envolvidos(numeroCnj),
    queryFn: () => buscarEnvolvidos(numeroCnj),
  })
  const operacoes = useQuery({
    queryKey: juridicoKeys.operacoes(numeroCnj),
    queryFn: () => buscarOperacoes(numeroCnj),
  })
  const calculos = useQuery({
    queryKey: juridicoKeys.calculos(numeroCnj),
    queryFn: () => buscarCalculos(numeroCnj),
  })
  const custos = useQuery({ queryKey: juridicoKeys.custos(numeroCnj), queryFn: () => buscarCustos(numeroCnj) })
  const recuperacoes = useQuery({
    queryKey: juridicoKeys.recuperacoes(numeroCnj),
    queryFn: () => buscarRecuperacoes(numeroCnj),
  })
  const prazos = useQuery({ queryKey: juridicoKeys.prazos(numeroCnj), queryFn: () => buscarPrazos(numeroCnj) })
  const pareceres = useQuery({
    queryKey: juridicoKeys.pareceres(numeroCnj),
    queryFn: () => buscarPareceres(numeroCnj),
  })
  const advogados = useQuery({ queryKey: juridicoKeys.advogados(), queryFn: buscarAdvogados })
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarJuridicoConfig })

  const benchmark = ((config.data?.benchmark_fases as BenchmarkFases | undefined) ??
    BENCHMARK_FASES_PADRAO) as BenchmarkFases
  const parametrosCalculo = ((config.data?.calculo as ParametrosCalculo | undefined) ??
    PARAMETROS_CALCULO_PADRAO) as ParametrosCalculo

  const p = processo.data
  /*
   * `capa` é a linha CRUA de `processos`. A view `juridico_carteira` carrega o que a
   * LISTA precisa — ela varre a carteira inteira, e engordá-la com campos que só o
   * detalhe usa (url do tribunal, segredo de justiça, grau) seria pagar essas colunas
   * em toda varredura para exibi-las numa tela por vez.
   */
  const capa = bruto.data

  async function atualizarAgora() {
    setAtualizando(true)
    const r = await atualizarAgoraAction(numeroCnj)
    setAtualizando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      'Pedido enviado ao robô do Escavador. A resposta chega por callback em alguns minutos — a tela se atualiza sozinha na próxima carga.',
    )
  }

  async function salvarGestao(campos: Record<string, unknown>) {
    const r = await atualizarProcessoAction({ numero_cnj: numeroCnj, ...campos })
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })
    void qc.invalidateQueries({ queryKey: juridicoKeys.carteira() })
    toast.success('Processo atualizado.')
  }

  if (processo.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!p) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CircleAlert className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Processo não encontrado. A importação roda pelos NOSSOS CNPJs — se ele deveria estar aqui,
            confira a lista de entidades em Configurações.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/juridico">Voltar</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const saldo = Number(p.saldo_liquido ?? 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/juridico">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Processos
          </Link>
        </Button>
        <div className="flex gap-2">
          {capa?.url_tribunal ? (
            <Button asChild variant="outline" size="sm">
              <a href={capa.url_tribunal} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" />
                Abrir no tribunal
              </a>
            </Button>
          ) : null}
          <Button size="sm" onClick={atualizarAgora} disabled={atualizando}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {atualizando ? 'Solicitando…' : 'Atualizar agora'}
          </Button>
        </div>
      </div>

      {/* ── Capa ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="font-mono text-base">{p.numero_cnj}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {[p.classe, p.assunto].filter(Boolean).join(' · ') || SEM_VALOR}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{SITUACAO_INTERNA_LABELS[p.situacao_interna as SituacaoInterna]}</Badge>
              {/*
               * O status do tribunal ao lado da situação interna, e não escondido:
               * quando os dois discordam — INATIVO lá, "em andamento" aqui — a
               * discordância É a informação.
               */}
              {p.status_predito ? (
                <Badge
                  variant="outline"
                  title="Classificação do Escavador sobre o andamento no tribunal."
                  className={p.status_predito === 'INATIVO' ? 'text-amber-600' : undefined}
                >
                  Tribunal: {p.status_predito}
                </Badge>
              ) : null}
              {p.arquivado ? <Badge variant="outline">Arquivado</Badge> : null}
              {capa?.segredo_justica ? <Badge variant="destructive">Segredo de justiça</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Devedor">
            {p.empresa_devedora_id ? (
              <Link href={`/empresas/${p.empresa_devedora_id}`} className="underline-offset-2 hover:underline">
                {p.devedor_nome ?? SEM_VALOR}
              </Link>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                {p.devedor_nome ?? SEM_VALOR}
                <Badge variant="outline" className="gap-1 text-amber-600">
                  <Link2Off className="h-3 w-3" aria-hidden />
                  sem vínculo
                </Badge>
              </span>
            )}
            {p.cnpj_devedor ? (
              <span className="block font-mono text-xs text-muted-foreground">{formatCnpj(p.cnpj_devedor)}</span>
            ) : null}
          </Campo>
          <Campo rotulo="Foro">
            {[p.orgao_julgador, p.comarca, p.uf].filter(Boolean).join(' · ') || SEM_VALOR}
            <span className="block text-xs text-muted-foreground">
              {[p.tribunal_sigla, capa?.grau ? `${capa.grau}º grau` : null].filter(Boolean).join(' · ')}
            </span>
          </Campo>
          <Campo rotulo="Valor da causa">{brl(p.valor_causa)}</Campo>
          <Campo rotulo="Valor atualizado">
            {p.valor_atualizado === null ? (
              <span className="text-xs text-muted-foreground">sem cálculo gerado</span>
            ) : (
              <>
                {brl(p.valor_atualizado)}
                <span className="block text-xs text-muted-foreground">em {data(p.calculo_em)}</span>
              </>
            )}
          </Campo>
          <Campo rotulo="Distribuído em">{data(p.data_distribuicao)}</Campo>
          <Campo rotulo="Última movimentação">
            {data(p.data_ultima_movimentacao)}
            <span className="block text-xs text-muted-foreground">{haDias(p.dias_sem_movimentacao)}</span>
          </Campo>
          <Campo rotulo="Nosso polo">
            {p.polo_nosso === 'ativo' ? 'Ativo (exequente)' : p.polo_nosso === 'passivo' ? 'Passivo' : SEM_VALOR}
          </Campo>
          <Campo rotulo="Sincronizado em">{dataHora(p.ultima_sincronizacao)}</Campo>
        </CardContent>
      </Card>

      {/* ── Saldo líquido: o número que diz se a ação paga o próprio custo ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Recuperado" valor={brl(p.recuperado)} />
        <Indicador rotulo="Custo acumulado" valor={brl(p.custo_acumulado)} />
        <Indicador
          rotulo="Saldo líquido"
          valor={brl(saldo)}
          destaque={saldo < 0 ? 'negativo' : saldo > 0 ? 'positivo' : undefined}
          nota="recuperado − custos"
        />
      </div>

      <Cronograma movimentacoes={fases.data ?? []} benchmark={benchmark} />

      {/* ── Gestão ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Gestão do processo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Situação interna</Label>
            <Select
              value={p.situacao_interna ?? 'em_andamento'}
              onValueChange={(v) => void salvarGestao({ situacao_interna: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUNAS_JURIDICO.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SITUACAO_INTERNA_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Advogado responsável</Label>
            <Select
              value={p.advogado_id ?? 'nenhum'}
              onValueChange={(v) => void salvarGestao({ advogado_id: v === 'nenhum' ? null : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem responsável" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Sem responsável</SelectItem>
                {(advogados.data ?? [])
                  .filter((a) => a.ativo)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome}
                      {a.escritorio ? ` — ${a.escritorio}` : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <VincularEmpresa numeroCnj={numeroCnj} vinculada={!!p.empresa_devedora_id} cnpj={p.cnpj_devedor} />
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="observacoes">Observações</Label>
            <ObservacoesEditor
              inicial={capa?.observacoes ?? ''}
              onSalvar={(texto) => void salvarGestao({ observacoes: texto })}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={aba} onValueChange={setAba} className="space-y-3">
        <TabsList className="flex-wrap">
          <TabsTrigger value="movimentacoes">Movimentações</TabsTrigger>
          <TabsTrigger value="operacoes">Operações cobradas</TabsTrigger>
          <TabsTrigger value="calculo">Cálculo</TabsTrigger>
          <TabsTrigger value="financeiro">Custos e recuperações</TabsTrigger>
          <TabsTrigger value="prazos">Prazos</TabsTrigger>
          <TabsTrigger value="partes">Partes</TabsTrigger>
          <TabsTrigger value="parecer">Parecer</TabsTrigger>
        </TabsList>

        <TabsContent value="movimentacoes" className="mt-0">
          <Movimentacoes linhas={movimentacoes.data ?? []} carregando={movimentacoes.isLoading} />
        </TabsContent>

        <TabsContent value="operacoes" className="mt-0">
          <Operacoes numeroCnj={numeroCnj} linhas={operacoes.data ?? []} />
        </TabsContent>

        <TabsContent value="calculo" className="mt-0">
          <CalculoCard
            numeroCnj={numeroCnj}
            parametrosPadrao={parametrosCalculo}
            calculos={calculos.data ?? []}
            temOperacoes={(operacoes.data ?? []).length > 0}
          />
        </TabsContent>

        <TabsContent value="financeiro" className="mt-0">
          <Financeiro
            numeroCnj={numeroCnj}
            custos={custos.data ?? []}
            recuperacoes={recuperacoes.data ?? []}
          />
        </TabsContent>

        <TabsContent value="prazos" className="mt-0">
          <Prazos numeroCnj={numeroCnj} linhas={prazos.data ?? []} advogados={advogados.data ?? []} />
        </TabsContent>

        <TabsContent value="partes" className="mt-0">
          <Partes linhas={envolvidos.data ?? []} />
        </TabsContent>

        <TabsContent value="parecer" className="mt-0">
          <ParecerCard numeroCnj={numeroCnj} pareceres={pareceres.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Blocos ─────────────────────────────────────────────────────────────────

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Indicador({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string
  valor: string
  nota?: string
  destaque?: 'positivo' | 'negativo'
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{rotulo}</div>
        <div
          className={
            destaque === 'negativo'
              ? 'text-lg font-semibold tabular-nums text-destructive'
              : destaque === 'positivo'
                ? 'text-lg font-semibold tabular-nums text-emerald-600'
                : 'text-lg font-semibold tabular-nums'
          }
        >
          {valor}
        </div>
        {nota ? <div className="text-[11px] text-muted-foreground">{nota}</div> : null}
      </CardContent>
    </Card>
  )
}

function ObservacoesEditor({
  inicial,
  onSalvar,
}: {
  inicial: string
  onSalvar: (texto: string) => void
}) {
  const [texto, setTexto] = React.useState(inicial)
  React.useEffect(() => setTexto(inicial), [inicial])
  return (
    <div className="space-y-2">
      <Textarea
        id="observacoes"
        rows={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="O que não está nos autos: combinações com o escritório, estratégia, contexto da conta."
      />
      {texto !== inicial ? (
        <Button size="sm" variant="outline" onClick={() => onSalvar(texto)}>
          Salvar observações
        </Button>
      ) : null}
    </div>
  )
}

/**
 * A vinculação manual (§3). Aceita CNPJ e resolve por `empresas` na action; a tela só
 * mostra o estado, porque um seletor com a base inteira de empresas seria um combo de
 * dezenas de milhares de linhas.
 */
function VincularEmpresa({
  numeroCnj,
  vinculada,
  cnpj,
}: {
  numeroCnj: string
  vinculada: boolean
  cnpj: string | null
}) {
  const qc = useQueryClient()
  const [id, setId] = React.useState('')

  if (vinculada) {
    return (
      <div className="space-y-1">
        <Label>Empresa devedora</Label>
        <p className="pt-2 text-sm text-muted-foreground">Vinculada.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Label htmlFor="vincular">Vincular empresa devedora</Label>
      <div className="flex gap-2">
        <Input
          id="vincular"
          placeholder="ID da empresa"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const r = await atualizarProcessoAction({ numero_cnj: numeroCnj, empresa_devedora_id: id })
            if (!r.ok) {
              toast.error(r.message)
              return
            }
            void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })
            toast.success('Empresa vinculada.')
          }}
          disabled={!id}
        >
          Vincular
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {cnpj
          ? `CNPJ ${formatCnpj(cnpj)} não está em Empresas. Cadastre-a e cole o id aqui.`
          : 'Nenhum CNPJ de devedor foi identificado no polo oposto.'}
      </p>
    </div>
  )
}

function Movimentacoes({
  linhas,
  carregando,
}: {
  linhas: { id: number; data: string; tipo: string | null; conteudo: string; relevante: boolean; fase_detectada: string | null; fonte_sigla: string | null; termo_detectado: string | null }[]
  carregando: boolean
}) {
  const [soRelevantes, setSoRelevantes] = React.useState(false)
  const exibidas = soRelevantes ? linhas.filter((m) => m.relevante) : linhas

  if (carregando) return <Skeleton className="h-64 w-full" />

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Movimentações ({linhas.length})</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setSoRelevantes((v) => !v)}>
          {soRelevantes ? 'Ver todas' : 'Só as relevantes'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {exibidas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {linhas.length === 0
              ? 'Nenhuma movimentação sincronizada ainda.'
              : 'Nenhuma movimentação marcada como relevante.'}
          </p>
        ) : (
          exibidas.map((m) => (
            <div
              key={m.id}
              className={
                m.relevante
                  ? 'rounded-md border-l-2 border-primary bg-primary/5 p-3'
                  : 'rounded-md border-l-2 border-transparent p-3'
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{data(m.data)}</span>
                {m.tipo ? <Badge variant="outline">{m.tipo}</Badge> : null}
                {m.fonte_sigla ? <span>{m.fonte_sigla}</span> : null}
                {m.fase_detectada ? (
                  <Badge
                    variant="secondary"
                    title={m.termo_detectado ? `Casou com: "${m.termo_detectado}"` : undefined}
                  >
                    {faseLabel(m.fase_detectada)}
                  </Badge>
                ) : null}
                {m.relevante ? <Badge>relevante</Badge> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.conteudo}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function Operacoes({
  numeroCnj,
  linhas,
}: {
  numeroCnj: string
  linhas: { id: string; valor_original: number; vencimento: string; descricao: string | null; access_key: string | null }[]
}) {
  const qc = useQueryClient()
  const [valor, setValor] = React.useState('')
  const [vencimento, setVencimento] = React.useState('')
  const [descricao, setDescricao] = React.useState('')

  const total = linhas.reduce((s, o) => s + Number(o.valor_original), 0)

  async function adicionar() {
    const r = await salvarOperacaoAction({
      numero_cnj: numeroCnj,
      valor_original: Number(valor),
      vencimento,
      descricao: descricao || null,
    })
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setValor('')
    setVencimento('')
    setDescricao('')
    void qc.invalidateQueries({ queryKey: juridicoKeys.operacoes(numeroCnj) })
    toast.success('Operação adicionada.')
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Operações cobradas</CardTitle>
        <span className="text-sm tabular-nums">{brl(total)}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor original</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-sm">
                  {o.descricao ?? SEM_VALOR}
                  {o.access_key ? (
                    <span className="block font-mono text-[10px] text-muted-foreground">{o.access_key}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{data(o.vencimento)}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{brl(o.valor_original, 2)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remover operação"
                    onClick={async () => {
                      const r = await removerOperacaoAction(o.id)
                      if (!r.ok) {
                        toast.error(r.message)
                        return
                      }
                      void qc.invalidateQueries({ queryKey: juridicoKeys.operacoes(numeroCnj) })
                      toast.success('Operação removida. Os cálculos já gerados ficam como estão.')
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma operação cadastrada. É a lista de títulos que a ação cobra — sem ela o cálculo
                  não tem sobre o que incidir.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-4">
          <Input placeholder="Descrição (ex.: NF 12345)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <Input type="number" step="0.01" placeholder="Valor" value={valor} onChange={(e) => setValor(e.target.value)} />
          <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          <Button size="sm" onClick={adicionar} disabled={!valor || !vencimento}>
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Financeiro({
  numeroCnj,
  custos,
  recuperacoes,
}: {
  numeroCnj: string
  custos: { id: string; tipo: string; descricao: string | null; valor: number; data: string }[]
  recuperacoes: { id: string; valor: number; data: string; origem: string; observacao: string | null }[]
}) {
  const qc = useQueryClient()
  const [custo, setCusto] = React.useState({ tipo: 'custas', valor: '', data: '', descricao: '' })
  const [rec, setRec] = React.useState({ origem: 'penhora', valor: '', data: '', observacao: '' })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Custos incorridos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {custos.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span>
                <Badge variant="outline" className="mr-2">
                  {TIPO_CUSTO_LABELS[c.tipo as TipoCusto] ?? c.tipo}
                </Badge>
                {c.descricao ?? SEM_VALOR}
                <span className="block text-xs text-muted-foreground">{data(c.data)}</span>
              </span>
              <span className="tabular-nums">{brl(c.valor, 2)}</span>
            </div>
          ))}
          {custos.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum custo lançado.</p>
          ) : null}

          <div className="grid gap-2 border-t border-border pt-3">
            <Select value={custo.tipo} onValueChange={(v) => setCusto({ ...custo, tipo: v })}>
              <SelectTrigger aria-label="Tipo de custo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_CUSTO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_CUSTO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Descrição" value={custo.descricao} onChange={(e) => setCusto({ ...custo, descricao: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" placeholder="Valor" value={custo.valor} onChange={(e) => setCusto({ ...custo, valor: e.target.value })} />
              <Input type="date" value={custo.data} onChange={(e) => setCusto({ ...custo, data: e.target.value })} />
            </div>
            <Button
              size="sm"
              disabled={!custo.valor || !custo.data}
              onClick={async () => {
                const r = await registrarCustoAction({
                  numero_cnj: numeroCnj,
                  tipo: custo.tipo,
                  valor: Number(custo.valor),
                  data: custo.data,
                  descricao: custo.descricao || null,
                })
                if (!r.ok) {
                  toast.error(r.message)
                  return
                }
                setCusto({ tipo: 'custas', valor: '', data: '', descricao: '' })
                void qc.invalidateQueries({ queryKey: juridicoKeys.custos(numeroCnj) })
                void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })
                toast.success('Custo registrado.')
              }}
            >
              Lançar custo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recuperações recebidas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recuperacoes.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span>
                <Badge variant="outline" className="mr-2">
                  {ORIGEM_RECUPERACAO_LABELS[r.origem as OrigemRecuperacao] ?? r.origem}
                </Badge>
                {r.observacao ?? SEM_VALOR}
                <span className="block text-xs text-muted-foreground">{data(r.data)}</span>
              </span>
              <span className="tabular-nums text-emerald-600">{brl(r.valor, 2)}</span>
            </div>
          ))}
          {recuperacoes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nada recuperado ainda.</p>
          ) : null}

          <div className="grid gap-2 border-t border-border pt-3">
            <Select value={rec.origem} onValueChange={(v) => setRec({ ...rec, origem: v })}>
              <SelectTrigger aria-label="Origem da recuperação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORIGENS_RECUPERACAO.map((o) => (
                  <SelectItem key={o} value={o}>
                    {ORIGEM_RECUPERACAO_LABELS[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Observação" value={rec.observacao} onChange={(e) => setRec({ ...rec, observacao: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.01" placeholder="Valor" value={rec.valor} onChange={(e) => setRec({ ...rec, valor: e.target.value })} />
              <Input type="date" value={rec.data} onChange={(e) => setRec({ ...rec, data: e.target.value })} />
            </div>
            <Button
              size="sm"
              disabled={!rec.valor || !rec.data}
              onClick={async () => {
                const r = await registrarRecuperacaoAction({
                  numero_cnj: numeroCnj,
                  origem: rec.origem,
                  valor: Number(rec.valor),
                  data: rec.data,
                  observacao: rec.observacao || null,
                })
                if (!r.ok) {
                  toast.error(r.message)
                  return
                }
                setRec({ origem: 'penhora', valor: '', data: '', observacao: '' })
                void qc.invalidateQueries({ queryKey: juridicoKeys.recuperacoes(numeroCnj) })
                void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })
                toast.success('Recuperação registrada.')
              }}
            >
              Registrar recuperação
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Prazos({
  numeroCnj,
  linhas,
  advogados,
}: {
  numeroCnj: string
  linhas: { id: string; tipo: string; descricao: string; data: string; concluido: boolean; responsavel_id: string | null }[]
  advogados: { id: string; nome: string; ativo: boolean }[]
}) {
  const qc = useQueryClient()
  const [novo, setNovo] = React.useState({ tipo: 'prazo', descricao: '', data: '', responsavel_id: '' })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Prazos e audiências</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {linhas.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <span className={p.concluido ? 'text-muted-foreground line-through' : ''}>
              <Badge variant="outline" className="mr-2">
                {TIPO_PRAZO_LABELS[p.tipo as TipoPrazo] ?? p.tipo}
              </Badge>
              {p.descricao}
              <span className="block text-xs text-muted-foreground">{dataHora(p.data)}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const r = await concluirPrazoAction(p.id, !p.concluido)
                if (!r.ok) {
                  toast.error(r.message)
                  return
                }
                void qc.invalidateQueries({ queryKey: juridicoKeys.prazos(numeroCnj) })
              }}
            >
              {p.concluido ? 'Reabrir' : 'Concluir'}
            </Button>
          </div>
        ))}
        {linhas.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nenhum prazo cadastrado. Os que forem cadastrados aparecem no calendário e avisam o
            responsável em D-3 e D-1.
          </p>
        ) : null}

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-5">
          <Select value={novo.tipo} onValueChange={(v) => setNovo({ ...novo, tipo: v })}>
            <SelectTrigger aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_PRAZO.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIPO_PRAZO_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="sm:col-span-2"
            placeholder="Descrição"
            value={novo.descricao}
            onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
          />
          <Input
            type="datetime-local"
            value={novo.data}
            onChange={(e) => setNovo({ ...novo, data: e.target.value })}
          />
          <Button
            size="sm"
            disabled={!novo.descricao || !novo.data}
            onClick={async () => {
              const r = await salvarPrazoAction({
                numero_cnj: numeroCnj,
                tipo: novo.tipo,
                descricao: novo.descricao,
                // `datetime-local` não carrega fuso; o `new Date` local o resolve para
                // o do navegador, que é o de quem está marcando a audiência.
                data: new Date(novo.data).toISOString(),
                responsavel_id: novo.responsavel_id || null,
              })
              if (!r.ok) {
                toast.error(r.message)
                return
              }
              setNovo({ tipo: 'prazo', descricao: '', data: '', responsavel_id: '' })
              void qc.invalidateQueries({ queryKey: juridicoKeys.prazos(numeroCnj) })
              toast.success('Prazo cadastrado.')
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
          <Select
            value={novo.responsavel_id || 'nenhum'}
            onValueChange={(v) => setNovo({ ...novo, responsavel_id: v === 'nenhum' ? '' : v })}
          >
            <SelectTrigger className="sm:col-span-2" aria-label="Responsável">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhum">Sem responsável</SelectItem>
              {advogados
                .filter((a) => a.ativo)
                .map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

interface AdvogadoDoProcesso {
  nome?: string | null
  oab_numero?: string | null
  oab_uf?: string | null
}

function Partes({
  linhas,
}: {
  linhas: { id: string; nome: string; polo: string | null; tipo: string | null; cpf_cnpj: string | null; advogados: unknown }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Partes e advogados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {linhas.map((e) => {
          const advs = (Array.isArray(e.advogados) ? e.advogados : []) as AdvogadoDoProcesso[]
          return (
            <div key={e.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.nome}</span>
                {e.polo ? <Badge variant="outline">{e.polo === 'ativo' ? 'Polo ativo' : 'Polo passivo'}</Badge> : null}
                {e.tipo ? <span className="text-xs text-muted-foreground">{e.tipo}</span> : null}
              </div>
              {e.cpf_cnpj ? (
                <div className="font-mono text-xs text-muted-foreground">
                  {e.cpf_cnpj.length === 14 ? formatCnpj(e.cpf_cnpj) : e.cpf_cnpj}
                </div>
              ) : null}
              {advs.length > 0 ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {advs
                    .map((a) =>
                      [a.nome, a.oab_numero ? `OAB ${a.oab_numero}${a.oab_uf ? `/${a.oab_uf}` : ''}` : null]
                        .filter(Boolean)
                        .join(' · '),
                    )
                    .join(' | ')}
                </div>
              ) : null}
            </div>
          )
        })}
        {linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum envolvido sincronizado.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
