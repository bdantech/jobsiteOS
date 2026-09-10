import { MODO_AGENTE_LABELS, type ModoAgente } from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Bot, Link2Off, Mail, MessageCircle } from 'lucide-react-native'
import * as React from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge, EmptyState, ErrorState, Skeleton, Text } from '@/components/ui'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import {
  buscarConversas,
  comunicacaoKeys,
  type AbaMobile,
  type ConversaInbox,
} from '../api'
import { desde, identificadorLegivel, intencaoLabel } from '../format'
import { useEscopoFila, useNaoVinculadas } from '../hooks'

/**
 * As duas abas do inbox, como controle segmentado — o padrão da Antecipação.
 *
 * Aqui isto corrigiu um BUG, não só a aparência: o <Badge> recebia a string do
 * rótulo como filho direto, e Badge renderiza uma <View>. Texto solto dentro de
 * <View> derruba o React Native com "Text strings must be rendered within a
 * <Text> component" — todo o resto do app embrulha o rótulo em <Text>, e só este
 * ponto não embrulhava.
 */
const ABAS: readonly OpcaoFiltro<AbaMobile>[] = [
  { valor: 'nao_lidas', label: 'Não lidas' },
  { valor: 'todas', label: 'Todas' },
]

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
  /*
   * Desde a 0196 a thread é do par (nossa conta, contato): o mesmo contato pode
   * ocupar duas linhas, uma por número nosso. A etiqueta só entra quando há mais
   * de uma conta na lista — com um número só ela não distingue nada e ocuparia a
   * linha da empresa em toda conversa.
   */
  const variasContas = React.useMemo(
    () => new Set((conversas.data ?? []).map((c) => c.conta_rotulo).filter(Boolean)).size > 1,
    [conversas.data],
  )
  /*
   * A tarja conta a MESMA fila que a tela de identificação lista — pelo mesmo
   * hook, e não por uma segunda consulta. Duas resoluções independentes de "de
   * quem é a fila" acabariam com a tarja dizendo 8 e a tela abrindo com 3.
   */
  const escopo = useEscopoFila()
  const pendentes = useNaoVinculadas(escopo.vendedorId)

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
      <View className="py-3">
        <FiltroSegmentado opcoes={ABAS} valor={aba} onChange={setAba} />
      </View>

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
            <LinhaConversa c={item} mostrarConta={variasContas} />
          </Pressable>
        )}
      />
    </View>
  )
}

function LinhaConversa({ c, mostrarConta }: { c: ConversaInbox; mostrarConta: boolean }) {
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
        {mostrarConta && c.conta_rotulo ? ` · por ${c.conta_rotulo}` : ''}
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
