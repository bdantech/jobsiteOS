import {
  AVISO_PARECER,
  BENCHMARK_FASES_PADRAO,
  FASE_LABELS,
  RISCO_LABELS,
  SITUACAO_INTERNA_LABELS,
  TIPOS_CUSTO,
  TIPO_CUSTO_LABELS,
  TIPO_PRAZO_LABELS,
  formatCnpj,
  montarCronograma,
  type BenchmarkFases,
  type Fase,
  type Risco,
  type SituacaoInterna,
  type TipoCusto,
  type TipoPrazo,
} from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import * as React from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import {
  buscarConfig,
  buscarCustos,
  buscarFases,
  buscarMovimentacoes,
  buscarParecer,
  buscarPrazos,
  buscarProcesso,
  concluirPrazo,
  juridicoKeys,
  registrarCustoComFoto,
} from '../api'

/**
 * O processo no celular (08 §8).
 *
 * ─── O QUE CABE E O QUE NÃO CABE ───────────────────────────────────────────
 * CABE ler: capa, cronograma, movimentações, parecer e prazos. Cabe CONCLUIR um prazo
 * — quem sai da audiência marca ali mesmo. E cabe REGISTRAR CUSTO COM FOTO: a guia de
 * custas em papel na mão do advogado é o momento em que o comprovante existe; fotografar
 * depois é fotografar nunca.
 *
 * NÃO CABE gerar cálculo nem gerar parecer. Os dois custam (crédito e tokens) e os dois
 * produzem documento que alguém vai ler inteiro antes de usar — a memória de cálculo tem
 * nove colunas por operação. Espremer isso em 6" produziria uma conferência apressada,
 * que é pior do que nenhuma porque fica gravada como se alguém tivesse olhado.
 */

function moeda(v: number | string | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function dataBr(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <View className="flex-row justify-between gap-3 py-1">
      <Text className="text-sm text-muted-foreground">{rotulo}</Text>
      <Text className="flex-1 text-right text-sm">{valor}</Text>
    </View>
  )
}

