import { ESTAGIO_PROSPECCAO_LABELS, formatCnpj, type EstagioProspeccao } from '@jobsiteos/core'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { formatarData, formatarMoeda } from '@/features/antecipacao/format'
import { cn } from '@/lib/utils'
import { STATUS_TEXTO } from '../format'
import { useNotasDoCardQuery, useQuebraFornecedoresQuery } from '../queries'
import type { ConfigProspeccao, QuebraFornecedor, SacadoProspeccao } from '../types'

/**
 * O card do funil de Sacados por NF no celular (04r §5 e §9).
 *
 * ─── OS MESMOS QUATRO NÚMEROS DA WEB, NA ORDEM DA DECISÃO ───────────────────
 *
 * Volume (existe fluxo?) → operável (sobra alguma coisa depois da esteira?) → média e
 * recorrência (isso se repete?). A formatação vem de `features/antecipacao/format`, e é
 * de propósito: as duas abas falam de dinheiro no mesmo dialeto, e um real formatado
 * diferente entre telas irmãs é a coisa que faz alguém conferir na calculadora.
 *
 * ─── SEM SWIPE AQUI ─────────────────────────────────────────────────────────
 *
 * O card do funil de NOTAS tem swipe porque as duas ações dele são frequentes e
 * simétricas (mover / sem interesse). Aqui as ações são assimétricas: "solicitar
 * análise" é rara e definitiva, "pedir ponte" depende de escolher QUAL cedente. Um
 * gesto para escolher entre três fornecedores não existe — o toque abre a quebra, que é
 * onde a escolha mora.
 */

export interface SacadoProspeccaoCardProps {
  sacado: SacadoProspeccao
  config: ConfigProspeccao
  onDescartar: (sacado: SacadoProspeccao) => void
  onSolicitarAnalise: (sacado: SacadoProspeccao) => void
  onPedirPonte: (sacado: SacadoProspeccao, fornecedor: QuebraFornecedor) => void
}

/** As notas de um cedente, com a marca de quem sobrevive à esteira. */
function NotasDoFornecedor({ cnpj, fornecedorCnpj }: { cnpj: string; fornecedorCnpj: string }) {
  const { data, isPending, isError } = useNotasDoCardQuery(cnpj, fornecedorCnpj)

  if (isPending) return <Skeleton className="mt-2 h-12 w-full" />
  if (isError) {
    return (
      <Text variant="muted" className="mt-2 text-xs">
        Não foi possível carregar as notas.
      </Text>
    )
  }
  if (data.notas.length === 0) {
    return (
      <Text variant="muted" className="mt-2 text-xs">
        Nenhuma nota na janela.
      </Text>
    )
  }

  return (
    <View className="mt-2 gap-1 rounded-md border border-dashed border-border p-2">
      {data.notas.map((n) => (
        <View key={n.access_key} className="flex-row items-baseline justify-between gap-2">
          <Text variant="muted" className="text-[11px]">
            {n.numero ?? '—'}
          </Text>
          <Text className="text-[11px] tabular-nums">{formatarMoeda(n.valor)}</Text>
          <Text variant="muted" className="text-[11px]">
            vence {formatarData(n.vencimento)}
          </Text>
          <Text
            className={cn(
              'text-[11px] tabular-nums',
              n.operavel ? STATUS_TEXTO.success : 'text-muted-foreground',
            )}
          >
            {n.dias_para_vencimento === null ? '—' : `${n.dias_para_vencimento}d`}
            {n.operavel ? ' ✓' : ''}
          </Text>
        </View>
      ))}
      <Text variant="muted" className="text-[10px]">
        ✓ = sobra prazo: mais de {data.prazo_minimo_operavel_dias} dias de vida, que é o tempo da
        esteira mais a margem.
      </Text>
    </View>
  )
}

