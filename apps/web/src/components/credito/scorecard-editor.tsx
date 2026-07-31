'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Check, Save } from 'lucide-react'
import {
  FATOR_SCORE_LABELS,
  FAIXA_SCORE_LABELS,
  calcularScore,
  type DefinicaoScorecard,
  type FaixaScore,
  type FatorScore,
  type ParametrosScore,
  type SinaisScore,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ativarScorecardAction, salvarScorecardAction } from '@/actions/credito'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { buscarCreditoConfig, buscarScorecards, creditoKeys } from './queries'

/**
 * Editor do scorecard (04d §3.3), com PRÉVIA DE IMPACTO.
 *
 * A prévia é a razão de esta tela existir em vez de um formulário. Mudar o peso de um
 * fator move milhares de empresas entre faixas, e faixa vira chance de concessão, que
 * vira valor esperado, que vira a ordem da lista de prospecção. Ativar sem ver quantas
 * empresas mudam de lado é editar no escuro uma régua que decide o dia de alguém.
 *
 * A prévia roda o MESMO `calcularScore` do worker, sobre uma amostra real da base — não
 * uma reimplementação em SQL. Uma segunda implementação divergiria, e divergiria
 * justamente aqui, onde a divergência é invisível.
 */

const TAMANHO_AMOSTRA = 600

interface LinhaAmostra {
  cnpj: string
  faturamento_anual: number | null
  funcionarios_crescimento_12m: number | null
  capital_social: number | null
  data_inicio_atividade: string | null
  situacao_cadastral: string | null
  grupo_id: string | null
  grupo_spes_24m: number | null
  obras_ativas: number | null
  m2_em_execucao: number | null
  tem_protesto: boolean | null
  protestos_consultados_em: string | null
}

/**
 * A amostra vem do Explorador porque é lá que universo (capital, idade, situação) e
 * empresa (faturamento, headcount) já estão juntos. Uma amostra, não a base inteira:
 * 8 mil linhas × 9 fatores no browser trava a aba, e a distribuição de 600 já responde
 * "quantos mudam de faixa" com margem sobrando.
 */
async function buscarAmostra(): Promise<LinhaAmostra[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mercado_explorador')
    .select('cnpj, faturamento_estimado, funcionarios_crescimento_12m, capital_social, data_inicio_atividade, situacao_cadastral, grupo_id, grupo_spes_24m, obras_ativas, m2_em_execucao, tem_protesto, protestos_consultados_em')
    .in('tipo', ['construtora', 'incorporadora'])
    .not('empresa_id', 'is', null)
    .limit(TAMANHO_AMOSTRA)
  if (error) throw new Error(error.message)

  type Raw = Omit<LinhaAmostra, 'faturamento_anual'> & { faturamento_estimado: number | null }
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    ...r,
    faturamento_anual: r.faturamento_estimado,
  }))
}

function sinaisDe(l: LinhaAmostra): SinaisScore {
  return {
    protesto_consultado: l.protestos_consultados_em !== null,
    protesto_valor_total: l.tem_protesto ? 1 : 0,
    protesto_mais_recente_em: l.protestos_consultados_em,
    faturamento_estimado: l.faturamento_anual,
    capital_social: l.capital_social,
    data_inicio_atividade: l.data_inicio_atividade,
    situacao_cadastral: l.situacao_cadastral,
    grupo_conhecido: l.grupo_id !== null,
    grupo_spes_24m: l.grupo_spes_24m,
    obras_ativas: l.obras_ativas,
    m2_em_execucao: l.m2_em_execucao,
    funcionarios_crescimento_12m: l.funcionarios_crescimento_12m,
    certificado: 'nunca',
  }
}

function distribuir(
  amostra: LinhaAmostra[],
  def: DefinicaoScorecard,
  params: ParametrosScore,
): Record<string, number> {
  const d: Record<string, number> = {}
  for (const l of amostra) {
    const r = calcularScore(sinaisDe(l), def, params)
    d[r.faixa] = (d[r.faixa] ?? 0) + 1
  }
  return d
}

/** Quantas empresas trocam de faixa entre duas definições. É o número que decide. */
function quantasMudam(
  amostra: LinhaAmostra[],
  antes: DefinicaoScorecard,
  depois: DefinicaoScorecard,
  params: ParametrosScore,
): number {
  let n = 0
  for (const l of amostra) {
    const s = sinaisDe(l)
    if (calcularScore(s, antes, params).faixa !== calcularScore(s, depois, params).faixa) n++
  }
  return n
}

