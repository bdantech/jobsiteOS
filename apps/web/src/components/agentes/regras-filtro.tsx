'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Users } from 'lucide-react'
import {
  alvosEngine,
  combinarArvores,
  faixaEngine,
  type FiltroEngine,
  type Grupo,
} from '@jobsiteos/core'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ConstrutorRegra } from '@/components/filtros/construtor-regra'
import { criarHelpersArvore, type HelpersArvore } from '@/components/filtros/arvore'
import { cn } from '@/lib/utils'
import { inteiro } from './gestao-format'
import { contarPopulacao, gestaoAgentesKeys } from './queries-gestao'

/**
 * UMA ÁRVORE DO MOTOR DE FILTROS (Prompt 02) COM A PRÉVIA AO VIVO — o bloco que o escopo
 * da persona (filtro, filtro_nf, piloto, piloto_nf) e as regras de mandato usam.
 *
 * ─── DUAS POPULAÇÕES, DOIS CATÁLOGOS ────────────────────────────────────────
 * Reunião, qualificação e reativação trabalham EMPRESAS (`alvosEngine`, sobre a view
 * `agentes_empresas_alvo`); originação trabalha NOTAS (`faixaEngine`, sobre
 * `notas_funil`). O construtor é o mesmo da pirâmide e das faixas; o vocabulário muda
 * com a população, e é impossível montar aqui uma condição que o worker não compile.
 *
 * ─── A CONTAGEM É DE HOJE, SOB A SUA RLS ────────────────────────────────────
 * O número é o que a árvore pega agora, contado no banco pelo mesmo compilador que o job
 * noturno usa, e com as mesmas exclusões fora do filtro (cobrança, supressão, estágio da
 * nota). `base` entra em E na contagem — é como o piloto mostra o que sobra DENTRO do
 * escopo, e a regra mostra o que sobra dentro do escopo do agente.
 */

const HELPERS: Record<'empresas' | 'notas', HelpersArvore> = {
  empresas: criarHelpersArvore(alvosEngine),
  notas: criarHelpersArvore(faixaEngine),
}

const ENGINES: Record<'empresas' | 'notas', FiltroEngine> = {
  empresas: alvosEngine,
  notas: faixaEngine,
}

export const ROTULO_POPULACAO: Record<'empresas' | 'notas', { um: string; varios: string }> = {
  empresas: { um: 'empresa', varios: 'empresas' },
  notas: { um: 'nota', varios: 'notas' },
}

/**
 * A árvore gravada (jsonb) lida pelo catálogo ATUAL. `invalida` = havia uma árvore, mas
 * ela usa uma variável que saiu do catálogo: a tela avisa em vez de mostrar "sem filtro",
 * que seria mentir sobre o que o worker vai recusar.
 */
export function arvoreInicial(populacao: 'empresas' | 'notas', bruto: unknown): { arvore: Grupo | null; invalida: boolean } {
  if (bruto === null || bruto === undefined) return { arvore: null, invalida: false }
  if (typeof bruto === 'object' && !Array.isArray(bruto) && Object.keys(bruto as object).length === 0) {
    return { arvore: null, invalida: false }
  }
  const arvore = HELPERS[populacao].arvoreDeJson(bruto)
  return { arvore, invalida: arvore === null }
}

/** Tudo de errado com a árvore, em pt-BR. Árvore nula não tem problema (é "sem filtro"). */
export function problemasDaArvore(populacao: 'empresas' | 'notas', arvore: Grupo | null): string[] {
  return arvore ? HELPERS[populacao].problemasDaArvore(arvore) : []
}

export function descreverArvore(populacao: 'empresas' | 'notas', arvore: Grupo | null): string {
  if (!arvore) return 'Sem filtro.'
  try {
    return ENGINES[populacao].descrever(arvore)
  } catch {
    return 'Filtro inválido para o catálogo atual.'
  }
}

/** A árvore parada por um instante: contar a cada tecla derrubaria o banco. */
function useAtrasado<T>(valor: T, ms = 700): T {
  const [atrasado, setAtrasado] = React.useState(valor)
  React.useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return atrasado
}

