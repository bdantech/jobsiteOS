import {
  ESTAGIO_ANALISE_LABELS,
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  MOTIVO_SEM_POTENCIAL_LABELS,
  type EstagioAnalise,
  type FaixaScore,
  type Knockout,
  type Tables,
} from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import * as React from 'react'
import { Alert, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'
import type { Empresa } from '@/features/empresas/types'

/**
 * Crédito no celular (04d §3).
 *
 * O que vem para cá é o que se usa em pé, na porta do cliente: a chance, o limite que a
 * empresa provavelmente sustenta, e o botão de pedir análise. O breakdown fator a fator e
 * o editor de scorecard ficam na web — aqui virariam uma parede de texto que ninguém lê.
 *
 * O que NÃO some no celular é a ressalva. Quem está com o cliente na frente é justamente
 * quem não pode confundir "limite estimado com confiança baixa" com "limite". Por isso a
 * confiança e o "chance presumida" aparecem com o mesmo peso do número.
 */

const FAIXA_CLASSE: Record<string, string> = {
  alta: 'text-emerald-700 dark:text-emerald-300',
  media: 'text-amber-700 dark:text-amber-400',
  improvavel: 'text-destructive',
  dados_insuficientes: 'text-muted-foreground',
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

async function buscarScore(cnpj: string): Promise<Tables<'empresa_scores'> | null> {
  const { data, error } = await supabase
    .from('empresa_scores')
    .select('*')
    .eq('cnpj', cnpj)
    .order('calculado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function buscarAnalise(cnpj: string): Promise<Tables<'analises_credito'> | null> {
  const { data, error } = await supabase
    .from('analises_credito')
    .select('*')
    .eq('cnpj', cnpj)
    .order('criada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export function CreditoBlock({ empresa }: { empresa: Empresa }) {
  const qc = useQueryClient()

  // O escopo é do prompt: "quanto de limite" é pergunta de SACADO. Fornecedor tem outra
  // (adesão), e mostrar este bloco para ele responderia algo que ninguém perguntou.
  const ehSacado = empresa.tipo === 'construtora' || empresa.tipo === 'incorporadora'

  const score = useQuery({
    queryKey: ['credito', 'score', empresa.cnpj],
    queryFn: () => buscarScore(empresa.cnpj),
    enabled: ehSacado,
  })
  const analise = useQuery({
    queryKey: ['credito', 'analise', empresa.cnpj],
    queryFn: () => buscarAnalise(empresa.cnpj),
    enabled: ehSacado,
  })

  const solicitar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('app_solicitar_analise', {
        p: { empresa_id: empresa.id, limite_solicitado: empresa.limite_potencial } as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      Alert.alert(
        'Análise solicitada',
        'Ela entrou na esteira. O envio à seguradora é um passo separado, feito pelo time de Crédito.',
      )
      void qc.invalidateQueries({ queryKey: ['credito', 'analise', empresa.cnpj] })
    },
    onError: (e: Error) => Alert.alert('Não foi possível solicitar', e.message),
  })

  if (!ehSacado) return null

  const s = score.data
  const semScore = !s || s.score === null
  const aberta = analise.data

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Crédito</CardTitle>
        <Text variant="muted" className="text-xs">
          Estimativa encadeada: o limite sai de uma proporção do faturamento estimado, e a
          confiança dele é herdada — não sobe pelo caminho.
        </Text>
      </CardHeader>

      <CardContent className="gap-3">
        <View className="gap-1">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Chance de concessão
          </Text>
          {s ? (
            <>
              <View className="flex-row items-baseline gap-2">
                <Text className="text-xl font-semibold">{s.score === null ? '—' : Math.round(Number(s.score))}</Text>
                <Text className={`text-sm font-medium ${FAIXA_CLASSE[s.faixa] ?? ''}`}>
                  {FAIXA_SCORE_LABELS[s.faixa as FaixaScore] ?? s.faixa}
                </Text>
              </View>
              <Text variant="muted" className="text-[11px]">
                Completude {Math.round(Number(s.completude) * 100)}% dos pesos
              </Text>
              {s.knockout ? (
                <Text className="text-xs text-destructive">
                  {KNOCKOUT_LABELS[s.knockout as Knockout] ?? s.knockout}
                </Text>
              ) : null}
              {semScore ? (
                <Text variant="muted" className="text-[11px]">
                  Score não exibido: os dados não cobrem o mínimo. Um número calculado sobre
                  poucos fatores parece um score.
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="muted" className="text-sm">
              Ainda não pontuada.
            </Text>
          )}
        </View>

        <View className="gap-1 border-t border-border pt-3">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Potencial
          </Text>
          {empresa.limite_potencial === null ? (
            <Text variant="muted" className="text-xs">
              {empresa.faturamento_anual === null
                ? MOTIVO_SEM_POTENCIAL_LABELS.sem_faturamento
                : MOTIVO_SEM_POTENCIAL_LABELS.sem_calibracao}
            </Text>
          ) : (
            <>
              <Text className="text-xl font-semibold">{moeda(empresa.limite_potencial)}</Text>
              <Text variant="muted" className="text-xs">
                {moeda(empresa.valor_esperado_mensal)}/mês esperado
              </Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                {empresa.limite_confianca ? (
                  <Badge variant="outline">
                    <Text className="text-[10px]">confiança {empresa.limite_confianca}</Text>
                  </Badge>
                ) : null}
                {empresa.chance_concessao !== null ? (
                  <Badge variant="outline">
                    <Text className="text-[10px]">
                      chance {Math.round(Number(empresa.chance_concessao) * 100)}%
                      {semScore ? ' (presumida)' : ''}
                    </Text>
                  </Badge>
                ) : null}
              </View>
            </>
          )}
        </View>

        <View className="border-t border-border pt-3">
          {aberta ? (
            <Button
              variant="outline"
              onPress={() => router.push(`/(tabs)/credito/${aberta.id}` as never)}
            >
              <Text>
                Análise: {ESTAGIO_ANALISE_LABELS[aberta.estagio as EstagioAnalise] ?? aberta.estagio}
              </Text>
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={solicitar.isPending}
              onPress={() =>
                Alert.alert(
                  'Solicitar análise de crédito',
                  `Cria a solicitação na esteira com ${moeda(empresa.limite_potencial)}. NÃO envia à seguradora — o envio é um passo separado, porque resolver o cadastro na Atradius pode ser cobrado.`,
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Solicitar', onPress: () => solicitar.mutate() },
                  ],
                )
              }
            >
              <Text>{solicitar.isPending ? 'Solicitando…' : 'Solicitar análise'}</Text>
            </Button>
          )}
        </View>
      </CardContent>
    </Card>
  )
}
