import { formatCnpj } from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Mail, MessageCircle, X } from 'lucide-react-native'
import * as React from 'react'
import { FlatList, Pressable, RefreshControl, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge, Button, EmptyState, Input, Skeleton, Text } from '@/components/ui'
import {
  buscarEmpresas,
  buscarNaoVinculadas,
  comunicacaoKeys,
  ignorar,
  vincular,
  type NaoVinculada,
} from '../api'
import { desde, identificadorLegivel } from '../format'

/**
 * A fila de identificação no celular (§4).
 *
 * O nome vem pré-preenchido com o `pushName` — pedir para digitar do zero num
 * teclado de telefone é o atrito que faz a fila acumular, e uma fila acumulada é
 * o mesmo que não ter fila.
 */
export function FilaNaoVinculadas() {
  const qc = useQueryClient()
  const fila = useQuery({ queryKey: comunicacaoKeys.naoVinculadas(), queryFn: buscarNaoVinculadas })

  if (fila.isPending) {
    return (
      <View className="gap-3 p-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </View>
    )
  }

  return (
    <FlatList
      data={fila.data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerClassName="p-4 gap-3 pb-8"
      refreshControl={
        <RefreshControl refreshing={fila.isFetching} onRefresh={() => void fila.refetch()} />
      }
      ListEmptyComponent={
        <EmptyState
          title="Ninguém esperando identificação"
          description="Toda conversa recebida está vinculada a uma empresa."
        />
      }
      renderItem={({ item }) => (
        <Cartao n={item} onResolvida={() => qc.invalidateQueries({ queryKey: comunicacaoKeys.all })} />
      )}
    />
  )
}

function Cartao({ n, onResolvida }: { n: NaoVinculada; onResolvida: () => void }) {
  const { colors } = useTheme()
  const [busca, setBusca] = React.useState('')
  const [empresa, setEmpresa] = React.useState<{ id: string; cnpj: string; nome: string } | null>(null)
  const [nome, setNome] = React.useState(n.nome_sugerido ?? '')
  const [erro, setErro] = React.useState<string | null>(null)

  const achadas = useQuery({
    queryKey: ['comunicacao', 'busca-empresa', busca],
    queryFn: () => buscarEmpresas(busca),
    enabled: busca.trim().length >= 3 && !empresa,
  })

  const acaoVincular = useMutation({
    mutationFn: () => vincular({ id: n.id, empresa_id: empresa!.id, nome: nome.trim() }),
    onSuccess: onResolvida,
    onError: (e: Error) => setErro(e.message),
  })
  const acaoIgnorar = useMutation({ mutationFn: () => ignorar(n.id), onSuccess: onResolvida })

  const Icone = n.canal === 'email' ? Mail : MessageCircle

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
          <Icone size={14} color={colors.mutedForeground} />
          <Text className="flex-1 font-medium" numberOfLines={1}>
            {n.nome_sugerido ?? identificadorLegivel(n.canal, n.identificador_externo)}
          </Text>
        </View>
        <Badge variant="outline">{`${n.qtd_mensagens} msg`}</Badge>
      </View>
      <Text variant="muted" className="text-xs">
        {identificadorLegivel(n.canal, n.identificador_externo)} · {desde(n.ultima_mensagem_em)}
      </Text>

      {empresa ? (
        <Pressable onPress={() => setEmpresa(null)}>
          <View className="rounded-lg border border-border p-2.5">
            <Text className="text-sm">{empresa.nome}</Text>
            <Text variant="muted" className="text-xs">
              {formatCnpj(empresa.cnpj)} · toque para trocar
            </Text>
          </View>
        </Pressable>
      ) : (
        <>
          <Input value={busca} onChangeText={setBusca} placeholder="Buscar empresa por nome ou CNPJ" />
          {(achadas.data ?? []).map((e) => (
            <Pressable
              key={e.id}
              onPress={() =>
                setEmpresa({ id: e.id, cnpj: e.cnpj, nome: e.razao_social ?? e.nome_fantasia ?? e.cnpj })
              }
              className="rounded-lg border border-border p-2.5"
            >
              <Text className="text-sm">{e.razao_social ?? e.nome_fantasia}</Text>
              <Text variant="muted" className="text-xs">
                {formatCnpj(e.cnpj)}
              </Text>
            </Pressable>
          ))}
        </>
      )}

      <Input value={nome} onChangeText={setNome} label="Nome do contato" />

      {erro ? <Text className="text-xs text-destructive">{erro}</Text> : null}

      <View className="flex-row gap-2">
        <Button
          size="sm"
          onPress={() => acaoVincular.mutate()}
          disabled={!empresa || !nome.trim() || acaoVincular.isPending}
        >
          <Link2 size={14} color="#fff" />
          <Text>Vincular</Text>
        </Button>
        <Button size="sm" variant="ghost" onPress={() => acaoIgnorar.mutate()} disabled={acaoIgnorar.isPending}>
          <X size={14} color={colors.mutedForeground} />
          <Text>Ignorar</Text>
        </Button>
      </View>
    </View>
  )
}
