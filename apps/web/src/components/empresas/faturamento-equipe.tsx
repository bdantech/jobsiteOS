'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Banknote,
  Globe,
  History,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import {
  ORIGEM_METRICA_LABELS,
  anoReferenciaEstimativa,
  anoReferenciaMetrica,
  crescimento12m,
  ehEstimativa,
  rankOrigem,
  type OrigemMetrica,
  type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  atualizarFuncionariosAction,
  enriquecerEmpresaAction,
  resolverDominioEmpresaAction,
} from '@/actions/radar'
import { declararMetricaAction } from '@/actions/empresas'
import { cn } from '@/lib/utils'
import { empresasKeys, buscarMetricas } from './queries'
import { usePollInvalidar } from './use-poll-invalidar'

/**
 * Faturamento & Equipe na Company 360 (04c §8).
 *
 * O card mostra o valor VIGENTE de cada métrica com origem, confiança e data — e a
 * origem é tão importante quanto o número. "R$ 40M declarado pelo cliente" e "R$ 40M
 * estimado por um modelo calibrado em cinco empresas" levam a conversas comerciais
 * diferentes, e sem o rótulo as duas viram a mesma frase na boca do vendedor.
 *
 * A sparkline existe pela mesma razão: o nível interessa menos que a direção. Uma
 * empresa que saiu de 40 para 120 pessoas em um ano é uma conversa; a mesma empresa
 * parada em 120 há três anos é outra.
 */

type Metrica = Tables<'empresa_metricas'>

