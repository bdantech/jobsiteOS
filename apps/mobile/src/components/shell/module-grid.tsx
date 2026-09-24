import { grantedModules, type AppModule } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import type { LucideIcon } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
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

/**
 * O cartão da grade — o de "Mais" e o do menu do Comercial.
 *
 * Um só componente para as duas grades: são a mesma pergunta ("para onde eu vou
 * daqui?"), e dois cartões parecidos divergiriam no primeiro ajuste de raio ou de
 * espaçamento.
 */
export function CartaoDeMenu({
  icone: Icon,
  titulo,
  rodape,
  disabled = false,
  onPress,
}: {
  icone: LucideIcon
  titulo: string
  /** A linha de baixo: o badge "Somente na web", ou uma descrição curta. */
  rodape: ReactNode
  disabled?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled }}
      onPress={onPress}
      className="min-w-[45%] flex-1 active:opacity-80"
    >
      {/*
        SEM `flex-1` aqui. Ele já esteve neste Card e foi o que deixou a grade
        gigante: `flex: 1` é flexBasis 0 + flexGrow 1, então o Card parava de se
        medir pelo conteúdo e passava a esticar até o espaço que a ScrollView
        oferecia. Os cards ficam do mesmo tamanho pelo CONTEÚDO ser do mesmo
        tamanho — ver o espaçador do badge abaixo —, não por flex.
      */}
      {/*
        O card do módulo BLOQUEADO é tracejado, não só esmaecido.
        
        Opacidade sozinha lê como "desabilitado por enquanto"; o tracejado diz
        que ele não é um botão — é um lugar que existe noutro canto. É a mesma
        distinção que o desenho faz entre Radar e os oito que abrem aqui.
      */}
      <Card
        className={
          disabled
            ? 'min-h-[112px] gap-3.5 rounded-lg border-dashed border-input bg-secondary p-4'
            : 'min-h-[112px] gap-3.5 rounded-lg p-4'
        }
      >
        <View
          className={
            disabled
              ? 'size-10 items-center justify-center rounded-md bg-card'
              : 'size-10 items-center justify-center rounded-md bg-muted'
          }
        >
          <Icon size={20} color={disabled ? colors.mutedForeground : colors.primary} />
        </View>

        <View className="gap-1">
          {/* Uma linha sempre: "Administração" quebrando em duas deixaria aquele
              card mais alto que os outros, e a altura voltaria a divergir. */}
          <Text
            numberOfLines={1}
            className={
              disabled
                ? 'text-[15px] font-semibold text-secondary-foreground'
                : 'text-[15px] font-semibold text-foreground'
            }
          >
            {titulo}
          </Text>

          {rodape}
        </View>
      </Card>
    </Pressable>
  )
}

function ModuleCard({
  module,
  disabled,
  onPress,
}: {
  module: AppModule
  disabled: boolean
  onPress: () => void
}) {
  return (
    <CartaoDeMenu
      icone={moduleIcon(module.icon)}
      titulo={module.name}
      disabled={disabled}
      onPress={onPress}
      rodape={
        /*
          Todos os cards têm a altura do card com badge, e a linha do badge é
          SEMPRE reservada — invisível quando o módulo abre no celular.

          Um `min-h` em pixels resolveria a mesma coisa em uma linha, mas
          quebraria no primeiro usuário que aumenta o tamanho da fonte do
          sistema: a caixa do badge cresce com a fonte e o número fixo não. O
          espaçador é o próprio badge, então cresce junto, por construção.

          Fora da árvore de acessibilidade: um leitor de tela anunciando
          "Somente na web" em Empresas seria uma informação falsa.
        */
        disabled ? (
          <Badge variant="secondary">
            <Text>Somente na web</Text>
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="opacity-0"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text>Somente na web</Text>
          </Badge>
        )
      }
    />
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
