import { grantedModules, type AppModule } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { webOnlyNotice } from '@/components/shell/notices'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { moduleIcon } from '@/lib/icons'
import { canOpenOnMobile } from '@/lib/linking'

function ModuleCard({
  module,
  disabled,
  onPress,
}: {
  module: AppModule
  disabled: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  const Icon = moduleIcon(module.icon)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={module.name}
      accessibilityState={{ disabled }}
      onPress={onPress}
      className="min-w-[45%] flex-1 active:opacity-80"
    >
      <Card className={disabled ? 'gap-3 p-4 opacity-60' : 'gap-3 p-4'}>
        <View
          className={
            disabled
              ? 'h-10 w-10 items-center justify-center rounded-lg bg-muted'
              : 'h-10 w-10 items-center justify-center rounded-lg bg-primary/15'
          }
        >
          <Icon size={20} color={disabled ? colors.mutedForeground : colors.primary} />
        </View>

        <View className="gap-1">
          <Text variant="label">{module.name}</Text>
          {disabled ? (
            <Badge variant="secondary">
              <Text>Somente na web</Text>
            </Badge>
          ) : null}
        </View>
      </Card>
    </Pressable>
  )
}

/**
 * The full module grid — the mobile stand-in for the web sidebar, and a straight
 * projection of the registry.
 *
 * It shows every module the user's perfil grants, INCLUDING webOnly ones such as
 * admin. Those are rendered disabled, badged "Somente na web", and tapping one
 * explains why instead of navigating: a user who has admin on the web and can't
 * find it here deserves an answer, not an absence. They are never navigable —
 * canOpenOnMobile() gates the push, so the grid cannot become a hole in the guard
 * even if a future module lands here by mistake.
 */
export function ModuleGrid() {
  const { grantedModuleIds, loading } = useSession()
  const router = useRouter()
  const [blocked, setBlocked] = useState<AppModule | null>(null)

  const modules = grantedModules(grantedModuleIds)

  if (loading) {
    return (
      <View className="flex-row flex-wrap gap-3">
        <Skeleton className="h-24 min-w-[45%] flex-1 rounded-xl" />
        <Skeleton className="h-24 min-w-[45%] flex-1 rounded-xl" />
      </View>
    )
  }

  if (modules.length === 0) {
    return (
      <EmptyState
        title="Nenhum módulo liberado"
        description="Seu perfil ainda não tem módulos com acesso pelo aplicativo. Fale com um administrador."
      />
    )
  }

  const notice = blocked ? webOnlyNotice(blocked) : null

  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        {modules.map((module) => {
          const openable = canOpenOnMobile(module.route, grantedModuleIds)

          return (
            <ModuleCard
              key={module.id}
              module={module}
              disabled={!openable}
              onPress={() => {
                if (!openable) {
                  setBlocked(module)
                  return
                }
                router.push(module.route)
              }}
            />
          )
        })}
      </View>

      {notice ? (
        <Dialog
          open
          onOpenChange={() => setBlocked(null)}
          title={notice.title}
          description={notice.description}
        >
          <View className="flex-row justify-end">
            <Button onPress={() => setBlocked(null)}>
              <Text>Entendi</Text>
            </Button>
          </View>
        </Dialog>
      ) : null}
    </>
  )
}
