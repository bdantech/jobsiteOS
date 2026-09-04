'use client'

import {
  FAIXA_FATURAMENTO_LABELS,
  FAIXA_SCORE_LABELS,
  type ExplicacaoSugestao,
  type FaixaScore,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { brl } from '../analise-propria/resultado'

/**
 * O PORQUÊ da sugestão (04o §6).
 *
 * Um preço sugerido sem procedência chega ao analista com a autoridade de um dado, e é
 * ele quem vai defendê-lo num comitê ou numa ligação com o cliente. Este painel existe
 * para que a resposta a "por que 2,9%?" seja uma leitura, não uma arqueologia: a faixa
 * de porte, a coluna de score, a célula crua da matriz e cada ajuste que a moveu.
 *
 * Os ajustes aparecem com o SINAL e o motivo, inclusive os que baratearam. Mostrar só
 * os que encareceram faria a sugestão parecer mais dura do que é.
 */

const pp = (n: number): string =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} p.p.`

const pctRel = (n: number): string =>
  `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

const ORIGEM_LIMITE: Record<ExplicacaoSugestao['origem_credit_limit'], string> = {
  esteira: 'limite aprovado pela seguradora',
  analise_propria: 'limite recomendado pela nossa análise',
  sem_limite: 'nenhum limite disponível — preencha antes de publicar',
}

export function PorqueDaSugestao({
  explicacao,
  matrizVersao,
}: {
  explicacao: ExplicacaoSugestao
  matrizVersao: number
}) {
  const e = explicacao
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Por que esta sugestão</CardTitle>
        <CardDescription>
          Matriz v{matrizVersao} · célula{' '}
          <strong>{FAIXA_FATURAMENTO_LABELS[e.faixa_faturamento]}</strong> ×{' '}
          <strong>{FAIXA_SCORE_LABELS[e.coluna_score as FaixaScore] ?? e.coluna_score}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-1.5">
          <Linha
            rotulo="Faturamento estimado"
            valor={e.faturamento_estimado ? brl(e.faturamento_estimado) : 'sem estimativa'}
          />
          <Linha
            rotulo="Faixa de score"
            valor={
              e.faixa_score
                ? (FAIXA_SCORE_LABELS[e.faixa_score as FaixaScore] ?? e.faixa_score)
                : 'nunca pontuada'
            }
          />
          <Linha rotulo="Cobertura da seguradora" valor={e.cobertura_vigente ? 'vigente' : 'não'} />
          <Linha
            rotulo="Protestos"
            valor={
              e.tem_protesto === null ? 'nunca consultado' : e.tem_protesto ? 'sim' : 'sem protesto'
            }
          />
          <Linha
            rotulo="Prazo médio das NFs"
            valor={
              e.prazo_medio_nf_dias === null
                ? 'sem notas observadas'
                : `${Math.round(e.prazo_medio_nf_dias)} dias`
            }
          />
          <Linha
            rotulo="Ticket médio"
            valor={e.ticket_medio_nf === null ? 'sem notas observadas' : brl(e.ticket_medio_nf)}
          />
          <Linha rotulo="Limite de crédito" valor={ORIGEM_LIMITE[e.origem_credit_limit]} />
        </dl>

        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">A célula, antes dos ajustes</p>
          <p className="mt-1 text-sm tabular-nums">
            {e.celula.monthly_rate_d0.toLocaleString('pt-BR')}% a.m. · TAC {brl(e.celula.fee_d0)} ·
            comissão {e.celula.commission_percent.toLocaleString('pt-BR')}%
          </p>
        </div>

        {e.ajustes_aplicados.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum ajuste se aplicou: a sugestão é a célula pura.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {e.ajustes_aplicados.map((a) => (
              <li key={a.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span>{a.label}</span>
                  <Badge variant={a.juros_pp > 0 ? 'destructive' : 'secondary'} className="text-[10px]">
                    {a.juros_pp > 0 ? 'encarece' : a.juros_pp < 0 ? 'barateia' : 'ajusta'}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground tabular-nums">
                  juros {pp(a.juros_pp)} · TAC {pctRel(a.fee_pct)} · comissão {pp(a.comissao_pp)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Os ajustes movem <strong>dentro</strong> da faixa global da matriz. Sair dela é decisão
          sua, e exige justificativa registrada.
        </p>
      </CardContent>
    </Card>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 truncate text-right">{valor}</dd>
    </div>
  )
}
