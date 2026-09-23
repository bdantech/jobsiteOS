import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * Os filtros de lista do app, em duas primitivas — o padrão que a Antecipação
 * estabeleceu (§9) e que agora vale para todas as telas.
 *
 * ── Por que DUAS, e não um componente com uma prop ──────────────────────────
 * A diferença entre elas não é visual, é semântica, e o usuário lê isso na forma:
 *
 *   <FiltroSegmentado>  a escolha é EXCLUSIVA e sempre há uma ativa. As opções
 *                       moram dentro de uma mesma cápsula com borda, e a cápsula
 *                       é o que comunica "escolha uma destas". Não dá para
 *                       desmarcar, porque "nenhum estágio" não é um estado.
 *
 *   <FiltroChips>       cada filtro é OPCIONAL e independente. Chips soltos, sem
 *                       cápsula em volta, e tocar no ativo LIMPA — porque limpar
 *                       é tão importante quanto marcar.
 *
 * Usar chip para escolha exclusiva ensina que dá para desmarcar, e o usuário
 * descobre que não dá tocando. Usar segmentado para filtro opcional esconde que
 * dá para limpar. Por isso são dois componentes e a escolha entre eles é do
 * chamador, que é quem sabe se o "nenhum" existe.
 *
 * Antes disto, Jurídico, Crédito e Comunicação montavam filtro com <Badge> dentro
 * de <Pressable>: um Badge é indicador de ESTADO, não controle. Vinha mais
 * quadrado que os chips das outras telas, sem feedback de toque, e sem
 * accessibilityState — o leitor de tela anunciava "botão", nunca "selecionado".
 */

export interface OpcaoFiltro<T> {
  valor: T
  label: string
}

/**
 * A faixa rolável onde os filtros vivem.
 *
 * `px-4` no contentContainer, e não na ScrollView: com o padding por fora, o
 * primeiro e o último chip ficariam cortados ao rolar. Com ele por dentro, a
 * faixa sangra de ponta a ponta e o padding anda junto com o conteúdo.
 */
function Faixa({
  children,
  className,
  sangra = false,
}: {
  children: ReactNode
  className?: string
  /**
   * A faixa está DENTRO de um container que já tem padding horizontal (um
   * `p-4`, tipicamente). O `-mx-4` desfaz esse padding para a faixa voltar a ir
   * de borda a borda, e o `px-4` de dentro devolve o respiro.
   *
   * Sem isto, num container com padding a faixa rolaria dentro de uma janela
   * mais estreita que a tela, e o chip do fim seria cortado longe da borda — o
   * que faz parecer que a lista acabou ali.
   */
  sangra?: boolean
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className={sangra ? '-mx-4' : undefined}
      contentContainerClassName={cn('px-4', className)}
    >
      {children}
    </ScrollView>
  )
}

const BASE_TOQUE = 'rounded-full px-3 py-1.5 active:opacity-70'
const BASE_TEXTO = 'text-sm font-medium'

export interface FiltroSegmentadoProps<T> {
  opcoes: readonly OpcaoFiltro<T>[]
  valor: T
  onChange: (valor: T) => void
  /** Entra no rótulo de acessibilidade: "Ver {label}" por padrão. */
  rotulo?: (label: string) => string
  /** Ver <Faixa>: ligue quando o pai já tiver padding horizontal. */
  sangra?: boolean
  /** Dentro do cabeçalho navy: pílulas soltas, claras sobre escuro. */
  sobreNavy?: boolean
  /** Quantos itens em cada opção, por valor. Só aparece com `sobreNavy`. */
  contagem?: Record<string, number | undefined>
}

/** Escolha exclusiva: sempre exatamente uma ativa, e não dá para desmarcar. */
export function FiltroSegmentado<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo = (label) => `Ver ${label}`,
  sangra,
  sobreNavy = false,
  contagem,
}: FiltroSegmentadoProps<T>) {
  return (
    <Faixa className="gap-2" sangra={sangra}>
      {/*
        SOBRE O NAVY a cápsula some e cada opção vira uma pílula solta.
        
        A cápsula existe para dizer "escolha uma destas" quando as opções
        dividem um fundo com o resto da tela. No cabeçalho escuro elas já estão
        isoladas numa faixa própria, e a borda da cápsula sobre navy só
        acrescenta uma linha que o olho tem de ignorar.
      */}
      <View className={sobreNavy ? 'flex-row gap-2' : 'flex-row gap-1 rounded-full border border-border p-1'}>
        {opcoes.map((opcao) => {
          const ativo = opcao.valor === valor

          return (
            <Pressable
              key={String(opcao.valor)}
              accessibilityRole="button"
              accessibilityState={{ selected: ativo }}
              accessibilityLabel={rotulo(opcao.label)}
              onPress={() => onChange(opcao.valor)}
              className={cn(
                BASE_TOQUE,
                sobreNavy
                  ? cn(
                      'h-9 flex-row items-center gap-2 rounded-full border px-3.5',
                      ativo ? 'border-white bg-white' : 'border-white/10 bg-white/[0.06]',
                    )
                  : ativo && 'bg-primary',
              )}
            >
              <Text
                className={cn(
                  BASE_TEXTO,
                  sobreNavy
                    ? ativo
                      ? 'text-[13.5px] font-semibold text-brand'
                      : 'text-[13.5px] font-medium text-[#CBD5E1]'
                    : ativo
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {opcao.label}
              </Text>
              {/* A contagem ao lado do rótulo, como no desenho: ela responde
                  "vale a pena abrir esta coluna?" antes do toque. */}
              {sobreNavy && contagem?.[String(opcao.valor)] !== undefined ? (
                <Text
                  className={cn(
                    'text-[11.5px] font-semibold tabular-nums',
                    ativo ? 'text-brand/70' : 'text-[#CBD5E1]/80',
                  )}
                >
                  {contagem[String(opcao.valor)]}
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>
    </Faixa>
  )
}

export interface FiltroChipProps {
  label: string
  ativo: boolean
  onPress: () => void
  accessibilityLabel: string
}

/** Um chip solto. Exposto para as telas que intercalam chips com separadores. */
export function FiltroChip({ label, ativo, onPress, accessibilityLabel }: FiltroChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={cn(
        'border',
        BASE_TOQUE,
        ativo ? 'border-primary bg-primary' : 'border-border bg-transparent',
      )}
    >
      <Text
        className={cn(BASE_TEXTO, ativo ? 'text-primary-foreground' : 'text-muted-foreground')}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export interface FiltroChipsProps<T> {
  opcoes: readonly OpcaoFiltro<T>[]
  /** `undefined` = nenhum filtro aplicado. */
  valor: T | undefined
  onChange: (valor: T | undefined) => void
  rotulo?: (label: string) => string
  /** Ver <Faixa>: ligue quando o pai já tiver padding horizontal. */
  sangra?: boolean
}

/** Filtros opcionais e independentes. Tocar no ativo limpa. */
export function FiltroChips<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo = (label) => `Filtrar por ${label}`,
  sangra,
}: FiltroChipsProps<T>) {
  return (
    <Faixa className="gap-2" sangra={sangra}>
      {opcoes.map((opcao) => (
        <FiltroChip
          key={String(opcao.valor)}
          label={opcao.label}
          ativo={valor === opcao.valor}
          accessibilityLabel={rotulo(opcao.label)}
          onPress={() => onChange(valor === opcao.valor ? undefined : opcao.valor)}
        />
      ))}
    </Faixa>
  )
}

/** A faixa crua, para quem precisa intercalar chips com separadores. */
export { Faixa as FiltroFaixa }
