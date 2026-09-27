'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import {
  COBRANCA_ESTAGIOS_ENCERRADOS,
  INDICE_COBRANCA_LABELS,
  INDICES_COBRANCA,
  PERIODICIDADE_ACORDO_LABELS,
  PERIODICIDADES_ACORDO,
  SISTEMA_AMORTIZACAO_LABELS,
  SISTEMAS_AMORTIZACAO,
  TIPO_MODELO_COBRANCA_LABELS,
  atualizarDividaCobranca,
  hojeSaoPaulo,
  simularParcelamento,
  somarMeses,
  type Avalista,
  type DadosMinuta,
  type IndiceCobranca,
  type ParametrosAtualizacao,
  type PeriodicidadeAcordo,
  type SimulacaoParcelamento,
  type SistemaAmortizacao,
  type Tables,
  type TipoModeloCobranca,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  anexarAcordoAssinadoAction,
  atualizarCobrancaAction,
  atualizarDadosMinutaAction,
  cancelarAcordoAction,
  gerarMinutaAcordoAction,
  salvarCenarioAcordoAction,
} from '@/actions/cobranca'
import { cn } from '@/lib/utils'
import { ArquivoLink } from './cobranca-detalhe-comum'
import { brl, data, dataHora } from './format'
import {
  buscarAcordos,
  buscarConfigCobranca,
  buscarModelosAtivos,
  buscarTabelaIndices,
  buscarTitulosDaCobranca,
  cobrancaKeys,
  numeroDoTitulo,
  subirArquivoCobranca,
  tituloAtivo,
  type CardCobranca,
} from './queries'

/**
 * Acordo (§9): calculadora, simulador e minuta. Boleto e acompanhamento de cumprimento
 * ficam na produção — o que sai daqui é o número, o cronograma e o papel a assinar.
 *
 * A calculadora é o motor do Jurídico (`atualizarDividaCobranca`), e a tela mostra a
 * memória linha a linha porque é ela que o devedor contesta. O cenário salvo é refeito
 * no servidor com os parâmetros GRAVADOS da cobrança: por isso "salvar cenário" pede
 * que os parâmetros alterados sejam salvos antes.
 */

const TIPOS_CONFISSAO: TipoModeloCobranca[] = [
  'confissao_divida_simples',
  'confissao_divida_aval',
  'confissao_divida_af',
  'confissao_divida_garantia_real',
]

