'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Hash,
  Loader2,
  Rocket,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { descrever, type Grupo } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebounce } from '@/components/empresas/use-debounce'
import { cn } from '@/lib/utils'
import { COLUNAS, useColunasVisiveis } from './colunas'
import { FiltroDialog } from './filtro-dialog'
import {
  ESTADO_INICIAL,
  TAMANHOS_PAGINA,
  escreverEstado,
  lerEstado,
  type EstadoExplorador,
} from './filtro-url'
import { formatNumero } from './format'
import { PromoverSelecaoDialog, type AlvoPromocao } from './promover-selecao-dialog'
import { buscarPagina, contarExato, mercadoKeys, type LinhaExplorador } from './queries'
import { SalvarSegmentoDialog } from './salvar-segmento-dialog'

/**
 * O Explorador. A view `mercado_explorador` tem ~2M linhas, e é isso que dita
 * todas as decisões daqui:
 *
 *  - a paginação é do SERVIDOR (`.range()`), sempre. Não existe "carregar tudo".
 *  - a contagem padrão é a ESTIMATIVA do planner. `count: 'exact'` sobre a view
 *    inteira é um full scan de milhões de linhas em cada tecla digitada; o número
 *    exato existe, mas só quando alguém pede (botão "contar exato") ou quando ele
 *    realmente importa (a contagem de um segmento).
 *  - o estado mora na URL, então uma visão filtrada é um link — o que o Mapa do
 *    Mercado usa para dar deep link em qualquer fatia dos gráficos dele.
 */

/** Promovida → Company 360. Senão → a ficha do universo. */
function rotaDaLinha(linha: LinhaExplorador): string {
  if (linha.empresa_id) return `/empresas/${linha.empresa_id}`
  return `/mercado/universo/${linha.cnpj ?? ''}`
}

