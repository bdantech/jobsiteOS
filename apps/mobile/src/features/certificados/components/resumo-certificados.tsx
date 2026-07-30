import {
  ESTADO_CERTIFICADO_LABELS,
  formatCnpj,
  formatarVencimento,
  textoDias,
  type EstadoCertificado,
} from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ShieldAlert, ShieldCheck } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import type { IndicadoresCertificados, ItemAtencao } from '../api'

/**
 * Certificados no celular (04b §5): os três indicadores + o que exige ação.
 *
 * O grid matriz × SPEs não vem para cá de propósito — são 47 clientes com até 370
 * SPEs cada, e um grid rolável em duas direções numa tela de 6" não é consultável.
 * O que serve fora do escritório é a lista de urgência com o caminho para a empresa.
 */

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`)

/** Uma casa decimal nas SPEs: com centenas delas, 1% são várias empresas. */
const pct1 = (v: number | null): string =>
  v === null
    ? '—'
    : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

function Indicador({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <Card className="flex-1">
      <CardContent className="gap-0.5 py-3">
        <Text className="text-xs text-muted-foreground">{titulo}</Text>
        <Text className="text-xl font-bold">{valor}</Text>
        <Text className="text-[11px] text-muted-foreground">{detalhe}</Text>
      </CardContent>
    </Card>
  )
}

/**
 * Mesma escala de quatro cores da web: âmbar vencendo, laranja vencido (existe e
 * expirou), vermelho ausente (nunca apareceu no endpoint). São ações diferentes —
 * cobrar renovação versus investigar cadastro.
 */
function corDoEstado(estado: EstadoCertificado): { fundo: string; texto: string } {
  if (estado === 'vencendo') {
    return { fundo: 'bg-amber-100 dark:bg-amber-500/20', texto: 'text-amber-900 dark:text-amber-200' }
  }
  if (estado === 'vencido') {
    return { fundo: 'bg-orange-100 dark:bg-orange-500/20', texto: 'text-orange-900 dark:text-orange-200' }
  }
  return { fundo: 'bg-red-100 dark:bg-red-500/20', texto: 'text-red-900 dark:text-red-200' }
}

export interface ResumoCertificadosProps {
  indicadores: IndicadoresCertificados
  atencao: readonly ItemAtencao[]
  sincronizadoEm: string | null
}

export function ResumoCertificados({ indicadores, atencao, sincronizadoEm }: ResumoCertificadosProps) {
  const router = useRouter()
  const { colors } = useTheme()

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <Indicador
          titulo="Clientes OK"
          valor={pct(indicadores.pctClientes)}
          detalhe={`${indicadores.clientesValidos}/${indicadores.clientesTotal}`}
        />
        <Indicador
          titulo="SPEs OK"
          valor={pct1(indicadores.pctSpes)}
          detalhe={`${indicadores.spesValidas}/${indicadores.spesTotal}`}
        />
        <Indicador
          titulo="Ativos"
          valor={String(indicadores.totalAtivos)}
          detalhe="com fornecedores"
        />
      </View>

      <Card>
        <CardHeader className="pb-2">
          <View className="flex-row items-center gap-2">
            <ShieldAlert size={16} color={colors.mutedForeground} />
            <CardTitle className="text-base">Atenção</CardTitle>
            <Badge variant="outline">{atencao.length}</Badge>
          </View>
          <Text className="text-xs text-muted-foreground">
            Certificado vencido significa que paramos de ingerir NF-e daquela empresa.
            {sincronizadoEm ? ` Sincronizado em ${formatarVencimento(sincronizadoEm)}.` : ''}
          </Text>
        </CardHeader>

        <CardContent className="gap-0 px-0 pb-0">
          {atencao.length === 0 ? (
            <View className="items-center gap-2 py-10">
              <ShieldCheck size={22} color={colors.mutedForeground} />
              <Text className="text-sm text-muted-foreground">
                Todos os certificados estão válidos.
              </Text>
            </View>
          ) : (
            atencao.map((item) => {
              const cor = corDoEstado(item.estado)
              // Só navega quando a empresa existe na base: SPE sem `empresa_id` não
              // tem Company 360 para abrir, e um toque que não faz nada é pior que
              // um item que não parece tocável.
              const podeAbrir = Boolean(item.empresaId)
              return (
                <Pressable
                  key={item.cnpj}
                  disabled={!podeAbrir}
                  onPress={() => podeAbrir && router.push(`/empresas/${item.empresaId}`)}
                  className="flex-row items-center justify-between gap-3 border-t border-border px-4 py-3 active:opacity-70"
                >
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-sm font-medium" numberOfLines={1}>
                      {item.nome}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {item.ehMatriz ? 'Matriz' : `SPE de ${item.cliente}`} · {formatCnpj(item.cnpj)}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {item.estado === 'ausente'
                        ? 'Sem certificado na base'
                        : `${formatarVencimento(item.expiraEm)} · ${textoDias(item.diasRestantes)}`}
                    </Text>
                  </View>
                  <View className={`rounded px-2 py-1 ${cor.fundo}`}>
                    <Text className={`text-[11px] font-medium ${cor.texto}`}>
                      {ESTADO_CERTIFICADO_LABELS[item.estado]}
                    </Text>
                  </View>
                </Pressable>
              )
            })
          )}
        </CardContent>
      </Card>
    </View>
  )
}
