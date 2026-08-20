'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, History, Save } from 'lucide-react'
import {
  INDICADOR_LABELS,
  INDICADORES,
  PARAMETROS_PADRAO,
  TETO_LABELS,
  calcularAnalise,
  type ContextoAnalise,
  type IndicadorId,
  type ParametrosAnalise,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { salvarParametrosAction } from '@/actions/credito-analise'
import { analisePropriaKeys, buscarParametros } from './analise-propria/queries'
import { brl } from './analise-propria/resultado'

/**
 * O editor de parâmetros versionados (04j §10).
 *
 * ─── POR QUE HÁ UMA PRÉVIA, E POR QUE ELA É DE MENTIRA ──────────────────────
 * Mexer no percentual da capacidade financeira muda o limite de toda análise futura, e
 * ninguém consegue prever de cabeça o efeito de trocar 10% por 8% quando existem cinco
 * tetos e o que vale é o menor. A prévia roda o MESMO cálculo do worker — o
 * `calcularAnalise` do core, sem cópia — sobre uma empresa-exemplo fixa.
 *
 * A empresa é FICTÍCIA de propósito. Uma empresa real da base tornaria a prévia refém do
 * estado dela: no dia em que o balanço dela mudasse, o mesmo ajuste de parâmetro
 * mostraria um efeito diferente, e a tela deixaria de ser comparável consigo mesma.
 *
 * ─── NUNCA UPDATE ───────────────────────────────────────────────────────────
 * Salvar cria uma versão nova. As análises já concluídas continuam apontando para a
 * versão com que foram feitas — reescrevê-las apagaria o número que alguém defendeu.
 */

/** A empresa-exemplo. Números redondos para o efeito do ajuste ficar legível. */
const EXEMPLO: ContextoAnalise = {
  exercicios: [
    {
      exercicio: 2023,
      receita_bruta: 80_000_000,
      receita_liquida: 72_000_000,
      cmv: null,
      lucro_bruto: null,
      despesas_operacionais: null,
      depreciacao_amortizacao: null,
      resultado_equivalencia_patrimonial: null,
      ebitda: 9_000_000,
      resultado_financeiro: -2_500_000,
      lucro_liquido: 4_000_000,
      ativo_circulante: 48_000_000,
      ativo_nao_circulante: 32_000_000,
      caixa: 9_000_000,
      contas_receber: 18_000_000,
      estoques: 12_000_000,
      passivo_circulante: 30_000_000,
      passivo_nao_circulante: 18_000_000,
      emprestimos_curto_prazo: 9_000_000,
      emprestimos_longo_prazo: 14_000_000,
      fornecedores: null,
      patrimonio_liquido: 32_000_000,
    },
    {
      exercicio: 2024,
      receita_bruta: 100_000_000,
      receita_liquida: 90_000_000,
      cmv: null,
      lucro_bruto: null,
      despesas_operacionais: null,
      depreciacao_amortizacao: null,
      resultado_equivalencia_patrimonial: null,
      ebitda: 12_000_000,
      resultado_financeiro: -3_000_000,
      lucro_liquido: 6_000_000,
      ativo_circulante: 55_000_000,
      ativo_nao_circulante: 40_000_000,
      caixa: 11_000_000,
      contas_receber: 22_000_000,
      estoques: 14_000_000,
      passivo_circulante: 34_000_000,
      passivo_nao_circulante: 22_000_000,
      emprestimos_curto_prazo: 11_000_000,
      emprestimos_longo_prazo: 18_000_000,
      fornecedores: null,
      patrimonio_liquido: 38_000_000,
    },
  ],
  opera_na_plataforma: true,
  media_mensal_nfe: 3_000_000,
  limite_seguradora: 4_000_000,
  faixa_score: 'media',
  knockout_score: null,
}

function Numero({
  label,
  valor,
  onChange,
  sufixo,
  passo = 'any',
}: {
  label: string
  valor: number | null
  onChange: (n: number | null) => void
  sufixo?: string
  passo?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          step={passo}
          className="h-8 tabular-nums"
          value={valor === null ? '' : valor}
          placeholder="não configurado"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {sufixo && <span className="shrink-0 text-xs text-muted-foreground">{sufixo}</span>}
      </div>
    </div>
  )
}

export function ParametrosEditor() {
  const qc = useQueryClient()
  const versoes = useQuery({ queryKey: analisePropriaKeys.parametros(), queryFn: buscarParametros })
  const [p, setP] = React.useState<ParametrosAnalise | null>(null)
  const [nome, setNome] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const ativa = versoes.data?.find((v) => v.ativa) ?? null

  React.useEffect(() => {
    if (ativa && p === null) setP(ativa.definicao as unknown as ParametrosAnalise)
  }, [ativa, p])

  if (versoes.isPending || !p) return <Skeleton className="h-96 w-full rounded-lg" />

  const vigente = (ativa?.definicao as unknown as ParametrosAnalise | undefined) ?? PARAMETROS_PADRAO
  const antes = calcularAnalise(EXEMPLO, vigente)
  const depois = calcularAnalise(EXEMPLO, p)
  const mudou = JSON.stringify(vigente) !== JSON.stringify(p)

  const set = (fn: (d: ParametrosAnalise) => void) => {
    setP((atual) => {
      if (!atual) return atual
      const copia = JSON.parse(JSON.stringify(atual)) as ParametrosAnalise
      fn(copia)
      return copia
    })
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarParametrosAction({ definicao: p, nome: nome.trim() || undefined, ativar: true })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Versão ${r.data.versao} salva e ativada. As análises anteriores mantêm a delas.`)
    setNome('')
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.parametros() })
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Capacidade financeira</CardTitle>
            <CardDescription>
              Percentual da receita anual comprovada, penalizado quando a empresa está alavancada
              ou apertada de caixa. As penalidades multiplicam em cadeia.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Numero
              label="% da receita"
              sufixo="×"
              valor={p.capacidade_financeira.base_pct}
              onChange={(n) => set((d) => { d.capacidade_financeira.base_pct = n ?? 0 })}
            />
            <Numero
              label="Penalidade se dív.líq/EBITDA >"
              valor={p.capacidade_financeira.penalidade_alavancagem.acima_de}
              onChange={(n) => set((d) => { d.capacidade_financeira.penalidade_alavancagem.acima_de = n ?? 0 })}
            />
            <Numero
              label="Fator da penalidade"
              valor={p.capacidade_financeira.penalidade_alavancagem.fator}
              onChange={(n) => set((d) => { d.capacidade_financeira.penalidade_alavancagem.fator = n ?? 1 })}
            />
            <Numero
              label="Penalidade se liquidez <"
              valor={p.capacidade_financeira.penalidade_liquidez.abaixo_de}
              onChange={(n) => set((d) => { d.capacidade_financeira.penalidade_liquidez.abaixo_de = n ?? 0 })}
            />
            <Numero
              label="Fator da penalidade"
              valor={p.capacidade_financeira.penalidade_liquidez.fator}
              onChange={(n) => set((d) => { d.capacidade_financeira.penalidade_liquidez.fator = n ?? 1 })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Capacidade operacional e concentração</CardTitle>
            <CardDescription>
              O teto operacional só existe em reanálise de quem já opera. O de concentração fica
              <strong> fora do cálculo</strong> enquanto o PL do fundo estiver vazio — e isso é
              proposital: um número inventado aqui apertaria todo limite da casa.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Numero
              label="Fator sobre a média mensal de NF-e"
              valor={p.capacidade_operacional.fator}
              onChange={(n) => set((d) => { d.capacidade_operacional.fator = n ?? 1 })}
            />
            <Numero
              label="Janela de observação"
              sufixo="meses"
              valor={p.capacidade_operacional.janela_meses}
              onChange={(n) => set((d) => { d.capacidade_operacional.janela_meses = n ?? 6 })}
            />
            <Numero
              label="PL do fundo"
              sufixo="R$"
              valor={p.concentracao_portfolio.pl_fundo}
              onChange={(n) => set((d) => { d.concentracao_portfolio.pl_fundo = n })}
            />
            <Numero
              label="% máximo por sacado"
              valor={p.concentracao_portfolio.pct_max_por_sacado}
              onChange={(n) => set((d) => { d.concentracao_portfolio.pct_max_por_sacado = n ?? 0 })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bandas do scorecard</CardTitle>
            <CardDescription>
              Teto por faixa de chance de concessão. Faixa deixada em branco vira teto{' '}
              <strong>não aplicável</strong>, não teto zero.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            {['alta', 'media', 'improvavel', 'dados_insuficientes'].map((faixa) => (
              <Numero
                key={faixa}
                label={faixa}
                sufixo="R$"
                valor={p.scorecard.banda_por_faixa[faixa] ?? null}
                onChange={(n) => set((d) => { d.scorecard.banda_por_faixa[faixa] = n })}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cenários e knockouts</CardTitle>
            <CardDescription>
              Os knockouts derrubam a recomendação para NÃO OPERAR, sempre com o motivo listado.
              Deixar um limiar em branco desliga aquele knockout.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Numero
              label="Fator conservador"
              valor={p.cenarios.fator_conservador}
              onChange={(n) => set((d) => { d.cenarios.fator_conservador = n ?? 1 })}
            />
            <Numero
              label="Fator agressivo"
              valor={p.cenarios.fator_agressivo}
              onChange={(n) => set((d) => { d.cenarios.fator_agressivo = n ?? 1 })}
            />
            <Numero
              label="Mínimo operacional"
              sufixo="R$"
              valor={p.knockouts.minimo_operacional}
              onChange={(n) => set((d) => { d.knockouts.minimo_operacional = n ?? 0 })}
            />
            <Numero
              label="Knockout: dív.líq/EBITDA acima de"
              valor={p.knockouts.divida_liquida_ebitda_acima_de}
              onChange={(n) => set((d) => { d.knockouts.divida_liquida_ebitda_acima_de = n })}
            />
            <Numero
              label="Knockout: liquidez abaixo de"
              valor={p.knockouts.liquidez_corrente_abaixo_de}
              onChange={(n) => set((d) => { d.knockouts.liquidez_corrente_abaixo_de = n })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Faixas dos indicadores</CardTitle>
            <CardDescription>
              Verde e amarelo de cada indicador. A direção é fixa por indicador — liquidez é
              &ldquo;quanto maior melhor&rdquo;, endividamento é o contrário.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {INDICADORES.map((id) => {
                const f = p.indicadores[id as IndicadorId]
                return (
                  <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="min-w-40 flex-1 text-sm">{INDICADOR_LABELS[id as IndicadorId]}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {f.direcao === 'maior_melhor' ? 'maior é melhor' : 'menor é melhor'}
                    </Badge>
                    <div className="w-24">
                      <Numero
                        label="verde"
                        valor={f.verde}
                        onChange={(n) => set((d) => { d.indicadores[id as IndicadorId].verde = n ?? 0 })}
                      />
                    </div>
                    <div className="w-24">
                      <Numero
                        label="amarelo"
                        valor={f.amarelo}
                        onChange={(n) => set((d) => { d.indicadores[id as IndicadorId].amarelo = n ?? 0 })}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ── A prévia ─────────────────────────────────────────────────────── */}
      <div className="space-y-4 lg:sticky lg:top-4">
        <Card className={mudou ? 'border-primary' : undefined}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prévia do impacto</CardTitle>
            <CardDescription>
              O mesmo cálculo do worker, sobre uma construtora-exemplo fictícia que já opera. Ela é
              fixa para a prévia continuar comparável consigo mesma amanhã.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="text-xs text-muted-foreground">Vigente (v{ativa?.versao ?? '—'})</p>
                <p className="text-lg font-semibold tabular-nums">
                  {antes.recomendacao === 'operar' ? brl(antes.limite_recomendado) : 'NÃO OPERAR'}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Com estes parâmetros</p>
                <p className="text-lg font-semibold tabular-nums">
                  {depois.recomendacao === 'operar' ? brl(depois.limite_recomendado) : 'NÃO OPERAR'}
                </p>
              </div>
            </div>

            <ul className="space-y-1">
              {depois.tetos.map((t) => (
                <li key={t.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={t.vinculante ? 'font-medium' : 'text-muted-foreground'}>
                    {TETO_LABELS[t.id]}
                    {t.vinculante ? ' (vinculante)' : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {t.aplicavel ? brl(t.valor) : <span className="text-muted-foreground">n/a</span>}
                  </span>
                </li>
              ))}
            </ul>

            {depois.motivos_nao_operar.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-red-500/40 bg-red-500/5 p-2">
                {depois.motivos_nao_operar.map((m) => (
                  <li key={m} className="text-xs">
                    {m}
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="nome-versao" className="text-xs">
                Nome da versão (opcional)
              </Label>
              <Input
                id="nome-versao"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="ex.: teto de concentração ligado"
                className="h-8"
              />
              <Button
                className="w-full"
                size="sm"
                disabled={!mudou || salvando}
                onClick={() => void salvar()}
              >
                <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
                {salvando ? 'Salvando…' : mudou ? 'Salvar como nova versão' : 'Nada mudou'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Salvar cria uma versão nova e a ativa. As análises já feitas continuam apontando
                para a versão delas.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" aria-hidden />
              Versões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {(versoes.data ?? []).map((v) => (
                <li key={v.versao} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    v{v.versao}
                    {v.nome ? <span className="ml-1 text-muted-foreground">· {v.nome}</span> : null}
                  </span>
                  {v.ativa && <Badge variant="default" className="text-[10px]">ativa</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
