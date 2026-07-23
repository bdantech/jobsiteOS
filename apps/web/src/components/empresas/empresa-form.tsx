'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  TIPOS_EMPRESA,
  TIPO_EMPRESA_LABELS,
  atualizarEmpresaSchema,
  type Tables,
  type TipoEmpresa,
} from '@jobsiteos/core'
import { atualizarEmpresaAction } from '@/actions/empresas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UFS } from './constants'
import { aplicarFieldErrors } from './form-errors'
import { empresasKeys } from './queries'

interface EmpresaFormValues {
  razao_social: string
  nome_fantasia: string
  tipo: TipoEmpresa
  uf: string
  municipio: string
  cnae_principal: string
  porte: string
  erp_atual: string
  erp_mrr: string
  erp_canal_venda: string
}

const CAMPOS = [
  'razao_social',
  'nome_fantasia',
  'tipo',
  'uf',
  'municipio',
  'cnae_principal',
  'porte',
  'erp_atual',
  'erp_mrr',
  'erp_canal_venda',
] as const

function isTipoEmpresa(valor: string): valor is TipoEmpresa {
  return (TIPOS_EMPRESA as readonly string[]).includes(valor)
}

function paraFormValues(empresa: Tables<'empresas'>): EmpresaFormValues {
  return {
    razao_social: empresa.razao_social ?? '',
    nome_fantasia: empresa.nome_fantasia ?? '',
    tipo: isTipoEmpresa(empresa.tipo) ? empresa.tipo : 'construtora',
    uf: empresa.uf ?? '',
    municipio: empresa.municipio ?? '',
    cnae_principal: empresa.cnae_principal ?? '',
    porte: empresa.porte ?? '',
    erp_atual: empresa.erp_atual ?? '',
    erp_mrr: empresa.erp_mrr === null ? '' : String(empresa.erp_mrr),
    erp_canal_venda: empresa.erp_canal_venda ?? '',
  }
}

/**
 * Company 360 — editable fields, including the ERP intelligence block.
 *
 * `estagio` is deliberately NOT here: it is owned by the header, so there is
 * exactly one control that can move a company through the funnel (and therefore
 * exactly one place that emits `estagio.alterado`).
 *
 * NOTE on nulls: app_atualizar_empresa (migration 0008) merges with
 * `coalesce(new, old)` per field, so an absent key means "leave alone" and a
 * null can never blank a column. Text fields are therefore cleared by sending
 * '' (which does write). The two exceptions are called out at their fields.
 */
export function EmpresaForm({ empresa }: { empresa: Tables<'empresas'> }) {
  const [salvando, setSalvando] = React.useState(false)
  const queryClient = useQueryClient()

  const form = useForm<EmpresaFormValues>({ defaultValues: paraFormValues(empresa) })

  // Canal / representante mora no jsonb erp_detalhes (escrito pela importação), não numa
  // coluna própria — por isso fica fora do formulário e é exibido apenas para leitura.
  const detalhes = empresa.erp_detalhes
  const canalRepresentante =
    detalhes && typeof detalhes === 'object' && !Array.isArray(detalhes)
      ? String((detalhes as Record<string, unknown>).canal ?? '')
      : ''

  // A refetch (or another user's edit landing in the cache) must not silently
  // overwrite what the user is typing — only re-sync a pristine form.
  const { reset, formState } = form
  const pristino = !formState.isDirty
  React.useEffect(() => {
    if (pristino) reset(paraFormValues(empresa))
  }, [empresa, pristino, reset])

  async function onSubmit(values: EmpresaFormValues) {
    const trim = (valor: string) => valor.trim()
    const payload = {
      id: empresa.id,
      razao_social: trim(values.razao_social),
      nome_fantasia: trim(values.nome_fantasia),
      tipo: values.tipo,
      // uf can never be sent empty: ufSchema demands 2 letters, and the select
      // below offers no "clear" option precisely because the write helper cannot
      // set a column back to null.
      uf: trim(values.uf) || undefined,
      municipio: trim(values.municipio),
      cnae_principal: trim(values.cnae_principal),
      porte: trim(values.porte),
      erp_atual: trim(values.erp_atual),
      // Blanking an MRR do ERP that was already set writes 0 (R$ 0,00), because null is
      // not expressible through the coalesce merge. Blank on a company that
      // never had one is simply omitted, so it stays "não informado".
      erp_mrr:
        trim(values.erp_mrr) === '' ? (empresa.erp_mrr === null ? undefined : 0) : values.erp_mrr,
      erp_canal_venda: trim(values.erp_canal_venda),
    }

    const parsed = atualizarEmpresaSchema.safeParse(payload)
    if (!parsed.success) {
      aplicarFieldErrors(form, parsed.error.flatten().fieldErrors, CAMPOS)
      return
    }

    setSalvando(true)
    const resultado = await atualizarEmpresaAction(payload)
    setSalvando(false)

    if (!resultado.ok) {
      const aplicou = aplicarFieldErrors(form, resultado.fieldErrors, CAMPOS)
      if (!aplicou) toast.error(resultado.message)
      return
    }

    // reset() with the row the database actually returned, not with what we
    // sent: it is the only version that reflects the coalesce merge.
    reset(paraFormValues(resultado.data))
    queryClient.setQueryData(empresasKeys.detalhe(empresa.id), resultado.data)
    await queryClient.invalidateQueries({ queryKey: empresasKeys.all })
    toast.success('Alterações salvas.')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Dados gerais</CardTitle>
            <CardDescription>
              O CNPJ não é editável: ele é a identidade da empresa.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="razao_social"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razão social</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="nome_fantasia"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome fantasia</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIPOS_EMPRESA.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>
                          {TIPO_EMPRESA_LABELS[tipo]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-[1fr_7rem] gap-4">
              <FormField
                control={form.control}
                name="municipio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Município</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="uf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UF</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-64">
                        {UFS.map((uf) => (
                          <SelectItem key={uf} value={uf}>
                            {uf}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="cnae_principal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CNAE principal</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="porte"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Porte</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inteligência de ERP</CardTitle>
            <CardDescription>
              Qual ERP a empresa usa hoje, quanto paga por ele e por qual canal comprou.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="erp_atual"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ERP atual</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" placeholder="Não informado" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="erp_mrr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>MRR do ERP</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                  </FormControl>
                  <FormDescription>
                    Em reais, por mês: o que a empresa paga pelo ERP atual. Não é receita da ONE OS.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="erp_canal_venda"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal de venda</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" placeholder="Não informado" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Canal / representante — vem da importação de listas (erp_detalhes.canal), um
                campo distinto do "Canal de venda". Só leitura: quem escreve é o importador.
                Não usa FormField/FormItem porque não faz parte do formulário (não é editável). */}
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Canal / representante</p>
              <Input
                value={canalRepresentante}
                readOnly
                disabled
                autoComplete="off"
                placeholder="Não informado"
              />
              <p className="text-[0.8rem] text-muted-foreground">
                Da importação de listas. Editável só via reimportação.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {formState.isDirty && (
            <span className="text-sm text-muted-foreground">Alterações não salvas.</span>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => reset(paraFormValues(empresa))}
            disabled={!formState.isDirty || salvando}
          >
            Descartar
          </Button>
          <Button type="submit" disabled={!formState.isDirty || salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar alterações
          </Button>
        </div>
      </form>
    </Form>
  )
}
