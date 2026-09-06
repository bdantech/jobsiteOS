import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, LayoutDashboard, Wallet,
} from 'lucide-react-native'
import {
  GRUPO_MEU_DIA_LABELS,
  blocoCatalogado,
  composicaoDoDia,
  itensUrgentes,
  ordenarItens,
  totalDeItens,
  valorEmJogo,
  type GrupoMeuDia,
  type ItemMeuDia,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useConcluirTarefa, useMeuDia, useOcultarItem } from '@/features/comercial/meu-dia'
import { ItemMeuDiaCard } from '@/features/comercial/components/item-meu-dia'
import { cn } from '@/lib/utils'

const brl = (n: number) =>
  n >= 1000
    ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')}k`
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const COR_GRUPO: Record<GrupoMeuDia, string> = {
  funil: 'bg-sky-500',
  conversa: 'bg-violet-500',
  carteira: 'bg-emerald-500',
  credito: 'bg-amber-500',
  cadastro: 'bg-slate-400',
}

/**
 * Meu Dia (04p) — e é no celular que esta tela mais importa: é a primeira coisa aberta
 * no café, antes do computador.
 *
 * A ORDEM É OUTRA, de propósito. Na web os indicadores vêm primeiro; aqui a TIMELINE
 * abre a tela, porque quem pega o telefone de manhã está perguntando "o que eu tenho
 * hoje", e não "quanto vale o meu dia". Os indicadores entram logo abaixo, em carrossel
 * horizontal, e o número grande continua a um olhar de distância.
 *
 * O gráfico de composição vira uma barra fina com legenda tocável — mesma função da web
 * (filtrar os cards), tamanho de celular. E o que na web é menu de três pontos, aqui é
 * SWIPE: a mão que segura o telefone é a mesma que trabalha o item.
 */
