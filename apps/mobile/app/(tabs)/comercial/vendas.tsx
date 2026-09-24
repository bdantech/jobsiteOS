import {
  ESTAGIOS_VENDA,
  ESTAGIO_ANALISE_LABELS,
  ESTAGIO_VENDA_LABELS,
  FAIXA_SCORE_LABELS,
  type EstagioAnalise,
  type EstagioVenda,
  type FaixaScore,
} from '@jobsiteos/core'
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
import { proximoEstagioVenda, useMover, useVendas, type VendaMobile } from '@/features/comercial'
import { FunilComercial, useDonosDoFunil } from '@/features/comercial/components/funil-comercial'
import { cn } from '@/lib/utils'
import { useRotaDaEmpresa } from '@/lib/navegacao'

/**
 * Funil do closer no celular. Mesma regra do funil de SDR: um botão, o próximo passo.
 *
 * Perder não está aqui — exige motivo, e motivo escolhido às pressas vira "Outro". Um
 * card em análise de crédito também não anda: quem move é a decisão da seguradora.
 */
export default function FunilVendasScreen() {
  const router = useRouter()
  const rotaDaEmpresa = useRotaDaEmpresa()
  const { colors } = useTheme()
  const [movendo, setMovendo] = useState<string | null>(null)
  const { data, isPending, isError, refetch, isRefetching } = useVendas()
  const { moverVenda } = useMover()
  const donoDe = useDonosDoFunil()

  function card(item: VendaMobile) {
    const proximo = proximoEstagioVenda(item.estagio)
    const dono = donoDe(item.vendedor_id)
    const empresa = item.empresas
    const credito = item.analises_credito
    const negado = credito?.estagio === 'negada'

    /*
     * A TIRA DO CARD — uma só, pela mesma prioridade da web: a recusa primeiro,
     * porque um negócio negado não pode parecer igual a um que ninguém analisou; o
     * limite aprovado depois; o "aguardando" só enquanto a análise corre.
     */
    const tira: { tom: 'ruim' | 'bom' | 'neutro'; texto: string } | null = negado
      ? { tom: 'ruim', texto: `Crédito negado${credito?.motivo ? ` — ${credito.motivo}` : ''}` }
      : credito?.limite_aprovado
        ? {
            tom: 'bom',
            texto: `${formatarMoeda(credito.limite_aprovado)} aprovados${
              credito.estagio === 'aprovada_parcial' ? ' (parcial)' : ''
            }`,
          }
        : item.estagio === 'em_analise_credito' && item.situacao === 'em_andamento'
          ? {
              tom: 'neutro',
              texto: credito
                ? `Crédito: ${ESTAGIO_ANALISE_LABELS[credito.estagio as EstagioAnalise] ?? credito.estagio}.`
                : 'Aguardando a seguradora. O card anda sozinho quando ela decidir.',
            }
          : item.situacao === 'ganho'
            ? { tom: 'neutro', texto: 'Ganho, sem operar ainda — sai do funil na primeira antecipação.' }
            : null

    return (
      <Card className="gap-2 p-4">
        <Pressable
          onPress={() => empresa && router.push(rotaDaEmpresa(empresa.id))}
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
            <Text className="text-[10px]">
              {ESTAGIO_VENDA_LABELS[item.estagio as EstagioVenda] ?? item.estagio}
            </Text>
          </Badge>
          {empresa?.uf ? (
            <Badge variant="outline">
              <Text className="text-[10px]">{empresa.uf}</Text>
            </Badge>
          ) : null}
          {item.situacao === 'ganho' ? (
            <Badge variant="outline">
              <Text className="text-[10px]">Ganho</Text>
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

        {tira ? (
          <View
            className={cn(
              'rounded-md px-2.5 py-1.5',
              tira.tom === 'ruim' && 'bg-destructive/10',
              tira.tom === 'bom' && 'bg-emerald-500/10',
              tira.tom === 'neutro' && 'bg-muted',
            )}
          >
            <Text
              numberOfLines={2}
              className={cn(
                'text-[11px] font-medium',
                tira.tom === 'ruim' && 'text-destructive',
                tira.tom === 'bom' && 'text-emerald-700 dark:text-emerald-300',
                tira.tom === 'neutro' && 'text-muted-foreground',
              )}
            >
              {tira.texto}
            </Text>
          </View>
        ) : null}

        {dono ? (
          <Text variant="muted" className="text-[11px]">
            Closer: {dono}
          </Text>
        ) : null}

        {/* Crédito negado trava o que vem depois da análise, como na web: sem
            limite não há operação, e avançar o card mentiria sobre o negócio. */}
        {proximo && !negado ? (
          <Button
            variant="outline"
            disabled={movendo === item.id}
            onPress={async () => {
              setMovendo(item.id)
              try {
                await moverVenda(item.id, proximo)
              } finally {
                setMovendo(null)
              }
            }}
          >
            <Text>{ESTAGIO_VENDA_LABELS[proximo]}</Text>
            <ChevronRight size={14} color={colors.foreground} />
          </Button>
        ) : null}
      </Card>
    )
  }

  return (
    <FunilComercial
      titulo="Funil de Vendas"
      unidade={['venda', 'vendas']}
      itens={data}
      isPending={isPending}
      isError={isError}
      isRefetching={isRefetching}
      refetch={() => void refetch()}
      estagios={ESTAGIOS_VENDA}
      rotuloDoEstagio={ESTAGIO_VENDA_LABELS}
      chave={(v) => v.id}
      estagioDe={(v) => v.estagio}
      nomeDe={(v) => v.empresas?.razao_social}
      renderCard={card}
      vazio={{
        titulo: 'Nenhuma venda em aberto',
        descricao: 'Reuniões agendadas por SDRs aparecem aqui.',
      }}
    />
  )
}
