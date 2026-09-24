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
  { label, error, icone, acessorio, className, containerClassName, editable = true, style, ...props },
  ref,
) {
  const { colors } = useTheme()
  /*
   * MULTILINHA não cabe na linha de 52px centralizada. A nota da empresa pedia 96px
   * de altura dentro de uma caixa de 52 com `items-center`: o campo vazava para
   * cima e para baixo da borda, e o texto começava fora do lugar. Aqui a caixa
   * cresce com o campo e o texto nasce no topo, como num bloco de notas.
   */
  const multilinha = props.multiline === true

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
          multilinha
            ? 'flex-row items-start rounded-sm border bg-card'
            : 'h-[52px] flex-row items-center rounded-sm border bg-card',
          error ? 'border-destructive' : 'border-input',
          !editable && 'opacity-50',
        )}
      >
        {icone ? <View className={cn('pl-3.5 pr-1', multilinha && 'pt-3.5')}>{icone}</View> : null}

        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          accessibilityLabel={label}
          className={cn(
            multilinha
              ? 'flex-1 px-3.5 py-3 text-[15px] text-foreground'
              : 'h-full flex-1 px-3.5 text-[15px] text-foreground',
            icone ? 'pl-1' : undefined,
            acessorio ? 'pr-0' : undefined,
            className,
          )}
          // A fonte SEMPRE, e o estilo de quem chama por cima dela: antes um
          // `style` vindo da tela substituía este objeto inteiro, e o campo
          // perdia a Poppins sem ninguém pedir.
          style={[
            { fontFamily: 'Poppins_400Regular' },
            multilinha && { textAlignVertical: 'top' },
            style,
          ]}
          {...props}
        />

        {acessorio ? <View className="pr-1">{acessorio}</View> : null}
      </View>

      {error ? <Text variant="destructive">{error}</Text> : null}
    </View>
  )
})
