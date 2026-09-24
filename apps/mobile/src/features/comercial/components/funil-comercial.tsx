import { Search } from 'lucide-react-native'
import { useMemo, useRef, useState, type ReactElement } from 'react'
import { Animated, FlatList, RefreshControl, View, type TextInput } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import {
  CabecalhoRetratil,
  useCabecalhoRetratil,
} from '@/components/shell/cabecalho-retratil'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'

import { useVendedoresVisiveis } from '../index'

/**
 * A MOLDURA DOS FUNIS DO COMERCIAL no celular — reuniões e vendas.
 *
 * O mesmo desenho do funil de notas da Antecipação: busca e estágio dentro do
 * cabeçalho retrátil, a contagem de cada estágio no próprio chip, a lista por
 * baixo do vidro. Na web estes funis são kanbans; aqui o kanban vira filtro, pela
 * mesma razão que a Antecipação deu: um kanban de seis colunas num telefone é uma
 * coluna visível e cinco escondidas.
 *
 * Os dois funis diferem só no CARD. Tudo o que é moldura mora aqui, para que o
 * de reuniões e o de vendas não passem a divergir no primeiro ajuste de um deles.
 *
 * ── A BUSCA É LOCAL ─────────────────────────────────────────────────────────
 * A consulta já traz o funil inteiro que a RLS devolve (até 500 cards, o teto da
 * web). Filtrar por nome no aparelho é imediato; ir ao banco a cada tecla seria
 * reordenar um array que já está na memória.
 */

const TODOS = '__todos__'

/*
 * A `Animated.FlatList` tipada como a FlatList que ela é.
 *
 * Com um `T` genérico o TS não fecha a conta: a versão animada embrulha `data` em
 * `WithAnimatedObject<T>`, que ele não consegue provar igual a `T`. Em runtime é
 * a mesma FlatList, que é o que o `onScroll` nativo do cabeçalho retrátil exige.
 */
const ListaAnimada = Animated.FlatList as unknown as typeof FlatList

export interface FunilComercialProps<T> {
  titulo: string
  /** Singular e plural do que a lista conta: "lead"/"leads". */
  unidade: [string, string]
  itens: readonly T[] | undefined
  isPending: boolean
  isError: boolean
  isRefetching: boolean
  refetch: () => void
  estagios: readonly string[]
  rotuloDoEstagio: Record<string, string>
  chave: (item: T) => string
  estagioDe: (item: T) => string
  nomeDe: (item: T) => string | null | undefined
  renderCard: (item: T) => ReactElement
  vazio: { titulo: string; descricao: string }
}

