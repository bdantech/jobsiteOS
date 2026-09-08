import {
  COLUNAS_ESTEIRA,
  ESTAGIO_ANALISE_LABELS,
  formatCnpj,
  type EstagioAnalise,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as React from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'

/**
 * A esteira no celular (04d §4.4): lista por estágio, com filtro de estágio no topo.
 *
 * Não há kanban aqui, e não é limitação de tela: um kanban de nove colunas num celular é
 * uma coluna visível e oito escondidas. A lista com filtro entrega a mesma informação sem
 * fingir que a tela é larga.
 *
 * Também não há envio à seguradora. O envio pode ser cobrado e precisa de conferência —
 * é uma decisão de mesa, e o botão vive na web.
 */

/**
 * O filtro de estágio, no padrão da Antecipação: controle segmentado, porque a
 * escolha é exclusiva — a esteira mostra um estágio ou mostra todos.
 *
 * A CONTAGEM continua no rótulo. Ela é o motivo de a esteira ser útil de relance
 * ("Em análise (7)"), e some junto com o estágio quando não há nenhum caso — a
 * lista de opções segue sendo montada só com os estágios que têm linhas.
 */
const TODAS = '__todas__'

interface ItemEsteira {
  id: string
  cnpj: string
  estagio: string
  limite_solicitado: number | null
  limite_aprovado: number | null
  origem: string
  atualizada_em: string
  razao_social: string | null
}

async function buscarEsteira(): Promise<ItemEsteira[]> {
  const { data, error } = await supabase
    .from('analises_credito')
    .select('id, cnpj, estagio, limite_solicitado, limite_aprovado, origem, atualizada_em, empresas(razao_social)')
    .order('atualizada_em', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  type Raw = Omit<ItemEsteira, 'razao_social'> & { empresas: { razao_social: string | null } | null }
  return ((data ?? []) as unknown as Raw[]).map((a) => ({ ...a, razao_social: a.empresas?.razao_social ?? null }))
}

/**
 * A variante do badge por estágio, no mesmo espírito de `creditoVariant` da
 * Antecipação: a cor carrega o DESFECHO, não a etapa.
 *
 * Só os três estágios decididos ganham cor. Os abertos ficam em `secondary` —
 * pintar "Em análise" de verde ou vermelho diria que já há resposta, e não há.
 */
function estagioVariant(estagio: string): 'success' | 'destructive' | 'secondary' {
  if (estagio === 'aprovada' || estagio === 'aprovada_parcial') return 'success'
  if (estagio === 'negada') return 'destructive'
  return 'secondary'
}

/**
 * "há 3d" — a mesma função que `textoPrazo` cumpre no card da Antecipação: dizer
 * de relance se aquela linha está parada. Uma análise esquecida há três semanas é
 * a informação que faz alguém tocar nela.
 */
function desdeAtualizacao(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  const dias = Math.floor(ms / 86_400_000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias}d`
  const meses = Math.floor(dias / 30)
  return `há ${meses}${meses === 1 ? ' mês' : ' meses'}`
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function EsteiraLista() {
  const router = useRouter()
  const { colors } = useTheme()
  const [filtro, setFiltro] = React.useState<EstagioAnalise | null>(null)

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ['credito', 'esteira'],
    queryFn: buscarEsteira,
  })

  const contagem = React.useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of data ?? []) m[a.estagio] = (m[a.estagio] ?? 0) + 1
    return m
  }, [data])

  const opcoesEsteira = React.useMemo<readonly OpcaoFiltro<string>[]>(
    () => [
      { valor: TODAS, label: `Todas (${(data ?? []).length})` },
      ...COLUNAS_ESTEIRA.filter((e) => (contagem[e] ?? 0) > 0).map((e) => ({
        valor: e as string,
        label: `${ESTAGIO_ANALISE_LABELS[e]} (${contagem[e]})`,
      })),
    ],
    [data, contagem],
  )

  const itens = (data ?? []).filter((a) => filtro === null || a.estagio === filtro)

  if (isPending) {
    return (
      <View className="gap-2 p-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </View>
    )
  }

  if (isError) return <ErrorState onRetry={() => void refetch()} />

  return (
    <View className="flex-1">
      <View className="py-3">
        <FiltroSegmentado
          opcoes={opcoesEsteira}
          valor={filtro ?? TODAS}
          onChange={(valor) => setFiltro(valor === TODAS ? null : (valor as EstagioAnalise))}
        />
      </View>

      <FlatList
        data={itens}
        keyExtractor={(a) => a.id}
        contentContainerClassName="gap-2 px-4 pb-8"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.mutedForeground} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nenhuma análise"
            description="As solicitações nascem na ficha de um sacado, ou vêm do histórico da apólice."
          />
        }
        renderItem={({ item }) => {
          const decidida = item.limite_aprovado !== null

          return (
            <Pressable
              onPress={() => router.push(`/credito/${item.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Abrir a análise de ${item.razao_social ?? formatCnpj(item.cnpj)}`}
              className="gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
            >
              {/* 1. Identidade — quem é, e a marca de origem. */}
              <View className="gap-1.5">
                <Text numberOfLines={1} className="font-medium">
                  {item.razao_social ?? formatCnpj(item.cnpj)}
                </Text>
                <Text variant="muted" className="text-xs tabular-nums">
                  {formatCnpj(item.cnpj)}
                </Text>
                {item.origem === 'atradius_backfill' ? (
                  <View className="flex-row flex-wrap items-center gap-1.5">
                    <View className="rounded-full border border-border px-2 py-0.5">
                      <Text className="text-[11px] font-medium">da apólice</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/*
                2. Os dois números, cada um com o seu rótulo.

                Antes havia UM número, `limite_aprovado ?? limite_solicitado`, sem
                rótulo — e a palavra "aprovado" solta na linha de badges abaixo era
                a única pista de qual dos dois estava na tela. Quem batia o olho não
                tinha como saber se lia um pedido ou uma decisão, que é justamente a
                pergunta da esteira.
              */}
              <View className="flex-row items-end justify-between gap-2">
                <View>
                  <Text variant="muted" className="text-[11px]">
                    Limite solicitado
                  </Text>
                  <Text className="text-lg font-semibold tabular-nums">
                    {moeda(item.limite_solicitado)}
                  </Text>
                </View>
                <View className="items-end">
                  <Text variant="muted" className="text-[11px]">
                    Limite aprovado
                  </Text>
                  {decidida ? (
                    <Text className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                      {moeda(item.limite_aprovado)}
                    </Text>
                  ) : (
                    // Travessão, e não o valor solicitado repetido: ainda não há
                    // decisão, e repetir o pedido aqui pareceria uma.
                    <Text variant="muted" className="tabular-nums">
                      —
                    </Text>
                  )}
                </View>
              </View>

              {/* 3. Rodapé separado, igual ao do card da Antecipação: o estado à
                  esquerda, o tempo à direita. */}
              <View className="flex-row items-center justify-between gap-2 border-t border-border pt-2">
                <Badge variant={estagioVariant(item.estagio)}>
                  <Text className="text-[10px]">
                    {ESTAGIO_ANALISE_LABELS[item.estagio as EstagioAnalise] ?? item.estagio}
                  </Text>
                </Badge>
                <Text variant="muted" className="text-xs tabular-nums">
                  {desdeAtualizacao(item.atualizada_em)}
                </Text>
              </View>
            </Pressable>
          )
        }}
      />
    </View>
  )
}
