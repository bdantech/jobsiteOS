import { alterarSenhaSchema } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { alterarSenha, erroDoCampo, mensagemDeErro } from '@/features/auth'
import { useSession } from '@/lib/auth'

interface FieldErrors {
  senha?: string
  confirmacao?: string
}

/**
 * Two screens in one, distinguished by `must_change_password`:
 *
 *  - FORCED: the root gate holds every other route out of reach until the
 *    temporary password (which was emailed — a low-trust channel) is replaced.
 *    No back gesture, no header, no skip. The only other way out is signing out.
 *  - VOLUNTARY: reached from Configurações. Cancellable, and pops on success.
 *
 * The change is ONE backend call. It is emphatically not "change the password
 * with supabase-js, then ask the server to clear the flag": that shape needs a
 * bare clear-my-flag endpoint, and anyone holding the temporary password could
 * call it directly, skip the rotation, and keep that password alive forever. The
 * server rotates the password itself and clears the flag only as a consequence.
 */
export default function AlterarSenhaScreen() {
  const { usuario, refresh, signOut } = useSession()
  const router = useRouter()

  const forced = usuario?.must_change_password === true

  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const confirmacaoRef = useRef<TextInput>(null)

  async function onSubmit(): Promise<void> {
    if (loading) return
    setFormError(null)

    const parsed = alterarSenhaSchema.safeParse({ senha, confirmacao })
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors({ senha: flat.senha?.[0], confirmacao: flat.confirmacao?.[0] })
      return
    }

    setFieldErrors({})
    setLoading(true)

    try {
      await alterarSenha(parsed.data)

      // Re-read `usuarios`: the flag is what the gate watches. In the forced flow
      // this is what lifts the wall.
      await refresh()

      setSenha('')
      setConfirmacao('')

      // Forced: the gate moves us the moment the flag clears. Voluntary: nothing
      // moves on its own, so pop back to Configurações.
      if (!forced && router.canGoBack()) router.back()
    } catch (error) {
      // The server re-validates with the same zod schema, and rejects a "new"
      // password that is really the current one — surface that on the field.
      const doCampo = erroDoCampo(error, 'senha')
      if (doCampo) {
        setFieldErrors({ senha: doCampo })
      } else {
        setFormError(
          mensagemDeErro(error, 'Não foi possível alterar a senha. Tente novamente.'),
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center gap-8 px-6 py-12"
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <Text variant="title">
              {forced ? 'Defina uma nova senha' : 'Alterar senha'}
            </Text>
            <Text variant="muted">
              {forced
                ? 'Sua senha atual é temporária. Escolha uma nova para continuar.'
                : 'Escolha uma nova senha para sua conta.'}
            </Text>
          </View>

          <View className="gap-4">
            <Input
              label="Nova senha"
              value={senha}
              onChangeText={setSenha}
              error={fieldErrors.senha}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              placeholder="Mínimo 12 caracteres"
              editable={!loading}
              returnKeyType="next"
              onSubmitEditing={() => confirmacaoRef.current?.focus()}
              submitBehavior="submit"
            />

            <Input
              ref={confirmacaoRef}
              label="Confirme a nova senha"
              value={confirmacao}
              onChangeText={setConfirmacao}
              error={fieldErrors.confirmacao}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!loading}
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
            />

            <Text variant="muted">
              Use ao menos 12 caracteres, com letra maiúscula, letra minúscula e número.
            </Text>

            {formError ? (
              <Text variant="destructive" accessibilityLiveRegion="polite">
                {formError}
              </Text>
            ) : null}

            <Button onPress={() => void onSubmit()} loading={loading} className="mt-2">
              <Text>Salvar nova senha</Text>
            </Button>

            {forced ? (
              <Button variant="ghost" onPress={() => void signOut()} disabled={loading}>
                <Text>Sair</Text>
              </Button>
            ) : (
              <Button
                variant="ghost"
                onPress={() => {
                  if (router.canGoBack()) router.back()
                }}
                disabled={loading}
              >
                <Text>Cancelar</Text>
              </Button>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
