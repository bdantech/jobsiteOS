'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, Info, Search, X } from 'lucide-react'
import {
  ErroAgrupamento,
  ESCOPO_NOTIFICACAO_LABELS,
  INDICE_COBRANCA_LABELS,
  INDICES_COBRANCA,
  PAPEL_NOTIFICACAO_COBRANCA_LABELS,
  agruparNotificacoes,
  atualizarDividaCobranca,
  hojeSaoPaulo,
  type EscopoNotificacao,
  type IndiceCobranca,
  type NotificacaoAgrupada,
  type ParametrosAtualizacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { aceitarAvisoApoliceAction, criarCobrancaAction, gerarMinutasNotificacaoAction } from '@/actions/cobranca'
import { cn } from '@/lib/utils'
import { TextoAvisoApolice } from './cobranca-detalhe-comum'
import { brl, cnpj, data } from './format'
import {
  buscarCadastro,
  buscarConfigCobranca,
  buscarGruposSacado,
  buscarTabelaIndices,
  buscarTitulosAbertosDoGrupo,
  buscarUsuariosAtivos,
  cobrancaKeys,
  type TituloAberto,
} from './queries'

/**
 * Nova cobrança (§1): escolher o grupo, escolher os títulos, escolher o escopo,
 * conferir quem recebe o quê e confirmar.
 *
 * Tudo numa página, de cima para baixo, e não num assistente de telas: a pessoa
 * volta à lista de títulos depois de ver o agrupamento ("a SPE X recebe uma carta de
 * R$ 800? tiro esse título") — e um passo-a-passo esconderia a lista justamente aí.
 *
 * O agrupamento da prévia é o MESMO `agruparNotificacoes` que a action roda na
 * geração, e o valor atualizado é o mesmo `atualizarDividaCobranca`. A prévia não é
 * uma aproximação da carta; é a carta sem o PDF.
 */

const FAIXAS = [
  { id: 'ate30', rotulo: 'até 30 dias', de: 0, ate: 30 },
  { id: '31-60', rotulo: '31–60 dias', de: 31, ate: 60 },
  { id: '61-90', rotulo: '61–90 dias', de: 61, ate: 90 },
  { id: '91-180', rotulo: '91–180 dias', de: 91, ate: 180 },
  { id: '180+', rotulo: 'mais de 180 dias', de: 181, ate: Number.POSITIVE_INFINITY },
] as const

/** Status em que a produção não informa a liquidação pelo sacado (ver 0269a/0269c). */
const STATUS_SEM_LIQUIDACAO = ['BILLET_SWAPPED', 'EXPIRED_BILL_SWAPPED', 'EXTENDED_BILL_SWAPPED', 'IN_EXTENSION_BILL_SWAPPED']

const numOuNull = (v: string): number | null => {
  const n = Number(v.replace(',', '.'))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

export function NovaCobranca({ sacadoInicial }: { sacadoInicial?: string | null }) {
  const router = useRouter()
  const [matriz, setMatriz] = React.useState<string | null>(
    sacadoInicial && /^\d{14}$/.test(sacadoInicial.replace(/\D/g, '')) ? sacadoInicial.replace(/\D/g, '') : null,
  )
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set())

  const config = useQuery({ queryKey: cobrancaKeys.config(), queryFn: buscarConfigCobranca })
  const titulos = useQuery({
    queryKey: cobrancaKeys.abertos(matriz ?? ''),
    queryFn: () => buscarTitulosAbertosDoGrupo(matriz!),
    enabled: Boolean(matriz),
  })

  React.useEffect(() => setSelecionados(new Set()), [matriz])

  const lista = titulos.data ?? []
  const nomeGrupo =
    lista.find((t) => t.sacado_cnpj === matriz)?.sacado_nome ?? lista[0]?.sacado_nome ?? (matriz ? cnpj(matriz) : null)

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/cobranca/cobrancas">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Cobranças
        </Link>
      </Button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">1. Construtora (sacado)</CardTitle>
          <CardDescription>
            Busque por razão social ou CNPJ. Qualquer SPE ou filial resolve para o grupo inteiro — a
            cobrança é sempre do grupo, com a matriz respondendo pelo conjunto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {matriz ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <div className="font-medium">{nomeGrupo}</div>
                <div className="font-mono text-xs text-muted-foreground">Matriz {cnpj(matriz)}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setMatriz(null)}>
                <X className="mr-1 h-4 w-4" aria-hidden />
                Trocar
              </Button>
            </div>
          ) : (
            <SeletorDeGrupo onEscolher={setMatriz} />
          )}
        </CardContent>
      </Card>

      {matriz ? (
        titulos.isPending || config.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : titulos.isError ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-destructive">
              {titulos.error instanceof Error ? titulos.error.message : 'Erro ao carregar os títulos.'}
            </CardContent>
          </Card>
        ) : (
          <Montagem
            matriz={matriz}
            titulos={lista}
            config={config.data!}
            selecionados={selecionados}
            setSelecionados={setSelecionados}
            onCriada={(id) => router.push(`/cobranca/cobrancas/${id}`)}
          />
        )
      ) : null}
    </div>
  )
}

