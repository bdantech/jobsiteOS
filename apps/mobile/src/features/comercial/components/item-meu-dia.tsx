import { useCallback, useRef, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { useRouter } from 'expo-router'
import { Ban, CalendarClock, Check, ChevronRight } from 'lucide-react-native'
import { blocoCatalogado, type ItemMeuDia } from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const FAIXA: Record<string, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-500',
  baixa: 'bg-slate-300',
}

/** Os dias de adiamento oferecidos. Datepicker em pé, com uma mão, é atrito puro. */
const ADIAMENTOS: { rotulo: string; dias: number }[] = [
  { rotulo: 'Amanhã', dias: 1 },
  { rotulo: 'Depois de amanhã', dias: 2 },
  { rotulo: 'Semana que vem', dias: 7 },
  { rotulo: 'Daqui a 15 dias', dias: 15 },
]

function AcaoSwipe({
  progresso, lado, rotulo, Icone, cor,
}: {
  progresso: Animated.AnimatedInterpolation<number>
  lado: 'esquerda' | 'direita'
  rotulo: string
  Icone: typeof Ban
  cor: string
}) {
  const escala = progresso.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
    extrapolate: 'clamp',
  })

  return (
    <View
      className={cn(
        'my-1 flex-1 justify-center rounded-xl px-5',
        lado === 'direita' ? 'items-start' : 'items-end',
      )}
      style={{ backgroundColor: cor }}
    >
      <Animated.View style={{ transform: [{ scale: escala }] }} className="items-center gap-1">
        <Icone size={20} color="#ffffff" />
        <Text className="text-[11px] font-semibold text-white">{rotulo}</Text>
      </Animated.View>
    </View>
  )
}

/** Para onde o toque leva. O mesmo mapa da web, com as rotas do app. */
export function destinoDoItem(bloco: string, item: ItemMeuDia): string | null {
  const cat = blocoCatalogado(bloco)
  const meta = item.meta as Record<string, string | undefined>
  switch (cat?.acao) {
    case 'abrir_empresa':
    case 'abrir_certificado':
      return item.empresa_id ? `/empresas/${item.empresa_id}` : null
    case 'abrir_card_nf':
      return '/antecipacao'
    case 'abrir_card_venda':
      return '/comercial/vendas'
    case 'abrir_card_lead':
      return '/comercial/sdr'
    case 'abrir_fornecedor':
      return '/comercial/fornecedores'
    case 'decidir_aceite':
      return '/comercial/comissoes'
    case 'abrir_conversa':
    case 'enviar_sugestao':
      return meta.conversa_id ? `/comunicacao/${meta.conversa_id}` : '/comunicacao'
    case 'vincular_conversa':
      return '/comunicacao/nao-vinculadas'
    default:
      return null
  }
}

export interface ItemMeuDiaCardProps {
  item: ItemMeuDia
  bloco: string
  onAdiar: (dias: number) => void
  onDescartar: () => void
  onConcluir: () => void
}

/**
 * Um item da lista de trabalho, no celular.
 *
 * O SWIPE é a ação secundária, e é o que torna a tela usável em pé: arrastar para a
 * direita adia, para a esquerda descarta. A ação PRIMÁRIA é o toque — que abre a tela
 * onde o trabalho acontece.
 *
 * Adiar abre uma folha com quatro opções em vez de um calendário: escolher uma data
 * exata com uma mão, no metrô, é o tipo de atrito que faz a pessoa simplesmente não
 * adiar — e um item que não pode ser adiado acaba sendo ignorado, que é pior.
 */
export function ItemMeuDiaCard({ item, bloco, onAdiar, onDescartar, onConcluir }: ItemMeuDiaCardProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const [adiarAberto, setAdiarAberto] = useState(false)

  const cat = blocoCatalogado(bloco)
  const rota = destinoDoItem(bloco, item)
  const ehTarefa = cat?.acao === 'concluir_tarefa'

  const fechar = useCallback(() => swipeRef.current?.close(), [])

  const abrir = useCallback(() => {
    if (ehTarefa) return onConcluir()
    if (rota) router.push(rota)
  }, [ehTarefa, onConcluir, rota, router])

  return (
    <>
      <Swipeable
        ref={swipeRef}
        overshootLeft={false}
        overshootRight={false}
        leftThreshold={72}
        rightThreshold={72}
        renderLeftActions={(progresso) => (
          <AcaoSwipe
            progresso={progresso}
            lado="direita"
            rotulo={ehTarefa ? 'Concluir' : 'Adiar'}
            Icone={ehTarefa ? Check : CalendarClock}
            cor={colors.primary}
          />
        )}
        renderRightActions={(progresso) => (
          <AcaoSwipe
            progresso={progresso}
            lado="esquerda"
            rotulo="Não é relevante"
            Icone={Ban}
            cor={colors.destructive}
          />
        )}
        onSwipeableOpen={(direcao) => {
          fechar()
          if (direcao === 'left') {
            if (ehTarefa) onConcluir()
            else setAdiarAberto(true)
          } else {
            onDescartar()
          }
        }}
      >
        <Pressable
          onPress={abrir}
          accessibilityRole="button"
          accessibilityLabel={`${item.titulo}. ${item.motivo}`}
          className="flex-row overflow-hidden rounded-xl border border-border bg-card active:opacity-70"
        >
          <View className={cn('w-1', FAIXA[item.urgencia] ?? FAIXA.baixa)} />
          <View className="flex-1 gap-1 p-3">
            <View className="flex-row items-start justify-between gap-2">
              <Text numberOfLines={1} className="flex-1 font-medium">
                {item.titulo}
              </Text>
              {item.valor !== null && item.valor > 0 ? (
                <Text className="text-sm font-semibold">{brl(item.valor)}</Text>
              ) : null}
            </View>

            {item.subtitulo ? (
              <Text numberOfLines={1} variant="muted" className="text-xs">
                {item.subtitulo}
              </Text>
            ) : null}

            <View className="flex-row items-center justify-between gap-2 pt-0.5">
              <Text numberOfLines={2} variant="muted" className="flex-1 text-xs">
                {item.motivo}
              </Text>
              <ChevronRight size={14} color={colors.mutedForeground} />
            </View>
          </View>
        </Pressable>
      </Swipeable>

      <Sheet
        open={adiarAberto}
        onOpenChange={setAdiarAberto}
        title="Adiar até quando?"
        description="O item some da lista e volta sozinho na data. Ele não sai do funil — só do seu dia."
      >
        <View className="gap-2">
          {ADIAMENTOS.map((op) => (
            <Pressable
              key={op.dias}
              onPress={() => {
                setAdiarAberto(false)
                onAdiar(op.dias)
              }}
              className="rounded-lg border border-border p-3 active:opacity-70"
            >
              <Text className="font-medium">{op.rotulo}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  )
}
