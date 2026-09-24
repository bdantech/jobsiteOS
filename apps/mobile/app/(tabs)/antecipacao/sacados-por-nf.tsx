import { ESTAGIOS_PROSPECCAO_ABERTOS, ESTAGIO_PROSPECCAO_LABELS } from '@jobsiteos/core'
import { AlertTriangle } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Animated, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import {
  CabecalhoRetratil,
  useCabecalhoRetratil,
} from '@/components/shell/cabecalho-retratil'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { ListaSkeleton, formatarMoeda } from '@/features/antecipacao'
import {
  CONFIG_PROSPECCAO_PADRAO,
  DescartarSacadoSheet,
  PedirPonteSheet,
  SacadoProspeccaoCard,
  SolicitarAnaliseSheet,
  useConfigProspeccaoQuery,
  usePainelProspeccaoQuery,
  useSacadosProspeccaoQuery,
  STATUS_TEXTO,
  type QuebraFornecedor,
  type SacadoProspeccao,
} from '@/features/prospeccao'
import { cn } from '@/lib/utils'

/**
 * Sacados por NF no celular (04r §9) — a aba que ABSORVE "Sacados a Prospectar".
 *
 * ─── LISTA PLANA, NÃO KANBAN ────────────────────────────────────────────────
 *
 * O originador em campo não arrasta card entre colunas com uma mão, e a pergunta que ele
 * faz é "o que eu trabalho agora?". A ordenação é por valor esperado mensal — a mesma da
 * web —, o estágio vira chip dentro do card, e as colunas viram filtro no topo.
 *
 * ─── A AUSÊNCIA PRECISA SER EXPLICADA ───────────────────────────────────────
 *
 * Este funil só enxerga notas de cedentes SEGUIDOS. Medido em 20/09/2026, 1 dos 130
 * cedentes que emitem contra sacados não cadastrados tem titular vigente na carteira —
 * então uma lista vazia é o estado NORMAL antes de alguém seguir alguém. Sem o aviso,
 * ela se lê como "não há oportunidade".
 *
 * Seguir é `webOnly` de propósito: é uma decisão de carteira, e o celular é a tela de
 * trabalhar o que já está na sua.
 */
/** "Todos" é o primeiro segmento: é como se diz "sem filtro" num controle exclusivo. */
const TODOS = '__todos__'

const OPCOES_ESTAGIO: readonly OpcaoFiltro<string>[] = [
  { valor: TODOS, label: 'Todos' },
  ...ESTAGIOS_PROSPECCAO_ABERTOS.map((e) => ({
    valor: e as string,
    label: ESTAGIO_PROSPECCAO_LABELS[e],
  })),
]

