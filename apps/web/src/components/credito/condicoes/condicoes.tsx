'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, History, RefreshCw, Save, Send } from 'lucide-react'
import {
  CAMPO_CONDICAO_LABELS,
  STATUS_CONDICOES_LABELS,
  derivarDoD0,
  montarPayloadProducao,
  sugerirCondicoes,
  validarCondicoes,
  type CondicoesFormulario,
  type MatrizPrecificacao,
  type StatusCondicoes,
  type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { publicarCondicoesAction, salvarCondicoesAction } from '@/actions/credito-precificacao'
import { brl } from '../analise-propria/resultado'
import { PorqueDaSugestao } from './porque'
import { SimuladorTac } from './simulador'
import {
  buscarPainelCondicoes,
  condicoesKeys,
  contextoDoPainel,
  type EntregaCondicoes,
} from './queries'

/**
 * A seção "Condições comerciais" da análise (04o §6).
 *
 * ─── O QUE ESTA TELA DECIDE, E O QUE ELA SÓ MOSTRA ──────────────────────────
 * Ela decide preço: juros, TAC, comissão e limites. Ela NÃO decide `has_insurance`
 * (que é derivado da cobertura vigente da seguradora) nem os acessórios fixos (multa,
 * prorrogação, invest back, indicação, FIDC) — esses vêm da matriz e se editam lá,
 * porque são política da casa e não negociação por cliente. Um campo editável aqui
 * para cada um deles convidaria vinte tabelas diferentes a existirem.
 *
 * ─── A VALIDAÇÃO É A MESMA DA PUBLICAÇÃO ────────────────────────────────────
 * `validarCondicoes`, do core, roda a cada tecla aqui e de novo na action. Uma tela
 * que valida diferente do que publica é uma tela que promete e o servidor desmente.
 *
 * ─── FORA DA FAIXA É PERMITIDO, MAS NÃO É DE GRAÇA ──────────────────────────
 * O analista pode furar o piso e o teto da matriz — ele conhece o caso, a matriz não.
 * O que ele não pode é fazer isso sem escrever por quê: a justificativa é obrigatória
 * e fica gravada em `ajustes`, junto do que ele mudou campo a campo.
 */

const EDITAVEIS = [
  'credit_limit',
  'expires_at',
  'max_invoice_amount',
  'max_due_date_days',
  'monthly_rate_d0',
  'monthly_rate_d1',
  'fee_d0',
  'fee_min_d0',
  'fee_d1',
  'fee_min_d1',
  'commission_percent',
] as const

type CampoEditavel = (typeof EDITAVEIS)[number]

const numeroPtBr = (n: number, casas = 3): string =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: casas })

// ─── Campo com faixa ────────────────────────────────────────────────────────

/**
 * Um campo numérico com a faixa permitida e um marcador de onde o valor caiu dentro
 * dela (04o §6). A barra existe porque "1,9 a 3,4" é um texto que ninguém lê duas
 * vezes; a posição do traço é lida de relance, e é ela que responde "estou barato ou
 * caro para este perfil?".
 */
