'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, ShieldCheck } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { sincronizarOnepayAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarClientesOnepay, radarKeys } from './queries'

const brl = (n: number | null) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null) => `${Math.round((Number(n) || 0) * 100)}%`

/**
 * Faturamento e protesto pedem travessão quando não há dado, não R$ 0,00: "não
 * sabemos" e "é zero" levam a decisões opostas, e `brl(null)` diria a segunda.
 */
const brlOuTraco = (n: number | null) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : brl(n)

/** Compacto porque a coluna divide espaço com outras oito: R$ 325,4 mi, não o extenso. */
function brlCompacto(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return brl(v)
}

const DORMENTE = 15

/**
 * O filtro de gestão. `null` no banco é "não definido" e é a MAIORIA (46 dos 50
 * clientes hoje) — por isso o padrão é "Todos" e não "ambos os tipos": abrir a tela
 * já filtrando por ativa+passiva mostraria 4 linhas de 50 e pareceria defeito.
 */
type FiltroGestao = 'todos' | 'prospeccao_ativa' | 'passivo'

const GESTAO_OPCOES: readonly { valor: FiltroGestao; rotulo: string }[] = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'prospeccao_ativa', rotulo: 'Ativa' },
  { valor: 'passivo', rotulo: 'Passiva' },
]

const GESTAO_ROTULO: Record<string, string> = {
  prospeccao_ativa: 'Ativa',
  passivo: 'Passiva',
}

const GESTAO_COR: Record<string, string> = {
  prospeccao_ativa: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  passivo: 'bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200',
}

/**
 * Busca no cliente, não no servidor: a lista inteira já veio numa consulta só (são
 * dezenas de clientes, não milhares), então filtrar aqui responde a cada tecla sem
 * uma ida ao banco por letra.
 *
 * O CNPJ é comparado só por dígitos. Quem cola "12.345.678/0001-90" de outro sistema
 * não deveria precisar apagar a pontuação para achar a empresa — e quem digita
 * "12345678" também acha.
 */
function combina(cliente: { nome: string | null; cnpj: string | null }, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true

  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && (cliente.cnpj ?? '').includes(digitos)) return true

  return (cliente.nome ?? '').toLowerCase().includes(t)
}

