import {
  ESTAGIO_FUNIL_LABELS,
  OPCOES_NOVIDADES,
  descreverJanela,
  lerDataHoraDigitada,
  type EstagioFunil,
  type OpcaoNovidades,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Building2, CheckCheck, Handshake, Search, Sparkles, TriangleAlert } from 'lucide-react-native'
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
import { FiltroChip, FiltroFaixa } from '@/components/ui/filtros'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useDebouncedValue } from '@/features/empresas'
import { useSession } from '@/lib/auth'
import { canOpenOnMobile } from '@/lib/linking'

import { formatarMoeda } from '../format'
import { useJanelaNovidades, useVisitaAoFunil } from '../novidades'
import { useFunilQuery, useMinimoOperavelQuery } from '../queries'
import type { FornecedorFunil, Oportunidade } from '../types'
import { EstagiosDoFunil, FiltrosFunil } from './filtros-funil'
import { NotaCard } from './nota-card'
import { FunilSkeleton } from './skeletons'

export interface FunilNotasProps {
  /** "Funil" na Antecipação, "Funil de NFs" no Comercial. */
  titulo: string
  /**
   * Só as notas roteadas para esta carteira — o funil de NFs do ORIGINADOR, a
   * mesma trava da web. Sem ele, o funil é tudo o que a RLS devolve a quem abriu:
   * a fila inteira para o gestor, o time abaixo para o closer.
   */
  vendedorId?: string
  /**
   * Os atalhos para as leituras laterais da Antecipação (sacados, sacados por NF,
   * fornecedores). Só fazem sentido DENTRO do módulo: no Comercial, o funil é um
   * entre os funis irmãos e a moldura tem de ser a deles.
   */
  atalhos?: boolean
  /** Abre já com o filtro de novidades ligado — é como o card do Meu Dia chega aqui. */
  novidadesInicial?: OpcaoNovidades
}

/**
 * Os rótulos das novidades no chip. Mais curtos que os do seletor da web: numa faixa
 * rolável de 390px, "Desde meu último expediente" e "Últimas 6 horas" lado a lado já
 * empurram as outras três opções para fora da tela.
 */
const NOVIDADES_CHIP: Record<OpcaoNovidades, string> = {
  expediente: 'Desde o último expediente',
  seis_horas: '6 horas',
  hoje: 'Hoje',
  sete_dias: '7 dias',
  personalizado: 'Personalizado',
}

/**
 * O FUNIL DE NOTAS — a tela principal da Antecipação e o Funil de NFs do Comercial.
 *
 * Uma tela só para os dois, como na web: o trabalho sobre uma nota é idêntico, o
 * que muda é de quem ela é. Uma segunda tela "igual mas do originador" duplicaria
 * as regras de avanço e perda, que são exatamente as que não podem divergir.
 *
 * Quem abre no celular está na rua e quer trabalhar notas: lista ordenada por
 * receita esperada, filtro rápido, pull-to-refresh, busca. Os números agregados
 * (métricas por faixa) são análise de escritório e ficam no web.
 *
 * A ordem visual e a ordem da consulta são a mesma — receita esperada decrescente —
 * porque a primeira coisa que a lista precisa comunicar é "comece por aqui".
 */
