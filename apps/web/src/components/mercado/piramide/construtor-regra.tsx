'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  CATALOGO,
  OPERADOR_LABELS,
  isGrupo,
  operadoresDe,
  variavel as buscarVariavel,
  type Condicao,
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
  condicaoPadrao,
  grupoPadrao,
  pedeIntervalo,
  pedeLista,
  pedeValor,
  primeiroOperador,
  remover,
  substituir,
  trocarOperadorGrupo,
  valorPadrao,
  type Caminho,
} from './arvore'
import { ValorInput } from './valor-input'

/**
 * The visual rule builder over the filter tree (§5.1).
 *
 * The operator dropdown is populated by `operadoresDe(variavel)` and by nothing
 * else. That is not a nicety: offering "contém" on a numeric column would build
 * a tree that zod rejects at SAVE time, after the dry-run has already been run
 * and confirmed. An illegal rule must be UNBUILDABLE, not merely rejected.
 */

/** Nesting past this is unreadable, and no real rule needs it. */
const PROFUNDIDADE_MAXIMA = 4

interface ConstrutorRegraProps {
  arvore: Grupo
  onChange: (arvore: Grupo) => void
  disabled?: boolean
}

// ─── Trocas que preservam o que dá para preservar ───────────────────────────

/** The "shape" of a value: change it and the old value is meaningless. */
function formaDoValor(operador: Operador): 'nenhum' | 'lista' | 'intervalo' | 'escalar' {
  if (!pedeValor(operador)) return 'nenhum'
  if (pedeLista(operador)) return 'lista'
  if (pedeIntervalo(operador)) return 'intervalo'
  return 'escalar'
}

function trocarVariavel(cond: Condicao, novoId: string): Condicao {
  const nova = buscarVariavel(novoId)
  if (!nova) return cond

  const anterior = buscarVariavel(cond.variavel)
  const permitidos = operadoresDe(nova.id)
  const operador: Operador = permitidos.includes(cond.operador)
    ? cond.operador
    : primeiroOperador(nova.id)

  // Same type + same operator ⇒ the old value is still meaningful (uf → município).
  const preservavel =
    anterior !== undefined && anterior.tipo === nova.tipo && operador === cond.operador

  return {
    variavel: nova.id,
    operador,
    valor: preservavel ? cond.valor : valorPadrao(nova, operador),
  }
}

function trocarOperador(cond: Condicao, operador: Operador): Condicao {
  const v = buscarVariavel(cond.variavel)
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
  condicao,
  onChange,
  onRemover,
  removivel,
  disabled,
}: {
  condicao: Condicao
  onChange: (cond: Condicao) => void
  onRemover: () => void
  removivel: boolean
  disabled?: boolean
}) {
  const v = buscarVariavel(condicao.variavel)
  const operadores = operadoresDe(condicao.variavel)

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
          onValueChange={(id) => onChange(trocarVariavel(condicao, id))}
          disabled={disabled}
        >
          <SelectTrigger aria-label="Variável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {CATALOGO.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condicao.operador}
          onValueChange={(op) => onChange(trocarOperador(condicao, op as Operador))}
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
  grupo,
  caminho,
  raiz,
  onChangeRaiz,
  disabled,
}: {
  grupo: Grupo
  caminho: Caminho
  raiz: Grupo
  onChangeRaiz: (arvore: Grupo) => void
  disabled?: boolean
}) {
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
            onClick={() => onChangeRaiz(adicionar(raiz, caminho, condicaoPadrao()))}
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
            onClick={() => onChangeRaiz(adicionar(raiz, caminho, grupoPadrao()))}
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
              grupo={no}
              caminho={caminhoFilho}
              raiz={raiz}
              onChangeRaiz={onChangeRaiz}
              disabled={disabled}
            />
          ) : (
            <LinhaCondicao
              key={`cond-${indice}`}
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

export function ConstrutorRegra({ arvore, onChange, disabled }: ConstrutorRegraProps) {
  return (
    <BlocoGrupo
      grupo={arvore}
      caminho={[]}
      raiz={arvore}
      onChangeRaiz={onChange}
      disabled={disabled}
    />
  )
}
