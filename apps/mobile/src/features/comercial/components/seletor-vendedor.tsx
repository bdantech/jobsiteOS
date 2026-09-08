import { Check, ChevronDown, Users } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import type { VendedorVisivel } from '../index'

export interface SeletorVendedorProps {
  vendedores: readonly VendedorVisivel[]
  /** `null` = o próprio usuário (o padrão da RPC). */
  valor: string | null
  onChange: (vendedorId: string | null) => void
  /** Nome de quem está sendo exibido, vindo do resumo já carregado. */
  nomeAtual: string | null
  /** O usuário tem cadastro de vendedor próprio? Gestor puro não tem. */
  temPainelProprio: boolean
}

/**
 * De quem é o painel que está na tela.
 *
 * ── Por que um sheet, e não os chips de filtro ──────────────────────────────
 * Isto não é um filtro: é uma troca de SUJEITO. O painel inteiro passa a falar de
 * outra pessoa, e o cabeçalho precisa dizer de quem ele fala mesmo quando há uma
 * opção só. Uma faixa de chips com quinze nomes roláveis também não responderia
 * "quem estou vendo agora" sem rolar até achar o ativo.
 *
 * ── Quem vê isto ────────────────────────────────────────────────────────────
 * Só quem tem mais de uma pessoa visível. `comercial_vendedores_visiveis` já
 * resolve isso no banco: um vendedor comum recebe uma lista de um e a tela nem
 * monta o seletor — ele continua vendo exatamente o que via.
 *
 * A opção "Meu painel" só existe para quem TEM cadastro de vendedor. Um gestor
 * puro não tem painel próprio (a RPC devolve `sem_vendedor`), e oferecer a ele um
 * item que abre uma tela vazia seria oferecer um beco.
 */
export function SeletorVendedor({
  vendedores,
  valor,
  onChange,
  nomeAtual,
  temPainelProprio,
}: SeletorVendedorProps) {
  const [aberto, setAberto] = useState(false)
  const { colors } = useTheme()

  const rotulo = nomeAtual ?? (valor === null ? 'Meu painel' : 'Escolher pessoa')

  function escolher(id: string | null): void {
    onChange(id)
    setAberto(false)
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Painel de ${rotulo}. Trocar de pessoa.`}
        onPress={() => setAberto(true)}
        className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 active:opacity-70"
      >
        <Users size={18} color={colors.mutedForeground} />
        <View className="flex-1">
          <Text variant="muted" className="text-xs">
            Painel de
          </Text>
          <Text variant="label" numberOfLines={1}>
            {rotulo}
          </Text>
        </View>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Pressable>

      <Sheet
        open={aberto}
        onOpenChange={setAberto}
        title="Ver o painel de"
        description="Você enxerga as pessoas da sua equipe."
      >
        {/* maxHeight para a lista rolar dentro do sheet quando a equipe é grande,
            em vez de o sheet crescer até bater no teto de 90% e cortar o último. */}
        <ScrollView className="max-h-96" keyboardShouldPersistTaps="handled">
          <View className="gap-1 pb-2">
            {temPainelProprio ? (
              <Linha
                label="Meu painel"
                selecionado={valor === null}
                onPress={() => escolher(null)}
              />
            ) : null}

            {vendedores.map((v) => (
              <Linha
                key={v.id}
                label={v.nome}
                marca={v.is_ia ? 'IA' : null}
                selecionado={valor === v.id}
                onPress={() => escolher(v.id)}
              />
            ))}
          </View>
        </ScrollView>
      </Sheet>
    </>
  )
}

function Linha({
  label,
  marca,
  selecionado,
  onPress,
}: {
  label: string
  marca?: string | null
  selecionado: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selecionado }}
      accessibilityLabel={label}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-lg px-3 py-3 active:opacity-70',
        selecionado && 'bg-muted',
      )}
    >
      <Text className={cn('flex-1', selecionado && 'font-semibold')} numberOfLines={1}>
        {label}
      </Text>

      {marca ? (
        <Badge variant="secondary">
          <Text>{marca}</Text>
        </Badge>
      ) : null}

      {selecionado ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  )
}
