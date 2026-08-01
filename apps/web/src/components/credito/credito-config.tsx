'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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

interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
}

/** `Balanço patrimonial` → `balanco_patrimonial`: id estável, sem acento e sem espaço. */
function idDoLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/**
 * O checklist de documentos da esteira (04d §4.2).
 *
 * O `id` de um tipo já enviado NÃO muda quando o rótulo muda: os documentos em
 * `analise_docs` guardam o id, e reescrevê-lo desligaria da análise todo arquivo já
 * anexado — que continuaria no bucket, invisível. Por isso o id é gerado uma vez, na
 * criação, e depois só o rótulo é editável.
 *
 * Remover um tipo também não apaga nada: some do checklist, e os arquivos daquele tipo
 * continuam listados no detalhe da análise.
 */
function TiposDeDocumento({
  tipos,
  onSalvar,
  salvando,
}: {
  tipos: TipoDoc[]
  onSalvar: (tipos: TipoDoc[]) => Promise<void>
  salvando: boolean
}) {
  const [rascunho, setRascunho] = React.useState<TipoDoc[] | null>(null)
  const atual = rascunho ?? tipos
  const sujo = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(tipos)

  function mexer(fn: (lista: TipoDoc[]) => TipoDoc[]) {
    setRascunho((r) => fn(structuredClone(r ?? tipos)))
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Documentos da análise</CardTitle>
            <CardDescription>
              O checklist que aparece no detalhe da análise. Enquanto faltar um obrigatório, a
              tela avisa — a seguradora costuma pedir por eles, e sem isso a análise volta.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" disabled={!sujo} onClick={() => setRascunho(null)}>
              Descartar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!sujo || salvando}
              onClick={async () => {
                await onSalvar(atual.filter((t) => t.label.trim() !== ''))
                setRascunho(null)
              }}
            >
              <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
              Salvar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {atual.map((t, i) => (
          <div key={t.id || i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Input
              value={t.label}
              onChange={(e) =>
                mexer((l) => {
                  const item = l[i]
                  if (item) item.label = e.target.value
                  return l
                })
              }
              className="h-8 min-w-40 flex-1"
              placeholder="Nome do documento"
            />
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {t.id}
            </code>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              obrigatório
              <Switch
                checked={t.obrigatorio}
                onCheckedChange={(v) =>
                  mexer((l) => {
                    const item = l[i]
                    if (item) item.obrigatorio = v
                    return l
                  })
                }
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2"
              aria-label={`Remover ${t.label}`}
              onClick={() => mexer((l) => l.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            mexer((l) => [...l, { id: `tipo_${l.length + 1}`, label: '', obrigatorio: false }])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          Adicionar tipo
        </Button>

        <p className="text-[0.8rem] text-muted-foreground">
          O identificador entre parênteses é o que os arquivos já enviados guardam. Ele é
          gerado na criação e não muda quando você renomeia o documento — mudá-lo desligaria
          da análise todo arquivo já anexado.
        </p>
      </CardContent>
    </Card>
  )
}

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

  async function salvarTipos(tipos: TipoDoc[]) {
    setSalvando('docs')
    // Id gerado só para os NOVOS (os que ainda estão com o placeholder). Regerar o id de
    // um tipo existente porque o rótulo mudou órfãos os arquivos já anexados.
    const existentes = new Set(
      (((config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []).map((t) => t.id)),
    )
    const normalizados = tipos.map((t) =>
      existentes.has(t.id) ? t : { ...t, id: idDoLabel(t.label) || t.id },
    )
    const r = await salvarCreditoConfigAction({ chave: 'docs', valor: { tipos: normalizados } })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Checklist de documentos salvo.')
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

      <TiposDeDocumento
        tipos={((config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []) as TipoDoc[]}
        onSalvar={salvarTipos}
        salvando={salvando !== null}
      />

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
