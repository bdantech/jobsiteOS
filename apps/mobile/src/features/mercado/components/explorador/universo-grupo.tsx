import { formatCnpj } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import type { GrupoEconomico } from './types'

export interface UniversoGrupoProps {
  grupo: GrupoEconomico
  /** Members counted on `mercado_explorador`, so RLS already applied. */
  membros: number
}

/**
 * A large incorporadora is not one company: it is a holding with dozens or
 * hundreds of SPEs. Reading this CNPJ alone under-counts it by an order of
 * magnitude, so the sheet always offers the way up to the group.
 */
export function UniversoGrupo({ grupo, membros }: UniversoGrupoProps) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grupo econômico</CardTitle>
      </CardHeader>

      <CardContent>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir o grupo ${grupo.nome ?? 'econômico'}`}
          onPress={() => router.push(`/mercado/grupos/${grupo.id}`)}
          className="flex-row items-center gap-3 active:opacity-70"
        >
          <View className="flex-1 gap-0.5">
            <Text variant="label" numberOfLines={2}>
              {grupo.nome ?? 'Grupo sem nome'}
            </Text>

            {grupo.cnpj_cabeca ? (
              <Text variant="muted" className="text-xs">
                Cabeça: {formatCnpj(grupo.cnpj_cabeca)}
              </Text>
            ) : null}

            <Text variant="muted" className="text-xs">
              {membros} empresa(s) no grupo
            </Text>
          </View>

          <ChevronRight size={20} color={colors.mutedForeground} />
        </Pressable>
      </CardContent>
    </Card>
  )
}
