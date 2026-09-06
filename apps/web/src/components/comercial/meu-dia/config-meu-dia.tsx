'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import {
  GRUPO_MEU_DIA_LABELS,
  TIPO_VENDEDOR_LABELS,
  blocosDoCargo,
  type BlocoCatalogado,
  type OverrideBloco,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { salvarConfigMeuDiaAction } from '@/actions/meu-dia'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Settings do Meu Dia, por cargo.
 *
 * A TELA É GERADA PELO CATÁLOGO, e isso não é economia de código — é o que garante que
 * um bloco novo nasça configurável. A alternativa (um formulário escrito à mão) produz,
 * na primeira adição, um bloco que aparece na tela do vendedor e não aparece aqui: ele
 * existe, incomoda, e ninguém consegue desligar.
 *
 * SÓ O OVERRIDE É GRAVADO. Um campo que voltou ao padrão sai do jsonb em vez de ser
 * gravado com o mesmo valor — assim, se o padrão do catálogo mudar amanhã, quem nunca
 * mexeu naquele limiar acompanha a mudança em vez de ficar preso a uma cópia antiga.
 */

const CARGOS: TipoVendedorId[] = ['sdr', 'vendedor', 'originador']

interface ConfigLinha {
  tipo_vendedor: string
  blocos: Record<string, OverrideBloco>
}

async function buscarConfig(): Promise<ConfigLinha[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('meu_dia_config').select('tipo_vendedor, blocos')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ConfigLinha[]
}

export function ConfigMeuDia() {
  const qc = useQueryClient()
  const [cargo, setCargo] = React.useState<TipoVendedorId>('sdr')
  const [rascunho, setRascunho] = React.useState<Record<string, OverrideBloco>>({})
  const [sujo, setSujo] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['comercial', 'meu-dia-config'],
    queryFn: buscarConfig,
  })

  const salvo = React.useMemo(
    () => data?.find((c) => c.tipo_vendedor === cargo)?.blocos ?? {},
    [data, cargo],
  )

  // Trocar de cargo descarta o rascunho: cada cargo é um formulário próprio, e carregar
  // o rascunho de um no outro seria salvar o SLA do SDR na régua do closer.
  React.useEffect(() => {
    setRascunho(salvo)
    setSujo(false)
  }, [salvo])

  const blocos = blocosDoCargo(cargo)

  function ajustar(tipo: string, mudanca: OverrideBloco) {
    setRascunho((atual) => ({ ...atual, [tipo]: { ...(atual[tipo] ?? {}), ...mudanca } }))
    setSujo(true)
  }

  function ajustarLimiar(bloco: BlocoCatalogado, chave: string, valor: string) {
    const limiares = { ...(rascunho[bloco.tipo]?.limiares ?? {}) }
    const n = Number(valor)
    // Voltar ao padrão é APAGAR a chave, e não gravar o mesmo número: quem nunca mexeu
    // acompanha o padrão se ele mudar; quem gravou "5" fica com 5 para sempre.
    if (valor.trim() === '' || !Number.isFinite(n) || n === bloco.limiaresPadrao[chave]) {
      delete limiares[chave]
    } else {
      limiares[chave] = n
    }
    ajustar(bloco.tipo, { limiares })
  }

  async function salvar() {
    setSalvando(true)
    // Limpa os overrides vazios antes de gravar — um `{}` pendurado por bloco é ruído
    // que a próxima pessoa a ler o jsonb teria de decifrar.
    const limpo: Record<string, OverrideBloco> = {}
    for (const [tipo, ov] of Object.entries(rascunho)) {
      const temLimiar = Object.keys(ov.limiares ?? {}).length > 0
      if (ov.ativo === false || ov.max_itens !== undefined || temLimiar) {
        limpo[tipo] = {
          ...(ov.ativo === false ? { ativo: false } : {}),
          ...(ov.max_itens !== undefined ? { max_itens: ov.max_itens } : {}),
          ...(temLimiar ? { limiares: ov.limiares } : {}),
        }
      }
    }

    const r = await salvarConfigMeuDiaAction({ tipoVendedor: cargo, blocos: limpo })
    setSalvando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success('Configuração salva. Vale para todo mundo deste cargo.')
    setSujo(false)
    void qc.invalidateQueries({ queryKey: ['comercial', 'meu-dia-config'] })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Meu Dia</CardTitle>
            <CardDescription>
              O que aparece na lista de trabalho de cada cargo, quantos itens no máximo, e a
              partir de quando um item vira pendência. Vale para todo mundo daquele cargo.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1 rounded-md border border-border p-1">
            {CARGOS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCargo(c)}
                className={cn(
                  'rounded px-3 py-1 text-sm transition-colors',
                  cargo === c ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                {TIPO_VENDEDOR_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              O auxiliar do closer não tem configuração própria — ele enxerga a lista do closer
              a que está vinculado, com estas mesmas réguas.
            </p>

            <div className="space-y-3">
              {blocos.map((bloco) => {
                const ov = rascunho[bloco.tipo] ?? {}
                const ativo = ov.ativo ?? true
                return (
                  <div
                    key={bloco.tipo}
                    className={cn(
                      'rounded-lg border border-border p-3 transition-opacity',
                      !ativo && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{bloco.rotulo}</p>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {GRUPO_MEU_DIA_LABELS[bloco.grupo]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{bloco.descricao}</p>
                      </div>
                      <Switch
                        checked={ativo}
                        aria-label={`Mostrar ${bloco.rotulo}`}
                        onCheckedChange={(m) => ajustar(bloco.tipo, { ativo: m ? undefined : false })}
                      />
                    </div>

                    {ativo && (
                      <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Máximo de itens</Label>
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-24"
                            placeholder={String(bloco.maxPadrao)}
                            value={ov.max_itens ?? ''}
                            onChange={(e) =>
                              ajustar(bloco.tipo, {
                                max_itens: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </div>

                        {Object.entries(bloco.limiaresPadrao).map(([chave, padrao]) => (
                          <div key={chave} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              {bloco.limiarRotulos?.[chave] ?? chave}
                            </Label>
                            <Input
                              type="number"
                              className="h-8 w-32"
                              placeholder={String(padrao)}
                              value={ov.limiares?.[chave] ?? ''}
                              onChange={(e) => ajustarLimiar(bloco, chave, e.target.value)}
                            />
                          </div>
                        ))}

                        {(ov.max_itens !== undefined ||
                          Object.keys(ov.limiares ?? {}).length > 0) && (
                          <button
                            type="button"
                            onClick={() => ajustar(bloco.tipo, { max_itens: undefined, limiares: {} })}
                            className="mt-5 flex items-center gap-1 text-xs text-muted-foreground underline"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden />
                            voltar ao padrão
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-3">
              {sujo && <span className="text-sm text-muted-foreground">Alterações não salvas.</span>}
              <Button onClick={() => void salvar()} disabled={!sujo || salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
