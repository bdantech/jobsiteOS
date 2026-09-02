import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  urgenciaDe,
  valorLiquidoEstimado,
  type EstagioFunil,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ArrowRight, Ban, Files, Gavel } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import {
  FAIXA_CHIP,
  FAIXA_CHIP_TEXTO,
  TIPAGEM_CHIP,
  TIPAGEM_CHIP_TEXTO,
  URGENCIA_TEXTO,
  creditoVariant,
  formatarMoeda,
  labelCredito,
  textoPrazo,
} from '../format'
import type { FornecedorFunil, NotaFunil } from '../types'
import { MoverEstagioSheet } from './mover-estagio-sheet'
import { NotaDocumentoSheet } from './nota-documento-sheet'
import { SemInteresseSheet } from './sem-interesse-sheet'

/**
 * O card do funil no celular, desenhado para AÇÃO IMEDIATA (§9).
 *
 * A hierarquia visual é a ordem em que um vendedor decide: fornecedor (com quem
 * falo?), valor agrupado (vale a ligação?), prazo com cor (é urgente?), sacado +
 * crédito (vai passar?).
 *
 * SWIPE, não menu: com o telefone na mão, o polegar alcança a borda do card e não
 * um "…" de 24px. Direita move estágio, esquerda marca sem interesse — e as duas
 * abrem uma folha, porque as duas exigem uma escolha (qual estágio; 90 dias ou
 * eterna) e um motivo. Um swipe que executa direto seria irreversível por acidente.
 */

export interface NotaCardProps {
  nota: NotaFunil
  fornecedor?: FornecedorFunil
  minimoOperavel: number
}

function Chip({ children, className, textClassName }: { children: string; className: string; textClassName: string }) {
  return (
    <View className={cn('rounded-full px-2 py-0.5', className)}>
      <Text className={cn('text-[11px] font-medium', textClassName)}>{children}</Text>
    </View>
  )
}

