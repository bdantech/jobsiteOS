import {
  TIPOS_OPORTUNIDADE,
  TIPO_OPORTUNIDADE_LABELS,
  descreverInstante,
  dinheiroCurto,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { Inbox } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { useJanelaNovidades, useResumoNovidades } from '@/features/antecipacao'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'

/**
 * "Entraram 23 novidades desde seu último expediente" (04t §7), no topo do Meu Dia.
 *
 * É o que transforma o filtro em hábito: o originador abre o app na segunda de manhã e
 * o número já está ali. A janela e a contagem são as mesmas do funil — mesmo hook,
 * mesmo RPC —, e o toque abre o funil com o filtro ligado.
 *
 * No celular o destino é a TELA do funil, e não um modal como na web: aqui todo
 * widget do Meu Dia navega, e um Kanban dentro de uma folha não caberia.
 */
export function CardNovidades({ vendedorId }: { vendedorId: string }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { grantedModuleIds } = useSession()
  const temFunil = grantedModuleIds.includes('antecipacao')
  const { janela, agora } = useJanelaNovidades('expediente')
  const resumo = useResumoNovidades(janela, vendedorId, temFunil)

  // Sem o módulo das notas não há funil para abrir, e um "0 novidades" ali seria
  // uma afirmação sobre uma carteira que a pessoa nem consegue ver.
  if (!temFunil || !janela || resumo.isError) return null

  const total = resumo.data?.total ?? 0
  const porTipo = new Map((resumo.data?.por_tipo ?? []).map((t) => [t.tipo, t]))
  const quebra = TIPOS_OPORTUNIDADE.filter((t) => porTipo.has(t))
    .map((t) => `${porTipo.get(t)!.qtd.toLocaleString('pt-BR')} ${TIPO_OPORTUNIDADE_LABELS[t]}`)
    .join(' · ')

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        total > 0
          ? `${total} novidades no funil desde seu último expediente. Abrir o funil filtrado.`
          : 'Nenhuma novidade no funil desde seu último expediente'
      }
      disabled={resumo.isPending || total === 0}
      onPress={() =>
        router.push({ pathname: '/comercial/nfs', params: { novidades: 'expediente', vendedor: vendedorId } })
      }
    >
      <Card className={cn('gap-1 p-4', total > 0 && 'border-primary/40 bg-primary/5')}>
        <View className="flex-row items-center gap-2">
          <Inbox size={16} color={total > 0 ? colors.primary : colors.mutedForeground} />
          <Text className="flex-1 text-sm font-medium">
            {resumo.isPending
              ? 'Conferindo o que entrou…'
              : total === 0
                ? 'Nenhuma novidade desde seu último expediente'
                : `${total === 1 ? 'Entrou 1 novidade' : `Entraram ${total.toLocaleString('pt-BR')} novidades`} desde seu último expediente`}
          </Text>
        </View>
        <Text variant="muted" className="text-xs">
          desde {descreverInstante(janela.de, agora)}
          {janela.feriadosConsiderados ? '' : ' · feriados podem não estar considerados'}
        </Text>
        {total > 0 ? (
          <Text className="text-xs tabular-nums">
            {quebra} · <Text className="text-xs font-semibold">{dinheiroCurto(resumo.data?.valor ?? 0)}</Text>
          </Text>
        ) : null}
      </Card>
    </Pressable>
  )
}
