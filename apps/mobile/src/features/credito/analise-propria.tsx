import * as React from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import {
  DECISOES_FINAIS,
  DECISAO_FINAL_LABELS,
  INDICADOR_LABELS,
  QUADRANTE_LABELS,
  QUADRANTE_LEITURA,
  STATUS_ANALISE_PROPRIA_LABELS,
  TETO_LABELS,
  motivoObrigatorio,
  type Cenario,
  type DecisaoFinal,
  type Indicador,
  type IndicadorId,
  type Quadrante,
  type StatusAnalisePropria,
  type Teto,
  type TetoId,
} from '@jobsiteos/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'

/**
 * A análise proprietária no celular (04j §10).
 *
 * ─── O QUE CABE AQUI E O QUE NÃO CABE ───────────────────────────────────────
 * CABE ler o resultado e DECIDIR: decisão de crédito no celular é caso de uso real —
 * comitê por telefone, alçada aprovando fora do escritório, o sacado esperando resposta
 * enquanto alguém está numa obra. Cabe também FOTOGRAFAR um documento: o balanço em
 * papel na mesa do cliente é o momento em que o documento existe.
 *
 * NÃO CABE a revisão da extração nem o editor de parâmetros. Conferir sete campos
 * críticos contra o trecho de origem de cada um é trabalho de tela larga; espremer isso
 * em 6" produziria uma conferência apressada — que é pior do que nenhuma, porque fica
 * gravada como se alguém tivesse olhado.
 */

const moeda = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

interface PainelMobile {
  encontrado: boolean
  propria: {
    id: string
    status: string
    etapa: string | null
    erro: string | null
    recomendacao: string | null
    limite_recomendado: number | null
    motivos_nao_operar: string[]
    indicadores: Indicador[] | null
    tetos: Teto[] | null
    cenarios: Cenario[] | null
    quadrante: string | null
    atradius_status: string | null
    atradius_limite: number | null
    decisao_final: string | null
    decisao_limite: number | null
    decisao_motivo: string | null
    parecer_markdown: string | null
    parecer_editado: string | null
  } | null
}

async function buscarPainel(analiseCreditoId: string): Promise<PainelMobile> {
  const { data, error } = await supabase.rpc('analise_propria_painel' as never, {
    p_analise_credito_id: analiseCreditoId,
  } as never)
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<PainelMobile>
  return { encontrado: r.encontrado ?? false, propria: r.propria ?? null }
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <View className="flex-row justify-between gap-2">
      <Text variant="muted" className="text-sm">
        {rotulo}
      </Text>
      <Text className={forte ? 'text-sm font-semibold tabular-nums' : 'text-sm tabular-nums'}>{valor}</Text>
    </View>
  )
}

/**
 * O envio de documento pela câmera.
 *
 * Sobe direto para o bucket privado e registra pelo mesmo RPC da web. O caminho começa
 * pelo id da análise da esteira — é o que amarra o objeto ao registro e o que a policy
 * de storage usa como âncora.
 */