export default function MeuDiaScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useMeuDia()
  const ocultar = useOcultarItem()
  const concluir = useConcluirTarefa()
  const [filtro, setFiltro] = useState<GrupoMeuDia | null>(null)

  const compromissos = useMemo(() => {
    if (!data) return []
    return data.blocos
      .flatMap((b) => b.itens)
      .filter((i) => i.quando)
      .sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? ''))
      .slice(0, 6)
  }, [data])

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data.tem_acesso) {
    return (
      <EmptyState
        title="Sem acesso"
        description="O módulo Comercial não está liberado para o seu perfil."
      />
    )
  }
  if (!data.vendedor_id) {
    return (
      <EmptyState
        title="Você não é vendedor"
        description="Seu usuário administra o módulo. O Meu Dia de cada pessoa fica na web."
      />
    )
  }

  const total = totalDeItens(data)
  const urgentes = itensUrgentes(data)
  const emJogo = valorEmJogo(data)
  const composicao = composicaoDoDia(data)

  const blocos = data.blocos
    .filter((b) => b.itens.length > 0)
    .filter((b) => !filtro || blocoCatalogado(b.tipo)?.grupo === filtro)

  function adiar(bloco: string, item: ItemMeuDia, dias: number) {
    const ate = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)
    ocultar.mutate({
      tipoItem: bloco,
      referenciaId: item.referencia_id,
      acao: 'adiado',
      adiadoAte: ate,
      empresaId: item.empresa_id,
      rotulo: blocoCatalogado(bloco)?.rotulo,
    })
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-0.5">
        <Text className="text-xl font-semibold">
          {data.espelhado ? `Carteira de ${data.vendedor_nome ?? '—'}` : 'Meu Dia'}
        </Text>
        <Text variant="muted" className="text-xs">
          {total === 0
            ? 'Nada esperando por você agora.'
            : `${total} ${total === 1 ? 'item' : 'itens'}${
                urgentes.length > 0 ? `, ${urgentes.length} com relógio correndo` : ''
              }`}
        </Text>
      </View>

      {/* A agenda ABRE a tela no celular — é a primeira pergunta de quem acorda. */}
      {compromissos.length > 0 ? (
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-2">
            <CalendarClock size={14} color={colors.mutedForeground} />
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              A agenda de hoje
            </Text>
          </View>
          {compromissos.map((i) => (
            <View key={`${i.referencia_id}-${i.quando}`} className="flex-row items-baseline gap-2">
              <Text className="w-24 text-xs" variant="muted">
                {i.quando
                  ? new Date(i.quando).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </Text>
              <Text numberOfLines={1} className="flex-1 text-sm">
                {i.titulo}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Indicadores em carrossel: o número grande sem ocupar a tela inteira. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 pr-4"
        className="-mx-4 px-4"
      >
        <IndicadorMobile
          Icone={Wallet}
          rotulo="Em jogo hoje"
          valor={brl(emJogo)}
          detalhe={`${total} ${total === 1 ? 'item' : 'itens'}`}
        />
        <IndicadorMobile
          Icone={AlertTriangle}
          rotulo="Urgentes"
          valor={String(urgentes.length)}
          detalhe={urgentes.length > 0 ? 'com relógio correndo' : 'nada vencendo'}
          alerta={urgentes.length > 0}
        />
        {data.tipo === 'sdr' ? (
          <IndicadorMobile
            Icone={Clock}
            rotulo="Inbound sem resposta"
            valor={String(data.blocos.find((b) => b.tipo === 'inbound_nao_contatado')?.total ?? 0)}
            detalhe="minutos importam"
          />
        ) : (
          <IndicadorMobile
            Icone={Wallet}
            rotulo={data.tipo === 'originador' ? 'NF alta parada' : 'Limite ocioso'}
            valor={brl(
              data.blocos.find((b) =>
                b.tipo === (data.tipo === 'originador' ? 'nfs_alta_nao_prospectadas' : 'carteira_ociosa'),
              )?.valor_total ?? 0,
            )}
            detalhe="esperando trabalho"
          />
        )}
      </ScrollView>

      {/* A composição: mesma função da web, tamanho de celular. */}
      {composicao.length > 0 ? (
        <View className="gap-2">
          <View className="h-2 flex-row overflow-hidden rounded-full bg-muted">
            {composicao.map((f) => (
              <View
                key={f.grupo}
                style={{ flex: f.itens }}
                className={cn(COR_GRUPO[f.grupo], filtro && filtro !== f.grupo && 'opacity-25')}
              />
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3">
            {composicao.map((f) => (
              <Pressable
                key={f.grupo}
                onPress={() => setFiltro((a) => (a === f.grupo ? null : f.grupo))}
                className={cn(
                  'flex-row items-center gap-1.5',
                  filtro && filtro !== f.grupo && 'opacity-40',
                )}
              >
                <View className={cn('h-2 w-2 rounded-full', COR_GRUPO[f.grupo])} />
                <Text className="text-xs font-medium">{GRUPO_MEU_DIA_LABELS[f.grupo]}</Text>
                <Text variant="muted" className="text-xs">{f.itens}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Os blocos. Vazio SOME — a tela encolhe conforme o dia é feito. */}
      {blocos.length === 0 ? (
        <Card className="items-center gap-2 p-8">
          <CheckCircle2 size={32} color={colors.primary} />
          <Text className="text-base font-medium">Tudo em dia por aqui</Text>
          <Text variant="muted" className="text-center text-sm">
            {filtro
              ? 'Nada pendente nesta fatia. Toque na legenda para tirar o filtro.'
              : 'Nenhum item pedindo ação agora.'}
          </Text>
        </Card>
      ) : (
        blocos.map((bloco) => (
          <View key={bloco.tipo} className="gap-2">
            <View className="flex-row items-baseline justify-between gap-2">
              <Text className="font-semibold">{blocoCatalogado(bloco.tipo)?.rotulo ?? bloco.tipo}</Text>
              {bloco.valor_total > 0 ? (
                <Text variant="muted" className="text-xs">{brl(bloco.valor_total)}</Text>
              ) : null}
            </View>

            {ordenarItens(bloco.itens).map((item) => (
              <ItemMeuDiaCard
                key={item.referencia_id}
                item={item}
                bloco={bloco.tipo}
                onAdiar={(dias) => adiar(bloco.tipo, item, dias)}
                onDescartar={() =>
                  ocultar.mutate({
                    tipoItem: bloco.tipo,
                    referenciaId: item.referencia_id,
                    acao: 'irrelevante',
                    motivo: 'Marcado como irrelevante no celular',
                    empresaId: item.empresa_id,
                    rotulo: blocoCatalogado(bloco.tipo)?.rotulo,
                  })
                }
                onConcluir={() => concluir.mutate(String(item.meta.tarefa_id))}
              />
            ))}

            {bloco.total > bloco.itens.length ? (
              <Text variant="muted" className="text-xs">
                e mais {bloco.total - bloco.itens.length} — a lista completa está na web
              </Text>
            ) : null}
          </View>
        ))
      )}

      {/*
        O painel do mês fica no rodapé, e não no topo: ele responde "como está o meu mês",
        que é consulta. O que abre a tela é o trabalho de hoje.
      */}
      <Pressable onPress={() => router.push('/comercial/painel')}>
        <Card className="flex-row items-center justify-between p-4">
          <View className="flex-row items-center gap-2">
            <LayoutDashboard size={16} color={colors.mutedForeground} />
            <Text className="font-medium">Meu painel do mês</Text>
          </View>
          <Text variant="muted" className="text-xs">comissão, funis e agenda</Text>
        </Card>
      </Pressable>
    </ScrollView>
  )
}

function IndicadorMobile({
  Icone, rotulo, valor, detalhe, alerta = false,
}: {
  Icone: typeof Wallet
  rotulo: string
  valor: string
  detalhe: string
  alerta?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Card className={cn('w-44 gap-1 p-3', alerta && 'border-red-500/40')}>
      <View className="flex-row items-center gap-1.5">
        <Icone size={12} color={alerta ? colors.destructive : colors.mutedForeground} />
        <Text variant="muted" className="text-[10px] uppercase tracking-wide">
          {rotulo}
        </Text>
      </View>
      <Text className="text-xl font-semibold">{valor}</Text>
      <Text variant="muted" className="text-[11px]">{detalhe}</Text>
    </Card>
  )
}