const CONFIANCA_BADGE: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  media: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  baixa: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function data(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function rotuloOrigem(o: string | null): string {
  if (!o) return '—'
  return ORIGEM_METRICA_LABELS[o as OrigemMetrica] ?? o
}

/**
 * Sparkline em SVG puro, sem biblioteca: são até 20 pontos numa caixa de 40px. Uma
 * dependência de gráfico aqui custaria mais bytes que o resto do card inteiro.
 */
function Sparkline({ pontos }: { pontos: number[] }) {
  if (pontos.length < 2) return null
  const max = Math.max(...pontos)
  const min = Math.min(...pontos)
  const amplitude = max - min || 1
  const largura = 88
  const altura = 28
  const passo = largura / (pontos.length - 1)
  const d = pontos
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * passo).toFixed(1)} ${(altura - ((p - min) / amplitude) * altura).toFixed(1)}`)
    .join(' ')
  const subiu = pontos[pontos.length - 1]! >= pontos[0]!

  return (
    <svg width={largura} height={altura} className="shrink-0" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth={1.5}
        className={subiu ? 'stroke-emerald-500' : 'stroke-destructive'}
      />
    </svg>
  )
}

/**
 * "ref. 2022 · lido em 04/08/2026". As duas datas, porque elas discordam com
 * frequência — o cliente declara hoje o faturamento de três anos atrás — e mostrar
 * só a segunda faz o número parecer atual.
 */
function AnoEData({ ano, em }: { ano: number | null; em: string | null }) {
  return (
    <span className="text-[11px] text-muted-foreground">
      {ano === null ? null : <span className="font-medium tabular-nums">ref. {ano} · </span>}
      lido em {data(em)}
    </span>
  )
}

function Variacao({ valor }: { valor: number | null }) {
  if (valor === null) return null
  const pct = (valor * 100).toFixed(0)
  const subiu = valor >= 0
  const Icone = subiu ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        subiu ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive',
      )}
      title="Variação em 12 meses"
    >
      <Icone className="h-3 w-3" aria-hidden />
      {subiu ? '+' : ''}
      {pct}%
    </span>
  )
}

/**
 * A leitura que responde por um ano: melhor origem primeiro, e entre iguais a mais
 * recente. É a mesma ordem que decide o valor vigente na ficha — só aplicada ano a
 * ano, em vez de uma vez para a empresa inteira.
 */
function melhorPorAno(pontos: Metrica[]): { ano: number; leitura: Metrica }[] {
  const porAno = new Map<number, Metrica>()
  for (const p of pontos) {
    const ano = anoReferenciaMetrica(p)
    if (ano === null) continue
    const atual = porAno.get(ano)
    if (
      !atual ||
      rankOrigem(p.origem) < rankOrigem(atual.origem) ||
      (rankOrigem(p.origem) === rankOrigem(atual.origem) &&
        Date.parse(p.capturado_em) > Date.parse(atual.capturado_em))
    ) {
      porAno.set(ano, p)
    }
  }
  return [...porAno.entries()]
    .map(([ano, leitura]) => ({ ano, leitura }))
    .sort((a, b) => a.ano - b.ano)
}

/**
 * Barras por ANO de referência, não por data de captura.
 *
 * A distinção não é cosmética: o cliente declara em 2026 o faturamento de 2022, e o
 * ranking publica em 2025 os números de 2023 e 2024. Ordenar pela captura desenharia
 * a curva da nossa coleta de dados, que não é a curva de nada que aconteceu na empresa.
 *
 * Estimativa aparece esmaecida e tracejada. O ano em que ela convive com um valor
 * informado é raro por construção (o valor informado apaga a estimativa daquele ano),
 * mas anos vizinhos misturam os dois — e uma barra estimada com a mesma cara de uma
 * medida é a forma mais silenciosa de um palpite virar fato.
 */
function GraficoPorAno({
  pontos,
  formatar,
}: {
  pontos: Metrica[]
  formatar: (v: number) => string
}) {
  const anos = melhorPorAno(pontos)
  if (anos.length === 0) return null

  const max = Math.max(...anos.map((a) => Number(a.leitura.valor)), 1)

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
        {anos.map(({ ano, leitura }) => {
          const valor = Number(leitura.valor)
          const estimado = ehEstimativa(leitura.origem)
          return (
            <div key={ano} className="flex w-16 shrink-0 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatar(valor)}
              </span>
              <div className="flex h-24 w-full items-end">
                <div
                  className={cn(
                    'w-full rounded-t',
                    estimado
                      ? 'border border-dashed border-primary/60 bg-primary/20'
                      : 'bg-primary',
                  )}
                  style={{ height: `${Math.max(3, (valor / max) * 100)}%` }}
                  title={`${ano}: ${formatar(valor)} — ${rotuloOrigem(leitura.origem)}`}
                />
              </div>
              <span className="text-xs font-medium tabular-nums">{ano}</span>
            </div>
          )
        })}
      </div>
      <p className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-primary" aria-hidden />
          informado
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm border border-dashed border-primary/60 bg-primary/20"
            aria-hidden
          />
          estimado
        </span>
      </p>
    </div>
  )
}

function HistoricoDialog({
  aberto,
  onOpenChange,
  titulo,
  pontos,
  formatar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  titulo: string
  pontos: Metrica[]
  formatar: (v: number) => string
}) {
  // Do ano mais recente para o mais antigo; dentro do ano, a leitura mais nova primeiro.
  const ordenados = React.useMemo(
    () =>
      [...pontos].sort((a, b) => {
        const anoA = anoReferenciaMetrica(a) ?? 0
        const anoB = anoReferenciaMetrica(b) ?? 0
        if (anoA !== anoB) return anoB - anoA
        return Date.parse(b.capturado_em) - Date.parse(a.capturado_em)
      }),
    [pontos],
  )

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Cada linha é uma leitura, com o <strong>ano a que se refere</strong> e a origem de
            onde veio — e os dois são diferentes da data em que a leitura entrou aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 space-y-4 overflow-y-auto">
          {pontos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma leitura ainda.</p>
          ) : (
            <>
              <GraficoPorAno pontos={pontos} formatar={formatar} />
              <ul className="divide-y border-t">
                {ordenados.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="flex items-baseline gap-2">
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
                        {anoReferenciaMetrica(p) ?? '—'}
                      </Badge>
                      <span className="font-medium tabular-nums">{formatar(Number(p.valor))}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {rotuloOrigem(p.origem)}
                      </Badge>
                      <span title="Quando esta leitura entrou na base">
                        lido em {data(p.capturado_em)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeclararDialog({
  aberto,
  onOpenChange,
  empresaId,
  metrica,
  onSalvo,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  empresaId: string
  metrica: 'faturamento_anual' | 'funcionarios'
  onSalvo: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const ehFaturamento = metrica === 'faturamento_anual'

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    setErro(null)
    const r = await declararMetricaAction({
      empresa_id: empresaId,
      metrica,
      valor: String(fd.get('valor') ?? ''),
      ano: String(fd.get('ano') ?? ''),
    })
    setSalvando(false)
    if (!r.ok) {
      setErro(r.message)
      return
    }
    toast.success('Declaração registrada. Ela vence qualquer estimativa.')
    onOpenChange(false)
    onSalvo()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>
              {ehFaturamento ? 'Declarar faturamento anual' : 'Declarar funcionários'}
            </DialogTitle>
            <DialogDescription>
              O que o cliente informou. Fica no topo da hierarquia de origens: nenhuma
              estimativa sobrescreve, a estimativa que existia para o ano declarado é
              apagada, e é isto que calibra o modelo para todo o resto da base.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="valor">{ehFaturamento ? 'Faturamento anual (R$)' : 'Funcionários'}</Label>
              <Input id="valor" name="valor" type="number" min={0} step={ehFaturamento ? '0.01' : '1'} required />
            </div>
            {/*
              O ano vale para as duas métricas e vem PREENCHIDO com o último ano
              fechado: é o ano que o estimador tenta adivinhar, então declarar sem ano
              deixava a declaração e o chute sobre o mesmo período convivendo na ficha
              sem como distinguir. Preenchido, a declaração apaga o chute daquele ano.
            */}
            <div className="space-y-1.5">
              <Label htmlFor="ano">Ano de referência</Label>
              <Input
                id="ano"
                name="ano"
                type="number"
                min={2000}
                max={2100}
                required
                defaultValue={String(anoReferenciaEstimativa())}
              />
            </div>
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Declarar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface FaturamentoEquipeProps {
  empresaId: string
  cnpj: string
  faturamento: number | null
  faturamentoOrigem: string | null
  faturamentoConfianca: string | null
  faturamentoEm: string | null
  funcionarios: number | null
  funcionariosOrigem: string | null
  funcionariosEm: string | null
  /**
   * Pré-requisito de "Atualizar funcionários": o Apollo é consultado POR DOMÍNIO. Sem
   * ele o job devolve `sem_dominio` e a tela mostraria "disparado" para algo que nunca
   * teve chance de acontecer.
   */
  dominio: string | null
  /** Só clientes ganham os campos de declaração (§5). */
  eCliente: boolean
}

export function FaturamentoEquipe(props: FaturamentoEquipeProps) {
  const qc = useQueryClient()
  const [atualizando, setAtualizando] = React.useState<string | null>(null)
  const [historico, setHistorico] = React.useState<'faturamento_anual' | 'funcionarios' | null>(null)
  const [declarando, setDeclarando] = React.useState<'faturamento_anual' | 'funcionarios' | null>(null)

  const { data: serie = [], isPending } = useQuery({
    queryKey: empresasKeys.metricas(props.cnpj),
    queryFn: () => buscarMetricas(props.cnpj),
  })

  const chaves = React.useMemo(
    () => [
      empresasKeys.metricas(props.cnpj),
      empresasKeys.detalhe(props.empresaId),
      empresasKeys.eventos(props.empresaId),
    ],
    [props.cnpj, props.empresaId],
  )
  const { iniciar: acompanharJob } = usePollInvalidar(chaves)

  function recarregar() {
    for (const chave of chaves) void qc.invalidateQueries({ queryKey: chave })
  }

  /**
   * O ano do número que está NA FICHA — não o ano em que ele foi lido.
   *
   * Sem isto o cartão mostrava "R$ 1,17 bi · Declarado · 04/08/2026" para um
   * faturamento de 2022, e a data ao lado do valor era lida como o ano do valor.
   * Procura entre as leituras da origem vigente e fica com a mais recente delas.
   */
  const anoVigente = React.useCallback(
    (pontos: Metrica[], origem: string | null) => {
      if (!origem) return null
      const anos = pontos
        .filter((p) => p.origem === origem)
        .map(anoReferenciaMetrica)
        .filter((a): a is number => a !== null)
      return anos.length > 0 ? Math.max(...anos) : null
    },
    [],
  )

  const porMetrica = React.useMemo(() => {
    const f = serie.filter((m) => m.metrica === 'faturamento_anual')
    const h = serie.filter((m) => m.metrica === 'funcionarios')
    return { faturamento_anual: f, funcionarios: h }
  }, [serie])

  // A sparkline usa a série INTEIRA, inclusive leituras que perderam na hierarquia:
  // é a trajetória da medida, não do cache. Filtrar por origem daria uma linha com
  // buracos exatamente nos meses em que a fonte mudou.
  const crescimentoEquipe = React.useMemo(
    () =>
      crescimento12m(
        porMetrica.funcionarios.map((m) => ({ valor: Number(m.valor), capturado_em: m.capturado_em })),
      ),
    [porMetrica.funcionarios],
  )

  async function disparar(
    rotulo: string,
    acao: () => Promise<{ ok: boolean; message?: string; data?: { enfileirado: boolean; aviso?: string } }>,
    sucesso: string,
  ) {
    setAtualizando(rotulo)
    const r = await acao()
    setAtualizando(null)
    if (!r.ok) {
      toast.error(r.message ?? 'Falhou.')
      return
    }
    if (r.data && !r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'Não foi possível disparar a consulta.')
      return
    }
    // Assíncrono: o worker devolve 202 e trabalha em segundo plano. Por isso não
    // basta invalidar uma vez aqui — o dado ainda não existe no clique. O poll
    // recarrega enquanto o resultado não chega, e é o que tira o "recarregue a
    // página" do caminho de quem só queria ver o número atualizado.
    toast.success(sucesso)
    acompanharJob()
  }

  const pontosEquipe = [...porMetrica.funcionarios]
    .sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em))
    .slice(-20)
    .map((m) => Number(m.valor))

  const pontosFat = [...porMetrica.faturamento_anual]
    .sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em))
    .slice(-20)
    .map((m) => Number(m.valor))

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Faturamento &amp; Equipe</CardTitle>
            <CardDescription>
              A <strong>origem</strong> conta tanto quanto o número: declarado pelo cliente é
              fato, o resto é estimativa. Fontes como o Apollo <strong>subcontam</strong> mão de
              obra de canteiro — servem para comparar empresas entre si, não como quadro real.
            </CardDescription>
          </div>
          {/*
           * ─── UM BOTÃO QUE SABE A ORDEM, E OS AVULSOS AO LADO ──────────────────
           * Os botões individuais estavam numa ordem que é DEPENDÊNCIA, não preferência:
           * o Apollo é consultado por domínio, e o estimador de faturamento tem os
           * funcionários como sinal principal. A tela cobrava da pessoa um conhecimento
           * que é do código — e quem clicasse fora de ordem pagava uma consulta para
           * receber `sem_dominio`.
           *
           * "Enriquecer tudo" roda a cadeia inteira na ordem certa e reaproveita o que já
           * foi obtido há menos de 30 dias. Os avulsos ficam: quem quer só o domínio não
           * deve ter de pagar o resto.
           */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                void disparar(
                  'tudo',
                  () => enriquecerEmpresaAction(props.empresaId),
                  'Enriquecendo: domínio → funcionários → faturamento → score. O resultado aparece aqui em instantes.',
                )
              }
              disabled={atualizando !== null}
              title="Roda a cadeia inteira na ordem em que uma etapa depende da outra. Dado obtido há menos de 30 dias é reaproveitado, não reconsultado."
            >
              <Sparkles
                className={cn('mr-1 h-3.5 w-3.5', atualizando === 'tudo' && 'animate-spin')}
                aria-hidden
              />
              {atualizando === 'tudo' ? 'Disparando…' : 'Enriquecer tudo'}
            </Button>
            {!props.dominio && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void disparar(
                    'dominio',
                    () => resolverDominioEmpresaAction(props.empresaId),
                    'Procurando o domínio — o resultado aparece aqui em instantes.',
                  )
                }
                disabled={atualizando !== null}
                title="Roda a cascata: e-mail da Receita → e-mails dos contatos → heurística validada por DNS/MX → busca com Claude (R$ 0,10)."
              >
                <Globe
                  className={cn('mr-1 h-3.5 w-3.5', atualizando === 'dominio' && 'animate-spin')}
                  aria-hidden
                />
                {atualizando === 'dominio' ? 'Disparando…' : 'Resolver domínio'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void disparar(
                  'funcionarios',
                  () => atualizarFuncionariosAction(props.empresaId),
                  'Consultando o Apollo — o resultado aparece aqui em instantes.',
                )
              }
              disabled={atualizando !== null || !props.dominio}
              title={
                props.dominio
                  ? `Consulta o headcount no Apollo por ${props.dominio}. Não consome crédito de revelação.`
                  : 'Sem domínio salvo não há o que consultar no Apollo — resolva o domínio primeiro.'
              }
            >
              <RefreshCw
                className={cn('mr-1 h-3.5 w-3.5', atualizando === 'funcionarios' && 'animate-spin')}
                aria-hidden
              />
              {atualizando === 'funcionarios' ? 'Disparando…' : 'Atualizar funcionários'}
            </Button>
          </div>
        </div>
        {!props.dominio && (
          <p className="text-xs text-muted-foreground">
            Esta empresa não tem <strong>domínio</strong> salvo, e o Apollo é consultado por
            domínio — headcount e contatos ficam indisponíveis até ele existir.
          </p>
        )}
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2">
        {isPending ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* ── Faturamento ── */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Banknote className="h-3.5 w-3.5" aria-hidden />
                Faturamento anual
              </div>
              <div className="flex items-end justify-between gap-2">
                <p className="text-xl font-semibold tabular-nums">{moeda(props.faturamento)}</p>
                <Sparkline pontos={pontosFat} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {rotuloOrigem(props.faturamentoOrigem)}
                </Badge>
                {props.faturamentoConfianca && (
                  <Badge className={cn('text-[10px]', CONFIANCA_BADGE[props.faturamentoConfianca])}>
                    {props.faturamentoConfianca}
                  </Badge>
                )}
                <AnoEData
                  ano={anoVigente(porMetrica.faturamento_anual, props.faturamentoOrigem)}
                  em={props.faturamentoEm}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setHistorico('faturamento_anual')}
                >
                  <History className="h-3 w-3" aria-hidden />
                  Histórico ({porMetrica.faturamento_anual.length})
                </button>
                {props.eCliente && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDeclarando('faturamento_anual')}
                  >
                    Declarar
                  </button>
                )}
              </div>
            </div>

            {/* ── Equipe ── */}
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" aria-hidden />
                Funcionários
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-semibold tabular-nums">
                    {props.funcionarios === null ? '—' : props.funcionarios.toLocaleString('pt-BR')}
                  </p>
                  <Variacao valor={crescimentoEquipe} />
                </div>
                <Sparkline pontos={pontosEquipe} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {rotuloOrigem(props.funcionariosOrigem)}
                </Badge>
                <AnoEData
                  ano={anoVigente(porMetrica.funcionarios, props.funcionariosOrigem)}
                  em={props.funcionariosEm}
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setHistorico('funcionarios')}
                >
                  <History className="h-3 w-3" aria-hidden />
                  Histórico ({porMetrica.funcionarios.length})
                </button>
                {props.eCliente && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDeclarando('funcionarios')}
                  >
                    Declarar
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <HistoricoDialog
        aberto={historico !== null}
        onOpenChange={(v) => !v && setHistorico(null)}
        titulo={historico === 'faturamento_anual' ? 'Histórico de faturamento' : 'Histórico de equipe'}
        pontos={historico ? porMetrica[historico] : []}
        formatar={(v) => (historico === 'faturamento_anual' ? moeda(v) : v.toLocaleString('pt-BR'))}
      />

      {declarando && (
        <DeclararDialog
          aberto
          onOpenChange={(v) => !v && setDeclarando(null)}
          empresaId={props.empresaId}
          metrica={declarando}
          onSalvo={recarregar}
        />
      )}
    </Card>
  )
}
