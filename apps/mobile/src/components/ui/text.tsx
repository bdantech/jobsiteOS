import { createContext, useContext } from 'react'
import { Text as RNText, type TextProps as RNTextProps } from 'react-native'

import { cn } from '@/lib/utils'

/**
 * Lets a parent (Button, Badge, Card…) set the text colour/size of any <Text>
 * inside it without every call site repeating the classes — the RN stand-in for
 * CSS inheritance, which RN does not have.
 */
export const TextClassContext = createContext<string | undefined>(undefined)

export type TextVariant = 'default' | 'muted' | 'title' | 'heading' | 'label' | 'destructive'

const VARIANTS: Record<TextVariant, string> = {
  default: 'text-base text-foreground',
  muted: 'text-sm text-muted-foreground',
  // `font-display` = Manrope. Título de TELA, não de seção — ver a nota abaixo.
  title: 'font-display text-[26px] leading-[34px] tracking-tight text-foreground',
  heading: 'text-lg font-semibold text-foreground',
  label: 'text-sm font-medium text-foreground',
  destructive: 'text-sm text-destructive',
}

export interface TextProps extends RNTextProps {
  variant?: TextVariant
  className?: string
}

export function Text({ variant = 'default', className, ...props }: TextProps) {
  const inherited = useContext(TextClassContext)

  /*
   * A família NÃO é escolhida aqui: os utilitários `font-*` do Tailwind já
   * apontam para o arquivo do peso certo (ver o plugin em tailwind.config.js).
   * Uma segunda régua neste componente daria duas respostas para a mesma
   * pergunta, e a que ganharia dependeria da ordem de merge do NativeWind.
   */
  return <RNText className={cn('font-normal', VARIANTS[variant], inherited, className)} {...props} />
}
