import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import { mensagemDeErro, useDescartarSacado } from '../queries'
import type { ConfigProspeccao, SacadoProspeccao } from '../types'

/**
 * Descartar um sacado do funil, do celular.
 *
 * O motivo é OBRIGATÓRIO e ENUMERADO — a lista vem das settings, e é a mesma da web.
 * Sem ele, "quantos perdemos porque a ponte não andou?" não tem resposta, e essa é a
 * única saída útil de um card descartado.
 *
 * A primeira escolha é DE QUEM FOI A DECISÃO: "nós descartamos" e "eles não têm
 * interesse" parecem a mesma coisa na tela e não são — a segunda diz que houve
 * conversa, e é o que impede alguém de tentar de novo daqui a um mês.
 */

export interface DescartarSacadoSheetProps {
  sacado: SacadoProspeccao | null
  config: ConfigProspeccao
  onFechar: () => void
}

export function DescartarSacadoSheet({ sacado, config, onFechar }: DescartarSacadoSheetProps) {
  const descartar = useDescartarSacado()
  const [estagio, setEstagio] = useState<'descartado' | 'sem_interesse'>('descartado')
  const [motivo, setMotivo] = useState('')
  const [observacao, setObservacao] = useState('')

  useEffect(() => {
    if (sacado) {
      setEstagio('descartado')
      setMotivo('')
      setObservacao('')
      descartar.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sacado])

  const exigeObs = motivo === 'outro'

  async function confirmar() {
    if (!sacado || !motivo) return
    try {
      await descartar.mutateAsync({
        cnpj: sacado.cnpj_sacado as string,
        estagio,
        motivo,
        observacao: observacao.trim() || undefined,
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
      title="Descartar sacado"
      description={`${sacado?.sacado_nome ?? ''}. Ele sai do funil ativo — o motivo fica no histórico.`}
    >
      <View className="gap-3">
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: estagio === 'descartado' }}
            onPress={() => setEstagio('descartado')}
            className={cn(
              'flex-1 gap-1 rounded-lg border p-3 active:opacity-70',
              estagio === 'descartado' ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <Text className={cn('font-medium', estagio === 'descartado' && 'text-primary')}>
              Nós descartamos
            </Text>
            <Text variant="muted" className="text-xs">
              Porte, perfil ou fluxo que não se repete.
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: estagio === 'sem_interesse' }}
            onPress={() => setEstagio('sem_interesse')}
            className={cn(
              'flex-1 gap-1 rounded-lg border p-3 active:opacity-70',
              estagio === 'sem_interesse' ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <Text className={cn('font-medium', estagio === 'sem_interesse' && 'text-primary')}>
              Eles não quiseram
            </Text>
            <Text variant="muted" className="text-xs">
              A ponte não andou, ou a construtora disse não.
            </Text>
          </Pressable>
        </View>

        <View className="gap-1.5">
          <Text className="text-sm font-medium">Motivo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-12">
            <View className="flex-row gap-1.5">
              {config.motivos_descarte.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: motivo === m.id }}
                  onPress={() => setMotivo(m.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 active:opacity-70',
                    motivo === m.id ? 'border-primary bg-primary/10' : 'border-border',
                  )}
                >
                  <Text className={cn('text-xs', motivo === m.id && 'text-primary')}>{m.label}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        <View className="gap-1.5">
          <Text className="text-sm font-medium">
            Observação {exigeObs ? '(obrigatória)' : '(opcional)'}
          </Text>
          <Input
            value={observacao}
            onChangeText={setObservacao}
            placeholder="O que foi dito, e por quem."
            multiline
            numberOfLines={3}
            className="h-20"
            accessibilityLabel="Observação do descarte"
          />
        </View>

        {descartar.isError ? (
          <Text variant="destructive">{mensagemDeErro(descartar.error)}</Text>
        ) : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onFechar} disabled={descartar.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button
            variant="destructive"
            onPress={() => void confirmar()}
            disabled={!motivo || (exigeObs && observacao.trim().length < 3)}
            loading={descartar.isPending}
          >
            <Text>Descartar</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
