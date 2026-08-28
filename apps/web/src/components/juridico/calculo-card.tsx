'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Calculator, Download, FileText, TriangleAlert } from 'lucide-react'
import {
  INDICE_LABELS,
  INDICES,
  memoriaParaCsv,
  type Indice,
  type LinhaMemoria,
  type ParametrosCalculo,
  type ResultadoCalculo,
  type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { gerarCalculoAction } from '@/actions/juridico'
import { juridicoKeys } from './queries'
import { brl, data } from './format'

/**
 * Cálculo da dívida (08 §6): gerar, ver a memória, exportar em CSV e PDF.
 *
 * ── OS PARÂMETROS APARECEM ANTES DE CONFIRMAR ──────────────────────────────
 * O total vai para os autos. Um botão que calculasse com "os parâmetros do sistema"
 * sem os mostrar produziria uma memória que o advogado assina sem saber qual índice
 * foi aplicado — e é a primeira coisa que a parte contrária pergunta.
 *
 * ── O HISTÓRICO NUNCA É SOBRESCRITO ────────────────────────────────────────
 * Cada geração é uma linha nova. A tela mostra a mais recente e lista as anteriores,
 * porque a memória de março é a que sustenta a petição de março.
 */

interface Props {
  numeroCnj: string
  parametrosPadrao: ParametrosCalculo
  calculos: Tables<'processo_calculos'>[]
  temOperacoes: boolean
}

function baixar(nome: string, conteudo: string, tipo: string): void {
  const blob = new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * O "PDF" é uma janela de impressão com a memória formatada.
 *
 * Uma biblioteca de PDF no bundle do navegador custaria centenas de kB para produzir
 * um documento que o advogado vai imprimir de qualquer jeito — e a caixa de impressão
 * do navegador já salva em PDF em todo sistema operacional. O que importa aqui é o
 * CONTEÚDO estar completo e conferível, não o gerador ser nosso.
 */
function imprimirMemoria(numeroCnj: string, r: ResultadoCalculo): void {
  const linhas = r.memoria
    .map(
      (l: LinhaMemoria) => `<tr>
        <td>${(l.descricao ?? l.operacao_id).replace(/</g, '&lt;')}</td>
        <td>${l.vencimento}</td>
        <td class="n">${l.principal.toFixed(2).replace('.', ',')}</td>
        <td class="n">${l.dias_em_atraso}</td>
        <td class="n">${l.fator_correcao.toFixed(6).replace('.', ',')}</td>
        <td class="n">${l.correcao.toFixed(2).replace('.', ',')}</td>
        <td class="n">${l.juros.toFixed(2).replace('.', ',')}</td>
        <td class="n">${l.multa.toFixed(2).replace('.', ',')}</td>
        <td class="n">${l.subtotal.toFixed(2).replace('.', ',')}</td>
      </tr>`,
    )
    .join('')

  const janela = window.open('', '_blank', 'width=1024,height=768')
  if (!janela) {
    toast.error('O navegador bloqueou a janela de impressão.')
    return
  }
  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Memória de cálculo — ${numeroCnj}</title>
    <style>
      body{font:12px/1.4 system-ui,sans-serif;padding:24px;color:#111}
      h1{font-size:16px;margin:0 0 4px} h2{font-size:13px;margin:16px 0 6px}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
      th{background:#f4f4f5;font-weight:600}
      td.n{text-align:right;font-variant-numeric:tabular-nums}
      .tot td{font-weight:600}
      .aviso{margin-top:12px;padding:8px;border:1px solid #f59e0b;background:#fffbeb}
    </style></head><body>
    <h1>Memória de cálculo</h1>
    <div>Processo ${numeroCnj} · atualizado até ${r.data_base}</div>
    <div>Índice: ${INDICE_LABELS[r.parametros.indice] ?? r.parametros.indice} ·
      juros ${r.parametros.juros_am}% a.m. (${r.parametros.juros_compostos ? 'compostos' : 'simples'}) ·
      multa ${r.parametros.multa_pct}% · honorários ${r.parametros.honorarios_pct}%</div>
    <h2>Por operação</h2>
    <table><thead><tr>
      <th>Operação</th><th>Vencimento</th><th>Principal</th><th>Dias</th>
      <th>Fator</th><th>Correção</th><th>Juros</th><th>Multa</th><th>Subtotal</th>
    </tr></thead><tbody>${linhas}</tbody></table>
    <h2>Consolidado</h2>
    <table><tbody>
      <tr><td>Principal</td><td class="n">${r.principal.toFixed(2)}</td></tr>
      <tr><td>Correção monetária</td><td class="n">${r.correcao.toFixed(2)}</td></tr>
      <tr><td>Juros de mora</td><td class="n">${r.juros.toFixed(2)}</td></tr>
      <tr><td>Multa</td><td class="n">${r.multa.toFixed(2)}</td></tr>
      <tr><td>Honorários (${r.parametros.honorarios_pct}%)</td><td class="n">${r.honorarios.toFixed(2)}</td></tr>
      <tr><td>Custas</td><td class="n">${r.custas.toFixed(2)}</td></tr>
      <tr class="tot"><td>TOTAL</td><td class="n">${r.total.toFixed(2)}</td></tr>
    </tbody></table>
    ${
      r.competencias_sem_indice.length > 0
        ? `<div class="aviso"><strong>Atenção:</strong> não havia índice cadastrado para
           ${r.competencias_sem_indice.join(', ')}. Esses meses NÃO foram corrigidos.</div>`
        : ''
    }
    </body></html>`)
  janela.document.close()
  janela.print()
}

export function CalculoCard({ numeroCnj, parametrosPadrao, calculos, temOperacoes }: Props) {
  const qc = useQueryClient()
  const [abertoParametros, setAbertoParametros] = React.useState(false)
  const [gerando, setGerando] = React.useState(false)
  const [ultimo, setUltimo] = React.useState<ResultadoCalculo | null>(null)
  const [dataBase, setDataBase] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [p, setP] = React.useState<ParametrosCalculo>(parametrosPadrao)

  const maisRecente = calculos[0] ?? null

  async function gerar() {
    setGerando(true)
    const r = await gerarCalculoAction({ numeroCnj, dataBase, parametros: p })
    setGerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setUltimo(r.data.resultado)
    void qc.invalidateQueries({ queryKey: juridicoKeys.calculos(numeroCnj) })
    void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })

    const buracos = r.data.resultado.competencias_sem_indice
    if (buracos.length > 0) {
      // Toast de AVISO e não de sucesso: o cálculo saiu, mas com meses sem corrigir.
      // Um "gerado com sucesso" verde aqui é como uma memória incompleta é protocolada.
      toast.warning(
        `Cálculo gerado, mas ${buracos.length} mês(es) ficaram SEM correção por falta de índice: ${buracos.join(', ')}.`,
      )
    } else {
      toast.success(`Cálculo gerado: ${brl(r.data.resultado.total)}.`)
    }
  }

  // A memória exibida vem do cálculo recém-gerado ou da linha mais recente do banco.
  const memoriaExibida: ResultadoCalculo | null =
    ultimo ??
    (maisRecente
      ? {
          data_base: maisRecente.data_base,
          principal: Number(maisRecente.principal ?? 0),
          correcao: Number(maisRecente.correcao ?? 0),
          juros: Number(maisRecente.juros ?? 0),
          multa: Number(maisRecente.multa ?? 0),
          honorarios: Number(maisRecente.honorarios ?? 0),
          custas: Number(maisRecente.custas ?? 0),
          total: Number(maisRecente.total),
          memoria: (maisRecente.memoria ?? []) as unknown as LinhaMemoria[],
          competencias_sem_indice: [
            ...new Set(
              ((maisRecente.memoria ?? []) as unknown as LinhaMemoria[]).flatMap(
                (l) => l.competencias_sem_indice ?? [],
              ),
            ),
          ].sort(),
          parametros: maisRecente.parametros as unknown as ParametrosCalculo,
        }
      : null)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Cálculo da dívida</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAbertoParametros((v) => !v)}>
            Parâmetros
          </Button>
          <Button size="sm" onClick={gerar} disabled={gerando || !temOperacoes}>
            <Calculator className="mr-1 h-4 w-4" />
            {gerando ? 'Calculando…' : 'Gerar cálculo'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!temOperacoes ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            Cadastre as <strong>operações cobradas</strong> antes de calcular. Sem elas o total sairia zero —
            e um zero aqui parece uma dívida quitada.
          </p>
        ) : null}

        {abertoParametros ? (
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="data-base">Corrigir até</Label>
              <Input
                id="data-base"
                type="date"
                value={dataBase}
                onChange={(e) => setDataBase(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="indice">Índice</Label>
              <Select value={p.indice} onValueChange={(v) => setP({ ...p, indice: v as Indice })}>
                <SelectTrigger id="indice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICES.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INDICE_LABELS[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="juros">Juros de mora (% a.m.)</Label>
              <Input
                id="juros"
                type="number"
                step="0.01"
                value={p.juros_am}
                onChange={(e) => setP({ ...p, juros_am: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="multa">Multa (%)</Label>
              <Input
                id="multa"
                type="number"
                step="0.01"
                value={p.multa_pct}
                onChange={(e) => setP({ ...p, multa_pct: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="honorarios">Honorários (%)</Label>
              <Input
                id="honorarios"
                type="number"
                step="0.01"
                value={p.honorarios_pct}
                onChange={(e) => setP({ ...p, honorarios_pct: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 pt-5">
              <Label htmlFor="compostos" className="text-sm font-normal">
                Juros compostos
              </Label>
              <Switch
                id="compostos"
                checked={p.juros_compostos}
                onCheckedChange={(v) => setP({ ...p, juros_compostos: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="custas" className="text-sm font-normal">
                Somar custas do período
              </Label>
              <Switch
                id="custas"
                checked={p.incluir_custas}
                onCheckedChange={(v) => setP({ ...p, incluir_custas: v })}
              />
            </div>
          </div>
        ) : null}

        {memoriaExibida ? (
          <>
            {memoriaExibida.competencias_sem_indice.length > 0 ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span>
                  Sem índice cadastrado para <strong>{memoriaExibida.competencias_sem_indice.join(', ')}</strong>.
                  Esses meses NÃO foram corrigidos — o total está subestimado. Complete a tabela em
                  Configurações e gere de novo antes de juntar aos autos.
                </span>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
              {[
                ['Principal', memoriaExibida.principal],
                ['Correção', memoriaExibida.correcao],
                ['Juros', memoriaExibida.juros],
                ['Multa', memoriaExibida.multa],
                ['Honorários', memoriaExibida.honorarios],
                ['Custas', memoriaExibida.custas],
              ].map(([rotulo, valor]) => (
                <div key={String(rotulo)} className="rounded-md border border-border p-2">
                  <div className="text-[11px] text-muted-foreground">{rotulo}</div>
                  <div className="text-sm tabular-nums">{brl(valor as number, 2)}</div>
                </div>
              ))}
              <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
                <div className="text-[11px] text-muted-foreground">Total</div>
                <div className="text-sm font-semibold tabular-nums">{brl(memoriaExibida.total, 2)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                Atualizado até {data(memoriaExibida.data_base)} ·{' '}
                {INDICE_LABELS[memoriaExibida.parametros.indice] ?? memoriaExibida.parametros.indice} · juros{' '}
                {memoriaExibida.parametros.juros_am}% a.m.{' '}
                {memoriaExibida.parametros.juros_compostos ? '(compostos)' : '(simples)'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  baixar(
                    `memoria-calculo-${numeroCnj}.csv`,
                    memoriaParaCsv(memoriaExibida),
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Download className="mr-1 h-3 w-3" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => imprimirMemoria(numeroCnj, memoriaExibida)}>
                <FileText className="mr-1 h-3 w-3" />
                PDF
              </Button>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Operação</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Principal</TableHead>
                    <TableHead className="text-right">Dias</TableHead>
                    <TableHead className="text-right">Fator</TableHead>
                    <TableHead className="text-right">Correção</TableHead>
                    <TableHead className="text-right">Juros</TableHead>
                    <TableHead className="text-right">Multa</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memoriaExibida.memoria.map((l) => (
                    <TableRow key={l.operacao_id}>
                      <TableCell className="text-xs">{l.descricao ?? l.operacao_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{data(l.vencimento)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(l.principal, 2)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{l.dias_em_atraso}</TableCell>
                      {/* Seis casas: é o número que se confere contra a tabela oficial. */}
                      <TableCell className="text-right text-xs tabular-nums">
                        {l.fator_correcao.toFixed(6).replace('.', ',')}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(l.correcao, 2)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(l.juros, 2)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(l.multa, 2)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{brl(l.subtotal, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {calculos.length > 1 ? (
              <div className="space-y-1 border-t border-border pt-3">
                <div className="text-xs font-medium">Cálculos anteriores</div>
                {calculos.slice(1).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {data(c.criado_em)} · base {data(c.data_base)}
                    </span>
                    <span className="tabular-nums">{brl(c.total, 2)}</span>
                  </div>
                ))}
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Nenhum cálculo é sobrescrito: cada um é a memória que sustentou uma petição numa data.
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum cálculo gerado ainda.{' '}
            <Badge variant="outline" className="ml-1">
              sem cálculo ≠ dívida zero
            </Badge>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