// ─── (a) Seletor ────────────────────────────────────────────────────────────

function SeletorDeGrupo({ onEscolher }: { onEscolher: (matriz: string) => void }) {
  const [texto, setTexto] = React.useState('')
  const [termo, setTermo] = React.useState('')

  React.useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), 350)
    return () => clearTimeout(t)
  }, [texto])

  const grupos = useQuery({
    queryKey: cobrancaKeys.grupos(termo),
    queryFn: () => buscarGruposSacado(termo),
    enabled: termo.length >= 3,
  })

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          className="pl-8"
          placeholder="Razão social ou CNPJ (mín. 3 caracteres)"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
        />
      </div>
      {termo.length >= 3 ? (
        grupos.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (grupos.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum sacado com título em aberto encontrado para “{termo}”.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {(grupos.data ?? []).map((g) => (
              <button
                key={g.matriz}
                type="button"
                onClick={() => onEscolher(g.matriz)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <span>
                  <span className="block text-sm font-medium">{g.nome ?? cnpj(g.matriz)}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    Matriz {cnpj(g.matriz)}
                    {g.cnpjs.filter((c) => c !== g.matriz).length > 0
                      ? ` · ${g.cnpjs.filter((c) => c !== g.matriz).length} SPE/filial encontrada(s)`
                      : ''}
                  </span>
                </span>
                <Badge variant="secondary">{g.qtdAbertos} em aberto</Badge>
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

// ─── (b)–(e) Títulos, escopo, prévia, confirmação ───────────────────────────

function Montagem({
  matriz,
  titulos,
  config,
  selecionados,
  setSelecionados,
  onCriada,
}: {
  matriz: string
  titulos: TituloAberto[]
  config: Awaited<ReturnType<typeof buscarConfigCobranca>>
  selecionados: Set<string>
  setSelecionados: (s: Set<string>) => void
  onCriada: (id: string) => void
}) {
  const minimo = config.cobranca.dias_inicio_cobranca
  const [fCedente, setFCedente] = React.useState('todos')
  const [fSpe, setFSpe] = React.useState('todas')
  const [fFaixa, setFFaixa] = React.useState('todas')

  const [escopo, setEscopo] = React.useState<EscopoNotificacao>('sacado')
  const [matrizCedente, setMatrizCedente] = React.useState(true)
  const [responsavel, setResponsavel] = React.useState('')
  const [observacoes, setObservacoes] = React.useState('')
  const [juros, setJuros] = React.useState(String(config.calculo.juros_mora_mes))
  const [multa, setMulta] = React.useState(String(config.calculo.multa_pct))
  const [honorarios, setHonorarios] = React.useState(String(config.calculo.honorarios_pct))
  const [indice, setIndice] = React.useState<IndiceCobranca>(config.calculo.indice)
  const [proRata, setProRata] = React.useState(config.calculo.juros_pro_rata)
  const [dataBase, setDataBase] = React.useState(hojeSaoPaulo())
  const [aceitarAgora, setAceitarAgora] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  const usuarios = useQuery({ queryKey: cobrancaKeys.usuarios(), queryFn: buscarUsuariosAtivos })
  const tabela = useQuery({ queryKey: cobrancaKeys.indices(indice), queryFn: () => buscarTabelaIndices(indice) })

  const parametros: ParametrosAtualizacao = {
    juros_mora_mes: numOuNull(juros) ?? config.calculo.juros_mora_mes,
    multa_pct: numOuNull(multa) ?? config.calculo.multa_pct,
    honorarios_pct: numOuNull(honorarios) ?? config.calculo.honorarios_pct,
    indice,
    juros_pro_rata: proRata,
  }

  // Valor atualizado por título, com o mesmo motor da carta. Honorários entram na
  // linha para o número ser comparável ao total da notificação.
  const atualizado = React.useMemo(() => {
    const m = new Map<string, number>()
    if (!tabela.data || titulos.length === 0) return m
    const r = atualizarDividaCobranca(
      titulos
        .filter((t) => t.id && t.vencimento)
        .map((t) => ({ id: t.id!, valor_face: Number(t.valor_face ?? 0), vencimento: t.vencimento! })),
      parametros,
      tabela.data,
      dataBase || hojeSaoPaulo(),
    )
    for (const l of r.memoria) m.set(l.operacao_id, l.subtotal * (1 + parametros.honorarios_pct / 100))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulos, tabela.data, juros, multa, honorarios, indice, proRata, dataBase])

  const elegivel = (t: TituloAberto) => !t.cobranca_ativa_id && (t.dias_atraso ?? 0) >= minimo

  const cedentes = [...new Map(titulos.map((t) => [t.cedente_cnpj ?? '', t.cedente_nome ?? t.cedente_cnpj ?? ''])).entries()]
  const spes = [...new Map(titulos.map((t) => [t.sacado_cnpj ?? '', t.sacado_nome ?? t.sacado_cnpj ?? ''])).entries()]
  const faixaSel = FAIXAS.find((f) => f.id === fFaixa)

  const filtrados = titulos.filter((t) => {
    if (fCedente !== 'todos' && t.cedente_cnpj !== fCedente) return false
    if (fSpe !== 'todas' && t.sacado_cnpj !== fSpe) return false
    if (faixaSel && ((t.dias_atraso ?? 0) < faixaSel.de || (t.dias_atraso ?? 0) > faixaSel.ate)) return false
    return true
  })
  const elegiveisFiltrados = filtrados.filter(elegivel)
  const todosMarcados = elegiveisFiltrados.length > 0 && elegiveisFiltrados.every((t) => selecionados.has(t.id!))
  const temSemLiquidacao = titulos.some((t) => STATUS_SEM_LIQUIDACAO.includes((t.status_producao ?? '').toUpperCase()))

  function alternar(id: string) {
    const s = new Set(selecionados)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    setSelecionados(s)
  }

  function alternarTodos() {
    const s = new Set(selecionados)
    if (todosMarcados) for (const t of elegiveisFiltrados) s.delete(t.id!)
    else for (const t of elegiveisFiltrados) s.add(t.id!)
    setSelecionados(s)
  }

  const escolhidos = titulos.filter((t) => t.id && selecionados.has(t.id))
  const totalFace = escolhidos.reduce((s, t) => s + Number(t.valor_face ?? 0), 0)
  const totalAtualizado = escolhidos.reduce((s, t) => s + (atualizado.get(t.id!) ?? 0), 0)

  // ── (d) prévia do agrupamento ──
  let previa: NotificacaoAgrupada[] = []
  let erroPrevia: string | null = null
  if (escolhidos.length > 0) {
    try {
      previa = agruparNotificacoes(
        escolhidos.map((t) => ({
          id: t.id!,
          sacado_cnpj: t.sacado_cnpj!,
          sacado_matriz_cnpj: t.sacado_matriz_cnpj!,
          cedente_cnpj: t.cedente_cnpj!,
          cedente_matriz_cnpj: t.cedente_matriz_cnpj ?? t.cedente_cnpj!,
        })),
        { escopo, notificarMatrizCedente: matrizCedente },
      )
    } catch (e) {
      erroPrevia = e instanceof ErroAgrupamento || e instanceof Error ? e.message : 'Agrupamento inválido.'
    }
  }
  const cnpjsPrevia = previa.map((p) => p.destinatario_cnpj).sort().join(',')
  const cadastro = useQuery({
    queryKey: cobrancaKeys.cadastro(cnpjsPrevia),
    queryFn: () => buscarCadastro(cnpjsPrevia.split(',').filter(Boolean)),
    enabled: cnpjsPrevia.length > 0,
  })

  const nomeDe = (c: string) =>
    cadastro.data?.get(c)?.razao_social ??
    titulos.find((t) => t.sacado_cnpj === c)?.sacado_nome ??
    titulos.find((t) => t.cedente_cnpj === c)?.cedente_nome ??
    cnpj(c)

  async function confirmar() {
    setCriando(true)
    const r = await criarCobrancaAction({
      titulo_ids: [...selecionados],
      escopo_notificacao: escopo,
      notificar_matriz_cedente: matrizCedente,
      ...(responsavel ? { responsavel_id: responsavel } : {}),
      juros_mora_mes: parametros.juros_mora_mes,
      multa_pct: parametros.multa_pct,
      honorarios_pct: parametros.honorarios_pct,
      indice_correcao: parametros.indice,
      juros_pro_rata: parametros.juros_pro_rata,
      ...(dataBase ? { data_base: dataBase } : {}),
      ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
    })
    if (!r.ok) {
      setCriando(false)
      toast.error(r.message)
      return
    }
    const id = r.data.id

    if (aceitarAgora) {
      const a = await aceitarAvisoApoliceAction(id)
      if (!a.ok) toast.error(`Cobrança criada, mas o aceite do aviso não foi registrado: ${a.message}`)
    }

    const g = await gerarMinutasNotificacaoAction(id, { rodada: 1 })
    setCriando(false)
    if (!g.ok) {
      toast.error(`Cobrança ${r.data.codigo ?? ''} criada, mas as minutas não foram geradas: ${g.message}`)
    } else if (g.data.aviso) {
      toast.warning(g.data.aviso)
    } else if (g.data.erros.length > 0) {
      toast.warning(
        `${g.data.erros.length} PDF(s) não saíram: ${g.data.erros
          .slice(0, 2)
          .map((e) => `${e.destinatario} — ${e.mensagem}`)
          .join('; ')}`,
      )
    } else {
      toast.success(`Cobrança ${r.data.codigo ?? ''} criada com ${g.data.notificacoes} minuta(s) de notificação.`)
    }
    onCriada(id)
  }

  return (
    <>
      {/* (b) títulos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">2. Títulos em aberto do grupo</CardTitle>
          <CardDescription>
            Matriz e todas as SPEs/filiais. Títulos com menos de {minimo} dias de atraso ainda são da
            plataforma de produção e não podem entrar; os que já estão em outra cobrança aparecem
            bloqueados, com o link para ela.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {temSemLiquidacao ? (
            <div className="flex gap-2 rounded-md border border-amber-600/30 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Há títulos com boleto trocado (<span className="font-mono">BILLET_SWAPPED</span>) na produção.
                Para esses a plataforma não informa a liquidação pelo sacado — só a conclusão da antecipação —,
                então “em aberto” pode estar desatualizado. Confira com o financeiro antes de notificar: uma
                carta de cobrança de título pago é o pior começo de conversa.
              </p>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3">
            <Select value={fCedente} onValueChange={setFCedente}>
              <SelectTrigger aria-label="Cedente">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os cedentes</SelectItem>
                {cedentes.map(([c, n]) => (
                  <SelectItem key={c} value={c}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fSpe} onValueChange={setFSpe}>
              <SelectTrigger aria-label="SPE devedora">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as SPEs/filiais</SelectItem>
                {spes.map(([c, n]) => (
                  <SelectItem key={c} value={c}>
                    {n} {c === matriz ? '(matriz)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fFaixa} onValueChange={setFFaixa}>
              <SelectTrigger aria-label="Faixa de atraso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Qualquer atraso</SelectItem>
                {FAIXAS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os elegíveis"
                      checked={todosMarcados}
                      disabled={elegiveisFiltrados.length === 0}
                      onChange={alternarTodos}
                    />
                  </TableHead>
                  <TableHead>Título / NF</TableHead>
                  <TableHead>Cedente</TableHead>
                  <TableHead>SPE devedora</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                  <TableHead className="text-right">Face</TableHead>
                  <TableHead className="text-right">Atualizado</TableHead>
                  <TableHead>Produção</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((t) => {
                  const ok = elegivel(t)
                  const motivo = t.cobranca_ativa_id
                    ? `Já em cobrança (${t.cobranca_ativa_codigo ?? '—'})`
                    : (t.dias_atraso ?? 0) < minimo
                      ? `Menos de ${minimo} dias de atraso`
                      : null
                  return (
                    <TableRow key={t.id} className={cn(!ok && 'opacity-60')}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar título ${t.numero ?? t.externo_id}`}
                          disabled={!ok}
                          title={motivo ?? undefined}
                          checked={selecionados.has(t.id!)}
                          onChange={() => alternar(t.id!)}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.numero ?? t.externo_id}
                        {t.nf_chave_acesso ? (
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            NF {t.nf_chave_acesso.slice(25, 34)}
                          </span>
                        ) : null}
                        {motivo ? (
                          t.cobranca_ativa_id ? (
                            <Link
                              href={`/cobranca/cobrancas/${t.cobranca_ativa_id}`}
                              className="block text-[11px] text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                            >
                              {motivo}
                            </Link>
                          ) : (
                            <span className="block text-[11px] text-muted-foreground">{motivo}</span>
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs" title={t.cedente_nome ?? undefined}>
                        {t.cedente_nome ?? cnpj(t.cedente_cnpj)}
                      </TableCell>
                      <TableCell className="max-w-[12rem] text-xs">
                        <span className="block truncate" title={t.sacado_nome ?? undefined}>
                          {t.sacado_nome ?? '—'}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {cnpj(t.sacado_cnpj)}
                          {t.sacado_e_matriz ? ' · matriz' : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{data(t.emissao)}</TableCell>
                      <TableCell className="text-xs">{data(t.vencimento)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.dias_atraso ?? 0} d</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(t.valor_face)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {atualizado.has(t.id!) ? brl(atualizado.get(t.id!)) : '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{t.status_producao ?? '—'}</TableCell>
                    </TableRow>
                  )
                })}
                {filtrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      {titulos.length === 0
                        ? 'Nenhum título em aberto para este grupo.'
                        : 'Nenhum título com esses filtros.'}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm">
            <strong>{escolhidos.length}</strong> selecionado(s) · face <strong>{brl(totalFace)}</strong> ·
            atualizado <strong>{brl(totalAtualizado)}</strong>
            <span className="text-xs text-muted-foreground">
              {' '}
              (em {data(dataBase)}, com honorários)
            </span>
          </p>
        </CardContent>
      </Card>

      {/* (c) escopo e parâmetros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. Escopo, parâmetros e responsável</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Quem é notificado</Label>
              <Select value={escopo} onValueChange={(v) => setEscopo(v as EscopoNotificacao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ESCOPO_NOTIFICACAO_LABELS) as EscopoNotificacao[]).map((e) => (
                    <SelectItem key={e} value={e}>
                      {ESCOPO_NOTIFICACAO_LABELS[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {escopo === 'sacado_e_cedente' ? (
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={matrizCedente} onCheckedChange={setMatrizCedente} />
                <span>
                  Notificar a matriz do cedente
                  <span className="block text-xs text-muted-foreground">
                    Com a opção ligada, a matriz do cedente recebe o consolidado e cada filial o dela. Desligada,
                    cada CNPJ cedente recebe só o que cedeu.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="space-y-1">
              <Label>Responsável</Label>
              <Select value={responsavel || 'eu'} onValueChange={(v) => setResponsavel(v === 'eu' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eu">Eu</SelectItem>
                  {(usuarios.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="obs">Observações</Label>
              <Textarea id="obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Parâmetros de atualização da dívida desta cobrança. O padrão das configurações aparece ao lado;
              mudar aqui não muda o padrão.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ParametroNumero rotulo="Juros de mora (% a.m.)" valor={juros} onChange={setJuros} padrao={config.calculo.juros_mora_mes} />
              <ParametroNumero rotulo="Multa (%)" valor={multa} onChange={setMulta} padrao={config.calculo.multa_pct} />
              <ParametroNumero
                rotulo="Honorários (%)"
                valor={honorarios}
                onChange={setHonorarios}
                padrao={config.calculo.honorarios_pct}
              />
              <div className="space-y-1">
                <Label>Índice de correção</Label>
                <Select value={indice} onValueChange={(v) => setIndice(v as IndiceCobranca)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICES_COBRANCA.map((i) => (
                      <SelectItem key={i} value={i}>
                        {INDICE_COBRANCA_LABELS[i]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">padrão: {INDICE_COBRANCA_LABELS[config.calculo.indice]}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="data-base">Data-base</Label>
                <Input id="data-base" type="date" value={dataBase} onChange={(e) => setDataBase(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">padrão: hoje</p>
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <Switch checked={proRata} onCheckedChange={setProRata} />
                Juros pro rata die
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* (d) prévia */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">4. Quem recebe o quê</CardTitle>
          <CardDescription>
            A matriz recebe uma carta com todos os títulos do grupo; cada SPE/filial devedora recebe uma carta
            só com os dela. Título devido pela própria matriz entra só na consolidada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {escolhidos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Selecione títulos para ver o agrupamento.</p>
          ) : erroPrevia ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {erroPrevia}
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {previa.map((p) => {
                const ts = escolhidos.filter((t) => p.titulo_ids.includes(t.id!))
                const face = ts.reduce((s, t) => s + Number(t.valor_face ?? 0), 0)
                const atual = ts.reduce((s, t) => s + (atualizado.get(t.id!) ?? 0), 0)
                return (
                  <div key={p.destinatario_cnpj} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{nomeDe(p.destinatario_cnpj)}</span>
                      <Badge variant={p.papel === 'sacado_matriz' ? 'default' : 'outline'} className="text-[10px]">
                        {PAPEL_NOTIFICACAO_COBRANCA_LABELS[p.papel]}
                      </Badge>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{cnpj(p.destinatario_cnpj)}</div>
                    <div className="mt-1 text-xs">
                      {ts.length} título(s) · face {brl(face)} · atualizado {brl(atual)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* (e) confirmação */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">5. Confirmar</CardTitle>
          <CardDescription>
            Confirmar cria a cobrança em rascunho e gera as minutas em PDF. Nada é enviado agora: o envio é
            um passo seu, na tela da cobrança.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <TextoAvisoApolice />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={aceitarAgora}
              onChange={(e) => setAceitarAgora(e.target.checked)}
            />
            Li o aviso e já registro o aceite agora (sem ele, o aviso volta antes do primeiro envio).
          </label>
          <div className="flex justify-end">
            <Button disabled={escolhidos.length === 0 || Boolean(erroPrevia) || criando} onClick={confirmar}>
              {criando ? 'Criando e gerando minutas…' : `Criar cobrança com ${escolhidos.length} título(s)`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function ParametroNumero({
  rotulo,
  valor,
  onChange,
  padrao,
}: {
  rotulo: string
  valor: string
  onChange: (v: string) => void
  padrao: number
}) {
  const id = React.useId()
  const mudou = numOuNull(valor) !== null && numOuNull(valor) !== padrao
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input id={id} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value)} />
      <p className={cn('text-[11px]', mudou ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
        padrão: {padrao.toLocaleString('pt-BR')}
        {mudou ? ' (alterado nesta cobrança)' : ''}
      </p>
    </div>
  )
}
