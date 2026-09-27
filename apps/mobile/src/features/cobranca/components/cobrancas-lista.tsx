import {
  COBRANCA_ESTAGIOS,
  COBRANCA_ESTAGIOS_ENCERRADOS,
  COBRANCA_ESTAGIO_LABELS,
  formatCnpj,
  type CobrancaEstagio,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { AlarmClock } from 'lucide-react-native'
import * as React from 'react'
import { Animated, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { CabecalhoRetratil, useCabecalhoRetratil } from '@/components/shell/cabecalho-retratil'
import { Badge } from '@/components/ui/badge'
import { FiltroChips, FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { buscarCardsCobranca, cobrancaKeys, type CardCobranca } from '../api'
import { brl, corDoPrazo, estagioLabel, marcoLabel, prazoTexto } from '../format'

/**
 * As cobranças vivas no celular (07 §12 Mobile).
 *
 * LISTA com filtro, e não kanban — a mesma decisão do Jurídico e da esteira do Crédito:
 * um kanban de seis colunas num celular é uma coluna visível e cinco escondidas.
 *
 * A lista vem ordenada pelo PRÓXIMO PRAZO DA APÓLICE, não por valor nem por estágio.
 * Quem abre a Cobrança no celular está fora da mesa e tem tempo para uma coisa só; a
 * cobrança cujo marco vence primeiro é ela — um D+90 perdido é indenização perdida
 * (cl. 28509.01 iv), e nenhum valor de face compensa isso.
 */

type Recorte = 'minhas' | 'todas'

const OPCOES_RECORTE: readonly OpcaoFiltro<Recorte>[] = [
  { valor: 'minhas', label: 'Minhas' },
  { valor: 'todas', label: 'Todas' },
]

const OPCOES_ESTAGIO: readonly OpcaoFiltro<CobrancaEstagio>[] = COBRANCA_ESTAGIOS.filter(
  (e) => !COBRANCA_ESTAGIOS_ENCERRADOS.includes(e),
).map((e) => ({ valor: e, label: COBRANCA_ESTAGIO_LABELS[e] }))

export function CobrancasLista() {
  const router = useRouter()
  const { colors } = useTheme()
  const { usuario } = useSession()
  const [recorte, setRecorte] = React.useState<Recorte>('minhas')
  const [estagio, setEstagio] = React.useState<CobrancaEstagio | undefined>(undefined)
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<CardCobranca>()

  const cards = useQuery({ queryKey: cobrancaKeys.cards(), queryFn: buscarCardsCobranca })

  const linhas = (cards.data ?? []).filter(
    (c) =>
      (recorte === 'todas' || c.responsavel_id === usuario?.id) && (!estagio || c.estagio === estagio),
  )

  const cabecalho = (
    <CabecalhoRetratil
      titulo="Cobranças"
      resumo={`${recorte === 'minhas' ? 'Minhas' : 'Todas'}${estagio ? ` · ${COBRANCA_ESTAGIO_LABELS[estagio]}` : ''} · ${
        linhas.length
      } cobrança${linhas.length === 1 ? '' : 's'}`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      chips={
        <View className="gap-2">
          <FiltroSegmentado opcoes={OPCOES_RECORTE} valor={recorte} onChange={setRecorte} sobreNavy sangra />
          <FiltroChips
            opcoes={OPCOES_ESTAGIO}
            valor={estagio}
            onChange={setEstagio}
            rotulo={(label) => `Filtrar pelo estágio ${label}`}
            sangra
          />
        </View>
      }
    />
  )

  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  if (cards.isPending) {
    return (
      <View className="flex-1">
        <View style={recuoDoCabecalho} className="gap-3 p-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </View>
        {cabecalho}
      </View>
    )
  }

  if (cards.isError) {
    return (
      <View className="flex-1">
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState title="Não foi possível carregar as cobranças" onRetry={() => void cards.refetch()} />
        </View>
        {cabecalho}
      </View>
    )
  }

  return (
    <View className="flex-1">
      <Animated.FlatList
        ref={listaRef}
        data={linhas}
        keyExtractor={(item) => item.id ?? item.codigo ?? ''}
        onScroll={aoRolar}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: alturaCabecalho + 12 }}
        contentContainerClassName="gap-3 px-4 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={cards.isRefetching}
            onRefresh={() => void cards.refetch()}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <Pressable
            onPress={() => router.push('/cobranca/prazos')}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 active:opacity-70"
          >
            <AlarmClock size={16} color={colors.foreground} />
            <Text className="flex-1 text-sm font-medium">Prazos da apólice (30 dias)</Text>
            <Text className="text-xs text-muted-foreground">Ver</Text>
          </Pressable>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhuma cobrança"
            description={
              recorte === 'minhas'
                ? 'Nenhuma cobrança viva com você como responsável. Veja "Todas".'
                : 'Cobranças são criadas na web — é ato com consequência jurídica e de apólice.'
            }
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/cobranca/${item.id}`)}
            className="rounded-xl border border-border bg-card p-4 active:opacity-70"
          >
            <View className="flex-row items-start justify-between gap-2">
              <Text className="flex-1 font-medium" numberOfLines={1}>
                {item.sacado_razao_social ?? formatCnpj(item.sacado_matriz_cnpj ?? '')}
              </Text>
              <Text className="text-sm tabular-nums">{brl(item.valor_em_aberto ?? item.valor_face)}</Text>
            </View>

            <Text className="mt-0.5 text-xs text-muted-foreground">
              {item.codigo ?? '—'} · {item.qtd_titulos ?? 0} título{item.qtd_titulos === 1 ? '' : 's'}
              {(item.qtd_spes ?? 0) > 1 ? ` · ${item.qtd_spes} SPEs` : ''}
              {item.dias_desde_notificacao !== null ? ` · notificada há ${item.dias_desde_notificacao} d` : ''}
            </Text>

            {/* O próximo marco da apólice, com a cor que diz se é hoje o problema. */}
            <View className="mt-2 flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
                {marcoLabel(item.proximo_marco)}
              </Text>
              <Text className={cn('text-xs tabular-nums', corDoPrazo(item.dias_restantes))}>
                {prazoTexto(item.dias_restantes)}
              </Text>
            </View>

            <View className="mt-2 flex-row flex-wrap items-center gap-2">
              <Badge variant="secondary">
                <Text>{estagioLabel(item.estagio)}</Text>
              </Badge>
              {item.tem_protesto ? (
                <Badge variant="outline">
                  <Text>protesto</Text>
                </Badge>
              ) : null}
              {item.tem_sinistro ? (
                <Badge variant="outline">
                  <Text>sinistro</Text>
                </Badge>
              ) : null}
              {item.tem_processo ? (
                <Badge variant="outline">
                  <Text>processo</Text>
                </Badge>
              ) : null}
              {item.tem_acordo ? (
                <Badge variant="success">
                  <Text>acordo</Text>
                </Badge>
              ) : null}
            </View>
          </Pressable>
        )}
      />

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}
    </View>
  )
}
