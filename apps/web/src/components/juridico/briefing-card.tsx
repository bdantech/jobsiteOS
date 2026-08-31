'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { AVISO_PARECER } from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { gerarBriefingAction } from '@/actions/juridico'
import { cn } from '@/lib/utils'
import { juridicoKeys, type BriefingDoProcesso } from './queries'
import { data as dataCurta } from './format'

/**
 * O briefing: as três frases que situam alguém que acabou de abrir o processo.
 *
 * Fica NO TOPO, acima das abas, e é a única coisa gerada por IA que aparece sem
 * ninguém pedir. O parecer continua onde estava, na aba: ele é um documento que
 * se gera quando se precisa dele, e pô-lo aqui obrigaria a ler seis seções para
 * responder "onde está esse processo?".
 *
 * ─── O AVISO NÃO É RODAPÉ DECORATIVO ────────────────────────────────────────
 * `AVISO_PARECER` acompanha todo texto de IA do módulo, aqui inclusive. A
 * diferença entre "o sistema disse" e "um modelo resumiu o que os autos dizem" é
 * a diferença entre uma ferramenta e uma armadilha, e ela precisa estar visível
 * na mesma tela em que o texto está — não numa página de ajuda.
 *
 * ─── DESATUALIZADO É DIFERENTE DE VELHO ─────────────────────────────────────
 * A tarja de "desatualizado" compara `ate_movimentacao_em` com a última
 * movimentação do processo, não com o calendário. Um briefing de três meses sobre
 * um processo parado há um ano está correto e não leva tarja nenhuma; um de ontem
 * sobre um processo que teve penhora hoje leva.
 */

const TOM_URGENCIA: Record<string, string> = {
  alta: STATUS_SUPERFICIE.critical,
  media: STATUS_SUPERFICIE.warning,
  baixa: STATUS_SUPERFICIE.info,
}

const LABEL_URGENCIA: Record<string, string> = {
  alta: 'Pede resposta',
  media: 'Há trabalho a fazer',
  baixa: 'Sem pressa aparente',
}

export function BriefingCard({
  numeroCnj,
  briefing,
  carregando,
  ultimaMovimentacao,
  temMovimentacoes,
}: {
  numeroCnj: string
  briefing: BriefingDoProcesso | null
  carregando: boolean
  /** Data da movimentação mais recente do processo. Decide se o texto envelheceu. */
  ultimaMovimentacao: string | null
  temMovimentacoes: boolean
}) {
  const qc = useQueryClient()
  const [gerando, setGerando] = React.useState(false)

  async function gerar(forcar: boolean) {
    setGerando(true)
    const r = await gerarBriefingAction(numeroCnj, forcar)
    setGerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.gerado) {
      toast.info(r.data.motivo ?? 'Nada a atualizar.')
      return
    }
    toast.success('Resumo atualizado.')
    void qc.invalidateQueries({ queryKey: juridicoKeys.briefing(numeroCnj) })
  }

  if (carregando) return <Skeleton className="h-40 w-full" />

  // Sem movimentação não há o que resumir, e um card oferecendo gerar um resumo
  // do nada seria um botão que só sabe falhar.
  if (!temMovimentacoes) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 py-4 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            O resumo por IA aparece aqui depois da primeira sincronização — ele lê as
            movimentações, e este processo ainda não tem nenhuma.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!briefing) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Ainda não há resumo deste processo.
          </p>
          <Button size="sm" onClick={() => void gerar(false)} disabled={gerando}>
            {gerando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            )}
            Gerar resumo
          </Button>
        </CardContent>
      </Card>
    )
  }

  const desatualizado =
    ultimaMovimentacao !== null &&
    briefing.ate_movimentacao_em !== null &&
    briefing.ate_movimentacao_em < ultimaMovimentacao

  return (
    <Card className={cn(desatualizado && 'border-amber-300 dark:border-amber-800')}>
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Sparkles className="h-3 w-3" aria-hidden />
              Resumo por IA
            </Badge>
            {briefing.urgencia ? (
              <Badge variant="outline" className={cn('border', TOM_URGENCIA[briefing.urgencia])}>
                {LABEL_URGENCIA[briefing.urgencia] ?? briefing.urgencia}
              </Badge>
            ) : null}
            {desatualizado ? (
              <Badge variant="outline" className={cn('gap-1 border', STATUS_SUPERFICIE.warning)}>
                <TriangleAlert className="h-3 w-3" aria-hidden />
                Chegou movimentação depois deste resumo
              </Badge>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void gerar(true)}
            disabled={gerando}
            title="Gera de novo mesmo que nada tenha mudado"
          >
            {gerando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            )}
            Atualizar
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Em que fase está</p>
            <p className="text-sm">{briefing.resumo_fase}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">O que aconteceu</p>
            <p className="text-sm">{briefing.resumo_movimentacoes}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Próxima ação sugerida</p>
            <p className="flex items-start gap-1.5 text-sm font-medium">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {briefing.proxima_acao}
            </p>
          </div>
        </div>

        <p className="border-t pt-3 text-xs text-muted-foreground">
          {AVISO_PARECER} Leu {briefing.qtd_movimentacoes_lidas} movimentaç
          {briefing.qtd_movimentacoes_lidas === 1 ? 'ão' : 'ões'}
          {briefing.ate_movimentacao_em ? `, até ${dataCurta(briefing.ate_movimentacao_em)}` : ''}.
        </p>
      </CardContent>
    </Card>
  )
}
