'use client'

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VisaoGeral } from './visao-geral'
import { Contestacoes } from './contestacoes'
import { Calibracao } from './calibracao'
import { Rubricas } from './rubricas'
import { Vinculacao } from './vinculacao'
import { Configuracoes } from './configuracoes'

/**
 * COMERCIAL → QUALIDADE (05C §8–§13) — a tela do gestor.
 *
 * ─── POR QUE ESTAS SEIS ABAS, NESTA ORDEM ───────────────────────────────────
 * A ordem é a de quem chega com uma pergunta:
 *
 *   Visão geral   como o time está — e como o INSTRUMENTO está (contestação por item)
 *   Contestações  o trabalho que espera o gestor: cada uma é um vendedor aguardando
 *   Calibração    o trabalho que destrava a nota: sem rótulo, nada sai da sombra
 *   Rubricas      o que se pergunta, versionado
 *   Vinculação    a cascata que casa conversa com empresa
 *   Configurações o que só se mexe uma vez
 *
 * Contestações e Calibração vêm logo depois da visão geral porque são FILAS: o que
 * fica numa aba distante é o que ninguém trabalha, e as duas são o loop que faz o
 * sistema melhorar (§9: todo rótulo humano entra na calibração).
 *
 * ─── A ABA VIVE NA URL ──────────────────────────────────────────────────────
 * As notificações apontam para `?aba=contestacoes`, `?aba=calibracao`, `?aba=rubricas`.
 * Trocar de aba reescreve o parâmetro com `history.replaceState` — sem navegação, para
 * não refazer a página no servidor a cada clique, e para o F5 voltar onde se estava.
 */

const ABAS = ['visao-geral', 'contestacoes', 'calibracao', 'rubricas', 'vinculacao', 'configuracoes'] as const
type Aba = (typeof ABAS)[number]

const ehAba = (v: string | null): v is Aba => !!v && (ABAS as readonly string[]).includes(v)

export function QualidadeTela({
  abaInicial,
  urlWebhookFireflies,
}: {
  abaInicial: string | null
  urlWebhookFireflies: string | null
}) {
  const [aba, setAba] = React.useState<Aba>(ehAba(abaInicial) ? abaInicial : 'visao-geral')
  // Clicar numa notificação estando já nesta tela é navegação de cliente: a página
  // re-renderiza com o `?aba=` novo, mas o estado não renasce sozinho.
  React.useEffect(() => {
    if (ehAba(abaInicial)) setAba(abaInicial)
  }, [abaInicial])

  function trocar(v: string) {
    if (!ehAba(v)) return
    setAba(v)
    const url = new URL(window.location.href)
    if (v === 'visao-geral') url.searchParams.delete('aba')
    else url.searchParams.set('aba', v)
    window.history.replaceState(window.history.state, '', url)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Qualidade das conversas</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Reuniões, ligações e conversas avaliadas contra a rubrica, item a item. A nota é
          aritmética sobre os itens aplicáveis — nenhum modelo opina sobre ela — e só chega ao
          vendedor quando o item está calibrado. Esta tela é instrumento de coaching, não de
          remuneração.
        </p>
      </div>

      <Tabs value={aba} onValueChange={trocar} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="contestacoes">Contestações</TabsTrigger>
          <TabsTrigger value="calibracao">Calibração</TabsTrigger>
          <TabsTrigger value="rubricas">Rubricas</TabsTrigger>
          <TabsTrigger value="vinculacao">Vinculação</TabsTrigger>
          <TabsTrigger value="configuracoes">Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="mt-0 space-y-4">
          <VisaoGeral />
        </TabsContent>
        <TabsContent value="contestacoes" className="mt-0 space-y-4">
          <Contestacoes />
        </TabsContent>
        <TabsContent value="calibracao" className="mt-0 space-y-4">
          <Calibracao />
        </TabsContent>
        <TabsContent value="rubricas" className="mt-0 space-y-4">
          <Rubricas />
        </TabsContent>
        <TabsContent value="vinculacao" className="mt-0 space-y-4">
          <Vinculacao />
        </TabsContent>
        <TabsContent value="configuracoes" className="mt-0 space-y-4">
          <Configuracoes urlWebhookFireflies={urlWebhookFireflies} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
