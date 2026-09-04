'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, History, Save } from 'lucide-react'
import {
  COLUNAS_SCORE,
  FAIXAS_FATURAMENTO,
  FAIXA_FATURAMENTO_LABELS,
  FAIXA_SCORE_LABELS,
  MATRIZ_PADRAO,
  simularTac,
  sugerirCondicoes,
  type ColunaScore,
  type FaixaFaturamento,
  type FaixaScore,
  type MatrizPrecificacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ativarMatrizAction, salvarMatrizAction } from '@/actions/credito-precificacao'
import { brl } from './analise-propria/resultado'
import {
  buscarAmostraPrecificacao,
  buscarMatrizes,
  condicoesKeys,
  type LinhaAmostra,
} from './condicoes/queries'

/**
 * O editor da matriz de precificação (04o §6), webOnly.
 *
 * ─── POR QUE A PRÉVIA É SOBRE ANÁLISES REAIS, E NÃO SOBRE UMA FICTÍCIA ──────
 * O editor de parâmetros da análise (04j) usa uma empresa-exemplo inventada, e por um
 * bom motivo: lá o que se ajusta são fórmulas de balanço, e uma empresa real deixaria
 * a prévia refém do balanço dela.
 *
 * Aqui a pergunta é outra. Mexer numa célula da matriz muda o preço de um SEGMENTO da
 * carteira, e a única coisa que responde "quantos clientes isso atinge, e quanto" é a
 * carteira. Uma empresa fictícia diria o efeito numa célula e calaria sobre as outras
 * vinte e quatro — que é justamente onde o estrago passa despercebido.
 *
 * A prévia roda o MESMO `sugerirCondicoes` do formulário da análise, sem cópia.
 *
 * ─── NUNCA UPDATE ───────────────────────────────────────────────────────────
 * Salvar cria versão nova. As condições já publicadas continuam apontando para a
 * matriz que as sugeriu — reprecificar retroativamente mudaria o preço que alguém já
 * combinou com um cliente.
 */

const num = (n: number, casas = 3): string =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: casas })

