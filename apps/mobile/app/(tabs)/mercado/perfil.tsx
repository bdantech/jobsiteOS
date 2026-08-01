import {
  AVISO_VIES,
  TRILHAS,
  TRILHA_LABELS,
  TRILHA_PERGUNTAS,
  comparacao as acharComparacao,
  fraseAchado,
  fraseConversaoForaDeFaixa,
  variavelPerfil,
  type AchadoContraste,
  type Trilha,
} from '@jobsiteos/core'
import { useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { usePerfilQuery, type SnapshotPerfilMobile } from '@/features/mercado/perfil'

/**
 * Perfil de Quem Opera — LEITURA (04f §7).
 *
 * Resumo, top achados e auditoria. Sugestões e recálculo são webOnly: aceitar
 * uma sugestão abre um editor de árvore de regra, que é a tela que menos cabe num
 * telefone. O contador de sugestões pendentes aparece, porque saber que existem
 * três esperando é útil mesmo sem poder resolvê-las aqui.
 *
 * As BARRAS são o produto, como no web. Um lift de 3,2 não diz nada para quem não
 * lida com razão de prevalência; duas barras, uma três vezes maior que a outra,
 * dizem para qualquer pessoa.
 */
export default function PerfilScreen() {
  const [trilha, setTrilha] = useState<Trilha>('sacados')
  const { data, isPending, isError, refetch, isRefetching } = usePerfilQuery(trilha)

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row gap-2 border-b border-border p-4">
        {TRILHAS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTrilha(t)}
            accessibilityRole="button"
            accessibilityState={{ selected: trilha === t }}
            className={`rounded-full px-3 py-1.5 ${trilha === t ? 'bg-primary' : 'bg-muted'}`}
          >
            <Text
              className={`text-sm ${trilha === t ? 'font-medium text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {TRILHA_LABELS[t]}
            </Text>
          </Pressable>
        ))}
      </View>

      {isError ? (
        <ErrorState
          description="Não foi possível carregar o perfil. Verifique sua conexão e tente novamente."
          onRetry={() => void refetch()}
        />
      ) : isPending ? (
        <View className="p-4">
          <Text variant="muted">Carregando…</Text>
        </View>
      ) : data.length === 0 ? (
        <EmptyState
          title="Perfil ainda não calculado"
          description="O cálculo roda uma vez por mês, depois das calibrações de faturamento e de crédito. Ele pode ser antecipado pela versão web."
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-6 p-4 pb-12"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
        >
          <Text variant="muted" className="text-sm">
            {TRILHA_PERGUNTAS[trilha]}
          </Text>

          {data.map((s) => (
            <Comparacao key={s.id} snapshot={s} />
          ))}

          <View className="rounded-lg border border-dashed border-border p-3">
            <Text variant="muted" className="text-xs leading-relaxed">
              {AVISO_VIES}
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function Comparacao({ snapshot: s }: { snapshot: SnapshotPerfilMobile }) {
  const meta = acharComparacao(s.comparacao)

  return (
    <View className="gap-3">
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-base font-semibold text-foreground">
            {meta?.label ?? s.comparacao}
          </Text>
          <Badge variant="secondary">
            <Text className="text-xs">
              {s.coorte_a} × {s.coorte_b}
            </Text>
          </Badge>
        </View>
        <Text className="text-sm leading-relaxed text-foreground">{s.resumo}</Text>
      </View>

      {s.achados.map((a) => (
        <AchadoItem key={a.variavel} achado={a} rotuloA={s.rotulo_a} rotuloB={s.rotulo_b} />
      ))}

      {s.auditoria?.camadas.map((c) => (
        <View key={c.camada} className="rounded-lg border border-border p-3">
          <Text className="text-sm font-medium text-foreground">
            {c.total === 0
              ? `Nenhum ${c.coorte} para rodar pela regra de ${c.camada.toUpperCase()}.`
              : `${Math.round((c.nao_passam / c.total) * 100)}% dos ${c.coorte} não passariam na regra de ${c.camada.toUpperCase()}.`}
          </Text>
          {c.sem_cadastro > 0 && (
            <Text variant="muted" className="mt-1 text-xs">
              Mais {c.sem_cadastro} sem cadastro no universo — a régua não os enxerga.
            </Text>
          )}
          {c.barreiras.slice(0, 3).map((b) => (
            <Text key={b.indice} variant="muted" className="mt-1 text-xs">
              {b.descricao} — barra {b.barrados}
            </Text>
          ))}
        </View>
      ))}

      {s.auditoria?.faixas && (
        <View className="rounded-lg border border-border p-3">
          <Text className="text-sm font-medium text-foreground">
            {fraseConversaoForaDeFaixa(
              s.auditoria.faixas.convertidas_sem_faixa,
              s.auditoria.faixas.convertidas_total,
            )}
          </Text>
          {s.auditoria.faixas.por_faixa.map((f) => (
            <Text key={f.faixa} variant="muted" className="mt-1 text-xs">
              Faixa {f.faixa}: {(f.taxa * 100).toFixed(1).replace('.', ',')}% ({f.convertidas} de{' '}
              {f.nfs})
            </Text>
          ))}
        </View>
      )}

      {s.sugestoes_pendentes > 0 && (
        <Text variant="muted" className="text-xs">
          {s.sugestoes_pendentes} sugestão{s.sugestoes_pendentes > 1 ? 'ões' : ''} de ajuste de
          régua aguardando decisão — resolva na versão web.
        </Text>
      )}
    </View>
  )
}

function AchadoItem({
  achado,
  rotuloA,
  rotuloB,
}: {
  achado: AchadoContraste
  rotuloA: string
  rotuloB: string
}) {
  const d = achado.destaque

  return (
    <View className="gap-2 rounded-lg border border-border p-3">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-sm leading-snug text-foreground">
          {fraseAchado(achado, variavelPerfil(achado.variavel), rotuloA, rotuloB)}
        </Text>
        {achado.confianca === 'indicativo' && (
          <Badge variant="outline">
            <Text className="text-xs">poucos dados</Text>
          </Badge>
        )}
      </View>

      {d && (
        <View className="gap-1">
          <Text variant="muted" className="text-xs">
            {d.chave}
          </Text>
          <Barra valor={d.prevalencia_a} tom="a" />
          <Barra valor={d.prevalencia_b} tom="b" />
          <Text variant="muted" className="text-xs">
            {Math.round(d.prevalencia_a * 100)}% ({d.n_a}) contra{' '}
            {Math.round(d.prevalencia_b * 100)}% ({d.n_b})
          </Text>
        </View>
      )}
    </View>
  )
}

function Barra({ valor, tom }: { valor: number; tom: 'a' | 'b' }) {
  return (
    <View className="h-2 overflow-hidden rounded-full bg-muted">
      <View
        className={`h-full rounded-full ${tom === 'a' ? 'bg-primary' : 'bg-muted-foreground/40'}`}
        style={{ width: `${Math.min(100, Math.round(valor * 100))}%` }}
      />
    </View>
  )
}
