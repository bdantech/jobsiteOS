import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  FAIXA_LABELS,
  STATUS_PRE_AUTORIZACAO_LABELS,
  TIPAGEM_LABELS,
  TIPO_OPORTUNIDADE_LABELS,
  urgenciaDe,
  valorLiquidoEstimado,
  type EstagioFunil,
  type Faixa,
  type Tipagem,
  type TipoOportunidade,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ArrowRight, Ban, Clock, Files, Gavel } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { useRotaDoFornecedor } from '@/lib/navegacao'
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
import type { FornecedorFunil, Oportunidade } from '../types'
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
  nota: Oportunidade
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
  const rotaDoFornecedor = useRotaDoFornecedor()
  const { colors } = useTheme()
  const swipeRef = useRef<Swipeable>(null)
  const [moverAberto, setMoverAberto] = useState(false)
  const [semInteresseAberto, setSemInteresseAberto] = useState(false)
  const [documentoAberto, setDocumentoAberto] = useState(false)

  const tipo = (nota.tipo ?? 'nf') as TipoOportunidade

  /*
   * O que acende a barra da esquerda: as MESMAS condições que já pintavam uma
   * tira ou uma frase de aviso no card. A barra não acrescenta informação —
   * ela dá ao que já existia um canal que se lê sem ler.
   */
  const limiteNaoCobre =
    nota.sacado_credito_status === 'APPROVED' && nota.sacado_limite_cobre_valor === false
  const alerta = Boolean(nota.conversao_antecipacao_id ?? nota.pre_autorizacao_id) || limiteNaoCobre
  const urgencia = urgenciaDe(nota.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1
  const valorAgrupado = fornecedor?.valor_total ?? nota.valor
  const liquido = valorLiquidoEstimado({
    valor: nota.valor,
    receitaEsperada: nota.receita_esperada,
    tac: nota.tac_estimada,
    seguro: nota.seguro_estimado,
  })

  const fechar = useCallback(() => swipeRef.current?.close(), [])

  const abrirFornecedor = useCallback(() => {
    // Dentro da pilha de onde o card veio — o Funil de NFs do Comercial tem a sua
    // cópia da ficha. Ver `lib/navegacao.ts`.
    if (nota.fornecedor_cnpj) router.push(rotaDoFornecedor(nota.fornecedor_cnpj))
  }, [router, rotaDoFornecedor, nota.fornecedor_cnpj])

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
          accessibilityLabel={`Abrir ${TIPO_OPORTUNIDADE_LABELS[tipo].toLowerCase()} ${nota.numero_exibicao ?? ''} de ${nota.fornecedor_nome ?? 'fornecedor'}`}
          className={cn(
            'overflow-hidden rounded-lg border border-border bg-card active:border-input',
            nota.fornecedor_suprimido && 'opacity-60',
          )}
        >
          {/*
            A BARRA DA ESQUERDA é o único canal que funciona de relance numa
            lista longa: ela aparece na borda do card, fora da coluna de texto,
            então o olho a encontra rolando sem ler nada. Só acende quando há
            algo a fazer — se acendesse sempre, viraria enfeite.
          */}
          <View
            className={cn(
              'absolute bottom-0 left-0 top-0 w-1',
              alerta ? 'bg-[#C4851A]' : 'bg-transparent',
            )}
          />
          <View className="gap-2.5 py-3.5 pl-[18px] pr-4">
          {/*
            NOME E VALOR NA MESMA LINHA.
            
            Eram duas alturas diferentes do card, e a pessoa lia o nome, descia
            para o valor e voltava. Lado a lado, a pergunta "quanto vale esta"
            se responde na mesma sacada em que se lê de quem é.
          */}
          <View className="gap-[3px]">
            <View className="flex-row items-baseline justify-between gap-3">
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-bold leading-tight">
                {nota.fornecedor_nome ?? nota.fornecedor_cnpj}
              </Text>
              <Text className="text-[15px] font-extrabold tabular-nums">
                {formatarMoeda(nota.valor)}
              </Text>
            </View>
            {/* O SELO DE ORIGEM vem primeiro: responde "de onde veio este card"
                antes de qualquer outra leitura. Depois a linha de contexto, que é
                a ÚNICA coisa que varia por tipo e vem pronta do banco. */}
            {/*
              A SEGUNDA LINHA responde "qual documento" e "quanto sobra", que é
              o par que o originador repete na ligação. `numberOfLines={1}`
              porque no título a linha de contexto chega a 62 caracteres e
              empurraria o resto do card para baixo.
            */}
            <View className="flex-row items-baseline justify-between gap-3">
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                {TIPO_OPORTUNIDADE_LABELS[tipo]} · {nota.linha_contexto ?? nota.numero_exibicao ?? '—'}
                {nota.sacado_nome ? ` · ${nota.sacado_nome}` : ''}
              </Text>
              {liquido !== null ? (
                <Text className="text-[12.5px] font-semibold tabular-nums text-secondary-foreground">
                  líq. {formatarMoeda(liquido)}
                </Text>
              ) : null}
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5">
              {/*
                O CRÉDITO DO SACADO vem primeiro entre os chips: ele é o que
                decide se a conversa pode existir. Faixa e tipagem ordenam a
                fila; "não aprovado" a encerra.
              */}
              <Badge variant={creditoVariant(nota.sacado_credito_status)}>
                <Text className="text-xs font-semibold">
                  {labelCredito(nota.sacado_credito_status)}
                </Text>
              </Badge>
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
                <View className="flex-row items-center gap-1 rounded-full border border-border px-2.5 py-0.5">
                  <Gavel size={10} color={colors.destructive} />
                  <Text className="text-xs text-destructive">Protesto</Text>
                </View>
              ) : null}
              {/*
                "+N notas" é CHIP e é o caminho para o fornecedor.
                
                Era um link sublinhado embaixo do card. Como chip ele fica na
                mesma linha do resto do contexto do fornecedor, e some quando
                não há o que somar — um "Ver fornecedor" permanente ocupava uma
                linha inteira para repetir o que o nome no topo já leva.
              */}
              {outras > 0 ? (
                <Pressable
                  onPress={abrirFornecedor}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver as ${outras + 1} notas de ${nota.fornecedor_nome ?? 'fornecedor'}, ${formatarMoeda(valorAgrupado)} no total`}
                  hitSlop={6}
                  className="flex-row items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 active:opacity-70"
                >
                  <Files size={10} color={colors.mutedForeground} />
                  <Text className="text-xs font-semibold text-secondary-foreground">
                    +{outras} nota{outras > 1 ? 's' : ''}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/*
            A TIRA, e ela muda o que a pessoa vai FAZER.
            
            Sem isto o celular mostrava como trabalho a fazer 259 notas que já
            foram antecipadas — e o vendedor na rua ligava para o fornecedor
            oferecendo o que ele já tem. É o pior erro que este card podia
            cometer, porque acontece na frente do cliente.

            Precedência: convertida ganha de "já tem pré-autorização", porque a
            primeira encerra a conversa e a segunda só a muda.
          */}
          {nota.conversao_antecipacao_id ? (
            <View
              className={cn(
                'rounded-md border px-2 py-1.5',
                nota.conversao_em_disputa
                  ? 'border-destructive/30 bg-destructive/10'
                  : 'border-emerald-600/25 bg-emerald-500/10',
              )}
            >
              <Text
                className={cn(
                  'text-[11px]',
                  nota.conversao_em_disputa ? 'text-destructive' : 'text-emerald-700',
                )}
              >
                Convertida via antecipação #{nota.conversao_antecipacao_id}
                {nota.conversao_valor ? ` · ${formatarMoeda(nota.conversao_valor)}` : ''}
                {nota.conversao_em_disputa ? ' — em disputa, revise.' : ''}
              </Text>
            </View>
          ) : nota.pre_autorizacao_id ? (
            <View className="rounded-md border border-amber-600/25 bg-amber-500/10 px-2 py-1.5">
              <Text className="text-[11px] text-amber-700">
                Já tem pré-autorização
                {nota.pre_autorizacao_status
                  ? ` (${STATUS_PRE_AUTORIZACAO_LABELS[nota.pre_autorizacao_status] ?? nota.pre_autorizacao_status})`
                  : ''}
                {' — a construtora já ofereceu; lembre-o de aceitar.'}
              </Text>
            </View>
          ) : null}

          {/*
            O RODAPÉ é o par que decide a ordem da fila: quanto rende e quanto
            tempo resta. O sacado saiu daqui e foi para a linha de contexto —
            ele diz de QUEM é a nota, que é identificação, não decisão.
          */}
          <View className="flex-row items-center justify-between gap-3 border-t border-border pt-2.5">
            <Text className="text-[12.5px] text-muted-foreground">
              Receita esperada{' '}
              <Text className="font-bold text-[#1E7A4D]">{formatarMoeda(nota.receita_esperada)}</Text>
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Clock size={14} color={urgencia === 'confortavel' ? colors.mutedForeground : '#A06A12'} />
              <Text
                className={cn('text-[12.5px] font-semibold tabular-nums', URGENCIA_TEXTO[urgencia])}
              >
                {textoPrazo(nota.dias_para_vencimento)}
                {nota.vencimento_origem === 'estimado' ? ' (est.)' : ''}
              </Text>
            </View>
          </View>

          {/* `=== false` e não `!`: nulo é "não sei" desde a 0229, e não "não cobre". */}
          {nota.sacado_credito_status === 'APPROVED' && nota.sacado_limite_cobre_nota === false ? (
            <Text className="text-[11px] text-amber-700 dark:text-amber-300">
              Aprovado, mas o limite disponível não cobre esta nota.
            </Text>
          ) : null}
          </View>
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