function Sinal({ children, tom }: { children: React.ReactNode; tom: 'alerta' | 'aviso' | 'ok' }) {
  const cor =
    tom === 'alerta'
      ? 'bg-destructive/10 text-destructive'
      : tom === 'aviso'
        ? 'bg-amber-500/10 text-amber-600'
        : 'bg-muted text-muted-foreground'
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cor}`}>{children}</span>
}

export function ClientesOnepay() {
  const qc = useQueryClient()
  const clientes = useQuery({ queryKey: radarKeys.clientes(), queryFn: buscarClientesOnepay })
  const [sincronizando, setSincronizando] = React.useState(false)
  const [termo, setTermo] = React.useState('')
  const [gestao, setGestao] = React.useState<FiltroGestao>('todos')

  const todos = React.useMemo(() => clientes.data ?? [], [clientes.data])
  const filtrados = React.useMemo(
    () =>
      todos.filter(
        (c) => combina(c, termo) && (gestao === 'todos' || c.gestao_operacao === gestao),
      ),
    [todos, termo, gestao],
  )

  // Os contadores do toggle saem da lista JÁ filtrada pela busca, não da base: o
  // número ao lado de "Ativa" tem de dizer quantas linhas o clique vai mostrar.
  const porGestao = React.useMemo(() => {
    const base = todos.filter((c) => combina(c, termo))
    return {
      todos: base.length,
      prospeccao_ativa: base.filter((c) => c.gestao_operacao === 'prospeccao_ativa').length,
      passivo: base.filter((c) => c.gestao_operacao === 'passivo').length,
      naoDefinida: base.filter((c) => !c.gestao_operacao).length,
    }
  }, [todos, termo])

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarOnepayAction()
    if (!r.ok) {
      setSincronizando(false)
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      setSincronizando(false)
      toast.error(r.data.aviso ?? 'O worker não aceitou o sync.')
      return
    }
    toast.success('Sync enfileirado. Os clientes aparecem em instantes — atualizando…')
    // O sync roda em background no worker; recarrega algumas vezes enquanto chega.
    let tentativas = 0
    const timer = setInterval(() => {
      tentativas++
      void qc.invalidateQueries({ queryKey: radarKeys.clientes() })
      if (tentativas >= 12) {
        clearInterval(timer)
        setSincronizando(false)
      }
    }, 5_000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes Onepay</h1>
          <p className="text-muted-foreground">Sync diário: limites, dias sem antecipar e sinais.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Rota própria (04b §4): o grid matriz × SPEs não cabe dentro de uma aba. */}
          <Button variant="outline" asChild>
            <Link href="/empresas/certificados">
              <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />
              Gestão de certificados
            </Link>
          </Button>
          <Button onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        </div>
      </div>

      {clientes.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : todos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente sincronizado ainda. Rode o sync Onepay no worker.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <div className="relative min-w-64 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                className="pl-9"
                aria-label="Buscar clientes Onepay"
              />
            </div>
            {/*
             * O toggle de gestão. Segmentado e não um Select porque são três opções
             * fixas que se comparam entre si — o número ao lado de cada uma é metade
             * da informação, e num Select fechado ele não apareceria.
             */}
            <div
              role="group"
              aria-label="Filtrar por tipo de prospecção"
              className="flex shrink-0 items-center rounded-md border border-border p-0.5"
            >
              {GESTAO_OPCOES.map((o) => (
                <button
                  key={o.valor}
                  type="button"
                  aria-pressed={gestao === o.valor}
                  onClick={() => setGestao(o.valor)}
                  className={`rounded px-2.5 py-1 text-sm transition-colors ${
                    gestao === o.valor
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {o.rotulo}
                  <span className="ml-1.5 tabular-nums opacity-70">{porGestao[o.valor]}</span>
                </button>
              ))}
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {termo.trim()
                ? `${filtrados.length} de ${todos.length}`
                : `${todos.length} cliente(s)`}
            </span>
          </div>

          {/*
           * A ausência precisa ser explicada. Hoje 46 dos 50 clientes estão sem
           * gestão definida — sem esta linha, "Ativa 2" parece dado errado quando é
           * cadastro que ninguém preencheu.
           */}
          {porGestao.naoDefinida > 0 ? (
            <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              {porGestao.naoDefinida} cliente(s) sem tipo de prospecção definido — eles só
              aparecem em <strong>Todos</strong>. A definição é feita na ficha da empresa.
            </p>
          ) : null}
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Empresa</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Faturamento</th>
                  <th
                    className="px-4 py-2 font-medium"
                    title="Protesto somado no grupo: o CNPJ do cliente mais as SPEs que dividem o mesmo grupo. A holding costuma estar limpa enquanto a dívida mora nas SPEs."
                  >
                    Protesto (grupo)
                  </th>
                  <th className="px-4 py-2 font-medium">Limite</th>
                  <th className="px-4 py-2 font-medium">Consumido</th>
                  <th className="px-4 py-2 font-medium">Sem antecipar</th>
                  <th className="px-4 py-2 font-medium">Sinais</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtrados.map((c) => {
                  const dias = c.days_without_anticipation ?? 0
                  const pctConsumido = Number(c.consumed_pct) || 0
                  const cnpjFmt = c.cnpj ? formatCnpj(c.cnpj) : '—'
                  const protesto = Number(c.protesto_grupo_valor ?? 0)
                  return (
                    <tr key={c.cnpj} className="hover:bg-muted/50">
                      <td className="px-4 py-2">
                        {c.empresa_id ? (
                          <Link href={`/empresas/${c.empresa_id}`} className="font-medium hover:underline">
                            {c.nome ?? cnpjFmt}
                          </Link>
                        ) : (
                          <span className="font-medium">{c.nome ?? cnpjFmt}</span>
                        )}
                        <div className="text-xs text-muted-foreground">{cnpjFmt}</div>
                      </td>
                      <td className="px-4 py-2">
                        {c.gestao_operacao ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs ${GESTAO_COR[c.gestao_operacao] ?? 'bg-muted text-muted-foreground'}`}
                          >
                            {GESTAO_ROTULO[c.gestao_operacao] ?? c.gestao_operacao}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums" title={brlOuTraco(c.faturamento_anual)}>
                        {brlCompacto(c.faturamento_anual)}
                      </td>
                      <td
                        className={`px-4 py-2 tabular-nums ${protesto > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
                        title={
                          protesto > 0
                            ? `${brl(protesto)} em ${c.protesto_grupo_cnpjs} CNPJ(s) do grupo`
                            : 'Sem protesto no grupo'
                        }
                      >
                        {protesto > 0 ? brlCompacto(protesto) : '—'}
                        {protesto > 0 && (c.protesto_grupo_cnpjs ?? 0) > 1 ? (
                          <span className="ml-1 text-xs font-normal opacity-70">
                            ({c.protesto_grupo_cnpjs})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{brl(c.credit_limit)}</td>
                      <td className="px-4 py-2 tabular-nums">{pct(c.consumed_pct)}</td>
                      <td className="px-4 py-2 tabular-nums">{dias} d</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {dias >= DORMENTE && <Sinal tom="aviso">Dormente</Sinal>}
                          {pctConsumido >= 0.9 && <Sinal tom="alerta">Limite {pct(c.consumed_pct)}</Sinal>}
                          {c.operation_status && c.operation_status !== 'operating_normally' && (
                            <Sinal tom="aviso">{c.operation_status}</Sinal>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtrados.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nenhum cliente para “{termo.trim()}”.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