function CampoNumero({
  campo,
  valor,
  onChange,
  sufixo,
  passo = 'any',
  faixa,
  erro,
  foraDaFaixa,
  sugerido,
}: {
  campo: string
  valor: number
  onChange: (n: number) => void
  sufixo?: string
  passo?: string
  faixa?: { min: number; max: number }
  erro?: string
  foraDaFaixa?: boolean
  sugerido?: number
}) {
  const pos =
    faixa && faixa.max > faixa.min
      ? Math.min(Math.max((valor - faixa.min) / (faixa.max - faixa.min), 0), 1)
      : null

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={campo} className="text-xs text-muted-foreground">
          {CAMPO_CONDICAO_LABELS[campo as keyof typeof CAMPO_CONDICAO_LABELS] ?? campo}
        </Label>
        {sugerido !== undefined && sugerido !== valor && (
          <button
            type="button"
            onClick={() => onChange(sugerido)}
            className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            sugerido {numeroPtBr(sugerido)}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          id={campo}
          type="number"
          step={passo}
          className="h-8 tabular-nums"
          value={Number.isFinite(valor) ? valor : ''}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          aria-invalid={Boolean(erro)}
        />
        {sufixo && <span className="shrink-0 text-xs text-muted-foreground">{sufixo}</span>}
      </div>
      {faixa && (
        <div className="space-y-0.5">
          <div className="relative h-1 rounded-full bg-muted">
            {pos !== null && (
              <span
                className={
                  'absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full ' +
                  (foraDaFaixa ? 'bg-destructive' : 'bg-primary')
                }
                style={{ left: `${pos * 100}%` }}
                aria-hidden
              />
            )}
          </div>
          <p
            className={
              'flex justify-between text-[10px] tabular-nums ' +
              (foraDaFaixa ? 'text-destructive' : 'text-muted-foreground')
            }
          >
            <span>{numeroPtBr(faixa.min)}</span>
            {foraDaFaixa && <span className="font-medium">fora da faixa</span>}
            <span>{numeroPtBr(faixa.max)}</span>
          </p>
        </div>
      )}
      {erro && <p className="text-[11px] text-destructive">{erro}</p>}
    </div>
  )
}

// ─── A seção ────────────────────────────────────────────────────────────────

export function CondicoesComerciais({ analiseId }: { analiseId: string }) {
  const qc = useQueryClient()

  const painel = useQuery({
    queryKey: condicoesKeys.painel(analiseId),
    queryFn: () => buscarPainelCondicoes(analiseId),
    /*
     * A entrega do webhook é do worker, e ele responde em segundos. Sem refetch, quem
     * acabou de publicar ficaria olhando para "pendente" até recarregar a página —
     * exatamente no momento em que a pergunta "eles receberam?" é a única que importa.
     */
    refetchInterval: (q) =>
      (q.state.data?.entregas ?? []).some((e) => e.status === 'pendente') ? 5_000 : false,
  })

  const [form, setForm] = React.useState<CondicoesFormulario | null>(null)
  const [justificativa, setJustificativa] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [publicando, setPublicando] = React.useState(false)

  const dados = painel.data
  const matriz = (dados?.matriz?.definicao ?? null) as MatrizPrecificacao | null

  const sugestao = React.useMemo(() => {
    if (!dados || !matriz) return null
    return sugerirCondicoes(contextoDoPainel(dados), matriz)
  }, [dados, matriz])

  /*
   * O formulário abre no que já existe — rascunho antes de publicada — e só cai na
   * sugestão quando não existe nada. Abrir sempre na sugestão apagaria, sem aviso, o
   * trabalho de quem parou no meio ontem.
   */
  React.useEffect(() => {
    if (form !== null || !dados || !sugestao) return
    const existente =
      dados.condicoes.find((c) => c.status === 'rascunho') ??
      dados.condicoes.find((c) => c.status === 'publicada')
    setForm(existente ? doBanco(existente) : sugestao.condicoes)
  }, [dados, sugestao, form])

  if (painel.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (painel.isError || !dados?.encontrado || !dados.esteira) {
    return <Aviso texto="Não foi possível carregar as condições desta análise." />
  }

  if (!matriz || !dados.matriz) {
    return (
      <Aviso texto="Nenhuma matriz de precificação ativa. Ative uma em Crédito → Precificação antes de precificar." />
    )
  }

  const aprovada = ['aprovada', 'aprovada_parcial'].includes(dados.esteira.estagio)
  if (!aprovada) {
    return (
      <Aviso texto="Condições comerciais só se definem em análise aprovada. Enquanto a esteira não decidir, não há o que publicar." />
    )
  }

  if (!form || !sugestao) return <Skeleton className="h-96 w-full rounded-lg" />

  const validacao = validarCondicoes(form, matriz)
  const errosPorCampo = new Map(validacao.erros.map((e) => [e.campo, e.mensagem]))
  const forasPorCampo = new Set(validacao.foras_de_faixa.map((f) => f.campo))
  const precisaJustificar = validacao.foras_de_faixa.length > 0
  const semJustificativa = precisaJustificar && justificativa.trim().length < 10

  const publicada = dados.condicoes.find((c) => c.status === 'publicada') ?? null
  const ultimaFalha = dados.condicoes.find((c) => c.status === 'falha_validacao') ?? null

  const mudou = (campo: CampoEditavel): boolean =>
    String(form[campo]) !== String(sugestao.condicoes[campo])

  const set = (campo: CampoEditavel, valor: number | string) => {
    setForm((atual) => {
      if (!atual) return atual
      const proximo = { ...atual, [campo]: valor } as CondicoesFormulario
      /*
       * Mexer no D0 REDERIVA o D1 e os dois `fee_min`, pelas regras da matriz.
       *
       * Sem isso, baixar o juros D0 para 2,0% deixaria o D1 em 2,674% — mais caro que
       * o D0 — e a tela mostraria um erro que o próprio usuário não provocou. Quem
       * quiser um D1 fora da regra ainda pode digitá-lo depois; o que não faz sentido
       * é a tela produzir a incoerência sozinha.
       */
      if (campo === 'monthly_rate_d0' || campo === 'fee_d0') {
        const d = derivarDoD0(
          Number(proximo.monthly_rate_d0),
          Number(proximo.fee_d0),
          matriz.faixas,
        )
        return { ...proximo, ...d }
      }
      return proximo
    })
  }

  const ajustesDoAnalista = () => {
    const campos = EDITAVEIS.filter((c) => mudou(c)).map((c) => ({
      campo: c,
      sugerido: sugestao.condicoes[c],
      escolhido: form[c],
    }))
    return {
      campos,
      justificativa: justificativa.trim() || null,
      foras_de_faixa: validacao.foras_de_faixa,
      explicacao: sugestao.explicacao,
    } as unknown as Record<string, unknown>
  }

  const invalidar = () => void qc.invalidateQueries({ queryKey: condicoesKeys.painel(analiseId) })

  async function salvarRascunho() {
    if (!form || !dados?.matriz) return
    setSalvando(true)
    const r = await salvarCondicoesAction({
      analise_credito_id: analiseId,
      condicoes: form,
      sugestao: sugestao?.condicoes as unknown as Record<string, unknown>,
      ajustes: ajustesDoAnalista(),
      matriz_versao: dados.matriz.versao,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Rascunho salvo. Nada foi enviado à plataforma.')
    invalidar()
  }

  async function publicar() {
    if (!form || !matriz || !dados?.matriz) return
    setPublicando(true)
    const r = await publicarCondicoesAction({
      analise_credito_id: analiseId,
      condicoes: form,
      sugestao: sugestao?.condicoes as unknown as Record<string, unknown>,
      ajustes: ajustesDoAnalista(),
      matriz_versao: dados.matriz.versao,
      matriz,
    })
    setPublicando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.publicada) {
      toast.error(
        `Validação recusou: ${r.data.erros.map((e) => e.mensagem).join(' ')} A tentativa ficou registrada.`,
      )
      invalidar()
      return
    }
    toast.success(
      r.data.worker_acordado
        ? 'Publicada. O webhook saiu para a plataforma de produção.'
        : 'Publicada. O worker não respondeu — a fila entrega no próximo ciclo.',
    )
    invalidar()
  }

  const f = matriz.faixas
  const payload = montarPayloadProducao(form, {
    onepay_company_id: dados.onepay_company_id,
    cnpj: dados.esteira.cnpj,
    razao_social: dados.empresa?.razao_social ?? null,
  })

  return (
    <div className="grid items-start gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        {ultimaFalha && !publicada && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="flex gap-2 py-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="font-medium">A última tentativa de publicação foi recusada.</p>
                <p className="text-xs text-muted-foreground">{ultimaFalha.erro_validacao}</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Limites e validade</CardTitle>
              <CardDescription>
                O limite vem da esteira ou da nossa análise; a validade é hoje mais{' '}
                {f.validade_meses_default} meses.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(sugestao.condicoes)
                setJustificativa('')
              }}
            >
              <RefreshCw className="mr-1 size-3.5" aria-hidden />
              Voltar à sugestão
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CampoNumero
              campo="credit_limit"
              valor={form.credit_limit}
              onChange={(n) => set('credit_limit', n)}
              sufixo="R$"
              erro={errosPorCampo.get('credit_limit')}
              sugerido={sugestao.condicoes.credit_limit}
            />
            <div className="space-y-1">
              <Label htmlFor="expires_at" className="text-xs text-muted-foreground">
                Validade
              </Label>
              <Input
                id="expires_at"
                type="date"
                className="h-8"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
                aria-invalid={errosPorCampo.has('expires_at')}
              />
              {errosPorCampo.get('expires_at') && (
                <p className="text-[11px] text-destructive">{errosPorCampo.get('expires_at')}</p>
              )}
            </div>
            <CampoNumero
              campo="max_invoice_amount"
              valor={form.max_invoice_amount}
              onChange={(n) => set('max_invoice_amount', n)}
              sufixo="R$"
              faixa={{ min: 500, max: 10_000_000 }}
              erro={errosPorCampo.get('max_invoice_amount')}
              sugerido={sugestao.condicoes.max_invoice_amount}
            />
            <CampoNumero
              campo="max_due_date_days"
              valor={form.max_due_date_days}
              onChange={(n) => set('max_due_date_days', n)}
              sufixo="dias"
              passo="1"
              faixa={{ min: 5, max: 365 }}
              erro={errosPorCampo.get('max_due_date_days')}
              sugerido={sugestao.condicoes.max_due_date_days}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Juros e tarifas</CardTitle>
            <CardDescription>
              <strong>D0 é o produto caro</strong>: juros e TAC do D0 precisam ser maiores que os do
              D1. Mexer no D0 rederiva o D1 e as TACs mínimas pelas regras da matriz.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CampoNumero
              campo="monthly_rate_d0"
              valor={form.monthly_rate_d0}
              onChange={(n) => set('monthly_rate_d0', n)}
              sufixo="% a.m."
              passo="0.01"
              faixa={{ min: f.juros.d0_min, max: f.juros.d0_max }}
              foraDaFaixa={forasPorCampo.has('monthly_rate_d0')}
              erro={errosPorCampo.get('monthly_rate_d0')}
              sugerido={sugestao.condicoes.monthly_rate_d0}
            />
            <CampoNumero
              campo="monthly_rate_d1"
              valor={form.monthly_rate_d1}
              onChange={(n) => set('monthly_rate_d1', n)}
              sufixo="% a.m."
              passo="0.01"
              erro={errosPorCampo.get('monthly_rate_d1')}
              sugerido={sugestao.condicoes.monthly_rate_d1}
            />
            <CampoNumero
              campo="commission_percent"
              valor={form.commission_percent}
              onChange={(n) => set('commission_percent', n)}
              sufixo="%"
              passo="0.01"
              faixa={{ min: f.comissao.min, max: f.comissao.max }}
              foraDaFaixa={forasPorCampo.has('commission_percent')}
              erro={errosPorCampo.get('commission_percent')}
              sugerido={sugestao.condicoes.commission_percent}
            />
            <CampoNumero
              campo="fee_d0"
              valor={form.fee_d0}
              onChange={(n) => set('fee_d0', n)}
              sufixo="R$"
              passo="0.01"
              faixa={{ min: f.tac.fee_d0_min, max: f.tac.fee_d0_max }}
              foraDaFaixa={forasPorCampo.has('fee_d0')}
              erro={errosPorCampo.get('fee_d0')}
              sugerido={sugestao.condicoes.fee_d0}
            />
            <CampoNumero
              campo="fee_min_d0"
              valor={form.fee_min_d0}
              onChange={(n) => set('fee_min_d0', n)}
              sufixo="R$"
              passo="0.01"
              erro={errosPorCampo.get('fee_min_d0')}
              sugerido={sugestao.condicoes.fee_min_d0}
            />
            <div className="hidden lg:block" />
            <CampoNumero
              campo="fee_d1"
              valor={form.fee_d1}
              onChange={(n) => set('fee_d1', n)}
              sufixo="R$"
              passo="0.01"
              erro={errosPorCampo.get('fee_d1')}
              sugerido={sugestao.condicoes.fee_d1}
            />
            <CampoNumero
              campo="fee_min_d1"
              valor={form.fee_min_d1}
              onChange={(n) => set('fee_min_d1', n)}
              sufixo="R$"
              passo="0.01"
              erro={errosPorCampo.get('fee_min_d1')}
              sugerido={sugestao.condicoes.fee_min_d1}
            />
          </CardContent>
        </Card>

        <SimuladorTac condicoes={form} limiar={f.limiar_proporcionalidade_tac} />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Derivados e fixos</CardTitle>
            <CardDescription>
              Não se editam aqui. <strong>Cobertura</strong> vem da decisão da seguradora; o resto é
              política da casa e se muda em Crédito → Precificação, para toda a carteira de uma vez.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Fixo rotulo="Tem cobertura" valor={form.has_insurance ? 'sim' : 'não'} />
            <Fixo rotulo="Multa" valor={`${numeroPtBr(form.bill_fine_percent)}%`} />
            <Fixo rotulo="Prorrogação" valor={`${numeroPtBr(form.extension_rate_percent)}%`} />
            <Fixo rotulo="Limite invest back" valor={brl(form.invest_back_limit)} />
            <Fixo
              rotulo="Comissão invest back"
              valor={`${numeroPtBr(form.invest_back_commission_percent)}%`}
            />
            <Fixo rotulo="Indicação" valor={form.has_referral ? 'sim' : 'não'} />
            <Fixo rotulo="Pronta para FIDC" valor={form.fidc_ready ? 'sim' : 'não'} />
            <Fixo rotulo="Papel" valor="PAYER (sacado)" />
            <Fixo rotulo="Status enviado" valor="APPROVED" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">O que será enviado</CardTitle>
            <CardDescription>
              Exatamente este objeto vai no webhook, e a produção o repassa sem transformação.
              Identificação por{' '}
              <strong>{dados.onepay_company_id ? 'companyId' : 'document + subjectName'}</strong> —
              nunca os dois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Publicar</CardTitle>
            <CardDescription>
              Publicar grava uma versão nova, aposenta a anterior e dispara o webhook acionável.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {validacao.erros.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-2">
                {validacao.erros.map((e) => (
                  <li key={`${e.campo}-${e.mensagem}`} className="text-xs">
                    <strong>
                      {CAMPO_CONDICAO_LABELS[e.campo as keyof typeof CAMPO_CONDICAO_LABELS] ??
                        e.campo}
                      :
                    </strong>{' '}
                    {e.mensagem}
                  </li>
                ))}
              </ul>
            )}

            {precisaJustificar && (
              <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2">
                <p className="text-xs">
                  {validacao.foras_de_faixa
                    .map(
                      (x) =>
                        `${CAMPO_CONDICAO_LABELS[x.campo as keyof typeof CAMPO_CONDICAO_LABELS] ?? x.campo} está fora de ${numeroPtBr(x.min)}–${numeroPtBr(x.max)}`,
                    )
                    .join(' · ')}
                  . Você decide — mas a justificativa fica no registro.
                </p>
                <Textarea
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Por que este caso sai da faixa da matriz?"
                  className="min-h-16 text-sm"
                />
              </div>
            )}

            <Button
              className="w-full"
              size="sm"
              disabled={publicando || validacao.erros.length > 0 || semJustificativa}
              onClick={() => void publicar()}
            >
              <Send className="mr-1 size-3.5" aria-hidden />
              {publicando ? 'Publicando…' : 'Publicar para a plataforma'}
            </Button>
            <Button
              className="w-full"
              size="sm"
              variant="outline"
              disabled={salvando}
              onClick={() => void salvarRascunho()}
            >
              <Save className="mr-1 size-3.5" aria-hidden />
              {salvando ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
            {semJustificativa && (
              <p className="text-[11px] text-muted-foreground">
                Escreva a justificativa do valor fora da faixa para liberar a publicação.
              </p>
            )}
          </CardContent>
        </Card>

        <Entregas entregas={dados.entregas} />

        <PorqueDaSugestao explicacao={sugestao.explicacao} matrizVersao={dados.matriz.versao} />

        <Historico condicoes={dados.condicoes} />
      </div>
    </div>
  )
}

// ─── Blocos auxiliares ──────────────────────────────────────────────────────

function Aviso({ texto }: { texto: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">{texto}</CardContent>
    </Card>
  )
}

function Fixo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5">
      <p className="text-[10px] text-muted-foreground">{rotulo}</p>
      <p className="text-sm tabular-nums">{valor}</p>
    </div>
  )
}

