import { MODULES, grantedMobileModules } from '@jobsiteos/core'
import { BlurView } from 'expo-blur'
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
 * A espessura do traço dos ícones da barra.
 *
 * O Lucide desenha com strokeWidth 2 por padrão, que é calibrado para os 16px de
 * um ícone ao lado de texto. Aqui eles saem a 24-28px, e o mesmo traço de 2px vira
 * proporcionalmente muito mais grosso — a barra inteira ficava pesada, ainda mais
 * depois que o rótulo desceu para peso 400. 1,5 devolve a proporção.
 *
 * O mesmo valor para o ícone ativo e o inativo, de propósito: quem distingue os
 * dois é a COR. Engrossar o ativo seria um segundo canal dizendo a mesma coisa, e
 * um ícone que muda de espessura ao ser tocado parece que mudou de forma.
 */
const TRACO_ICONE = 1.5

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
  const { colors, scheme: esquema } = useTheme()

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
          /*
           * A BARRA FLUTUA, e não é enfeite: ela é uma pílula de vidro solta
           * sobre o conteúdo, como no desenho.
           *
           * `position: absolute` tira a barra do fluxo — a lista passa POR
           * BAIXO dela, que é o que faz o blur ter o que borrar. O preço é que
           * cada tela precisa reservar o espaço no fim do scroll; por isso
           * `ALTURA_TAB_BAR` é exportado daqui e não repetido em número solto.
           */
          tabBarStyle: {
            position: 'absolute',
            // Mais estreita e mais redonda que a primeira versão: a pílula tem
            // de parecer um objeto POUSADO sobre a lista, e a 12px de cada lado
            // com raio 20 ela ainda lia como uma barra presa à moldura.
            left: 20,
            right: 20,
            bottom: 26,
            height: 68,
            paddingHorizontal: 4,
            paddingBottom: 0,
            borderRadius: 30,
            borderWidth: 1,
            borderTopWidth: 1,
            borderColor: esquema === 'dark' ? 'rgba(63,68,80,0.7)' : 'rgba(228,232,236,0.8)',
            borderTopColor: esquema === 'dark' ? 'rgba(63,68,80,0.7)' : 'rgba(228,232,236,0.8)',
            backgroundColor: 'transparent',
            elevation: 0,
            // A sombra do desenho: larga e suave, na cor da marca em vez de
            // preto — preto sobre #F4F6F8 fica cinza sujo.
            shadowColor: '#050e40',
            shadowOpacity: 0.12,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 16 },
          },
          tabBarBackground: () => (
            <BlurView
              intensity={80}
              tint={esquema === 'dark' ? 'dark' : 'light'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 30,
                overflow: 'hidden',
                // O blur sozinho fica transparente demais sobre lista clara; a
                // camada de tinta é o que dá corpo à pílula.
                backgroundColor:
                  esquema === 'dark' ? 'rgba(23,24,25,0.72)' : 'rgba(255,255,255,0.72)',
              }}
            />
          ),
          tabBarItemStyle: { paddingVertical: 8 },
          // A família traz o peso: em RN um `fontWeight` sobre fonte carregada
          // por arquivo não engrossa nada (ver o plugin em tailwind.config.js),
          // e o rótulo da barra não passa pelo <Text> que resolve isso.
          tabBarLabelStyle: { fontSize: 11, fontFamily: 'Poppins_500Medium' },
          /*
           * A CENA NÃO RESERVA ESPAÇO — e é isso que faz o blur existir.
           *
           * Com `paddingBottom` aqui, o conteúdo parava antes da barra e o
           * vidro não tinha o que borrar: a pílula ficava leitosa sobre o fundo
           * da tela. Sem ele, a lista passa POR BAIXO e o blur mostra o card
           * desfocado atravessando — que é o efeito pedido.
           *
           * O preço é que cada lista precisa de folga no FIM (`pb-28`), senão o
           * último item nunca sobe acima da barra. É um padding de
           * `contentContainer`, não de cena: ele adiciona espaço depois do
           * conteúdo em vez de encurtar a área de rolagem.
           */
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
                tabBarIcon: ({ color, size }) => (
                  <Icon color={color} size={size} strokeWidth={TRACO_ICONE} />
                ),
              }}
            />
          )
        })}

        <Tabs.Screen
          name="mais"
          options={{
            title: 'Mais',
            tabBarIcon: ({ color, size }) => (
              <LayoutGrid color={color} size={size} strokeWidth={TRACO_ICONE} />
            ),
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