export function ProcessoDetalheMobile({ numeroCnj }: { numeroCnj: string }) {
  const qc = useQueryClient()
  const [aba, setAba] = React.useState<'resumo' | 'movimentacoes' | 'parecer' | 'custos'>('resumo')

  const processo = useQuery({
    queryKey: juridicoKeys.processo(numeroCnj),
    queryFn: () => buscarProcesso(numeroCnj),
  })
  const fases = useQuery({ queryKey: juridicoKeys.fases(numeroCnj), queryFn: () => buscarFases(numeroCnj) })
  const movimentacoes = useQuery({
    queryKey: juridicoKeys.movimentacoes(numeroCnj),
    queryFn: () => buscarMovimentacoes(numeroCnj),
  })
  const prazos = useQuery({ queryKey: juridicoKeys.prazos(numeroCnj), queryFn: () => buscarPrazos(numeroCnj) })
  const parecer = useQuery({ queryKey: juridicoKeys.parecer(numeroCnj), queryFn: () => buscarParecer(numeroCnj) })
  const custos = useQuery({ queryKey: juridicoKeys.custos(numeroCnj), queryFn: () => buscarCustos(numeroCnj) })
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarConfig })

  const benchmark = ((config.data?.benchmark_fases as BenchmarkFases | undefined) ??
    BENCHMARK_FASES_PADRAO) as BenchmarkFases

  const concluir = useMutation({
    mutationFn: concluirPrazo,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: juridicoKeys.prazos(numeroCnj) })
      void qc.invalidateQueries({ queryKey: juridicoKeys.agenda() })
    },
    onError: (e: Error) => Alert.alert('Não foi possível concluir', e.message),
  })

  if (processo.isPending) {
    return (
      <View className="gap-3 p-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </View>
    )
  }

  const p = processo.data
  if (!p) {
    return <EmptyState title="Processo não encontrado" description="Ele pode ter saído da carteira." />
  }

  const cronograma = montarCronograma(fases.data ?? [], benchmark)
  const saldo = Number(p.saldo_liquido ?? 0)

  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-16">
      {/* ── Capa ── */}
      <Card>
        <CardHeader>
          <CardTitle>{p.devedor_nome ?? 'Devedor não identificado'}</CardTitle>
          <Text className="text-xs text-muted-foreground">{p.numero_cnj}</Text>
        </CardHeader>
        <CardContent>
          <View className="mb-2 flex-row flex-wrap gap-2">
            <Badge variant="secondary">
              <Text>{SITUACAO_INTERNA_LABELS[p.situacao_interna as SituacaoInterna] ?? '—'}</Text>
            </Badge>
            {p.status_predito ? (
              <Badge variant="outline">
                <Text>Tribunal: {p.status_predito}</Text>
              </Badge>
            ) : null}
            {cronograma.lenta ? (
              <Badge variant="destructive">
                <Text>fase lenta</Text>
              </Badge>
            ) : null}
          </View>
          <Linha rotulo="Classe" valor={p.classe ?? '—'} />
          <Linha rotulo="Foro" valor={[p.comarca, p.uf, p.tribunal_sigla].filter(Boolean).join(' · ') || '—'} />
          <Linha rotulo="CNPJ do devedor" valor={p.cnpj_devedor ? formatCnpj(p.cnpj_devedor) : '—'} />
          <Linha rotulo="Valor da causa" valor={moeda(p.valor_causa)} />
          <Linha
            rotulo="Valor atualizado"
            valor={p.valor_atualizado === null ? 'sem cálculo gerado' : moeda(p.valor_atualizado)}
          />
          <Linha rotulo="Distribuído em" valor={dataBr(p.data_distribuicao)} />
          <Linha rotulo="Advogado" valor={p.advogado_nome ?? '—'} />
          <Linha
            rotulo="Saldo líquido"
            valor={
              <Text className={saldo < 0 ? 'text-destructive' : saldo > 0 ? 'text-emerald-700' : undefined}>
                {moeda(saldo)}
              </Text>
            }
          />
        </CardContent>
      </Card>

      {/* ── Prazos: primeiro, porque é o que tem hora marcada ── */}
      {(prazos.data ?? []).filter((x) => !x.concluido).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Prazos e audiências</CardTitle>
          </CardHeader>
          <CardContent className="gap-3">
            {(prazos.data ?? [])
              .filter((x) => !x.concluido)
              .map((x) => (
                <View key={x.id} className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-sm">{x.descricao}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {TIPO_PRAZO_LABELS[x.tipo as TipoPrazo] ?? x.tipo} ·{' '}
                      {new Date(x.data).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Button size="sm" variant="outline" onPress={() => concluir.mutate(x.id)}>
                    <Text>Concluir</Text>
                  </Button>
                </View>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Abas ── */}
      <View className="flex-row flex-wrap gap-2">
        {(
          [
            ['resumo', 'Cronograma'],
            ['movimentacoes', 'Movimentações'],
            ['parecer', 'Parecer'],
            ['custos', 'Custos'],
          ] as const
        ).map(([id, rotulo]) => (
          <Pressable key={id} onPress={() => setAba(id)}>
            <Badge variant={aba === id ? 'default' : 'outline'}>
              <Text>{rotulo}</Text>
            </Badge>
          </Pressable>
        ))}
      </View>

      {aba === 'resumo' ? (
        <Card>
          <CardHeader>
            <CardTitle>Cronograma da ação</CardTitle>
            <Text className="text-xs text-muted-foreground">
              {cronograma.dias_total} dias desde a primeira fase detectada
            </Text>
          </CardHeader>
          <CardContent className="gap-3">
            {cronograma.etapas.length === 0 ? (
              <Text className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma movimentação classificada ainda. Não quer dizer que o processo esteja parado.
              </Text>
            ) : (
              cronograma.etapas.map((e) => (
                <View key={`${e.fase}-${e.desde}`} className="gap-1">
                  <View className="flex-row justify-between">
                    <Text className="text-sm font-medium">
                      {FASE_LABELS[e.fase as Fase] ?? e.fase}
                      {e.ate === null ? ' (atual)' : ''}
                    </Text>
                    <Text className={e.estourou ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                      {e.dias}d{e.benchmark !== null ? ` / ${e.benchmark}d` : ''}
                    </Text>
                  </View>
                  <View className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <View
                      className={e.estourou ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-primary'}
                      style={{
                        width: `${Math.max(3, (e.dias / Math.max(...cronograma.etapas.map((x) => x.dias), 1)) * 100)}%`,
                      }}
                    />
                  </View>
                  <Text className="text-[11px] text-muted-foreground">
                    {dataBr(e.desde)} → {e.ate ? dataBr(e.ate) : 'hoje'}
                  </Text>
                </View>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {aba === 'movimentacoes' ? (
        <Card>
          <CardHeader>
            <CardTitle>Movimentações</CardTitle>
            <Text className="text-xs text-muted-foreground">
              As 60 mais recentes. A série inteira fica na web.
            </Text>
          </CardHeader>
          <CardContent className="gap-3">
            {(movimentacoes.data ?? []).map((m) => (
              <View
                key={m.id}
                className={m.relevante ? 'border-l-2 border-primary pl-3' : 'border-l-2 border-transparent pl-3'}
              >
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-xs text-muted-foreground">{dataBr(m.data)}</Text>
                  {m.fase_detectada ? (
                    <Badge variant="outline">
                      <Text>{FASE_LABELS[m.fase_detectada as Fase] ?? m.fase_detectada}</Text>
                    </Badge>
                  ) : null}
                  {m.relevante ? (
                    <Badge>
                      <Text>relevante</Text>
                    </Badge>
                  ) : null}
                </View>
                <Text className="mt-1 text-sm">{m.conteudo}</Text>
              </View>
            ))}
            {(movimentacoes.data ?? []).length === 0 ? (
              <Text className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma movimentação sincronizada.
              </Text>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {aba === 'parecer' ? (
        <Card>
          <CardHeader>
            <CardTitle>Parecer jurídico</CardTitle>
          </CardHeader>
          <CardContent className="gap-3">
            {/* O aviso ACIMA do texto, aqui também — inclusive quando não há parecer. */}
            <View className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <Text className="text-xs">{AVISO_PARECER}</Text>
            </View>
            {parecer.data ? (
              <>
                <View className="flex-row flex-wrap gap-2">
                  {parecer.data.risco ? (
                    <Badge variant="outline">
                      <Text>Risco {RISCO_LABELS[parecer.data.risco as Risco]}</Text>
                    </Badge>
                  ) : null}
                  {parecer.data.editado ? (
                    <Badge variant="secondary">
                      <Text>editado por uma pessoa</Text>
                    </Badge>
                  ) : null}
                </View>
                <View className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <Text className="text-[11px] uppercase text-muted-foreground">Próximo passo</Text>
                  <Text className="text-sm">{parecer.data.proximo_passo}</Text>
                </View>
                <Text className="text-sm leading-relaxed">{parecer.data.parecer_markdown}</Text>
              </>
            ) : (
              <Text className="py-4 text-center text-sm text-muted-foreground">
                Nenhum parecer gerado. A geração custa tokens e é feita na web.
              </Text>
            )}
          </CardContent>
        </Card>
      ) : null}

      {aba === 'custos' ? (
        <RegistrarCusto numeroCnj={numeroCnj} custos={custos.data ?? []} />
      ) : null}
    </ScrollView>
  )
}

/**
 * Registro de custo com foto do comprovante.
 *
 * A câmera vem PRIMEIRO no fluxo porque é o que só existe agora: a guia de custas na
 * mão, na mesa do fórum. Valor e data podem ser digitados depois, mas o papel some.
 */
function RegistrarCusto({
  numeroCnj,
  custos,
}: {
  numeroCnj: string
  custos: { id: string; tipo: string; valor: number; data: string; descricao: string | null; comprovante_url: string | null }[]
}) {
  const qc = useQueryClient()
  const [tipo, setTipo] = React.useState<TipoCusto>('custas')
  const [valor, setValor] = React.useState('')
  const [descricao, setDescricao] = React.useState('')
  const [foto, setFoto] = React.useState<string | null>(null)

  const registrar = useMutation({
    mutationFn: () =>
      registrarCustoComFoto({
        numeroCnj,
        tipo,
        valor: Number(valor.replace(',', '.')),
        data: new Date().toISOString().slice(0, 10),
        descricao: descricao || null,
        fotoUri: foto,
      }),
    onSuccess: () => {
      setValor('')
      setDescricao('')
      setFoto(null)
      void qc.invalidateQueries({ queryKey: juridicoKeys.custos(numeroCnj) })
      void qc.invalidateQueries({ queryKey: juridicoKeys.processo(numeroCnj) })
      Alert.alert('Custo registrado', 'Ele entra no saldo líquido do processo.')
    },
    onError: (e: Error) => Alert.alert('Não foi possível registrar', e.message),
  })

  async function fotografar() {
    const permissao = await ImagePicker.requestCameraPermissionsAsync()
    if (!permissao.granted) {
      Alert.alert('Sem permissão', 'Autorize a câmera nas configurações do aparelho.')
      return
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false })
    if (!r.canceled && r.assets[0]) setFoto(r.assets[0].uri)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custos do processo</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        {custos.map((c) => (
          <View key={c.id} className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm">{c.descricao ?? TIPO_CUSTO_LABELS[c.tipo as TipoCusto] ?? c.tipo}</Text>
              <Text className="text-xs text-muted-foreground">
                {dataBr(c.data)}
                {c.comprovante_url ? ' · com comprovante' : ''}
              </Text>
            </View>
            <Text className="text-sm tabular-nums">{moeda(c.valor)}</Text>
          </View>
        ))}

        <View className="gap-2 border-t border-border pt-3">
          <View className="flex-row flex-wrap gap-2">
            {TIPOS_CUSTO.map((t) => (
              <Pressable key={t} onPress={() => setTipo(t)}>
                <Badge variant={tipo === t ? 'default' : 'outline'}>
                  <Text>{TIPO_CUSTO_LABELS[t]}</Text>
                </Badge>
              </Pressable>
            ))}
          </View>
          <Input placeholder="Descrição" value={descricao} onChangeText={setDescricao} />
          <Input placeholder="Valor" keyboardType="decimal-pad" value={valor} onChangeText={setValor} />
          <Button variant="outline" onPress={() => void fotografar()}>
            <Text>{foto ? 'Trocar foto do comprovante' : 'Fotografar comprovante'}</Text>
          </Button>
          <Button
            onPress={() => registrar.mutate()}
            disabled={!valor || registrar.isPending}
          >
            <Text>{registrar.isPending ? 'Enviando…' : 'Registrar custo'}</Text>
          </Button>
        </View>
      </CardContent>
    </Card>
  )
}