export function ScorecardEditor() {
  const qc = useQueryClient()
  const [rascunho, setRascunho] = React.useState<DefinicaoScorecard | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const versoes = useQuery({ queryKey: creditoKeys.scorecards(), queryFn: buscarScorecards })
  const config = useQuery({ queryKey: creditoKeys.config(), queryFn: buscarCreditoConfig })
  const amostra = useQuery({ queryKey: [...creditoKeys.all, 'amostra'], queryFn: buscarAmostra })

  const ativa = (versoes.data ?? []).find((v) => v.ativa) ?? null
  const definicaoAtiva = (ativa?.definicao ?? null) as DefinicaoScorecard | null

  React.useEffect(() => {
    if (definicaoAtiva && rascunho === null) setRascunho(structuredClone(definicaoAtiva))
  }, [definicaoAtiva, rascunho])

  const cfg = (config.data?.scorecard ?? {}) as Partial<ParametrosScore>
  const params: ParametrosScore = {
    corte_concessao: cfg.corte_concessao ?? 40,
    completude_minima: cfg.completude_minima ?? 0.5,
    recencia_protesto_dias: cfg.recencia_protesto_dias ?? 90,
    knockout_negada_meses: cfg.knockout_negada_meses ?? 6,
  }

  const previa = React.useMemo(() => {
    if (!amostra.data?.length || !definicaoAtiva || !rascunho) return null
    return {
      antes: distribuir(amostra.data, definicaoAtiva, params),
      depois: distribuir(amostra.data, rascunho, params),
      mudam: quantasMudam(amostra.data, definicaoAtiva, rascunho, params),
      total: amostra.data.length,
    }
    // `params` é reconstruído a cada render; as dependências reais são as três abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amostra.data, definicaoAtiva, rascunho])

  function ajustarPeso(fator: FatorScore, peso: number) {
    setRascunho((r) => {
      if (!r) return r
      const n = structuredClone(r)
      const f = n.fatores[fator]
      if (f) f.peso = peso
      return n
    })
  }

  function ajustarPontos(fator: FatorScore, indice: number, pontos: number) {
    setRascunho((r) => {
      if (!r) return r
      const n = structuredClone(r)
      const f = n.fatores[fator]
      if (f && 'faixas' in f && f.faixas[indice]) f.faixas[indice].pontos = pontos
      return n
    })
  }

  function ajustarCaso(fator: FatorScore, caso: string, pontos: number) {
    setRascunho((r) => {
      if (!r) return r
      const n = structuredClone(r)
      const f = n.fatores[fator]
      if (f && 'casos' in f) f.casos[caso] = pontos
      return n
    })
  }

  async function salvar(ativar: boolean) {
    if (!rascunho) return
    setSalvando(true)
    const r = await salvarScorecardAction({ definicao: rascunho, nome: `Ajuste ${new Date().toLocaleDateString('pt-BR')}` })
    if (!r.ok) {
      setSalvando(false)
      toast.error(r.message)
      return
    }
    if (ativar) {
      const a = await ativarScorecardAction({ id: r.data.id })
      setSalvando(false)
      if (!a.ok) {
        toast.error(a.message)
        return
      }
      toast.success(
        a.data.recalculo
          ? `Versão ${r.data.versao} ativada. O recálculo da base já foi disparado.`
          : `Versão ${r.data.versao} ativada, mas o recálculo não foi disparado: ${a.data.aviso ?? 'worker indisponível'}.`,
      )
    } else {
      setSalvando(false)
      toast.success(`Versão ${r.data.versao} salva (inativa).`)
    }
    setRascunho(null)
    void qc.invalidateQueries({ queryKey: creditoKeys.scorecards() })
  }

  if (versoes.isPending || config.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (!definicaoAtiva || !rascunho) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Nenhuma versão de scorecard ativa.</p>
        </CardContent>
      </Card>
    )
  }

  const pesoTotal = Object.values(rascunho.fatores).reduce((s, f) => s + (f?.peso ?? 0), 0)
  const alterado = JSON.stringify(rascunho) !== JSON.stringify(definicaoAtiva)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Scorecard</CardTitle>
                <Badge variant="outline">versão {ativa?.versao}</Badge>
              </div>
              <CardDescription>
                Pesos, limiares e pontos. A <strong>lógica</strong> de cada fator é fixa no
                código e testada; o que se edita aqui é a régua. Salvar cria uma versão nova —
                nada é sobrescrito, e todo score guarda a versão que o produziu.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="ghost" size="sm" disabled={!alterado} onClick={() => setRascunho(structuredClone(definicaoAtiva))}>
                Descartar
              </Button>
              <Button variant="outline" size="sm" disabled={!alterado || salvando} onClick={() => void salvar(false)}>
                <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
                Salvar sem ativar
              </Button>
              <Button size="sm" disabled={!alterado || salvando} onClick={() => void salvar(true)}>
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                Salvar e ativar
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Soma dos pesos: <span className="tabular-nums">{pesoTotal}</span>. Não precisa dar 100
            — o score é <strong>renormalizado</strong> sobre os fatores avaliáveis de cada
            empresa, então o que importa é a proporção entre eles.
          </p>

          <div className="space-y-3">
            {(Object.keys(rascunho.fatores) as FatorScore[]).map((fator) => {
              const f = rascunho.fatores[fator]
              if (!f) return null
              return (
                <div key={fator} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{FATOR_SCORE_LABELS[fator]}</p>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      peso
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={f.peso}
                        onChange={(e) => ajustarPeso(fator, Number(e.target.value))}
                        className="h-7 w-20"
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {'faixas' in f
                      ? f.faixas.map((fx, i) => (
                          <label key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="tabular-nums">
                              {fx.ate === null ? 'acima' : `≤ ${fx.ate.toLocaleString('pt-BR')}`}
                            </span>
                            <Input
                              type="number"
                              value={fx.pontos}
                              onChange={(e) => ajustarPontos(fator, i, Number(e.target.value))}
                              className="h-7 w-16"
                            />
                          </label>
                        ))
                      : Object.entries(f.casos).map(([caso, pontos]) => (
                          <label key={caso} className="flex items-center gap-1 text-xs text-muted-foreground">
                            {caso.replace(/_/g, ' ')}
                            <Input
                              type="number"
                              value={pontos}
                              onChange={(e) => ajustarCaso(fator, caso, Number(e.target.value))}
                              className="h-7 w-16"
                            />
                          </label>
                        ))}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Prévia de impacto</CardTitle>
          <CardDescription>
            Roda o mesmo cálculo do worker sobre {previa?.total ?? 0} sacados reais. Faixa vira
            chance de concessão, que vira valor esperado, que vira a ordem da lista de
            prospecção — mudar peso sem ver isto é editar no escuro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {amostra.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !previa ? (
            <p className="text-sm text-muted-foreground">Sem amostra para comparar.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                <span className={cn('font-semibold tabular-nums', previa.mudam > 0 && 'text-amber-600 dark:text-amber-400')}>
                  {previa.mudam}
                </span>{' '}
                de {previa.total} empresas da amostra mudam de faixa
                {previa.mudam > 0 && ` (${Math.round((previa.mudam / previa.total) * 100)}%)`}.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Faixa</TableHead>
                      <TableHead className="text-right">Vigente</TableHead>
                      <TableHead className="text-right">Com o ajuste</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(['alta', 'media', 'improvavel', 'dados_insuficientes'] as FaixaScore[]).map((faixa) => {
                      const a = previa.antes[faixa] ?? 0
                      const d = previa.depois[faixa] ?? 0
                      return (
                        <TableRow key={faixa}>
                          <TableCell>{FAIXA_SCORE_LABELS[faixa]}</TableCell>
                          <TableCell className="text-right tabular-nums">{a}</TableCell>
                          <TableCell className="text-right tabular-nums">{d}</TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              d - a > 0 && 'text-emerald-600 dark:text-emerald-400',
                              d - a < 0 && 'text-destructive',
                            )}
                          >
                            {d - a > 0 ? '+' : ''}
                            {d - a}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Histórico de versões</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(versoes.data ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">v{v.versao}</span>
                  <span className="text-muted-foreground">{v.nome ?? '—'}</span>
                  {v.ativa && <Badge className="text-[10px]">ativa</Badge>}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {new Date(v.criada_em).toLocaleDateString('pt-BR')}
                  {!v.ativa && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={async () => {
                        const r = await ativarScorecardAction({ id: v.id })
                        if (!r.ok) {
                          toast.error(r.message)
                          return
                        }
                        toast.success(`Versão ${v.versao} ativada; recálculo disparado.`)
                        void qc.invalidateQueries({ queryKey: creditoKeys.scorecards() })
                      }}
                    >
                      <ArrowRight className="mr-1 h-3 w-3" aria-hidden />
                      Ativar
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