function EnviarDocumento({ analiseCreditoId }: { analiseCreditoId: string }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState(false)

  async function fotografar() {
    const permissao = await ImagePicker.requestCameraPermissionsAsync()
    if (!permissao.granted) {
      Alert.alert('Sem acesso à câmera', 'Autorize a câmera nas configurações para fotografar o documento.')
      return
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: false })
    if (r.canceled || !r.assets[0]) return

    setEnviando(true)
    try {
      const asset = r.assets[0]
      const resposta = await fetch(asset.uri)
      const bytes = await resposta.arrayBuffer()
      const caminho = `${analiseCreditoId}/foto-${Date.now()}.jpg`

      const { error: erroUpload } = await supabase.storage
        .from('analise-docs')
        .upload(caminho, bytes, { contentType: 'image/jpeg', upsert: false })
      if (erroUpload) throw new Error(erroUpload.message)

      const { error } = await supabase.rpc('app_registrar_doc_analise' as never, {
        p: {
          analise_id: analiseCreditoId,
          // A foto entra como `outros`: quem fotografa na mesa do cliente não sabe
          // classificar entre balanço e balancete, e um tipo errado faria a extração ler
          // o documento procurando o que não está lá. A tela da web reclassifica.
          tipo: 'outros',
          arquivo_url: caminho,
          nome_arquivo: `Foto ${new Date().toLocaleString('pt-BR')}`,
        },
      } as never)
      if (error) throw new Error(error.message)

      Alert.alert(
        'Documento enviado',
        'Ele entrou como "Outros". Classifique o tipo na web antes de rodar a análise — a extração lê o documento pelo que ele diz ser.',
      )
      void qc.invalidateQueries({ queryKey: ['credito', 'analise-propria', analiseCreditoId] })
    } catch (e) {
      Alert.alert('Não foi possível enviar', e instanceof Error ? e.message : 'Falha no envio.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Button variant="outline" disabled={enviando} onPress={() => void fotografar()}>
      <Text>{enviando ? 'Enviando…' : 'Fotografar documento'}</Text>
    </Button>
  )
}

function Decisao({
  analiseId,
  analiseCreditoId,
  quadrante,
  nossoLimite,
  seguradoraLimite,
  decisaoAtual,
  decisaoLimite,
  decisaoMotivo,
}: {
  analiseId: string
  analiseCreditoId: string
  quadrante: Quadrante | null
  nossoLimite: number | null
  seguradoraLimite: number | null
  decisaoAtual: DecisaoFinal | null
  decisaoLimite: number | null
  decisaoMotivo: string | null
}) {
  const qc = useQueryClient()
  const trivial: DecisaoFinal | null =
    quadrante === 'ambos_aprovam' ? 'operar_com_cobertura' : quadrante === 'ambos_negam' ? 'nao_operar' : null
  const [decisao, setDecisao] = React.useState<DecisaoFinal | null>(decisaoAtual ?? trivial)

  const sugerido =
    quadrante === 'ambos_aprovam' && nossoLimite !== null && seguradoraLimite !== null
      ? Math.min(nossoLimite, seguradoraLimite)
      : (nossoLimite ?? seguradoraLimite)
  const [limite, setLimite] = React.useState(
    String(decisaoLimite ?? (sugerido !== null ? Math.round(sugerido) : '')),
  )
  const [motivo, setMotivo] = React.useState(decisaoMotivo ?? '')

  const exigeMotivo = decisao !== null && motivoObrigatorio(quadrante, decisao)
  const semMotivo = exigeMotivo && motivo.trim().length === 0
  const naoOpera = decisao === 'nao_operar'

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('app_registrar_decisao_credito' as never, {
        p: {
          id: analiseId,
          decisao_final: decisao,
          decisao_limite: naoOpera ? null : Number(limite.replace(/\D/g, '')) || null,
          decisao_motivo: motivo.trim() || null,
        },
      } as never)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      Alert.alert('Decisão registrada', 'O limite operacional foi aplicado na esteira.')
      void qc.invalidateQueries({ queryKey: ['credito', 'analise-propria', analiseCreditoId] })
    },
    onError: (e: Error) => Alert.alert('Não foi possível registrar', e.message),
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Decisão</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {quadrante ? (
          <View className="gap-1 rounded-lg border border-border p-3">
            <Text className="text-sm font-medium">{QUADRANTE_LABELS[quadrante]}</Text>
            <Text variant="muted" className="text-xs">
              {QUADRANTE_LEITURA[quadrante]}
            </Text>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-1.5">
          {DECISOES_FINAIS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={decisao === d ? 'default' : 'outline'}
              onPress={() => setDecisao(d)}
            >
              <Text className="text-xs">{DECISAO_FINAL_LABELS[d]}</Text>
            </Button>
          ))}
        </View>

        {!naoOpera ? (
          <View className="gap-1">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              Limite operacional
            </Text>
            <Input value={limite} onChangeText={setLimite} keyboardType="numeric" placeholder="em reais" />
          </View>
        ) : null}

        <View className="gap-1">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Motivo{exigeMotivo ? ' (obrigatório)' : ' (opcional)'}
          </Text>
          <Input
            value={motivo}
            onChangeText={setMotivo}
            multiline
            numberOfLines={3}
            placeholder={
              exigeMotivo
                ? 'Esta decisão diverge do caminho trivial do quadrante.'
                : 'Contexto adicional, se houver.'
            }
          />
          {semMotivo ? (
            <Text className="text-xs text-destructive">
              Sem motivo, esta decisão não pode ser registrada.
            </Text>
          ) : null}
        </View>

        <Button
          disabled={decisao === null || semMotivo || registrar.isPending}
          onPress={() =>
            Alert.alert(
              'Registrar decisão',
              `${decisao ? DECISAO_FINAL_LABELS[decisao] : ''}${naoOpera ? '' : ` · ${moeda(Number(limite.replace(/\D/g, '')))}`}. Isto grava o limite operacional na esteira.`,
              [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Registrar', onPress: () => registrar.mutate() },
              ],
            )
          }
        >
          <Text>{registrar.isPending ? 'Registrando…' : 'Registrar decisão'}</Text>
        </Button>
      </CardContent>
    </Card>
  )
}

