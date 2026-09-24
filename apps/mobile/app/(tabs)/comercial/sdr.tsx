import { FAIXA_SCORE_LABELS, type FaixaScore } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { formatarMoeda } from '@/features/antecipacao'
import {
  ESTAGIOS_SDR,
  ESTAGIO_SDR_LABELS,
  proximoEstagioSdr,
  rotuloOrigemLead,
  useLeads,
  useMover,
  type LeadMobile,
} from '@/features/comercial'
import { FunilComercial, useDonosDoFunil } from '@/features/comercial/components/funil-comercial'

/**
 * Funil de reuniões no celular: o kanban da web vira lista com filtro por estágio.
 *
 * Cada card tem UM botão — o próximo passo. As saídas que exigem motivo (sem fit) e
 * o agendamento (data, closer, convidados) não estão aqui de propósito: escolher um
 * motivo numa lista de seis, com o polegar, é como o motivo vira sempre "Outro" — e
 * o motivo é o dado mais valioso deste funil.
 */
export default function FunilSdrScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [movendo, setMovendo] = useState<string | null>(null)
  const { data, isPending, isError, refetch, isRefetching } = useLeads()
  const { moverLead, marcarComFit } = useMover()
  const donoDe = useDonosDoFunil()

  async function agir(id: string, acao: () => Promise<void>) {
    setMovendo(id)
    try {
      await acao()
    } finally {
      setMovendo(null)
    }
  }

  function card(item: LeadMobile) {
    const proximo = proximoEstagioSdr(item.estagio)
    const dono = donoDe(item.sdr_id)
    const empresa = item.empresas

    return (
      <Card className="gap-2 p-4">
        <Pressable
          onPress={() => empresa && router.push(`/empresas/${empresa.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${empresa?.razao_social ?? 'empresa'}`}
          className="gap-0.5"
        >
          <Text numberOfLines={1} className="font-medium">
            {empresa?.razao_social ?? 'Empresa'}
          </Text>
          {empresa?.valor_esperado_mensal ? (
            <Text variant="muted" className="text-xs tabular-nums">
              {formatarMoeda(empresa.valor_esperado_mensal)}/mês esperado
            </Text>
          ) : null}
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            <Text className="text-[10px]">{ESTAGIO_SDR_LABELS[item.estagio as never] ?? item.estagio}</Text>
          </Badge>
          {empresa?.uf ? (
            <Badge variant="outline">
              <Text className="text-[10px]">{empresa.uf}</Text>
            </Badge>
          ) : null}
          {/* A porta pela qual o lead entrou: muda a primeira frase da ligação. */}
          <Badge variant="outline">
            <Text className="text-[10px]">{rotuloOrigemLead(item.origem)}</Text>
          </Badge>
          {item.fit === true ? (
            <Badge variant="outline">
              <Text className="text-[10px]">Com fit</Text>
            </Badge>
          ) : null}
          {empresa?.score_faixa ? (
            <Badge variant="secondary">
              <Text className="text-[10px]">
                Score {FAIXA_SCORE_LABELS[empresa.score_faixa as FaixaScore] ?? empresa.score_faixa}
              </Text>
            </Badge>
          ) : null}
        </View>

        {item.reuniao_em || dono ? (
          <Text variant="muted" className="text-[11px]">
            {item.reuniao_em
              ? `Reunião em ${new Date(item.reuniao_em).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : ''}
            {item.reuniao_em && dono ? ' · ' : ''}
            {dono ? `SDR: ${dono}` : ''}
          </Text>
        ) : null}

        {proximo ? (
          <Button
            variant="outline"
            disabled={movendo === item.id}
            onPress={() => void agir(item.id, () => moverLead(item.id, proximo))}
          >
            <Text>{ESTAGIO_SDR_LABELS[proximo]}</Text>
            <ChevronRight size={14} color={colors.foreground} />
          </Button>
        ) : item.estagio === 'em_conversa' || item.estagio === 'no_show' ? (
          <Text variant="muted" className="text-[11px]">
            O próximo passo daqui é agendar, que pede data e closer — faça na web.
          </Text>
        ) : null}

        {item.estagio !== 'a_contatar' && item.fit !== true ? (
          <Button
            variant="ghost"
            disabled={movendo === item.id}
            onPress={() => void agir(item.id, () => marcarComFit(item.id))}
          >
            <Text>Marcar com fit</Text>
          </Button>
        ) : null}
      </Card>
    )
  }

  return (
    <FunilComercial
      titulo="Funil de Reuniões"
      unidade={['lead', 'leads']}
      itens={data}
      isPending={isPending}
      isError={isError}
      isRefetching={isRefetching}
      refetch={() => void refetch()}
      estagios={ESTAGIOS_SDR}
      rotuloDoEstagio={ESTAGIO_SDR_LABELS}
      chave={(l) => l.id}
      estagioDe={(l) => l.estagio}
      nomeDe={(l) => l.empresas?.razao_social}
      renderCard={card}
      vazio={{ titulo: 'Nenhum lead vivo', descricao: 'A distribuição roda toda segunda de manhã.' }}
    />
  )
}
