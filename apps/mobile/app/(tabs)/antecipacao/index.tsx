import { ESTAGIO_FUNIL_LABELS, type EstagioFunil } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Building2, Handshake, Search, Sparkles } from 'lucide-react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  RefreshControl,
  ScrollView,
  View,
  type TextInput,
} from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import {
  CabecalhoRetratil,
  useCabecalhoRetratil,
} from '@/components/shell/cabecalho-retratil'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  EstagiosDoFunil,
  FiltrosFunil,
  FunilSkeleton,
  NotaCard,
  formatarMoeda,
  useFunilQuery,
  useMinimoOperavelQuery,
  type FornecedorFunil,
  type Oportunidade,
} from '@/features/antecipacao'
import { useDebouncedValue } from '@/features/empresas'
import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

/**
 * O FUNIL É A TELA PRINCIPAL DO MÓDULO no mobile (§9) — não um dashboard.
 *
 * Quem abre Antecipação no celular está na rua e quer trabalhar notas: lista
 * ordenada por receita esperada, filtro rápido, pull-to-refresh, busca. Os números
 * agregados (métricas por faixa) são análise de escritório e ficam no web.
 *
 * A ordem visual e a ordem da consulta são a mesma — receita esperada decrescente —
 * porque a primeira coisa que a lista precisa comunicar é "comece por aqui".
 */
