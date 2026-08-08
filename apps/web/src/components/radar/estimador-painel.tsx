'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Play, RefreshCw } from 'lucide-react'
import {
  MODELOS,
  MODELO_LABELS,
  TIPO_EMPRESA_LABELS,
  type Coeficientes,
  type ModeloId,
  type TipoEmpresa,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  recalibrarEstimadorAction,
  reestimarFaturamentoAction,
  rodarBackfillFuncionariosAction,
} from '@/actions/radar'
import { createClient } from '@/lib/supabase/client'
import { radarKeys } from './queries'

/**
 * A página do Estimador (04c §8): o que o modelo aprendeu e o quanto ele erra.
 *
 * Existe porque uma estimativa sem procedência não é usável numa conversa comercial.
 * Quando alguém pergunta "de onde saiu esse R$ 40M?", a resposta precisa ser um
 * lugar, não uma memória — e o erro mediano por modelo é o que impede que o número
 * seja levado a sério demais.
 */

interface VersaoEstimador {
  versao: number
  coeficientes: Coeficientes
  n_amostras_por_tipo: Record<string, number>
  erro_mediano_por_modelo: Record<string, number | null>
  calibrado_em: string
}

async function buscarVersaoAtiva(): Promise<VersaoEstimador | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('estimador_versoes')
    .select('versao, coeficientes, n_amostras_por_tipo, erro_mediano_por_modelo, calibrado_em')
    .eq('ativa', true)
    .order('calibrado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as VersaoEstimador) ?? null
}

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const pct = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(2)}%`

/**
 * O erro é guardado em LOG (prever 2× e prever metade erram igual). Aqui vira "quanto
 * o modelo tipicamente erra, em %", que é a única forma em que esse número serve para
 * alguém decidir se confia.
 */
function erroLegivel(erroLog: number | null | undefined): string {
  if (erroLog === null || erroLog === undefined || !Number.isFinite(erroLog)) return '—'
  return `±${(Math.exp(erroLog) * 100 - 100).toFixed(0)}%`
}

export function EstimadorPainel() {
  const qc = useQueryClient()
  const [rodando, setRodando] = React.useState<string | null>(null)

  const { data, isPending, isError, error } = useQuery({
    queryKey: [...radarKeys.all, 'estimador'],
    queryFn: buscarVersaoAtiva,
  })

  async function rodar(rotulo: string, acao: () => Promise<{ ok: boolean; message?: string }>) {
    setRodando(rotulo)
    const r = (await acao()) as { ok: boolean; message?: string; data?: { enfileirado: boolean; aviso?: string } }
    setRodando(null)
    if (!r.ok) {
      toast.error(r.message ?? 'Falhou.')
      return
    }
    if (r.data && !r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'O worker não aceitou o job.')
      return
    }
    toast.success(`${rotulo} disparado. Acompanhe em alguns instantes.`)
    void qc.invalidateQueries({ queryKey: [...radarKeys.all, 'estimador'] })
  }

  if (isPending) return <Skeleton className="h-64 w-full rounded-lg" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar o estimador.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const tipos = data ? Object.keys(data.coeficientes.porTipo ?? {}) : []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Estimador de faturamento</CardTitle>
                {data && <Badge variant="outline">versão {data.versao}</Badge>}
              </div>
              <CardDescription>
                Calibrado no faturamento que se <strong>conhece</strong> — o que o cliente
                declarou e o que um ranking setorial publicou. Eles são a régua para estimar
                quem não tem número. O método só vale enquanto o SINAL for medido do mesmo
                jeito dos dois lados: MRR e usuários saem do nosso sistema sempre, então
                servem; headcount de ranking é pessoal graduado e não se mistura com o do
                Apollo, então as amostras publicadas entram sem ele.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={rodando !== null}
                onClick={() => void rodar('Recalibrar', recalibrarEstimadorAction)}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                Recalibrar agora
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rodando !== null}
                onClick={() => void rodar('Reestimar', reestimarFaturamentoAction)}
                title="Reaplica os coeficientes vigentes sem recalibrar."
              >
                <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
                Só reestimar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rodando !== null}
                onClick={() => void rodar('Backfill de funcionários', rodarBackfillFuncionariosAction)}
                title="Relê o headcount que já veio nos enriquecimentos pagos. Custo zero."
              >
                Backfill de headcount
              </Button>
            </div>
          </div>
        </CardHeader>

        {!data ? (
          <CardContent>
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhuma calibração ainda.</p>
              <p className="mt-1">
                Sem cliente com faturamento declarado não há régua, e estimar sem régua seria
                inventar. Declare o faturamento de alguns clientes na Company 360 e rode
                &ldquo;Recalibrar agora&rdquo;.
              </p>
            </div>
          </CardContent>
        ) : (
          <CardContent className="space-y-6">
            {/* ── Erro por modelo ── */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Erro típico de cada modelo</h3>
              <p className="text-xs text-muted-foreground">
                Medido contra as próprias amostras de calibração, então é otimista por
                construção: o modelo já viu esses números. O peso de cada modelo na
                combinação é o inverso disto — quem erra mais, pesa menos.
              </p>
              <p className="text-xs text-muted-foreground">
                <strong>MRR e usuários de ERP são a mesma família de sinal</strong>: saem do
                mesmo dado e concordam mecanicamente. Confiança <em>alta</em> exige duas
                famílias independentes — ERP <strong>e</strong> equipe. Enquanto não houver
                headcount na base, nenhuma estimativa passa de <em>média</em>, e isso está
                certo.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {MODELOS.map((m: ModeloId) => (
                  <div key={m} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{MODELO_LABELS[m]}</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {erroLegivel(data.erro_mediano_por_modelo?.[m])}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Coeficientes ── */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Coeficientes vigentes</h3>
              <p className="text-xs text-muted-foreground">
                Um tipo só ganha coeficientes próprios com amostras suficientes
                (<code>n_minimo_calibracao_por_tipo</code>); abaixo disso ele usa o global. Um
                ratio calibrado em duas empresas não é um ratio — é o acaso das duas.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Escopo</TableHead>
                      <TableHead className="text-right">n</TableHead>
                      <TableHead className="text-right">R$ por funcionário</TableHead>
                      <TableHead className="text-right">MRR sobre faturamento</TableHead>
                      <TableHead className="text-right">R$ por usuário de ERP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Global</TableCell>
                      <TableCell className="text-right tabular-nums">{data.coeficientes.global.n}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(data.coeficientes.global.ratio_fat_por_funcionario)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(data.coeficientes.global.pct_mrr_sobre_faturamento)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(data.coeficientes.global.fat_por_usuario_erp)}
                      </TableCell>
                    </TableRow>
                    {tipos.map((t) => {
                      const c = data.coeficientes.porTipo[t]!
                      return (
                        <TableRow key={t}>
                          <TableCell>{TIPO_EMPRESA_LABELS[t as TipoEmpresa] ?? t}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {brl(c.ratio_fat_por_funcionario)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(c.pct_mrr_sobre_faturamento)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {brl(c.fat_por_usuario_erp)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* ── Amostras por tipo ── */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Declarantes por tipo</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.n_amostras_por_tipo ?? {}).map(([tipo, n]) => (
                  <Badge key={tipo} variant="outline">
                    {TIPO_EMPRESA_LABELS[tipo as TipoEmpresa] ?? tipo}: {n}
                  </Badge>
                ))}
                {Object.keys(data.n_amostras_por_tipo ?? {}).length === 0 && (
                  <span className="text-sm text-muted-foreground">Nenhum.</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Calibrado em {new Date(data.calibrado_em).toLocaleString('pt-BR')}.
              </p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
