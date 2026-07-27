'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Lock, ShieldCheck, TrendingUp } from 'lucide-react'
import type { Json } from '@jobsiteos/core'
import { rodarProtestosEmpresaAction } from '@/actions/radar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  buscarAnaliseFinanceira,
  buscarGrupoProtestos,
  buscarPreviaProtestos,
  empresasKeys,
  type ProtestoAtual,
  type ProtestoGrupo,
  type ProtestoHistoricoItem,
} from './queries'
import { formatData, formatDataHora } from './format'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brl = (n: number | null | undefined) => moeda.format(Number(n) || 0)

const LABEL_FONTE: Record<string, string> = {
  directd_sp: 'DirectD · SP',
  directd_nacional: 'DirectD · Nacional',
}
const labelFonte = (f: string) => LABEL_FONTE[f] ?? f

/**
 * O payload de cartórios é jsonb (Json): pode vir em qualquer forma. Achata
 * defensivamente estado → cartoriosProtesto[] no formato DirectD; se não bater,
 * devolve [] e a UI simplesmente não mostra o detalhe (nunca quebra).
 */
interface CartorioLinha {
  nome: string
  cidade: string | null
  qtd: number | null
  valor: number | null
}
function parseNumeroBr(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
/**
 * Duas estruturas do DirectD: SP usa estado.cartoriosProtesto[] + cartório.numProtestos +
 * cartório.nome; Nacional usa estado.cartorios[] + cartório.numeroProtestos e só a cidade
 * (sem nome). Estes helpers normalizam as duas.
 */
function filhosDoEstado(uf: unknown): unknown[] {
  if (typeof uf !== 'object' || uf === null || Array.isArray(uf)) return []
  const e = uf as Record<string, unknown>
  const lista = e.cartoriosProtesto ?? e.cartorios
  return Array.isArray(lista) ? lista : []
}
function nomeCidadeCartorio(cc: Record<string, unknown>): { nome: string; cidade: string | null } {
  const nome = typeof cc.nome === 'string' ? cc.nome : null
  const cidade = typeof cc.cidade === 'string' ? cc.cidade : null
  // Nacional não traz nome: usa a cidade como rótulo e não repete a cidade embaixo.
  return { nome: nome ?? cidade ?? 'Cartório', cidade: nome ? cidade : null }
}
function parseCartorios(cartorios: Json | null): CartorioLinha[] {
  if (!Array.isArray(cartorios)) return []
  const linhas: CartorioLinha[] = []
  for (const uf of cartorios) {
    for (const c of filhosDoEstado(uf)) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
      const cc = c as Record<string, unknown>
      const { nome, cidade } = nomeCidadeCartorio(cc)
      linhas.push({
        nome,
        cidade,
        qtd: parseNumeroBr(cc.numProtestos ?? cc.numeroProtestos),
        valor: parseNumeroBr(cc.valorTotalProtestosCartorio),
      })
    }
  }
  return linhas
}

/** Um protesto individual, achatado de estado → cartório → protesto[]. */
interface ProtestoItem {
  empresa?: string
  data: Date | null
  dataLabel: string | null
  valor: number
  cartorio: string
  cidade: string | null
}

/** DirectD usa dd/mm/aaaa (o dataConsulta vem assim); aceita ISO por garantia. */
function parseDataProtesto(s: string | null): Date | null {
  if (!s) return null
  const t = s.trim()
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]))
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  return null
}

/**
 * Achata os protestos individuais de um snapshot (cartorios jsonb). Quando o cartório
 * não traz o detalhe protesto[] (ex.: bloqueio do portal), cai para o total do cartório
 * como uma linha só — assim a soma da lista bate com o valor total mesmo sem o detalhe.
 */
