import { useQuery } from '@tanstack/react-query'
import { Clock, Landmark } from 'lucide-react-native'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'

/**
 * O cadastro da Receita do fornecedor, na tela onde a decisão é tomada.
 *
 * Três números respondem "vale a pena abordar?" antes de qualquer ligação:
 * capital social (tamanho), idade (se sobreviveu) e situação cadastral (se está
 * de pé). Nenhum deles vem da NF — vêm de `mercado_universo`, alimentado pelo
 * lookup cadastral.
 *
 * Sem linha no universo, o card DIZ isso. Um card vazio seria lido como "capital
 * zero, empresa nova", que é uma conclusão e não uma ausência.
 *
 * Mora em `features/cadastro` e não dentro de Antecipação porque Empresas usa o
 * mesmo card pelo mesmo motivo — e um feature importando componente de outro
 * feature é o começo do emaranhado.
 */

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

function formatarMoeda(valor: number | null): string {
  return valor === null || valor === undefined ? '—' : MOEDA.format(valor)
}

const COLUNAS =
  'cnpj, capital_social, situacao_cadastral, porte_rfb, data_inicio_atividade, opcao_simples, cnae_principal'

interface CadastroRfb {
  cnpj: string
  capital_social: number | null
  situacao_cadastral: string | null
  porte_rfb: string | null
  data_inicio_atividade: string | null
  opcao_simples: boolean | null
  cnae_principal: string | null
}

export const cadastroKeys = {
  rfb: (cnpj: string) => ['cadastro-rfb', cnpj] as const,
}

async function fetchCadastroRfb(cnpj: string): Promise<CadastroRfb | null> {
  const { data, error } = await supabase
    .from('mercado_universo')
    .select(COLUNAS)
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw error
  return (data as CadastroRfb | null) ?? null
}

function idadeEmAnos(inicio: string | null): number | null {
  if (!inicio) return null
  const d = new Date(`${inicio.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const hoje = new Date()
  let anos = hoje.getFullYear() - d.getFullYear()
  const antesDoAniversario =
    hoje.getMonth() < d.getMonth() ||
    (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())
  if (antesDoAniversario) anos--
  return anos >= 0 ? anos : null
}

/** Baixada e inapta mudam a decisão sozinhas — por isso viram badge, não texto. */
function varianteSituacao(situacao: string | null): 'default' | 'secondary' | 'destructive' {
  if (situacao === 'baixada' || situacao === 'nula') return 'destructive'
  if (situacao === 'ativa') return 'default'
  return 'secondary'
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <View className="min-w-[30%] flex-1 gap-0.5">
      <Text variant="muted" className="text-xs">
        {rotulo}
      </Text>
      {children}
    </View>
  )
}

export function CadastroRfbCard({ cnpj }: { cnpj: string }) {
  const { colors } = useTheme()
  const { data, isPending, isError } = useQuery({
    queryKey: cadastroKeys.rfb(cnpj),
    queryFn: () => fetchCadastroRfb(cnpj),
  })

  if (isPending) {
    return (
      <Card>
        <CardContent className="gap-2 pt-6">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Cadastro (Receita Federal)</CardTitle>
        </CardHeader>
        <CardContent className="flex-row items-start gap-2">
          <Clock size={14} color={colors.mutedForeground} />
          <Text variant="muted" className="flex-1 text-xs">
            {isError
              ? 'Não foi possível carregar o cadastro agora.'
              : 'Ainda não temos o cadastro deste CNPJ — ele entra na fila de enriquecimento e o job diário a consome.'}
          </Text>
        </CardContent>
      </Card>
    )
  }

  const idade = idadeEmAnos(data.data_inicio_atividade)

  return (
    <Card>
      <CardHeader className="pb-2">
        <View className="flex-row items-center gap-2">
          <Landmark size={14} color={colors.mutedForeground} />
          <CardTitle>Cadastro (Receita Federal)</CardTitle>
        </View>
      </CardHeader>
      <CardContent className="flex-row flex-wrap gap-3">
        <Item rotulo="Capital social">
          <Text className="font-semibold tabular-nums">{formatarMoeda(data.capital_social)}</Text>
        </Item>
        <Item rotulo="Situação">
          {data.situacao_cadastral ? (
            <View className="flex-row">
              <Badge variant={varianteSituacao(data.situacao_cadastral)}>
                <Text className="text-[11px] capitalize">{data.situacao_cadastral}</Text>
              </Badge>
            </View>
          ) : (
            <Text>—</Text>
          )}
        </Item>
        <Item rotulo="Idade">
          <Text className="font-semibold tabular-nums">
            {idade === null ? '—' : `${idade} ${idade === 1 ? 'ano' : 'anos'}`}
          </Text>
        </Item>
        <Item rotulo="Porte">
          <Text>{data.porte_rfb ?? '—'}</Text>
        </Item>
        <Item rotulo="CNAE">
          <Text className="tabular-nums">{data.cnae_principal ?? '—'}</Text>
        </Item>
        <Item rotulo="Simples">
          <Text>{data.opcao_simples === null ? '—' : data.opcao_simples ? 'Sim' : 'Não'}</Text>
        </Item>
      </CardContent>
    </Card>
  )
}
