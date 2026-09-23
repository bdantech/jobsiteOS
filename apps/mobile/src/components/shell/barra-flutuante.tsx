// O tipo vem do expo-router, não de `@react-navigation/bottom-tabs`: o
// navegador de abas do Expo Router 57 é uma cópia própria, e o pacote do
// react-navigation nem está instalado. Importar de lá compila num dia em que
// alguém adicione a dependência e passe a descrever outra coisa.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs'
import { BlurView } from 'expo-blur'
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'

/**
 * A BARRA DE ABAS, desenhada por nós.
 *
 * ── POR QUE NÃO `tabBarStyle` ───────────────────────────────────────────────
 * Foi a primeira tentativa: `position: absolute` + `left/right` + raio +
 * `tabBarBackground` com blur. No aparelho a barra saiu da largura inteira,
 * quadrada e opaca — o React Navigation recalcula altura e recuos do container
 * a partir dos insets e sobrescreve parte do que se passa ali, então metade do
 * estilo chegava e metade não. Estilo que às vezes vale é pior que estilo
 * nenhum, porque some sem erro.
 *
 * Com `tabBar` o container é NOSSO. Nada recalcula, e o que está escrito aqui é
 * o que aparece.
 *
 * ── O BLUR BORRA O QUE FOI PINTADO ANTES DELE ───────────────────────────────
 * A cena é IRMÃ da barra e é pintada primeiro, então é ela que o vidro captura
 * — e é por isso que a lista precisa passar por baixo (`pb-28` no fim de cada
 * uma) em vez de parar antes. O que não pode é a própria barra ter fundo
 * opaco: por isso o único elemento com cor aqui é a camada de tinta, e ela é
 * translúcida.
 *
 * No Android o `experimentalBlurMethod` é necessário: sem ele o BlurView é um
 * retângulo sólido, e a barra pareceria correta no iOS e quebrada no Android.
 */

/** Altura da pílula + distância do fundo. As listas reservam isto no fim. */
// 82 = 68 + 20%: a pílula anterior apertava ícone e rótulo contra as bordas.
export const ALTURA_BARRA = 82
export const FUNDO_BARRA = 24

export function BarraFlutuante({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, scheme } = useTheme()
  const { bottom } = useSafeAreaInsets()

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        // O inset do indicador de home entra AQUI e não como padding da pílula:
        // a pílula tem altura fixa, e somar o inset a ela a deixaria mais alta
        // num iPhone com Face ID e mais baixa num com botão.
        paddingBottom: bottom > 0 ? bottom - 10 : FUNDO_BARRA,
        paddingHorizontal: 20,
      }}
    >
      <View
        style={{
          height: ALTURA_BARRA,
          borderRadius: ALTURA_BARRA / 2,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: scheme === 'dark' ? 'rgba(63,68,80,0.7)' : 'rgba(228,232,236,0.9)',
          // Sombra larga e suave, na cor da marca: preto sobre #F4F6F8 vira
          // cinza sujo.
          shadowColor: '#050e40',
          shadowOpacity: 0.14,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        }}
      >
        <BlurView
          intensity={scheme === 'dark' ? 60 : 40}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 4 }}
        >
          {/* A tinta por cima do vidro. Só blur fica transparente demais sobre
              lista clara e os rótulos perdem contraste. */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: scheme === 'dark' ? 'rgba(23,24,25,0.6)' : 'rgba(255,255,255,0.6)',
            }}
          />

          {state.routes.map((route, indice) => {
            const { options } = descriptors[route.key]!

            /*
             * SÓ AS ABAS VISÍVEIS.
             *
             * `href: null` no <Tabs.Screen> não remove a rota — ela precisa
             * existir para um deep link resolver — e o Expo Router a esconde
             * traduzindo isso em `tabBarItemStyle: { display: 'none' }`. A
             * barra padrão respeita; a nossa precisa respeitar também, senão
             * desenha os nove módulos declarados em vez dos quatro que o perfil
             * liberou, espremidos.
             */
            const escondida =
              (StyleSheet.flatten(options.tabBarItemStyle) as ViewStyle | undefined)?.display ===
              'none'
            if (escondida) return null

            const ativo = state.index === indice
            const rotulo =
              typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name)

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? rotulo}
                onPress={() => {
                  const evento = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  })
                  // `navigate` e não `reset`: tocar na aba já aberta volta ao
                  // topo daquela pilha, que é o que o React Navigation faz por
                  // padrão e o que a pessoa espera.
                  if (!ativo && !evento.defaultPrevented) {
                    navigation.navigate(route.name, route.params)
                  }
                }}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}
              >
                <View
                  style={{
                    width: 52,
                    height: 30,
                    borderRadius: 999,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: ativo ? colors.muted : 'transparent',
                  }}
                >
                  {options.tabBarIcon?.({
                    focused: ativo,
                    color: ativo ? colors.primary : colors.mutedForeground,
                    size: 22,
                  })}
                </View>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, lineHeight: 13 }}
                  className={ativo ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}
                >
                  {rotulo}
                </Text>
              </Pressable>
            )
          })}
        </BlurView>
      </View>
    </View>
  )
}
