import {
  STATUS_CONDICOES_LABELS,
  calcularTac,
  simularTac,
  type StatusCondicoes,
  type Tables,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'

/**
 * As condições comerciais no celular (04o §6): LEITURA e simulador, nada mais.
 *
 * Definir e publicar são webOnly, e não por preguiça de tela: publicar dispara um
 * webhook acionável que faz a plataforma de produção criar a análise de verdade, a
 * partir de onze números que só fazem sentido lidos juntos. Decisão de preço merece
 * tela grande.
 *
 * O que o celular precisa responder é a pergunta do comitê por telefone e da visita ao
 * cliente: "por quanto essa empresa opera, e quanto custa uma nota de mil reais?".
 * Essa é uma pergunta de leitura, e a TAC proporcional é justamente a parte que
 * ninguém consegue calcular de cabeça.
 */

const moeda = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const pct = (v: number | null | undefined, casas = 2): string =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`

interface CondicoesMobile {
  vigente: Tables<'condicoes_comerciais'> | null
  limiar: number
}

async function buscar(analiseCreditoId: string): Promise<CondicoesMobile> {
  const [condRes, matrizRes] = await Promise.all([
    supabase
      .from('condicoes_comerciais')
      .select('*')
      .eq('analise_credito_id', analiseCreditoId)
      .eq('status', 'publicada')
      .maybeSingle(),
    supabase.from('precificacao_matriz').select('definicao').eq('ativa', true).maybeSingle(),
  ])
  if (condRes.error) throw new Error(condRes.error.message)

  const definicao = matrizRes.data?.definicao as { faixas?: { limiar_proporcionalidade_tac?: number } } | null
  return {
    vigente: (condRes.data ?? null) as Tables<'condicoes_comerciais'> | null,
    // Sem matriz ativa, o limiar cai no padrão do 04o §4 — a leitura continua
    // possível, e é melhor que uma tela vazia por causa de uma config ausente.
    limiar: Number(definicao?.faixas?.limiar_proporcionalidade_tac ?? 10_000),
  }
}

export function CondicoesComerciaisMobile({ analiseCreditoId }: { analiseCreditoId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['credito', 'condicoes', analiseCreditoId],
    queryFn: () => buscar(analiseCreditoId),
  })

  if (isPending) return <Skeleton className="h-40 rounded-xl" />
  if (isError) return null
  if (!data?.vigente) return null

  const c = data.vigente
  const n = (v: unknown): number => Number(v ?? 0)

  const linhas = simularTac(
    {
      monthly_rate_d0: n(c.monthly_rate_d0),
      monthly_rate_d1: n(c.monthly_rate_d1),
      fee_d0: n(c.fee_d0),
      fee_min_d0: n(c.fee_min_d0),
      fee_d1: n(c.fee_d1),
      fee_min_d1: n(c.fee_min_d1),
    },
    data.limiar,
  )

  return (
    <View className="gap-3">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Condições comerciais</CardTitle>
          <Badge variant="outline">
            <Text className="text-[11px]">
              {STATUS_CONDICOES_LABELS[c.status as StatusCondicoes] ?? c.status}
            </Text>
          </Badge>
        </CardHeader>
        <CardContent className="gap-2">
          <Linha rotulo="Limite de crédito" valor={moeda(n(c.credit_limit))} />
          <Linha rotulo="Validade" valor={String(c.expires_at)} />
          <Linha rotulo="Juros D0" valor={pct(n(c.monthly_rate_d0))} />
          <Linha rotulo="Juros D1" valor={pct(n(c.monthly_rate_d1))} />
          <Linha
            rotulo="TAC D0"
            valor={`${moeda(n(c.fee_d0))} · mín ${moeda(n(c.fee_min_d0))}`}
          />
          <Linha
            rotulo="TAC D1"
            valor={`${moeda(n(c.fee_d1))} · mín ${moeda(n(c.fee_min_d1))}`}
          />
          <Linha rotulo="Comissão" valor={pct(n(c.commission_percent))} />
          <Linha rotulo="Máximo por nota" valor={moeda(n(c.max_invoice_amount))} />
          <Linha rotulo="Prazo máximo" valor={`${n(c.max_due_date_days)} dias`} />
          <Linha rotulo="Cobertura" valor={c.has_insurance ? 'sim' : 'não'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quanto custa cada nota</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <Text variant="muted" className="text-xs">
            A TAC cresce com o valor da nota até {moeda(data.limiar)} e para lá. A TAC mínima não
            é piso: é o que a nota pequena paga.
          </Text>
          {linhas.map((l) => (
            <View
              key={l.valor_nf}
              className="flex-row items-center justify-between gap-2 border-b border-border/60 py-1.5"
            >
              <Text className="text-sm">{moeda(l.valor_nf)}</Text>
              <View className="items-end">
                <Text className="text-sm tabular-nums">
                  TAC {moeda(l.tac_d0)} · {pct(l.taxa_efetiva_d0)}
                </Text>
                <Text variant="muted" className="text-[11px] tabular-nums">
                  D1 · TAC {moeda(l.tac_d1)} · {pct(l.taxa_efetiva_d1)}
                </Text>
              </View>
            </View>
          ))}
          <Text variant="muted" className="text-[11px]">
            Numa nota de {moeda(1_000)} a TAC do D0 é {moeda(calcularTac(1_000, n(c.fee_d0), n(c.fee_min_d0), data.limiar))} — não a
            tarifa cheia.
          </Text>
        </CardContent>
      </Card>

      <Text variant="muted" className="text-[11px]">
        Editar e publicar condições são ações da web: a publicação dispara a criação da análise
        na plataforma de produção.
      </Text>
    </View>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View className="flex-row justify-between gap-2">
      <Text variant="muted" className="text-sm">
        {rotulo}
      </Text>
      <Text className="text-sm tabular-nums">{valor}</Text>
    </View>
  )
}