function extrairProtestos(cartorios: Json | null, empresa?: string): ProtestoItem[] {
  const out: ProtestoItem[] = []
  if (!Array.isArray(cartorios)) return out
  for (const uf of cartorios) {
    for (const c of filhosDoEstado(uf)) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
      const cc = c as Record<string, unknown>
      const { nome, cidade } = nomeCidadeCartorio(cc)
      // SP: protesto[]; Nacional: titulos[]. Cada item tem dataProtesto + valorProtestado.
      const itens = cc.protesto ?? cc.titulos
      if (Array.isArray(itens) && itens.length > 0) {
        for (const p of itens) {
          if (typeof p !== 'object' || p === null || Array.isArray(p)) continue
          const pp = p as Record<string, unknown>
          const dl = typeof pp.dataProtesto === 'string' ? pp.dataProtesto : null
          out.push({
            empresa,
            data: parseDataProtesto(dl),
            dataLabel: dl,
            valor: parseNumeroBr(pp.valorProtestado) ?? 0,
            cartorio: nome,
            cidade,
          })
        }
      } else {
        const valor = parseNumeroBr(cc.valorTotalProtestosCartorio) ?? 0
        if (valor > 0) out.push({ empresa, data: null, dataLabel: null, valor, cartorio: nome, cidade })
      }
    }
  }
  return out
}

