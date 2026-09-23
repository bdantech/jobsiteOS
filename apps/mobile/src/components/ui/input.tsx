import { forwardRef, type ReactNode } from 'react'
import { TextInput, View, type TextInputProps } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

export interface InputProps extends TextInputProps {
  label?: string
  /** pt-BR message under the field. Also flips the border red. */
  error?: string
  /**
   * Ícone à ESQUERDA, dentro do campo. Decorativo: ele repete o que o rótulo
   * já diz, então não recebe rótulo de acessibilidade próprio — um leitor de
   * tela anunciando "envelope, E-mail corporativo" lê a mesma coisa duas vezes.
   */
  icone?: ReactNode
  /**
   * Controle à DIREITA, dentro do campo (mostrar senha, limpar). Ao contrário
   * do ícone, este é acionável e traz o próprio rótulo.
   */
  acessorio?: ReactNode
  className?: string
  containerClassName?: string
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, icone, acessorio, className, containerClassName, editable = true, ...props },
  ref,
) {
  const { colors } = useTheme()

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? (
        <Text className="text-[13px] font-semibold text-secondary-foreground">{label}</Text>
      ) : null}

      {/*
        O campo é uma LINHA com o input no meio, não um input com padding
        calculado. Com padding, trocar o ícone por um mais largo desalinha o
        texto em silêncio; aqui o layout se ajusta sozinho.
      */}
      <View
        className={cn(
          'h-[52px] flex-row items-center rounded-sm border bg-card',
          error ? 'border-destructive' : 'border-input',
          !editable && 'opacity-50',
        )}
      >
        {icone ? <View className="pl-3.5 pr-1">{icone}</View> : null}

        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          accessibilityLabel={label}
          className={cn(
            'h-full flex-1 px-3.5 text-[15px] text-foreground',
            icone ? 'pl-1' : undefined,
            acessorio ? 'pr-0' : undefined,
            className,
          )}
          style={{ fontFamily: 'Poppins_400Regular' }}
          {...props}
        />

        {acessorio ? <View className="pr-1">{acessorio}</View> : null}
      </View>

      {error ? <Text variant="destructive">{error}</Text> : null}
    </View>
  )
})
