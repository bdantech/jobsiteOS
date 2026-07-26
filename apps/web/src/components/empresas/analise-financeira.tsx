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
function parseCartorios(cartorios: Json | null): CartorioLinha[] {
  if (!Array.isArray(cartorios)) return []
  const linhas: CartorioLinha[] = []
  for (const uf of cartorios) {
    if (typeof uf !== 'object' || uf === null || Array.isArray(uf)) continue
    const lista = (uf as Record<string, unknown>).cartoriosProtesto
    if (!Array.isArray(lista)) continue
    for (const c of lista) {
      if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
      const cc = c as Record<string, unknown>
      linhas.push({
        nome: typeof cc.nome === 'string' ? cc.nome : 'Cartório',
        cidade: typeof cc.cidade === 'string' ? cc.cidade : null,
        qtd: parseNumeroBr(cc.numProtestos),
        valor: parseNumeroBr(cc.valorTotalProtestosCartorio),
      })
    }
  }
  return linhas
}

function CardResumo({
  titulo,
  valor,
  detalhe,
  tom,
  icone,
}: {
  titulo: string
  valor: string
  detalhe: React.ReactNode
  tom: 'alerta' | 'ok'
  icone: React.ReactNode
}) {
  return (
    <Card>
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

function BlocoGrupo({ grupo }: { grupo: ProtestoGrupo | null }) {
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
      detalhe={`${grupo.qtd_protestos} protesto(s) · ${grupo.qtd_empresas_com_protesto} de ${grupo.qtd_empresas_consultadas} empresa(s) consultada(s) com protesto`}
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

function Historico({ itens }: { itens: ProtestoHistoricoItem[] }) {
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
                    <tr key={`${h.consultado_em}-${i}`} className="hover:bg-muted/50">
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
        <BlocoGrupo grupo={data.grupo} />
      </div>
      {data.atual?.tem_protesto ? <Cartorios linhas={cartorios} /> : null}
      <Historico itens={data.historico} />

      <RodarProtestosDialog
        empresaId={empresaId}
        temGrupo={data.grupo !== null}
        open={rodarAberto}
        onOpenChange={setRodarAberto}
        onDisparado={aoDisparar}
      />
    </div>
  )
}
