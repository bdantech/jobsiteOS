import {
  TIPO_VENDEDOR_LABELS,
  STATUS_LANCAMENTO_V2_LABELS,
  type StatusLancamentoV2,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { CalendarDays, Clock, Coins, Inbox, Target, Users } from 'lucide-react-native'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { useResumoComercial } from '@/features/comercial'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * "Meu Painel" no celular: o número que importa, o que está marcado para hoje, e dois
 * atalhos. É a tela que se abre antes de entrar numa reunião — não é lugar de gráfico.
 */
export default function ComercialScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useResumoComercial()

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data.tem_acesso) return <EmptyState title="Sem acesso" description="O módulo Comercial não está liberado para o seu perfil." />
  if (data.sem_vendedor) {
    return (
      <EmptyState
        title="Você não é vendedor"
        description="Seu usuário administra o módulo. Os painéis por pessoa ficam na web."
      />
    )
  }

  const tipo = (data.vendedor?.tipo ?? '') as TipoVendedorId

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-3 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-1">
        <Text className="text-xl font-semibold">{data.vendedor?.nome}</Text>
        <Text variant="muted" className="text-xs">
          {TIPO_VENDEDOR_LABELS[tipo] ?? tipo}
        </Text>
      </View>

      {/*
        O card de comissão agora ABRE a tela — o motor v2 tornou o número live, e o
        primeiro reflexo de quem vê o valor mudar é querer saber qual cessão o mudou.
      */}
      <Pressable onPress={() => router.push('/comercial/comissoes')}>
        <Card className="gap-1 p-4">
          <View className="flex-row items-center gap-2">
            <Coins size={14} color={colors.mutedForeground} />
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              Comissão do mês
            </Text>
          </View>
          <Text className="text-2xl font-semibold">{brl(data.comissao_mes.total)}</Text>
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {Object.entries(data.comissao_mes.por_status).map(([s, v]) => (
              <Badge key={s} variant="outline">
                <Text className="text-[10px]">
                  {STATUS_LANCAMENTO_V2_LABELS[s as StatusLancamentoV2] ?? s}: {brl(Number(v))}
                </Text>
              </Badge>
            ))}
          </View>
          <Text variant="muted" className="pt-1 text-[11px]">
            Provisionado ainda não é fechado, fechado ainda não é aprovado, e aprovado ainda
            não é pago. Toque para ver o extrato.
          </Text>
        </Card>
      </Pressable>

      {/*
        A fila de aceite fica ACIMA dos funis quando tem gente esperando: passado o SLA a
        reunião conta como aceita sozinha, e o que decide é a comissão de outra pessoa.
      */}
      {data.aceites_pendentes > 0 ? (
        <Pressable onPress={() => router.push('/comercial/comissoes')}>
          <Card className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center gap-2">
              <Clock size={16} color={colors.mutedForeground} />
              <Text className="font-medium">Reuniões aguardando seu aceite</Text>
            </View>
            <Badge>
              <Text className="text-[10px]">{data.aceites_pendentes}</Text>
            </Badge>
          </Card>
        </Pressable>
      ) : null}

      {/* Atalhos pelo TIPO: um SDR não tem funil de vendas, e o contrário também. */}
      {tipo === 'sdr' && (
        <Pressable onPress={() => router.push('/comercial/sdr')}>
          <Card className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center gap-2">
              <Target size={16} color={colors.mutedForeground} />
              <Text className="font-medium">Funil de reuniões</Text>
            </View>
            <Text variant="muted">
              {Object.values(data.leads_por_estagio).reduce((s, n) => s + Number(n), 0)}
            </Text>
          </Card>
        </Pressable>
      )}

      {tipo === 'vendedor' && (
        <Pressable onPress={() => router.push('/comercial/vendas')}>
          <Card className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center gap-2">
              <Users size={16} color={colors.mutedForeground} />
              <Text className="font-medium">Funil de vendas</Text>
            </View>
            <Text variant="muted">
              {Object.values(data.vendas_por_estagio).reduce((s, n) => s + Number(n), 0)}
            </Text>
          </Card>
        </Pressable>
      )}

      {tipo === 'originador' && (
        <Card className="flex-row items-center justify-between p-4">
          <View className="flex-row items-center gap-2">
            <Inbox size={16} color={colors.mutedForeground} />
            <Text className="font-medium">NFs vivas na carteira</Text>
          </View>
          <Text variant="muted">{data.nfs_vivas}</Text>
        </Card>
      )}

      <Card className="gap-2 p-4">
        <View className="flex-row items-center gap-2">
          <CalendarDays size={14} color={colors.mutedForeground} />
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Próximas reuniões
          </Text>
        </View>
        {data.proximas_reunioes.length === 0 ? (
          <Text variant="muted" className="text-sm">Nada marcado.</Text>
        ) : (
          data.proximas_reunioes.map((e) => (
            <View key={e.id} className="flex-row items-baseline justify-between gap-2">
              <Text className="flex-1 text-sm">{e.titulo}</Text>
              <Text variant="muted" className="text-xs">
                {new Date(e.inicio_em).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  )
}
