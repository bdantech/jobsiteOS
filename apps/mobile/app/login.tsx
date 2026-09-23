import { loginSchema } from '@jobsiteos/core'
import { StatusBar } from 'expo-status-bar'
import { AlertCircle, Eye, EyeOff, Lock, Mail } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
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
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const { colors } = useTheme()

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
    <View className="flex-1 bg-card">
      <StatusBar style="light" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/*
            O HERO NAVY, que é metade desta tela.
            
            Ele é a única superfície de marca do app inteiro — depois do login a
            navy vira só cabeçalho. Por isso aqui ela ocupa 336px e leva o nome
            em Manrope 46: é o único momento em que a marca fala antes do
            produto.
          */}
          <View className="h-[336px] bg-brand px-6 pb-[52px] pt-[72px]">
            <View className="flex-row items-center gap-2.5">
              <View className="size-9 items-center justify-center rounded-md bg-card">
                <Text className="font-extrabold text-[15px] text-brand">1</Text>
              </View>
              <Text className="text-[13px] font-medium text-[#CBD5E1]">
                Ferramenta interna Oneos
              </Text>
            </View>

            <View className="mt-auto gap-2.5">
              <Text className="font-display text-[46px] leading-[47px] tracking-tighter text-white">
                JobsiteOS
              </Text>
              <Text className="max-w-[300px] text-[15px] leading-[22px] text-[#CBD5E1]">
                Inteligência e automação para o nosso crescimento em um só lugar.
              </Text>
            </View>
          </View>

          {/*
            A FOLHA que sobe por cima do hero. O -24 é o que cria a dobra: sem
            ele o cartão encosta no navy e a tela vira duas faixas empilhadas.
          */}
          <View className="-mt-6 flex-1 gap-6 rounded-t-2xl bg-card px-6 pb-11 pt-8">
            <View className="gap-1.5">
              <Text className="text-2xl font-extrabold leading-7 tracking-tight text-foreground">
                Entrar
              </Text>
              <Text className="text-sm leading-[21px] text-secondary-foreground">
                Use seu e-mail corporativo para acessar.
              </Text>
            </View>

            {/*
              O erro do FORMULÁRIO vira caixa, não linha solta.
              
              Ele fala da tentativa inteira ("e-mail ou senha incorretos"), não
              de um campo — mostrá-lo como legenda embaixo da senha fazia a
              pessoa procurar o defeito no campo errado.
            */}
            {formError ? (
              <View className="flex-row items-start gap-2.5 rounded-md border border-[#EBC9C9] bg-[#FBEFEF] px-3.5 py-3">
                <AlertCircle size={18} color="#B33A3A" style={{ marginTop: 1 }} />
                <Text
                  accessibilityLiveRegion="polite"
                  className="flex-1 text-[13px] leading-[19px] text-[#8A2C2C]"
                >
                  {formError}
                </Text>
              </View>
            ) : null}

            <View className="gap-4">
              <Input
                label="E-mail corporativo"
                value={email}
                onChangeText={setEmail}
                error={fieldErrors.email}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="nome@oneos.com.br"
                icone={<Mail size={20} color={colors.mutedForeground} />}
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
                secureTextEntry={!mostrarSenha}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                placeholder="Digite sua senha"
                icone={<Lock size={20} color={colors.mutedForeground} />}
                editable={!loading}
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
                acessorio={
                  <Pressable
                    onPress={() => setMostrarSenha((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    hitSlop={8}
                    className="size-11 items-center justify-center"
                  >
                    {mostrarSenha ? (
                      <EyeOff size={20} color={colors.secondaryForeground} />
                    ) : (
                      <Eye size={20} color={colors.secondaryForeground} />
                    )}
                  </Pressable>
                }
              />

              <Button onPress={() => void onSubmit()} loading={loading} className="mt-1 h-[52px]">
                <Text>Entrar</Text>
              </Button>
            </View>

            <View className="mt-auto items-center gap-1 pt-2">
              <Text className="text-[13px] text-secondary-foreground">
                Problemas para acessar? Fale com um administrador.
              </Text>
              <Text className="text-xs text-muted-foreground">Oneos · v2.4.0</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
