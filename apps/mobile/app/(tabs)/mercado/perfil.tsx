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
import { Animated, RefreshControl, View } from 'react-native'

import {
  CabecalhoRetratil,
  useCabecalhoRetratil,
} from '@/components/shell/cabecalho-retratil'
import { Badge } from '@/components/ui/badge'
import { FiltroSegmentado } from '@/components/ui/filtros'
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
const OPCOES_TRILHA = TRILHAS.map((t) => ({ valor: t, label: TRILHA_LABELS[t] }))

export default function PerfilScreen() {
  const [trilha, setTrilha] = useState<Trilha>('sacados')
  const { data, isPending, isError, refetch, isRefetching } = usePerfilQuery(trilha)
  const {
    deslocamento,
    recolhido,
    aoRolar,
    listaRef,
    voltarAoTopo,
    alturaCabecalho,
    setAlturaCabecalho,
  } = useCabecalhoRetratil<SnapshotPerfilMobile>()

  /*
    A trilha é o recorte da tela — sacados ou cedentes — e por isso mora no
    cabeçalho retrátil, como o estágio no funil. Sem busca: a lista é de poucas
    comparações, e um campo de texto sobre ela seria controle sem uso.
  */
  const cabecalho = (
    <CabecalhoRetratil
      titulo="Perfil dos Clientes"
      resumo={TRILHA_LABELS[trilha]}
      deslocamento={deslocamento}
      recolhido={recolhido}
      onExpandir={voltarAoTopo}
      onAltura={setAlturaCabecalho}
      chips={
        <FiltroSegmentado
          opcoes={OPCOES_TRILHA}
          valor={trilha}
          onChange={setTrilha}
          sobreNavy
          sangra
        />
      }
    />
  )

  const recuoDoCabecalho = { paddingTop: alturaCabecalho }

  return (
    <View className="flex-1 bg-background">
      {isError ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <ErrorState
            description="Não foi possível carregar o perfil. Verifique sua conexão e tente novamente."
            onRetry={() => void refetch()}
          />
        </View>
      ) : isPending ? (
        <View style={recuoDoCabecalho} className="flex-1 p-4">
          <Text variant="muted">Carregando…</Text>
        </View>
      ) : data.length === 0 ? (
        <View style={recuoDoCabecalho} className="flex-1">
          <EmptyState
            title="Perfil ainda não calculado"
            description="O cálculo roda uma vez por mês, depois das calibrações de faturamento e de crédito. Ele pode ser antecipado pela versão web."
          />
        </View>
      ) : (
        <Animated.FlatList
          ref={listaRef}
          data={data}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <Comparacao snapshot={item} />}
          onScroll={aoRolar}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: alturaCabecalho + 16 }}
          contentContainerClassName="gap-6 p-4 pb-28"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          ListHeaderComponent={
            <Text variant="muted" className="text-sm">
              {TRILHA_PERGUNTAS[trilha]}
            </Text>
          }
          ListFooterComponent={
            <View className="rounded-lg border border-dashed border-border p-3">
              <Text variant="muted" className="text-xs leading-relaxed">
                {AVISO_VIES}
              </Text>
            </View>
          }
        />
      )}

      {/* Depois da lista: em RN o irmão posterior pinta por cima. */}
      {cabecalho}
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
