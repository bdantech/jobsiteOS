'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { anoDe } from './format'
import type { MembroGrupo } from './queries'

/**
 * SPEs abertas por ano — a velocidade de lançamento do grupo, que é o sinal
 * comercial que a contagem total esconde: um grupo com 80 SPEs paradas desde
 * 2015 e um com 12 SPEs abertas nos últimos dois anos não são o mesmo cliente.
 *
 * Uma série só, então sem legenda (o título nomeia a série) e uma cor só — a da
 * marca. As barras são finas, com a ponta arredondada de 4px ancorada na linha
 * de base, e o valor aparece direto sobre a barra: uma barra por ano cabe sem
 * eixo Y, e um eixo Y aqui só acrescentaria tinta.
 */

/** Anos vazios NO MEIO da série são informação (o grupo parou de lançar) e são preenchidos. */
const MAX_ANOS = 14

interface Barra {
  ano: number
  total: number
}

function montarSerie(membros: readonly MembroGrupo[]): { serie: Barra[]; truncado: boolean } {
  const porAno = new Map<number, number>()

  for (const membro of membros) {
    if (!membro.is_spe) continue
    const ano = anoDe(membro.data_inicio_atividade)
    if (ano === null) continue
    porAno.set(ano, (porAno.get(ano) ?? 0) + 1)
  }

  if (porAno.size === 0) return { serie: [], truncado: false }

  const anos = [...porAno.keys()]
  const fim = Math.max(...anos)
  const primeiro = Math.min(...anos)
  const inicio = Math.max(primeiro, fim - (MAX_ANOS - 1))

  const serie: Barra[] = []
  for (let ano = inicio; ano <= fim; ano++) {
    serie.push({ ano, total: porAno.get(ano) ?? 0 })
  }
  return { serie, truncado: inicio > primeiro }
}

export function SpesPorAno({ membros }: { membros: readonly MembroGrupo[] }) {
  const { serie, truncado } = montarSerie(membros)
  const maximo = serie.reduce((max, b) => Math.max(max, b.total), 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">SPEs abertas por ano</CardTitle>
        <CardDescription>
          {truncado
            ? `Ritmo de lançamento do grupo (últimos ${MAX_ANOS} anos).`
            : 'Ritmo de lançamento do grupo.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {serie.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma SPE com data de abertura conhecida neste grupo.
          </p>
        ) : (
          <figure className="space-y-2">
            <div className="flex h-40 items-end gap-[2px]" role="presentation">
              {serie.map((barra) => {
                const altura = maximo > 0 ? (barra.total / maximo) * 100 : 0
                return (
                  <div
                    key={barra.ano}
                    className="flex h-full flex-1 flex-col justify-end gap-1"
                    title={`${barra.ano}: ${barra.total} SPE${barra.total === 1 ? '' : 's'}`}
                  >
                    <span
                      className={cn(
                        'text-center text-[11px] font-medium tabular-nums',
                        barra.total > 0 ? 'text-foreground' : 'text-muted-foreground/40',
                      )}
                    >
                      {barra.total}
                    </span>
                    <div
                      className={cn(
                        'w-full rounded-t-[4px] transition-colors',
                        barra.total > 0 ? 'bg-brand hover:bg-brand/80' : 'bg-muted',
                      )}
                      // A barra de valor 0 vira um traço de 2px na linha de base:
                      // "abriu zero SPEs" é um dado, não um buraco no gráfico.
                      style={{ height: barra.total > 0 ? `${Math.max(altura, 4)}%` : '2px' }}
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex gap-[2px] border-t pt-1">
              {serie.map((barra) => (
                <span
                  key={barra.ano}
                  className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
                >
                  {/* Com muitos anos os rótulos colidem: só a década muda de fato. */}
                  {serie.length > 8 ? `'${String(barra.ano).slice(2)}` : barra.ano}
                </span>
              ))}
            </div>

            {/* A leitura por tabela não é opcional: o gráfico é cor + geometria. */}
            <figcaption className="sr-only">
              <table>
                <caption>SPEs abertas por ano</caption>
                <thead>
                  <tr>
                    <th scope="col">Ano</th>
                    <th scope="col">SPEs abertas</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((barra) => (
                    <tr key={barra.ano}>
                      <th scope="row">{barra.ano}</th>
                      <td>{barra.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </figcaption>
          </figure>
        )}
      </CardContent>
    </Card>
  )
}