export default function FunilScreen() {
  const router = useRouter()
  const { grantedModuleIds } = useSession()
  const { colors } = useTheme()
  const buscaRef = useRef<TextInput>(null)
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<Oportunidade>()

  const [estagio, setEstagio] = useState<string>('a_prospectar')
  const [faixa, setFaixa] = useState<string | undefined>()
  const [tipagem, setTipagem] = useState<string | undefined>()
  const [termo, setTermo] = useState('')

  // Só o termo é debounced: tocar num chip é uma ação deliberada e única.
  const termoDebounced = useDebouncedValue(termo)

  const filtros = useMemo(
    () => ({ estagio, faixa, tipagem, termo: termoDebounced || undefined }),
    [estagio, faixa, tipagem, termoDebounced],
  )

  const { data: minimoOperavel = 7 } = useMinimoOperavelQuery()
  const {
    data,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFunilQuery(filtros)

  // O `select` do hook já achata as páginas e faz o merge dos mapas de fornecedor.
  const oportunidades = data?.oportunidades ?? []
  const fornecedores: Map<string, FornecedorFunil> = data?.fornecedores ?? new Map()
  const total = data?.total ?? 0
  const valorPagina = oportunidades.reduce((s: number, o) => s + Number(o.valor ?? 0), 0)

  const renderItem = useCallback(
    ({ item }: { item: Oportunidade }) => (
      <NotaCard
        nota={item}
        fornecedor={item.fornecedor_cnpj ? fornecedores.get(item.fornecedor_cnpj) : undefined}
        minimoOperavel={minimoOperavel}
      />
    ),
    [fornecedores, minimoOperavel],
  )

  const filtrando = Boolean(termoDebounced || faixa || tipagem)

  // A busca e os filtros ficam FORA da FlatList: dentro de ListHeaderComponent o
  // TextInput remonta a cada re-render e perde o foco, o que faz a digitação comer
  // caracteres.
  /**
   * `canOpenOnMobile` e não `grantedModuleIds.includes('comercial')`: é a mesma
   * função que o gate do root usa para decidir, então o botão e a guarda não têm
   * como discordar. Ela também recusa módulo webOnly, que é o outro jeito de uma
   * rota existir e mesmo assim não abrir aqui.
   */
  const podeVerFornecedores = canOpenOnMobile('/comercial/fornecedores', grantedModuleIds)

  /*
    O CABEÇALHO fica preso ao topo; o resto do painel (faixa, tipagem, atalhos)
    rola junto com a lista. A divisão não é estética: estágio e busca trocam a
    LISTA, e ter de rolar de volta ao topo para trocar de estágio é o que fazia
    a pessoa desistir de trocar.
  */
  const cabecalho = (
    <CabecalhoRetratil
      titulo="Funil"
      resumo={`${ESTAGIO_FUNIL_LABELS[estagio as EstagioFunil] ?? estagio} · ${
        isPending ? '…' : total.toLocaleString('pt-BR')
      } oportunidades`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      /*
        Reabrir é ROLAR ATÉ O TOPO, não mexer num estado à parte: com o
        cabeçalho sendo função do scroll, qualquer outro caminho criaria um
        segundo dono da mesma verdade — e os dois discordariam no primeiro
        gesto.
      */
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      aoReabrir={() => setTimeout(() => buscaRef.current?.focus(), 240)}
      busca={
        <Input
          ref={buscaRef}
          value={termo}
          onChangeText={setTermo}
          placeholder="Buscar fornecedor, sacado ou nota"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Buscar no funil"
          icone={<Search size={20} color={colors.mutedForeground} />}
          containerClassName="gap-0"
          // Sem borda: sobre o navy o campo já se destaca por ser claro, e a
          // borda de `input` (cinza claro) sobre escuro vira um halo sujo.
          className="border-0"
        />
      }
      chips={<EstagiosDoFunil estagio={estagio} onEstagio={setEstagio} />}
    />
  )

  const painelDaLista = (
    <View className="gap-3 pb-3 pt-3">
      <FiltrosFunil
        estagio={estagio}
        onEstagio={setEstagio}
        faixa={faixa}
        onFaixa={setFaixa}
        tipagem={tipagem}
        onTipagem={setTipagem}
      />

      <View className="gap-1.5">
        <Text variant="muted" className="px-4 text-xs tabular-nums">
          {isPending ? '…' : `${total.toLocaleString('pt-BR')} oportunidades`}
          {oportunidades.length > 0 ? ` · ${formatarMoeda(valorPagina)} carregados` : ''}
        </Text>

        {/*
          Os atalhos ganharam a própria linha, rolável.
          Eles dividiam a linha com a contagem, e a contagem — "1.234 notas ·
          R$ 3,2 mi carregados" — já ocupava metade da largura. Com o terceiro
          atalho, um telefone de 390px espremeria os três em cima do texto.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-1 px-4"
        >
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push('/antecipacao/sacados')}
            accessibilityLabel="Ver capacidade por sacado"
          >
            <Building2 size={16} color={colors.mutedForeground} />
            <Text className="text-xs">Sacados</Text>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => router.push('/antecipacao/sacados-por-nf')}
            accessibilityLabel="Ver sacados por NF"
          >
            <Sparkles size={16} color={colors.mutedForeground} />
            <Text className="text-xs">Sacados por NF</Text>
          </Button>

          {/*
            Fornecedores a cadastrar vive no Comercial, e o atalho aparece aqui
            porque é o mesmo movimento de trabalho: quem varre o funil atrás de
            nota nova varre a mesma carteira atrás de quem ainda não cadastrou.

            GUARDADO pelo registry, e não só oferecido: a rota é de OUTRO módulo.
            Para quem não tem `comercial`, o gate do root devolveria a pessoa para
            a tela inicial — um botão que pisca e volta é pior que um botão ausente.
          */}
          {podeVerFornecedores ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => router.push('/comercial/fornecedores')}
              accessibilityLabel="Ver fornecedores a cadastrar"
            >
              <Handshake size={16} color={colors.mutedForeground} />
              <Text className="text-xs">Fornecedores</Text>
            </Button>
          ) : null}
        </ScrollView>
      </View>
    </View>
  )

  /*
    O CABEÇALHO É ABSOLUTO e sai do fluxo — é o que permite animá-lo só com
    transform. Quem reserva o espaço dele é o `paddingTop` da lista, com a
    altura que ele mesmo mediu.
  */
  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  return (
    <View className="flex-1 bg-background">
      {isPending ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <FunilSkeleton />
        </View>
      ) : isError ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState
            description="Não foi possível carregar o funil. Verifique sua conexão e tente novamente."
            onRetry={() => void refetch()}
          />
        </View>
      ) : (
        <Animated.FlatList
          ref={listaRef}
          data={oportunidades}
          keyExtractor={(item) => item.access_key as string}
          renderItem={renderItem}
          ListHeaderComponent={painelDaLista}
          onScroll={aoRolar}
          scrollEventThrottle={16}
          /*
            `pb-28` e não `pb-10`: a lista passa POR BAIXO da barra flutuante —
            é isso que dá ao blur o que borrar — então o fim dela precisa de
            folga para o último card chegar acima da barra.
          */
          contentContainerStyle={recuoDoCabecalho}
          contentContainerClassName="gap-3 px-4 pb-28"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={() => void refetch()}
              tintColor={colors.mutedForeground}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
          }}
          ListEmptyComponent={
            <EmptyState
              title="Nenhuma nota aqui"
              description={
                filtrando
                  ? 'Nada com estes filtros. Tente limpar a faixa ou a tipagem.'
                  : `Nada em ${ESTAGIO_FUNIL_LABELS[estagio as EstagioFunil] ?? estagio}. As oportunidades chegam pelo sync, de 4 em 4 horas.`
              }
              actionLabel={filtrando ? 'Limpar filtros' : undefined}
              onAction={
                filtrando
                  ? () => {
                      setTermo('')
                      setFaixa(undefined)
                      setTipagem(undefined)
                    }
                  : undefined
              }
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-6">
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : null
          }
        />
      )}

      {/* Depois da lista de propósito: em RN quem é irmão posterior pinta por
          cima, e não depender de `zIndex` evita a divergência iOS/Android. */}
      {cabecalho}
    </View>
  )
}
