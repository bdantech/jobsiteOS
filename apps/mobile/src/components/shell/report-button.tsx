import { MessageSquareWarning } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'

import { ReportSheet } from '@/features/reports'
import { cn } from '@/lib/utils'

/**
 * O botão de reportar, ao lado do sino em todo header (04m §2/§6).
 *
 * Sem guard de módulo — ao contrário do sino, que some para quem não tem o módulo
 * `notificacoes` porque não haveria tela para onde ir. Reportar é direito de
 * qualquer usuário ativo, e o sheet abre por cima da tela atual: não há rota a
 * conceder.
 */
export function ReportButton({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reportar bug ou melhoria"
        onPress={() => setAberto(true)}
        hitSlop={8}
              /*
       * Este botão vive SEMPRE sobre o navy do cabeçalho, então ele não lê
       * `colors`: um ícone em `foreground` aqui seria quase invisível no tema
       * claro e sumiria de vez no escuro, onde `foreground` é quase branco...
       * sobre um fundo que também não muda. Cor fixa é o que descreve a
       * verdade desta superfície.
       */
      className={cn(
        'size-11 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] active:opacity-70',
        className,
      )}
      >
        <MessageSquareWarning size={20} color="#FFFFFF" />
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
