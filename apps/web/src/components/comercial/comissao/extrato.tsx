'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download, Radio } from 'lucide-react'
import {
  FASE_CONTA_LABELS,
  GESTAO_OPERACAO_LABELS,
  ORIGEM_LANCAMENTO_V2_LABELS,
  PAPEL_COMISSAO_LABELS,
  STATUS_LANCAMENTO_V2_LABELS,
  explicarCalculo,
  type FaseConta,
  type GestaoOperacao,
  type OrigemLancamentoV2,
  type PapelComissao,
  type StatusLancamentoV2,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarExtrato, comissaoKeys, type LinhaExtrato } from '../queries-comissao'
import { brl, brlCurto, data as fmtData, mesDaCompetencia, numero } from './format'

/**
 * O extrato: a tela central do módulo.
 *
 * Linha a linha, cada centavo rastreável. A régua é uma só — **quem discorda de um valor
 * tem de conseguir refazer a conta sem pedir nada a ninguém**. Por isso cada linha abre
 * mostrando o cálculo por extenso E o snapshot dos parâmetros usados: reconstituir a
 * tabela de taxas de um dia de março a partir do histórico é o tipo de trabalho que quem
 * discorda simplesmente não faz — e aí paga-se o valor errado por concordância cansada.
 *
 * O CSV existe pelo mesmo motivo. Uma planilha é onde a pessoa confere de fato.
 */

const CORES: Record<StatusLancamentoV2, string> = {
  provisionado: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  fechado: 'bg-slate-100 text-slate-900 dark:bg-slate-500/20 dark:text-slate-200',
  aprovado: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
  pago: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  estornado: 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200',
}

const COLUNAS_CSV = [
  'data',
  'vendedor',
  'papel',
  'origem',
  'sacado',
  'cedente',
  'nf',
  'gestao_operacao',
  'fase',
  'valor_cedido',
  'dias',
  'vop',
  'taxa_brl_por_mm',
  'share_pct',
  'valor',
  'status',
] as const

/**
 * CSV com `;` e decimal com vírgula: é o que o Excel em pt-BR abre sem diálogo de
 * importação. Um arquivo tecnicamente correto que abre tudo numa coluna só não serve
 * para conferir nada.
 */
