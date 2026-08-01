'use client'

import { ShieldAlert } from 'lucide-react'
import { fraseConversaoForaDeFaixa, type Auditoria } from '@jobsiteos/core'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * A auditoria (§5) — a parte que morde.
 *
 * As duas frases desta seção são as únicas do painel que dizem o que a régua
 * está ERRANDO, e por isso ela não fica atrás de nenhum expansível. A régua é
 * lida todo dia; quem ela deixa de fora, nunca — porque quem fica de fora não
 * aparece em tela alguma.
 */

export function AuditoriaSecao({
  auditoria,
  rotuloCoorte,
}: {
  auditoria: Auditoria | null
  rotuloCoorte: string
}) {
  if (!auditoria) return null
  const temCamadas = auditoria.camadas.length > 0
  const temFaixas = auditoria.faixas !== null
  if (!temCamadas && !temFaixas) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          A régua vigente contra quem opera
        </CardTitle>
        <CardDescription>
          As coortes rodadas pelas regras que estão valendo agora — pelo mesmo compilador que a
          reclassificação usa, então estes números são o que aconteceria de verdade.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {auditoria.camadas.map((a) => (
          <section key={a.camada} className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {a.total === 0 ? (
                  <>Nenhum {rotuloCoorte} para rodar pela regra de {a.camada.toUpperCase()}.</>
                ) : a.nao_passam === 0 ? (
                  <>
                    Todos os {a.total} {rotuloCoorte} passariam na regra de{' '}
                    {a.camada.toUpperCase()} (v{a.versao}).
                  </>
                ) : (
                  <>
                    {Math.round((a.nao_passam / a.total) * 100)}% dos {rotuloCoorte} ({a.nao_passam}{' '}
                    de {a.total}) NÃO passariam na regra de {a.camada.toUpperCase()} (v{a.versao}).
                  </>
                )}
              </p>
              {a.sem_cadastro > 0 && (
                <p className="text-xs text-muted-foreground">
                  Mais {a.sem_cadastro} não puderam sequer ser avaliados: operam, mas não têm
                  cadastro no universo — a régua não os enxerga para aprovar nem para reprovar.
                </p>
              )}
              {a.total > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((a.passam / a.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {a.barreiras.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Quais condições os barram — cada uma sozinha, então a soma pode passar do total
                  (uma mesma empresa costuma falhar em mais de uma):
                </p>
                <ul className="space-y-1">
                  {a.barreiras.map((b) => (
                    <li
                      key={b.indice}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      <span>{b.descricao}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        barra {b.barrados} ({Math.round(b.fracao * 100)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ))}

        {auditoria.faixas && (
          <section className="space-y-3">
            <p className="text-sm font-medium">
              {fraseConversaoForaDeFaixa(
                auditoria.faixas.convertidas_sem_faixa,
                auditoria.faixas.convertidas_total,
              )}
            </p>

            {auditoria.faixas.por_faixa.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Conversão real por faixa, nos últimos {auditoria.faixas.janela_dias} dias:
                </p>
                <ul className="space-y-1">
                  {auditoria.faixas.por_faixa.map((f) => (
                    <li
                      key={f.faixa}
                      className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
                    >
                      <span>
                        Faixa {f.faixa}
                        {f.versao ? ` (regra v${f.versao})` : ''}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {(f.taxa * 100).toFixed(1).replace('.', ',')}% · {f.convertidas} de {f.nfs}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma nota classificada na janela — sem base para comparar faixas.
              </p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
