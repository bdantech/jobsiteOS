import { useRouter } from 'expo-router'
import { KeyRound } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { AparenciaCard, ContaCard, NotificacoesCard } from '@/features/auth'
import { useSession } from '@/lib/auth'

/**
 * Conta · Aparência · Notificações · Segurança · Sair.
 *
 * Notifications and the password live behind the Next.js API, not supabase-js:
 * `prefs_notificacoes` and `expo_push_tokens` are not granted to `authenticated`
 * on any row (not even your own), and `must_change_password` has no update grant
 * at all. See src/features/auth/api.ts.
 */
export default function ConfiguracoesScreen() {
  const router = useRouter()
  const { signOut } = useSession()
  const { colors } = useTheme()

  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const [saindo, setSaindo] = useState(false)

  async function sair(): Promise<void> {
    setSaindo(true)
    try {
      // Dropping this device's push token is part of signing out, not part of
      // this screen — signOut() does it for every surface. See src/lib/auth.tsx.
      await signOut()
    } finally {
      setSaindo(false)
      setConfirmandoSaida(false)
    }
  }

  return (
    <>
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-4 p-4 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <ContaCard />

        <AparenciaCard />

        <NotificacoesCard />

        <Card>
          <CardHeader>
            <CardTitle>Segurança</CardTitle>
            <CardDescription>Sua senha de acesso ao JobsiteOS.</CardDescription>
          </CardHeader>

          <CardContent>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alterar senha"
              onPress={() => router.push('/alterar-senha')}
              className="flex-row items-center gap-3 py-2 active:opacity-70"
            >
              <View className="h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                <KeyRound size={18} color={colors.primary} />
              </View>
              <View className="flex-1 gap-1">
                <Text variant="label">Alterar senha</Text>
                <Text variant="muted">Mínimo de 12 caracteres.</Text>
              </View>
            </Pressable>
          </CardContent>
        </Card>

        <Button
          variant="destructive"
          onPress={() => setConfirmandoSaida(true)}
          className="mt-2"
        >
          <Text>Sair</Text>
        </Button>
      </ScrollView>

      <ConfirmDialog
        open={confirmandoSaida}
        onOpenChange={setConfirmandoSaida}
        title="Sair da conta"
        description="Você precisará entrar novamente com seu e-mail e senha. As notificações push deste aparelho serão desativadas."
        confirmLabel="Sair"
        cancelLabel="Cancelar"
        destructive
        loading={saindo}
        onConfirm={() => void sair()}
      />
    </>
  )
}
