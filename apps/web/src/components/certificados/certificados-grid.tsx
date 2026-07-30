'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, EyeOff, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import {
  COR_CERTIFICADO,
  ESTADO_CERTIFICADO_LABELS,
  formatarVencimento,
  textoDias,
  type EstadoCertificado,
} from '@jobsiteos/core'
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
import { ocultarSpeAction, reexibirSpeAction, sincronizarCertificadosAction } from '@/actions/certificados'
import { cn } from '@/lib/utils'
import { buscarGridCertificados, certificadosKeys, type Celula, type LinhaCliente } from './queries'

/**
 * Grid de certificados digitais (04b §4).
 *
 * O DESVIO DELIBERADO da spec: ela pede "uma coluna por SPE". Contra a base real
 * isso não funciona — um cliente tem 370 SPEs, e 370 colunas não cabem em tela
 * nenhuma nem em impressão. O grid continua sendo por LINHA, como a spec manda, mas
 * cada linha rola horizontalmente e as células vêm ORDENADAS POR URGÊNCIA: vencido,
 * sem certificado, vencendo, válido. Assim o que exige ação está sempre nos
 * primeiros centímetros, e o resto continua acessível rolando.
 *
 * Cor = estado do certificado daquele CNPJ. Vermelho cobre "vencido" e "sem
 * certificado" porque o efeito é o mesmo: nenhuma NF-e daquela empresa é ingerida.
 */

const CLASSES: Record<'verde' | 'amarelo' | 'vermelho', string> = {
  verde: 'bg-emerald-500 hover:bg-emerald-600 border-emerald-600',
  amarelo: 'bg-amber-400 hover:bg-amber-500 border-amber-500',
  vermelho: 'bg-red-500 hover:bg-red-600 border-red-600',
}

function Quadrado({
  celula,
  ehMatriz,
  onOcultar,
}: {
  celula: Celula
  ehMatriz: boolean
  onOcultar?: (c: Celula) => void
}) {
  const cor = COR_CERTIFICADO[celula.estado]
  const titulo = [
    celula.razao_social,
    ESTADO_CERTIFICADO_LABELS[celula.estado],
    celula.estado === 'ausente' ? 'Sem certificado' : formatarVencimento(celula.expiraEm),
    textoDias(celula.diasRestantes),
    ehMatriz ? 'Matriz (não pode ser ocultada)' : 'Clique para ocultar do grid',
  ].join(' · ')

  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={ehMatriz}
      onClick={() => !ehMatriz && onOcultar?.(celula)}
      className={cn(
        'h-7 w-7 shrink-0 rounded border transition-colors',
        CLASSES[cor],
        ehMatriz ? 'cursor-default ring-2 ring-offset-1 ring-foreground/20' : 'cursor-pointer',
      )}
    />
  )
}

