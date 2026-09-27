import {
  CANAL_ENTREGA_LABELS,
  COBRANCA_SITUACAO_TITULO_LABELS,
  EVENTO_LABELS,
  PAPEL_NOTIFICACAO_COBRANCA_LABELS,
  STATUS_ENTREGA_LABELS,
  STATUS_NOTIFICACAO_COBRANCA_LABELS,
  TIPO_INTERACAO_COBRANCA_LABELS,
  formatCnpj,
  type CanalEntrega,
  type CobrancaSituacaoTitulo,
  type PapelNotificacaoCobranca,
  type StatusEntrega,
  type StatusNotificacaoCobranca,
  type TipoInteracaoCobranca,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { AbaixoDoCabecalho, useRecuoDoCabecalho } from '@/components/shell/cabecalho-de-vidro'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FiltroSegmentado, type OpcaoFiltro } from '@/components/ui/filtros'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import {
  buscarCardCobranca,
  buscarHistoricoDaCobranca,
  buscarNotificacoesDaCobranca,
  buscarTitulosDaCobranca,
  cobrancaKeys,
} from '../api'
import { brl, corDoPrazo, dataBr, estagioLabel, marcoLabel, prazoTexto } from '../format'
import { RegistrarContatoSheet } from './registrar-contato-sheet'

/**
 * A cobrança no celular (07 §12 Mobile).
 *
 * ─── O QUE CABE E O QUE NÃO CABE ───────────────────────────────────────────
 * CABE ler tudo que responde "onde isto está": o próximo prazo da apólice, os títulos,
 * se as notificações CHEGARAM, e o histórico. E cabe registrar contato.
 *
 * NÃO CABE criar, notificar, protestar nem sinistrar. São atos com consequência jurídica
 * e de apólice — a notificação interrompe a cobertura do sacado (cl. 17700.20 b) —, e a
 * tela diz isso em vez de esconder os botões sem explicação.
 */

type Aba = 'titulos' | 'notificacoes' | 'historico'

const ABAS: readonly OpcaoFiltro<Aba>[] = [
  { valor: 'titulos', label: 'Títulos' },
  { valor: 'notificacoes', label: 'Notificações' },
  { valor: 'historico', label: 'Histórico' },
]

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <View className="flex-row justify-between gap-3 py-1">
      <Text className="text-sm text-muted-foreground">{rotulo}</Text>
      <Text className="flex-1 text-right text-sm">{valor}</Text>
    </View>
  )
}