/** O painel que aparece atrás do card durante o gesto. */
function AcaoSwipe({
  progresso,
  lado,
  rotulo,
  Icone,
  cor,
}: {
  progresso: Animated.AnimatedInterpolation<number>
  lado: 'esquerda' | 'direita'
  rotulo: string
  Icone: typeof ArrowRight
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

export function NotaCard({ nota, fornecedor, minimoOperavel }: NotaCardProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const [moverAberto, setMoverAberto] = useState(false)
  const [semInteresseAberto, setSemInteresseAberto] = useState(false)
  const [documentoAberto, setDocumentoAberto] = useState(false)

  const urgencia = urgenciaDe(nota.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1
  const valorAgrupado = fornecedor?.valor_total ?? nota.valor
  const liquido = valorLiquidoEstimado(nota.valor, nota.receita_esperada)

  const fechar = useCallback(() => swipeRef.current?.close(), [])

  const abrirFornecedor = useCallback(() => {
    if (nota.fornecedor_cnpj) router.push(`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`)
  }, [router, nota.fornecedor_cnpj])

  const abrirDocumento = useCallback(() => setDocumentoAberto(true), [])

  // O próximo estágio "natural" — o que o swipe para a direita sugere primeiro.
  const indiceAtual = ESTAGIOS_ABERTOS.indexOf(nota.estagio_funil as (typeof ESTAGIOS_ABERTOS)[number])
  const proximo: EstagioFunil | undefined =
    indiceAtual >= 0 ? ESTAGIOS_ABERTOS[indiceAtual + 1] : undefined

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
            rotulo={proximo ? ESTAGIO_FUNIL_LABELS[proximo] : 'Mover'}
            Icone={ArrowRight}
            cor={colors.primary}
          />
        )}
        renderRightActions={(progresso) => (
          <AcaoSwipe
            progresso={progresso}
            lado="esquerda"
            rotulo="Sem interesse"
            Icone={Ban}
            cor={colors.destructive}
          />
        )}
        onSwipeableOpen={(direcao) => {
          fechar()
          if (direcao === 'left') setMoverAberto(true)
          else setSemInteresseAberto(true)
        }}
      >
        <Pressable
          onPress={abrirDocumento}
          accessibilityRole="button"
          accessibilityLabel={`Abrir a nota ${nota.numero ?? ''} de ${nota.fornecedor_nome ?? 'fornecedor'}`}
          className={cn(
            'gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70',
            nota.fornecedor_suprimido && 'opacity-60',
          )}
        >
          {/* Fornecedor + classificação */}
          <View className="gap-1.5">
            <Text numberOfLines={1} className="font-medium">
              {nota.fornecedor_nome ?? nota.fornecedor_cnpj}
            </Text>
            {/* Identificação da nota: é o que a pessoa confere contra o papel na
                mão do fornecedor. */}
            <View className="flex-row items-center gap-1.5">
              <View className="rounded border border-border px-1.5 py-0.5">
                <Text className="text-[10px] font-medium">{nota.tipo_nf ?? 'NFe'}</Text>
              </View>
              <Text variant="muted" className="text-xs tabular-nums">
                nº {nota.numero ?? '—'}
                {nota.serie ? `/${nota.serie}` : ''}
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5">
              {nota.faixa ? (
                <Chip
                  className={FAIXA_CHIP[nota.faixa as Faixa]}
                  textClassName={FAIXA_CHIP_TEXTO[nota.faixa as Faixa]}
                >
                  {FAIXA_LABELS[nota.faixa as Faixa]}
                </Chip>
              ) : null}
              {nota.fornecedor_tipagem ? (
                <Chip
                  className={TIPAGEM_CHIP[nota.fornecedor_tipagem as Tipagem]}
                  textClassName={TIPAGEM_CHIP_TEXTO[nota.fornecedor_tipagem as Tipagem]}
                >
                  {TIPAGEM_LABELS[nota.fornecedor_tipagem as Tipagem]}
                </Chip>
              ) : null}
              {nota.fornecedor_tem_protesto ? (
                <View className="flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5">
                  <Gavel size={10} color={colors.destructive} />
                  <Text className="text-[11px] text-destructive">Protesto</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Valor agrupado — a unidade de abordagem é o fornecedor, não a nota */}
          <View className="flex-row items-end justify-between">
            <View>
              <Text variant="muted" className="text-[11px]">
                {outras > 0 ? 'Total do fornecedor' : 'Valor da nota'}
              </Text>
              <Text className="text-lg font-semibold tabular-nums">
                {formatarMoeda(valorAgrupado)}
              </Text>
            </View>
            <View className="items-end">
              <Text variant="muted" className="text-[11px]">
                Receita esperada
              </Text>
              <Text className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                {formatarMoeda(nota.receita_esperada)}
              </Text>
              {/*
                O líquido é sempre DESTA nota, mesmo quando o valor à esquerda é o
                total do fornecedor: ele fica colado na receita esperada, que também
                é da nota, e as duas somam o valor de face dela. Derivar do total
                agrupado daria um número que não fecha com nada na tela.

                É o que o originador fala na ligação — e muda todo dia, porque um
                dia a menos de prazo é um deságio menor.
              */}
              {liquido !== null ? (
                <Text variant="muted" className="text-[11px] tabular-nums">
                  líquido hoje {formatarMoeda(liquido)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* O toque no card abre a NOTA, então o caminho para o fornecedor
              precisa ser explícito — e é aqui, onde o agregado já está. */}
          <Pressable
            onPress={abrirFornecedor}
            accessibilityRole="button"
            accessibilityLabel={`Ver todas as notas de ${nota.fornecedor_nome ?? 'fornecedor'}`}
            className="flex-row items-center gap-1 self-start active:opacity-60"
          >
            <Files size={12} color={colors.mutedForeground} />
            <Text variant="muted" className="text-[11px] underline">
              {outras > 0
                ? `+${outras} nota${outras > 1 ? 's' : ''} viva${outras > 1 ? 's' : ''} — ver fornecedor`
                : 'Ver fornecedor'}
            </Text>
          </Pressable>

          {/* Prazo + sacado */}
          <View className="flex-row items-center justify-between gap-2 border-t border-border pt-2">
            <Text className={cn('text-xs tabular-nums', URGENCIA_TEXTO[urgencia])}>
              {textoPrazo(nota.dias_para_vencimento)}
              {nota.vencimento_origem === 'estimado' ? ' (est.)' : ''}
            </Text>
            <View className="min-w-0 flex-row items-center gap-1.5">
              <Text variant="muted" numberOfLines={1} className="max-w-[9rem] text-xs">
                {nota.sacado_nome ?? nota.sacado_cnpj}
              </Text>
              <Badge variant={creditoVariant(nota.sacado_credito_status)}>
                <Text className="text-[10px]">{labelCredito(nota.sacado_credito_status)}</Text>
              </Badge>
            </View>
          </View>

          {nota.sacado_credito_status === 'APPROVED' && !nota.sacado_limite_cobre_nota ? (
            <Text className="text-[11px] text-amber-700 dark:text-amber-300">
              Aprovado, mas o limite disponível não cobre esta nota.
            </Text>
          ) : null}
        </Pressable>
      </Swipeable>

      <MoverEstagioSheet
        nota={nota}
        sugerido={proximo}
        open={moverAberto}
        onOpenChange={setMoverAberto}
      />
      {nota.access_key ? (
        <NotaDocumentoSheet
          accessKey={nota.access_key}
          titulo={`Nota ${nota.numero ?? nota.access_key}${nota.serie ? `/${nota.serie}` : ''}`}
          subtitulo={`${nota.fornecedor_nome ?? nota.fornecedor_cnpj} → ${nota.sacado_nome ?? nota.sacado_cnpj}`}
          open={documentoAberto}
          onOpenChange={setDocumentoAberto}
        />
      ) : null}

      {nota.fornecedor_cnpj ? (
        <SemInteresseSheet
          cnpj={nota.fornecedor_cnpj}
          nome={nota.fornecedor_nome}
          open={semInteresseAberto}
          onOpenChange={setSemInteresseAberto}
        />
      ) : null}
    </>
  )
}