export function FunilNotas({ titulo, vendedorId, atalhos = false, novidadesInicial }: FunilNotasProps) {
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

  /*
   * NOVIDADES (04t) — "o que entrou desde a última vez que eu trabalhei".
   *
   * Desligado por padrão; ligado, o primeiro chip é "desde o último expediente", que
   * na segunda de manhã traz desde sexta às 18h. Tocar no chip ativo desliga, como
   * faixa e tipagem. Não persiste: um filtro de tempo que sobrevive ao fechar o app é
   * um funil que amanhece vazio sem ninguém saber por quê.
   */
  const [novidades, setNovidades] = useState<OpcaoNovidades | null>(novidadesInicial ?? null)
  const [novidadeDe, setNovidadeDe] = useState('')
  const [novidadeAte, setNovidadeAte] = useState('')
  const intervalo = useMemo(
    () => ({ de: lerDataHoraDigitada(novidadeDe), ate: lerDataHoraDigitada(novidadeAte) }),
    [novidadeDe, novidadeAte],
  )
  const { janela, agora } = useJanelaNovidades(novidades, intervalo)
  const novidadeDeIso = janela?.de.toISOString()
  const novidadeAteIso = janela?.ate?.toISOString()

  // §6: abrir o funil é uma visita. O selo "Novo" compara com a visita ANTERIOR.
  const { vistoAnterior, marcarTudo } = useVisitaAoFunil()

  const filtros = useMemo(
    () => ({
      estagio,
      faixa,
      tipagem,
      termo: termoDebounced || undefined,
      vendedorId,
      novidadeDe: novidadeDeIso,
      novidadeAte: novidadeAteIso,
    }),
    [estagio, faixa, tipagem, termoDebounced, vendedorId, novidadeDeIso, novidadeAteIso],
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
        vistoAnterior={vistoAnterior}
      />
    ),
    [fornecedores, minimoOperavel, vistoAnterior],
  )

  const filtrando = Boolean(termoDebounced || faixa || tipagem || novidades)

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
      titulo={titulo}
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

      {/*
        NOVIDADES na própria faixa: é outra dimensão — o QUANDO —, e misturada com
        faixa e tipagem viraria o nono chip de uma fileira que já rola.
      */}
      <View className="gap-2">
        <FiltroFaixa className="items-center gap-2">
          <Text variant="muted" className="text-xs">
            Entrou
          </Text>
          {OPCOES_NOVIDADES.map((o) => (
            <FiltroChip
              key={o}
              label={NOVIDADES_CHIP[o]}
              ativo={novidades === o}
              accessibilityLabel={`Mostrar o que entrou: ${NOVIDADES_CHIP[o]}`}
              onPress={() => setNovidades(novidades === o ? null : o)}
            />
          ))}
        </FiltroFaixa>

        {novidades === 'personalizado' ? (
          <View className="flex-row gap-2 px-4">
            <Input
              value={novidadeDe}
              onChangeText={setNovidadeDe}
              placeholder="De: 10/10/2026 18:00"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              accessibilityLabel="Entrou a partir de, dia, mês, ano e hora"
              containerClassName="flex-1 gap-0"
            />
            <Input
              value={novidadeAte}
              onChangeText={setNovidadeAte}
              placeholder="Até: agora"
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              accessibilityLabel="Entrou até, dia, mês, ano e hora. Vazio vale até agora"
              containerClassName="flex-1 gap-0"
            />
          </View>
        ) : null}

        {/*
          A JANELA POR EXTENSO. Calculada em silêncio, ninguém confia nela; escrita
          assim, o originador confere sozinho se a conta bate.
        */}
        {novidades ? (
          <View className="mx-4 gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <Text className="text-xs">
              {janela
                ? descreverJanela(janela, agora, isPending ? null : total)
                : 'Digite a partir de quando, como 10/10/2026 18:00. O fim é opcional.'}
            </Text>
            {janela && !janela.feriadosConsiderados ? (
              <View className="flex-row items-center gap-1.5">
                <TriangleAlert size={12} color={colors.mutedForeground} />
                <Text variant="muted" className="flex-1 text-[11px]">
                  Feriados podem não estar considerados: o calendário deste período não foi importado.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

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
        {/* O controle explícito do selo "Novo" (§6). Só existe quando há uma visita
            anterior com que comparar. */}
        {vistoAnterior ? (
          <View className="flex-row px-2">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void marcarTudo().catch(() => undefined)}
              accessibilityLabel="Marcar tudo como visto: apaga o selo Novo de todos os cards"
            >
              <CheckCheck size={16} color={colors.mutedForeground} />
              <Text className="text-xs">Marcar tudo como visto</Text>
            </Button>
          </View>
        ) : null}

        {atalhos ? (
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
        ) : null}
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
                  ? novidades
                    ? 'Nada entrou nesta janela com estes filtros.'
                    : 'Nada com estes filtros. Tente limpar a faixa ou a tipagem.'
                  : `Nada em ${ESTAGIO_FUNIL_LABELS[estagio as EstagioFunil] ?? estagio}. As oportunidades chegam pelo sync, de 4 em 4 horas.`
              }
              actionLabel={filtrando ? 'Limpar filtros' : undefined}
              onAction={
                filtrando
                  ? () => {
                      setTermo('')
                      setFaixa(undefined)
                      setTipagem(undefined)
                      setNovidades(null)
                      setNovidadeDe('')
                      setNovidadeAte('')
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
