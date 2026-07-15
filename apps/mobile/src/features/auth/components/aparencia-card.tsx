import { Check } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Text } from '@/components/ui/text'
import type { ThemePreference } from '@/store/color-scheme'

const OPCOES: { value: ThemePreference; label: string; descricao: string }[] = [
  { value: 'system', label: 'Seguir o sistema', descricao: 'Acompanha o tema do aparelho.' },
  { value: 'light', label: 'Claro', descricao: 'Sempre no tema claro.' },
  { value: 'dark', label: 'Escuro', descricao: 'Sempre no tema escuro.' },
]

/**
 * The preference is persisted (zustand + AsyncStorage) and pushed into NativeWind
 * by ColorSchemeProvider — the switch takes effect on the next frame, with no
 * reload, and survives a cold start.
 */
export function AparenciaCard() {
  const { colors, preference, setPreference } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>Como o aplicativo deve se parecer.</CardDescription>
      </CardHeader>

      <CardContent className="gap-0">
        {OPCOES.map((opcao, index) => {
          const selecionada = preference === opcao.value

          return (
            <View key={opcao.value}>
              {index > 0 ? <Separator /> : null}

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: selecionada }}
                accessibilityLabel={opcao.label}
                onPress={() => setPreference(opcao.value)}
                className="flex-row items-center justify-between gap-4 py-3 active:opacity-70"
              >
                <View className="flex-1 gap-1">
                  <Text variant="label">{opcao.label}</Text>
                  <Text variant="muted">{opcao.descricao}</Text>
                </View>

                {selecionada ? <Check size={20} color={colors.primary} /> : null}
              </Pressable>
            </View>
          )
        })}
      </CardContent>
    </Card>
  )
}
