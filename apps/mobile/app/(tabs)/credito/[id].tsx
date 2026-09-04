import { ESTAGIO_ANALISE_LABELS, formatCnpj, type EstagioAnalise, type Tables } from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { AnalisePropriaMobile, CondicoesComerciaisMobile } from '@/features/credito'
import { supabase } from '@/lib/supabase'

/**
 * Detalhe da análise no celular.
 *
 * Sem mover estágio e sem enviar à seguradora — as duas precisam de conferência e uma
 * delas pode ser cobrada. Mas a DECISÃO de crédito está aqui (04j §10): comitê por
 * telefone e alçada aprovando fora do escritório são o caso de uso real, e mandar a
 * pessoa abrir o notebook para clicar em "operar" é a diferença entre decidir hoje e
 * decidir amanhã.
 */

async function buscar(id: string): Promise<(Tables<'analises_credito'> & { razao_social: string | null }) | null> {
  const { data, error } = await supabase
    .from('analises_credito')
    .select('*, empresas(razao_social)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const a = data as unknown as Tables<'analises_credito'> & { empresas: { razao_social: string | null } | null }
  return { ...a, razao_social: a.empresas?.razao_social ?? null }
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function AnaliseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['credito', 'analise-detalhe', id],
    queryFn: () => buscar(id),
    // Enquanto a seguradora não decide, o poll do worker é quem atualiza. Sem refetch a
    // tela ficaria dizendo "em análise" para sempre.
    refetchInterval: (q) =>
      ['enviada_seguradora', 'em_analise'].includes(q.state.data?.estagio ?? '') ? 60_000 : false,
  })

  if (isPending) return <Skeleton className="m-4 h-64 rounded-xl" />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  return (
    <ScrollView contentContainerClassName="gap-3 p-4 pb-8">
      <View className="gap-1">
        <Text className="text-xl font-semibold">{data.razao_social ?? formatCnpj(data.cnpj)}</Text>
        <Text variant="muted" className="text-sm tabular-nums">
          {formatCnpj(data.cnpj)}
        </Text>
        <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
          <Badge variant="outline">
            <Text className="text-[11px]">
              {ESTAGIO_ANALISE_LABELS[data.estagio as EstagioAnalise] ?? data.estagio}
            </Text>
          </Badge>
          {data.origem === 'atradius_backfill' ? (
            <Badge variant="outline">
              <Text className="text-[11px]">da apólice</Text>
            </Badge>
          ) : null}
        </View>
      </View>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dados</CardTitle>
        </CardHeader>
        <CardContent className="gap-2">
          <View className="flex-row justify-between gap-2">
            <Text variant="muted" className="text-sm">Limite solicitado</Text>
            <Text className="text-sm tabular-nums">{moeda(data.limite_solicitado)}</Text>
          </View>
          <View className="flex-row justify-between gap-2">
            <Text variant="muted" className="text-sm">Limite aprovado (seguradora)</Text>
            <Text className="text-sm font-semibold tabular-nums">{moeda(data.limite_aprovado)}</Text>
          </View>
          <View className="flex-row justify-between gap-2">
            <Text variant="muted" className="text-sm">Limite operacional</Text>
            <Text className="text-sm font-semibold tabular-nums">{moeda(data.limite_operacional)}</Text>
          </View>
          <View className="flex-row justify-between gap-2">
            <Text variant="muted" className="text-sm">Validade</Text>
            <Text className="text-sm">{data.expira_em ?? '—'}</Text>
          </View>
          {data.motivo ? (
            <View className="gap-0.5 border-t border-border pt-2">
              <Text variant="muted" className="text-xs uppercase tracking-wide">Motivo</Text>
              <Text className="text-sm">{data.motivo}</Text>
            </View>
          ) : null}
        </CardContent>
      </Card>

      <AnalisePropriaMobile analiseCreditoId={data.id} />

      <CondicoesComerciaisMobile analiseCreditoId={data.id} />

      {data.empresa_id ? (
        <Button variant="outline" onPress={() => router.push(`/empresas/${data.empresa_id}` as never)}>
          <Text>Abrir a empresa</Text>
        </Button>
      ) : null}

      <Text variant="muted" className="text-[11px]">
        Mover a análise e enviar à seguradora são ações da web: uma delas resolve o cadastro
        na Atradius, que pode ser cobrado.
      </Text>
    </ScrollView>
  )
}
