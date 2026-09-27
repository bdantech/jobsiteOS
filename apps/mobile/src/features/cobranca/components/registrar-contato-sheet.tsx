import {
  MutationError,
  TIPOS_INTERACAO_COBRANCA,
  TIPO_INTERACAO_COBRANCA_LABELS,
  type TipoInteracaoCobranca,
} from '@jobsiteos/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { cobrancaKeys, registrarContato } from '../api'

/**
 * Registrar um contato de cobrança — a única escrita da Cobrança no celular (§12).
 *
 * É a que cabe aqui porque é a que acontece FORA da mesa: a ligação atendida no carro,
 * a visita à obra. Registrar depois é registrar nunca, e esse histórico é o que prova à
 * seguradora que agimos para minimizar a perda (cl. 90253.00).
 *
 * `ocorrida_em` fica de fora: o contato é de agora. Um contato de ontem se registra na
 * web, onde a data se escolhe com calma.
 */
export function RegistrarContatoSheet({
  cobrancaId,
  open,
  onOpenChange,
}: {
  cobrancaId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [tipo, setTipo] = useState<TipoInteracaoCobranca>('ligacao')
  const [resumo, setResumo] = useState('')

  const registrar = useMutation({
    mutationFn: () => registrarContato({ cobranca_id: cobrancaId, tipo, resumo: resumo.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cobrancaKeys.historico(cobrancaId) })
      onOpenChange(false)
    },
  })

  // Reabrir a folha não herda o texto da vez anterior.
  useEffect(() => {
    if (open) {
      setTipo('ligacao')
      setResumo('')
      registrar.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const podeSalvar = resumo.trim().length >= 2

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Registrar contato" description="Entra no histórico da cobrança e no dossiê.">
      <View className="gap-3">
        <View className="flex-row flex-wrap gap-2">
          {TIPOS_INTERACAO_COBRANCA.map((t) => {
            const ativo = tipo === t
            return (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityState={{ selected: ativo }}
                onPress={() => setTipo(t)}
                className={cn(
                  'rounded-lg border px-3 py-2 active:opacity-70',
                  ativo ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                <Text className={cn('text-sm', ativo && 'font-medium text-primary')}>
                  {TIPO_INTERACAO_COBRANCA_LABELS[t]}
                </Text>
              </Pressable>
            )
          })}
        </View>

        <Input
          value={resumo}
          onChangeText={setResumo}
          placeholder="O que foi dito, quem falou, o que ficou combinado."
          multiline
          numberOfLines={4}
          className="h-24"
          accessibilityLabel="Resumo do contato"
        />

        {registrar.isError ? (
          <Text variant="destructive">
            {registrar.error instanceof MutationError
              ? registrar.error.message
              : 'Não foi possível registrar. Verifique sua conexão e tente de novo.'}
          </Text>
        ) : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => onOpenChange(false)} disabled={registrar.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button onPress={() => registrar.mutate()} disabled={!podeSalvar} loading={registrar.isPending}>
            <Text>Registrar</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
