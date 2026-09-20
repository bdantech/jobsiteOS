import { formatCnpj, renderizarAbordagem } from '@jobsiteos/core'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { formatarMoeda } from '@/features/antecipacao/format'
import { mensagemDeErro, usePedirPonte } from '../queries'
import type { ConfigProspeccao, QuebraFornecedor, SacadoProspeccao } from '../types'

/**
 * Pedir a ponte AO CEDENTE (§5) — e o §6 escrito onde ele é obedecido.
 *
 * A abordagem sai pelo fornecedor, nunca direto na construtora. O texto fala com ELE, e
 * pode citar os números porque são as notas DELE: é o certificado dele que nos deixa
 * vê-las. Nenhuma mensagem deste funil vai à construtora, e se um dia for, não pode
 * citar volume, nome de cedente nem detalhe de nota — devolver ao sacado o que o
 * fornecedor cedeu para antecipar soa como vigilância.
 */

export interface PedirPonteSheetProps {
  alvo: { sacado: SacadoProspeccao; fornecedor: QuebraFornecedor } | null
  config: ConfigProspeccao
  onFechar: () => void
}

export function PedirPonteSheet({ alvo, config, onFechar }: PedirPonteSheetProps) {
  const pedir = usePedirPonte()
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    if (!alvo) return
    pedir.reset()
    setMensagem(
      renderizarAbordagem(config.templates.pedido_ponte, {
        sacado_nome: alvo.sacado.sacado_nome ?? formatCnpj(alvo.sacado.cnpj_sacado ?? ''),
        valor_total: formatarMoeda(alvo.fornecedor.valor_30d),
        fornecedor_nome: alvo.fornecedor.fornecedor_nome,
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo])

  async function confirmar() {
    if (!alvo) return
    try {
      await pedir.mutateAsync({
        cnpjSacado: alvo.sacado.cnpj_sacado as string,
        fornecedorCnpj: alvo.fornecedor.fornecedor_cnpj,
        mensagem,
      })
      onFechar()
    } catch {
      // Mantém a folha aberta com o erro visível.
    }
  }

  return (
    <Sheet
      open={alvo !== null}
      onOpenChange={(v) => !v && onFechar()}
      title="Pedir apresentação"
      description={`Para ${alvo?.fornecedor.fornecedor_nome ?? 'o cedente'} — a abordagem sai por ele, nunca direto na construtora.`}
    >
      <View className="gap-3">
        <View className="gap-1.5">
          <Text className="text-sm font-medium">Mensagem</Text>
          <Input
            value={mensagem}
            onChangeText={setMensagem}
            multiline
            numberOfLines={6}
            className="h-36"
            accessibilityLabel="Mensagem do pedido de apresentação"
          />
          <Text variant="muted" className="text-xs">
            {'{remetente_nome}'} e {'{contato_nome}'} são preenchidos no envio, pelo compositor.
          </Text>
        </View>

        {pedir.isError ? <Text variant="destructive">{mensagemDeErro(pedir.error)}</Text> : null}

        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onFechar} disabled={pedir.isPending}>
            <Text>Cancelar</Text>
          </Button>
          <Button
            onPress={() => void confirmar()}
            disabled={mensagem.trim().length < 10}
            loading={pedir.isPending}
          >
            <Text>Registrar pedido</Text>
          </Button>
        </View>
      </View>
    </Sheet>
  )
}