export function CobrancaDetalheMobile({ cobrancaId }: { cobrancaId: string }) {
  const { colors } = useTheme()
  const recuo = useRecuoDoCabecalho()
  const [aba, setAba] = React.useState<Aba>('titulos')
  const [registrando, setRegistrando] = React.useState(false)

  const card = useQuery({ queryKey: cobrancaKeys.card(cobrancaId), queryFn: () => buscarCardCobranca(cobrancaId) })
  const titulos = useQuery({
    queryKey: cobrancaKeys.titulos(cobrancaId),
    queryFn: () => buscarTitulosDaCobranca(cobrancaId),
  })
  const notificacoes = useQuery({
    queryKey: cobrancaKeys.notificacoes(cobrancaId),
    queryFn: () => buscarNotificacoesDaCobranca(cobrancaId),
    enabled: aba === 'notificacoes',
  })
  const historico = useQuery({
    queryKey: cobrancaKeys.historico(cobrancaId),
    queryFn: () => buscarHistoricoDaCobranca(cobrancaId),
    enabled: aba === 'historico',
  })

  if (card.isPending) {
    return (
      <AbaixoDoCabecalho>
        <View className="gap-3 p-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </View>
      </AbaixoDoCabecalho>
    )
  }

  if (card.isError) {
    return (
      <AbaixoDoCabecalho>
        <ErrorState title="Não foi possível carregar a cobrança" onRetry={() => void card.refetch()} />
      </AbaixoDoCabecalho>
    )
  }

  const c = card.data
  if (!c) {
    return (
      <AbaixoDoCabecalho>
        <EmptyState title="Cobrança não encontrada" description="Ela pode não estar no seu alcance." />
      </AbaixoDoCabecalho>
    )
  }

  const atualizando = card.isRefetching || titulos.isRefetching || notificacoes.isRefetching || historico.isRefetching

  return (
    <>
      <ScrollView
        contentContainerClassName="gap-4 p-4 pb-28"
        contentContainerStyle={{ paddingTop: recuo + 16 }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              void card.refetch()
              void titulos.refetch()
              if (aba === 'notificacoes') void notificacoes.refetch()
              if (aba === 'historico') void historico.refetch()
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Capa ── */}
        <Card>
          <CardHeader>
            <CardTitle>{c.sacado_razao_social ?? formatCnpj(c.sacado_matriz_cnpj ?? '')}</CardTitle>
            <Text className="text-xs text-muted-foreground">
              {c.codigo ?? '—'} · matriz {formatCnpj(c.sacado_matriz_cnpj ?? '')}
            </Text>
          </CardHeader>
          <CardContent>
            <View className="mb-2 flex-row flex-wrap gap-2">
              <Badge variant="secondary">
                <Text>{estagioLabel(c.estagio)}</Text>
              </Badge>
              {c.tem_protesto ? (
                <Badge variant="outline">
                  <Text>protesto</Text>
                </Badge>
              ) : null}
              {c.tem_sinistro ? (
                <Badge variant="outline">
                  <Text>sinistro</Text>
                </Badge>
              ) : null}
              {c.tem_processo ? (
                <Badge variant="outline">
                  <Text>processo {c.processo_cnj ?? ''}</Text>
                </Badge>
              ) : null}
              {c.tem_acordo ? (
                <Badge variant="success">
                  <Text>acordo assinado</Text>
                </Badge>
              ) : null}
            </View>
            <Linha rotulo="Em aberto" valor={brl(c.valor_em_aberto)} />
            <Linha rotulo="Valor de face" valor={brl(c.valor_face)} />
            <Linha
              rotulo="Valor atualizado"
              valor={c.valor_atualizado === null ? 'não calculado' : `${brl(c.valor_atualizado)} em ${dataBr(c.valor_atualizado_em)}`}
            />
            <Linha
              rotulo="Títulos"
              valor={`${c.qtd_ativos ?? 0} ativo(s) de ${c.qtd_titulos ?? 0}${(c.qtd_spes ?? 0) > 1 ? ` · ${c.qtd_spes} SPEs` : ''}`}
            />
            <Linha rotulo="Maior atraso" valor={c.max_dias_atraso === null ? '—' : `${c.max_dias_atraso} dias`} />
            <Linha rotulo="Responsável" valor={c.responsavel_nome ?? '—'} />
          </CardContent>
        </Card>

        {/* ── O próximo prazo da apólice: primeiro, porque é o que não perdoa ── */}
        <Card>
          <CardHeader>
            <CardTitle>Próximo prazo da apólice</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1">
                <Text className="text-sm">{marcoLabel(c.proximo_marco)}</Text>
                <Text className="text-xs text-muted-foreground">{dataBr(c.proximo_marco_em)}</Text>
              </View>
              <Text className={cn('text-base tabular-nums', corDoPrazo(c.dias_restantes))}>
                {prazoTexto(c.dias_restantes)}
              </Text>
            </View>
          </CardContent>
        </Card>

        <View className="rounded-lg border border-border bg-muted/40 p-3">
          <Text className="text-xs text-muted-foreground">
            Criar, notificar, protestar e sinistrar é pela web: são atos com consequência jurídica e de apólice.
          </Text>
        </View>

        <Button onPress={() => setRegistrando(true)}>
          <Text>Registrar contato</Text>
        </Button>

        <FiltroSegmentado opcoes={ABAS} valor={aba} onChange={setAba} rotulo={(label) => `Ver ${label}`} sangra />

        {aba === 'titulos' ? (
          <Card>
            <CardHeader>
              <CardTitle>Títulos</CardTitle>
              <Text className="text-xs text-muted-foreground">
                Valores do momento da inclusão — é o que a notificação citou.
              </Text>
            </CardHeader>
            <CardContent className="gap-3">
              {titulos.isPending ? <Skeleton className="h-20 w-full" /> : null}
              {(titulos.data ?? []).map((t) => (
                <View key={t.id} className="gap-0.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <View className="flex-row justify-between gap-2">
                    <Text className="flex-1 text-sm" numberOfLines={1}>
                      {t.titulos?.numero ?? '—'} · {t.titulos?.cedente_nome ?? formatCnpj(t.cedente_cnpj_snapshot)}
                    </Text>
                    <Text className="text-sm tabular-nums">{brl(t.valor_face_snapshot)}</Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    vence {dataBr(t.vencimento_snapshot)} · {t.dias_atraso_snapshot} d de atraso na inclusão ·{' '}
                    {COBRANCA_SITUACAO_TITULO_LABELS[t.situacao as CobrancaSituacaoTitulo] ?? t.situacao}
                    {t.quitado_em ? ` em ${dataBr(t.quitado_em)}` : ''}
                  </Text>
                </View>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {aba === 'notificacoes' ? (
          <Card>
            <CardHeader>
              <CardTitle>Notificações</CardTitle>
            </CardHeader>
            <CardContent className="gap-3">
              {notificacoes.isPending ? <Skeleton className="h-20 w-full" /> : null}
              {!notificacoes.isPending && (notificacoes.data ?? []).length === 0 ? (
                <Text className="py-4 text-center text-sm text-muted-foreground">
                  Nenhuma notificação gerada ainda. As minutas se geram na web.
                </Text>
              ) : null}
              {(notificacoes.data ?? []).map((n) => (
                <View key={n.id} className="gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-sm font-medium" numberOfLines={2}>
                      {n.destinatario_razao_social}
                    </Text>
                    <Badge variant={n.status === 'entregue' ? 'success' : n.status === 'falhou' ? 'destructive' : 'outline'}>
                      <Text>{STATUS_NOTIFICACAO_COBRANCA_LABELS[n.status as StatusNotificacaoCobranca] ?? n.status}</Text>
                    </Badge>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    {PAPEL_NOTIFICACAO_COBRANCA_LABELS[n.papel as PapelNotificacaoCobranca] ?? n.papel} · rodada{' '}
                    {n.rodada} · {n.qtd_titulos} título(s) · {brl(n.valor_total_atualizado ?? n.valor_total)}
                    {n.prazo_expira_em ? ` · prazo ${dataBr(n.prazo_expira_em)}` : ''}
                  </Text>
                  {n.cobranca_notificacao_entregas.map((e) => (
                    <Text
                      key={e.id}
                      className={cn(
                        'text-xs',
                        e.status === 'entregue'
                          ? 'text-emerald-700'
                          : e.status === 'devolvido' || e.status === 'recusado' || e.status === 'falhou'
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                      )}
                    >
                      {CANAL_ENTREGA_LABELS[e.canal as CanalEntrega] ?? e.canal}:{' '}
                      {STATUS_ENTREGA_LABELS[e.status as StatusEntrega] ?? e.status}
                      {e.codigo_rastreio ? ` · ${e.codigo_rastreio}` : ''}
                      {e.confirmado_em ? ` · ${dataBr(e.confirmado_em)}` : e.enviado_em ? ` · ${dataBr(e.enviado_em)}` : ''}
                    </Text>
                  ))}
                </View>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {aba === 'historico' ? (
          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent className="gap-3">
              {historico.isPending ? <Skeleton className="h-20 w-full" /> : null}
              {!historico.isPending && (historico.data ?? []).length === 0 ? (
                <Text className="py-4 text-center text-sm text-muted-foreground">Nada registrado ainda.</Text>
              ) : null}
              {(historico.data ?? []).map((h) => (
                <View
                  key={h.id}
                  className={cn('border-l-2 pl-3', h.origem === 'interacao' ? 'border-primary' : 'border-border')}
                >
                  <Text className="text-xs text-muted-foreground">
                    {dataBr(h.em)} ·{' '}
                    {h.origem === 'interacao'
                      ? (TIPO_INTERACAO_COBRANCA_LABELS[h.tipo as TipoInteracaoCobranca] ?? h.tipo)
                      : (EVENTO_LABELS[h.tipo] ?? h.tipo)}
                  </Text>
                  {h.texto ? <Text className="mt-0.5 text-sm">{h.texto}</Text> : null}
                </View>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </ScrollView>

      <RegistrarContatoSheet cobrancaId={cobrancaId} open={registrando} onOpenChange={setRegistrando} />
    </>
  )
}
