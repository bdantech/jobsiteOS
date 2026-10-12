'use client'

import * as React from 'react'
import { Inbox } from 'lucide-react'
import {
  TIPOS_OPORTUNIDADE,
  TIPO_OPORTUNIDADE_LABELS,
  descreverInstante,
  dinheiroCurto,
} from '@jobsiteos/core'
import { FunilKanban } from '@/components/antecipacao/funil-kanban'
import { useJanelaNovidades, useResumoNovidades } from '@/components/antecipacao/use-novidades'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * "Entraram 23 novidades desde seu último expediente" (04t §7).
 *
 * É o que transforma o filtro em hábito: na segunda de manhã a informação vai até o
 * originador, em vez de depender de ele lembrar de filtrar.
 *
 * A janela e a contagem são as MESMAS do seletor do funil e do contador da aba — mesmo
 * hook, mesmo RPC. O clique abre o funil já filtrado, em modal, sem trocar de página:
 * é o padrão do Meu Dia, onde todo número é o índice da lista que ele resume.
 *
 * Recortado em `vendedorId`, que é o dono do dia aberto: quando o gestor abre o dia de
 * um originador, o card fala das novidades DELE, não das do gestor.
 */
export function CardNovidades({ vendedorId }: { vendedorId: string }) {
  const [aberto, setAberto] = React.useState(false)
  const { janela, agora } = useJanelaNovidades('expediente')
  const resumo = useResumoNovidades(janela, vendedorId)

  if (!janela || resumo.isError) return null

  const total = resumo.data?.total ?? 0
  const desde = descreverInstante(janela.de, agora)
  const porTipo = new Map((resumo.data?.por_tipo ?? []).map((t) => [t.tipo, t]))

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        disabled={resumo.isPending || total === 0}
        className={cn(
          'flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-left transition-colors',
          total > 0
            ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
            : 'border-border text-muted-foreground',
        )}
      >
        <Inbox className={cn('h-5 w-5 shrink-0', total > 0 ? 'text-primary' : 'opacity-60')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {resumo.isPending
              ? 'Conferindo o que entrou…'
              : total === 0
                ? 'Nenhuma novidade desde seu último expediente'
                : `${total === 1 ? 'Entrou 1 novidade' : `Entraram ${total.toLocaleString('pt-BR')} novidades`} desde seu último expediente`}
          </span>
          <span className="block text-xs text-muted-foreground">
            desde {desde}
            {janela.feriadosConsiderados ? '' : ' · feriados podem não estar considerados'}
          </span>
        </span>

        {total > 0 ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
            {TIPOS_OPORTUNIDADE.map((t) => {
              const linha = porTipo.get(t)
              if (!linha) return null
              return (
                <span key={t}>
                  <strong className="text-sm">{linha.qtd.toLocaleString('pt-BR')}</strong>{' '}
                  {TIPO_OPORTUNIDADE_LABELS[t]}
                </span>
              )
            })}
            <span className="font-semibold text-foreground">{dinheiroCurto(resumo.data?.valor ?? 0)}</span>
          </span>
        ) : null}
      </button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] max-w-[min(96vw,1500px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>O que entrou desde seu último expediente</DialogTitle>
            <DialogDescription>
              O funil de NFs já filtrado — desde {desde}. O filtro pode ser trocado ou desligado aqui mesmo.
            </DialogDescription>
          </DialogHeader>
          {/* Só monta aberto: cinco colunas consultando o banco atrás de um modal fechado
              seriam cinco consultas por carregamento do Meu Dia. */}
          {aberto ? <FunilKanban vendedorId={vendedorId} padraoComercial novidadesInicial="expediente" /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