export function FunilComercial<T>({
  titulo,
  unidade,
  itens,
  isPending,
  isError,
  isRefetching,
  refetch,
  estagios,
  rotuloDoEstagio,
  chave,
  estagioDe,
  nomeDe,
  renderCard,
  vazio,
}: FunilComercialProps<T>) {
  const { colors } = useTheme()
  const buscaRef = useRef<TextInput>(null)
  /*
   * O funil ABRE no primeiro estágio, não em "Todos": é onde está o trabalho novo,
   * e é como o funil da Antecipação sempre abriu. "Todos" continua a um toque,
   * para quem quer conferir o funil inteiro.
   */
  const estagioInicial = estagios[0] ?? TODOS
  const [estagio, setEstagio] = useState<string>(estagioInicial)
  const [termo, setTermo] = useState('')
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<T>()

  const todos = itens ?? []

  // A contagem é do funil INTEIRO, não do que a busca deixou: ela responde "onde
  // está o trabalho", e encolher a cada tecla faria os números dançarem.
  const opcoes = useMemo<readonly OpcaoFiltro<string>[]>(
    () => [
      { valor: TODOS, label: 'Todos' },
      ...estagios.map((e) => ({ valor: e, label: rotuloDoEstagio[e] ?? e })),
    ],
    [estagios, rotuloDoEstagio],
  )
  const contagem = useMemo(() => {
    const m: Record<string, number> = { [TODOS]: todos.length }
    for (const e of estagios) m[e] = 0
    for (const item of todos) {
      const e = estagioDe(item)
      m[e] = (m[e] ?? 0) + 1
    }
    return m
  }, [todos, estagios, estagioDe])

  const busca = termo.trim().toLowerCase()
  const visiveis = todos.filter(
    (item) =>
      (estagio === TODOS || estagioDe(item) === estagio) &&
      (busca === '' || (nomeDe(item) ?? '').toLowerCase().includes(busca)),
  )

  const rotuloAtual = estagio === TODOS ? 'Todos' : (rotuloDoEstagio[estagio] ?? estagio)

  const cabecalho = (
    <CabecalhoRetratil
      titulo={titulo}
      resumo={`${rotuloAtual} · ${visiveis.length} ${visiveis.length === 1 ? unidade[0] : unidade[1]}`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      aoReabrir={() => setTimeout(() => buscaRef.current?.focus(), 240)}
      busca={
        <Input
          ref={buscaRef}
          value={termo}
          onChangeText={setTermo}
          placeholder="Buscar empresa"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={`Buscar no ${titulo.toLowerCase()}`}
          icone={<Search size={20} color={colors.mutedForeground} />}
          containerClassName="gap-0"
          className="border-0"
        />
      }
      chips={
        <FiltroSegmentado
          opcoes={opcoes}
          valor={estagio}
          onChange={setEstagio}
          contagem={isPending ? undefined : contagem}
          sobreNavy
          sangra
        />
      }
    />
  )

  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  return (
    <View className="flex-1 bg-background">
      {isPending ? (
        <View style={recuoDoCabecalho} className="gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </View>
      ) : isError ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState onRetry={refetch} />
        </View>
      ) : (
        <ListaAnimada<T>
          ref={listaRef}
          data={visiveis}
          keyExtractor={chave}
          renderItem={({ item }) => renderCard(item)}
          onScroll={aoRolar}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: alturaCabecalho + 12 }}
          contentContainerClassName="gap-3 px-4 pb-28"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.mutedForeground}
            />
          }
          /*
            TRÊS VAZIOS DIFERENTES, e dizer o errado engana: o funil inteiro vazio
            é o aviso do módulo; a busca sem resultado se desfaz limpando a busca;
            e um estágio vazio num funil que tem cards em outros não pode dizer
            "nenhum lead" — agora que o funil abre no primeiro estágio, esse é o
            caso mais comum.
          */
          ListEmptyComponent={
            todos.length === 0 ? (
              <EmptyState title={vazio.titulo} description={vazio.descricao} />
            ) : busca ? (
              <EmptyState
                title="Nada com esta busca"
                description={`Nenhum card com este nome em ${rotuloAtual}.`}
                actionLabel="Limpar a busca"
                onAction={() => setTermo('')}
              />
            ) : (
              <EmptyState
                title={`Nada em ${rotuloAtual}`}
                description={`O funil tem ${todos.length} ${
                  todos.length === 1 ? unidade[0] : unidade[1]
                } em outros estágios.`}
                actionLabel="Ver todos"
                onAction={() => setEstagio(TODOS)}
              />
            )
          }
        />
      )}

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}
    </View>
  )
}

/**
 * O nome do dono de cada card — só quando a pessoa enxerga mais alguém além de si.
 *
 * Para o SDR comum a lista de visíveis tem um nome, o dele, e "SDR: você" em todo
 * card seria ruído. Para o closer e o gestor, que veem o funil de outras pessoas, o
 * dono é justamente o que distingue um card do outro.
 */
export function useDonosDoFunil(): (id: string | null) => string | null {
  const { data } = useVendedoresVisiveis()
  const lista = data ?? []
  const porId = new Map(lista.map((v) => [v.id, v.nome]))
  return (id) => (lista.length > 1 && id ? (porId.get(id) ?? null) : null)
}
