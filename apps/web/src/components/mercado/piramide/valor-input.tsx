'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import type { Operador, VariavelCatalogo } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { pedeIntervalo, pedeLista, pedeValor } from './arvore'

/**
 * One widget per (tipo, operador) pair — §5.1's "proper input per type".
 *
 * The invariant this file exists to hold: the VALUE'S JS TYPE matches what the
 * engine's zod schema demands. `numero` must be a `number`, not the string an
 * <input> hands you — the schema rejects "3" for a numeric variable, and it does
 * so on SAVE, which is the worst possible moment to find out. Every numeric path
 * below converts before it calls onChange.
 */

interface ValorInputProps {
  variavel: VariavelCatalogo
  operador: Operador
  valor: unknown
  onChange: (valor: unknown) => void
  disabled?: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** '' → undefined, so a cleared field is "sem valor" and not the number 0. */
function paraNumero(texto: string): number | undefined {
  if (texto.trim() === '') return undefined
  const n = Number(texto)
  return Number.isFinite(n) ? n : undefined
}

function comoTexto(valor: unknown): string {
  if (valor === undefined || valor === null) return ''
  return String(valor)
}

function comoLista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : []
}

function comoPar(valor: unknown): [unknown, unknown] {
  const lista = comoLista(valor)
  return [lista[0], lista[1]]
}

// ─── Chips (lista de textos) ────────────────────────────────────────────────

function ChipsInput({
  valores,
  onChange,
  disabled,
  placeholder,
}: {
  valores: readonly unknown[]
  onChange: (valores: unknown[]) => void
  disabled?: boolean
  placeholder: string
}) {
  const [rascunho, setRascunho] = React.useState('')

  function adicionar() {
    const limpo = rascunho.trim()
    if (limpo === '') return
    // A repeated value in an IN list is noise, not a bug — but it makes the chip
    // row lie about how many things are being matched.
    if (valores.some((v) => String(v) === limpo)) {
      setRascunho('')
      return
    }
    onChange([...valores, limpo])
    setRascunho('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={rascunho}
          onChange={(event) => setRascunho(event.target.value)}
          onKeyDown={(event) => {
            // Enter inside a form would submit it. This input is the value of a
            // condition, not the end of the rule.
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              adicionar()
            }
          }}
          onBlur={adicionar}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Adicionar valor"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={adicionar}
          disabled={disabled || rascunho.trim() === ''}
        >
          Adicionar
        </Button>
      </div>

      {valores.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {valores.map((valor, indice) => (
            <Badge key={`${String(valor)}-${indice}`} variant="secondary" className="gap-1 pr-1">
              {String(valor)}
              <button
                type="button"
                onClick={() => onChange(valores.filter((_, i) => i !== indice))}
                disabled={disabled}
                className="rounded-full p-0.5 hover:bg-background/60 disabled:pointer-events-none"
                aria-label={`Remover ${String(valor)}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/** enum + (em / não em): a checklist beats a free-text chip that can be misspelled. */
function OpcoesMultiplas({
  opcoes,
  valores,
  onChange,
  disabled,
}: {
  opcoes: readonly string[]
  valores: readonly unknown[]
  onChange: (valores: unknown[]) => void
  disabled?: boolean
}) {
  const selecionados = new Set(valores.map(String))

  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((opcao) => {
        const ativo = selecionados.has(opcao)
        return (
          <Button
            key={opcao}
            type="button"
            size="sm"
            variant={ativo ? 'default' : 'outline'}
            disabled={disabled}
            aria-pressed={ativo}
            onClick={() =>
              onChange(
                ativo
                  ? valores.filter((v) => String(v) !== opcao)
                  : [...valores.map(String), opcao],
              )
            }
          >
            {opcao}
          </Button>
        )
      })}
    </div>
  )
}

// ─── O widget ───────────────────────────────────────────────────────────────

export function ValorInput({ variavel, operador, valor, onChange, disabled }: ValorInputProps) {
  // "está preenchido" / "está vazio" take no value at all — an input here would
  // invite the user to type something that is then silently dropped on compile.
  if (!pedeValor(operador)) {
    return <p className="text-sm text-muted-foreground">sem valor</p>
  }

  if (pedeIntervalo(operador)) {
    const [min, max] = comoPar(valor)
    const tipoHtml = variavel.tipo === 'data' ? 'date' : 'number'

    return (
      <div className="flex items-center gap-2">
        <Input
          type={tipoHtml}
          value={comoTexto(min)}
          disabled={disabled}
          aria-label={`${variavel.label} — mínimo`}
          onChange={(event) => {
            const bruto = event.target.value
            const novo = variavel.tipo === 'numero' ? paraNumero(bruto) : bruto
            onChange([novo, max])
          }}
        />
        <span className="text-sm text-muted-foreground">e</span>
        <Input
          type={tipoHtml}
          value={comoTexto(max)}
          disabled={disabled}
          aria-label={`${variavel.label} — máximo`}
          onChange={(event) => {
            const bruto = event.target.value
            const novo = variavel.tipo === 'numero' ? paraNumero(bruto) : bruto
            onChange([min, novo])
          }}
        />
      </div>
    )
  }

  if (pedeLista(operador)) {
    const valores = comoLista(valor)

    if (variavel.tipo === 'enum' && variavel.opcoes) {
      return (
        <OpcoesMultiplas
          opcoes={variavel.opcoes}
          valores={valores}
          onChange={onChange}
          disabled={disabled}
        />
      )
    }

    return (
      <ChipsInput
        valores={valores}
        onChange={onChange}
        disabled={disabled}
        placeholder={variavel.id === 'cnae_grupo' ? 'Ex: 41 (Enter para adicionar)' : 'Digite e pressione Enter'}
      />
    )
  }

  switch (variavel.tipo) {
    case 'booleano': {
      const ativo = valor === true || valor === 'true'
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={ativo}
            onCheckedChange={(marcado) => onChange(marcado)}
            disabled={disabled}
            aria-label={variavel.label}
          />
          <span className="text-sm text-muted-foreground">{ativo ? 'Sim' : 'Não'}</span>
        </div>
      )
    }

    case 'enum': {
      const opcoes = variavel.opcoes ?? []
      return (
        <Select
          value={comoTexto(valor)}
          onValueChange={onChange}
          disabled={disabled || opcoes.length === 0}
        >
          <SelectTrigger aria-label={variavel.label}>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((opcao) => (
              <SelectItem key={opcao} value={opcao}>
                {opcao}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case 'numero':
      return (
        <Input
          type="number"
          inputMode="decimal"
          value={comoTexto(valor)}
          disabled={disabled}
          aria-label={variavel.label}
          onChange={(event) => onChange(paraNumero(event.target.value))}
        />
      )

    case 'data':
      return (
        <Input
          type="date"
          value={comoTexto(valor)}
          disabled={disabled}
          aria-label={variavel.label}
          onChange={(event) => onChange(event.target.value)}
        />
      )

    default:
      return (
        <Input
          value={comoTexto(valor)}
          disabled={disabled}
          aria-label={variavel.label}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
