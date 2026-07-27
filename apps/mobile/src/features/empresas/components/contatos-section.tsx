import type { Tables } from '@jobsiteos/core'
import { Mail, MessageCircle, Phone, Star, UserRound } from 'lucide-react-native'
import { Linking, Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { mensagemDeErro, useDefinirPontoFocal } from '@/features/antecipacao/queries'
import { cn } from '@/lib/utils'

/**
 * Contatos da empresa, com a curadoria do PONTO FOCAL (Antecipação §3.2).
 *
 * A estrela existe porque "melhor contato disponível" é heurística, e heurística
 * escolhe o estagiário do financeiro quando ele é o único com e-mail preenchido.
 * Marcar o ponto focal é um humano dizendo "fale com esta pessoa" — e a partir daí
 * a outbox e os botões de contato do funil respeitam isso.
 *
 * No máximo um por empresa (índice parcial único). Marcar outro desmarca o anterior
 * na MESMA transação, dentro do RPC: fazer isso em duas chamadas deixaria uma janela
 * em que a segunda falha e a empresa fica sem ponto focal nenhum.
 */
export interface ContatosSectionProps {
  contatos: readonly Tables<'contatos'>[]
}

function soDigitos(valor: string | null | undefined): string | null {
  if (!valor) return null
  const d = valor.replace(/\D/g, '')
  return d === '' ? null : d
}

export function ContatosSection({ contatos }: ContatosSectionProps) {
  const { colors } = useTheme()
  const definir = useDefinirPontoFocal()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contatos</CardTitle>
        <Text variant="muted">
          O ponto focal é quem toda abordagem procura primeiro. Só um por empresa.
        </Text>
      </CardHeader>

      <CardContent className="gap-3">
        {contatos.length === 0 ? (
          <View className="items-center gap-2 py-6">
            <UserRound size={24} color={colors.mutedForeground} />
            <Text variant="muted" className="text-center text-sm">
              Nenhum contato conhecido. Eles chegam pelo enriquecimento do Radar ou por importação
              de lista.
            </Text>
          </View>
        ) : (
          contatos.map((c) => {
            const tel = soDigitos(c.telefone)
            const wa = soDigitos(c.whatsapp ?? c.telefone)
            const salvando = definir.isPending && definir.variables?.id === c.id

            return (
              <View
                key={c.id}
                className={cn(
                  'gap-2 rounded-lg border p-3',
                  c.ponto_focal ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-border',
                )}
              >
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1 gap-0.5">
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Text className="font-medium">{c.nome ?? 'Sem nome'}</Text>
                      {c.ponto_focal ? (
                        <Badge variant="secondary">
                          <Text className="text-[10px]">Ponto focal</Text>
                        </Badge>
                      ) : null}
                    </View>
                    {c.cargo ? (
                      <Text variant="muted" className="text-xs">
                        {c.cargo}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: c.ponto_focal }}
                    accessibilityLabel={
                      c.ponto_focal ? 'Remover como ponto focal' : 'Definir como ponto focal'
                    }
                    disabled={definir.isPending}
                    onPress={() => definir.mutate({ id: c.id, pontoFocal: !c.ponto_focal })}
                    className="rounded-full p-2 active:opacity-60"
                  >
                    <Star
                      size={20}
                      color={c.ponto_focal ? '#d97706' : colors.mutedForeground}
                      fill={c.ponto_focal ? '#d97706' : 'transparent'}
                      opacity={salvando ? 0.4 : 1}
                    />
                  </Pressable>
                </View>

                {/* Os canais são links de verdade: no celular, um telefone que não
                    disca é um telefone que ninguém usa. */}
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  {c.email ? (
                    <Pressable
                      onPress={() => void Linking.openURL(`mailto:${c.email}`)}
                      accessibilityRole="link"
                      accessibilityLabel={`Enviar e-mail para ${c.email}`}
                      className="flex-row items-center gap-1 active:opacity-60"
                    >
                      <Mail size={12} color={colors.mutedForeground} />
                      <Text variant="muted" className="text-xs">
                        {c.email}
                      </Text>
                    </Pressable>
                  ) : null}

                  {tel ? (
                    <Pressable
                      onPress={() => void Linking.openURL(`tel:${tel}`)}
                      accessibilityRole="link"
                      accessibilityLabel={`Ligar para ${c.telefone}`}
                      className="flex-row items-center gap-1 active:opacity-60"
                    >
                      <Phone size={12} color={colors.mutedForeground} />
                      <Text variant="muted" className="text-xs">
                        {c.telefone}
                      </Text>
                    </Pressable>
                  ) : null}

                  {wa ? (
                    <Pressable
                      onPress={() => void Linking.openURL(`https://wa.me/${wa}`)}
                      accessibilityRole="link"
                      accessibilityLabel="Abrir conversa no WhatsApp"
                      className="flex-row items-center gap-1 active:opacity-60"
                    >
                      <MessageCircle size={12} color={colors.mutedForeground} />
                      <Text variant="muted" className="text-xs">
                        WhatsApp
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )
          })
        )}

        {definir.isError ? <Text variant="destructive">{mensagemDeErro(definir.error)}</Text> : null}
      </CardContent>
    </Card>
  )
}
