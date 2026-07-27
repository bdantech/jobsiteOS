'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  OPERADOR_LABELS,
  isGrupo,
  type Condicao,
  type FiltroEngine,
  type Grupo,
  type No,
  type Operador,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  adicionar,
  criarHelpersArvore,
  pedeIntervalo,
  pedeLista,
  pedeValor,
  remover,
  substituir,
  trocarOperadorGrupo,
  valorPadrao,
  type Caminho,
} from './arvore'
import { ValorInput } from './valor-input'

/**
 * O construtor visual sobre a árvore de filtros, genérico sobre o ENGINE.
 *
 * O dropdown de operadores é populado por `engine.operadoresDe(variavel)` e por
 * nada mais. Isso não é gentileza: oferecer "contém" numa coluna numérica montaria
 * uma árvore que o zod rejeita no SALVAR, depois de o dry-run já ter sido rodado e
 * confirmado. Uma regra ilegal deve ser IMPOSSÍVEL DE MONTAR, não meramente
 * rejeitada.
 *
 * Dois engines usam este componente — o do Mercado (pirâmide/segmentos) e o das
 * faixas da Antecipação. O vocabulário muda; a mecânica de edição, não.
 */

/** Aninhar além disto é ilegível, e nenhuma regra real precisa. */
const PROFUNDIDADE_MAXIMA = 4

interface ConstrutorRegraProps {
  engine: FiltroEngine
  arvore: Grupo
  onChange: (arvore: Grupo) => void
  disabled?: boolean
}

// ─── Trocas que preservam o que dá para preservar ───────────────────────────

/** A "forma" de um valor: mude-a e o valor antigo perde sentido. */
function formaDoValor(operador: Operador): 'nenhum' | 'lista' | 'intervalo' | 'escalar' {
  if (!pedeValor(operador)) return 'nenhum'
  if (pedeLista(operador)) return 'lista'
  if (pedeIntervalo(operador)) return 'intervalo'
  return 'escalar'
}

function trocarVariavel(engine: FiltroEngine, cond: Condicao, novoId: string): Condicao {
  const nova = engine.variavel(novoId)
  if (!nova) return cond

  const anterior = engine.variavel(cond.variavel)
  const permitidos = engine.operadoresDe(nova.id)
  const operador: Operador = permitidos.includes(cond.operador)
    ? cond.operador
    : (permitidos[0] ?? cond.operador)

  // Mesmo tipo + mesmo operador ⇒ o valor antigo ainda faz sentido (uf → município).
  const preservavel =
    anterior !== undefined && anterior.tipo === nova.tipo && operador === cond.operador

  return {
    variavel: nova.id,
    operador,
    valor: preservavel ? cond.valor : valorPadrao(nova, operador),
  }
}

function trocarOperador(engine: FiltroEngine, cond: Condicao, operador: Operador): Condicao {
  const v = engine.variavel(cond.variavel)
  if (!v) return cond

  const mesmaForma = formaDoValor(operador) === formaDoValor(cond.operador)

  return {
    variavel: cond.variavel,
    operador,
    valor: mesmaForma ? cond.valor : valorPadrao(v, operador),
  }
}

// ─── Condição ───────────────────────────────────────────────────────────────

function LinhaCondicao({
  engine,
  condicao,
  onChange,
  onRemover,
  removivel,
  disabled,
}: {
  engine: FiltroEngine
  condicao: Condicao
  onChange: (cond: Condicao) => void
  onRemover: () => void
  removivel: boolean
  disabled?: boolean
}) {
  const v = engine.variavel(condicao.variavel)
  const operadores = engine.operadoresDe(condicao.variavel)

  if (!v) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">
          Variável desconhecida: <code>{condicao.variavel}</code>. Ela saiu do catálogo — remova
          esta condição.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRemover} disabled={disabled}>
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Remover condição</span>
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,1fr)_auto] sm:items-start">
        <Select
          value={condicao.variavel}
          onValueChange={(id) => onChange(trocarVariavel(engine, condicao, id))}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Variável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {engine.catalogo.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condicao.operador}
          onValueChange={(op) => onChange(trocarOperador(engine, condicao, op as Operador))}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Operador">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operadores.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERADOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="min-w-0">
          <ValorInput
            variavel={v}
            operador={condicao.operador}
            valor={condicao.valor}
            onChange={(valor) => onChange({ ...condicao, valor })}
            disabled={disabled}
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemover}
          disabled={disabled || !removivel}
          title={removivel ? 'Remover condição' : 'Um grupo precisa de ao menos uma condição'}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Remover condição</span>
        </Button>
      </div>

      {v.descricao && <p className="mt-2 text-xs text-muted-foreground">{v.descricao}</p>}
    </div>
  )
}

// ─── Grupo (recursivo) ──────────────────────────────────────────────────────

function BlocoGrupo({
  engine,
  grupo,
  caminho,
  raiz,
  onChangeRaiz,
  disabled,
}: {
  engine: FiltroEngine
  grupo: Grupo
  caminho: Caminho
  raiz: Grupo
  onChangeRaiz: (arvore: Grupo) => void
  disabled?: boolean
}) {
  const helpers = React.useMemo(() => criarHelpersArvore(engine), [engine])
  const profundidade = caminho.length
  const ehRaiz = profundidade === 0
  const podeAninhar = profundidade + 1 < PROFUNDIDADE_MAXIMA
  const removivel = grupo.condicoes.length > 1

  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border p-3',
        ehRaiz ? 'bg-muted/30' : 'border-dashed bg-muted/20',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
          {(['e', 'ou'] as const).map((op) => (
            <Button
              key={op}
              type="button"
              size="sm"
              variant={grupo.operador === op ? 'default' : 'ghost'}
              className="h-7 px-3 text-xs"
              disabled={disabled}
              aria-pressed={grupo.operador === op}
              onClick={() => onChangeRaiz(trocarOperadorGrupo(raiz, caminho, op))}
            >
              {op === 'e' ? 'E (todas)' : 'OU (qualquer)'}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChangeRaiz(adicionar(raiz, caminho, helpers.condicaoPadrao()))}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Condição
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !podeAninhar}
            title={podeAninhar ? undefined : 'Limite de aninhamento atingido'}
            onClick={() => onChangeRaiz(adicionar(raiz, caminho, helpers.grupoPadrao()))}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Grupo
          </Button>

          {!ehRaiz && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => onChangeRaiz(remover(raiz, caminho))}
              title="Remover grupo"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sr-only">Remover grupo</span>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {grupo.condicoes.map((no: No, indice) => {
          const caminhoFilho = [...caminho, indice]

          return isGrupo(no) ? (
            <BlocoGrupo
              key={`grupo-${indice}`}
              engine={engine}
              grupo={no}
              caminho={caminhoFilho}
              raiz={raiz}
              onChangeRaiz={onChangeRaiz}
              disabled={disabled}
            />
          ) : (
            <LinhaCondicao
              key={`cond-${indice}`}
              engine={engine}
              condicao={no}
              removivel={removivel}
              disabled={disabled}
              onChange={(cond) => onChangeRaiz(substituir(raiz, caminhoFilho, cond))}
              onRemover={() => onChangeRaiz(remover(raiz, caminhoFilho))}
            />
          )
        })}
      </div>
    </div>
  )
}

export function ConstrutorRegra({ engine, arvore, onChange, disabled }: ConstrutorRegraProps) {
  return (
    <BlocoGrupo
      engine={engine}
      grupo={arvore}
      caminho={[]}
      raiz={arvore}
      onChangeRaiz={onChange}
      disabled={disabled}
    />
  )
}
