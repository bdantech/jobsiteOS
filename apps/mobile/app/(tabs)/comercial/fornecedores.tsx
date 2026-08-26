import * as React from 'react'
import {
  CONFIANCA_LABELS,
  ESTAGIOS_FORNECEDOR_ATIVOS,
  ESTAGIO_FORNECEDOR_LABELS,
  FONTE_CONTATO_LABELS,
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_LABELS,
  type Confianca,
  type EstagioFornecedor,
  type FonteContato,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import {
  ArrowLeft, Building2, Mail, MessageSquare, Phone, Star, ThumbsDown,
} from 'lucide-react-native'
import {
  ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, View,
} from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { EmptyState, ErrorState } from '@/components/ui/states'
import {
  useAcoesFornecedor,
  useContatosDoFornecedor,
  useFunilFornecedores,
  usePainelFornecedores,
  type FornecedorMobile,
} from '@/features/comercial/fornecedores'

/**
 * Cadastro de Fornecedores no celular (04l §5).
 *
 * É a tela do Comercial que mais pertence ao celular: o uso real é na obra ou no
 * carro, com a ficha de abordagem na mão. Por isso o desenho aqui é o oposto do
 * kanban da web — uma lista por potencial, e dentro do card os botões de LIGAR,
 * WhatsApp e e-mail em um toque.
 *
 * Cada toque registra `toque.manual` com o CONTATO usado. Não é telemetria: é o que
 * permite ao painel de eficácia responder, três meses depois, qual fonte levou ao
 * cadastro — e portanto qual provedor vale continuar pagando.
 */

const brl = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const dia = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR') : '—'

function exibirTelefone(v: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(v)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : v
}

export default function FornecedoresScreen() {
  const { colors } = useTheme()
  const [estagio, setEstagio] = React.useState<EstagioFornecedor | 'todos'>('todos')
  const [aberto, setAberto] = React.useState<FornecedorMobile | null>(null)

  const painel = usePainelFornecedores()
  const funil = useFunilFornecedores(estagio)

  if (funil.isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (funil.isError) return <ErrorState onRetry={() => void funil.refetch()} />

  const lista = funil.data ?? []

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3 p-4"
        refreshControl={
          <RefreshControl refreshing={funil.isRefetching} onRefresh={() => void funil.refetch()} />
        }
      >
        {painel.data?.tem_acesso ? (
          <Card className="gap-1 p-4">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              Potencial na carteira
            </Text>
            <Text className="text-2xl font-semibold">{brl(painel.data.potencial_total)}</Text>
            <Text variant="muted" className="text-[11px]">
              Faturamento mensal estimado dos fornecedores ainda não cadastrados. Gasto em
              descoberta este mês: {brl(painel.data.gasto_mes)} de {brl(painel.data.teto_mensal)}.
            </Text>
          </Card>
        ) : null}

        {/* Filtro por estágio. Rolagem horizontal porque são cinco e a tela é estreita. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          <Chip rotulo="Todos" ativo={estagio === 'todos'} onPress={() => setEstagio('todos')} />
          {ESTAGIOS_FORNECEDOR_ATIVOS.map((e) => (
            <Chip
              key={e}
              rotulo={ESTAGIO_FORNECEDOR_LABELS[e]}
              ativo={estagio === e}
              onPress={() => setEstagio(e)}
            />
          ))}
        </ScrollView>

        {lista.length === 0 ? (
          <EmptyState
            title="Nada por aqui"
            description="Fornecedores que faturam contra os sacados da sua carteira e passam do corte de volume entram sozinhos, no sync das notas."
          />
        ) : (
          lista.map((f) => (
            <Pressable key={f.fornecedor_cnpj} onPress={() => setAberto(f)}>
              <Card className="gap-1 p-4">
                <Text className="font-medium">{f.fornecedor_nome}</Text>
                <Text variant="muted" className="text-xs">
                  {[f.municipio, f.uf].filter(Boolean).join('/') || '—'} · {f.qtd_nfs_90d ?? 0} NFs ·{' '}
                  {brl(f.potencial_mensal)}/mês de potencial
                </Text>
                <View className="flex-row items-baseline justify-between pt-1">
                  {/* O VOLUME lidera: é a chave da ordenação, e é ele que explica por
                      que este card está acima daquele. */}
                  <Text className="text-lg font-semibold">
                    {brl(f.volume_90d)}
                    <Text variant="muted" className="text-xs"> em 90d</Text>
                  </Text>
                  <Badge variant={f.melhor_confianca === 'alta' ? 'default' : 'outline'}>
                    <Text className="text-[10px]">
                      {f.contatos_encontrados
                        ? `${f.contatos_encontrados} · ${CONFIANCA_LABELS[f.melhor_confianca as Confianca] ?? '—'}`
                        : 'sem contato'}
                    </Text>
                  </Badge>
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>

      <FichaModal fornecedor={aberto} onFechar={() => setAberto(null)} />
    </>
  )
}

function Chip({ rotulo, ativo, onPress }: { rotulo: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Badge variant={ativo ? 'default' : 'outline'}>
        <Text className="text-[11px]">{rotulo}</Text>
      </Badge>
    </Pressable>
  )
}

// ─── Ficha ──────────────────────────────────────────────────────────────────

function FichaModal({
  fornecedor,
  onFechar,
}: {
  fornecedor: FornecedorMobile | null
  onFechar: () => void
}) {
  const { colors } = useTheme()
  const contatos = useContatosDoFornecedor(fornecedor?.fornecedor_cnpj ?? null)
  const acoes = useAcoesFornecedor()
  const [descartando, setDescartando] = React.useState(false)

  if (!fornecedor) return null

  const abrir = (tipo: string, valor: string, id: string): void => {
    const url =
      tipo === 'email'
        ? `mailto:${valor}`
        : tipo === 'whatsapp'
          ? `https://wa.me/${valor.replace(/\D/g, '')}`
          : tipo === 'site'
            ? `https://${valor}`
            : tipo === 'instagram'
              ? `https://instagram.com/${valor}`
              : `tel:${valor}`

    // O toque é registrado ANTES de abrir o discador: depois de sair do app, o
    // callback pode não voltar, e um toque não registrado é um dado que o painel de
    // eficácia nunca recupera.
    if (tipo === 'telefone' || tipo === 'whatsapp' || tipo === 'email') {
      acoes.registrarToque.mutate({
        cnpj: fornecedor.fornecedor_cnpj,
        canal: tipo === 'email' ? 'email' : tipo === 'whatsapp' ? 'whatsapp' : 'ligacao',
        contatoId: id,
      })
    }
    void Linking.openURL(url)
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onFechar}>
      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4">
        <Pressable onPress={onFechar} className="flex-row items-center gap-2 pb-1">
          <ArrowLeft size={18} color={colors.mutedForeground} />
          <Text variant="muted">Voltar</Text>
        </Pressable>

        <View className="gap-1">
          <Text className="text-xl font-semibold">{fornecedor.fornecedor_nome}</Text>
          <Text variant="muted" className="text-xs">
            {[fornecedor.municipio, fornecedor.uf].filter(Boolean).join('/')}
            {fornecedor.originador_nome ? ` · ${fornecedor.originador_nome}` : ' · sem dono'}
          </Text>
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            <Badge variant="outline">
              <Text className="text-[10px]">{ESTAGIO_FORNECEDOR_LABELS[fornecedor.estagio]}</Text>
            </Badge>
            {fornecedor.suprimido ? (
              <Badge variant="destructive"><Text className="text-[10px]">suprimido</Text></Badge>
            ) : null}
          </View>
        </View>

        {/* A munição, primeiro: é o que a pessoa vai DIZER na ligação. */}
        <Card className="gap-2 p-4">
          <Linha rotulo="Volume 90 dias" valor={brl(fornecedor.volume_90d)} />
          <Linha rotulo="Notas em 90 dias" valor={String(fornecedor.qtd_nfs_90d ?? '—')} />
          <Linha
            rotulo="Prazo médio"
            valor={fornecedor.prazo_medio_dias === null ? '—' : `${fornecedor.prazo_medio_dias} dias`}
          />
          <Linha rotulo="Potencial mensal" valor={brl(fornecedor.potencial_mensal)} destaque />
          <Linha rotulo="Última NF" valor={dia(fornecedor.ultima_nf_em)} />
        </Card>

        {fornecedor.sacados_principais.length > 0 ? (
          <Card className="gap-1.5 p-4">
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              Contra quem ele fatura
            </Text>
            {fornecedor.sacados_principais.slice(0, 5).map((s) => (
              <View key={s.cnpj} className="flex-row items-baseline justify-between gap-2">
                <View className="flex-1 flex-row items-center gap-1.5">
                  <Building2 size={12} color={colors.mutedForeground} />
                  <Text className="flex-1 text-sm" numberOfLines={1}>{s.nome ?? s.cnpj}</Text>
                </View>
                <Text variant="muted" className="text-xs">{brl(Number(s.valor))}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card className="gap-2 p-4">
          <Text variant="muted" className="text-xs uppercase tracking-wide">Contatos</Text>
          {contatos.isPending ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (contatos.data ?? []).length === 0 ? (
            <Text variant="muted" className="text-sm">
              Nada encontrado ainda. A varredura automática roda de madrugada; a busca paga fica
              na web, onde o custo aparece antes do clique.
            </Text>
          ) : (
            (contatos.data ?? []).map((c) => (
              <View key={c.id} className="gap-1 rounded-md border border-border p-2">
                <Pressable
                  className="flex-row items-center justify-between gap-2"
                  onPress={() => abrir(c.tipo, c.valor, c.id)}
                >
                  <View className="flex-1 flex-row items-center gap-2">
                    <IconeCanal tipo={c.tipo} cor={colors.mutedForeground} />
                    <Text className="flex-1 font-medium" numberOfLines={1}>
                      {c.tipo === 'telefone' || c.tipo === 'whatsapp' ? exibirTelefone(c.valor) : c.valor}
                    </Text>
                  </View>
                  <Badge variant={c.confianca === 'alta' ? 'default' : 'outline'}>
                    <Text className="text-[10px]">{CONFIANCA_LABELS[c.confianca]}</Text>
                  </Badge>
                </Pressable>
                <Text variant="muted" className="text-[11px]">
                  {FONTE_CONTATO_LABELS[c.fonte as FonteContato] ?? c.fonte}
                  {c.frequencia > 1 ? ` · visto ${c.frequencia}×` : ''}
                  {c.invalido ? ' · não valida' : ''}
                  {c.evidencia ? ` · ${c.evidencia}` : ''}
                </Text>
                {!c.ja_na_ficha && ['telefone', 'email', 'whatsapp'].includes(c.tipo) ? (
                  <Pressable
                    className="flex-row items-center gap-1.5 pt-0.5"
                    onPress={() => acoes.promoverPontoFocal.mutate(c.id)}
                  >
                    <Star size={12} color={colors.mutedForeground} />
                    <Text variant="muted" className="text-[11px]">Tornar ponto focal</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </Card>

        {/* Mover estágio: um toque por coluna, sem seletor. */}
        <Card className="gap-2 p-4">
          <Text variant="muted" className="text-xs uppercase tracking-wide">Mover para</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {ESTAGIOS_FORNECEDOR_ATIVOS.filter((e) => e !== fornecedor.estagio).map((e) => (
              <Pressable
                key={e}
                onPress={() =>
                  acoes.mover.mutate({ cnpj: fornecedor.fornecedor_cnpj, estagio: e })
                }
              >
                <Badge variant="outline"><Text className="text-[11px]">{ESTAGIO_FORNECEDOR_LABELS[e]}</Text></Badge>
              </Pressable>
            ))}
          </View>
        </Card>

        <Pressable
          className="flex-row items-center justify-center gap-2 rounded-md border border-destructive p-3"
          onPress={() => setDescartando(true)}
        >
          <ThumbsDown size={14} color={colors.destructive} />
          <Text className="text-sm" style={{ color: colors.destructive }}>Marcar sem interesse</Text>
        </Pressable>
      </ScrollView>

      <ModalSemInteresse
        visivel={descartando}
        onFechar={() => setDescartando(false)}
        onConfirmar={(motivo, eterna) => {
          acoes.semInteresse.mutate(
            { cnpj: fornecedor.fornecedor_cnpj, motivo, eterna },
            { onSuccess: () => { setDescartando(false); onFechar() } },
          )
        }}
      />
    </Modal>
  )
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between gap-2">
      <Text variant="muted" className="text-sm">{rotulo}</Text>
      <Text className={destaque ? 'text-lg font-semibold' : 'text-sm'}>{valor}</Text>
    </View>
  )
}

function IconeCanal({ tipo, cor }: { tipo: string; cor: string }) {
  if (tipo === 'email') return <Mail size={14} color={cor} />
  if (tipo === 'whatsapp') return <MessageSquare size={14} color={cor} />
  if (tipo === 'telefone') return <Phone size={14} color={cor} />
  return <Building2 size={14} color={cor} />
}

/**
 * "Outro" NÃO é oferecido no celular.
 *
 * Ele exige observação escrita, e digitar um parágrafo de justificativa em pé, numa
 * obra, é o caminho mais curto para uma observação vazia — que é exatamente o que o
 * motivo enumerado existe para evitar. Quem precisa de "outro" usa a web.
 */
function ModalSemInteresse({
  visivel,
  onFechar,
  onConfirmar,
}: {
  visivel: boolean
  onFechar: () => void
  onConfirmar: (motivo: MotivoSemInteresse, eterna: boolean) => void
}) {
  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onFechar}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onFechar}>
        <Pressable className="gap-2 rounded-t-2xl bg-background p-4" onPress={(e) => e.stopPropagation()}>
          <Text className="text-lg font-semibold">Por que não vai se cadastrar?</Text>
          <Text variant="muted" className="text-xs">
            Isto suprime o CNPJ em todos os canais por 90 dias — ele também sai da lista a
            prospectar da Antecipação e para de gerar mensagem.
          </Text>
          {MOTIVOS_SEM_INTERESSE.filter((m) => m !== 'outro').map((m) => (
            <Pressable
              key={m}
              className="rounded-md border border-border p-3"
              onPress={() => onConfirmar(m, false)}
            >
              <Text className="text-sm">{MOTIVO_SEM_INTERESSE_LABELS[m]}</Text>
            </Pressable>
          ))}
          <Pressable className="p-3" onPress={onFechar}>
            <Text variant="muted" className="text-center text-sm">Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
