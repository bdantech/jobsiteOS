import { MailCheck } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { api, ApiError } from '@/lib/api'

/**
 * "Esqueci minha senha" (0262): pede o link por e-mail.
 *
 * O link abre na WEB, que é onde a senha nova é criada — a mesma tela de troca
 * obrigatória, com a mesma régua. Depois disso a pessoa entra aqui com a senha nova.
 * A resposta é sempre a mesma frase, exista ou não a conta: a rota não diz quais
 * e-mails têm acesso.
 */
export function EsqueciSenhaSheet({
  open,
  onOpenChange,
  emailInicial,
}: {
  open: boolean
  onOpenChange: (aberto: boolean) => void
  emailInicial: string
}) {
  const { colors } = useTheme()
  const [email, setEmail] = useState(emailInicial)
  const [enviando, setEnviando] = useState(false)
  const [resposta, setResposta] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setErro(null)
    setEnviando(true)
    try {
      const r = await api<{ mensagem?: string }>('/api/auth/esqueci-senha', {
        method: 'POST',
        body: { email: email.trim() },
      })
      setResposta(r.mensagem ?? 'Se houver uma conta com este e-mail, enviamos o link.')
    } catch (e) {
      setErro(
        e instanceof ApiError && e.status === 400
          ? 'Informe um e-mail válido.'
          : 'Não foi possível pedir o link. Confira a conexão e tente de novo.',
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(aberto) => {
        onOpenChange(aberto)
        if (!aberto) {
          setResposta(null)
          setErro(null)
        }
      }}
      title="Esqueci minha senha"
      description="Enviamos um link para você criar uma nova senha."
    >
      {resposta ? (
        <View className="gap-4">
          <View className="flex-row items-start gap-2.5 rounded-md border border-border bg-muted px-3.5 py-3">
            <MailCheck size={18} color={colors.primary} />
            <Text className="flex-1 text-sm">{resposta} Confira também a caixa de spam.</Text>
          </View>
          <Button variant="outline" onPress={() => onOpenChange(false)}>
            <Text>Voltar ao login</Text>
          </Button>
        </View>
      ) : (
        <View className="gap-4">
          <Input
            label="E-mail corporativo"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="nome@oneos.com.br"
            error={erro ?? undefined}
            editable={!enviando}
          />
          <Button onPress={() => void enviar()} loading={enviando} disabled={!email.trim()}>
            <Text>Enviar link</Text>
          </Button>
        </View>
      )}
    </Sheet>
  )
}