export function ContagemPopulacao({
  populacao,
  arvore,
  habilitada = true,
  rotulo,
}: {
  populacao: 'empresas' | 'notas'
  arvore: Grupo | null
  habilitada?: boolean
  rotulo?: string
}) {
  const chave = useAtrasado(JSON.stringify(arvore))
  const q = useQuery({
    queryKey: gestaoAgentesKeys.contagem(populacao, chave),
    queryFn: () => contarPopulacao(populacao, JSON.parse(chave) as Grupo | null),
    enabled: habilitada,
    staleTime: 60_000,
    retry: false,
  })
  const nomes = ROTULO_POPULACAO[populacao]

  if (!habilitada) {
    return <p className="text-xs text-muted-foreground">Corrija o filtro para ver a contagem.</p>
  }
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
      {q.isFetching ? (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Contando…
        </span>
      ) : q.isError ? (
        <span className="text-destructive">
          Não foi possível contar: {q.error instanceof Error ? q.error.message : 'erro desconhecido'}
        </span>
      ) : (
        <span>
          <strong className="tabular-nums">{inteiro(q.data ?? 0)}</strong>{' '}
          {(q.data ?? 0) === 1 ? nomes.um : nomes.varios} {rotulo ?? 'hoje'}
        </span>
      )}
    </p>
  )
}

interface FiltroComPreviaProps {
  populacao: 'empresas' | 'notas'
  titulo: string
  descricao?: React.ReactNode
  arvore: Grupo | null
  onChange: (arvore: Grupo | null) => void
  /** Árvore em E só para a CONTAGEM (o escopo por baixo do piloto, o do agente por baixo da regra). */
  base?: Grupo | null
  /** O que acontece sem filtro — "pega a base inteira" ou "nada é criado". */
  semFiltro?: React.ReactNode
  invalidaGravada?: boolean
  disabled?: boolean
  /** Mostrar a contagem mesmo sem filtro (o escopo vazio vale para tudo). */
  contarSemFiltro?: boolean
}

export function FiltroComPrevia({
  populacao,
  titulo,
  descricao,
  arvore,
  onChange,
  base = null,
  semFiltro,
  invalidaGravada,
  disabled,
  contarSemFiltro = true,
}: FiltroComPreviaProps) {
  const helpers = HELPERS[populacao]
  const problemas = React.useMemo(() => problemasDaArvore(populacao, arvore), [populacao, arvore])
  const efetiva = combinarArvores(base, arvore)
  const id = React.useId()

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="text-sm font-medium">
            {titulo}
          </Label>
          {descricao ? <div className="text-xs text-muted-foreground">{descricao}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{arvore ? 'Com filtro' : 'Sem filtro'}</span>
          <Switch
            id={id}
            checked={arvore !== null}
            disabled={disabled}
            onCheckedChange={(v) => onChange(v ? helpers.grupoPadrao() : null)}
          />
        </div>
      </div>

      {invalidaGravada && !arvore ? (
        <p className={cn('flex items-start gap-2 rounded-md border p-2 text-xs', STATUS_SUPERFICIE.warning)}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          O filtro gravado usa uma variável que não existe mais no catálogo e foi descartado aqui.
          Monte outro e salve — até lá o worker recusa esta árvore.
        </p>
      ) : null}

      {arvore ? (
        <>
          <ConstrutorRegra
            engine={ENGINES[populacao]}
            arvore={arvore}
            onChange={onChange}
            disabled={disabled}
          />
          {problemas.length > 0 ? (
            <ul className={cn('space-y-1 rounded-md border p-2 text-xs', STATUS_SUPERFICIE.warning)}>
              {problemas.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
              {descreverArvore(populacao, arvore)}
            </p>
          )}
        </>
      ) : semFiltro ? (
        <p className="text-xs text-muted-foreground">{semFiltro}</p>
      ) : null}

      {arvore || contarSemFiltro ? (
        <ContagemPopulacao
          populacao={populacao}
          arvore={problemas.length === 0 ? efetiva : null}
          habilitada={problemas.length === 0}
          rotulo={base ? 'hoje, dentro do escopo' : 'hoje'}
        />
      ) : null}
    </div>
  )
}