/**
 * O resultado da entrega (04o §6). Publicar sem mostrar isto deixaria o analista com a
 * impressão de que terminou — quando o que terminou foi o enfileiramento.
 */
function Entregas({ entregas }: { entregas: EntregaCondicoes[] }) {
  if (entregas.length === 0) return null
  const ultima = entregas[0]!
  const rotulo =
    ultima.status === 'entregue'
      ? 'A plataforma recebeu.'
      : ultima.status === 'pendente'
        ? `Na fila — ${ultima.tentativas} tentativa(s).`
        : 'Não entregue.'

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {ultima.status === 'entregue' ? (
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
          )}
          Entrega
        </CardTitle>
        <CardDescription>{rotulo}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {entregas.slice(0, 5).map((e) => (
            <li key={e.id} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>{new Date(e.criado_em).toLocaleString('pt-BR')}</span>
                <Badge
                  variant={
                    e.status === 'entregue'
                      ? 'default'
                      : e.status === 'pendente'
                        ? 'secondary'
                        : 'destructive'
                  }
                  className="text-[10px]"
                >
                  {e.status}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                {e.tentativas} tentativa(s)
                {e.ultimo_status_http ? ` · HTTP ${e.ultimo_status_http}` : ''}
                {e.ultimo_erro ? ` · ${e.ultimo_erro}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Historico({ condicoes }: { condicoes: Tables<'condicoes_comerciais'>[] }) {
  if (condicoes.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" aria-hidden />
          Versões
        </CardTitle>
        <CardDescription>
          Nunca sobrescrito: a versão anterior fica como substituída, e a recusada fica com o
          motivo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {condicoes.map((c) => (
            <li key={c.id} className="space-y-0.5 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="tabular-nums">
                  {Number(c.monthly_rate_d0).toLocaleString('pt-BR')}% · {brl(Number(c.fee_d0))} ·{' '}
                  {brl(Number(c.credit_limit))}
                </span>
                <Badge
                  variant={
                    c.status === 'publicada'
                      ? 'default'
                      : c.status === 'falha_validacao'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="text-[10px]"
                >
                  {STATUS_CONDICOES_LABELS[c.status as StatusCondicoes] ?? c.status}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                matriz v{c.matriz_versao} · {new Date(c.criada_em).toLocaleString('pt-BR')}
              </p>
              {c.erro_validacao && (
                <p className="text-[11px] text-destructive">{c.erro_validacao}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** A linha do banco vira o formulário. `numeric` chega como string no PostgREST. */
function doBanco(c: Tables<'condicoes_comerciais'>): CondicoesFormulario {
  const n = (v: unknown): number => Number(v ?? 0)
  return {
    credit_limit: n(c.credit_limit),
    max_invoice_amount: n(c.max_invoice_amount),
    max_due_date_days: n(c.max_due_date_days),
    expires_at: String(c.expires_at),
    monthly_rate_d0: n(c.monthly_rate_d0),
    monthly_rate_d1: n(c.monthly_rate_d1),
    fee_d0: n(c.fee_d0),
    fee_min_d0: n(c.fee_min_d0),
    fee_d1: n(c.fee_d1),
    fee_min_d1: n(c.fee_min_d1),
    commission_percent: n(c.commission_percent),
    extension_rate_percent: n(c.extension_rate_percent),
    bill_fine_percent: n(c.bill_fine_percent),
    invest_back_limit: n(c.invest_back_limit),
    invest_back_commission_percent: n(c.invest_back_commission_percent),
    has_insurance: Boolean(c.has_insurance),
    has_referral: Boolean(c.has_referral),
    fidc_ready: Boolean(c.fidc_ready),
  }
}
