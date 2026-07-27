import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { mensagemDeErro, useMarcarSemInteresse } from '../queries'

/**
 * "Sem interesse", do swipe para a esquerda.
 *
 * A escolha entre 90 DIAS e ETERNA é obrigatória e explícita, porque as duas coisas
 * são diferentes: uma é "não agora" e o fornecedor volta ao funil sozinho; a outra é
 * LGPD ou uma multinacional que nunca vai antecipar, e não expira nunca.
 *
 * O motivo também é obrigatório. Sem ele, três meses depois ninguém sabe se o
 * fornecedor recusou a taxa ou pediu para nunca mais ser procurado.
 */

export interface SemInteresseSheetProps {
  cnpj: string
  nome: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SemInteresseSheet({ cnpj, nome, open, onOpenChange }: SemInteresseSheetProps) {
  const suprimir = useMarcarSemInteresse()
  const [eterna, setEterna] = useState(false)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    if (open) {
      setEterna(false)
      setMotivo('')
      suprimir.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function confirmar() {
    if (motivo.trim() === '') return
    try {
      await suprimir.mutateAsync({ cnpj, motivo: motivo.trim(), eterna, dias: 90 })
      onOpenChange(false)
    } catch {
      // Mantém a folha aberta com o erro visível.
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Marcar sem interesse"
      description={`${nome ?? cnpj}. Todas as notas vivas dele saem das faixas na hora.`}
    >
      <View className="gap-3">
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: !eterna }}
            onPress={() => setEterna(false)}
            className={cn(
              'flex-1 gap-1 rounded-lg border p-3 active:opacity-70',
              !eterna ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <Text className={cn('font-medium', !eterna && 'text-primary')}>90 dias</Text>
            <Text variant="muted" className="text-xs">
              Expira e ele volta ao funil.
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: eterna }}
            onPress={() => setEterna(true)}
            className={cn(
              'flex-1 gap-1 rounded-lg border p-3 active:opacity-70',
              eterna ? 'border-destructive bg-destructive/10' : 'border-border',
            )}
          >
            <Text className={cn('font-medium', eterna && 'text-destructive')}>Eterna</Text>
            <Text variant="muted" className="text-xs">
              LGPD ou quem nunca antecipa. Não expira.
            </Text>
          </Pressable>
        </View>

        <View className="gap-1.5">
          <Text className="text-sm font-medium">Motivo</Text>
          <Input
            value={motivo}
            onChangeText={setMotivo}
            placeholder="Ex.: pediu para não ser contatado."
            multiline
            numberOfLines={3}
            className="h-20"
            accessibilityLabel="Motivo da supressão"
          />
        </View>

        {suprimir.isError ? (
          <Text variant="destructive">{mensagemDeErro(suprimir.error)}</Text>
        ) : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => onOpenChange(false)} disabled={suprimir.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button
            variant="destructive"
            onPress={() => void confirmar()}
            disabled={motivo.trim() === ''}
            loading={suprimir.isPending}
          >
            <Text>{eterna ? 'Suprimir sempre' : 'Suprimir 90 dias'}</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