function baixarCsv(linhas: readonly LinhaExtrato[], competencia: string): void {
  const escapar = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const dec = (n: number | null | undefined): string =>
    n === null || n === undefined ? '' : String(n).replace('.', ',')

  const corpo = linhas.map((l) =>
    [
      new Date(l.evento_em).toLocaleDateString('pt-BR'),
      l.vendedores?.nome ?? '',
      PAPEL_COMISSAO_LABELS[l.papel] ?? l.papel,
      ORIGEM_LANCAMENTO_V2_LABELS[l.origem_tipo as OrigemLancamentoV2] ?? l.origem_tipo,
      l.empresas?.razao_social ?? '',
      l.cedente_nome ?? l.cedente_cnpj ?? '',
      l.nf_numero ?? '',
      l.gestao_operacao ?? '',
      l.fase ?? '',
      dec(l.valor_cedido),
      l.anticipation_days ?? '',
      dec(l.vop),
      dec(l.taxa_brl_por_mm),
      dec(l.share_pct),
      dec(l.valor),
      l.status,
    ]
      .map(escapar)
      .join(';'),
  )

  // BOM: sem ele o Excel lê o arquivo como latin-1 e "Construção" vira "ConstruÃ§Ã£o".
  const blob = new Blob([`﻿${COLUNAS_CSV.join(';')}\n${corpo.join('\n')}\n`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `comissoes-${competencia.slice(0, 7)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Detalhe({ l }: { l: LinhaExtrato }) {
  const snap = Object.entries(l.params_snapshot ?? {})
  return (
    <div className="space-y-2 rounded-md bg-muted/50 p-3 text-xs">
      <p className="font-medium">{explicarCalculo(l)}</p>
      {l.descricao ? <p className="text-muted-foreground">{l.descricao}</p> : null}
      <div>
        <p className="mb-1 text-muted-foreground">Parâmetros usados no fato gerador</p>
        <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {snap.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            snap.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v === null ? '—' : String(v)}</dd>
              </div>
            ))
          )}
        </dl>
      </div>
      <p className="text-muted-foreground">
        Origem: <span className="font-mono">{l.origem_id}</span>
      </p>
    </div>
  )
}

export function Extrato({
  competencia,
  vendedorId,
  aoVivo,
  mostrarVendedor,
}: {
  competencia: string
  vendedorId: string | null
  aoVivo: boolean
  mostrarVendedor: boolean
}) {
  const [aberta, setAberta] = React.useState<string | null>(null)
  const [papel, setPapel] = React.useState<PapelComissao | 'todos'>('todos')

  const { data, isPending } = useQuery({
    queryKey: comissaoKeys.extrato(competencia, vendedorId),
    queryFn: () => buscarExtrato(competencia, vendedorId),
  })

  const linhas = (data ?? []).filter((l) => papel === 'todos' || l.papel === papel)
  const total = linhas.reduce((s, l) => s + l.valor, 0)

  if (isPending) return <Skeleton className="h-96 w-full" />

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              Extrato — {mesDaCompetencia(competencia)}
              {aoVivo ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Radio className="h-3 w-3 animate-pulse text-emerald-600" aria-hidden /> ao vivo
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Clique em qualquer linha para ver o cálculo por extenso e os parâmetros que
              valiam no dia do fato gerador.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Filtrar por papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelComissao | 'todos')}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="todos">Todos os papéis</option>
              {(Object.keys(PAPEL_COMISSAO_LABELS) as PapelComissao[]).map((p) => (
                <option key={p} value={p}>{PAPEL_COMISSAO_LABELS[p]}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={linhas.length === 0}
              onClick={() => baixarCsv(linhas, competencia)}
            >
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {linhas.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum lançamento nesta competência. O extrato se monta sozinho: cada NF
            convertida entra aqui no instante da conversão.
          </p>
        ) : (
          <>
            {/*
              `overflow-x-auto` no wrapper: em tela estreita quem rola é a tabela, nunca a
              página. São dezesseis colunas de auditoria — esconder metade delas em telas
              menores faria a tela mentir sobre o que está sendo mostrado.
            */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[62rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-8 px-2 py-2" />
                    <th scope="col" className="px-3 py-2 font-normal">Data</th>
                    <th scope="col" className="px-3 py-2 font-normal">Origem</th>
                    {mostrarVendedor ? (
                      <th scope="col" className="px-3 py-2 font-normal">Vendedor</th>
                    ) : null}
                    <th scope="col" className="px-3 py-2 font-normal">Papel</th>
                    <th scope="col" className="px-3 py-2 font-normal">Classificação</th>
                    <th scope="col" className="px-3 py-2 font-normal">Fase</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Valor cedido</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Dias</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">VOP</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Taxa R$/MM</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Share</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Valor</th>
                    <th scope="col" className="px-3 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {linhas.map((l) => {
                    const abertaAgora = aberta === l.id
                    const colspan = mostrarVendedor ? 14 : 13
                    return (
                      <React.Fragment key={l.id}>
                        <tr
                          className="cursor-pointer align-middle hover:bg-muted/50"
                          onClick={() => setAberta(abertaAgora ? null : l.id)}
                        >
                          <td className="px-2 py-2">
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                                abertaAgora ? 'rotate-90' : ''
                              }`}
                              aria-hidden
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtData(l.evento_em)}</td>
                          <td className="px-3 py-2">
                            <span className="block">
                              {l.nf_numero ? `NF ${l.nf_numero}` : ORIGEM_LANCAMENTO_V2_LABELS[l.origem_tipo as OrigemLancamentoV2] ?? l.origem_tipo}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {l.papel === 'ORIGINADOR'
                                ? (l.cedente_nome ?? l.cedente_cnpj ?? '—')
                                : (l.empresas?.razao_social ?? '—')}
                            </span>
                          </td>
                          {mostrarVendedor ? (
                            <td className="px-3 py-2">{l.vendedores?.nome ?? '—'}</td>
                          ) : null}
                          <td className="whitespace-nowrap px-3 py-2">
                            <Badge variant="outline" className="text-[10px]">
                              {PAPEL_COMISSAO_LABELS[l.papel] ?? l.papel}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {l.gestao_operacao
                              ? GESTAO_OPERACAO_LABELS[l.gestao_operacao as GestaoOperacao] ?? l.gestao_operacao
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                            {l.fase ? FASE_CONTA_LABELS[l.fase as FaseConta] : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.valor_cedido === null ? '—' : brlCurto(l.valor_cedido)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.anticipation_days ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.vop === null ? '—' : numero(l.vop)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.taxa_brl_por_mm === null ? '—' : brl(l.taxa_brl_por_mm)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                            {l.share_pct >= 100 ? '—' : `${numero(l.share_pct, 1)}%`}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium tabular-nums ${
                              l.valor < 0 ? 'text-destructive' : ''
                            }`}
                          >
                            {brl(l.valor)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            <Badge className={`text-[10px] ${CORES[l.status] ?? ''}`}>
                              {STATUS_LANCAMENTO_V2_LABELS[l.status] ?? l.status}
                            </Badge>
                          </td>
                        </tr>
                        {abertaAgora ? (
                          <tr>
                            <td colSpan={colspan} className="px-3 pb-3">
                              <Detalhe l={l} />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-baseline justify-between gap-3 border-t px-4 py-3">
              <span className="text-xs text-muted-foreground">
                {numero(linhas.length)} linha(s)
              </span>
              <span className="text-sm font-semibold tabular-nums">{brl(total)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
