import { Stack, useLocalSearchParams } from 'expo-router'
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  Empresa360Skeleton,
  EmpresaHeader,
  ErpBlock,
  NotasSection,
  TimelineSection,
  empresaTitulo,
  useEmpresa360Query,
} from '@/features/empresas'
import { GrupoSection } from '@/features/mercado/components/grupo'

/**
 * Company 360, and the deep-link target: a notification's url is "/empresas/<uuid>",
 * which Expo Router matches here (group segments like (tabs) are ignored when
 * matching). Access is enforced by the root gate, not by this screen.
 */
export default function EmpresaDetalheScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()

  const { data, isPending, isError, refetch, isRefetching } = useEmpresa360Query(id)

  if (isPending) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Empresa' }} />
        <Empresa360Skeleton />
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Empresa' }} />
        <ErrorState
          description="Não foi possível carregar esta empresa. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      </View>
    )
  }

  // Zero rows: the company doesn't exist, or RLS hid it. Same answer either way.
  if (!data) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ title: 'Empresa' }} />
        <EmptyState
          title="Empresa não encontrada"
          description="Ela pode ter sido removida, ou seu perfil não tem acesso a ela."
        />
      </View>
    )
  }

  const { empresa, notas, eventos } = data

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      // The note composer sits low on the screen; without this the keyboard covers it.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ title: empresaTitulo(empresa) }} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4 pb-12"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.mutedForeground}
          />
        }
      >
        <EmpresaHeader empresa={empresa} />
        <ErpBlock empresa={empresa} />
        {/* Renders itself away when the company has no grupo_id (most of them) or
            when the perfil doesn't grant `mercado`. Taps through to the group. */}
        <GrupoSection grupoId={empresa.grupo_id} cnpj={empresa.cnpj} />
        <NotasSection empresaId={empresa.id} notas={notas} />
        <TimelineSection eventos={eventos} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
