import { MODULES, grantedMobileModules } from '@jobsiteos/core'
import { Tabs } from 'expo-router'
import { LayoutGrid } from 'lucide-react-native'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { AiFab } from '@/components/shell/ai-fab'
import { BlockedDeepLinkNotice } from '@/components/shell/blocked-deep-link-notice'
import { useSession } from '@/lib/auth'
import { moduleIcon } from '@/lib/icons'

/** "Mais" always exists, so there is always a valid initial tab — even for a
 *  user whose perfil grants nothing yet. */
export const unstable_settings = {
  initialRouteName: 'mais',
}

/** Bottom bar holds at most 4 modules; the rest live in the "Mais" grid. */
const MAX_MODULE_TABS = 4

/**
 * Every module that has a mobile UI, granted or not.
 *
 * webOnly modules (admin) are filtered out at the registry level and therefore
 * have NO route in the mobile app at all — not hidden, absent. That is the
 * strongest form of "the mobile app must never render it": there is nothing to
 * render, so a deep link to /admin cannot resolve to a screen. The root gate
 * bounces it and <BlockedDeepLinkNotice> explains it.
 *
 * Ungranted non-webOnly modules ARE declared, hidden with `href: null`. Expo
 * Router needs the screen to exist for a deep link to resolve at all, and the
 * gate is what refuses it — a route that doesn't exist would render +not-found
 * instead, which tells the user nothing.
 *
 * INVARIANT: every non-webOnly module in the registry must have a matching
 * folder at app/(tabs)/<route>/ — React Navigation throws on a <Tabs.Screen>
 * whose name has no route. Registering a mobile module means shipping its
 * screens; the tab bar then appears on its own.
 */
const MOBILE_MODULES = MODULES.filter((module) => !module.webOnly)

/** '/empresas' -> 'empresas', the folder name under app/(tabs). */
function segmentFor(route: string): string {
  return route.replace(/^\//, '')
}

/**
 * The tab bar is a projection of the registry: a module appears here iff the
 * user's perfil grants it AND it has a mobile UI. The first four fill the bar;
 * everything else is reachable from "Mais".
 */
export default function TabsLayout() {
  const { grantedModuleIds } = useSession()
  const { colors } = useTheme()

  const inBar = new Set(
    grantedMobileModules(grantedModuleIds)
      .slice(0, MAX_MODULE_TABS)
      .map((module) => module.id),
  )

  return (
    <View className="flex-1 bg-background">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        {MOBILE_MODULES.map((module) => {
          const Icon = moduleIcon(module.icon)

          return (
            <Tabs.Screen
              key={module.id}
              name={segmentFor(module.route)}
              options={{
                title: module.name,
                href: inBar.has(module.id) ? module.route : null,
                tabBarIcon: ({ color, size }) => <Icon color={color} size={size} />,
              }}
            />
          )
        })}

        <Tabs.Screen
          name="mais"
          options={{
            title: 'Mais',
            tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
          }}
        />
      </Tabs>

      {/* Global chrome: one AI sheet for the whole shell, and the narrator for
          deep links the guard refuses. Siblings of <Tabs>, so they survive tab
          switches and float above the bar. */}
      <AiFab />
      <BlockedDeepLinkNotice />
    </View>
  )
}
