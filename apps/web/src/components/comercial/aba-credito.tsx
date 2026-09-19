'use client'

import * as React from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, FileUp, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { ESTAGIOS_ANALISE, ESTAGIO_ANALISE_LABELS, type EstagioAnalise } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { EtapasDoFunil } from './etapas-funil'
import { pedirAnaliseDaVendaAction } from '@/actions/comercial'

/**
 * O crédito, visto de dentro do funil de vendas.
 *
 * ─── POR QUE O COMERCIAL VÊ ISTO ────────────────────────────────────────────
 * "Em análise de crédito" era uma coluna sem informação: o card entrava, parava, e a única
 * forma de saber o que estava acontecendo era perguntar para alguém do Crédito. A trilha
 * mostra a mesma esteira que o Crédito enxerga, em modo leitura — quem é dono do negócio
 * passa a responder sozinho "em que pé está".
 *
 * ─── E POR QUE ELE NÃO GANHOU O MÓDULO ──────────────────────────────────────
 * A visão vem de uma RLS estreita (migração 0129): a análise é visível porque está ligada a
 * uma venda que a pessoa é dona, e não porque ela virou usuária do Crédito. Esteira,
 * scorecard e configurações continuam fora — inclusive o interruptor da seguradora.
 *
 * ─── OS DOCUMENTOS VÃO DIRETO PARA A ANÁLISE ────────────────────────────────
 * O que se pede em "aguardando documentação" é exatamente o que o Crédito vai pedir:
 * balanço, DRE, contrato social. Subi-los aqui é subi-los LÁ — mesmo bucket, mesmo
 * checklist. Um repositório paralelo da venda faria os mesmos arquivos existirem em dois
 * lugares, e alguém teria de copiá-los adiante.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Só a trilha que o comercial precisa ler. Cancelada não é caminho. */
const TRILHA: readonly EstagioAnalise[] = ESTAGIOS_ANALISE.filter(
  (e) => e !== 'cancelada' && e !== 'rascunho',
) as EstagioAnalise[]

export interface AnaliseDaVenda {
  id: string
  estagio: string
  limite_solicitado: number | null
  limite_aprovado: number | null
  moeda: string | null
  motivo: string | null
  decidida_em: string | null
}

interface DocDaAnalise {
  id: string
  tipo: string
  nome_arquivo: string | null
  arquivo_url: string
  enviado_em: string
}

/** O catálogo real vive em `credito_config`, que o comercial não lê. Este é o essencial. */
const TIPOS = [
  { id: 'balanco_patrimonial', label: 'Balanço patrimonial' },
  { id: 'dre', label: 'DRE' },
  { id: 'faturamento_declarado', label: 'Faturamento declarado' },
  { id: 'contrato_social', label: 'Contrato social' },
  { id: 'outros', label: 'Outros' },
] as const

/**
 * O preço publicado desta conta.
 *
 * SÓ `publicada`. Rascunho é preço que o Crédito ainda está fechando, e mostrá-lo ao
 * comercial faria a conversa com o cliente acontecer sobre um número que ninguém
 * assumiu — que é uma forma pior do problema que esta tela resolve.
 *
 * A mais recente: republicar substitui, e a anterior fica como `substituida`. O que
 * vale hoje é a última.
 */
async function buscarCondicoes(analiseId: string): Promise<CondicoesDaVenda | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('condicoes_comerciais')
    .select(
      'id, credit_limit, max_invoice_amount, max_due_date_days, expires_at, monthly_rate_d0, monthly_rate_d1, fee_d0, fee_min_d0, fee_d1, fee_min_d1, commission_percent, extension_rate_percent, bill_fine_percent, invest_back_limit, invest_back_commission_percent, has_insurance, fidc_ready, publicada_em, ajustes',
    )
    .eq('analise_credito_id', analiseId)
    .eq('status', 'publicada')
    .order('publicada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CondicoesDaVenda | null) ?? null
}

