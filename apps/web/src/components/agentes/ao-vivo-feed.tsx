'use client'

import { XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { desde, ferramentaLabel, hora, reais } from './format'
import { nomeDaEmpresa, personaDoAgente, type AcaoDoFeed, type AgenteVisivel } from './queries-operacao'

/**
 * "Agora" — o feed ao vivo das ações, mais recente no topo (§11.1). É a tela que se deixa
 * aberta num monitor, então cada linha responde sozinha: QUEM (agente), O QUÊ (ferramenta),
 * COM QUEM (empresa, contato) e POR QUÊ (a intenção, em português, escrita pelo próprio
 * agente antes de agir).
 *
 * A intenção é o centro da linha, não o rótulo da ferramenta: "Enviou WhatsApp" diz pouco;
 * "Retomar com o Carlos o horário que a Marcia indicou" diz se o agente está no caminho.
 *
 * Falha fica marcada em vermelho com o erro — não some do feed. Clique em qualquer linha
 * abre o mandato em modal, sem sair da tela.
 */
export function FeedAoVivo({
  acoes,
  agentes,
  onAbrir,
}: {
  acoes: AcaoDoFeed[]
  agentes: AgenteVisivel[]
  onAbrir: (mandatoId: string) => void
}) {
  if (acoes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Nenhuma ação ainda.</p>
        <p className="mt-1">
          As ações aparecem aqui no instante em que o agente as executa. Sem mandato ativo, o ciclo não tem o que
          fazer — crie um em &quot;Delegar ao agente&quot; (empresa, NF ou funil) ou ligue uma regra em
          Configurações.
        </p>
      </div>
    )
  }

  const nomePor = new Map(agentes.map((a) => [a.id, personaDoAgente(a).nome]))

  return (
    <ol className="divide-y rounded-lg border">
      {acoes.map((a) => {
        const falhou = a.sucesso === false
        const canal = (a.argumentos as { canal?: string } | null)?.canal
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onAbrir(a.mandato_id)}
              className={cn(
                'flex w-full gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                falhou && 'bg-red-50/60 dark:bg-red-950/20',
              )}
            >
              <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground" title={desde(a.executada_em)}>
                {hora(a.executada_em)}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="font-semibold">{nomePor.get(a.agente_id) ?? 'Agente'}</span>
                  <Badge variant={falhou ? 'critical' : 'neutral'} className="gap-1 px-1.5 py-0 text-[10.5px]">
                    {falhou ? <XCircle className="h-3 w-3" aria-hidden /> : null}
                    {ferramentaLabel(a.ferramenta)}
                    {canal && a.ferramenta === 'enviar_material' ? ` · ${canal === 'email' ? 'e-mail' : 'WhatsApp'}` : ''}
                  </Badge>
                  <span className="truncate text-muted-foreground">
                    {nomeDaEmpresa(a.empresas)}
                    {a.contatos?.nome ? ` · ${a.contatos.nome}` : ''}
                  </span>
                  {a.custo_centavos ? (
                    <span className="ml-auto tabular-nums text-muted-foreground">{reais(a.custo_centavos)}</span>
                  ) : null}
                </span>
                <span className="block text-sm">{a.intencao}</span>
                {falhou && a.erro ? <span className="block text-xs text-destructive">{a.erro}</span> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
