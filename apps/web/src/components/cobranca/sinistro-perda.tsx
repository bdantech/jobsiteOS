'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Calculator } from 'lucide-react'
import { CREDITOS_COMPRADOR_LABELS, type CreditosComprador, type LinhaPerda, type ResultadoPerda } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { calcularEstimativaSinistroAction } from '@/actions/cobranca-gestao'
import { gestaoKeys, type SinistroDetalhe } from './gestao-queries'
import { numeroBr } from './sinistro-arquivos'
import { brl, dataHora } from './format'

/**
 * A perda e a indenização (§7.3), com a conta ABERTA. Ninguém deve descobrir o teto
 * da indenização no e-mail de recusa: cada dedução aparece com nome e origem, e o que
 * não se sabe (limite de crédito, valor pago ao cedente) vira aviso — não um zero.
 *
 * O cálculo roda na action, com o motor do core e os números do banco; daqui vão só
 * os créditos do comprador, que nenhuma tabela conhece inteiros. "Pagamentos" vem
 * sugerido com o que já entrou por títulos quitados nas cobranças do grupo.
 */

type ChaveCredito = keyof CreditosComprador
const CHAVES = Object.keys(CREDITOS_COMPRADOR_LABELS) as ChaveCredito[]

interface MemoriaGravada extends Partial<ResultadoPerda> {
  entrada?: { creditos?: CreditosComprador; limite_credito_vigente?: number | null; percentagem_segurada?: number; franquia?: number }
  calculado_em?: string
}

const fmt = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CalculoPerda({ d }: { d: SinistroDetalhe }) {
  const qc = useQueryClient()
  const gravada = (d.sinistro.memoria_perda ?? null) as MemoriaGravada | null

  const inicial = React.useMemo(() => {
    const base: Record<ChaveCredito, string> = Object.fromEntries(CHAVES.map((k) => [k, ''])) as Record<ChaveCredito, string>
    const c = gravada?.entrada?.creditos
    if (c) for (const k of CHAVES) base[k] = fmt(c[k])
    else if (d.pagamentos_do_grupo > 0) base.pagamentos = fmt(d.pagamentos_do_grupo)
    return base
  }, [gravada?.entrada?.creditos, d.pagamentos_do_grupo])

  const [creditos, setCreditos] = React.useState(inicial)
  const [resultado, setResultado] = React.useState<ResultadoPerda | null>(null)
  const [calculando, setCalculando] = React.useState(false)
  React.useEffect(() => setCreditos(inicial), [inicial])

  const mostrado: Partial<ResultadoPerda> | null = resultado ?? (gravada?.memoria ? gravada : null)
  const semCedido = d.titulos.filter((t) => t.valor_cedido === null).length

  async function calcular() {
    const valores: CreditosComprador = {}
    for (const k of CHAVES) {
      const n = numeroBr(creditos[k])
      if (creditos[k].trim() && (n === null || n < 0)) {
        toast.error(`Valor inválido em "${CREDITOS_COMPRADOR_LABELS[k]}".`)
        return
      }
      if (n) valores[k] = n
    }
    setCalculando(true)
    const r = await calcularEstimativaSinistroAction({ sinistro_id: d.sinistro.id, creditos: valores })
    setCalculando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setResultado(r.data.resultado)
    toast.success('Estimativa calculada e gravada no sinistro.')
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-4 w-4" aria-hidden />
          Perda segurada e indenização (cl. 22100.20 §3)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span>
            Percentagem segurada:{' '}
            <strong className="text-foreground">
              {d.apolice ? `${(Number(d.apolice.percentagem_segurada) * 100).toLocaleString('pt-BR')}%` : '—'}
            </strong>
          </span>
          <span>
            Franquia por comprador: <strong className="text-foreground">{brl(d.apolice?.franquia)}</strong>
          </span>
          <span>
            Limite de crédito vigente:{' '}
            <strong className="text-foreground">
              {d.limite_credito_vigente === null ? 'desconhecido' : brl(d.limite_credito_vigente)}
            </strong>
          </span>
        </div>

        {d.limite_credito_vigente === null || semCedido > 0 ? (
          <div className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {d.limite_credito_vigente === null ? (
              <p>A produção não informou o limite de crédito vigente deste comprador: o teto do limite não será aplicado.</p>
            ) : null}
            {semCedido > 0 ? (
              <p>
                {semCedido} título(s) sem o valor pago ao cedente: o teto “valor efetivamente pago ao cedente” não pode
                ser aplicado a eles.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-medium">Créditos do comprador (deduzem da perda)</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {CHAVES.map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`cred-${k}`} className="text-xs">
                  {CREDITOS_COMPRADOR_LABELS[k]}
                </Label>
                <Input
                  id={`cred-${k}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={creditos[k]}
                  onChange={(e) => setCreditos({ ...creditos, [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {d.pagamentos_do_grupo > 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Títulos quitados nas cobranças deste grupo somam {brl(d.pagamentos_do_grupo)} — sugerido em “Pagamentos
              recebidos”. Ajuste se algum deles não for deste sinistro.
            </p>
          ) : null}
          <Button size="sm" className="mt-3" onClick={() => void calcular()} disabled={calculando}>
            {calculando ? 'Calculando…' : 'Calcular e salvar estimativa'}
          </Button>
        </div>

        {mostrado?.memoria ? (
          <ContaAberta r={mostrado} calculadoEm={resultado ? null : (gravada?.calculado_em ?? null)} />
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma estimativa calculada ainda.</p>
        )}
      </CardContent>
    </Card>
  )
}

const SINAL: Record<LinhaPerda['sinal'], string> = { '+': '+', '-': '−', '=': '=', '×': '×', min: 'teto' }

function ContaAberta({ r, calculadoEm }: { r: Partial<ResultadoPerda>; calculadoEm: string | null }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {r.indenizavel === false ? (
          <Badge variant="critical">não indenizável — perda ≤ franquia (cl. 26100.00)</Badge>
        ) : (
          <Badge variant="success">indenização estimada {brl(r.indenizacao)}</Badge>
        )}
        {r.teto_aplicado === 'limite_credito' ? <Badge variant="warning">teto: limite de crédito</Badge> : null}
        {r.teto_aplicado === 'valor_pago_cedente' ? <Badge variant="warning">teto: valor pago ao cedente</Badge> : null}
        {calculadoEm ? <span className="text-xs text-muted-foreground">calculada em {dataHora(calculadoEm)}</span> : null}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="w-12 py-1 text-left font-medium" />
            <th className="py-1 text-left font-medium">Linha</th>
            <th className="py-1 text-left font-medium">Origem</th>
            <th className="py-1 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {(r.memoria ?? []).map((l, i) => (
            <tr key={i} className={cn('border-t border-border', l.sinal === '=' && 'font-semibold')}>
              <td className="py-1 font-mono text-xs text-muted-foreground">{SINAL[l.sinal] ?? l.sinal}</td>
              <td className="py-1">{l.rotulo}</td>
              <td className="py-1 text-xs text-muted-foreground">{l.origem}</td>
              <td className="py-1 text-right tabular-nums">{brl(l.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.avisos?.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-400">
          {r.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