function CardIndicador({
  titulo,
  valor,
  detalhe,
  dica,
}: {
  titulo: string
  valor: string
  detalhe: string
  dica?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground" title={dica}>
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{valor}</p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  )
}

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`)

/** Quantas SPEs desenhar antes do "ver todas" — o resto continua a um clique. */
const SPES_VISIVEIS = 24

function Linha({ cliente, onOcultar }: { cliente: LinhaCliente; onOcultar: (c: Celula) => void }) {
  const [todas, setTodas] = React.useState(false)
  const spes = todas ? cliente.spes : cliente.spes.slice(0, SPES_VISIVEIS)
  const restantes = cliente.spes.length - spes.length

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
      <div className="w-64 shrink-0">
        <Link
          href={`/empresas/${cliente.empresaId}`}
          className="line-clamp-1 text-sm font-medium hover:underline"
          title={cliente.razaoSocial}
        >
          {cliente.razaoSocial}
        </Link>
        <p className="text-xs text-muted-foreground">
          {cliente.spes.length} {cliente.spes.length === 1 ? 'SPE' : 'SPEs'}
        </p>
      </div>

      <Quadrado celula={cliente.matriz} ehMatriz />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1">
        {spes.map((s) => (
          <Quadrado key={s.cnpj} celula={s} ehMatriz={false} onOcultar={onOcultar} />
        ))}
        {restantes > 0 && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setTodas(true)}>
            +{restantes}
          </Button>
        )}
        {cliente.spes.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhuma SPE vinculada</span>
        )}
      </div>
    </div>
  )
}

export function CertificadosGrid() {
  const qc = useQueryClient()
  const [busca, setBusca] = React.useState('')
  const [confirmar, setConfirmar] = React.useState<Celula | null>(null)
  const [ocultasAberto, setOcultasAberto] = React.useState(false)
  const [agindo, setAgindo] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: certificadosKeys.grid(),
    queryFn: buscarGridCertificados,
  })

  const recarregar = () => void qc.invalidateQueries({ queryKey: certificadosKeys.grid() })

  async function ocultar() {
    if (!confirmar) return
    setAgindo(true)
    const r = await ocultarSpeAction(confirmar.cnpj)
    setAgindo(false)
    setConfirmar(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('SPE ocultada do grid.')
    recarregar()
  }

  async function reexibir(cnpj: string) {
    setAgindo(true)
    const r = await reexibirSpeAction(cnpj)
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('SPE reexibida.')
    recarregar()
  }

  async function sincronizar() {
    setAgindo(true)
    const r = await sincronizarCertificadosAction()
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.enfileirado
        ? 'Sincronizando com o Onepay. Recarregue em alguns instantes.'
        : (r.data.aviso ?? 'Não foi possível disparar o sync.'),
    )
  }

  const filtrados = React.useMemo(() => {
    if (!data) return []
    const t = busca.trim().toLowerCase()
    if (!t) return data.clientes
    const digitos = t.replace(/\D/g, '')
    return data.clientes.filter(
      (c) =>
        c.razaoSocial.toLowerCase().includes(t) || (digitos.length > 0 && c.cnpj.includes(digitos)),
    )
  }, [data, busca])

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar os certificados.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const ind = data.indicadores

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <CardIndicador
          titulo="Clientes com certificado válido"
          valor={pct(ind.pctClientes)}
          detalhe={`${ind.clientesValidos} de ${ind.clientesTotal} construtoras clientes`}
          dica="Matrizes com certificado ativo (verde ou amarelo) ÷ total de construtoras clientes."
        />
        <CardIndicador
          titulo="SPEs com certificado válido"
          valor={pct(ind.pctSpes)}
          detalhe={`${ind.spesValidas} de ${ind.spesTotal} SPEs visíveis`}
          dica="SPEs não ocultadas com certificado ativo ÷ total de SPEs visíveis."
        />
        <CardIndicador
          titulo="Total de certificados ativos"
          valor={String(ind.totalAtivos)}
          detalhe="Inclui fornecedores"
          dica="Todos os certificados ativos e não vencidos na base sincronizada — escopo maior que os outros dois cards: inclui fornecedores, que não aparecem no grid."
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Gestão de certificados</CardTitle>
              <CardDescription>
                Matriz e SPEs de cada construtora cliente. Verde: válido. Amarelo: vence em até 30
                dias. Vermelho: vencido, inativo ou sem certificado — nesses casos as NF-e da
                empresa não são ingeridas. Clique numa SPE para ocultá-la.
                {data.sincronizadoEm
                  ? ` Sincronizado em ${formatarVencimento(data.sincronizadoEm)}.`
                  : ' Nunca sincronizado.'}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setOcultasAberto(true)}>
                <EyeOff className="mr-1 h-3.5 w-3.5" aria-hidden />
                Ocultadas ({data.ocultas.length})
              </Button>
              <Button variant="outline" size="sm" disabled={agindo} onClick={() => void sincronizar()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                Sincronizar
              </Button>
            </div>
          </div>

          <div className="relative pt-2">
            <Search
              className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou CNPJ…"
              className="pl-8"
              aria-label="Buscar cliente"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filtrados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {data.clientes.length === 0
                  ? 'Nenhuma construtora cliente na base. O grid mostra clientes Onepay do tipo construtora.'
                  : 'Nenhum cliente com esse nome ou CNPJ.'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filtrados.map((c) => (
                <Linha key={c.cnpj} cliente={c} onOcultar={setConfirmar} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmação de ocultar (§4) */}
      <Dialog open={!!confirmar} onOpenChange={(v) => !v && setConfirmar(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ocultar SPE do grid?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{confirmar?.razao_social}</span> deixa de aparecer para
              todo o time e sai do cálculo de &ldquo;% SPEs com certificado válido&rdquo;. Dá
              para reexibir depois, pelo botão &ldquo;Ocultadas&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button disabled={agindo} onClick={() => void ocultar()}>
              {agindo ? 'Ocultando…' : 'Ocultar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Painel de ocultadas (§4) */}
      <Dialog open={ocultasAberto} onOpenChange={setOcultasAberto}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>SPEs ocultadas</DialogTitle>
            <DialogDescription>
              Ocultar é uma preferência do time inteiro, não sua — todos veem o mesmo grid.
            </DialogDescription>
          </DialogHeader>
          {data.ocultas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma SPE ocultada.</p>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto">
              {data.ocultas.map((o) => (
                <li key={o.cnpj} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.razao_social}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.cnpj} · ocultada por {o.oculto_por_nome ?? 'desconhecido'} em{' '}
                      {formatarVencimento(o.oculto_em)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={agindo}
                    onClick={() => void reexibir(o.cnpj)}
                  >
                    Reexibir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Legenda das cores, reusada pela página. */
export function LegendaCertificados() {
  const itens: Array<{ estado: EstadoCertificado; texto: string }> = [
    { estado: 'valido', texto: 'Válido (mais de 30 dias)' },
    { estado: 'vencendo', texto: 'Vence em até 30 dias' },
    { estado: 'vencido', texto: 'Vencido, inativo ou sem certificado' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {itens.map((i) => (
        <span key={i.estado} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-3 rounded border', CLASSES[COR_CERTIFICADO[i.estado]])} />
          {i.texto}
        </span>
      ))}
      <Badge variant="outline" className="ml-auto">
        Matriz tem borda destacada
      </Badge>
    </div>
  )
}