function Cabecalho({
  children,
  ativo,
  direcao,
  ordenavel,
  onClick,
  numerica,
}: {
  children: React.ReactNode
  ativo: boolean
  direcao: 'asc' | 'desc'
  ordenavel: boolean
  onClick: () => void
  numerica?: boolean
}) {
  if (!ordenavel) {
    return <TableHead className={numerica ? 'text-right' : undefined}>{children}</TableHead>
  }

  return (
    <TableHead className={cn('whitespace-nowrap', numerica && 'text-right')}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          ativo ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        {ativo &&
          (direcao === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </TableHead>
  )
}

export function Explorador() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const estado = React.useMemo(
    () => lerEstado(new URLSearchParams(searchParams.toString())),
    [searchParams],
  )

  const { colunas, ids: colunasIds, alternar, restaurarPadrao } = useColunasVisiveis()

  const navegar = React.useCallback(
    (proximo: EstadoExplorador) => {
      router.replace(`${pathname}${escreverEstado(proximo)}`, { scroll: false })
    },
    [pathname, router],
  )

  // ─── Busca textual: debounce no VALOR, nunca no input ─────────────────────
  const [termoLocal, setTermoLocal] = React.useState(estado.termo)
  const termoDebounced = useDebounce(termoLocal, 350)

  // Voltar/avançar no navegador (ou um deep link) troca o termo da URL: o input
  // acompanha. Não dispara nada — só quando a URL muda de fato.
  React.useEffect(() => {
    setTermoLocal(estado.termo)
  }, [estado.termo])

  React.useEffect(() => {
    if (termoDebounced !== estado.termo) {
      navegar({ ...estado, termo: termoDebounced, pagina: 0 })
    }
  }, [termoDebounced, estado, navegar])

  // ─── Seleção ──────────────────────────────────────────────────────────────
  // Sobrevive à troca de página: selecionar 50 na página 1, 50 na 2 e promover as
  // 100 é o fluxo real. Guarda o mínimo necessário para promover e reportar.
  const [selecao, setSelecao] = React.useState<Map<string, AlvoPromocao>>(new Map())

  const [filtroAberto, setFiltroAberto] = React.useState(false)
  const [promoverAberto, setPromoverAberto] = React.useState(false)
  const [segmentoAberto, setSegmentoAberto] = React.useState(false)

  const pagina = useQuery({
    queryKey: mercadoKeys.explorador(estado),
    queryFn: () => buscarPagina(estado),
    placeholderData: (anterior) => anterior,
  })

  // Contagem exata: sob demanda. `enabled: false` + refetch — o custo é do
  // usuário que pediu, não de todo mundo que abre a página.
  const exata = useQuery({
    queryKey: mercadoKeys.contagem(estado.arvore, estado.termo),
    queryFn: () => contarExato(estado.termo, estado.arvore),
    enabled: false,
    staleTime: 60_000,
  })

  const linhas = React.useMemo(() => pagina.data?.linhas ?? [], [pagina.data])

  const promoviveis = React.useMemo(
    () => linhas.filter((l) => l.empresa_id === null && l.cnpj !== null),
    [linhas],
  )

  const todasDaPaginaSelecionadas =
    promoviveis.length > 0 && promoviveis.every((l) => selecao.has(l.cnpj ?? ''))

  function alternarLinha(linha: LinhaExplorador) {
    const cnpj = linha.cnpj
    if (!cnpj) return

    setSelecao((atual) => {
      const proxima = new Map(atual)
      if (proxima.has(cnpj)) proxima.delete(cnpj)
      else proxima.set(cnpj, { cnpj, razao_social: linha.razao_social })
      return proxima
    })
  }

  function alternarPagina() {
    setSelecao((atual) => {
      const proxima = new Map(atual)
      if (todasDaPaginaSelecionadas) {
        for (const l of promoviveis) proxima.delete(l.cnpj ?? '')
      } else {
        for (const l of promoviveis) {
          if (l.cnpj) proxima.set(l.cnpj, { cnpj: l.cnpj, razao_social: l.razao_social })
        }
      }
      return proxima
    })
  }

  function ordenarPor(id: string) {
    const mesma = estado.ordem === id
    navegar({
      ...estado,
      ordem: id,
      direcao: mesma && estado.direcao === 'asc' ? 'desc' : 'asc',
      pagina: 0,
    })
  }

  function aplicarArvore(arvore: Grupo) {
    navegar({ ...estado, arvore, pagina: 0 })
  }

  function limparTudo() {
    setTermoLocal('')
    navegar(ESTADO_INICIAL)
  }

  const temFiltro = estado.arvore !== null || estado.termo.trim().length > 0
  const totalColunas = colunas.length + 1 // + a coluna de seleção

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Explorador</h1>
          <p className="text-sm text-muted-foreground">
            Todo o universo de CNPJs da construção — o que a Receita conhece, o que já é nosso, e o
            que dá para virar cliente.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/mercado/segmentos">
            <Bookmark className="mr-2 h-4 w-4" />
            Segmentos
          </Link>
        </Button>
      </div>

      {/* ─── Barra de ferramentas ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={termoLocal}
            onChange={(e) => setTermoLocal(e.target.value)}
            placeholder="Buscar por razão social, nome fantasia ou CNPJ"
            className="pl-9"
            aria-label="Buscar no universo"
          />
        </div>

        <Button
          variant={estado.arvore ? 'default' : 'outline'}
          onClick={() => setFiltroAberto(true)}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filtros
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 className="mr-2 h-4 w-4" />
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUNAS.map((coluna) => (
              <DropdownMenuCheckboxItem
                key={coluna.id}
                checked={colunasIds.includes(coluna.id)}
                disabled={coluna.fixa}
                // O Radix fecha o menu a cada item; escolher 6 colunas com 6
                // reaberturas é hostil.
                onSelect={(evento) => evento.preventDefault()}
                onCheckedChange={() => alternar(coluna.id)}
              >
                {coluna.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => restaurarPadrao()}>
              Restaurar padrão
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select
          value={String(estado.tamanho)}
          onValueChange={(valor) => navegar({ ...estado, tamanho: Number(valor), pagina: 0 })}
        >
          <SelectTrigger className="w-32" aria-label="Linhas por página">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAMANHOS_PAGINA.map((tamanho) => (
              <SelectItem key={tamanho} value={String(tamanho)}>
                {tamanho} / página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {temFiltro && (
          <Button variant="ghost" size="sm" onClick={limparTudo}>
            <X className="mr-2 h-4 w-4" />
            Limpar
          </Button>
        )}
      </div>

      {/* ─── Regra ativa ────────────────────────────────────────────────── */}
      {estado.arvore && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Filtro
          </span>
          <p className="flex-1 text-sm leading-relaxed">{descrever(estado.arvore)}</p>
          <Button size="sm" variant="outline" onClick={() => setSegmentoAberto(true)}>
            <Bookmark className="mr-2 h-3.5 w-3.5" />
            Salvar como segmento
          </Button>
        </div>
      )}

      {/* ─── Barra de seleção ───────────────────────────────────────────── */}
      {selecao.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand/40 bg-brand/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selecao.size} {selecao.size === 1 ? 'selecionada' : 'selecionadas'}
          </span>
          <Button size="sm" onClick={() => setPromoverAberto(true)}>
            <Rocket className="mr-2 h-3.5 w-3.5" />
            Promover para Empresas
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelecao(new Map())}>
            Limpar seleção
          </Button>
          <span className="text-xs text-muted-foreground">
            Só entram no lote empresas ainda não promovidas.
          </span>
        </div>
      )}

      {/* ─── Tabela ─────────────────────────────────────────────────────── */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-input accent-brand"
                  aria-label="Selecionar todas as empresas promovíveis desta página"
                  checked={todasDaPaginaSelecionadas}
                  disabled={promoviveis.length === 0}
                  onChange={alternarPagina}
                />
              </TableHead>
              {colunas.map((coluna) => (
                <Cabecalho
                  key={coluna.id}
                  ativo={estado.ordem === coluna.id}
                  direcao={estado.direcao}
                  ordenavel={Boolean(coluna.ordenarPor)}
                  numerica={coluna.numerica}
                  onClick={() => ordenarPor(coluna.id)}
                >
                  {coluna.label}
                </Cabecalho>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {pagina.isPending ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: totalColunas }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pagina.isError ? (
              <TableRow>
                <TableCell colSpan={totalColunas} className="h-64">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="rounded-full bg-destructive/10 p-3">
                      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Não foi possível carregar o universo</p>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {pagina.error instanceof Error
                          ? pagina.error.message
                          : 'Erro desconhecido.'}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void pagina.refetch()}>
                      Tentar novamente
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColunas} className="h-64">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="rounded-full bg-muted p-3">
                      <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">Nenhuma empresa encontrada</p>
                      <p className="max-w-md text-sm text-muted-foreground">
                        {temFiltro
                          ? 'Nenhuma linha do universo satisfaz este recorte. Afrouxe uma condição.'
                          : estado.pagina > 0
                            ? 'Esta página não existe mais. Volte para a primeira.'
                            : 'O universo ainda não foi ingerido. Rode a ingestão da Receita Federal.'}
                      </p>
                    </div>
                    {temFiltro && (
                      <Button variant="outline" size="sm" onClick={limparTudo}>
                        Limpar filtros
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              linhas.map((linha) => {
                const cnpj = linha.cnpj ?? ''
                const selecionada = selecao.has(cnpj)
                const promovida = linha.empresa_id !== null

                return (
                  <TableRow
                    key={cnpj || linha.empresa_id}
                    data-state={selecionada ? 'selected' : undefined}
                    className="cursor-pointer"
                    onClick={() => router.push(rotaDaLinha(linha))}
                  >
                    <TableCell
                      // A célula do checkbox não navega: clicar nela é selecionar.
                      onClick={(evento) => evento.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer rounded border-input accent-brand disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Selecionar ${linha.razao_social ?? cnpj}`}
                        checked={selecionada}
                        // Já promovida: não há o que promover. O clique na linha
                        // leva ao Company 360.
                        disabled={promovida || !cnpj}
                        onChange={() => alternarLinha(linha)}
                      />
                    </TableCell>

                    {colunas.map((coluna) => (
                      <TableCell
                        key={coluna.id}
                        className={cn(
                          'max-w-72',
                          coluna.numerica && 'text-right tabular-nums',
                          coluna.id === 'razao_social' && 'font-medium',
                        )}
                      >
                        {coluna.render(linha)}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Rodapé: contagem + paginação ───────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          {pagina.isPending ? (
            <span>Carregando…</span>
          ) : exata.data !== undefined ? (
            <span className="tabular-nums">
              {formatNumero(exata.data)} {exata.data === 1 ? 'empresa' : 'empresas'}
            </span>
          ) : (
            <>
              <span className="tabular-nums">
                ≈ {formatNumero(pagina.data?.totalEstimado ?? 0)} empresas
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => void exata.refetch()}
                disabled={exata.isFetching}
              >
                {exata.isFetching ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Hash className="mr-1.5 h-3.5 w-3.5" />
                )}
                Contar exato
              </Button>
            </>
          )}
          {pagina.isFetching && !pagina.isPending && <span>Atualizando…</span>}
        </div>

        <div className="flex items-center gap-2">
          <span className="tabular-nums">Página {estado.pagina + 1}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Página anterior"
            disabled={estado.pagina === 0 || pagina.isPending}
            onClick={() => navegar({ ...estado, pagina: estado.pagina - 1 })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Próxima página"
            disabled={!pagina.data?.temProxima || pagina.isPending}
            onClick={() => navegar({ ...estado, pagina: estado.pagina + 1 })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FiltroDialog
        arvore={estado.arvore}
        aberto={filtroAberto}
        onOpenChange={setFiltroAberto}
        onAplicar={aplicarArvore}
        onLimpar={() => navegar({ ...estado, arvore: null, pagina: 0 })}
      />

      <PromoverSelecaoDialog
        alvos={[...selecao.values()]}
        aberto={promoverAberto}
        onOpenChange={setPromoverAberto}
        onConcluido={(promovidos) =>
          setSelecao((atual) => {
            // O que falhou continua selecionado: a pessoa pode tentar de novo sem
            // reconstruir a seleção inteira.
            const proxima = new Map(atual)
            for (const cnpj of promovidos) proxima.delete(cnpj)
            return proxima
          })
        }
      />

      {estado.arvore && (
        <SalvarSegmentoDialog
          arvore={estado.arvore}
          termo={estado.termo}
          aberto={segmentoAberto}
          onOpenChange={setSegmentoAberto}
        />
      )}
    </div>
  )
}
