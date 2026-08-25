'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator } from 'lucide-react'
import {
  FASE_CONTA_LABELS,
  GESTAO_OPERACAO_LABELS,
  GESTOES_OPERACAO,
  PAPEL_COMISSAO_LABELS,
  PARAMETROS_COMISSAO,
  simularComissao,
  type CommissionParam,
  type GestaoOperacao,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarParametros, comissaoKeys, vigentesHoje } from '../queries-comissao'
import { brl, numero } from './format'

/**
 * O simulador (§7.4): quanto uma cessão paga, e quanto ela CUSTA.
 *
 * Chama `simularComissao` do core — a mesma função que o motor usa para lançar. Uma
 * segunda implementação "só para simular" é como uma tela passa meses mostrando um número
 * que a folha nunca pagou, e ninguém descobre porque as duas parecem certas.
 *
 * A coluna PROPOSTO existe porque a pergunta real de quem mexe em taxa nunca é "quanto
 * paga?" e sim "quanto muda se eu mexer?". Editar o parâmetro para descobrir isso seria
 * publicar uma vigência para fazer uma conta.
 */

const CHAVES_TAXA = PARAMETROS_COMISSAO.filter((p) => p.grupo === 'taxas').map((p) => p.chave)

export function Simulador() {
  const [volume, setVolume] = React.useState('500000')
  const [dias, setDias] = React.useState('45')
  const [gestao, setGestao] = React.useState<GestaoOperacao>('prospeccao_ativa')
  const [idade, setIdade] = React.useState('2')
  const [propostos, setPropostos] = React.useState<Record<string, string>>({})

  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.parametros(),
    queryFn: buscarParametros,
  })

  if (isPending) return <Skeleton className="h-96 w-full" />

  const vigentes: CommissionParam[] = vigentesHoje(data ?? []).filter((p) => p.vendedor_id === null)

  /*
   * Os propostos são os vigentes com os valores editados por cima — e só os editados.
   * Substituir o conjunto inteiro faria um campo em branco significar "parâmetro
   * inexistente", que é uma afirmação bem diferente de "não mexi neste".
   */
  const comPropostos: CommissionParam[] = vigentes.map((p) => {
    const bruto = propostos[p.chave]
    if (bruto === undefined || bruto.trim() === '') return p
    const n = Number(bruto)
    return Number.isFinite(n) ? { ...p, valor: n } : p
  })

  const entrada = {
    volume: Number(volume) || 0,
    dias: Number(dias) || 0,
    gestaoOperacao: gestao,
    idadeMeses: Number(idade) || 0,
  }
  const atual = simularComissao(entrada, vigentes)
  const proposto = simularComissao(entrada, comPropostos)
  const mexeu = Object.values(propostos).some((v) => v.trim() !== '')

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4" aria-hidden /> A cessão
          </CardTitle>
          <CardDescription>
            A idade entra como número de meses, não como data: a pergunta é &quot;e se a conta
            tivesse 8 meses?&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sim-volume">Valor cedido (R$)</Label>
              <Input id="sim-volume" type="number" min={0} step="1000" value={volume}
                onChange={(e) => setVolume(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-dias">Dias de antecipação</Label>
              <Input id="sim-dias" type="number" min={0} value={dias}
                onChange={(e) => setDias(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-gestao">Classificação do sacado</Label>
              <select
                id="sim-gestao"
                value={gestao}
                onChange={(e) => setGestao(e.target.value as GestaoOperacao)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {GESTOES_OPERACAO.map((g) => (
                  <option key={g} value={g}>{GESTAO_OPERACAO_LABELS[g]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-idade">Idade da conta (meses)</Label>
              <Input id="sim-idade" type="number" min={0} value={idade}
                onChange={(e) => setIdade(e.target.value)} className="tabular-nums" />
            </div>
          </div>

          <div className="rounded-md border p-3 text-sm">
            <p className="text-xs text-muted-foreground">VOP desta cessão</p>
            <p className="text-xl font-semibold tabular-nums">{numero(atual.vop)}</p>
            <p className="text-xs text-muted-foreground">
              {numero(entrada.volume)} × {entrada.dias}/
              {vigentes.find((p) => p.chave === 'dias_referencia_vop')?.valor ?? 30}
              {' · '}
              fase <Badge variant="outline" className="text-[10px]">{FASE_CONTA_LABELS[atual.fase]}</Badge>
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Taxas propostas (deixe em branco para usar a vigente)
            </p>
            {CHAVES_TAXA.map((chave) => {
              const p = PARAMETROS_COMISSAO.find((x) => x.chave === chave)!
              const vigente = vigentes.find((x) => x.chave === chave)
              return (
                <div key={chave} className="flex items-center justify-between gap-2 text-sm">
                  <label htmlFor={`prop-${chave}`} className="flex-1 text-muted-foreground">
                    {p.rotulo}
                    <span className="ml-1 text-xs">({vigente ? brl(vigente.valor) : 'não publicada'})</span>
                  </label>
                  <Input
                    id={`prop-${chave}`}
                    type="number"
                    min={0}
                    step="10"
                    placeholder="—"
                    value={propostos[chave] ?? ''}
                    onChange={(e) => setPropostos((s) => ({ ...s, [chave]: e.target.value }))}
                    className="h-8 w-28 text-right tabular-nums"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O que ela paga</CardTitle>
          <CardDescription>
            Este é o custo comercial da operação. Compare com o spread dela antes de mexer
            em qualquer taxa.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-normal">Papel</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Taxa vigente</th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">Vigente</th>
                  {mexeu ? (
                    <th scope="col" className="px-3 py-2 text-right font-normal">Proposto</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {atual.linhas.map((l, i) => {
                  const prop = proposto.linhas[i]
                  return (
                    <tr key={l.papel}>
                      <td className="px-3 py-2">
                        {PAPEL_COMISSAO_LABELS[l.papel]}
                        {l.chave === null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {atual.fase === 'RESIDUAL' ? 'sunset atingido' : 'sem taxa'}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {l.taxa === null ? '—' : `${brl(l.taxa)}/MM`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(l.valor)}</td>
                      {mexeu ? (
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            (prop?.valor ?? 0) !== l.valor ? 'font-medium' : 'text-muted-foreground'
                          }`}
                        >
                          {brl(prop?.valor ?? 0)}
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t">
                <tr>
                  <td className="px-3 py-2 font-medium">Total</td>
                  <td />
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(atual.total)}</td>
                  {mexeu ? (
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(proposto.total)}</td>
                  ) : null}
                </tr>
                <tr>
                  <td className="px-3 py-2 text-xs text-muted-foreground">Custo por milhão de VOP</td>
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                    {brl(atual.custoPorMm)}
                  </td>
                  {mexeu ? (
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {brl(proposto.custoPorMm)}
                    </td>
                  ) : null}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Simular não publica nada. Para valer, o parâmetro tem de ser publicado com
            vigência em Configurações → Regras de comissão.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
