'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { salvarCreditoConfigAction } from '@/actions/credito'
import { buscarCreditoConfig, buscarVersaoCredito, creditoKeys } from './queries'

/**
 * Configurações do módulo (04d §1).
 *
 * Tudo aqui muda com o negócio: taxa, TAC, prazo médio, tetos, corte de concessão. Nada
 * disso é constante de código justamente porque vai mudar, e no dia em que mudar ninguém
 * vai lembrar de procurar num arquivo.
 *
 * Os campos com `null` (giro e ratio) são OVERRIDES: em branco, valem os calibrados na
 * carteira. Preenchidos, vencem a calibração — e a tela diz qual está valendo, senão o
 * override vira uma explicação que ninguém encontra quando o número parece errado.
 */

interface CampoNum {
  chave: string
  campo: string
  label: string
  descricao?: string
  step?: string
}

const CAMPOS: Array<{ chave: string; titulo: string; descricao: string; campos: CampoNum[] }> = [
  {
    chave: 'economia',
    titulo: 'Economia da operação',
    descricao: 'O que transforma um limite em receita por mês.',
    campos: [
      { chave: 'economia', campo: 'taxa_padrao_am', label: 'Taxa padrão (% a.m.)', step: '0.01' },
      { chave: 'economia', campo: 'tac', label: 'TAC por operação (R$)', step: '0.01' },
      {
        chave: 'economia',
        campo: 'valor_medio_nf',
        label: 'Valor médio da NF (R$)',
        descricao: 'Converte volume em número de operações, que é o que multiplica a TAC.',
        step: '0.01',
      },
      { chave: 'economia', campo: 'prazo_medio_dias', label: 'Prazo médio (dias)' },
      {
        chave: 'economia',
        campo: 'giro_mensal',
        label: 'Giro mensal (override)',
        descricao: 'Em branco = usa o giro calibrado na carteira real (volume ÷ limite).',
        step: '0.001',
      },
    ],
  },
  {
    chave: 'limite',
    titulo: 'Limite',
    descricao: 'Os tetos que impedem uma estimativa de faturamento alta de virar um limite absurdo.',
    campos: [
      {
        chave: 'limite',
        campo: 'ratio_limite_manual',
        label: 'Ratio limite/faturamento (override)',
        descricao: 'Em branco = usa o calibrado nos clientes que declararam faturamento.',
        step: '0.001',
      },
      { chave: 'limite', campo: 'cap_absoluto', label: 'Teto absoluto (R$)', step: '1000' },
      {
        chave: 'limite',
        campo: 'cap_pct_faturamento',
        label: '% máximo do faturamento',
        descricao: '0,15 = o limite nunca passa de 15% do faturamento estimado.',
        step: '0.01',
      },
    ],
  },
  {
    chave: 'scorecard',
    titulo: 'Scorecard',
    descricao: 'Os cortes que decidem faixa, e a completude mínima para o score ser exibido.',
    campos: [
      { chave: 'scorecard', campo: 'corte_concessao', label: 'Corte de concessão (score)' },
      {
        chave: 'scorecard',
        campo: 'completude_minima',
        label: 'Completude mínima',
        descricao: '0,5 = abaixo de metade dos pesos avaliáveis, o score não é exibido.',
        step: '0.05',
      },
      { chave: 'scorecard', campo: 'recencia_protesto_dias', label: 'Protesto recente (dias)' },
      { chave: 'scorecard', campo: 'knockout_negada_meses', label: 'Knockout de negativa (meses)' },
      {
        chave: 'scorecard',
        campo: 'chance_sem_score',
        label: 'Chance sem score',
        descricao: 'Usada no valor esperado quando não há faixa. Fica marcada como presumida.',
        step: '0.05',
      },
    ],
  },
]

export function CreditoConfig() {
  const qc = useQueryClient()
  const [rascunho, setRascunho] = React.useState<Record<string, Record<string, string>>>({})
  const [salvando, setSalvando] = React.useState<string | null>(null)

  const config = useQuery({ queryKey: creditoKeys.config(), queryFn: buscarCreditoConfig })
  const versao = useQuery({ queryKey: creditoKeys.versao(), queryFn: buscarVersaoCredito })

  function valorDe(chave: string, campo: string): string {
    const doRascunho = rascunho[chave]?.[campo]
    if (doRascunho !== undefined) return doRascunho
    const bloco = (config.data?.[chave] ?? {}) as Record<string, unknown>
    const v = bloco[campo]
    return v === null || v === undefined ? '' : String(v)
  }

  function ajustar(chave: string, campo: string, valor: string) {
    setRascunho((r) => ({ ...r, [chave]: { ...(r[chave] ?? {}), [campo]: valor } }))
  }

  async function salvar(chave: string) {
    setSalvando(chave)
    const bloco = { ...((config.data?.[chave] ?? {}) as Record<string, unknown>) }
    for (const [campo, texto] of Object.entries(rascunho[chave] ?? {})) {
      // '' vira NULL, não 0: para giro e ratio, essa é literalmente a diferença entre
      // "usa o calibrado" e "trava em zero, e nenhuma empresa tem limite".
      bloco[campo] = texto.trim() === '' ? null : Number(texto)
    }
    const r = await salvarCreditoConfigAction({ chave, valor: bloco })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Configuração salva. Rode "Só potencial" no painel para reaplicar.')
    setRascunho((s) => ({ ...s, [chave]: {} }))
    void qc.invalidateQueries({ queryKey: creditoKeys.config() })
  }

  if (config.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  const coef = (versao.data?.coeficientes ?? null) as
    | { ratio_limite?: { global?: number | null }; giro_mensal?: number | null }
    | null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Calibração vigente</CardTitle>
          <CardDescription>
            O que a carteira real disse na última calibração. Os overrides abaixo vencem estes
            valores — e é aqui que se confere qual está valendo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ratio limite/faturamento</p>
            <p className="text-lg font-semibold tabular-nums">
              {coef?.ratio_limite?.global ?? '—'}
            </p>
            {!coef?.ratio_limite?.global && (
              <p className="text-[11px] text-muted-foreground">
                Sem clientes com faturamento declarado.
              </p>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Giro mensal</p>
            <p className="text-lg font-semibold tabular-nums">
              {coef?.giro_mensal ? `${(coef.giro_mensal * 100).toFixed(1)}%` : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground">do limite, por mês</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Versão</p>
            <p className="text-lg font-semibold tabular-nums">{versao.data?.versao ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      {CAMPOS.map((grupo) => {
        const sujo = Object.keys(rascunho[grupo.chave] ?? {}).length > 0
        return (
          <Card key={grupo.chave}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{grupo.titulo}</CardTitle>
                  <CardDescription>{grupo.descricao}</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!sujo || salvando !== null}
                  onClick={() => void salvar(grupo.chave)}
                >
                  <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {salvando === grupo.chave ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {grupo.campos.map((c) => (
                <div key={c.campo} className="space-y-1.5">
                  <Label htmlFor={`${c.chave}.${c.campo}`}>{c.label}</Label>
                  <Input
                    id={`${c.chave}.${c.campo}`}
                    type="number"
                    step={c.step ?? '1'}
                    value={valorDe(c.chave, c.campo)}
                    onChange={(e) => ajustar(c.chave, c.campo, e.target.value)}
                    placeholder="—"
                  />
                  {c.descricao && <p className="text-[0.8rem] text-muted-foreground">{c.descricao}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