const numOuNull = (v: string): number | null => {
  const n = Number(v.replace(',', '.'))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

interface Cenario {
  entradaModo: 'valor' | 'pct'
  entrada: string
  parcelas: string
  primeira: string
  periodicidade: PeriodicidadeAcordo
  juros: string
  sistema: SistemaAmortizacao
}

function cenarioPadrao(parcelas: number): Cenario {
  return {
    entradaModo: 'pct',
    entrada: '10',
    parcelas: String(parcelas),
    primeira: somarMeses(hojeSaoPaulo(), 1),
    periodicidade: 'mensal',
    juros: '1',
    sistema: 'price',
  }
}

function paraEntrada(c: Cenario) {
  const e = numOuNull(c.entrada) ?? 0
  return {
    entrada: c.entradaModo === 'valor' ? e : 0,
    ...(c.entradaModo === 'pct' ? { entrada_pct: e } : {}),
    qtd_parcelas: Math.max(1, Math.round(numOuNull(c.parcelas) ?? 1)),
    primeira_parcela: c.primeira,
    periodicidade: c.periodicidade,
    juros_mes: numOuNull(c.juros) ?? 0,
    sistema: c.sistema,
  }
}

export function AbaAcordo({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const qc = useQueryClient()
  const config = useQuery({ queryKey: cobrancaKeys.config(), queryFn: buscarConfigCobranca })
  const titulos = useQuery({ queryKey: cobrancaKeys.titulos(id), queryFn: () => buscarTitulosDaCobranca(id) })
  const acordos = useQuery({ queryKey: cobrancaKeys.acordos(id), queryFn: () => buscarAcordos(id) })

  const padrao = config.data?.calculo
  const salvo = {
    juros: String(cobranca.juros_mora_mes ?? padrao?.juros_mora_mes ?? ''),
    multa: String(cobranca.multa_pct ?? padrao?.multa_pct ?? ''),
    honorarios: String(cobranca.honorarios_pct ?? padrao?.honorarios_pct ?? ''),
    indice: (cobranca.indice_correcao ?? padrao?.indice ?? 'igpm') as IndiceCobranca,
    proRata: cobranca.juros_pro_rata ?? padrao?.juros_pro_rata ?? true,
  }
  const [juros, setJuros] = React.useState(salvo.juros)
  const [multa, setMulta] = React.useState(salvo.multa)
  const [honorarios, setHonorarios] = React.useState(salvo.honorarios)
  const [indice, setIndice] = React.useState<IndiceCobranca>(salvo.indice)
  const [proRata, setProRata] = React.useState(salvo.proRata)
  const [dataBase, setDataBase] = React.useState(hojeSaoPaulo())
  const [salvandoParams, setSalvandoParams] = React.useState(false)

  // Quando a config chega (ou a cobrança é relida), o formulário acompanha o gravado.
  React.useEffect(() => {
    setJuros(salvo.juros)
    setMulta(salvo.multa)
    setHonorarios(salvo.honorarios)
    setIndice(salvo.indice)
    setProRata(salvo.proRata)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salvo.juros, salvo.multa, salvo.honorarios, salvo.indice, salvo.proRata])

  const tabela = useQuery({ queryKey: cobrancaKeys.indices(indice), queryFn: () => buscarTabelaIndices(indice) })

  const alterado =
    juros !== salvo.juros ||
    multa !== salvo.multa ||
    honorarios !== salvo.honorarios ||
    indice !== salvo.indice ||
    proRata !== salvo.proRata

  const parametros: ParametrosAtualizacao | null = padrao
    ? {
        juros_mora_mes: numOuNull(juros) ?? padrao.juros_mora_mes,
        multa_pct: numOuNull(multa) ?? padrao.multa_pct,
        honorarios_pct: numOuNull(honorarios) ?? padrao.honorarios_pct,
        indice,
        juros_pro_rata: proRata,
      }
    : null

  const ativos = (titulos.data ?? []).filter(tituloAtivo)
  const resultado = React.useMemo(() => {
    if (!parametros || !tabela.data || ativos.length === 0) return null
    return atualizarDividaCobranca(
      ativos.map((t) => ({
        id: t.id,
        valor_face: Number(t.valor_face_snapshot),
        vencimento: t.vencimento_snapshot,
        descricao: numeroDoTitulo(t),
      })),
      parametros,
      tabela.data,
      dataBase || hojeSaoPaulo(),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulos.data, tabela.data, juros, multa, honorarios, indice, proRata, dataBase, padrao])

  async function salvarParametros() {
    if (!parametros) return
    setSalvandoParams(true)
    const r = await atualizarCobrancaAction({
      id,
      juros_mora_mes: parametros.juros_mora_mes,
      multa_pct: parametros.multa_pct,
      honorarios_pct: parametros.honorarios_pct,
      indice_correcao: parametros.indice,
      juros_pro_rata: parametros.juros_pro_rata,
    })
    setSalvandoParams(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Parâmetros da cobrança salvos. Minutas já enviadas não mudam; a próxima rodada usa estes.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.cobranca(id) })
  }

  if (config.isPending || titulos.isPending) return <Skeleton className="h-64 w-full" />

  const encerrada = (COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(cobranca.estagio ?? '')
  const podeAcordar = !encerrada && cobranca.estagio !== 'rascunho'

  return (
    <div className="space-y-4">
      {/* ── §9.1 Calculadora ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dívida atualizada</CardTitle>
          <CardDescription>
            Principal → correção → juros de mora e multa sobre o corrigido → honorários sobre o subtotal. Os
            parâmetros valem para esta cobrança; o padrão das configurações aparece ao lado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <ParamNumero rotulo="Juros (% a.m.)" valor={juros} onChange={setJuros} padrao={padrao?.juros_mora_mes} disabled={encerrada} />
            <ParamNumero rotulo="Multa (%)" valor={multa} onChange={setMulta} padrao={padrao?.multa_pct} disabled={encerrada} />
            <ParamNumero rotulo="Honorários (%)" valor={honorarios} onChange={setHonorarios} padrao={padrao?.honorarios_pct} disabled={encerrada} />
            <div className="space-y-1">
              <Label>Índice</Label>
              <Select value={indice} onValueChange={(v) => setIndice(v as IndiceCobranca)} disabled={encerrada}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDICES_COBRANCA.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INDICE_COBRANCA_LABELS[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">padrão: {padrao ? INDICE_COBRANCA_LABELS[padrao.indice] : '—'}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="acordo-data-base">Data-base</Label>
              <Input id="acordo-data-base" type="date" value={dataBase} onChange={(e) => setDataBase(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">padrão: hoje</p>
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <Switch checked={proRata} onCheckedChange={setProRata} disabled={encerrada} />
              Pro rata die
            </label>
          </div>
          {alterado ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={salvandoParams} onClick={salvarParametros}>
                Salvar parâmetros da cobrança
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setJuros(salvo.juros)
                  setMulta(salvo.multa)
                  setHonorarios(salvo.honorarios)
                  setIndice(salvo.indice)
                  setProRata(salvo.proRata)
                }}
              >
                Descartar alterações
              </Button>
            </div>
          ) : null}

          {resultado ? (
            <>
              {resultado.competencias_sem_indice.length > 0 ? (
                <p className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Competências sem índice publicado (corrigidas por fator 1):{' '}
                  {resultado.competencias_sem_indice.join(', ')}. Atualize a tabela em Jurídico → Configurações.
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Fator</TableHead>
                      <TableHead className="text-right">Correção</TableHead>
                      <TableHead className="text-right">Juros</TableHead>
                      <TableHead className="text-right">Multa</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.memoria.map((l) => (
                      <TableRow key={l.operacao_id}>
                        <TableCell className="text-xs">{l.descricao ?? '—'}</TableCell>
                        <TableCell className="text-xs">{data(l.vencimento)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{l.dias_em_atraso}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{brl(l.principal)}</TableCell>
                        <TableCell className="text-right font-mono text-[11px]">{l.fator_correcao.toFixed(6)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{brl(l.correcao)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{brl(l.juros)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{brl(l.multa)}</TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">{brl(l.subtotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Total rotulo="Principal" valor={resultado.principal} />
                <Total rotulo="Correção" valor={resultado.correcao} />
                <Total rotulo="Juros" valor={resultado.juros} />
                <Total rotulo="Multa" valor={resultado.multa} />
                <Total rotulo="Honorários" valor={resultado.honorarios} />
                <Total rotulo="Total atualizado" valor={resultado.total} destaque />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {ativos.length === 0 ? 'Não há título devido nesta cobrança.' : 'Calculando…'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── §9.2 Simulador ── */}
      {resultado ? (
        <Simulador
          cobrancaId={id}
          total={resultado.total}
          dataBase={dataBase}
          podeSalvar={podeAcordar && !alterado}
          motivoNaoSalvar={
            !podeAcordar
              ? 'Acordo só com a cobrança em andamento (depois da notificação).'
              : alterado
                ? 'Salve os parâmetros da cobrança antes: o cenário é gravado com os parâmetros salvos.'
                : null
          }
        />
      ) : null}

      {/* ── §9.3 Acordos salvos e minutas ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Acordos</CardTitle>
          <CardDescription>
            O upload do documento assinado é o que firma o acordo: ele move a cobrança para “Acordo firmado” e
            descarta os outros cenários. Assinatura eletrônica fica fora desta versão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(acordos.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum cenário salvo.</p>
          ) : (
            (acordos.data ?? []).map((a) => <AcordoItem key={a.id} acordo={a} cobrancaId={id} />)
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Total({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={cn('rounded-md border p-2', destaque && 'border-primary/40 bg-primary/5')}>
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
      <div className={cn('tabular-nums', destaque && 'font-semibold')}>{brl(valor)}</div>
    </div>
  )
}

function ParamNumero({
  rotulo,
  valor,
  onChange,
  padrao,
  disabled,
}: {
  rotulo: string
  valor: string
  onChange: (v: string) => void
  padrao: number | undefined
  disabled?: boolean
}) {
  const idCampo = React.useId()
  const mudou = padrao !== undefined && numOuNull(valor) !== null && numOuNull(valor) !== padrao
  return (
    <div className="space-y-1">
      <Label htmlFor={idCampo}>{rotulo}</Label>
      <Input id={idCampo} inputMode="decimal" value={valor} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <p className={cn('text-[11px]', mudou ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
        padrão: {padrao?.toLocaleString('pt-BR') ?? '—'}
      </p>
    </div>
  )
}

// ─── Simulador ──────────────────────────────────────────────────────────────

function Simulador({
  cobrancaId,
  total,
  dataBase,
  podeSalvar,
  motivoNaoSalvar,
}: {
  cobrancaId: string
  total: number
  dataBase: string
  podeSalvar: boolean
  motivoNaoSalvar: string | null
}) {
  const qc = useQueryClient()
  const [cenarios, setCenarios] = React.useState<Cenario[]>([cenarioPadrao(6), cenarioPadrao(12)])
  const [aberto, setAberto] = React.useState<number | null>(null)
  const [salvando, setSalvando] = React.useState<number | null>(null)

  const simulacoes: (SimulacaoParcelamento | string)[] = cenarios.map((c) => {
    try {
      return simularParcelamento({ ...paraEntrada(c), valor: total })
    } catch (e) {
      return e instanceof Error ? e.message : 'Cenário inválido.'
    }
  })

  function mudar(i: number, campo: Partial<Cenario>) {
    setCenarios(cenarios.map((c, j) => (j === i ? { ...c, ...campo } : c)))
  }

  async function salvar(i: number) {
    setSalvando(i)
    const r = await salvarCenarioAcordoAction({ cobranca_id: cobrancaId, data_base: dataBase, cenario: paraEntrada(cenarios[i]!) })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Cenário salvo. Preencha a minuta abaixo para gerar a confissão de dívida.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.acordos(cobrancaId) })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-sm">Simulador de parcelamento</CardTitle>
            <CardDescription>
              Até três cenários sobre o mesmo valor à vista ({brl(total)}). O juro é ao mês e convertido para o
              período por capitalização composta.
            </CardDescription>
          </div>
          {cenarios.length < 3 ? (
            <Button size="sm" variant="outline" onClick={() => setCenarios([...cenarios, cenarioPadrao(24)])}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              Cenário
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-3">
          {cenarios.map((c, i) => {
            const s = simulacoes[i]
            return (
              <div key={i} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Cenário {i + 1}</span>
                  {cenarios.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={`Remover cenário ${i + 1}`}
                      onClick={() => setCenarios(cenarios.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Entrada</Label>
                    <div className="flex gap-1">
                      <Input inputMode="decimal" value={c.entrada} onChange={(e) => mudar(i, { entrada: e.target.value })} />
                      <Select value={c.entradaModo} onValueChange={(v) => mudar(i, { entradaModo: v as Cenario['entradaModo'] })}>
                        <SelectTrigger className="w-16">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pct">%</SelectItem>
                          <SelectItem value="valor">R$</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Parcelas</Label>
                    <Input inputMode="numeric" value={c.parcelas} onChange={(e) => mudar(i, { parcelas: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">1ª parcela</Label>
                    <Input type="date" value={c.primeira} onChange={(e) => mudar(i, { primeira: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Periodicidade</Label>
                    <Select value={c.periodicidade} onValueChange={(v) => mudar(i, { periodicidade: v as PeriodicidadeAcordo })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERIODICIDADES_ACORDO.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PERIODICIDADE_ACORDO_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Juros (% a.m.)</Label>
                    <Input inputMode="decimal" value={c.juros} onChange={(e) => mudar(i, { juros: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sistema</Label>
                    <Select value={c.sistema} onValueChange={(v) => mudar(i, { sistema: v as SistemaAmortizacao })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SISTEMAS_AMORTIZACAO.map((s2) => (
                          <SelectItem key={s2} value={s2}>
                            {SISTEMA_AMORTIZACAO_LABELS[s2]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {typeof s === 'string' ? (
                  <p className="text-xs text-destructive">{s}</p>
                ) : s ? (
                  <div className="space-y-1 border-t pt-2 text-xs">
                    <Linha rotulo="Entrada" valor={brl(s.entrada)} />
                    <Linha rotulo="Financiado" valor={brl(s.valor_financiado)} />
                    <Linha
                      rotulo="Parcela"
                      valor={`${s.qtd_parcelas}× ${brl(s.parcelas.find((p) => p.numero === 1)?.valor)}${s.sistema === 'sac' ? ' (1ª)' : ''}`}
                    />
                    <Linha rotulo="Juros do parcelamento" valor={brl(s.juros_total)} />
                    <Linha rotulo="Total projetado" valor={brl(s.valor_total_projetado)} forte />
                    <Linha rotulo="Custo vs. à vista" valor={brl(s.custo_parcelamento)} />
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAberto(aberto === i ? null : i)}>
                        {aberto === i ? 'Ocultar parcelas' : 'Ver parcelas'}
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!podeSalvar || salvando !== null}
                        title={motivoNaoSalvar ?? undefined}
                        onClick={() => void salvar(i)}
                      >
                        {salvando === i ? 'Salvando…' : 'Salvar este cenário'}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        {motivoNaoSalvar ? <p className="text-xs text-muted-foreground">{motivoNaoSalvar}</p> : null}

        {aberto !== null && typeof simulacoes[aberto] === 'object' ? (
          <TabelaParcelas s={simulacoes[aberto] as SimulacaoParcelamento} titulo={`Cenário ${aberto + 1}`} />
        ) : null}
      </CardContent>
    </Card>
  )
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn('tabular-nums', forte && 'font-semibold')}>{valor}</span>
    </div>
  )
}

interface ParcelaGravada {
  numero: number
  vencimento: string | null
  amortizacao: number
  juros: number
  valor: number
  saldo_devedor: number
}

function TabelaParcelas({ s, titulo }: { s: { parcelas: ParcelaGravada[]; qtd_parcelas: number }; titulo: string }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="border-b px-3 py-2 text-xs font-semibold">{titulo}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parcela</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead className="text-right">Amortização</TableHead>
            <TableHead className="text-right">Juros</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.parcelas.map((p) => (
            <TableRow key={p.numero}>
              <TableCell className="text-xs">{p.numero === 0 ? 'Entrada' : `${p.numero}/${s.qtd_parcelas}`}</TableCell>
              <TableCell className="text-xs">{p.vencimento ? data(p.vencimento) : 'Na assinatura'}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{brl(p.amortizacao)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{brl(p.juros)}</TableCell>
              <TableCell className="text-right text-xs font-medium tabular-nums">{brl(p.valor)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{brl(p.saldo_devedor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ─── Um acordo salvo e a minuta ─────────────────────────────────────────────

const STATUS_ACORDO: Record<string, { rotulo: string; tom: 'neutral' | 'info' | 'success' | 'critical' }> = {
  simulado: { rotulo: 'Cenário salvo', tom: 'neutral' },
  minuta_gerada: { rotulo: 'Minuta gerada', tom: 'info' },
  assinado: { rotulo: 'Assinado', tom: 'success' },
  cancelado: { rotulo: 'Descartado', tom: 'critical' },
}

function AcordoItem({ acordo, cobrancaId }: { acordo: Tables<'acordos'>; cobrancaId: string }) {
  const qc = useQueryClient()
  const [verParcelas, setVerParcelas] = React.useState(false)
  const st = STATUS_ACORDO[acordo.status] ?? { rotulo: acordo.status, tom: 'neutral' as const }
  const editavel = acordo.status === 'simulado' || acordo.status === 'minuta_gerada'
  const parcelas = (Array.isArray(acordo.parcelas) ? acordo.parcelas : []) as unknown as ParcelaGravada[]

  return (
    <div className={cn('space-y-3 rounded-md border p-3', acordo.status === 'cancelado' && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={st.tom}>{st.rotulo}</Badge>
          <span className="tabular-nums">
            {brl(acordo.valor_atualizado)} → {acordo.qtd_parcelas}× {SISTEMA_AMORTIZACAO_LABELS[acordo.sistema as SistemaAmortizacao] ?? acordo.sistema}
            {' '}({PERIODICIDADE_ACORDO_LABELS[acordo.periodicidade as PeriodicidadeAcordo] ?? acordo.periodicidade}), total{' '}
            <strong>{brl(acordo.valor_total_projetado)}</strong>
          </span>
          <span className="text-xs text-muted-foreground">
            entrada {brl(acordo.entrada)} · juros {Number(acordo.juros_parcelamento_mes).toLocaleString('pt-BR')}% a.m. · salvo{' '}
            {dataHora(acordo.criado_em)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArquivoLink caminho={acordo.minuta_path}>Minuta</ArquivoLink>
          <ArquivoLink caminho={acordo.documento_assinado_path}>Documento assinado</ArquivoLink>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setVerParcelas(!verParcelas)}>
            {verParcelas ? 'Ocultar parcelas' : 'Parcelas'}
          </Button>
          {editavel ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive"
              onClick={async () => {
                const r = await cancelarAcordoAction(acordo.id)
                if (!r.ok) {
                  toast.error(r.message)
                  return
                }
                toast.success('Cenário descartado.')
                void qc.invalidateQueries({ queryKey: cobrancaKeys.acordos(cobrancaId) })
              }}
            >
              Descartar
            </Button>
          ) : null}
        </div>
      </div>
      {verParcelas ? <TabelaParcelas s={{ parcelas, qtd_parcelas: acordo.qtd_parcelas }} titulo="Cronograma salvo" /> : null}
      {editavel ? <MinutaEditor acordo={acordo} cobrancaId={cobrancaId} /> : null}
    </div>
  )
}

const avalistaVazio = (): Avalista => ({ nome: '', cpf: '', estado_civil: '', endereco: '' })

function MinutaEditor({ acordo, cobrancaId }: { acordo: Tables<'acordos'>; cobrancaId: string }) {
  const qc = useQueryClient()
  const modelos = useQuery({ queryKey: cobrancaKeys.modelos(), queryFn: buscarModelosAtivos })
  const dadosIniciais = (acordo.dados_minuta ?? {}) as DadosMinuta
  const tipoInicial =
    (modelos.data?.find((m) => m.id === acordo.modelo_minuta_id)?.tipo as TipoModeloCobranca | undefined) ??
    'confissao_divida_simples'

  const [tipo, setTipo] = React.useState<TipoModeloCobranca>(tipoInicial)
  const [avalistas, setAvalistas] = React.useState<Avalista[]>(dadosIniciais.avalistas ?? [])
  const [bem, setBem] = React.useState(dadosIniciais.bem_garantia ?? '')
  const [foro, setForo] = React.useState(dadosIniciais.foro ?? '')
  const [testemunhas, setTestemunhas] = React.useState<{ nome: string; cpf: string }[]>(
    dadosIniciais.testemunhas ?? [
      { nome: '', cpf: '' },
      { nome: '', cpf: '' },
    ],
  )
  const [ocupado, setOcupado] = React.useState<'salvar' | 'gerar' | 'assinado' | null>(null)
  const [erroMinuta, setErroMinuta] = React.useState<string | null>(null)
  const arquivoRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => setTipo(tipoInicial), [tipoInicial])

  const modeloId = modelos.data?.find((m) => m.tipo === tipo)?.id
  const comAval = tipo === 'confissao_divida_aval'
  const comBem = tipo === 'confissao_divida_af' || tipo === 'confissao_divida_garantia_real'

  function dados(): DadosMinuta {
    const soDigitos = (s: string) => s.replace(/\D/g, '')
    const d: DadosMinuta = {}
    if (comAval) d.avalistas = avalistas.map((a) => ({ ...a, cpf: soDigitos(a.cpf), conjuge: a.conjuge || undefined }))
    if (comBem && bem.trim()) d.bem_garantia = bem.trim()
    if (foro.trim()) d.foro = foro.trim()
    const ts = testemunhas.filter((t) => t.nome.trim()).map((t) => ({ nome: t.nome.trim(), cpf: soDigitos(t.cpf) }))
    if (ts.length) d.testemunhas = ts
    return d
  }

  async function salvar(): Promise<boolean> {
    const r = await atualizarDadosMinutaAction({
      acordo_id: acordo.id,
      dados_minuta: dados(),
      ...(modeloId ? { modelo_minuta_id: modeloId } : {}),
    })
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    void qc.invalidateQueries({ queryKey: cobrancaKeys.acordos(cobrancaId) })
    return true
  }

  async function gerar() {
    setOcupado('gerar')
    setErroMinuta(null)
    // Os dados vão antes: gravar os blocos descarta a minuta anterior, e gerar sobre
    // dados velhos imprimiria o avalista que alguém acabou de corrigir.
    if (!(await salvar())) {
      setOcupado(null)
      return
    }
    const r = await gerarMinutaAcordoAction(cobrancaId, acordo.id)
    setOcupado(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.data.erro) {
      setErroMinuta(r.data.erro)
      toast.warning('A minuta não saiu. O motivo está abaixo.')
    } else toast.success('Minuta gerada.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.acordos(cobrancaId) })
  }

  async function anexarAssinado(arquivo: File) {
    setOcupado('assinado')
    try {
      const caminho = await subirArquivoCobranca(`${cobrancaId}/acordos`, arquivo, `${acordo.id}-assinado`)
      const r = await anexarAcordoAssinadoAction({ acordo_id: acordo.id, documento_assinado_path: caminho })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Acordo firmado. A cobrança foi para “Acordo firmado” e os títulos para “Em acordo”.')
      void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao anexar o documento.')
    } finally {
      setOcupado(null)
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tipo de confissão</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoModeloCobranca)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_CONFISSAO.map((t) => (
                <SelectItem key={t} value={t} disabled={!modelos.data?.some((m) => m.tipo === t)}>
                  {TIPO_MODELO_COBRANCA_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`foro-${acordo.id}`}>Foro eleito</Label>
          <Input id={`foro-${acordo.id}`} placeholder="Comarca de São Paulo/SP" value={foro} onChange={(e) => setForo(e.target.value)} />
        </div>
      </div>

      {comAval ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Avalistas (pessoa física)</Label>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAvalistas([...avalistas, avalistaVazio()])}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Avalista
            </Button>
          </div>
          {avalistas.length === 0 ? (
            <p className="text-xs text-muted-foreground">A confissão com aval precisa de ao menos um avalista.</p>
          ) : null}
          {avalistas.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-6">
              <Input className="sm:col-span-2" placeholder="Nome" value={a.nome} onChange={(e) => setAvalistas(avalistas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
              <Input placeholder="CPF" value={a.cpf} onChange={(e) => setAvalistas(avalistas.map((x, j) => (j === i ? { ...x, cpf: e.target.value } : x)))} />
              <Input placeholder="Estado civil" value={a.estado_civil} onChange={(e) => setAvalistas(avalistas.map((x, j) => (j === i ? { ...x, estado_civil: e.target.value } : x)))} />
              <Input placeholder="Cônjuge (se casado)" value={a.conjuge ?? ''} onChange={(e) => setAvalistas(avalistas.map((x, j) => (j === i ? { ...x, conjuge: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" aria-label="Remover avalista" onClick={() => setAvalistas(avalistas.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
              <Input className="sm:col-span-6" placeholder="Endereço completo" value={a.endereco} onChange={(e) => setAvalistas(avalistas.map((x, j) => (j === i ? { ...x, endereco: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      ) : null}

      {comBem ? (
        <div className="space-y-1">
          <Label htmlFor={`bem-${acordo.id}`}>
            {tipo === 'confissao_divida_af' ? 'Bem alienado fiduciariamente' : 'Garantia real (hipoteca/penhor, matrícula)'}
          </Label>
          <Textarea id={`bem-${acordo.id}`} rows={3} value={bem} onChange={(e) => setBem(e.target.value)} />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>Testemunhas</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {testemunhas.map((t, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder={`Testemunha ${i + 1}`} value={t.nome} onChange={(e) => setTestemunhas(testemunhas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
              <Input className="w-40" placeholder="CPF" value={t.cpf} onChange={(e) => setTestemunhas(testemunhas.map((x, j) => (j === i ? { ...x, cpf: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      </div>

      {erroMinuta ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {erroMinuta}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado !== null}
          onClick={async () => {
            setOcupado('salvar')
            if (await salvar()) toast.success('Dados da minuta salvos.')
            setOcupado(null)
          }}
        >
          Salvar dados
        </Button>
        <Button size="sm" disabled={ocupado !== null || !modeloId} onClick={gerar}>
          {ocupado === 'gerar' ? 'Gerando…' : acordo.minuta_path ? 'Regerar minuta (PDF)' : 'Gerar minuta (PDF)'}
        </Button>
        <span className="flex-1" />
        <input
          ref={arquivoRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void anexarAssinado(f)
          }}
        />
        <Button size="sm" variant="secondary" disabled={ocupado !== null} onClick={() => arquivoRef.current?.click()}>
          {ocupado === 'assinado' ? 'Anexando…' : 'Anexar documento assinado'}
        </Button>
      </div>
    </div>
  )
}
