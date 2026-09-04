'use client'

import * as React from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXAS,
  FAIXA_LABELS,
  TIPAGENS,
  TIPAGEM_LABELS,
  type EstagioFunil,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { atribuirNfAction } from '@/actions/comercial'
import { buscarVendedores, comercialKeys } from '@/components/comercial/queries'
import { useDebounce } from '@/components/empresas/use-debounce'
import { cn } from '@/lib/utils'
import { formatarInteiro, formatarMoeda } from './format'
import { NotaCard } from './nota-card'
import { DonoDoCard } from '@/components/comercial/dono-do-card'
import {
  ORDENS_FUNIL,
  PAGINA_FUNIL,
  buscarContasDosSacados,
  mapaDeContas,
  antecipacaoKeys,
  buscarConfig,
  buscarFornecedores,
  buscarFunil,
  type FiltrosFunil,
  type FornecedorFunil,
  type OrdemFunil,
} from './queries'

/**
 * O Kanban do funil (§5).
 *
 * UMA CONSULTA POR COLUNA, não uma consulta grande fatiada no cliente: cada
 * coluna tem sua própria contagem exata e sua própria paginação, então "A
 * prospectar (4.812)" é o número verdadeiro mesmo quando só 40 cards estão
 * pintados. Fatiar no cliente daria a contagem do que foi baixado — que é
 * exatamente o número que ninguém quer.
 *
 * As colunas ABERTAS ficam lado a lado; convertida/perdida/expirada moram numa
 * coluna "Encerradas" só. Elas são o resultado, não trabalho — dar a cada uma sua
 * própria coluna encheria a tela de histórico e empurraria o que importa para
 * fora do viewport.
 *
 * NÃO tem drag-and-drop de propósito: mover para "perdida" exige motivo, e um
 * gesto de arrastar que abre um diálogo obrigatório é pior que um menu. O menu do
 * card faz a mesma coisa em dois cliques, com o motivo onde ele precisa estar.
 *
 * ─── AS 40 DEIXARAM DE SER O TETO ───────────────────────────────────────────
 * Cada coluna é uma `useInfiniteQuery` e continua carregando de 40 em 40 até
 * acabar — a nota 41 existia e não tinha caminho até ela a não ser adivinhar um
 * filtro que a trouxesse para o topo. O que não mudou é o TOTAL: ele continua
 * vindo do `count` da primeira página, e não da soma do que foi pintado.
 */

const COLUNAS: readonly (EstagioFunil | 'encerradas')[] = [...ESTAGIOS_ABERTOS, 'encerradas']

const TITULO_COLUNA: Record<string, string> = {
  ...ESTAGIO_FUNIL_LABELS,
  encerradas: 'Encerradas',
}

/** Sentinelas do filtro por originador, para caberem num `<Select>` de strings. */
const TODOS = '__todos__'
const SEM_DONO = '__sem_dono__'

/** Quantas páginas a coluna busca sozinha antes de exigir um clique. Ver `ColunaFunil`. */
const AUTO_PAGINAS = 4

/**
 * `vendedorId` recorta o mesmo Kanban para UMA carteira — é o funil de NFs do
 * originador. Mesma tela, mesmas ações: o trabalho é idêntico, o que muda é o escopo.
 *
 * Para o GESTOR o recorte é só o ponto de partida: ele abre na própria carteira,
 * que é o que ele quase sempre quer, e troca de originador no seletor sem sair da
 * tela. Para quem não é gestor o recorte é uma trava — trocar de carteira ali
 * seria ver a fila de outra pessoa, que é decisão de distribuição e não de
 * visualização.
 */