interface CondicoesDaVenda {
  id: string
  credit_limit: number | null
  max_invoice_amount: number | null
  max_due_date_days: number | null
  expires_at: string | null
  monthly_rate_d0: number | null
  monthly_rate_d1: number | null
  fee_d0: number | null
  fee_min_d0: number | null
  fee_d1: number | null
  fee_min_d1: number | null
  commission_percent: number | null
  extension_rate_percent: number | null
  bill_fine_percent: number | null
  invest_back_limit: number | null
  invest_back_commission_percent: number | null
  has_insurance: boolean | null
  fidc_ready: boolean | null
  publicada_em: string | null
  ajustes: unknown
}

async function buscarDocs(analiseId: string): Promise<DocDaAnalise[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analise_docs')
    .select('id, tipo, nome_arquivo, arquivo_url, enviado_em')
    .eq('analise_id', analiseId)
    .order('enviado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as DocDaAnalise[]
}

const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : BRL.format(Number(v))

function Linha({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-muted-foreground">
        {rotulo}
        {nota ? <span className="ml-1 text-[10px] opacity-70">{nota}</span> : null}
      </dt>
      <dd className="text-sm font-medium tabular-nums">{valor}</dd>
    </div>
  )
}

/**
 * O PREÇO DESTA CONTA, para quem vai falar dele com o cliente (0218).
 *
 * ── POR QUE ISTO ESTAVA FALTANDO ────────────────────────────────────────────
 * A aba mostrava a esteira e a pasta, e parava no limite aprovado. O preço ficava no
 * módulo Crédito, que o comercial não abre — então ele ia perguntar. E enquanto a
 * resposta não vinha, a conversa com o cliente acontecia sobre a taxa PADRÃO, a única
 * que se sabe de cabeça. A precificação por risco existe para essa conta não ser a
 * padrão; uma condição publicada que o vendedor não lê é uma matriz que não chega ao
 * cliente.
 *
 * ── TUDO, INCLUSIVE O QUE FOI AJUSTADO À MÃO ────────────────────────────────
 * Daria para mostrar só os números finais e esconder que alguém mexeu na sugestão da
 * matriz. Não escondo: quem vai DEFENDER a taxa na frente do cliente é quem mais
 * precisa saber que ela foi ajustada. Número tabelado não se defende, se repassa.
 *
 * O que continua fora é a MATRIZ — como o preço se decide, e o preço das outras
 * contas. Ler o preço da própria conta e decidir o preço de qualquer conta são coisas
 * diferentes, e a segunda é o que o módulo guarda.
 */
function CondicoesPublicadas({ analiseId }: { analiseId: string }) {
  const q = useQuery({
    queryKey: ['comercial', 'condicoes-da-venda', analiseId],
    queryFn: () => buscarCondicoes(analiseId),
  })

  if (q.isPending) return <Skeleton className="h-40 w-full rounded-lg" />

  /*
   * Silêncio, e não uma tarja de "sem condições".
   *
   * Aprovado o limite, precificar é um passo seguinte do Crédito e leva o tempo que
   * leva. Um aviso vermelho no card de quem não faz esse trabalho vira cobrança sobre
   * a pessoa errada — e o comercial já vê, pela trilha, que a análise está aprovada.
   */
  if (!q.data) return null

  const c = q.data
  const ajustes = Array.isArray(c.ajustes) ? (c.ajustes as unknown[]) : []
  const temInvestBack = Number(c.invest_back_limit ?? 0) > 0

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Condições comerciais publicadas</p>
        {c.publicada_em ? (
          <p className="text-[11px] text-muted-foreground">
            desde {new Date(c.publicada_em).toLocaleDateString('pt-BR')}
            {c.expires_at
              ? ` · válidas até ${new Date(`${c.expires_at}T12:00:00`).toLocaleDateString('pt-BR')}`
              : ''}
          </p>
        ) : null}
      </div>

      <div className="grid gap-x-6 gap-y-0 sm:grid-cols-2">
        <dl className="divide-y">
          <Linha rotulo="Limite de crédito" valor={brl(c.credit_limit)} />
          <Linha rotulo="Valor máximo por nota" valor={brl(c.max_invoice_amount)} />
          <Linha
            rotulo="Prazo máximo"
            valor={c.max_due_date_days === null ? '—' : `${c.max_due_date_days} dias`}
          />
          <Linha rotulo="Juros mensal" valor={pct(c.monthly_rate_d0)} nota="D0" />
          <Linha rotulo="Juros mensal" valor={pct(c.monthly_rate_d1)} nota="D1" />
          <Linha rotulo="Cashback" valor={pct(c.commission_percent)} />
        </dl>
        <dl className="divide-y">
          <Linha rotulo="TAC" valor={brl(c.fee_d0)} nota="D0" />
          <Linha rotulo="TAC mínima" valor={brl(c.fee_min_d0)} nota="D0" />
          <Linha rotulo="TAC" valor={brl(c.fee_d1)} nota="D1" />
          <Linha rotulo="TAC mínima" valor={brl(c.fee_min_d1)} nota="D1" />
          <Linha rotulo="Multa por atraso" valor={pct(c.bill_fine_percent)} />
          <Linha rotulo="Prorrogação" valor={pct(c.extension_rate_percent)} />
        </dl>
      </div>

      {temInvestBack ? (
        <dl className="divide-y border-t pt-1">
          <Linha rotulo="Limite invest back" valor={brl(c.invest_back_limit)} />
          <Linha rotulo="Comissão invest back" valor={pct(c.invest_back_commission_percent)} />
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {c.has_insurance ? (
          <Badge variant="outline" className="text-[10px]">com cobertura da seguradora</Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px]">sem cobertura</Badge>
        )}
        {c.fidc_ready ? <Badge variant="outline" className="text-[10px]">pronta para FIDC</Badge> : null}
        {ajustes.length > 0 ? (
          <Badge variant="secondary" className="text-[10px]">
            {ajustes.length === 1 ? '1 ajuste sobre a sugestão' : `${ajustes.length} ajustes sobre a sugestão`}
          </Badge>
        ) : null}
      </div>

      <p className="text-[0.8rem] text-muted-foreground">
        {/*
          A TAC é PROPORCIONAL até o limiar da matriz — a nota pequena não paga a TAC
          cheia. Sem esta linha, o vendedor leria "R$ 260" e prometeria R$ 260 numa nota
          de mil reais, que não é o que a plataforma cobra.
        */}
        A TAC cresce com o valor da nota até o teto acima; abaixo do limiar, cobra-se a
        proporcional, nunca menos que a mínima. <strong>D0</strong> é antecipação no ato,{' '}
        <strong>D1</strong> é no dia seguinte.
      </p>
    </div>
  )
}

export function AbaCredito({
  vendaId,
  analise,
  onMudou,
  temCredito = false,
}: {
  vendaId: string
  analise: AnaliseDaVenda | null
  onMudou: () => void
  /**
   * A pessoa alcança /credito? O botão só aparece para quem pode abrir a página —
   * o layout do módulo manda para /sem-acesso quem não tem, e um botão que leva a
   * uma porta trancada ensina que o sistema erra. A leitura AQUI não depende do
   * módulo: vem da RLS estreita da 0129, ligada à venda.
   */
  temCredito?: boolean
}) {
  const qc = useQueryClient()
  const [pedindo, setPedindo] = React.useState(false)

  if (!analise) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Nenhuma análise ligada a este negócio.</p>
          <p className="mt-1">
            Pedir a análise cria a ficha no Crédito, avisa o time e abre o espaço para os
            documentos — que ficam guardados na própria análise.
          </p>
        </div>
        <Button
          size="sm"
          disabled={pedindo}
          onClick={async () => {
            setPedindo(true)
            const r = await pedirAnaliseDaVendaAction({ venda_id: vendaId })
            setPedindo(false)
            if (!r.ok) {
              toast.error(r.message)
              return
            }
            toast.success('Análise pedida. O time de Crédito foi avisado.')
            onMudou()
          }}
        >
          {pedindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Pedir análise de crédito
        </Button>
      </div>
    )
  }

  const negada = analise.estagio === 'negada'
  const aprovada = analise.estagio === 'aprovada' || analise.estagio === 'aprovada_parcial'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <EtapasDoFunil
          etapas={TRILHA.map((e) => ({ id: e, label: ESTAGIO_ANALISE_LABELS[e] }))}
          atual={analise.estagio}
          somenteLeitura
        />
        {temCredito ? (
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <Link href={`/credito/analises/${analise.id}`}>
              Abrir no Crédito
              <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>

      {aprovada && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">
              {analise.limite_aprovado !== null
                ? `${BRL.format(Number(analise.limite_aprovado))} aprovados`
                : 'Aprovado'}
              {analise.estagio === 'aprovada_parcial' && (
                <Badge variant="secondary" className="ml-2 text-[10px]">parcial</Badge>
              )}
            </p>
            {analise.limite_solicitado !== null && (
              <p className="text-[0.8rem] text-muted-foreground">
                Pedido: {BRL.format(Number(analise.limite_solicitado))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* O preço vem logo abaixo do limite: são a mesma resposta ao cliente. */}
      {aprovada && <CondicoesPublicadas analiseId={analise.id} />}

      {negada && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Crédito negado pela seguradora.</p>
            <p className="text-[0.8rem] text-muted-foreground">
              O negócio não avança daqui — a única saída é marcar como perdido.
            </p>
          </div>
        </div>
      )}

      {analise.motivo && (
        <div className="rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">O que a seguradora disse</p>
          <p className="mt-1 whitespace-pre-line text-[0.8rem] leading-snug">{analise.motivo}</p>
        </div>
      )}

      <Documentos analiseId={analise.id} onMudou={() => void qc.invalidateQueries()} />
    </div>
  )
}

function Documentos({ analiseId, onMudou }: { analiseId: string; onMudou: () => void }) {
  const docs = useQuery({
    queryKey: ['venda-analise-docs', analiseId],
    queryFn: () => buscarDocs(analiseId),
  })
  const [enviando, setEnviando] = React.useState<string | null>(null)

  const subir = useMutation({
    mutationFn: async ({ tipo, arquivo }: { tipo: string; arquivo: File }) => {
      const supabase = createClient()
      // O caminho começa pelo id da análise: é o que a policy de storage usa como âncora,
      // tanto a do Crédito quanto a nova, do comercial dono da venda.
      const caminho = `${analiseId}/${tipo}-${Date.now()}-${arquivo.name.replace(/[^\w.\-]/g, '_')}`
      const up = await supabase.storage.from('analise-docs').upload(caminho, arquivo)
      if (up.error) throw new Error(up.error.message)
      const { error } = await supabase.rpc('app_registrar_doc_analise', {
        p: { analise_id: analiseId, tipo, arquivo_url: caminho, nome_arquivo: arquivo.name },
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Documento enviado.')
      void docs.refetch()
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const porTipo = new Map<string, DocDaAnalise[]>()
  for (const d of docs.data ?? []) {
    const l = porTipo.get(d.tipo) ?? []
    l.push(d)
    porTipo.set(d.tipo, l)
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        Documentos — vão direto para a análise do Crédito
      </p>
      {docs.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : (
        <div className="space-y-1.5">
          {TIPOS.map((t) => {
            const enviados = porTipo.get(t.id) ?? []
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <span className="min-w-32 flex-1 text-sm">{t.label}</span>
                {enviados.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {enviados.length} enviado{enviados.length > 1 ? 's' : ''}
                  </Badge>
                )}
                <label className="shrink-0">
                  <input
                    type="file"
                    className="hidden"
                    disabled={enviando !== null}
                    onChange={async (e) => {
                      const arquivo = e.target.files?.[0]
                      if (!arquivo) return
                      setEnviando(t.id)
                      await subir.mutateAsync({ tipo: t.id, arquivo }).catch(() => undefined)
                      setEnviando(null)
                      e.target.value = ''
                    }}
                  />
                  <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs transition-colors hover:bg-accent">
                    {enviando === t.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <FileUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    Enviar
                  </span>
                </label>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[0.8rem] text-muted-foreground">
        Enviado é enviado: apagar documento é do Crédito, porque é prova de decisão. Se subiu
        errado, mande o certo e avise no card.
      </p>
    </div>
  )
}
