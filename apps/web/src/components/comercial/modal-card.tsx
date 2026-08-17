'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

/**
 * O modal do card — um só, para os quatro funis do Comercial.
 *
 * ─── POR QUE AS AÇÕES SAEM DO CARD ──────────────────────────────────────────
 * Três botões por card, vezes quatro colunas, vezes dezenas de cards: a coluna vira
 * uma parede de botões e sobra pouco para o que o card tinha a dizer. Pior, cada
 * clique é uma decisão tomada sem abrir o item — e as decisões que importam (perder,
 * ganhar, reatribuir) merecem o contexto que só o modal mostra.
 *
 * ─── POR QUE ABAS, E NÃO UMA PÁGINA LONGA ───────────────────────────────────
 * O que se lê ao abrir um card é sempre a mesma coisa em três camadas: o ITEM (a
 * nota, o lead, o negócio), a EMPRESA por trás dele, e a conversa que já houve. Uma
 * página longa faria rolar até o que interessa; abas deixam cada camada a um clique e
 * mantêm a primeira idêntica ao que já existia.
 *
 * A ALTURA é fixa com teto e miolo rolável, e não o `grid` sem altura do primitivo:
 * conteúdo variável (uma nota fiscal inteira, 371 CNPJs) fazia a caixa crescer além da
 * viewport, e cabeçalho e rodapé apareciam fora do fundo pintado.
 */

export interface AbaModal {
  id: string
  label: string
  conteudo: React.ReactNode
  /** Desabilitada com motivo no title — usada pela aba de mensagens, que ainda não existe. */
  desabilitada?: boolean
}

export function ModalDoCard({
  aberto,
  onOpenChange,
  titulo,
  subtitulo,
  cabecalho,
  abas,
  acoes,
  largura = 'max-w-2xl',
}: {
  aberto: boolean
  onOpenChange: (a: boolean) => void
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  /** Badges e afins, sob o título e acima das abas. */
  cabecalho?: React.ReactNode
  abas: AbaModal[]
  /** O rodapé fixo. É onde vivem as ações que antes ficavam no card. */
  acoes?: React.ReactNode
  largura?: string
}) {
  const primeira = abas[0]?.id ?? ''
  const [ativa, setAtiva] = React.useState(primeira)

  // Ao trocar de card, volta para a primeira aba: herdar "Mensagens" do card anterior
  // faria o próximo abrir numa aba que não é a resposta da pergunta que se fez.
  React.useEffect(() => {
    if (aberto) setAtiva(primeira)
  }, [aberto, primeira])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className={cn('flex max-h-[85vh] flex-col gap-0 p-0', largura)}>
        <DialogHeader className="space-y-2 border-b p-5 pb-3">
          <div className="pr-6">
            <DialogTitle className="text-base">{titulo}</DialogTitle>
            {subtitulo ? <DialogDescription>{subtitulo}</DialogDescription> : null}
          </div>
          {cabecalho}
        </DialogHeader>

        <Tabs value={ativa} onValueChange={setAtiva} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-5 pt-3">
            <TabsList className="h-9">
              {abas.map((a) => (
                <TabsTrigger
                  key={a.id}
                  value={a.id}
                  disabled={a.desabilitada}
                  className="text-xs"
                  title={a.desabilitada ? 'Ainda não implementado.' : undefined}
                >
                  {a.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {abas.map((a) => (
            <TabsContent
              key={a.id}
              value={a.id}
              // `min-h-0` é obrigatório: sem ele o filho com overflow se recusa a
              // encolher e empurra o container de volta ao tamanho do conteúdo.
              className="mt-0 min-h-0 flex-1 overflow-y-auto p-5"
            >
              {a.conteudo}
            </TabsContent>
          ))}
        </Tabs>

        {acoes ? (
          <DialogFooter className="flex-wrap gap-2 border-t p-5 pt-3 sm:justify-end">{acoes}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * A aba de mensagens, em todos os funis.
 *
 * Existe VAZIA de propósito: o histórico de e-mail e WhatsApp com a empresa é do
 * Prompt 05, e a aba está aqui para que o lugar dele já seja conhecido — de quem usa e
 * de quem for construir. Uma aba que aparece depois muda o mapa da tela; uma aba vazia
 * e honesta não.
 */
export function AbaMensagens() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Ainda não temos o histórico aqui.</p>
      <p className="mt-1">
        As trocas de e-mail e WhatsApp com esta empresa vão aparecer nesta aba quando os
        canais forem ligados.
      </p>
    </div>
  )
}
