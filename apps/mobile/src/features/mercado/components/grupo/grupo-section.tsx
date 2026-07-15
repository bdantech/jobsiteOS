import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { formatCnpj, formatInteiro } from '../../format'
import { useGrupoQuery } from '../../queries'
import { GrupoSectionSkeleton } from './skeletons'

const MODULO_MERCADO = 'mercado'

function Numero({ label, valor }: { label: string; valor: number }) {
  return (
    <View className="flex-1 gap-0.5">
      <Text variant="heading">{formatInteiro(valor)}</Text>
      <Text variant="muted" className="text-xs uppercase tracking-wide">
        {label}
      </Text>
    </View>
  )
}

export interface GrupoSectionProps {
  /** `empresas.grupo_id` — null for the vast majority of companies. */
  grupoId: string | null
  /** `empresas.cnpj`, 14 digits. Used only to tell whether THIS company is the head. */
  cnpj: string
}

/**
 * The "Grupo" section of the Company 360 (§5.4).
 *
 * Renders NOTHING unless the company actually belongs to a group — a company with
 * no `grupo_id` must not carry an empty card explaining that it has no group. It
 * also renders nothing when the perfil does not grant `mercado`: the data sits
 * behind that module's RLS, and the screen it links to would refuse the user.
 *
 * The numbers here are the GROUP's, not this company's. That is the whole point:
 * a holding whose forty SPEs are invisible reads as a small company.
 *
 * It shares `useGrupoQuery` — and therefore the cache entry — with the group
 * screen, so the two surfaces can never disagree about how many SPEs a group has,
 * and the tap-through renders from cache instead of spinning.
 */
export function GrupoSection({ grupoId, cnpj }: GrupoSectionProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const { grantedModuleIds } = useSession()

  const temMercado = grantedModuleIds.includes(MODULO_MERCADO)

  // Hooks run unconditionally; the query is disabled when there is nothing to ask
  // for, so a company with no group costs zero round-trips.
  const { data, isPending, isError, refetch } = useGrupoQuery(
    grupoId && temMercado ? grupoId : undefined,
  )

  if (!grupoId || !temMercado) return null

  if (isPending) return <GrupoSectionSkeleton />

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Grupo</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted">Não foi possível carregar o grupo econômico desta empresa.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refetch()}
            className="self-start active:opacity-70"
          >
            <Text className="text-sm font-medium text-primary">Tentar novamente</Text>
          </Pressable>
        </CardContent>
      </Card>
    )
  }

  // The company points at a group that RLS hides, or that the last ingestion
  // recomputed away. Say nothing rather than paint a broken card.
  if (!data) return null

  const { grupo, metricas } = data

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir grupo ${grupo.nome ?? 'econômico'}`}
      onPress={() => router.push(`/mercado/grupos/${grupo.id}`)}
      className="active:opacity-80"
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Grupo</CardTitle>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </CardHeader>

        <CardContent className="gap-3">
          <View className="gap-1">
            <Text variant="label" className="text-base">
              {grupo.nome ?? 'Grupo econômico'}
            </Text>
            {grupo.cnpj_cabeca ? (
              <Text variant="muted" className="text-xs">
                Cabeça: {formatCnpj(grupo.cnpj_cabeca)}
              </Text>
            ) : null}
          </View>

          {grupo.cnpj_cabeca === cnpj ? (
            <Badge variant="success">
              <Text>Esta empresa é a cabeça do grupo</Text>
            </Badge>
          ) : null}

          <View className="flex-row gap-3 pt-1">
            <Numero label="Empresas" valor={metricas.empresas_total} />
            <Numero label="SPEs" valor={metricas.spes_total} />
            <Numero label="SPEs 24m" valor={metricas.spes_24m} />
          </View>

          {metricas.ufs.length > 0 ? (
            <Text variant="muted" className="text-xs">
              Atua em {metricas.ufs.join(', ')}
            </Text>
          ) : null}
        </CardContent>
      </Card>
    </Pressable>
  )
}
