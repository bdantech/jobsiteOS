import { Stack } from 'expo-router'
import type { ReactNode } from 'react'

import { useTheme } from '@/components/color-scheme-provider'
import { opcoesDePilha } from '@/components/shell/cabecalho-de-vidro'
import { HeaderActions } from '@/components/shell/header-actions'

export interface ModuleStackProps {
  /** The module's <Stack.Screen> declarations. */
  children?: ReactNode
  /** Sino + botão de reportar no headerRight. Off inside the notificações module itself. */
  bell?: boolean
}

/**
 * The per-module navigator. Every module folder under app/(tabs) renders one of
 * these instead of a raw <Stack>, which is what makes the module chrome uniform:
 * o cabeçalho de vidro (ver `cabecalho-de-vidro.tsx`), o fundo da cena, e as
 * ações de header em toda tela que o módulo empilha.
 *
 * A tarja de beta morava aqui, no `screenLayout`, como faixa acima de cada tela.
 * Com o cabeçalho flutuando sobre a cena ela ficaria POR BAIXO do vidro; agora
 * ela é desenhada dentro do próprio cabeçalho.
 */
export function ModuleStack({ children, bell = true }: ModuleStackProps) {
  const { colors } = useTheme()

  return (
    <Stack
      screenOptions={{
        ...opcoesDePilha(colors),
        headerRight: bell ? () => <HeaderActions /> : undefined,
      }}
    >
      {children}
    </Stack>
  )
}
