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
  SITUACAO_RECONCILIACAO_LABELS,
  agruparNotificacoes,
  atualizarDividaCobranca,
  explicarReconciliacao,
  hojeSaoPaulo,
  type EscopoNotificacao,
  type IndiceCobranca,
  type NotificacaoAgrupada,
  type ParametrosAtualizacao,
  type ReconciliacaoGrupo,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
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
  buscarReconciliacao,
  buscarTabelaIndices,
  buscarTitulosAbertosDoGrupo,
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

const DESCRICAO_ESCOPO: Record<EscopoNotificacao, string> = {
  sacado: 'A matriz recebe o consolidado do grupo; cada SPE/filial, só os títulos dela.',
  sacado_e_cedente: 'Além do sacado, cada cedente recebe a carta dos títulos que cedeu.',
}

/** O status de liquidação da produção, em português (0273). */
const STATUS_PRODUCAO_LABELS: Record<string, string> = {
  OPEN: 'Em aberto',
  PARTIALLY_PAID: 'Pago em parte',
  PAID: 'Pago',
}

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

  const reconciliacao = useQuery({
    queryKey: cobrancaKeys.reconciliacao(matriz ?? ''),
    queryFn: () => buscarReconciliacao([matriz!]),
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
            // Sem a reconciliação (erro ou ainda carregando) a tela cai no aviso genérico:
            // melhor do que travar a montagem esperando um dado que é só de apoio.
            reconciliacao={reconciliacao.data?.get(matriz) ?? null}
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
  const matrizes = (grupos.data ?? []).map((g) => g.matriz).sort().join(',')
  const reconciliacao = useQuery({
    queryKey: cobrancaKeys.reconciliacao(matrizes),
    queryFn: () => buscarReconciliacao(matrizes.split(',').filter(Boolean)),
    enabled: matrizes.length > 0,
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
                <BadgeDoGrupo r={reconciliacao.data?.get(g.matriz)} qtdAbertos={g.qtdAbertos} />
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

/**
 * O que a lista de grupos mostra: quantos VENCIDOS (e não quantos em aberto — a maior
 * parte do aberto ainda vai vencer e não é cobrável) e o que a plataforma diz deles.
 */
function BadgeDoGrupo({ r, qtdAbertos }: { r: ReconciliacaoGrupo | undefined; qtdAbertos: number }) {
  if (!r) return <Badge variant="secondary">{qtdAbertos} em aberto</Badge>
  if (r.situacao === 'sem_vencidos') return <Badge variant="outline">sem vencidos</Badge>
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <Badge variant="secondary">{r.qtd_vencidos} vencido(s)</Badge>
      {r.situacao === 'em_dia' ? (
        <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
          {SITUACAO_RECONCILIACAO_LABELS.em_dia}
        </span>
      ) : r.situacao === 'parcial' ? (
        <span className="text-[11px] text-amber-700 dark:text-amber-400">
          ~{brl(r.vencido_estimado, 0)} de fato em aberto
        </span>
      ) : r.situacao === 'sem_dado' ? (
        <span className="text-[11px] text-muted-foreground">{SITUACAO_RECONCILIACAO_LABELS.sem_dado}</span>
      ) : null}
    </span>
  )
}

// ─── (b)–(e) Títulos, escopo, prévia, confirmação ───────────────────────────

function Montagem({
  matriz,
  titulos,
  reconciliacao,
  config,
  selecionados,
  setSelecionados,
  onCriada,
}: {
  matriz: string
  titulos: TituloAberto[]
  reconciliacao: ReconciliacaoGrupo | null
  config: Awaited<ReturnType<typeof buscarConfigCobranca>>
  selecionados: Set<string>
  setSelecionados: (s: Set<string>) => void
  onCriada: (id: string) => void
}) {
  const minimo = config.cobranca.dias_inicio_cobranca
  const [fCedente, setFCedente] = React.useState('todos')
  const [fSpe, setFSpe] = React.useState('todas')
  const [fFaixa, setFFaixa] = React.useState('todas')
  // A lista abre só nos VENCIDOS: é o que se cobra. Os a vencer ficam a um clique, para
  // a pessoa entender o tamanho do grupo — mas não disputam a atenção com o que importa.
  const [mostrarAVencer, setMostrarAVencer] = React.useState(false)
  const [confirmoEmDia, setConfirmoEmDia] = React.useState(false)
  const emDia = reconciliacao?.situacao === 'em_dia'

  const [escopo, setEscopo] = React.useState<EscopoNotificacao>('sacado')
  const [matrizCedente, setMatrizCedente] = React.useState(true)
  const [observacoes, setObservacoes] = React.useState('')
  const [juros, setJuros] = React.useState(String(config.calculo.juros_mora_mes))
  const [multa, setMulta] = React.useState(String(config.calculo.multa_pct))
  const [honorarios, setHonorarios] = React.useState(String(config.calculo.honorarios_pct))
  const [indice, setIndice] = React.useState<IndiceCobranca>(config.calculo.indice)
  const [proRata, setProRata] = React.useState(config.calculo.juros_pro_rata)
  const [dataBase, setDataBase] = React.useState(hojeSaoPaulo())
  const [aceitarAgora, setAceitarAgora] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  const tabela = useQuery({ queryKey: cobrancaKeys.indices(indice), queryFn: () => buscarTabelaIndices(indice) })

  const parametrosAlterados =
    (numOuNull(juros) ?? config.calculo.juros_mora_mes) !== config.calculo.juros_mora_mes ||
    (numOuNull(multa) ?? config.calculo.multa_pct) !== config.calculo.multa_pct ||
    (numOuNull(honorarios) ?? config.calculo.honorarios_pct) !== config.calculo.honorarios_pct ||
    indice !== config.calculo.indice ||
    proRata !== config.calculo.juros_pro_rata ||
    dataBase !== hojeSaoPaulo()

  function restaurarParametros() {
    setJuros(String(config.calculo.juros_mora_mes))
    setMulta(String(config.calculo.multa_pct))
    setHonorarios(String(config.calculo.honorarios_pct))
    setIndice(config.calculo.indice)
    setProRata(config.calculo.juros_pro_rata)
    setDataBase(hojeSaoPaulo())
  }

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
        .filter((t) => t.id && t.vencimento_vigente)
        // Juros e correção contam do vencimento VIGENTE (0276): é a data que o sacado combinou.
        .map((t) => ({
          id: t.id!,
          valor_face: Number(t.saldo_em_aberto ?? t.valor_face ?? 0),
          vencimento: t.vencimento_vigente!,
        })),
      parametros,
      tabela.data,
      dataBase || hojeSaoPaulo(),
    )
    for (const l of r.memoria) m.set(l.operacao_id, l.subtotal * (1 + parametros.honorarios_pct / 100))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulos, tabela.data, juros, multa, honorarios, indice, proRata, dataBase])

  // Em atraso só depois da liquidação esperada (0275): o boleto de sábado é pago na
  // segunda e compensa na terça — antes disso ele não é "vencido", é "compensando".
  const vencido = (t: TituloAberto) => t.em_atraso === true
  /*
   * Grupo em dia pela plataforma (0270): o limite consumido já não cobre os vencidos,
   * então o sacado provavelmente pagou — a produção só não marcou a liquidação. Os
   * vencidos continuam na lista (a estimativa é do grupo, não do título), mas só ficam
   * selecionáveis depois de a pessoa dizer que conferiu. Uma carta de cobrança de
   * título pago é o pior começo de conversa.
   */
  const provavelmentePago = (t: TituloAberto) => emDia && vencido(t)
  const elegivel = (t: TituloAberto) =>
    !t.cobranca_ativa_id && (t.dias_atraso ?? 0) >= minimo && (!provavelmentePago(t) || confirmoEmDia)

  // Desconfirmou: o que só estava marcado por causa da confirmação sai da seleção.
  React.useEffect(() => {
    if (confirmoEmDia || !emDia) return
    const s = new Set([...selecionados].filter((id) => !titulos.some((t) => t.id === id && provavelmentePago(t))))
    if (s.size !== selecionados.size) setSelecionados(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmoEmDia, emDia])

  const cedentes = [...new Map(titulos.map((t) => [t.cedente_cnpj ?? '', t.cedente_nome ?? t.cedente_cnpj ?? ''])).entries()]
  const spes = [...new Map(titulos.map((t) => [t.sacado_cnpj ?? '', t.sacado_nome ?? t.sacado_cnpj ?? ''])).entries()]
  const faixaSel = FAIXAS.find((f) => f.id === fFaixa)

  const qtdAVencer = titulos.filter((t) => !vencido(t)).length
  const filtrados = titulos.filter((t) => {
    if (!mostrarAVencer && !vencido(t)) return false
    if (fCedente !== 'todos' && t.cedente_cnpj !== fCedente) return false
    if (fSpe !== 'todas' && t.sacado_cnpj !== fSpe) return false
    if (faixaSel && ((t.dias_atraso ?? 0) < faixaSel.de || (t.dias_atraso ?? 0) > faixaSel.ate)) return false
    return true
  })
  const elegiveisFiltrados = filtrados.filter(elegivel)
  const todosMarcados = elegiveisFiltrados.length > 0 && elegiveisFiltrados.every((t) => selecionados.has(t.id!))

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
  const totalFace = escolhidos.reduce((s, t) => s + Number(t.saldo_em_aberto ?? t.valor_face ?? 0), 0)
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
    // A confirmação vai para a cobrança: é a prova de que alguém olhou o sinal da
    // plataforma e decidiu cobrar mesmo assim — e quem, e com que número à frente.
    const incluiuProvavelPago = emDia && escolhidos.some((t) => provavelmentePago(t))
    const observacaoFinal = [
      incluiuProvavelPago && reconciliacao
        ? `Seleção confirmada apesar de a plataforma registrar o grupo em dia (limite consumido ` +
          `${brl(reconciliacao.consumido)} para ${brl(reconciliacao.a_vencer)} a vencer` +
          `${reconciliacao.consumido_em ? `, em ${data(reconciliacao.consumido_em)}` : ''}).`
        : null,
      observacoes.trim() || null,
    ]
      .filter(Boolean)
      .join('\n\n')
    const r = await criarCobrancaAction({
      titulo_ids: [...selecionados],
      escopo_notificacao: escopo,
      notificar_matriz_cedente: matrizCedente,
      juros_mora_mes: parametros.juros_mora_mes,
      multa_pct: parametros.multa_pct,
      honorarios_pct: parametros.honorarios_pct,
      indice_correcao: parametros.indice,
      juros_pro_rata: parametros.juros_pro_rata,
      ...(dataBase ? { data_base: dataBase } : {}),
      ...(observacaoFinal ? { observacoes: observacaoFinal } : {}),
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
          <CardTitle className="text-base">2. Títulos vencidos do grupo</CardTitle>
          <CardDescription>
            Matriz e todas as SPEs/filiais. Títulos com menos de {minimo} dias de atraso ainda são da
            plataforma de produção e não podem entrar; os que já estão em outra cobrança aparecem
            bloqueados, com o link para ela.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {reconciliacao && reconciliacao.situacao !== 'sem_vencidos' ? (
            <AvisoReconciliacao
              r={reconciliacao}
              confirmado={confirmoEmDia}
              onConfirmar={setConfirmoEmDia}
            />
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

          <div className="flex items-center gap-2">
            <Switch id="mostrar-a-vencer" checked={mostrarAVencer} onCheckedChange={setMostrarAVencer} />
            <Label htmlFor="mostrar-a-vencer" className="text-sm font-normal">
              Mostrar também os {qtdAVencer} título(s) a vencer
            </Label>
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
                    : !vencido(t)
                      ? 'A vencer'
                      : (t.dias_atraso ?? 0) < minimo
                        ? `Menos de ${minimo} dias de atraso`
                        : provavelmentePago(t)
                          ? confirmoEmDia
                            ? 'Provavelmente pago — cobrança confirmada'
                            : 'Provavelmente pago (plataforma sem saldo)'
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
                      <TableCell className="text-xs">
                        {data(t.vencimento_vigente)}
                        {t.vencimento_prorrogado ? (
                          <span className="block text-[10px] text-muted-foreground" title="A apólice conta do original">
                            original {data(t.vencimento)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.dias_atraso ?? 0} d</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {brl(t.saldo_em_aberto ?? t.valor_face)}
                        {t.status === 'parcial' ? (
                          <span className="block text-[10px] text-muted-foreground">de {brl(t.valor_face)}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {atualizado.has(t.id!) ? brl(atualizado.get(t.id!)) : '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {STATUS_PRODUCAO_LABELS[t.status_producao ?? ''] ?? t.status_producao ?? '—'}
                        {t.migrado ? <span className="block">migrada</span> : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filtrados.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      {titulos.length === 0
                        ? 'Nenhum título em aberto para este grupo.'
                        : !mostrarAVencer && titulos.every((t) => !vencido(t))
                          ? 'Nenhum título vencido neste grupo — os em aberto ainda vão vencer.'
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

      {/* (c) notificação e atualização da dívida */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">3. Notificação e atualização da dívida</CardTitle>
          <CardDescription>
            Quem recebe a carta e como o valor é atualizado. Você fica como responsável por esta cobrança.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-3" aria-labelledby="titulo-escopo">
            <h3 id="titulo-escopo" className="text-sm font-medium">
              Quem é notificado
            </h3>
            <div role="radiogroup" aria-labelledby="titulo-escopo" className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(ESCOPO_NOTIFICACAO_LABELS) as EscopoNotificacao[]).map((e) => {
                const ativo = escopo === e
                return (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => setEscopo(e)}
                    className={cn(
                      'rounded-md border p-3 text-left transition-colors',
                      ativo ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <span className="block text-sm font-medium">{ESCOPO_NOTIFICACAO_LABELS[e]}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{DESCRICAO_ESCOPO[e]}</span>
                  </button>
                )
              })}
            </div>
            {escopo === 'sacado_e_cedente' ? (
              <label className="flex items-start gap-3 rounded-md bg-muted/40 p-3 text-sm">
                <Switch checked={matrizCedente} onCheckedChange={setMatrizCedente} className="mt-0.5" />
                <span>
                  Consolidar na matriz do cedente
                  <span className="block text-xs text-muted-foreground">
                    Ligado, a matriz do cedente recebe o consolidado e cada filial o dela. Desligado, cada CNPJ
                    cedente recebe só o que cedeu.
                  </span>
                </span>
              </label>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-3" aria-labelledby="titulo-parametros">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="titulo-parametros" className="text-sm font-medium">
                Atualização da dívida
              </h3>
              {parametrosAlterados ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={restaurarParametros}>
                  Voltar ao padrão
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Padrão das configurações; mudar aqui vale só para esta cobrança.</span>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                <DicaPadrao mudou={indice !== config.calculo.indice} texto={INDICE_COBRANCA_LABELS[config.calculo.indice]} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="data-base">Data-base</Label>
                <Input id="data-base" type="date" value={dataBase} onChange={(e) => setDataBase(e.target.value)} />
                <DicaPadrao mudou={dataBase !== hojeSaoPaulo()} texto="hoje" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pro-rata">Contagem dos juros</Label>
                <div className="flex h-9 items-center gap-2">
                  <Switch id="pro-rata" checked={proRata} onCheckedChange={setProRata} />
                  <span className="text-sm">{proRata ? 'Pro rata die' : 'Por mês completo'}</span>
                </div>
                <DicaPadrao
                  mudou={proRata !== config.calculo.juros_pro_rata}
                  texto={config.calculo.juros_pro_rata ? 'pro rata die' : 'por mês completo'}
                />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-1">
            <Label htmlFor="obs">
              Observações <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea id="obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </section>
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
                const face = ts.reduce((s, t) => s + Number(t.saldo_em_aberto ?? t.valor_face ?? 0), 0)
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
      <DicaPadrao mudou={mudou} texto={padrao.toLocaleString('pt-BR')} />
    </div>
  )
}

/** A mesma linha embaixo de todo parâmetro, para as colunas alinharem — e o âmbar diz o que mudou. */
function DicaPadrao({ mudou, texto }: { mudou: boolean; texto: string }) {
  return (
    <p className={cn('text-[11px]', mudou ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
      padrão: {texto}
      {mudou ? ' · alterado nesta cobrança' : ''}
    </p>
  )
}

// ─── O que a plataforma diz dos vencidos (0270) ─────────────────────────────

/**
 * A reconciliação do grupo pelo limite consumido. É uma estimativa do GRUPO — diz
 * quanto do vencido segue em aberto, não quais títulos — e a caixa diz isso com as
 * palavras e com os números, para a pessoa conferir a conta em vez de confiar no rótulo.
 */
function AvisoReconciliacao({
  r,
  confirmado,
  onConfirmar,
}: {
  r: ReconciliacaoGrupo
  confirmado: boolean
  onConfirmar: (v: boolean) => void
}) {
  const tom =
    r.situacao === 'confirma'
      ? 'border-border bg-muted/40 text-foreground'
      : r.situacao === 'em_dia'
        ? 'border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
        : 'border-amber-600/30 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'
  const Icone = r.situacao === 'confirma' ? Info : AlertTriangle

  return (
    <div className={cn('space-y-2 rounded-md border p-3 text-xs', tom)}>
      <div className="flex gap-2">
        <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">{SITUACAO_RECONCILIACAO_LABELS[r.situacao]}</p>
          <p>{explicarReconciliacao(r)}</p>
          {r.consumido_em ? (
            <p className="opacity-80">Limite da plataforma lido em {data(r.consumido_em)}.</p>
          ) : null}
        </div>
      </div>
      {r.situacao === 'em_dia' ? (
        <label className="flex items-start gap-2 pl-6">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={confirmado}
            onChange={(e) => onConfirmar(e.target.checked)}
          />
          <span>
            Conferi com a produção/financeiro que os títulos que vou selecionar <strong>não</strong> foram
            pagos. A confirmação fica registrada nas observações da cobrança.
          </span>
        </label>
      ) : null}
    </div>
  )
}
