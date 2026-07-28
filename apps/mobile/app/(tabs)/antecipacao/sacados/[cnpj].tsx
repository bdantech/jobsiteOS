import { formatCnpj, normalizeCnpj } from '@jobsiteos/core'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Building2, Sparkles } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  DetalheSkeleton,
  NotaDocumentoSheet,
  creditoVariant,
  formatarData,
  formatarMoeda,
  labelCredito,
  useDetalheSacadoQuery,
  type NotaFunil,
} from '@/features/antecipacao'

/**
 * O sacado e as notas que ELE RECEBEU — leitura.
 *
 * Uma tela, dois caminhos: "Por sacado" (capacidade) e "A prospectar" (volume).
 * As duas leituras agregadas vêm juntas, porque voltar para descobrir a outra
 * metade é pior que uma consulta a mais.
 *
 * Promover para Empresas é ação de escritório e fica no web: envolve decidir que
 * a construtora entra no CRM.
 */
export default function SacadoScreen() {
  const { cnpj: cnpjParam } = useLocalSearchParams<{ cnpj: string }>()
  const cnpj = normalizeCnpj(cnpjParam ?? '')
  const router = useRouter()
  const { colors } = useTheme()
  const [nota, setNota] = useState<NotaFunil | null>(null)

  const { data, isPending, isError, refetch } = useDetalheSacadoQuery(cnpj || undefined)

  if (isPending) return <DetalheSkeleton />

  if (isError) {
    return (
      <ErrorState
        description="Não foi possível carregar este sacado. Verifique sua conexão e tente novamente."
        onRetry={() => void refetch()}
      />
    )
  }

  if (data.notas.length === 0) {
    return (
      <EmptyState
        title="Nenhuma nota para este CNPJ"
        description="Ele pode não ter notas sincronizadas, ou você pode não ter acesso a elas."
      />
    )
  }

  const primeira = data.notas[0]
  const nome =
    data.prospect?.sacado_nome ?? data.sacado?.sacado_nome ?? primeira?.sacado_nome ?? formatCnpj(cnpj)
  const empresaId =
    data.sacado?.sacado_empresa_id ?? data.prospect?.sacado_empresa_id ?? primeira?.sacado_empresa_id ?? null
  const naPlataforma = primeira?.sacado_cadastrado ?? false

  const valorTotal = data.notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const fornecedores = new Set(data.notas.map((n) => n.fornecedor_cnpj).filter(Boolean)).size
  const demanda = Number(data.sacado?.demanda_pipeline ?? 0)
  const disponivel = Number(data.sacado?.available_limit ?? 0)

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-12">
      <Card>
        <CardHeader>
          <CardTitle>{nome}</CardTitle>
          <Text variant="muted" className="tabular-nums">
            {formatCnpj(cnpj)}
            {data.prospect?.sacado_municipio || data.prospect?.sacado_uf
              ? ` · ${[data.prospect.sacado_municipio, data.prospect.sacado_uf].filter(Boolean).join(' / ')}`
              : ''}
          </Text>
          <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
            <Badge variant={naPlataforma ? 'secondary' : 'outline'}>
              <Text className="text-[10px]">
                {naPlataforma ? 'Na plataforma' : 'Fora da plataforma'}
              </Text>
            </Badge>
            {data.prospect?.sacado_cnae_principal ? (
              <Badge variant="outline">
                <Text className="text-[10px]">CNAE {data.prospect.sacado_cnae_principal}</Text>
              </Badge>
            ) : null}
            {primeira?.sacado_credito_status ? (
              <Badge variant={creditoVariant(primeira.sacado_credito_status)}>
                <Text className="text-[10px]">{labelCredito(primeira.sacado_credito_status)}</Text>
              </Badge>
            ) : null}
          </View>
        </CardHeader>

        <CardContent className="gap-3">
          <View className="flex-row justify-between">
            <View>
              <Text variant="muted" className="text-xs">
                Notas recebidas
              </Text>
              <Text className="text-lg font-semibold tabular-nums">{data.notas.length}</Text>
            </View>
            <View className="items-end">
              <Text variant="muted" className="text-xs">
                Valor recebido
              </Text>
              <Text className="text-lg font-semibold tabular-nums">{formatarMoeda(valorTotal)}</Text>
            </View>
            <View className="items-end">
              <Text variant="muted" className="text-xs">
                Fornecedores
              </Text>
              <Text className="text-lg font-semibold tabular-nums">{fornecedores}</Text>
            </View>
          </View>

          {demanda > 0 ? (
            <>
              <Separator />
              <View>
                <Text variant="muted" className="text-xs">
                  Pipeline em faixa vs. limite disponível
                </Text>
                <Text className="text-sm tabular-nums">
                  {formatarMoeda(demanda)} de {formatarMoeda(disponivel)}
                  {demanda > disponivel ? (
                    <Text className="font-semibold text-destructive">
                      {' '}
                      — excede {formatarMoeda(demanda - disponivel)}
                    </Text>
                  ) : (
                    <Text variant="muted"> — cabe</Text>
                  )}
                </Text>
              </View>
            </>
          ) : null}

          {(data.prospect?.notas_de_quem_ja_antecipou ?? 0) > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={12} color={colors.mutedForeground} />
              <Text className="text-xs text-emerald-700 dark:text-emerald-300">
                {data.prospect?.notas_de_quem_ja_antecipou} nota(s) de fornecedores que já antecipam
                — cada uma é uma porta de entrada.
              </Text>
            </View>
          ) : null}

          {empresaId ? (
            <Button variant="outline" onPress={() => router.push(`/empresas/${empresaId}`)}>
              <Building2 size={18} color={colors.foreground} />
              <Text>Abrir Company 360</Text>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <View className="gap-2">
        <Text variant="muted" className="text-xs font-medium uppercase">
          Notas recebidas ({data.notas.length})
        </Text>
        {data.notas.map((n) => (
          <Pressable
            key={n.access_key}
            onPress={() => setNota(n)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir a nota ${n.numero ?? ''}`}
            className="gap-1 rounded-xl border border-border bg-card p-3 active:opacity-70"
          >
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium">
                  {n.fornecedor_nome ?? n.fornecedor_cnpj}
                </Text>
                <Text variant="muted" className="text-xs tabular-nums">
                  {n.tipo_nf ?? 'NFe'} nº {n.numero ?? '—'}
                  {n.serie ? `/${n.serie}` : ''} · emitida {formatarData(n.emitida_em)}
                </Text>
              </View>
              <Text className="font-semibold tabular-nums">{formatarMoeda(n.valor)}</Text>
            </View>
            <Text variant="muted" className="text-[11px]">
              vence {formatarData(n.vencimento)}
              {n.faixa ? ` · faixa ${n.faixa}` : n.faixa_motivo ? ` · ${n.faixa_motivo}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {nota?.access_key ? (
        <NotaDocumentoSheet
          accessKey={nota.access_key}
          titulo={`Nota ${nota.numero ?? nota.access_key}${nota.serie ? `/${nota.serie}` : ''}`}
          subtitulo={`${nota.fornecedor_nome ?? nota.fornecedor_cnpj} → ${nome}`}
          open
          onOpenChange={(v) => !v && setNota(null)}
        />
      ) : null}
    </ScrollView>
  )
}
