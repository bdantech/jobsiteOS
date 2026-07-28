import {
  EVENTO_LABELS,
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  formatCnpj,
  normalizeCnpj,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Building2, Star } from 'lucide-react-native'
import { ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { CadastroRfbCard } from '@/features/cadastro/cadastro-rfb-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  AcoesContato,
  DetalheSkeleton,
  NotaCard,
  creditoVariant,
  formatarDataHora,
  formatarMoeda,
  labelCredito,
  useDetalheFornecedorQuery,
  useMinimoOperavelQuery,
} from '@/features/antecipacao'

/**
 * Detalhe do fornecedor (§9): todas as notas vivas, o contexto de crédito do sacado,
 * o histórico de toques e as ações de um toque.
 *
 * Existe porque o FORNECEDOR é a unidade de abordagem. Sem esta tela, o vendedor
 * liga com a informação de UM card e descobre as outras quatro notas durante a
 * ligação — e não sabe que alguém já ligou anteontem.
 *
 * As ações de contato ficam no TOPO, fixas: é o que a pessoa veio fazer.
 */
export default function FornecedorScreen() {
  const { cnpj: cnpjParam } = useLocalSearchParams<{ cnpj: string }>()
  const cnpj = normalizeCnpj(cnpjParam ?? '')
  const router = useRouter()
  const { colors } = useTheme()

  const { data, isPending, isError, refetch } = useDetalheFornecedorQuery(cnpj || undefined)
  const { data: minimoOperavel = 7 } = useMinimoOperavelQuery()

  if (isPending) return <DetalheSkeleton />

  if (isError) {
    return (
      <ErrorState
        description="Não foi possível carregar este fornecedor. Verifique sua conexão e tente novamente."
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
  const nome = data.fornecedor?.fornecedor_nome ?? primeira?.fornecedor_nome ?? formatCnpj(cnpj)
  const tipagem = (data.fornecedor?.fornecedor_tipagem ?? primeira?.fornecedor_tipagem) as
    | Tipagem
    | null
  const empresaId = data.fornecedor?.fornecedor_empresa_id ?? primeira?.fornecedor_empresa_id ?? null

  const vivas = data.notas.filter((n) => n.faixa !== null)
  const valorTotal = data.notas.reduce((s, n) => s + Number(n.valor ?? 0), 0)
  const receitaTotal = data.notas.reduce((s, n) => s + Number(n.receita_esperada ?? 0), 0)
  const pontoFocal = data.contatos.find((c) => c.ponto_focal)

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-12">
      {/* ─── Identidade + números ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{nome}</CardTitle>
          <Text variant="muted" className="tabular-nums">
            {formatCnpj(cnpj)}
          </Text>
          <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
            {tipagem ? (
              <Badge variant="secondary">
                <Text className="text-[11px]">{TIPAGEM_LABELS[tipagem]}</Text>
              </Badge>
            ) : null}
            {data.fornecedor?.melhor_faixa ? (
              <Badge variant="default">
                <Text className="text-[11px]">
                  Faixa {FAIXA_LABELS[data.fornecedor.melhor_faixa as Faixa]}
                </Text>
              </Badge>
            ) : null}
            {data.fornecedor?.fornecedor_suprimido ? (
              <Badge variant="destructive">
                <Text className="text-[11px]">Suprimido</Text>
              </Badge>
            ) : null}
          </View>
        </CardHeader>

        <CardContent className="gap-3">
          <View className="flex-row justify-between">
            <View>
              <Text variant="muted" className="text-xs">
                Notas vivas
              </Text>
              <Text className="text-lg font-semibold tabular-nums">
                {vivas.length}
                <Text variant="muted" className="text-sm"> de {data.notas.length}</Text>
              </Text>
            </View>
            <View className="items-end">
              <Text variant="muted" className="text-xs">
                Valor total
              </Text>
              <Text className="text-lg font-semibold tabular-nums">{formatarMoeda(valorTotal)}</Text>
            </View>
            <View className="items-end">
              <Text variant="muted" className="text-xs">
                Receita esperada
              </Text>
              <Text className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                {formatarMoeda(receitaTotal)}
              </Text>
            </View>
          </View>

          <Separator />

          {/* ─── Ações de um toque ──────────────────────────────────────── */}
          <View className="gap-2">
            {pontoFocal ? (
              <View className="flex-row items-center gap-1.5">
                <Star size={12} color={colors.mutedForeground} />
                <Text variant="muted" className="text-xs">
                  Ponto focal: {pontoFocal.nome ?? pontoFocal.email ?? pontoFocal.telefone}
                </Text>
              </View>
            ) : null}

            <AcoesContato
              cnpj={cnpj}
              contatos={data.contatos}
              mensagem={data.mensagemSugerida}
              accessKey={primeira?.access_key ?? null}
            />
          </View>

          {empresaId ? (
            <Button
              variant="outline"
              onPress={() => router.push(`/empresas/${empresaId}`)}
              accessibilityLabel="Abrir a ficha completa da empresa"
            >
              <Building2 size={18} color={colors.foreground} />
              <Text>Abrir Company 360</Text>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Cadastro da Receita: "vale a pena?" antes de "para quem eu ligo?". */}
      <CadastroRfbCard cnpj={cnpj} />

      {/* ─── Crédito do sacado por nota ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Crédito dos sacados</CardTitle>
          <Text variant="muted">
            É o limite do sacado que decide se a nota é operável — não o interesse do fornecedor.
          </Text>
        </CardHeader>
        <CardContent className="gap-2">
          {[...new Map(data.notas.map((n) => [n.sacado_cnpj, n])).values()].map((n) => (
            <View
              key={n.sacado_cnpj}
              className="flex-row items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
            >
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-sm font-medium">
                  {n.sacado_nome ?? n.sacado_cnpj}
                </Text>
                <Text variant="muted" className="text-xs tabular-nums">
                  disponível {formatarMoeda(n.sacado_limite_disponivel)}
                </Text>
              </View>
              <Badge variant={creditoVariant(n.sacado_credito_status)}>
                <Text className="text-[10px]">{labelCredito(n.sacado_credito_status)}</Text>
              </Badge>
            </View>
          ))}
        </CardContent>
      </Card>

      {/* ─── Histórico de toques ─────────────────────────────────────────── */}
      {data.toques.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de toques</CardTitle>
            <Text variant="muted">
              Toques manuais e mensagens geradas em modo sombra. O cooldown da régua enxerga os dois.
            </Text>
          </CardHeader>
          <CardContent className="gap-2">
            {data.toques.map((t) => {
              const payload = (t.payload ?? {}) as Record<string, unknown>
              return (
                <View key={t.id} className="gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <Text className="text-sm font-medium">{EVENTO_LABELS[t.tipo] ?? t.tipo}</Text>
                    <Text variant="muted" className="text-[11px] tabular-nums">
                      {formatarDataHora(t.criado_em)}
                    </Text>
                  </View>
                  {typeof payload.resumo === 'string' ? (
                    <Text variant="muted" className="text-xs">
                      {payload.resumo}
                    </Text>
                  ) : null}
                </View>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ─── As notas ────────────────────────────────────────────────────── */}
      <View className="gap-3">
        <Text variant="muted" className="text-xs font-medium uppercase">
          Notas ({data.notas.length})
        </Text>
        {data.notas.map((n) => (
          <NotaCard key={n.access_key} nota={n} minimoOperavel={minimoOperavel} />
        ))}
      </View>
    </ScrollView>
  )
}