export function FunilKanban({
  vendedorId,
  ehGestor = false,
  padraoComercial = false,
}: { vendedorId?: string; ehGestor?: boolean; padraoComercial?: boolean } = {}) {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [atribuindo, setAtribuindo] = React.useState<string | null>(null)
  const [faixa, setFaixa] = React.useState<Faixa | undefined>()
  const [tipagem, setTipagem] = React.useState<Tipagem | undefined>()
  const [ordem, setOrdem] = React.useState<OrdemFunil>('receita')
  const [ordemAsc, setOrdemAsc] = React.useState(false)
  const [originador, setOriginador] = React.useState<string>(vendedorId ?? TODOS)

  // Os intervalos moram em texto até serem aplicados: um `Number('')` no meio da
  // digitação viraria `0` e o filtro passaria a esconder tudo enquanto se digita.
  const [valorMin, setValorMin] = React.useState('')
  const [valorMax, setValorMax] = React.useState('')
  const [emissaoDe, setEmissaoDe] = React.useState('')
  const [emissaoAte, setEmissaoAte] = React.useState('')
  const [vencDe, setVencDe] = React.useState('')
  const [vencAte, setVencAte] = React.useState('')

  const termoDebounced = useDebounce(termo, 350)
  const valorMinD = useDebounce(valorMin, 400)
  const valorMaxD = useDebounce(valorMax, 400)

  const travadoNoVendedor = Boolean(vendedorId) && !ehGestor
  const vendedorEfetivo = travadoNoVendedor
    ? vendedorId
    : originador === TODOS || originador === SEM_DONO
      ? undefined
      : originador
  const semDono = !travadoNoVendedor && originador === SEM_DONO

  const { data: config } = useQuery({
    queryKey: antecipacaoKeys.config(),
    queryFn: buscarConfig,
    staleTime: 10 * 60 * 1000,
  })
  const minimoOperavel =
    (config?.funil as { minimo_operavel_dias?: number } | undefined)?.minimo_operavel_dias ?? 7

  /*
   * A lista de vendedores só é buscada quando ela serve para alguma coisa — ou
   * seja, quando o funil NÃO está travado numa carteira. Ali ela não alimenta nem
   * o seletor nem o dono do card, e não vale uma ida ao banco.
   */
  const vendedores = useQuery({
    queryKey: comercialKeys.vendedores(),
    queryFn: buscarVendedores,
    enabled: !travadoNoVendedor,
    staleTime: 5 * 60_000,
  })
  const nomePorId = new Map((vendedores.data ?? []).map((v) => [v.id, v.nome]))

  /*
   * Quem titulariza NF é o ORIGINADOR (04k §4) — é o papel que o dono do card
   * oferece. A carteira de quem abriu entra na lista mesmo se for de outro tipo:
   * sem isso, um gestor cadastrado como `vendedor` abriria a tela com o seletor
   * apontando para um item que não existe, e o próprio nome dele sumiria.
   */
  const originadores = (vendedores.data ?? []).filter(
    (v) => v.tipo === 'originador' || v.id === vendedorId,
  )

  async function atribuir(accessKey: string, destino: string) {
    setAtribuindo(accessKey)
    const r = await atribuirNfAction({ access_key: accessKey, vendedor_id: destino })
    setAtribuindo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Nota agora é de ${nomePorId.get(destino) ?? 'outro originador'}.`)
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  const base: FiltrosFunil = React.useMemo(
    () => ({
      termo: termoDebounced || undefined,
      faixa,
      tipagem,
      vendedorId: vendedorEfetivo,
      semDono: semDono || undefined,
      valorMin: numeroOuNada(valorMinD),
      valorMax: numeroOuNada(valorMaxD),
      emissaoDe: emissaoDe || undefined,
      emissaoAte: emissaoAte || undefined,
      vencimentoDe: vencDe || undefined,
      vencimentoAte: vencAte || undefined,
      ordem,
      ordemAsc,
    }),
    [
      termoDebounced,
      faixa,
      tipagem,
      vendedorEfetivo,
      semDono,
      valorMinD,
      valorMaxD,
      emissaoDe,
      emissaoAte,
      vencDe,
      vencAte,
      ordem,
      ordemAsc,
    ],
  )

  // O total de cada coluna sobe para cá porque o cabeçalho do cartão soma os
  // cinco. Sobe como CONTAGEM, não como lista: as notas ficam na coluna que as
  // carregou, e o pai não precisa delas para nada.
  const [totais, setTotais] = React.useState<Record<string, number>>({})
  const anotarTotal = React.useCallback((estagio: string, total: number | null) => {
    // `null` é "ainda não sei". Gravá-lo como zero faria a soma cair enquanto as
    // colunas carregam, e um total que desce sozinho é lido como nota sumindo.
    if (total === null) return
    setTotais((atual) => (atual[estagio] === total ? atual : { ...atual, [estagio]: total }))
  }, [])

  // Filtro novo, contagem nova. Sem isto o cabeçalho continuaria somando os totais
  // do filtro anterior enquanto as cinco colunas recarregam — um número certo
  // sobre uma pergunta que já não é a da tela.
  React.useEffect(() => setTotais({}), [base])

  const totalGeral = COLUNAS.reduce((soma, c) => soma + (totais[c] ?? 0), 0)
  const totalConhecido = COLUNAS.every((c) => totais[c] !== undefined)

  const intervalosAtivos = Boolean(
    valorMin || valorMax || emissaoDe || emissaoAte || vencDe || vencAte,
  )
  const filtrando = Boolean(
    termoDebounced || faixa || tipagem || intervalosAtivos || (!travadoNoVendedor && originador !== TODOS),
  )

  function limpar() {
    setTermo('')
    setFaixa(undefined)
    setTipagem(undefined)
    setValorMin('')
    setValorMax('')
    setEmissaoDe('')
    setEmissaoAte('')
    setVencDe('')
    setVencAte('')
    if (!travadoNoVendedor) setOriginador(TODOS)
  }

  const filtros = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[16rem] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar por fornecedor, sacado, CNPJ ou número da nota"
          aria-label="Buscar no funil"
          className="pl-9"
        />
      </div>

      {/*
        O filtro por originador. Aparece quando a tela NÃO está travada numa
        carteira — que é exatamente a mesma condição em que o dono aparece no
        card. Se dá para ver de quem é cada nota, dá para pedir só as de alguém;
        o contrário seria esconder um filtro sobre um dado que já está na tela.
      */}
      {!travadoNoVendedor && (
        <Select value={originador} onValueChange={setOriginador}>
          <SelectTrigger className="h-9 w-[13rem]" aria-label="Filtrar por originador">
            <SelectValue placeholder="Originador" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os originadores</SelectItem>
            <SelectItem value={SEM_DONO}>Sem dono</SelectItem>
            {originadores.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.nome}
                {v.ativo === false ? ' (inativo)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1">
        {FAIXAS.map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={faixa === f ? 'default' : 'outline'}
            aria-pressed={faixa === f}
            onClick={() => setFaixa(faixa === f ? undefined : f)}
          >
            {FAIXA_LABELS[f]}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {TIPAGENS.map((t) => (
          <Button
            key={t}
            type="button"
            size="sm"
            variant={tipagem === t ? 'default' : 'outline'}
            aria-pressed={tipagem === t}
            onClick={() => setTipagem(tipagem === t ? undefined : t)}
          >
            {TIPAGEM_LABELS[t]}
          </Button>
        ))}
      </div>

      {/* Ordenação: o critério e o sentido são dois controles porque são duas
          decisões. "Vencimento, do maior para o menor" e "vencimento, do mais
          próximo" são a mesma coluna e perguntas opostas. */}
      <div className="flex items-center gap-1">
        <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemFunil)}>
          <SelectTrigger className="h-9 w-[12rem]" aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ORDENS_FUNIL) as OrdemFunil[]).map((k) => (
              <SelectItem key={k} value={k}>
                {ORDENS_FUNIL[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-9 w-9"
          aria-label={ordemAsc ? 'Ordem crescente — clique para decrescente' : 'Ordem decrescente — clique para crescente'}
          title={ordemAsc ? 'Do menor para o maior' : 'Do maior para o menor'}
          onClick={() => setOrdemAsc((v) => !v)}
        >
          {ordemAsc ? (
            <ArrowUpNarrowWide className="h-4 w-4" aria-hidden />
          ) : (
            <ArrowDownWideNarrow className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>

      {/* Os intervalos num popover: são seis campos que quase sempre estão vazios,
          e seis campos vazios permanentes tirariam a barra de busca da primeira
          linha em qualquer tela menor que um monitor largo. */}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant={intervalosAtivos ? 'default' : 'outline'}>
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden />
            Valor e datas
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-4" align="end">
          <Intervalo
            titulo="Valor da nota"
            de={valorMin}
            ate={valorMax}
            onDe={setValorMin}
            onAte={setValorMax}
            tipo="number"
            rotuloDe="Mínimo"
            rotuloAte="Máximo"
            id="valor"
          />
          <Intervalo
            titulo="Emissão"
            de={emissaoDe}
            ate={emissaoAte}
            onDe={setEmissaoDe}
            onAte={setEmissaoAte}
            tipo="date"
            id="emissao"
          />
          <Intervalo
            titulo="Vencimento"
            de={vencDe}
            ate={vencAte}
            onDe={setVencDe}
            onAte={setVencAte}
            tipo="date"
            id="vencimento"
          />
          {intervalosAtivos && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setValorMin('')
                setValorMax('')
                setEmissaoDe('')
                setEmissaoAte('')
                setVencDe('')
                setVencAte('')
              }}
            >
              Limpar valor e datas
            </Button>
          )}
        </PopoverContent>
      </Popover>

      {filtrando && (
        <Button type="button" variant="ghost" size="sm" onClick={limpar}>
          <X className="mr-1 h-3.5 w-3.5" aria-hidden />
          Limpar
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void qc.invalidateQueries({ queryKey: [...antecipacaoKeys.all, 'funil'] })}
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
        Atualizar
      </Button>
    </div>
  )

  /*
   * As colunas em DUAS formas, e a diferença é só a moldura.
   *
   * Em /antecipacao o funil é a tela inteira e mora numa grade de cinco. Em
   * /comercial/nfs ele é um funil entre quatro irmãos — reuniões, vendas, NFs e
   * certificados — e ali a forma tem de ser a mesma dos outros três: um cartão com
   * cabeçalho, cabeçalhos de coluna discretos e rolagem horizontal. Duas telas que
   * respondem à mesma pergunta com layouts diferentes obrigam a pessoa a reaprender a
   * ler a cada troca de menu.
   *
   * O NotaCard NÃO muda: o que se lê sobre uma nota é o mesmo nos dois lugares.
   */
  const grade = (
    <div
      className={cn(
        padraoComercial ? 'flex gap-3 overflow-x-auto pb-2' : 'grid gap-3 lg:grid-cols-5',
        // `items-start` para que uma coluna alta não estique as vizinhas: o que
        // alinha as colunas é o topo delas, e o topo é o cabeçalho.
        !padraoComercial && 'items-start',
      )}
    >
      {COLUNAS.map((estagio) => (
        <ColunaFunil
          key={estagio}
          estagio={estagio}
          base={base}
          padraoComercial={padraoComercial}
          filtrando={filtrando}
          minimoOperavel={minimoOperavel}
          onTotal={anotarTotal}
          mostrarDono={!vendedorEfetivo}
          nomePorId={nomePorId}
          ehGestor={ehGestor}
          atribuindo={atribuindo}
          onAtribuir={atribuir}
        />
      ))}
    </div>
  )

  if (padraoComercial) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Funil de NFs</CardTitle>
              <CardDescription>
                {totalConhecido ? formatarInteiro(totalGeral) : '…'} nota(s) na carteira.{' '}
                <strong>O card não se move por arrastar</strong> — converter e perder exigem
                decisão, e as duas vivem no menu de ações dentro da nota.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtros}
          {grade}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {filtros}
      {grade}
    </div>
  )
}

// ─── Uma coluna ─────────────────────────────────────────────────────────────

/**
 * A coluna, e a razão de ela ser um componente próprio: cada uma tem a SUA
 * paginação. Uma `useInfiniteQuery` por coluna significa que rolar "A prospectar"
 * até o fim não baixa uma linha sequer de "Em negociação" — e que carregar mais
 * numa não reordena nem repinta as outras quatro.
 */
function ColunaFunil({
  estagio,
  base,
  padraoComercial,
  filtrando,
  minimoOperavel,
  onTotal,
  mostrarDono,
  nomePorId,
  ehGestor,
  atribuindo,
  onAtribuir,
}: {
  estagio: EstagioFunil | 'encerradas'
  base: FiltrosFunil
  padraoComercial: boolean
  filtrando: boolean
  minimoOperavel: number
  onTotal: (estagio: string, total: number | null) => void
  mostrarDono: boolean
  nomePorId: Map<string, string>
  ehGestor: boolean
  atribuindo: string | null
  onAtribuir: (accessKey: string, destino: string) => void | Promise<void>
}) {
  const filtro = React.useMemo(() => ({ ...base, estagio }), [base, estagio])

  const q = useInfiniteQuery({
    queryKey: antecipacaoKeys.funil(filtro),
    queryFn: ({ pageParam }) => buscarFunil(filtro, pageParam),
    initialPageParam: 0,
    /*
     * O total vem da PÁGINA 0 e só dela — é a única que paga o `count`. Somar o
     * que já foi pintado daria "3 de 3" numa coluna de 4.812 e o botão de carregar
     * mais desapareceria na primeira página.
     */
    getNextPageParam: (_ultima, todas) => {
      const total = todas[0]?.total ?? 0
      const carregadas = todas.reduce((s, p) => s + p.notas.length, 0)
      return carregadas < total ? todas.length : undefined
    },
  })

  const notas = React.useMemo(() => q.data?.pages.flatMap((p) => p.notas) ?? [], [q.data])
  const total = q.data?.pages[0]?.total ?? 0
  const valorCarregado = notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)

  React.useEffect(() => {
    onTotal(estagio, q.isPending ? null : total)
  }, [estagio, total, q.isPending, onTotal])

  /*
   * O contexto de fornecedor dos cards PINTADOS, numa leitura só. Sem isto seria
   * um N+1 de uma requisição por card para escrever "+3 notas".
   *
   * A chave é o filtro mais a QUANTIDADE de notas, não a lista de CNPJs: as duas
   * identificam o mesmo conjunto (as notas são função determinística do filtro e
   * da página), e a segunda viraria uma string de dezenas de milhares de
   * caracteres reconstruída a cada render depois de algumas páginas.
   */
  const { data: fornecedores } = useQuery({
    queryKey: [...antecipacaoKeys.all, 'fornecedores-lote', filtro, notas.length],
    queryFn: () =>
      buscarFornecedores(notas.map((n) => n.fornecedor_cnpj).filter((c): c is string => Boolean(c))),
    enabled: notas.length > 0,
    staleTime: 60_000,
  })

  const porCnpj = React.useMemo(() => {
    const m = new Map<string, FornecedorFunil>()
    for (const f of fornecedores ?? []) if (f.fornecedor_cnpj) m.set(f.fornecedor_cnpj, f)
    return m
  }, [fornecedores])

  /*
   * A CONTA de cada sacado pintado, no mesmo formato do lote de fornecedores e
   * pelo mesmo motivo. O card mostra o cliente, não a SPE — e resolver isso na
   * view custaria 58 mil chamadas de `app_holding_do_sacado` por consulta.
   *
   * `staleTime` mais longo que o dos fornecedores: a conta de um sacado muda
   * quando alguém vincula um CNPJ, o que acontece algumas vezes por semana — não
   * a cada carregamento de coluna.
   */
  const { data: contas } = useQuery({
    queryKey: [...antecipacaoKeys.all, 'contas-lote', filtro, notas.length],
    queryFn: () =>
      buscarContasDosSacados(
        notas.map((n) => n.sacado_cnpj).filter((c): c is string => Boolean(c)),
      ),
    enabled: notas.length > 0,
    staleTime: 300_000,
  })

  const contaPorCnpj = React.useMemo(() => mapaDeContas(contas), [contas])

  /*
   * Carrega sozinho quando o fim DESTA coluna entra na tela — e PARA depois de
   * `AUTO_PAGINAS`.
   *
   * O teto não é cautela genérica: "Encerradas" tem 41 mil notas e "A prospectar"
   * 12 mil. Um observador sem limite, num layout onde as cinco colunas dividem a
   * rolagem da página, transformaria uma rolagem até o rodapé em mil requisições e
   * dezenas de milhares de cards no DOM — cada um com tooltip e menu. A aba morre
   * antes de a pessoa perceber por quê.
   *
   * Depois do teto a próxima página existe, mas passa a ser PEDIDA. Quem precisa
   * de uma nota específica lá no fundo tem ordenação e filtros para trazê-la ao
   * topo — que é o caminho barato, e é para isso que eles existem.
   */
  const sentinela = React.useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  const paginasCarregadas = q.data?.pages.length ?? 0
  const podeAutoCarregar = hasNextPage && !isFetchingNextPage && paginasCarregadas < AUTO_PAGINAS

  React.useEffect(() => {
    const alvo = sentinela.current
    if (!alvo || !podeAutoCarregar) return
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '400px' },
    )
    obs.observe(alvo)
    return () => obs.disconnect()
  }, [podeAutoCarregar, fetchNextPage])

  /*
   * O SUBTÍTULO É SEMPRE RENDERIZADO, mesmo vazio.
   *
   * Ele só aparecia quando a coluna tinha notas, e o efeito era que as colunas
   * vazias subiam uma linha: os cabeçalhos ficavam alinhados e os cards não,
   * porque o que os separava do topo tinha altura diferente em cada coluna. Uma
   * grade de Kanban desalinhada é lida como erro de carregamento.
   */
  const subtitulo = q.isPending
    ? ' '
    : notas.length === 0
      ? ' '
      : `${formatarMoeda(valorCarregado)}${total > notas.length ? ` nos ${notas.length} carregados` : ''}`

  return (
    <section className={cn('flex flex-col gap-2', padraoComercial ? 'w-72 shrink-0' : 'min-w-0')}>
      {padraoComercial ? (
        <header className="border-b pb-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-xs font-medium">{TITULO_COLUNA[estagio]}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {q.isPending ? '…' : formatarInteiro(total)}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] tabular-nums leading-tight text-muted-foreground">
            {subtitulo}
          </p>
        </header>
      ) : (
        <>
          <header className="flex items-baseline justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
            <h2 className="truncate text-sm font-medium">{TITULO_COLUNA[estagio]}</h2>
            <Badge variant="secondary" className="tabular-nums">
              {q.isPending ? '…' : formatarInteiro(total)}
            </Badge>
          </header>
          <p className="px-1 text-xs tabular-nums text-muted-foreground">{subtitulo}</p>
        </>
      )}

      <div className="flex flex-col gap-2">
        {q.isPending ? (
          <>
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </>
        ) : q.isError ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {q.error instanceof Error ? q.error.message : 'Erro ao carregar.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : notas.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-xs text-muted-foreground">
              {filtrando ? 'Nada com estes filtros.' : 'Nenhuma nota aqui.'}
            </p>
          </div>
        ) : (
          <>
            {notas.map((nota) => (
              <NotaCard
                conta={nota.sacado_cnpj ? contaPorCnpj.get(nota.sacado_cnpj) : null}
                key={nota.access_key}
                nota={nota}
                fornecedor={nota.fornecedor_cnpj ? porCnpj.get(nota.fornecedor_cnpj) : undefined}
                minimoOperavel={minimoOperavel}
                dono={
                  // Só quando a lista não está recortada num originador: ali o nome
                  // repetiria em cada card o que o filtro no topo já diz.
                  mostrarDono ? (
                    <DonoDoCard
                      nome={nota.vendedor_id ? (nomePorId.get(nota.vendedor_id) ?? null) : null}
                      tipos={['originador']}
                      podeTrocar={ehGestor}
                      ocupado={atribuindo === nota.access_key}
                      onTrocar={(id) => onAtribuir(nota.access_key ?? '', id)}
                    />
                  ) : undefined
                }
              />
            ))}

            <div ref={sentinela} aria-hidden />

            {q.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                    Carregando…
                  </>
                ) : (
                  `Carregar mais ${Math.min(PAGINA_FUNIL, total - notas.length)} de ${formatarInteiro(total - notas.length)} restantes`
                )}
              </Button>
            ) : null}

            {q.hasNextPage && total - notas.length > 500 ? (
              <p className="px-1 text-center text-[11px] leading-snug text-muted-foreground">
                São muitas. Ordenar e filtrar chega na nota mais rápido do que rolar até ela.
              </p>
            ) : null}

            {!q.hasNextPage && (
              total > PAGINA_FUNIL && (
                <p className="px-1 pb-2 text-center text-xs text-muted-foreground">
                  Fim da coluna — {formatarInteiro(total)} nota(s).
                </p>
              )
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ─── Auxiliares ─────────────────────────────────────────────────────────────

/** Dois campos "de/até" com o mesmo desenho, para os três intervalos. */
function Intervalo({
  titulo,
  de,
  ate,
  onDe,
  onAte,
  tipo,
  id,
  rotuloDe = 'De',
  rotuloAte = 'Até',
}: {
  titulo: string
  de: string
  ate: string
  onDe: (v: string) => void
  onAte: (v: string) => void
  tipo: 'number' | 'date'
  id: string
  rotuloDe?: string
  rotuloAte?: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">{titulo}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-de`} className="text-[11px] text-muted-foreground">
            {rotuloDe}
          </Label>
          <Input
            id={`${id}-de`}
            type={tipo}
            value={de}
            onChange={(e) => onDe(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-ate`} className="text-[11px] text-muted-foreground">
            {rotuloAte}
          </Label>
          <Input
            id={`${id}-ate`}
            type={tipo}
            value={ate}
            onChange={(e) => onAte(e.target.value)}
            className="h-8"
          />
        </div>
      </div>
    </div>
  )
}

/** `''` e lixo viram `undefined` — um `Number('')` seria `0`, que filtra tudo. */
function numeroOuNada(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function FunilCarregando() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-3 lg:grid-cols-5">
        {COLUNAS.map((c) => (
          <Card key={c}>
            <CardContent className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export { COLUNAS as COLUNAS_FUNIL }