export default function SacadosPorNfScreen() {
  const { colors } = useTheme()
  const [estagio, setEstagio] = useState<string | undefined>()
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<SacadoProspeccao>()
  const [descartando, setDescartando] = useState<SacadoProspeccao | null>(null)
  const [analisando, setAnalisando] = useState<SacadoProspeccao | null>(null)
  const [pedindoPonte, setPedindoPonte] = useState<{
    sacado: SacadoProspeccao
    fornecedor: QuebraFornecedor
  } | null>(null)

  /*
   * `initialData` na query garante o objeto, mas o tipo de `useQuery` continua
   * opcional — e o default aqui é o mesmo do banco de propósito: a lista precisa
   * renderizar antes de a config chegar, e um card sem régua ("operável" sem dizer
   * acima de quantos dias) é pior que um card que demora.
   */
  const { data: config = CONFIG_PROSPECCAO_PADRAO } = useConfigProspeccaoQuery()
  const { data: painel } = usePainelProspeccaoQuery()
  const { data, isPending, isError, refetch, isRefetching } = useSacadosProspeccaoQuery(estagio)

  const renderItem = useCallback(
    ({ item }: { item: SacadoProspeccao }) => (
      <SacadoProspeccaoCard
        sacado={item}
        config={config}
        onDescartar={setDescartando}
        onSolicitarAnalise={setAnalisando}
        onPedirPonte={(s, f) => setPedindoPonte({ sacado: s, fornecedor: f })}
      />
    ),
    [config],
  )

  // Os estágios são o recorte — as colunas da web viram filtro — e moram no
  // cabeçalho retrátil. O painel de números rola com a lista.
  const cabecalho = (
    <CabecalhoRetratil
      titulo="Sacados por NF"
      resumo={`${OPCOES_ESTAGIO.find((o) => o.valor === (estagio ?? TODOS))?.label ?? 'Todos'}${
        isPending ? '' : ` · ${data?.length ?? 0} sacado${(data?.length ?? 0) === 1 ? '' : 's'}`
      }`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      chips={
        <FiltroSegmentado
          opcoes={OPCOES_ESTAGIO}
          valor={estagio ?? TODOS}
          onChange={(v) => setEstagio(v === TODOS ? undefined : v)}
          sobreNavy
          sangra
        />
      }
    />
  )

  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  if (isPending) {
    return (
      <View className="flex-1 bg-background">
        <View style={recuoDoCabecalho} className="flex-1 pt-4">
          <ListaSkeleton />
        </View>
        {cabecalho}
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState
            description="Não foi possível carregar o funil. Verifique sua conexão e tente novamente."
            onRetry={() => void refetch()}
          />
        </View>
        {cabecalho}
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <Animated.FlatList
        ref={listaRef}
        data={data}
        keyExtractor={(item) => item.id as string}
        renderItem={renderItem}
        onScroll={aoRolar}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: alturaCabecalho + 16 }}
        contentContainerClassName="gap-3 p-4 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View className="mb-1 gap-3">
            {/* O painel do originador, nos quatro números que cabem na largura. */}
            <View className="flex-row flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border bg-card p-3">
              <View>
                <Text variant="muted" className="text-[10px]">
                  Sacados
                </Text>
                <Text className="font-semibold tabular-nums">{painel?.sacados ?? 0}</Text>
              </View>
              <View>
                <Text variant="muted" className="text-[10px]">
                  Volume observado
                </Text>
                <Text className="font-semibold tabular-nums">
                  {formatarMoeda(painel?.volume_observado ?? 0)}
                </Text>
              </View>
              <View>
                <Text variant="muted" className="text-[10px]">
                  Operável
                </Text>
                <Text className={cn('font-semibold tabular-nums', STATUS_TEXTO.success)}>
                  {formatarMoeda(painel?.valor_operavel ?? 0)}
                </Text>
              </View>
              <View>
                <Text variant="muted" className="text-[10px]">
                  Esperado / mês
                </Text>
                <Text className="font-semibold tabular-nums">
                  {formatarMoeda(painel?.valor_esperado_mensal ?? 0)}
                </Text>
              </View>
              {(painel?.travados_na_esteira ?? 0) > 0 ? (
                <View>
                  <Text variant="muted" className="text-[10px]">
                    Na esteira
                  </Text>
                  <Text className={cn('font-semibold tabular-nums', STATUS_TEXTO.warning)}>
                    {painel?.travados_na_esteira}
                  </Text>
                </View>
              ) : null}
            </View>

            {(data?.length ?? 0) === 0 && estagio === undefined ? (
              <View className="flex-row items-start gap-2 rounded-lg border border-border bg-muted/50 p-3">
                <AlertTriangle size={14} color={colors.mutedForeground} />
                <Text variant="muted" className="flex-1 text-xs">
                  O funil se enche com as notas que <Text className="font-medium">os seus
                  cedentes</Text> emitem contra construtoras que ainda não são clientes. Seguir um
                  cedente é decisão de carteira e se faz no computador, em Antecipação → Sacados
                  por NF.
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhum sacado neste recorte"
            description="Nada com fluxo observado acima do corte de volume, vindo de um cedente que você segue."
          />
        }
      />

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}

      <DescartarSacadoSheet
        sacado={descartando}
        config={config}
        onFechar={() => setDescartando(null)}
      />
      <SolicitarAnaliseSheet sacado={analisando} onFechar={() => setAnalisando(null)} />
      <PedirPonteSheet alvo={pedindoPonte} config={config} onFechar={() => setPedindoPonte(null)} />
    </View>
  )
}
