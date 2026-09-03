'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Compositor } from '@/components/comunicacao/compositor'
import { Thread } from '@/components/comunicacao/thread'
import { formatRelativo } from './format'

/**
 * A aba "Conversas" da Company 360.
 *
 * ─── O COMPOSITOR SAIU DE BAIXO DA THREAD ───────────────────────────────────
 * Ele ficava aberto o tempo todo, empurrando a conversa para cima e ocupando meia
 * tela com um formulário que, na maioria das aberturas, ninguém usa — quem entra
 * aqui quase sempre vem LER o que já foi dito. Escrever é uma decisão, e decisão
 * pede um clique.
 *
 * O modal também resolve um problema que a versão embutida tinha: o formulário
 * disputava rolagem com a thread, e mandar mensagem passava a exigir rolar para
 * baixo, escrever, e rolar de volta para conferir o que se estava respondendo.
 *
 * ─── A ÚLTIMA TROCA FICA NO CABEÇALHO ───────────────────────────────────────
 * `empresas.ultima_conversa_em` (0170) é a resposta de "faz quanto tempo que
 * ninguém fala com eles?", e é a pergunta que se faz ANTES de abrir a thread. Ela
 * vem da coluna e não de uma varredura na tela: é o mesmo número que as outras
 * telas vão ler, e dois lugares calculando isso divergiriam no primeiro filtro
 * esquecido.
 */
export function AbaConversas({
  empresaId,
  ultimaConversaEm,
}: {
  empresaId: string
  ultimaConversaEm: string | null
}) {
  const qc = useQueryClient()
  const [escrevendo, setEscrevendo] = React.useState(false)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Conversas</CardTitle>
            <CardDescription>
              {ultimaConversaEm ? (
                <>
                  Última troca <strong>{formatRelativo(ultimaConversaEm)}</strong>. É a thread
                  inteira da empresa — WhatsApp e e-mail, de todos os funis.
                </>
              ) : (
                'Ninguém trocou mensagem com esta empresa ainda.'
              )}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setEscrevendo(true)}>
            <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden />
            Nova mensagem
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <Thread empresaId={empresaId} alturaClasse="max-h-[55vh]" />
      </CardContent>

      <Dialog open={escrevendo} onOpenChange={setEscrevendo}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova mensagem</DialogTitle>
            <DialogDescription>
              Passa pelo portão como qualquer outra: supressão, base legal, janela e teto do número
              continuam valendo.
            </DialogDescription>
          </DialogHeader>
          <Compositor
            empresaId={empresaId}
            onEnviado={() => {
              setEscrevendo(false)
              // A thread e a própria ficha: `ultima_conversa_em` acabou de mudar,
              // e o cabeçalho acima lê essa coluna.
              void qc.invalidateQueries({ queryKey: ['comunicacao'] })
              void qc.invalidateQueries({ queryKey: ['empresas'] })
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}
