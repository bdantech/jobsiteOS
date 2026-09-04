'use client'

import * as React from 'react'
import { simularTac, type CondicoesFormulario } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { brl } from '../analise-propria/resultado'

/**
 * O SIMULADOR DA TAC PROPORCIONAL (04o §4).
 *
 * ─── POR QUE ESTA TELA EXISTE ───────────────────────────────────────────────
 * A tarifa é fixa em reais e o juros é proporcional ao valor. O resultado é que a
 * mesma tabela custa 19% numa nota de mil reais e 3,5% numa de cinquenta mil — e
 * ninguém enxerga isso olhando "2,9% ao mês + R$ 300 de TAC".
 *
 * O analista precifica lendo a taxa mensal, que é o número familiar. A coluna que
 * importa para o cliente pequeno é a da direita, e ela só aparece se alguém a
 * calcular. Por isso o simulador não é um extra: é a metade da informação que a
 * leitura natural do formulário esconde.
 *
 * ─── E POR QUE fee_min NÃO É PISO ───────────────────────────────────────────
 * A TAC cresce com o valor da nota até o limiar e para lá. `fee_min` é o que a nota
 * pequena PAGA, não o mínimo que se cobra dela. A conta mora em `calcularTac`, no
 * core, com teste — esta tela só a exibe.
 */

const pct = (n: number): string => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

export function SimuladorTac({
  condicoes,
  limiar,
  prazoDias = 30,
}: {
  condicoes: CondicoesFormulario
  limiar: number
  prazoDias?: number
}) {
  const linhas = React.useMemo(
    () =>
      simularTac(
        {
          monthly_rate_d0: condicoes.monthly_rate_d0,
          monthly_rate_d1: condicoes.monthly_rate_d1,
          fee_d0: condicoes.fee_d0,
          fee_min_d0: condicoes.fee_min_d0,
          fee_d1: condicoes.fee_d1,
          fee_min_d1: condicoes.fee_min_d1,
        },
        limiar,
        undefined,
        prazoDias,
      ),
    [condicoes, limiar, prazoDias],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Simulador</CardTitle>
        <CardDescription>
          A TAC cresce com o valor da nota até <strong>{brl(limiar)}</strong> e para lá.{' '}
          <strong>A TAC mínima não é piso de segurança</strong> — é o que a nota pequena paga. A
          taxa efetiva é (juros + TAC) ÷ valor, para {prazoDias} dias.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-normal">Nota</th>
                <th className="py-1.5 text-right font-normal">TAC D0</th>
                <th className="py-1.5 text-right font-normal">Custo D0</th>
                <th className="py-1.5 text-right font-normal">Efetiva D0</th>
                <th className="py-1.5 text-right font-normal">TAC D1</th>
                <th className="py-1.5 text-right font-normal">Custo D1</th>
                <th className="py-1.5 text-right font-normal">Efetiva D1</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {linhas.map((l) => (
                <tr key={l.valor_nf} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 text-left font-medium">{brl(l.valor_nf)}</td>
                  <td className="py-1.5 text-right">{brl(l.tac_d0)}</td>
                  <td className="py-1.5 text-right">{brl(l.custo_total_d0)}</td>
                  {/*
                   * A taxa efetiva da nota pequena é a que denuncia a tabela. Ela é
                   * destacada porque é o número que o analista NÃO estava olhando.
                   */}
                  <td className="py-1.5 text-right font-semibold">{pct(l.taxa_efetiva_d0)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{brl(l.tac_d1)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">
                    {brl(l.custo_total_d1)}
                  </td>
                  <td className="py-1.5 text-right">{pct(l.taxa_efetiva_d1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          TAC = TAC mínima + (TAC cheia − TAC mínima) × min(valor ÷ {brl(limiar)}, 1).
        </p>
      </CardContent>
    </Card>
  )
}
