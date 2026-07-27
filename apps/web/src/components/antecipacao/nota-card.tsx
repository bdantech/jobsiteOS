'use client'

import Link from 'next/link'
import { AlertTriangle, Files, Gavel, TrendingUp } from 'lucide-react'
import {
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  urgenciaDe,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MenuAcoesNota } from './acoes-nota'
import {
  FAIXA_BADGE,
  TIPAGEM_BADGE,
  URGENCIA_TEXTO,
  creditoBadge,
  formatarMoeda,
  labelCredito,
  textoPrazo,
} from './format'
import type { FornecedorFunil, NotaFunil } from './queries'

/**
 * O card do funil. É uma NOTA, mas fala de um FORNECEDOR — e essa tensão é o
 * desenho todo:
 *
 * A nota dá o valor, o prazo e o sacado (o risco). O fornecedor dá a tipagem (o
 * tom da abordagem) e o AGREGADO ("+3 notas · R$ 180k"), porque ninguém é
 * abordado por nota fiscal. Sem o agregado, um vendedor liga para o mesmo
 * fornecedor três vezes no mesmo dia por três cards diferentes.
 *
 * A receita esperada vem em destaque porque é a ordenação default da coluna: o
 * card de cima é onde há mais ROI, não o mais antigo.
 */

export function NotaCard({
  nota,
  fornecedor,
  minimoOperavel,
  compacto = false,
}: {
  nota: NotaFunil
  fornecedor?: FornecedorFunil
  minimoOperavel: number
  compacto?: boolean
}) {
  const urgencia = urgenciaDe(nota.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1

  return (
    <article
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40',
        nota.fornecedor_suprimido && 'opacity-60',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
            className="block truncate text-sm font-medium hover:underline"
            title={nota.fornecedor_nome ?? nota.fornecedor_cnpj ?? ''}
          >
            {nota.fornecedor_nome ?? nota.fornecedor_cnpj}
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            {nota.faixa && (
              <Badge className={FAIXA_BADGE[nota.faixa as Faixa]}>
                {FAIXA_LABELS[nota.faixa as Faixa]}
              </Badge>
            )}
            {nota.fornecedor_tipagem && (
              <Badge className={TIPAGEM_BADGE[nota.fornecedor_tipagem as Tipagem]}>
                {TIPAGEM_LABELS[nota.fornecedor_tipagem as Tipagem]}
              </Badge>
            )}
            {nota.fornecedor_tem_protesto && (
              <Badge variant="outline" className="gap-1 text-destructive">
                <Gavel className="h-3 w-3" aria-hidden />
                Protesto
              </Badge>
            )}
          </div>
        </div>
        <MenuAcoesNota nota={nota} />
      </header>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Valor</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(nota.valor)}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3" aria-hidden />
            Receita esperada
          </dt>
          <dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
            {formatarMoeda(nota.receita_esperada)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-muted-foreground">Prazo</dt>
          <dd className={cn('tabular-nums', URGENCIA_TEXTO[urgencia])}>
            {textoPrazo(nota.dias_para_vencimento)}
            {nota.vencimento_origem === 'estimado' && (
              <span className="ml-1 text-xs font-normal text-muted-foreground" title="Vencimento estimado (emissão + 30 dias) — não veio do XML nem do endpoint.">
                (est.)
              </span>
            )}
          </dd>
        </div>
      </dl>

      {!compacto && (
        <footer className="mt-3 space-y-2 border-t pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-muted-foreground" title={nota.sacado_nome ?? ''}>
              {nota.sacado_nome ?? nota.sacado_cnpj}
            </span>
            <Badge className={cn('shrink-0', creditoBadge(nota.sacado_credito_status))}>
              {labelCredito(nota.sacado_credito_status)}
            </Badge>
          </div>

          {nota.sacado_credito_status === 'APPROVED' && !nota.sacado_limite_cobre_nota && (
            <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Aprovado, mas o limite disponível não cobre esta nota.
            </p>
          )}

          {outras > 0 && (
            <Link
              href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <Files className="h-3 w-3" aria-hidden />+{outras} nota{outras > 1 ? 's' : ''} ·{' '}
              {formatarMoeda(fornecedor?.valor_total)} total
            </Link>
          )}

          {nota.fornecedor_suprimido && (
            <p className="text-xs text-muted-foreground">
              Fornecedor suprimido — fora das faixas até a supressão expirar.
            </p>
          )}
        </footer>
      )}
    </article>
  )
}
