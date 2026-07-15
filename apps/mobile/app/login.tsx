import { loginSchema } from '@jobsiteos/core'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'

interface FieldErrors {
  email?: string
  senha?: string
}

/**
 * The only way into the app. No sign-up and no OAuth, on purpose: accounts are
 * created by an admin (Supabase Admin API, server-side), which is what keeps the
 * user list a closed set.
 *
 * On success this screen does NOT navigate. The session change wakes the root
 * gate, which decides between /alterar-senha and the tabs — putting that decision
 * here would mean two places could disagree about it.
 */
export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const senhaRef = useRef<TextInput>(null)

  async function onSubmit(): Promise<void> {
    if (loading) return
    setFormError(null)

    const parsed = loginSchema.safeParse({ email: email.trim(), senha })
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors({ email: flat.email?.[0], senha: flat.senha?.[0] })
      return
    }

    setFieldErrors({})
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.senha,
      })

      if (error || !data.user) {
        // Never distinguish "unknown e-mail" from "wrong password": the difference
        // is an account-enumeration oracle.
        setFormError('E-mail ou senha inválidos.')
        return
      }

      // A deactivated user still authenticates — GoTrue knows nothing about
      // `usuarios.ativo` — and RLS would then deny them every table, leaving them
      // in an app-shaped shell of empty states. SessionProvider signs them out
      // for exactly this reason, but silently; the sign-out has to come with an
      // explanation, and this is the only screen that can give one.
      const { data: conta, error: contaError } = await supabase
        .from('usuarios')
        .select('ativo')
        .eq('id', data.user.id)
        .maybeSingle()

      if (contaError || !conta) {
        // Either the profile row is missing (auth user never linked) or the
        // provider's own check already tore the session down underneath us.
        await supabase.auth.signOut()
        setFormError('Não foi possível concluir o login. Fale com um administrador.')
        return
      }

      if (!conta.ativo) {
        await supabase.auth.signOut()
        setSenha('')
        setFormError('Sua conta foi desativada. Fale com um administrador.')
        return
      }

      // Authenticated and active: the root gate takes it from here.
    } catch {
      setFormError('Não foi possível entrar. Verifique sua conexão e tente novamente.')
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
            <Text variant="title">JobsiteOS</Text>
            <Text variant="muted">Entre com sua conta ONE OS para continuar.</Text>
          </View>

          <View className="gap-4">
            <Input
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              error={fieldErrors.email}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="voce@oneos.com.br"
              editable={!loading}
              returnKeyType="next"
              onSubmitEditing={() => senhaRef.current?.focus()}
              submitBehavior="submit"
            />

            <Input
              ref={senhaRef}
              label="Senha"
              value={senha}
              onChangeText={setSenha}
              error={fieldErrors.senha}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              placeholder="••••••••"
              editable={!loading}
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
            />

            {formError ? (
              <Text variant="destructive" accessibilityLiveRegion="polite">
                {formError}
              </Text>
            ) : null}

            <Button onPress={() => void onSubmit()} loading={loading} className="mt-2">
              <Text>Entrar</Text>
            </Button>
          </View>

          <Text variant="muted" className="text-center">
            Esqueceu a senha? Fale com um administrador.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
