import { ChevronRight, MessageSquareWarning } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Text } from '@/components/ui/text'
import { ReportSheet } from '@/features/reports'

/**
 * Reportar bug ou melhoria (04m §2/§6) — uma linha na aba "Mais".
 *
 * Morava no cabeçalho de toda tela, ao lado do sino. Saiu porque reportar é coisa
 * que se faz de vez em quando, e um botão permanente no topo disputava espaço com
 * o título e a lupa a cada tela. "Mais" é onde a pessoa cuida da conta e do app —
 * é o lugar natural de "algo aqui não está certo".
 *
 * Sem guard de módulo: reportar é direito de qualquer usuário ativo, e o sheet abre
 * por cima da tela atual — não há rota a conceder.
 */
export function ReportButton() {
  const [aberto, setAberto] = useState(false)
  const { colors } = useTheme()

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reportar bug ou melhoria"
        onPress={() => setAberto(true)}
        className="h-[52px] flex-row items-center gap-2.5 rounded-md border border-border bg-card px-4 active:opacity-70"
      >
        <MessageSquareWarning size={20} color={colors.primary} />
        <Text className="flex-1 text-[15px] font-semibold text-foreground">
          Reportar bug ou melhoria
        </Text>
        <ChevronRight size={18} color={colors.mutedForeground} />
      </Pressable>

      {/*
        Montado SEMPRE, e não só quando abre. Duas razões: a animação de saída do
        <Sheet> precisa do componente vivo para rodar, e o rascunho do formulário
        sobrevive a um toque fora do painel — perder três parágrafos assim é como
        alguém desiste de reportar. Nada é consultado enquanto fechado: o <Sheet>
        devolve null e os filhos nem chegam a renderizar.
      */}
      <ReportSheet open={aberto} onOpenChange={setAberto} />
    </>
  )
}
