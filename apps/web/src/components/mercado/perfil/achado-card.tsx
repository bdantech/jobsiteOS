'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import {
  fraseAchado,
  variavelPerfil,
  type AchadoContraste,
  type CategoriaContraste,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Um achado (§7.2): frase em português, duas barras e o lift. Nada de jargão na
 * superfície — o que é estatística fica atrás de "ver como calculamos".
 *
 * As BARRAS são o produto, não a tabela. Um lift de 3,2 não significa nada para
 * quem não lida com razão de prevalência; duas barras lado a lado, uma três
 * vezes maior que a outra, significam para qualquer pessoa. O número fica junto
 * para quem quiser conferir.
 */

export function AchadoCard({
  achado,
  rotulos,
  rotuloA,
  rotuloB,
}: {
  achado: AchadoContraste
  rotulos: Record<string, string>
  rotuloA: string
  rotuloB: string
}) {
  const [aberto, setAberto] = React.useState(false)
  const variavel = variavelPerfil(achado.variavel)
  const label = rotulos[achado.variavel] ?? variavel?.label ?? achado.variavel

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug">
            {fraseAchado(achado, variavel, rotuloA, rotuloB)}
          </p>
          <SeloConfianca achado={achado} />
        </div>

        <ul className="space-y-2">
          {achado.categorias
            .filter((c) => c.n_a > 0 || c.n_b > 0)
            .map((c) => (
              <LinhaCategoria
                key={c.chave}
                categoria={c}
                destaque={c.chave === achado.destaque?.chave}
                rotuloA={rotuloA}
                rotuloB={rotuloB}
              />
            ))}
        </ul>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')} aria-hidden />
          Ver como calculamos
        </button>

        {aberto && (
          <div className="space-y-1.5 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">{label}</strong> foi comparada entre {rotuloA} (
              {achado.n_a} com dado, {pct(achado.cobertura_a)} da coorte) e {rotuloB} ({achado.n_b}{' '}
              com dado, {pct(achado.cobertura_b)}).
            </p>
            <p>
              A barra mostra a fração DENTRO de quem tem dado — quem não tem sai da conta dos dois
              lados, em vez de ser diluído como se fosse resposta.
            </p>
            <p>
              O número à direita é quantas vezes a característica é mais (ou menos) frequente entre{' '}
              {rotuloA}. Ele só aparece quando há pelo menos alguns casos dos dois lados; abaixo
              disso, um caso a mais mudaria a conclusão.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeloConfianca({ achado }: { achado: AchadoContraste }) {
  if (achado.suprimido) {
    return (
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        dado escasso
      </Badge>
    )
  }
  if (achado.confianca === 'indicativo') {
    return (
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        poucos dados
      </Badge>
    )
  }
  return null
}

function LinhaCategoria({
  categoria: c,
  destaque,
  rotuloA,
  rotuloB,
}: {
  categoria: CategoriaContraste
  destaque: boolean
  rotuloA: string
  rotuloB: string
}) {
  return (
    <li className={cn('space-y-1', destaque && 'rounded-md bg-muted/40 p-2 -mx-2')}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn('truncate', destaque && 'font-medium')}>{c.chave}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{textoLift(c)}</span>
      </div>
      <Barra valor={c.prevalencia_a} n={c.n_a} rotulo={rotuloA} tom="a" />
      <Barra valor={c.prevalencia_b} n={c.n_b} rotulo={rotuloB} tom="b" />
    </li>
  )
}

function Barra({
  valor,
  n,
  rotulo,
  tom,
}: {
  valor: number
  n: number
  rotulo: string
  tom: 'a' | 'b'
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 shrink-0" aria-hidden />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', tom === 'a' ? 'bg-primary' : 'bg-muted-foreground/40')}
          style={{ width: `${Math.min(100, Math.round(valor * 100))}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {pct(valor)} · {n}
      </span>
      <span className="sr-only">
        {rotulo}: {pct(valor)}, {n} empresas
      </span>
    </div>
  )
}

function textoLift(c: CategoriaContraste): string {
  if (c.exclusiva_a) return 'só aqui'
  if (c.lift === null) return '—'
  if (!c.solida) return 'poucos casos'
  const forca = c.lift >= 1 ? c.lift : 1 / c.lift
  return `${forca.toFixed(1).replace('.', ',')}× ${c.lift >= 1 ? 'mais' : 'menos'}`
}

function pct(fracao: number): string {
  return `${Math.round(fracao * 100)}%`
}
