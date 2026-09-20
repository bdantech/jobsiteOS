import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatarMoeda } from '@/features/antecipacao/format'
import { mensagemDeErro, useSolicitarAnaliseSacado } from '../queries'
import type { SacadoProspeccao } from '../types'

/**
 * Abrir a análise na esteira, do campo.
 *
 * O limite vem PRÉ-PREENCHIDO do potencial calculado e arredondado para milhares — a
 * mesma régua da esteira. Um limite sugerido com centavos denuncia que ninguém decidiu o
 * número, e quem lê o pedido do outro lado percebe.
 *
 * A folha diz o que vai acontecer DEPOIS do clique, e isso é o essencial: a partir daqui
 * quem manda no card é a esteira. Aprovada, o sacado entra na carteira de quem o
 * descobriu (§7) e as notas dele caem no funil de NFs.
 */

export interface SolicitarAnaliseSheetProps {
  sacado: SacadoProspeccao | null
  onFechar: () => void
}

export function SolicitarAnaliseSheet({ sacado, onFechar }: SolicitarAnaliseSheetProps) {
  const solicitar = useSolicitarAnaliseSacado()
  const [limite, setLimite] = useState('')

  useEffect(() => {
    if (!sacado) return
    solicitar.reset()
    const potencial = Number(sacado.limite_potencial ?? 0)
    setLimite(potencial > 0 ? String(Math.round(potencial / 1000) * 1000) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sacado])

  async function confirmar() {
    if (!sacado) return
    try {
      await solicitar.mutateAsync({
        cnpj: sacado.cnpj_sacado as string,
        limite: limite ? Number(limite) : null,
      })
      onFechar()
    } catch {
      // Mantém a folha aberta com o erro visível.
    }
  }

  return (
    <Sheet
      open={sacado !== null}
      onOpenChange={(v) => !v && onFechar()}
      title="Solicitar análise de crédito"
      description={`${sacado?.sacado_nome ?? ''}. A partir daqui quem move o card é a esteira.`}
    >
      <View className="gap-3">
        <View className="gap-1.5">
          <Text className="text-sm font-medium">Limite a solicitar (R$)</Text>
          <Input
            value={limite}
            onChangeText={setLimite}
            keyboardType="numeric"
            accessibilityLabel="Limite a solicitar"
          />
          <Text variant="muted" className="text-xs">
            Sugerido a partir do limite potencial ({formatarMoeda(sacado?.limite_potencial)}),
            calculado sobre o faturamento estimado. Em branco, usa o calculado.
          </Text>
        </View>

        <View className="gap-1 rounded-lg border border-border p-3">
          <Text className="text-xs font-medium">O que acontece depois</Text>
          <Text variant="muted" className="text-xs">
            Aprovada, a construtora entra na sua carteira e as notas dela passam a cair no funil
            de NFs. Negada, o card sai com o motivo da esteira — voltar a trabalhá-la exige limite
            novo, não insistência.
          </Text>
        </View>

        {solicitar.isError ? (
          <Text variant="destructive">{mensagemDeErro(solicitar.error)}</Text>
        ) : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onFechar} disabled={solicitar.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button onPress={() => void confirmar()} loading={solicitar.isPending}>
            <Text>Abrir análise</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