/** Barras verticais do valor protestado por mês. Sem datas → aviso. */
function GraficoTempo({ protestos }: { protestos: ProtestoItem[] }) {
  const datados = protestos.filter((p) => p.data)
  if (datados.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem datas de protesto informadas nesta base.</p>
  }
  const buckets = new Map<string, { label: string; valor: number; ord: number }>()
  for (const p of datados) {
    const d = p.data as Date
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    const label = `${String(m + 1).padStart(2, '0')}/${String(y).slice(2)}`
    const b = buckets.get(key) ?? { label, valor: 0, ord: y * 12 + m }
    b.valor += p.valor
    buckets.set(key, b)
  }
  const ordenados = [...buckets.values()].sort((a, b) => a.ord - b.ord)
  const max = Math.max(...ordenados.map((b) => b.valor), 1)
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {ordenados.map((b) => (
        <div key={b.label} className="flex w-10 shrink-0 flex-col items-center gap-1">
          <div className="flex h-28 w-full items-end">
            <div
              className="w-full rounded-t bg-primary"
              style={{ height: `${Math.max(3, (b.valor / max) * 100)}%` }}
              title={`${b.label}: ${brl(b.valor)}`}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Barras horizontais do valor protestado por empresa do grupo. */
function GraficoValorPorEmpresa({ dados }: { dados: { nome: string; valor: number }[] }) {
  if (dados.length === 0) return null
  const max = Math.max(...dados.map((d) => d.valor), 1)
  return (
    <div className="space-y-2">
      {dados.map((d) => (
        <div key={d.nome} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{d.nome}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{brl(d.valor)}</span>
          </div>
          <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(d.valor / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Tabela dos protestos individuais (data, valor, cartório; opcionalmente a empresa). */
function TabelaProtestos({ protestos, comEmpresa }: { protestos: ProtestoItem[]; comEmpresa?: boolean }) {
  if (protestos.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sem protestos detalhados.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted-foreground">
          <tr>
            {comEmpresa ? <th className="px-3 py-2 font-medium">Empresa</th> : null}
            <th className="px-3 py-2 font-medium">Data</th>
            <th className="px-3 py-2 text-right font-medium">Valor</th>
            <th className="px-3 py-2 font-medium">Cartório</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {protestos.map((p, i) => (
            <tr key={i} className="hover:bg-muted/50">
              {comEmpresa ? <td className="px-3 py-2">{p.empresa ?? '—'}</td> : null}
              <td className="px-3 py-2 tabular-nums">{p.dataLabel ?? '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(p.valor)}</td>
              <td className="px-3 py-2">
                <div>{p.cartorio}</div>
                {p.cidade ? <div className="text-xs text-muted-foreground">{p.cidade}</div> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Protestos de UMA consulta do histórico: gráfico no tempo + tabela. */
function ConsultaProtestosDialog({
  consulta,
  onOpenChange,
}: {
  consulta: ProtestoHistoricoItem | null
  onOpenChange: (aberto: boolean) => void
}) {
  const protestos = React.useMemo(() => (consulta ? extrairProtestos(consulta.cartorios) : []), [consulta])
  return (
    <Dialog open={consulta !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Protestos da consulta</DialogTitle>
          <DialogDescription>
            {consulta
              ? `${formatDataHora(consulta.consultado_em)} · ${labelFonte(consulta.fonte)} · ${brl(consulta.valor_total)}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Protestos no tempo</p>
            <GraficoTempo protestos={protestos} />
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            <TabelaProtestos protestos={protestos} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Protestos de TODAS as empresas do grupo: tempo + valor por empresa + tabela com a empresa. */
function GrupoProtestosDialog({
  empresaId,
  open,
  onOpenChange,
}: {
  empresaId: string
  open: boolean
  onOpenChange: (aberto: boolean) => void
}) {
  const q = useQuery({
    queryKey: empresasKeys.grupoProtestos(empresaId),
    queryFn: () => buscarGrupoProtestos(empresaId),
    enabled: open,
  })
  const empresas = q.data?.empresas ?? []
  const protestos = React.useMemo(
    () => empresas.flatMap((e) => extrairProtestos(e.cartorios, e.nome)),
    [empresas],
  )
  const porEmpresa = empresas.map((e) => ({ nome: e.nome, valor: Number(e.valor_total) || 0 }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Protestos do grupo econômico</DialogTitle>
          <DialogDescription>Protestos das empresas do grupo com registro.</DialogDescription>
        </DialogHeader>
        {q.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : empresas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma empresa do grupo com protesto.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Protestos no tempo</p>
                <GraficoTempo protestos={protestos} />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Valor por empresa</p>
                <GraficoValorPorEmpresa dados={porEmpresa} />
              </div>
            </div>
            <div className="max-h-[45vh] overflow-y-auto">
              <TabelaProtestos protestos={protestos} comEmpresa />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CardResumo({
  titulo,
  valor,
  detalhe,
  tom,
  icone,
  onClick,
}: {
  titulo: string
  valor: string
  detalhe: React.ReactNode
  tom: 'alerta' | 'ok'
  icone: React.ReactNode
  onClick?: () => void
}) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? 'cursor-pointer transition-colors hover:bg-muted/40' : undefined}
    >
      <CardContent className="space-y-1 p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icone}
          {titulo}
        </div>
        <p
          className={`text-2xl font-semibold tabular-nums ${tom === 'alerta' ? 'text-destructive' : ''}`}
        >
          {valor}
        </p>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </CardContent>
    </Card>
  )
}

function BlocoEmpresa({ atual }: { atual: ProtestoAtual | null }) {
  if (!atual) {
    return (
      <CardResumo
        titulo="Protestos desta empresa"
        valor="—"
        tom="ok"
        icone={<ShieldCheck className="h-4 w-4" />}
        detalhe="Nenhuma consulta de protesto realizada ainda."
      />
    )
  }
  const tem = atual.tem_protesto === true
  return (
    <CardResumo
      titulo="Protestos desta empresa"
      valor={tem ? brl(atual.valor_total) : 'Sem protestos'}
      tom={tem ? 'alerta' : 'ok'}
      icone={
        tem ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />
      }
      detalhe={
        tem
          ? `${atual.qtd_protestos ?? 0} protesto(s) · ${labelFonte(atual.fonte)} · consultado em ${formatData(atual.consultado_em)}`
          : `Consultado em ${formatData(atual.consultado_em)} · ${labelFonte(atual.fonte)}`
      }
    />
  )
}

function BlocoGrupo({ grupo, onAbrir }: { grupo: ProtestoGrupo | null; onAbrir: () => void }) {
  if (!grupo) {
    return (
      <CardResumo
        titulo="Total do grupo econômico"
        valor="—"
        tom="ok"
        icone={<TrendingUp className="h-4 w-4" />}
        detalhe="Empresa sem grupo econômico vinculado."
      />
    )
  }
  const tem = grupo.valor_total > 0
  return (
    <CardResumo
      titulo="Total do grupo econômico"
      valor={brl(grupo.valor_total)}
      tom={tem ? 'alerta' : 'ok'}
      icone={<TrendingUp className="h-4 w-4" />}
      onClick={tem ? onAbrir : undefined}
      detalhe={`${grupo.qtd_protestos} protesto(s) · ${grupo.qtd_empresas_com_protesto} de ${grupo.qtd_empresas_consultadas} empresa(s) com protesto${tem ? ' · clique para detalhar' : ''}`}
    />
  )
}

function Cartorios({ linhas }: { linhas: CartorioLinha[] }) {
  if (linhas.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cartórios ({linhas.length})</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Cartório</th>
              <th className="px-4 py-2 font-medium">Protestos</th>
              <th className="px-4 py-2 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((l, i) => (
              <tr key={`${l.nome}-${i}`} className="hover:bg-muted/50">
                <td className="px-4 py-2">
                  <div className="font-medium">{l.nome}</div>
                  {l.cidade ? (
                    <div className="text-xs text-muted-foreground">{l.cidade}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums">{l.qtd ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {l.valor === null ? '—' : brl(l.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function Historico({
  itens,
  onAbrir,
}: {
  itens: ProtestoHistoricoItem[]
  onAbrir: (item: ProtestoHistoricoItem) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Histórico de consultas</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {itens.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nenhuma consulta de protesto registrada para esta empresa.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Consultado em</th>
                  <th className="px-4 py-2 font-medium">Fonte</th>
                  <th className="px-4 py-2 font-medium">Resultado</th>
                  <th className="px-4 py-2 font-medium">Protestos</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {itens.map((h, i) => {
                  const tem = h.tem_protesto === true
                  return (
                    <tr
                      key={`${h.consultado_em}-${i}`}
                      className={tem ? 'cursor-pointer hover:bg-muted/50' : 'hover:bg-muted/50'}
                      onClick={tem ? () => onAbrir(h) : undefined}
                      title={tem ? 'Ver os protestos desta consulta' : undefined}
                    >
                      <td className="px-4 py-2 tabular-nums">{formatDataHora(h.consultado_em)}</td>
                      <td className="px-4 py-2">{labelFonte(h.fonte)}</td>
                      <td className="px-4 py-2">
                        {tem ? (
                          <Badge variant="destructive">Com protesto</Badge>
                        ) : (
                          <Badge variant="secondary">Limpo</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{tem ? (h.qtd_protestos ?? 0) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {tem ? brl(h.valor_total) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const ANO_ATUAL = new Date().getFullYear()
const ANOS = Array.from({ length: ANO_ATUAL - 1999 }, (_, i) => ANO_ATUAL - i) // atual … 2000

/** Diálogo de disparo pago: empresa (+ SPEs opcionais) com estimativa antes de confirmar. */
function RodarProtestosDialog({
  empresaId,
  temGrupo,
  open,
  onOpenChange,
  onDisparado,
}: {
  empresaId: string
  temGrupo: boolean
  open: boolean
  onOpenChange: (aberto: boolean) => void
  onDisparado: () => void
}) {
  const [incluirSpes, setIncluirSpes] = React.useState(false)
  const [anoMin, setAnoMin] = React.useState<number>(ANO_ATUAL - 5)
  const [rodando, setRodando] = React.useState(false)

  const anoEfetivo = incluirSpes ? anoMin : null
  const previa = useQuery({
    queryKey: empresasKeys.previaProtestos(empresaId, incluirSpes, anoEfetivo),
    queryFn: () => buscarPreviaProtestos(empresaId, incluirSpes, anoEfetivo),
    enabled: open,
  })

  const qtd = previa.data?.qtd ?? 0
  const custoBrl = brl(previa.data?.custo_estimado ?? 0)
  const semAcesso = previa.data ? !previa.data.tem_acesso : false

  async function rodar() {
    setRodando(true)
    const r = await rodarProtestosEmpresaAction({ empresaId, incluirSpes, anoMin: anoEfetivo })
    setRodando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'O worker não aceitou o job.')
      return
    }
    toast.success('Consulta enfileirada. Os protestos aparecem em instantes.')
    onOpenChange(false)
    onDisparado()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rodar protestos</DialogTitle>
          <DialogDescription>
            Consulta DirectD nacional — ação paga. Confira a estimativa antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {temGrupo ? (
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="incluir-spes">Incluir SPEs do grupo</Label>
                <p className="text-xs text-muted-foreground">SPEs ativas do grupo econômico.</p>
              </div>
              <Switch id="incluir-spes" checked={incluirSpes} onCheckedChange={setIncluirSpes} />
            </div>
          ) : null}

          {incluirSpes ? (
            <div className="space-y-1">
              <Label>Criadas a partir de</Label>
              <Select value={String(anoMin)} onValueChange={(v) => setAnoMin(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {ANOS.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Só SPEs com início de atividade nesse ano ou depois.
              </p>
            </div>
          ) : null}

          <div className="rounded-md bg-muted/50 p-3 text-sm">
            {previa.isPending ? (
              <span className="text-muted-foreground">Calculando estimativa…</span>
            ) : semAcesso ? (
              <span className="text-muted-foreground">Sem acesso ao módulo Radar.</span>
            ) : (
              <span>
                <strong>{qtd}</strong> empresa(s) · custo estimado <strong>{custoBrl}</strong>
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={rodando}>
            Cancelar
          </Button>
          <Button onClick={rodar} disabled={rodando || qtd === 0 || semAcesso}>
            {rodando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rodar ({custoBrl})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Aba "Análise financeira" da ficha da empresa. Protesto atual da própria empresa,
 * total somado do grupo econômico e o histórico de consultas — tudo do RPC
 * empresa_analise_financeira (SECURITY DEFINER, gate no módulo Radar). Sem o módulo,
 * `tem_acesso: false` e mostramos um estado bloqueado, nunca um erro.
 */
export function AnaliseFinanceira({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient()
  const [rodarAberto, setRodarAberto] = React.useState(false)
  const [grupoAberto, setGrupoAberto] = React.useState(false)
  const [consultaAberta, setConsultaAberta] = React.useState<ProtestoHistoricoItem | null>(null)
  const { data, isPending, isError, error } = useQuery({
    queryKey: empresasKeys.analiseFinanceira(empresaId),
    queryFn: () => buscarAnaliseFinanceira(empresaId),
  })

  // Os protestos chegam em segundo plano; recarrega algumas vezes após o disparo.
  function aoDisparar() {
    let n = 0
    const timer = setInterval(() => {
      n++
      void qc.invalidateQueries({ queryKey: empresasKeys.analiseFinanceira(empresaId) })
      if (n >= 12) clearInterval(timer)
    }, 5_000)
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Não foi possível carregar a análise financeira.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!data.tem_acesso) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="rounded-full bg-muted p-3">
            <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <p className="text-sm font-medium">Requer o módulo Radar</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            A análise de protestos usa dados do Radar. Peça acesso ao módulo para ver o valor
            protestado da empresa e do grupo.
          </p>
        </CardContent>
      </Card>
    )
  }

  const cartorios = parseCartorios(data.atual?.cartorios ?? null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="outline" onClick={() => setRodarAberto(true)}>
          Rodar protestos
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <BlocoEmpresa atual={data.atual} />
        <BlocoGrupo grupo={data.grupo} onAbrir={() => setGrupoAberto(true)} />
      </div>
      {data.atual?.tem_protesto ? <Cartorios linhas={cartorios} /> : null}
      <Historico itens={data.historico} onAbrir={setConsultaAberta} />

      <RodarProtestosDialog
        empresaId={empresaId}
        temGrupo={data.grupo !== null}
        open={rodarAberto}
        onOpenChange={setRodarAberto}
        onDisparado={aoDisparar}
      />

      <ConsultaProtestosDialog
        consulta={consultaAberta}
        onOpenChange={(aberto) => {
          if (!aberto) setConsultaAberta(null)
        }}
      />

      <GrupoProtestosDialog empresaId={empresaId} open={grupoAberto} onOpenChange={setGrupoAberto} />
    </div>
  )
}
