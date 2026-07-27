import {
  ESTAGIOS_ABERTOS,
  ESTAGIO_FUNIL_LABELS,
  type EstagioFunil,
} from '@jobsiteos/core'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { mensagemDeErro, useMoverEstagio } from '../queries'
import type { NotaFunil } from '../types'

/**
 * Mover a nota de estágio, do swipe.
 *
 * O `sugerido` (o próximo estágio natural) vem pré-selecionado, porque 90% dos
 * movimentos são "avançar um". Os demais estão a um toque.
 *
 * "Perdida" exige MOTIVO, e o botão fica desabilitado sem ele. Não é burocracia: o
 * motivo é o insumo da métrica por faixa — sem ele, "a faixa boa converte 4%" não
 * sugere o que mudar na regra.
 */

const DESTINOS: readonly EstagioFunil[] = [...ESTAGIOS_ABERTOS, 'convertida', 'perdida']

export interface MoverEstagioSheetProps {
  nota: NotaFunil
  sugerido?: EstagioFunil
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MoverEstagioSheet({ nota, sugerido, open, onOpenChange }: MoverEstagioSheetProps) {
  const mover = useMoverEstagio()
  const [destino, setDestino] = useState<EstagioFunil | undefined>(sugerido)
  const [motivo, setMotivo] = useState('')

  // Reabrir a folha não pode herdar a escolha da vez anterior.
  useEffect(() => {
    if (open) {
      setDestino(sugerido)
      setMotivo('')
      mover.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sugerido])

  const pedeMotivo = destino === 'perdida'
  const podeConfirmar = Boolean(destino) && (!pedeMotivo || motivo.trim().length > 0)

  async function confirmar() {
    if (!destino) return
    try {
      await mover.mutateAsync({
        accessKey: nota.access_key as string,
        estagio: destino,
        perdaMotivo: pedeMotivo ? motivo.trim() : undefined,
      })
      onOpenChange(false)
    } catch {
      // O erro fica na folha (mover.isError) — fechar esconderia o motivo da falha.
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mover no funil"
      description={`${nota.fornecedor_nome ?? nota.fornecedor_cnpj} · nota ${nota.numero ?? ''}`.trim()}
    >
      <View className="gap-3">
        <View className="gap-2">
          {DESTINOS.filter((d) => d !== nota.estagio_funil).map((d) => {
            const ativo = destino === d
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                onPress={() => setDestino(d)}
                className={cn(
                  'rounded-lg border px-3 py-3 active:opacity-70',
                  ativo ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                <Text className={cn('font-medium', ativo && 'text-primary')}>
                  {ESTAGIO_FUNIL_LABELS[d]}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {pedeMotivo ? (
          <View className="gap-1.5">
            <Text className="text-sm font-medium">Motivo da perda</Text>
            <Input
              value={motivo}
              onChangeText={setMotivo}
              placeholder="Ex.: antecipou com outro fundo; taxa fora do aceitável."
              multiline
              numberOfLines={3}
              className="h-20"
              accessibilityLabel="Motivo da perda"
            />
            <Text variant="muted" className="text-xs">
              Obrigatório. É o que permite regular os critérios de faixa com dados.
            </Text>
          </View>
        ) : null}

        {mover.isError ? <Text variant="destructive">{mensagemDeErro(mover.error)}</Text> : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => onOpenChange(false)} disabled={mover.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button
            onPress={() => void confirmar()}
            disabled={!podeConfirmar}
            loading={mover.isPending}
          >
            <Text>Mover</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