export function SacadoProspeccaoCard({
  sacado,
  config,
  onDescartar,
  onSolicitarAnalise,
  onPedirPonte,
}: SacadoProspeccaoCardProps) {
  const { colors } = useTheme()
  const [aberto, setAberto] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const quebra = useQuebraFornecedoresQuery(aberto ? (sacado.id ?? undefined) : undefined)

  const estagio = (sacado.estagio ?? 'identificado') as EstagioProspeccao
  const janelaMeses = config.janelas.janela_recorrencia_meses
  const fragil = Number(sacado.score_completude ?? 0) < 0.5 && sacado.score_credito !== null

  return (
    <View className="gap-2 rounded-xl border border-border bg-card p-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-medium">
            {sacado.sacado_nome ?? '—'}
          </Text>
          <Text variant="muted" className="text-xs tabular-nums">
            {sacado.cnpj_sacado ? formatCnpj(sacado.cnpj_sacado) : '—'}
            {sacado.municipio || sacado.uf
              ? ` · ${[sacado.municipio, sacado.uf].filter(Boolean).join(' / ')}`
              : ''}
          </Text>
        </View>
        <Badge variant="outline">
          <Text className="text-[10px]">{ESTAGIO_PROSPECCAO_LABELS[estagio]}</Text>
        </Badge>
      </View>

      {/* O score HONESTO: 72 sobre completude de 45% aparece marcado como frágil. */}
      <View className="flex-row flex-wrap items-center gap-1.5">
        {sacado.score_credito === null ? (
          <Badge variant="outline">
            <Text className="text-[10px]">Sem score</Text>
          </Badge>
        ) : (
          <Badge variant="outline">
            <Text
              className={cn(
                'text-[10px]',
                fragil ? STATUS_TEXTO.warning : STATUS_TEXTO.success,
              )}
            >
              Score {Number(sacado.score_credito).toFixed(0)}
              {fragil ? ' · frágil' : ''}
            </Text>
          </Badge>
        )}
        {sacado.analise_estagio ? (
          <Badge variant="outline">
            <Text className="text-[10px]">Esteira: {sacado.analise_estagio}</Text>
          </Badge>
        ) : null}
      </View>

      {/* Os quatro números */}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <View>
          <Text variant="muted" className="text-[10px]">
            Volume {config.janelas.janela_emissao_dias}d
          </Text>
          <Text className="text-sm font-semibold tabular-nums">
            {formatarMoeda(sacado.volume_30d)}
          </Text>
        </View>
        <View>
          <Text variant="muted" className="text-[10px]">
            Operável
          </Text>
          <Text
            className={cn(
              'text-sm font-semibold tabular-nums',
              Number(sacado.valor_operavel ?? 0) > 0 ? STATUS_TEXTO.success : 'text-muted-foreground',
            )}
          >
            {formatarMoeda(sacado.valor_operavel)}
          </Text>
        </View>
        <View>
          <Text variant="muted" className="text-[10px]">
            Média ({janelaMeses}m)
          </Text>
          <Text className="text-sm font-semibold tabular-nums">
            {formatarMoeda(sacado.media_mensal_6m)}
          </Text>
        </View>
        <View>
          <Text variant="muted" className="text-[10px]">
            Recorrência
          </Text>
          <Text className="text-sm font-semibold tabular-nums">
            {sacado.meses_com_emissao_6m ?? 0}/{janelaMeses}
          </Text>
        </View>
      </View>

      <View className="flex-row items-baseline justify-between border-t border-border pt-2">
        <Text variant="muted" className="text-xs">
          Valor esperado
        </Text>
        <Text className="text-sm font-semibold tabular-nums">
          {formatarMoeda(sacado.valor_esperado_mensal)}/mês
        </Text>
      </View>

      {/* A quebra por cedente — o coração do card */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: aberto }}
        onPress={() => setAberto((v) => !v)}
        className="flex-row items-center gap-1 py-1 active:opacity-70"
      >
        {aberto ? (
          <ChevronDown size={14} color={colors.mutedForeground} />
        ) : (
          <ChevronRight size={14} color={colors.mutedForeground} />
        )}
        <Text variant="muted" className="text-xs">
          De onde vem o volume ({sacado.qtd_fornecedores ?? 0} cedente
          {(sacado.qtd_fornecedores ?? 0) === 1 ? '' : 's'})
        </Text>
      </Pressable>

      {aberto ? (
        <View className="gap-2">
          {quebra.isPending ? <Skeleton className="h-14 w-full" /> : null}
          {(quebra.data ?? []).map((f) => (
            <View key={f.id} className="gap-1 rounded-lg border border-border p-2">
              <View className="flex-row items-start justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-xs font-medium">
                    {f.fornecedor_nome ?? formatCnpj(f.fornecedor_cnpj)}
                  </Text>
                  <Text variant="muted" className="text-[11px] tabular-nums">
                    {formatarMoeda(f.valor_30d)} · {f.qtd_nfs_30d ?? 0} nota
                    {(f.qtd_nfs_30d ?? 0) === 1 ? '' : 's'} · última {formatarData(f.ultima_nf_em)}
                  </Text>
                </View>
                {f.na_carteira_do_originador ? (
                  <View className="flex-row items-center gap-1">
                    <Sparkles size={11} color={colors.mutedForeground} />
                    <Text className={cn('text-[10px]', STATUS_TEXTO.success)}>Sua carteira</Text>
                  </View>
                ) : null}
              </View>

              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPedirPonte(sacado, f)}
                  className="rounded-md border border-border px-2 py-1 active:opacity-70"
                >
                  <Text className="text-[11px]">Pedir apresentação</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setExpandido((v) => (v === f.fornecedor_cnpj ? null : f.fornecedor_cnpj))
                  }
                  className="rounded-md px-2 py-1 active:opacity-70"
                >
                  <Text variant="muted" className="text-[11px]">
                    {expandido === f.fornecedor_cnpj ? 'Ocultar notas' : 'Ver notas'}
                  </Text>
                </Pressable>
              </View>

              {expandido === f.fornecedor_cnpj ? (
                <NotasDoFornecedor
                  cnpj={sacado.cnpj_sacado as string}
                  fornecedorCnpj={f.fornecedor_cnpj}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View className="flex-row gap-2 border-t border-border pt-2">
        <Pressable
          accessibilityRole="button"
          onPress={() => onSolicitarAnalise(sacado)}
          className="flex-1 items-center rounded-md bg-primary px-2 py-2 active:opacity-70"
        >
          <Text className="text-xs font-medium text-primary-foreground">Solicitar análise</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onDescartar(sacado)}
          className="items-center rounded-md border border-border px-3 py-2 active:opacity-70"
        >
          <Text className="text-xs">Descartar</Text>
        </Pressable>
      </View>
    </View>
  )
}
