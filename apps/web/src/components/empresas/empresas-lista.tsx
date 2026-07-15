'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Building2, Search, X } from 'lucide-react'
import {
  ESTAGIOS,
  ESTAGIO_LABELS,
  TIPOS_EMPRESA,
  TIPO_EMPRESA_LABELS,
  formatCnpj,
  type Estagio,
  type TipoEmpresa,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
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
import { TODOS, UFS } from './constants'
import { EstagioBadge, labelTipo } from './estagio-badge'
import { formatMrr } from './format'
import { NovaEmpresaDialog } from './nova-empresa-dialog'
import {
  FILTROS_VAZIOS,
  LIMITE_LISTA,
  buscarEmpresas,
  empresasKeys,
  temFiltroAtivo,
  type FiltrosEmpresas,
} from './queries'
import { useDebounce } from './use-debounce'

const COLUNAS = 7

function LinhasCarregando() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUNAS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function Vazio({ filtrado, onLimpar }: { filtrado: boolean; onLimpar: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3">
            <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">
              {filtrado ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada'}
            </p>
            <p className="text-sm text-muted-foreground">
              {filtrado
                ? 'Ajuste a busca ou os filtros para ver outros resultados.'
                : 'Cadastre a primeira empresa para começar a acompanhar o funil.'}
            </p>
          </div>
          {filtrado ? (
            <Button variant="outline" size="sm" onClick={onLimpar}>
              Limpar filtros
            </Button>
          ) : (
            <NovaEmpresaDialog />
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function Erro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Não foi possível carregar as empresas</p>
            <p className="max-w-md text-sm text-muted-foreground">{mensagem}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onTentar}>
            Tentar novamente
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function EmpresasLista() {
  const router = useRouter()
  const [filtros, setFiltros] = React.useState<FiltrosEmpresas>(FILTROS_VAZIOS)

  // Only the term is debounced. Selecting a filter is a deliberate act and
  // should feel instant; typing is not.
  const termoDebounced = useDebounce(filtros.termo, 300)
  const filtrosQuery = React.useMemo<FiltrosEmpresas>(
    () => ({ ...filtros, termo: termoDebounced }),
    [filtros, termoDebounced],
  )

  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: empresasKeys.lista(filtrosQuery),
    queryFn: () => buscarEmpresas(filtrosQuery),
    // Keeps the previous rows on screen while a new term is fetched, so the
    // table doesn't flash a skeleton on every keystroke.
    placeholderData: (anterior) => anterior,
  })

  const filtrado = temFiltroAtivo(filtrosQuery)
  const empresas = data ?? []

  function limpar() {
    setFiltros(FILTROS_VAZIOS)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Toda a carteira em um lugar só: mercado, funil e inteligência de ERP.
          </p>
        </div>
        <NovaEmpresaDialog />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={filtros.termo}
            onChange={(event) => setFiltros((f) => ({ ...f, termo: event.target.value }))}
            placeholder="Buscar por razão social, nome fantasia ou CNPJ"
            className="pl-9"
            aria-label="Buscar empresas"
          />
        </div>

        <Select
          value={filtros.estagio ?? TODOS}
          onValueChange={(valor) =>
            setFiltros((f) => ({ ...f, estagio: valor === TODOS ? null : (valor as Estagio) }))
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por estágio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os estágios</SelectItem>
            {ESTAGIOS.map((estagio) => (
              <SelectItem key={estagio} value={estagio}>
                {ESTAGIO_LABELS[estagio]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filtros.tipo ?? TODOS}
          onValueChange={(valor) =>
            setFiltros((f) => ({ ...f, tipo: valor === TODOS ? null : (valor as TipoEmpresa) }))
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os tipos</SelectItem>
            {TIPOS_EMPRESA.map((tipo) => (
              <SelectItem key={tipo} value={tipo}>
                {TIPO_EMPRESA_LABELS[tipo]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filtros.uf ?? TODOS}
          onValueChange={(valor) =>
            setFiltros((f) => ({ ...f, uf: valor === TODOS ? null : valor }))
          }
        >
          <SelectTrigger className="w-full sm:w-28" aria-label="Filtrar por UF">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value={TODOS}>UF</SelectItem>
            {UFS.map((uf) => (
              <SelectItem key={uf} value={uf}>
                {uf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtrado && (
          <Button variant="ghost" size="sm" onClick={limpar}>
            <X className="mr-2 h-4 w-4" />
            Limpar
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Razão social</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Estágio</TableHead>
              <TableHead>UF</TableHead>
              <TableHead>ERP atual</TableHead>
              <TableHead className="text-right">MRR do ERP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <LinhasCarregando />
            ) : isError ? (
              <Erro
                mensagem={error instanceof Error ? error.message : 'Erro desconhecido.'}
                onTentar={() => void refetch()}
              />
            ) : empresas.length === 0 ? (
              <Vazio filtrado={filtrado} onLimpar={limpar} />
            ) : (
              empresas.map((empresa) => (
                // The row is clickable for the mouse; the <Link> in the first
                // cell is what makes it reachable by keyboard, focusable, and
                // openable in a new tab. Both lead to the same route.
                <TableRow
                  key={empresa.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/empresas/${empresa.id}`)}
                >
                  <TableCell className="font-medium">
                    <Link href={`/empresas/${empresa.id}`} className="hover:underline">
                      {empresa.razao_social ?? formatCnpj(empresa.cnpj)}
                    </Link>
                    {empresa.nome_fantasia && (
                      <p className="text-sm text-muted-foreground">{empresa.nome_fantasia}</p>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatCnpj(empresa.cnpj)}
                  </TableCell>
                  <TableCell>{labelTipo(empresa.tipo)}</TableCell>
                  <TableCell>
                    <EstagioBadge estagio={empresa.estagio} />
                  </TableCell>
                  <TableCell>{empresa.uf ?? '—'}</TableCell>
                  <TableCell>{empresa.erp_atual ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMrr(empresa.erp_mrr) ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex h-5 items-center justify-between text-sm text-muted-foreground">
        <span>
          {isPending
            ? 'Carregando…'
            : empresas.length === 1
              ? '1 empresa'
              : `${empresas.length} empresas`}
          {empresas.length === LIMITE_LISTA && ' (limite exibido — refine a busca)'}
        </span>
        {isFetching && !isPending && <span>Atualizando…</span>}
      </div>
    </div>
  )
}
