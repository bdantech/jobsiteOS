import { MODO_AGENTE_LABELS, type ModoAgente } from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Bot, Link2Off, Mail, MessageCircle } from 'lucide-react-native'
import * as React from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui'
import {
  buscarConversas,
  buscarNaoVinculadas,
  comunicacaoKeys,
  type AbaMobile,
  type ConversaInbox,
} from '../api'
import { desde, identificadorLegivel, intencaoLabel } from '../format'

/**
 * O inbox no celular.
 *
 * ── LISTA E DETALHE EM TELAS SEPARADAS, AO CONTRÁRIO DA WEB ────────────────
 * Duas colunas em 6" seriam duas colunas ilegíveis. A navegação de volta guarda o
 * lugar na fila, que é o que a coluna fixa da web resolve — o mesmo problema,
 * duas soluções, cada uma para a tela que tem.
 *
 * ── A FILA DE IDENTIFICAÇÃO VEM NO TOPO ────────────────────────────────────
 * É a única coisa aqui que ninguém mais vai fazer por você: uma resposta não lida
 * espera; um decisor não identificado some.
 */
export function Inbox() {
  const router = useRouter()
  const { colors } = useTheme()
  const [aba, setAba] = React.useState<AbaMobile>('nao_lidas')

  const conversas = useQuery({
    queryKey: comunicacaoKeys.inbox(aba),
    queryFn: () => buscarConversas(aba),
  })
  const pendentes = useQuery({
    queryKey: comunicacaoKeys.naoVinculadas(),
    queryFn: buscarNaoVinculadas,
  })

  if (conversas.isPending) {
    return (
      <View className="gap-3 p-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </View>
    )
  }

  if (conversas.isError) {
    return (
      <ErrorState title="Não foi possível carregar o inbox" onRetry={() => void conversas.refetch()} />
    )
  }

  const naoVinculadas = pendentes.data?.length ?? 0

  return (
    <View className="flex-1">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 py-3"
      >
        {(['nao_lidas', 'todas'] as const).map((a) => (
          <Pressable key={a} onPress={() => setAba(a)}>
            <Badge variant={aba === a ? 'default' : 'outline'}>
              {a === 'nao_lidas' ? 'Não lidas' : 'Todas'}
            </Badge>
          </Pressable>
        ))}
      </ScrollView>

      {naoVinculadas > 0 ? (
        <Pressable
          onPress={() => router.push('/comunicacao/nao-vinculadas')}
          className="mx-4 mb-3 flex-row items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
        >
          <Link2Off size={16} color={colors.mutedForeground} />
          <Text className="flex-1 text-sm">
            <Text className="font-medium">
              {naoVinculadas} conversa{naoVinculadas === 1 ? '' : 's'}
            </Text>{' '}
            aguardando identificação
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={conversas.data ?? []}
        keyExtractor={(c) => c.id ?? ''}
        contentContainerClassName="px-4 pb-8 gap-2"
        refreshControl={
          <RefreshControl refreshing={conversas.isFetching} onRefresh={() => void conversas.refetch()} />
        }
        ListEmptyComponent={
          <EmptyState
            title={aba === 'nao_lidas' ? 'Nada por ler' : 'Nenhuma conversa'}
            description="O que chegar por WhatsApp ou e-mail aparece aqui."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/comunicacao/${item.id}`)}
            className="rounded-xl border border-border bg-card p-3"
          >
            <LinhaConversa c={item} />
          </Pressable>
        )}
      />
    </View>
  )
}

function LinhaConversa({ c }: { c: ConversaInbox }) {
  const { colors } = useTheme()
  const Icone = c.canal === 'email' ? Mail : MessageCircle
  const intencao = intencaoLabel(c.ultima_triagem)

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          <Icone size={14} color={colors.mutedForeground} />
          <Text className="flex-1 font-medium" numberOfLines={1}>
            {c.contato_nome ?? identificadorLegivel(c.canal ?? '', c.identificador_externo ?? '')}
          </Text>
          {c.responsavel_is_ia ? <Bot size={13} color={colors.primary} /> : null}
        </View>
        <Text variant="muted" className="text-xs">
          {desde(c.ultima_mensagem_em)}
        </Text>
      </View>

      <Text variant="muted" className="text-xs" numberOfLines={1}>
        {c.empresa_nome ?? 'Empresa não identificada'}
      </Text>

      <View className="flex-row items-center gap-2">
        <Text variant="muted" className="flex-1 text-xs" numberOfLines={1}>
          {c.ultima_por_ia ? '🤖 ' : ''}
          {c.ultima_preview ?? '—'}
        </Text>
        {(c.nao_lidas ?? 0) > 0 ? <Badge>{String(c.nao_lidas)}</Badge> : null}
      </View>

      <View className="flex-row flex-wrap gap-1">
        {intencao ? <Badge variant="outline">{intencao}</Badge> : null}
        {c.sugestao_id ? <Badge variant="outline">próximo passo sugerido</Badge> : null}
        {c.modo_agente && c.modo_agente !== 'sugestao' ? (
          <Badge variant="outline">
            {MODO_AGENTE_LABELS[c.modo_agente as ModoAgente] ?? c.modo_agente}
          </Badge>
        ) : null}
      </View>
    </View>
  )
}
