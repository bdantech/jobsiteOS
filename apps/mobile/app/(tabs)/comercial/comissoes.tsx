import * as React from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native'
import { Clock, Coins, ThumbsDown, ThumbsUp } from 'lucide-react-native'
import {
  FASE_CONTA_LABELS,
  PAPEIS_COMISSAO,
  PAPEL_COMISSAO_LABELS,
  STATUS_COMPETENCIA_LABELS,
  STATUS_LANCAMENTO_V2_LABELS,
  explicarCalculo,
  type PapelComissao,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  competenciaCorrente,
  useAceites,
  useComissaoAcoes,
  useExtrato,
  usePainelComissao,
  type AceiteMobile,
} from '@/features/comercial/comissao'

/**
 * Comissões no celular.
 *
 * Três abas: o número do mês, a série de doze meses e o extrato. Cada linha do extrato
 * ABRE mostrando a conta por extenso — é a mesma exigência da web, e é a que faz uma
 * comissão ser contestável: quem discorda tem de conseguir refazer a conta sem pedir
 * nada a ninguém, inclusive de pé, no celular.
 *
 * A fila de aceite fica no topo quando há algo esperando, e não numa aba: ela tem PRAZO,
 * e passado o prazo a reunião conta como aceita sozinha. Um badge que só aparece quando
 * a pessoa abre a aba certa é um badge que não avisa.
 */

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mes = (c: string) =>
  c ? new Date(`${c.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '—'

function horasRestantes(prazo: string): string {
  const ms = new Date(prazo).getTime() - Date.now()
  if (ms <= 0) return 'prazo vencido — conta como aceita'
  const h = Math.floor(ms / 3_600_000)
  return h >= 1 ? `${h}h para decidir` : `${Math.floor(ms / 60_000)} min para decidir`
}

// ─── Fila de aceite ─────────────────────────────────────────────────────────

function FilaAceite() {
  const { colors } = useTheme()
  const { data } = useAceites()
  const { decidirAceite } = useComissaoAcoes()
  const [recusando, setRecusando] = React.useState<AceiteMobile | null>(null)
  const [motivo, setMotivo] = React.useState('')
  const [agindo, setAgindo] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  const pendentes = data ?? []
  if (pendentes.length === 0) return null

  async function agir(a: AceiteMobile, decisao: 'aceita' | 'recusada', texto?: string) {
    setAgindo(true)
    setErro(null)
    try {
      await decidirAceite(a.id, decisao, texto)
      setRecusando(null)
      setMotivo('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível registrar a decisão.')
    } finally {
      setAgindo(false)
    }
  }

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row items-center gap-2">
        <Clock size={14} color={colors.mutedForeground} />
        <Text variant="muted" className="text-xs uppercase tracking-wide">
          Reuniões aguardando você
        </Text>
      </View>
      <Text variant="muted" className="text-[11px]">
        Sem resposta até o fim do prazo, a reunião conta como ACEITA — o silêncio de quem
        recebeu a reunião não pode custar a comissão de quem a marcou.
      </Text>

      {pendentes.map((a) => (
        <View key={a.id} className="gap-2 border-t border-border pt-3">
          <Text className="font-medium">{a.empresas?.razao_social ?? 'Empresa'}</Text>
          <Text variant="muted" className="text-xs">{horasRestantes(a.prazo_em)}</Text>
          <View className="flex-row gap-2">
            <Button size="sm" disabled={agindo} onPress={() => void agir(a, 'aceita')}>
              <View className="flex-row items-center gap-1.5">
                <ThumbsUp size={14} color={colors.primaryForeground} />
                <Text className="text-sm">Aceitar</Text>
              </View>
            </Button>
            <Button size="sm" variant="outline" disabled={agindo} onPress={() => setRecusando(a)}>
              <View className="flex-row items-center gap-1.5">
                <ThumbsDown size={14} color={colors.foreground} />
                <Text className="text-sm">Recusar</Text>
              </View>
            </Button>
          </View>
        </View>
      ))}

      <Dialog
        open={recusando !== null}
        onOpenChange={(v) => {
          if (!v) {
            setRecusando(null)
            setErro(null)
          }
        }}
        title="Recusar a reunião"
        description="Recusar impede a comissão do SDR por esta reunião. O motivo fica no histórico."
      >
        <Input
          label="Motivo"
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Ex.: a reunião não aconteceu."
        />
        {erro ? <Text className="text-sm text-destructive">{erro}</Text> : null}
        <View className="flex-row justify-end gap-2">
          <Button variant="outline" onPress={() => setRecusando(null)}>
            <Text>Cancelar</Text>
          </Button>
          <Button
            variant="destructive"
            disabled={agindo || motivo.trim().length < 3}
            onPress={() => recusando && void agir(recusando, 'recusada', motivo.trim())}
          >
            <Text>Recusar</Text>
          </Button>
        </View>
      </Dialog>
    </Card>
  )
}

// ─── Extrato ────────────────────────────────────────────────────────────────

function Extrato({ competencia }: { competencia: string }) {
  const { data, isPending } = useExtrato(competencia)
  const [aberta, setAberta] = React.useState<string | null>(null)

  if (isPending) return <ActivityIndicator />
  const linhas = data ?? []
  if (linhas.length === 0) {
    return (
      <EmptyState
        title="Sem lançamentos"
        description="O extrato se monta sozinho: cada NF convertida entra aqui no instante da conversão."
      />
    )
  }

  return (
    <View className="gap-2">
      {linhas.map((l) => {
        const abertaAgora = aberta === l.id
        return (
          <Pressable key={l.id} onPress={() => setAberta(abertaAgora ? null : l.id)}>
            <Card className="gap-1.5 p-3">
              <View className="flex-row items-baseline justify-between gap-2">
                <Text className="flex-1 font-medium">
                  {l.nf_numero ? `NF ${l.nf_numero}` : (l.descricao ?? 'Lançamento')}
                </Text>
                <Text className={l.valor < 0 ? 'font-semibold text-destructive' : 'font-semibold'}>
                  {brl(l.valor)}
                </Text>
              </View>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Badge variant="outline">
                  <Text className="text-[10px]">{PAPEL_COMISSAO_LABELS[l.papel] ?? l.papel}</Text>
                </Badge>
                {l.fase ? (
                  <Badge variant="secondary">
                    <Text className="text-[10px]">{FASE_CONTA_LABELS[l.fase]}</Text>
                  </Badge>
                ) : null}
                <Badge variant="secondary">
                  <Text className="text-[10px]">
                    {STATUS_LANCAMENTO_V2_LABELS[l.status] ?? l.status}
                  </Text>
                </Badge>
                <Text variant="muted" className="text-[11px]">
                  {new Date(l.evento_em).toLocaleDateString('pt-BR')}
                </Text>
              </View>
              <Text variant="muted" className="text-xs">
                {l.papel === 'ORIGINADOR'
                  ? (l.cedente_nome ?? '—')
                  : (l.empresas?.razao_social ?? '—')}
              </Text>

              {abertaAgora ? (
                <View className="gap-1 rounded-md bg-muted p-2">
                  <Text className="text-xs font-medium">
                    {explicarCalculo({
                      valor_cedido: l.valor_cedido,
                      anticipation_days: l.anticipation_days,
                      vop: l.vop,
                      taxa_brl_por_mm: l.taxa_brl_por_mm,
                      share_pct: l.share_pct,
                      valor: l.valor,
                      params_snapshot: l.params_snapshot,
                      origem_tipo: l.origem_tipo,
                    })}
                  </Text>
                  {Object.entries(l.params_snapshot).map(([k, v]) => (
                    <View key={k} className="flex-row justify-between gap-2">
                      <Text variant="muted" className="text-[11px]">{k}</Text>
                      <Text className="text-[11px]">{v === null ? '—' : String(v)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </Pressable>
        )
      })}
    </View>
  )
}

// ─── Tela ───────────────────────────────────────────────────────────────────

type Aba = 'mes' | 'historico' | 'extrato'

export default function ComissoesScreen() {
  const { colors } = useTheme()
  const [aba, setAba] = React.useState<Aba>('mes')
  const [competencia, setCompetencia] = React.useState(competenciaCorrente())
  const { data, isPending, isError, refetch, isRefetching } = usePainelComissao()
  const { mudarCompetencia } = useComissaoAcoes()
  const [agindo, setAgindo] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data.tem_acesso) {
    return <EmptyState title="Sem acesso" description="O módulo Comercial não está liberado para o seu perfil." />
  }

  async function marcar(comp: string, status: 'aprovada' | 'paga') {
    setAgindo(true)
    setErro(null)
    try {
      await mudarCompetencia(comp, status)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar o status.')
    } finally {
      setAgindo(false)
    }
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-3 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <FilaAceite />

      <View className="flex-row gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ['mes', 'Mês'],
            ['historico', 'Histórico'],
            ['extrato', 'Extrato'],
          ] as const
        ).map(([id, rotulo]) => (
          <Pressable
            key={id}
            onPress={() => setAba(id)}
            className={`flex-1 rounded-md px-3 py-2 ${aba === id ? 'bg-background' : ''}`}
          >
            <Text className={`text-center text-sm ${aba === id ? 'font-medium' : 'text-muted-foreground'}`}>
              {rotulo}
            </Text>
          </Pressable>
        ))}
      </View>

      {erro ? <Text className="text-sm text-destructive">{erro}</Text> : null}

      {aba === 'mes' ? (
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-2">
            <Coins size={14} color={colors.mutedForeground} />
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              {mes(data.competencia)}
            </Text>
            <Badge variant="secondary">
              <Text className="text-[10px]">provisionado</Text>
            </Badge>
          </View>
          <Text className="text-3xl font-semibold">{brl(data.mes_corrente.total)}</Text>
          <Text variant="muted" className="text-xs">
            {data.mes_corrente.cessoes} cessão(ões) convertida(s) ·{' '}
            {mes(data.mes_anterior.competencia)}: {brl(data.mes_anterior.total)}
          </Text>
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {PAPEIS_COMISSAO.filter((p: PapelComissao) => (data.mes_corrente.por_papel[p] ?? 0) !== 0).map((p) => (
              <Badge key={p} variant="outline">
                <Text className="text-[10px]">
                  {PAPEL_COMISSAO_LABELS[p]}: {brl(data.mes_corrente.por_papel[p] ?? 0)}
                </Text>
              </Badge>
            ))}
          </View>
          <Text variant="muted" className="pt-1 text-[11px]">
            O lançamento nasce na conversão da NF. Provisionado ainda não é fechado, fechado
            ainda não é aprovado, e aprovado ainda não é pago.
          </Text>
        </Card>
      ) : null}

      {aba === 'historico' ? (
        <View className="gap-2">
          {data.historico.length === 0 ? (
            <EmptyState title="Sem histórico" description="Nenhuma competência com lançamento ainda." />
          ) : (
            data.historico.map((h) => (
              <Card key={h.competencia} className="gap-2 p-3">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Pressable
                    onPress={() => {
                      setCompetencia(h.competencia)
                      setAba('extrato')
                    }}
                  >
                    <Text className="font-medium">{mes(h.competencia)}</Text>
                  </Pressable>
                  <Text className="font-semibold">{brl(h.total)}</Text>
                </View>
                <View className="flex-row items-center justify-between gap-2">
                  <Badge variant="secondary">
                    <Text className="text-[10px]">{STATUS_COMPETENCIA_LABELS[h.status]}</Text>
                  </Badge>
                  {/*
                    Aprovar e pagar aparecem para quem PODE: o RPC recusa quem não é gestor,
                    em português, e é essa recusa que a tela mostra. Esconder o botão exigiria
                    uma segunda régua de permissão no bundle do app.
                  */}
                  {h.status === 'fechada' ? (
                    <Button size="sm" disabled={agindo} onPress={() => void marcar(h.competencia, 'aprovada')}>
                      <Text className="text-sm">Aprovar</Text>
                    </Button>
                  ) : null}
                  {h.status === 'aprovada' ? (
                    <Button size="sm" variant="outline" disabled={agindo}
                      onPress={() => void marcar(h.competencia, 'paga')}>
                      <Text className="text-sm">Marcar paga</Text>
                    </Button>
                  ) : null}
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {aba === 'extrato' ? (
        <View className="gap-2">
          <Text variant="muted" className="text-xs">
            {mes(competencia)} — toque numa linha para ver a conta por extenso.
          </Text>
          <Extrato competencia={competencia} />
        </View>
      ) : null}
    </ScrollView>
  )
}
