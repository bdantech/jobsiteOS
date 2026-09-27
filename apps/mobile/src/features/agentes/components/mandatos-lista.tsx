import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as React from 'react'
import { Animated, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { CabecalhoRetratil, useCabecalhoRetratil } from '@/components/shell/cabecalho-retratil'
import { Badge } from '@/components/ui/badge'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { agentesKeys, buscarMandatos, type FiltroMandatos, type MandatoDaLista } from '../api'
import {
  dataHora,
  estadoMandatoLabel,
  MOTIVO_PAUSA_LABELS,
  nomeDoAgente,
  proximaAcaoTexto,
  tipoMandatoLabel,
  varianteEstadoMandato,
} from '../format'
import { useAcoesAoVivo } from '../realtime'

/**
 * Os mandatos no celular (09 §11 Mobile), só leitura.
 *
 * LISTA com recorte por estado, não o kanban da web — a mesma decisão da Cobrança e do
 * Jurídico: sete colunas num celular são uma visível e seis escondidas. Os quatro
 * recortes respondem as quatro perguntas de quem acompanha: o que está rodando, o que
 * deu certo, o que voltou para uma pessoa, e o que não deu.
 */

const OPCOES_FILTRO: readonly OpcaoFiltro<FiltroMandatos>[] = [
  { valor: 'ativos', label: 'Ativos' },
  { valor: 'concluidos', label: 'Concluídos' },
  { valor: 'escalados', label: 'Escalados' },
  { valor: 'encerrados', label: 'Encerrados' },
]

const VAZIO: Record<FiltroMandatos, string> = {
  ativos: 'Nenhum mandato em curso nos agentes que você acompanha. Mandatos se criam na web ou pelas regras.',
  concluidos: 'Nenhum mandato concluído ainda.',
  escalados: 'Nenhum mandato voltou para uma pessoa.',
  encerrados: 'Nenhum mandato encerrado sem sucesso.',
}

function Linha({ mandato, onPress }: { mandato: MandatoDaLista; onPress: () => void }) {
  const ativo = mandato.estado !== 'concluido' && mandato.estado !== 'escalado' && mandato.estado !== 'encerrado_sem_sucesso'
  const atrasada =
    ativo && !!mandato.proxima_acao_em && new Date(mandato.proxima_acao_em).getTime() < Date.now() - 5 * 60_000

  return (
    <Pressable onPress={onPress} className="rounded-xl border border-border bg-card p-4 active:opacity-70">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 font-medium" numberOfLines={1}>
          {mandato.empresa?.razao_social ?? '—'}
        </Text>
        <Text className="text-xs text-muted-foreground">{mandato.codigo ?? '—'}</Text>
      </View>

      <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
        {nomeDoAgente(mandato.agente)} · {tipoMandatoLabel(mandato.tipo)}
      </Text>

      <Text className="mt-1 text-sm" numberOfLines={2}>
        {mandato.objetivo}
      </Text>

      <View className="mt-2 flex-row flex-wrap items-center justify-between gap-2">
        <Badge variant={varianteEstadoMandato(mandato.estado)}>
          <Text>
            {estadoMandatoLabel(mandato.estado)}
            {mandato.estado === 'pausado' && mandato.pausado_motivo
              ? ` · ${MOTIVO_PAUSA_LABELS[mandato.pausado_motivo] ?? mandato.pausado_motivo}`
              : ''}
          </Text>
        </Badge>
        <Text className={cn('text-xs tabular-nums', atrasada ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {ativo ? proximaAcaoTexto(mandato.proxima_acao_em) : `encerrado ${dataHora(mandato.encerrado_em ?? mandato.atualizado_em)}`}
        </Text>
      </View>
    </Pressable>
  )
}

export function MandatosLista() {
  const router = useRouter()
  const { colors } = useTheme()
  const qc = useQueryClient()
  const [filtro, setFiltro] = React.useState<FiltroMandatos>('ativos')
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<MandatoDaLista>()

  const mandatos = useQuery({ queryKey: agentesKeys.mandatos(filtro), queryFn: () => buscarMandatos(filtro) })

  // A próxima ação e o estado andam a cada ciclo; uma ação nova é o sinal de que andaram.
  useAcoesAoVivo(() => {
    void qc.invalidateQueries({ queryKey: [...agentesKeys.all, 'mandatos'] })
  })

  const linhas = mandatos.data ?? []
  const rotulo = OPCOES_FILTRO.find((o) => o.valor === filtro)?.label ?? ''

  const cabecalho = (
    <CabecalhoRetratil
      titulo="Mandatos"
      resumo={`${rotulo} · ${linhas.length} mandato${linhas.length === 1 ? '' : 's'}`}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      chips={<FiltroSegmentado opcoes={OPCOES_FILTRO} valor={filtro} onChange={setFiltro} sobreNavy sangra />}
    />
  )

  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  if (mandatos.isPending) {
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

  if (mandatos.isError) {
    return (
      <View className="flex-1">
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState title="Não foi possível carregar os mandatos" onRetry={() => void mandatos.refetch()} />
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
        keyExtractor={(item) => item.id}
        onScroll={aoRolar}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: alturaCabecalho + 12 }}
        contentContainerClassName="gap-3 px-4 pb-28"
        refreshControl={
          <RefreshControl
            refreshing={mandatos.isRefetching}
            onRefresh={() => void mandatos.refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={<EmptyState title="Nenhum mandato" description={VAZIO[filtro]} />}
        renderItem={({ item }) => <Linha mandato={item} onPress={() => router.push(`/agentes/${item.id}`)} />}
      />

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}
    </View>
  )
}