function Numero({
  label,
  valor,
  onChange,
  sufixo,
  passo = 'any',
}: {
  label: string
  valor: number
  onChange: (n: number) => void
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
          value={Number.isFinite(valor) ? valor : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        {sufixo && <span className="shrink-0 text-xs text-muted-foreground">{sufixo}</span>}
      </div>
    </div>
  )
}

interface Resumo {
  n: number
  juros: number
  tac: number
  comissao: number
  /** TAC efetiva de uma nota de mil reais: a ponta que a média de tarifa esconde. */
  efetivaMil: number
}

function resumir(linhas: LinhaAmostra[], matriz: MatrizPrecificacao): Resumo {
  if (linhas.length === 0) return { n: 0, juros: 0, tac: 0, comissao: 0, efetivaMil: 0 }
  let juros = 0
  let tac = 0
  let comissao = 0
  let efetiva = 0
  for (const l of linhas) {
    const c = sugerirCondicoes(l, matriz).condicoes
    juros += c.monthly_rate_d0
    tac += c.fee_d0
    comissao += c.commission_percent
    const [mil] = simularTac(
      {
        monthly_rate_d0: c.monthly_rate_d0,
        monthly_rate_d1: c.monthly_rate_d1,
        fee_d0: c.fee_d0,
        fee_min_d0: c.fee_min_d0,
        fee_d1: c.fee_d1,
        fee_min_d1: c.fee_min_d1,
      },
      matriz.faixas.limiar_proporcionalidade_tac,
      [1_000],
    )
    efetiva += mil?.taxa_efetiva_d0 ?? 0
  }
  const n = linhas.length
  return { n, juros: juros / n, tac: tac / n, comissao: comissao / n, efetivaMil: efetiva / n }
}

export function PrecificacaoEditor() {
  const qc = useQueryClient()
  const versoes = useQuery({ queryKey: condicoesKeys.matrizes(), queryFn: buscarMatrizes })
  const [meses, setMeses] = React.useState(3)
  const amostra = useQuery({
    queryKey: condicoesKeys.amostra(meses),
    queryFn: () => buscarAmostraPrecificacao(meses),
  })

  const [m, setM] = React.useState<MatrizPrecificacao | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const ativa = versoes.data?.find((v) => v.ativa) ?? null

  React.useEffect(() => {
    if (ativa && m === null) setM(ativa.definicao as unknown as MatrizPrecificacao)
  }, [ativa, m])

  if (versoes.isPending || !m) return <Skeleton className="h-96 w-full rounded-lg" />

  const vigente = (ativa?.definicao as unknown as MatrizPrecificacao | undefined) ?? MATRIZ_PADRAO
  const mudou = JSON.stringify(vigente) !== JSON.stringify(m)
  const linhas = amostra.data ?? []
  const antes = resumir(linhas, vigente)
  const depois = resumir(linhas, m)

  const set = (fn: (d: MatrizPrecificacao) => void) => {
    setM((atual) => {
      if (!atual) return atual
      const copia = JSON.parse(JSON.stringify(atual)) as MatrizPrecificacao
      fn(copia)
      return copia
    })
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarMatrizAction({ definicao: m, ativar: true })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      `Matriz v${r.data.versao} salva e ativada. As condições já publicadas mantêm a versão delas.`,
    )
    void qc.invalidateQueries({ queryKey: condicoesKeys.matrizes() })
  }

  async function ativar(versao: number) {
    const r = await ativarMatrizAction(versao)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Matriz v${versao} ativada.`)
    setM(null)
    void qc.invalidateQueries({ queryKey: condicoesKeys.matrizes() })
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Faixas globais</CardTitle>
            <CardDescription>
              Piso e teto de tudo. Os ajustes movem a sugestão <strong>dentro</strong> destas
              faixas; sair delas é decisão do analista, com justificativa registrada.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero
              label="Juros D0 mínimo"
              sufixo="% a.m."
              valor={m.faixas.juros.d0_min}
              onChange={(n) => set((d) => { d.faixas.juros.d0_min = n })}
            />
            <Numero
              label="Juros D0 máximo"
              sufixo="% a.m."
              valor={m.faixas.juros.d0_max}
              onChange={(n) => set((d) => { d.faixas.juros.d0_max = n })}
            />
            <Numero
              label="Desconto D1 mínimo"
              sufixo="p.p."
              valor={m.faixas.juros.d1_desconto_min}
              onChange={(n) => set((d) => { d.faixas.juros.d1_desconto_min = n })}
            />
            <Numero
              label="Desconto D1 máximo"
              sufixo="p.p."
              valor={m.faixas.juros.d1_desconto_max}
              onChange={(n) => set((d) => { d.faixas.juros.d1_desconto_max = n })}
            />
            <Numero
              label="TAC D0 mínima"
              sufixo="R$"
              valor={m.faixas.tac.fee_d0_min}
              onChange={(n) => set((d) => { d.faixas.tac.fee_d0_min = n })}
            />
            <Numero
              label="TAC D0 máxima"
              sufixo="R$"
              valor={m.faixas.tac.fee_d0_max}
              onChange={(n) => set((d) => { d.faixas.tac.fee_d0_max = n })}
            />
            <Numero
              label="TAC mínima, % da TAC cheia"
              valor={m.faixas.tac.fee_min_d0_pct_do_fee}
              onChange={(n) => set((d) => { d.faixas.tac.fee_min_d0_pct_do_fee = n })}
            />
            <Numero
              label="Limiar da TAC proporcional"
              sufixo="R$"
              valor={m.faixas.limiar_proporcionalidade_tac}
              onChange={(n) => set((d) => { d.faixas.limiar_proporcionalidade_tac = n })}
            />
            <Numero
              label="Desconto TAC D1 mínimo"
              valor={m.faixas.tac.fee_d1_desconto_pct_min}
              onChange={(n) => set((d) => { d.faixas.tac.fee_d1_desconto_pct_min = n })}
            />
            <Numero
              label="Desconto TAC D1 máximo"
              valor={m.faixas.tac.fee_d1_desconto_pct_max}
              onChange={(n) => set((d) => { d.faixas.tac.fee_d1_desconto_pct_max = n })}
            />
            <Numero
              label="Comissão mínima"
              sufixo="%"
              valor={m.faixas.comissao.min}
              onChange={(n) => set((d) => { d.faixas.comissao.min = n })}
            />
            <Numero
              label="Comissão máxima"
              sufixo="%"
              valor={m.faixas.comissao.max}
              onChange={(n) => set((d) => { d.faixas.comissao.max = n })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Padrões e fixos</CardTitle>
            <CardDescription>
              Os fixos não aparecem no formulário da análise: são política da casa, e mudam aqui
              para toda a carteira de uma vez.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero
              label="Valor máximo por nota"
              sufixo="R$"
              valor={m.faixas.max_invoice_amount_default}
              onChange={(n) => set((d) => { d.faixas.max_invoice_amount_default = n })}
            />
            <Numero
              label="Prazo máximo"
              sufixo="dias"
              passo="1"
              valor={m.faixas.max_due_date_days_default}
              onChange={(n) => set((d) => { d.faixas.max_due_date_days_default = n })}
            />
            <Numero
              label="Validade"
              sufixo="meses"
              passo="1"
              valor={m.faixas.validade_meses_default}
              onChange={(n) => set((d) => { d.faixas.validade_meses_default = n })}
            />
            <Numero
              label="Multa"
              sufixo="%"
              valor={m.faixas.fixos.bill_fine_percent}
              onChange={(n) => set((d) => { d.faixas.fixos.bill_fine_percent = n })}
            />
            <Numero
              label="Prorrogação"
              sufixo="%"
              valor={m.faixas.fixos.extension_rate_percent}
              onChange={(n) => set((d) => { d.faixas.fixos.extension_rate_percent = n })}
            />
            <Numero
              label="Limite invest back"
              sufixo="R$"
              valor={m.faixas.fixos.invest_back_limit}
              onChange={(n) => set((d) => { d.faixas.fixos.invest_back_limit = n })}
            />
            <Numero
              label="Comissão invest back"
              sufixo="%"
              valor={m.faixas.fixos.invest_back_commission_percent}
              onChange={(n) => set((d) => { d.faixas.fixos.invest_back_commission_percent = n })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ajustes</CardTitle>
            <CardDescription>
              Somados à célula antes do corte pela faixa global. Positivo encarece.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                ['cobertura_atradius', 'Cobertura da seguradora'],
                ['protesto', 'Protesto'],
                ['prazo_medio_alto', 'Prazo médio alto'],
                ['ticket_medio_baixo', 'Ticket médio baixo'],
                ['ticket_medio_alto', 'Ticket médio alto'],
              ] as const
            ).map(([id, label]) => (
              <div key={id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
                <p className="self-center text-sm sm:col-span-4">{label}</p>
                <Numero
                  label="Juros"
                  sufixo="p.p."
                  valor={m.ajustes[id].juros_pp}
                  onChange={(n) => set((d) => { d.ajustes[id].juros_pp = n })}
                />
                <Numero
                  label="TAC"
                  sufixo="×"
                  valor={m.ajustes[id].fee_pct}
                  onChange={(n) => set((d) => { d.ajustes[id].fee_pct = n })}
                />
                <Numero
                  label="Comissão"
                  sufixo="p.p."
                  valor={m.ajustes[id].comissao_pp}
                  onChange={(n) => set((d) => { d.ajustes[id].comissao_pp = n })}
                />
                {id === 'prazo_medio_alto' && (
                  <Numero
                    label="Acima de"
                    sufixo="dias"
                    passo="1"
                    valor={m.ajustes.prazo_medio_alto.acima_de_dias}
                    onChange={(n) => set((d) => { d.ajustes.prazo_medio_alto.acima_de_dias = n })}
                  />
                )}
                {id === 'ticket_medio_baixo' && (
                  <Numero
                    label="Abaixo de"
                    sufixo="R$"
                    valor={m.ajustes.ticket_medio_baixo.abaixo_de}
                    onChange={(n) => set((d) => { d.ajustes.ticket_medio_baixo.abaixo_de = n })}
                  />
                )}
                {id === 'ticket_medio_alto' && (
                  <Numero
                    label="Acima de"
                    sufixo="R$"
                    valor={m.ajustes.ticket_medio_alto.acima_de}
                    onChange={(n) => set((d) => { d.ajustes.ticket_medio_alto.acima_de = n })}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Células</CardTitle>
            <CardDescription>
              Porte × faixa de score. Cada célula define o <strong>juros D0</strong>, a{' '}
              <strong>TAC D0</strong> e a <strong>comissão</strong>; o D1 e as TACs mínimas são
              derivados pelas regras acima — não se digitam, para não existirem vinte e cinco
              lugares onde alguém possa pôr o D1 mais caro que o D0.{' '}
              <em>Dados insuficientes</em> é precificado como <em>improvável</em>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {FAIXAS_FATURAMENTO.map((fx) => (
              <div key={fx.id} className="rounded-lg border p-3">
                <p className="mb-2 text-sm font-medium">
                  {FAIXA_FATURAMENTO_LABELS[fx.id as FaixaFaturamento]}
                </p>
                <div className="grid gap-3 lg:grid-cols-3">
                  {COLUNAS_SCORE.map((col) => (
                    <div key={col} className="space-y-2 rounded-md border p-2">
                      <p className="text-xs text-muted-foreground">
                        Score {FAIXA_SCORE_LABELS[col as FaixaScore] ?? col}
                      </p>
                      <Numero
                        label="Juros D0"
                        sufixo="%"
                        passo="0.01"
                        valor={m.celulas[fx.id as FaixaFaturamento][col as ColunaScore].monthly_rate_d0}
                        onChange={(n) =>
                          set((d) => {
                            d.celulas[fx.id as FaixaFaturamento][col as ColunaScore].monthly_rate_d0 = n
                          })
                        }
                      />
                      <Numero
                        label="TAC D0"
                        sufixo="R$"
                        passo="1"
                        valor={m.celulas[fx.id as FaixaFaturamento][col as ColunaScore].fee_d0}
                        onChange={(n) =>
                          set((d) => {
                            d.celulas[fx.id as FaixaFaturamento][col as ColunaScore].fee_d0 = n
                          })
                        }
                      />
                      <Numero
                        label="Comissão"
                        sufixo="%"
                        passo="0.01"
                        valor={
                          m.celulas[fx.id as FaixaFaturamento][col as ColunaScore].commission_percent
                        }
                        onChange={(n) =>
                          set((d) => {
                            d.celulas[fx.id as FaixaFaturamento][col as ColunaScore].commission_percent = n
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Prévia na carteira</CardTitle>
              <CardDescription>
                {amostra.isPending
                  ? 'Carregando as análises aprovadas…'
                  : `Com esta matriz, as ${linhas.length} análises aprovadas do período teriam ficado assim.`}
              </CardDescription>
            </div>
            <Select value={String(meses)} onValueChange={(v) => setMeses(Number(v))}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Trimestre</SelectItem>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-3">
            {linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma análise aprovada no período. A prévia precisa de carteira para dizer
                alguma coisa — e um número inventado aqui seria pior que o silêncio.
              </p>
            ) : (
              <>
                <Comparacao rotulo="Juros D0 médio" antes={`${num(antes.juros, 2)}%`} depois={`${num(depois.juros, 2)}%`} />
                <Comparacao rotulo="TAC D0 média" antes={brl(antes.tac)} depois={brl(depois.tac)} />
                <Comparacao
                  rotulo="Comissão média"
                  antes={`${num(antes.comissao, 2)}%`}
                  depois={`${num(depois.comissao, 2)}%`}
                />
                {/*
                 * A efetiva na nota de mil reais é a linha que impede uma "pequena
                 * mudança de TAC" de virar preço predatório no ticket pequeno sem
                 * ninguém perceber: ela move muito mais rápido que a média de tarifa.
                 */}
                <Comparacao
                  rotulo="Efetiva na NF de R$ 1.000"
                  antes={`${num(antes.efetivaMil, 2)}%`}
                  depois={`${num(depois.efetivaMil, 2)}%`}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Salvar</CardTitle>
            <CardDescription>
              Cria uma versão nova e a ativa. Não reprecifica nada: as condições já publicadas
              continuam com a matriz delas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" size="sm" disabled={!mudou || salvando} onClick={() => void salvar()}>
              <Save className="mr-1 size-3.5" aria-hidden />
              {salvando ? 'Salvando…' : mudou ? 'Salvar como nova versão' : 'Nada mudou'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4" aria-hidden />
              Versões
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {(versoes.data ?? []).map((v) => (
                <li key={v.versao} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    v{v.versao}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {new Date(v.criada_em).toLocaleDateString('pt-BR')}
                    </span>
                  </span>
                  {v.ativa ? (
                    <Badge variant="default" className="text-[10px]">
                      ativa
                    </Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void ativar(v.versao)}>
                      Ativar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Comparacao({ rotulo, antes, depois }: { rotulo: string; antes: string; depois: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
      <div>
        <p className="text-[10px] text-muted-foreground">{rotulo} · vigente</p>
        <p className="text-sm tabular-nums">{antes}</p>
      </div>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="text-right">
        <p className="text-[10px] text-muted-foreground">com esta matriz</p>
        <p className="text-sm font-semibold tabular-nums">{depois}</p>
      </div>
    </div>
  )
}
