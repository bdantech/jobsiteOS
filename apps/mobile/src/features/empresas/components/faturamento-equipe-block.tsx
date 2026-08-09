import {
  ORIGEM_METRICA_LABELS,
  anoReferenciaMetrica,
  crescimento12m,
  type OrigemMetrica,
  type Tables,
} from '@jobsiteos/core'
import { useQuery } from '@tanstack/react-query'
import { TrendingDown, TrendingUp } from 'lucide-react-native'
import * as React from 'react'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { supabase } from '@/lib/supabase'
import { empresasKeys } from '../queries'
import type { Empresa } from '../types'

/**
 * Faturamento & Equipe no celular (04c §8).
 *
 * O que vem para cá é o que se usa em pé, antes de uma reunião: o número, de ONDE
 * ele veio e se a equipe está crescendo. A sparkline e a tabela de coeficientes
 * ficam na web — aqui elas seriam decoração ilegível.
 *
 * A origem é exibida com o mesmo peso do valor de propósito. "R$ 40M declarado" e
 * "R$ 40M estimado" levam a conversas diferentes, e quem está com o cliente na
 * frente é justamente quem não pode confundir os dois.
 */

type Metrica = Tables<'empresa_metricas'>

async function buscarMetricas(cnpj: string): Promise<Metrica[]> {
  const { data, error } = await supabase
    .from('empresa_metricas')
    .select('*')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return data ?? []
}

function moeda(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function data(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function rotuloOrigem(o: string | null): string {
  if (!o) return 'Sem dado'
  return ORIGEM_METRICA_LABELS[o as OrigemMetrica] ?? o
}

/**
 * A que ano o número da ficha se refere — que não é o dia em que ele foi lido.
 *
 * O cliente declara hoje o faturamento de 2022, e quem está com ele na frente é
 * exatamente quem não pode ler "04/08/2026" como o ano do número.
 */
function anoVigente(serie: Metrica[], metrica: string, origem: string | null): number | null {
  if (!origem) return null
  const anos = serie
    .filter((m) => m.metrica === metrica && m.origem === origem)
    .map(anoReferenciaMetrica)
    .filter((a): a is number => a !== null)
  return anos.length > 0 ? Math.max(...anos) : null
}

function rotuloAnoEData(ano: number | null, em: string | null): string {
  return ano === null ? `lido em ${data(em)}` : `ref. ${ano} · lido em ${data(em)}`
}

export function FaturamentoEquipeBlock({ empresa }: { empresa: Empresa }) {
  const { colors } = useTheme()

  const { data: serie = [] } = useQuery({
    queryKey: [...empresasKeys.detail(empresa.id), 'metricas'],
    queryFn: () => buscarMetricas(empresa.cnpj),
  })

  const crescimento = React.useMemo(
    () =>
      crescimento12m(
        serie
          .filter((m) => m.metrica === 'funcionarios')
          .map((m) => ({ valor: Number(m.valor), capturado_em: m.capturado_em })),
      ),
    [serie],
  )

  const subiu = (crescimento ?? 0) >= 0
  const Icone = subiu ? TrendingUp : TrendingDown

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Faturamento &amp; Equipe</CardTitle>
        <Text variant="muted" className="text-xs">
          Fontes como o Apollo subcontam mão de obra de canteiro. O número compara
          empresas entre si — não é quadro real.
        </Text>
      </CardHeader>

      <CardContent className="gap-3">
        <View className="gap-1">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Faturamento anual
          </Text>
          <Text className="text-xl font-semibold">{moeda(empresa.faturamento_anual)}</Text>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              <Text className="text-[10px]">{rotuloOrigem(empresa.faturamento_origem)}</Text>
            </Badge>
            {empresa.faturamento_confianca ? (
              <Badge variant="outline">
                <Text className="text-[10px]">confiança {empresa.faturamento_confianca}</Text>
              </Badge>
            ) : null}
            <Text variant="muted" className="text-[11px]">
              {rotuloAnoEData(
                anoVigente(serie, 'faturamento_anual', empresa.faturamento_origem),
                empresa.faturamento_atualizado_em,
              )}
            </Text>
          </View>
        </View>

        <View className="gap-1 border-t border-border pt-3">
          <Text variant="muted" className="text-xs uppercase tracking-wide">
            Funcionários
          </Text>
          <View className="flex-row items-baseline gap-2">
            <Text className="text-xl font-semibold">
              {empresa.funcionarios === null ? '—' : empresa.funcionarios.toLocaleString('pt-BR')}
            </Text>
            {crescimento !== null ? (
              <View className="flex-row items-center gap-0.5">
                <Icone size={12} color={subiu ? colors.mutedForeground : colors.destructive} />
                <Text
                  className={`text-xs font-medium ${subiu ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}`}
                >
                  {subiu ? '+' : ''}
                  {(crescimento * 100).toFixed(0)}% em 12m
                </Text>
              </View>
            ) : null}
          </View>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Badge variant="outline">
              <Text className="text-[10px]">{rotuloOrigem(empresa.funcionarios_origem)}</Text>
            </Badge>
            <Text variant="muted" className="text-[11px]">
              {rotuloAnoEData(
                anoVigente(serie, 'funcionarios', empresa.funcionarios_origem),
                empresa.funcionarios_atualizado_em,
              )}
            </Text>
          </View>
        </View>

        {/*
         * Leitura, não ação. Disparar o Apollo daqui deixaria a tela esperando um
         * resultado assíncrono que ninguém está olhando — e o botão vive na web,
         * onde a pessoa já está no meio de um trabalho de enriquecimento.
         */}
        <Text variant="muted" className="border-t border-border pt-2 text-[11px]">
          Atualize os funcionários pela web (Company 360).
        </Text>
      </CardContent>
    </Card>
  )
}
