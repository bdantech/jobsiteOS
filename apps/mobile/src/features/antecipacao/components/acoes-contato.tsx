import type { CanalToque } from '@jobsiteos/core'
import { Mail, MessageCircle, Phone } from 'lucide-react-native'
import { Linking, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useRegistrarToque } from '../queries'
import type { Contato } from '../types'

/**
 * As ações de UM TOQUE do vendedor na rua (§9).
 *
 * Três decisões que fazem esta barra funcionar de dentro de uma obra:
 *
 * 1. O DESTINATÁRIO É O PONTO FOCAL. A hierarquia é a mesma da outbox — ponto focal
 *    primeiro, senão o primeiro contato com canal válido. Se o app escolhesse
 *    diferente da automação, o vendedor ligaria para uma pessoa e a mensagem
 *    automática iria para outra.
 *
 * 2. O WHATSAPP É `wa.me`, NÃO A API. Abre o app DO PRÓPRIO VENDEDOR, com o número
 *    dele. Nada a ver com as contas de API cadastradas — aquelas são para o disparo
 *    automático do Prompt 05. A mensagem vem pré-preenchida do template da faixa,
 *    para que a conversa manual e a automática digam a mesma coisa.
 *
 * 3. O REGISTRO DO TOQUE NÃO BLOQUEIA A AÇÃO. Discar é o que o usuário pediu;
 *    gravar o evento é o que o sistema precisa. Um 4G ruim não pode impedir a
 *    ligação — o registro é disparado em paralelo e falha em silêncio.
 */

export interface AcoesContatoProps {
  cnpj: string
  contatos: readonly Contato[]
  /** Mensagem sugerida (template da faixa já renderizado) para o WhatsApp. */
  mensagem?: string | null
  accessKey?: string | null
  /** Contato do sacado que veio no payload da NF, usado como último recurso. */
  contatoSacado?: { email?: string | null; phone?: string | null } | null
}

function soDigitos(valor: string | null | undefined): string | null {
  if (!valor) return null
  const d = valor.replace(/\D/g, '')
  return d === '' ? null : d
}

/** Ponto focal primeiro; senão o primeiro contato com o canal preenchido. */
function escolher(
  contatos: readonly Contato[],
  campo: (c: Contato) => string | null,
): { valor: string; nome: string | null } | null {
  const ordenados = [...contatos].sort(
    (a, b) => Number(b.ponto_focal ?? false) - Number(a.ponto_focal ?? false),
  )
  for (const c of ordenados) {
    const v = campo(c)
    if (v) return { valor: v, nome: c.nome }
  }
  return null
}

export function AcoesContato({
  cnpj,
  contatos,
  mensagem,
  accessKey,
  contatoSacado,
}: AcoesContatoProps) {
  const { colors } = useTheme()
  const registrar = useRegistrarToque()

  const telefone =
    escolher(contatos, (c) => soDigitos(c.telefone ?? c.whatsapp)) ??
    (soDigitos(contatoSacado?.phone) ? { valor: soDigitos(contatoSacado?.phone) as string, nome: null } : null)
  const whatsapp =
    escolher(contatos, (c) => soDigitos(c.whatsapp ?? c.telefone)) ??
    (soDigitos(contatoSacado?.phone) ? { valor: soDigitos(contatoSacado?.phone) as string, nome: null } : null)
  const email =
    escolher(contatos, (c) => c.email?.trim() ?? null) ??
    (contatoSacado?.email ? { valor: contatoSacado.email, nome: null } : null)

  function tocar(canal: CanalToque, url: string, contato: string) {
    // Em paralelo, de propósito: o `void` é o que garante que a discagem não espere.
    void registrar.mutateAsync({ cnpj, canal, contato, accessKey }).catch(() => undefined)
    void Linking.openURL(url).catch(() => undefined)
  }

  const nenhum = !telefone && !whatsapp && !email

  if (nenhum) {
    return (
      <View className="rounded-lg border border-dashed border-border p-3">
        <Text variant="muted" className="text-sm">
          Nenhum contato conhecido para este fornecedor. Um lote de contatos no Radar resolve —
          enquanto isso, ele aparece na Outbox como descarte &quot;sem contato&quot;.
        </Text>
      </View>
    )
  }

  return (
    <View className="flex-row gap-2">
      {telefone ? (
        <Button
          className="flex-1"
          variant="default"
          onPress={() => tocar('ligacao', `tel:${telefone.valor}`, telefone.valor)}
          accessibilityLabel={`Ligar para ${telefone.nome ?? 'o fornecedor'}`}
        >
          <Phone size={18} color={colors.primaryForeground} />
          <Text>Ligar</Text>
        </Button>
      ) : null}

      {whatsapp ? (
        <Button
          className="flex-1"
          variant="secondary"
          onPress={() =>
            tocar(
              'whatsapp',
              // wa.me abre o app do PRÓPRIO vendedor. `text` pré-preenche a conversa.
              `https://wa.me/${whatsapp.valor}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`,
              whatsapp.valor,
            )
          }
          accessibilityLabel={`Abrir WhatsApp com ${whatsapp.nome ?? 'o fornecedor'}`}
        >
          <MessageCircle size={18} color={colors.foreground} />
          <Text>WhatsApp</Text>
        </Button>
      ) : null}

      {email ? (
        <Button
          className="flex-1"
          variant="outline"
          onPress={() => tocar('email', `mailto:${email.valor}`, email.valor)}
          accessibilityLabel={`Enviar e-mail para ${email.nome ?? 'o fornecedor'}`}
        >
          <Mail size={18} color={colors.foreground} />
          <Text>E-mail</Text>
        </Button>
      ) : null}
    </View>
  )
}