export function AnalisePropriaMobile({ analiseCreditoId }: { analiseCreditoId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['credito', 'analise-propria', analiseCreditoId],
    queryFn: () => buscarPainel(analiseCreditoId),
    refetchInterval: (q) => (q.state.data?.propria?.status === 'processando' ? 15_000 : false),
  })

  if (isPending) return <Skeleton className="h-40 rounded-xl" />

  const p = data?.propria
  if (!p) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Análise proprietária</CardTitle>
        </CardHeader>
        <CardContent className="gap-3">
          <Text variant="muted" className="text-sm">
            Esta esteira ainda não tem análise proprietária. Ela é rodada na web, sobre os
            documentos contábeis anexados.
          </Text>
          <EnviarDocumento analiseCreditoId={analiseCreditoId} />
        </CardContent>
      </Card>
    )
  }

  const status = p.status as StatusAnalisePropria
  const operar = p.recomendacao === 'operar'
  const parecer = p.parecer_editado ?? p.parecer_markdown

  return (
    <ScrollView contentContainerClassName="gap-3">
      <Card>
        <CardHeader className="pb-2">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Análise proprietária</CardTitle>
            <Badge variant={status === 'falhou' ? 'destructive' : 'outline'}>
              <Text className="text-[11px]">{STATUS_ANALISE_PROPRIA_LABELS[status] ?? status}</Text>
            </Badge>
          </View>
        </CardHeader>
        <CardContent className="gap-2">
          {status === 'concluida' ? (
            <>
              <Linha rotulo="Recomendação" valor={operar ? 'OPERAR' : 'NÃO OPERAR'} forte />
              {operar ? <Linha rotulo="Limite recomendado" valor={moeda(p.limite_recomendado)} forte /> : null}
              {(p.motivos_nao_operar ?? []).map((m) => (
                <Text key={m} className="text-xs text-destructive">
                  · {m}
                </Text>
              ))}
            </>
          ) : (
            <Text variant="muted" className="text-sm">
              {status === 'aguardando_revisao'
                ? 'A extração espera revisão dos campos críticos. Isso é feito na web, ao lado do trecho de origem de cada número — nada é calculado antes.'
                : status === 'processando'
                  ? 'A extração está rodando. A tela se atualiza sozinha.'
                  : (p.erro ?? 'A análise falhou.')}
            </Text>
          )}
          <EnviarDocumento analiseCreditoId={analiseCreditoId} />
        </CardContent>
      </Card>

      {status === 'concluida' ? (
        <>
          {(p.cenarios ?? []).length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cenários</CardTitle>
              </CardHeader>
              <CardContent className="gap-2">
                {(p.cenarios ?? []).map((c) => (
                  <View key={c.nome} className="gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                    <Linha rotulo={c.nome} valor={moeda(c.limite)} forte={c.nome === 'base'} />
                    <Text variant="muted" className="text-xs">
                      {c.racional}
                    </Text>
                  </View>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Os cinco tetos</CardTitle>
            </CardHeader>
            <CardContent className="gap-2">
              {(p.tetos ?? []).map((t) => (
                <View key={t.id} className="gap-0.5">
                  <Linha
                    rotulo={`${TETO_LABELS[t.id as TetoId] ?? t.id}${t.vinculante ? ' (vinculante)' : ''}`}
                    valor={t.aplicavel ? moeda(t.valor) : 'não aplicável'}
                    forte={t.vinculante}
                  />
                  {/* Não aplicável NUNCA é zero: sem o motivo, o teto ausente lê como teto baixo. */}
                  {!t.aplicavel ? (
                    <Text variant="muted" className="text-xs">
                      {t.motivo_nao_aplicavel}
                    </Text>
                  ) : null}
                </View>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Indicadores</CardTitle>
            </CardHeader>
            <CardContent className="gap-1.5">
              {(p.indicadores ?? [])
                .filter((i) => i.valor !== null)
                .map((i) => (
                  <Linha
                    key={i.id}
                    rotulo={INDICADOR_LABELS[i.id as IndicadorId] ?? i.id}
                    valor={
                      i.unidade === 'pct'
                        ? `${((i.valor as number) * 100).toFixed(1)}%`
                        : i.unidade === 'dias'
                          ? `${Math.round(i.valor as number)} dias`
                          : `${(i.valor as number).toFixed(2)}x`
                    }
                  />
                ))}
            </CardContent>
          </Card>

          <Decisao
            analiseId={p.id}
            analiseCreditoId={analiseCreditoId}
            quadrante={p.quadrante as Quadrante | null}
            nossoLimite={p.limite_recomendado}
            seguradoraLimite={p.atradius_limite}
            decisaoAtual={p.decisao_final as DecisaoFinal | null}
            decisaoLimite={p.decisao_limite}
            decisaoMotivo={p.decisao_motivo}
          />

          {parecer ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Parecer</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Sem renderizador de markdown no celular: o texto cru preserva as oito
                    seções e não inventa uma hierarquia visual que a tela estreita não
                    comporta. Editar o parecer é da web. */}
                <Text className="text-sm leading-relaxed">{parecer}</Text>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  )
}
