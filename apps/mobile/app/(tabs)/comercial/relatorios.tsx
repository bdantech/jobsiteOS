import {
  ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, View,
} from 'react-native'
import { FileText } from 'lucide-react-native'
import {
  brlCurto, direcaoDa, textoDaRegua, textoDoRetrato, variacaoTexto,
  type IndicadorReport,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { urlDoPdf, useReportSemanal } from '@/features/comercial/relatorios'
import { cn } from '@/lib/utils'

/**
 * O Report Semanal no celular (04q §7).
 *
 * O RESUMO abre a tela, e os quatro números vêm depois — a ordem inverte a da web de
 * propósito: quem abre isto no táxi de segunda quer saber COMO FOI a semana, e os três
 * parágrafos já são a leitura executiva inteira. Os números confirmam; eles não abrem.
 *
 * Os dashboards completos e a configuração de envio ficam na web. Comparar tabela e mexer
 * na caixa de entrada de outras pessoas não se faz com uma mão, em pé.
 */
export default function RelatoriosScreen() {
  const { colors } = useTheme()
  const { data, isPending, isError, refetch, isRefetching } = useReportSemanal()

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data?.report) {
    return (
      <EmptyState
        title="Sem acesso"
        description="O Report Semanal é leitura de gestor — ele mostra a carteira inteira e a comissão de cada pessoa."
      />
    )
  }

  const r = data.report
  const k = r.operacao.kpis

  /*
   * No celular o PDF ABRE, não baixa — e o rótulo diz isso.
   *
   * `Linking.openURL` entrega ao visualizador do sistema, de onde dá para salvar, mandar
   * por WhatsApp ou imprimir. Forçar `Content-Disposition: attachment` daria um arquivo
   * escondido na pasta de downloads, que é o pior dos dois mundos numa mão só.
   */
  async function abrirPdf() {
    if (!data?.pdf) return
    const r = await urlDoPdf(data.pdf)
    if ('erro' in r) {
      Alert.alert('Não foi possível abrir o PDF', r.erro)
      return
    }
    void Linking.openURL(r.url)
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-0.5">
        <Text className="text-xl font-semibold">Report semanal</Text>
        <Text variant="muted" className="text-xs">
          Semana {r.periodo.semana_iso} · {dm(r.periodo.inicio)} a {dm(r.periodo.fim)}
        </Text>
        {/* Metade dos números é fluxo da janela e metade é estoque do momento da leitura.
            Sem esta linha, quem abre a tela depois de ler o PDF acha que um dos dois erra. */}
        <Text variant="muted" className="text-[11px]">{textoDoRetrato(r.periodo)}</Text>
      </View>

      {data.resumo ? (
        <Card className="gap-2 border-l-[3px] border-l-emerald-700 p-4">
          <Text variant="muted" className="text-[10px] uppercase tracking-wide text-emerald-700">
            Resumo da semana
          </Text>
          {data.resumo.split('\n\n').map((p, i) => (
            <Text key={i} className="text-sm leading-relaxed">{p}</Text>
          ))}
        </Card>
      ) : (
        <Card className="border border-dashed p-4">
          <Text variant="muted" className="text-xs">
            O resumo é escrito quando o report é gerado. O próximo envio produz um.
          </Text>
        </Card>
      )}

      <View className="gap-3">
        <Kpi ind={k.volume_convertido} rotulo="Volume convertido" />
        <Kpi ind={k.vop_operado} rotulo="VOP operado" nota="a base de comissão" />
        <Kpi ind={k.receita} rotulo="Receita gerada" />
        <Card className="gap-1 p-3">
          <Text variant="muted" className="text-[10px] uppercase tracking-wide">Limite ocioso</Text>
          <Text className="text-xl font-semibold">{brlCurto(k.limite_ocioso.foto)}</Text>
          <Text variant="muted" className="text-[11px]">
            saldo em {dm(k.limite_ocioso.em)}, sem série
          </Text>
        </Card>
      </View>

      {data.pdf ? (
        <Pressable onPress={() => void abrirPdf()}>
          <Card className="flex-row items-center justify-between p-4">
            <View className="flex-row items-center gap-2">
              <FileText size={16} color={colors.mutedForeground} />
              <Text className="font-medium">Abrir o PDF completo</Text>
            </View>
            <Text variant="muted" className="text-xs">3 páginas</Text>
          </Card>
        </Pressable>
      ) : null}

      <Text variant="muted" className="text-[11px]">
        Os dashboards completos, o histórico e a configuração de envio ficam na web.
      </Text>
    </ScrollView>
  )
}

function Kpi({ ind, rotulo, nota }: { ind: IndicadorReport; rotulo: string; nota?: string }) {
  const dir = direcaoDa(ind.var_semana_pct, ind.subir_e_pior)
  return (
    <Card className="gap-1 p-3">
      <Text variant="muted" className="text-[10px] uppercase tracking-wide">{rotulo}</Text>
      <Text className="text-xl font-semibold">{brlCurto(ind.semana)}</Text>
      <Text variant="muted" className="text-[11px]">
        <Text
          className={cn(
            'text-[11px] font-medium',
            dir === 'melhor' && 'text-emerald-600',
            dir === 'pior' && 'text-destructive',
          )}
        >
          {variacaoTexto(ind.var_semana_pct)}
        </Text>
        {'  vs '}{textoDaRegua(ind)}{nota ? ` · ${nota}` : ''}
      </Text>
    </Card>
  )
}

const dm = (iso: string) => {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a?.slice(2) ?? ''}`
}
