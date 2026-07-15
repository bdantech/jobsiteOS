'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import {
  ESTAGIOS,
  ESTAGIO_LABELS,
  TIPOS_EMPRESA,
  TIPO_EMPRESA_LABELS,
  criarEmpresaSchema,
  type Estagio,
  type TipoEmpresa,
} from '@jobsiteos/core'
import { criarEmpresaAction } from '@/actions/empresas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { maskCnpj } from './format'
import { aplicarFieldErrors } from './form-errors'
import { empresasKeys } from './queries'

/**
 * Every field is a string here, because that is what an <input> produces. The
 * conversion to the domain shape happens once, in `montarPayload`, and is then
 * validated by criarEmpresaSchema — the exact same schema the server re-runs
 * inside criarEmpresa(). One source of truth for the rules and the messages.
 */
interface NovaEmpresaValues {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  tipo: TipoEmpresa
  estagio: Estagio
  uf: string
  municipio: string
  cnae_principal: string
  porte: string
  erp_atual: string
  erp_mrr: string
  erp_canal_venda: string
}

const VALORES_INICIAIS: NovaEmpresaValues = {
  cnpj: '',
  razao_social: '',
  nome_fantasia: '',
  tipo: 'construtora',
  estagio: 'mercado',
  uf: '',
  municipio: '',
  cnae_principal: '',
  porte: '',
  erp_atual: '',
  erp_mrr: '',
  erp_canal_venda: '',
}

/** The fields a MutationError may name. Keeps setError() off phantom paths. */
const CAMPOS = [
  'cnpj',
  'razao_social',
  'nome_fantasia',
  'tipo',
  'estagio',
  'uf',
  'municipio',
  'cnae_principal',
  'porte',
  'erp_atual',
  'erp_mrr',
  'erp_canal_venda',
] as const

/** '' means "não informado" — an absent key, not an empty string in the database. */
function opcional(valor: string): string | undefined {
  const limpo = valor.trim()
  return limpo.length > 0 ? limpo : undefined
}

function montarPayload(values: NovaEmpresaValues) {
  return {
    cnpj: values.cnpj,
    razao_social: values.razao_social.trim(),
    nome_fantasia: opcional(values.nome_fantasia),
    tipo: values.tipo,
    estagio: values.estagio,
    uf: opcional(values.uf),
    municipio: opcional(values.municipio),
    cnae_principal: opcional(values.cnae_principal),
    porte: opcional(values.porte),
    erp_atual: opcional(values.erp_atual),
    erp_mrr: opcional(values.erp_mrr),
    erp_canal_venda: opcional(values.erp_canal_venda),
  }
}

export function NovaEmpresaDialog() {
  const [aberto, setAberto] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const queryClient = useQueryClient()
  const router = useRouter()

  const form = useForm<NovaEmpresaValues>({ defaultValues: VALORES_INICIAIS })

  async function onSubmit(values: NovaEmpresaValues) {
    const payload = montarPayload(values)

    // Validate with the domain schema before the round trip: same rules, same
    // pt-BR messages, instant feedback. The server validates again regardless —
    // this is a convenience, never the enforcement.
    const parsed = criarEmpresaSchema.safeParse(payload)
    if (!parsed.success) {
      aplicarFieldErrors(form, parsed.error.flatten().fieldErrors, CAMPOS)
      return
    }

    setSalvando(true)
    const resultado = await criarEmpresaAction(payload)
    setSalvando(false)

    if (!resultado.ok) {
      // Duplicate CNPJ arrives as fieldErrors.cnpj and lands on the CNPJ input.
      const aplicou = aplicarFieldErrors(form, resultado.fieldErrors, CAMPOS)
      if (!aplicou) toast.error(resultado.message)
      return
    }

    const empresa = resultado.data
    await queryClient.invalidateQueries({ queryKey: empresasKeys.all })

    setAberto(false)
    form.reset(VALORES_INICIAIS)

    toast.success('Empresa cadastrada.', {
      description: empresa.razao_social ?? undefined,
      action: {
        label: 'Abrir',
        onClick: () => router.push(`/empresas/${empresa.id}`),
      },
    })
  }

  function onOpenChange(proximo: boolean) {
    if (salvando) return
    setAberto(proximo)
    if (!proximo) form.reset(VALORES_INICIAIS)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nova empresa
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>
            O CNPJ é a identidade da empresa: é validado e não pode se repetir.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="cnpj"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CNPJ</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="00.000.000/0000-00"
                        value={maskCnpj(field.value)}
                        onChange={(event) => field.onChange(maskCnpj(event.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="razao_social"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Razão social</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" placeholder="Construtora Exemplo Ltda" />
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
                      <Input {...field} autoComplete="off" placeholder="Opcional" />
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

              <FormField
                control={form.control}
                name="estagio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estágio</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ESTAGIOS.map((estagio) => (
                          <SelectItem key={estagio} value={estagio}>
                            {ESTAGIO_LABELS[estagio]}
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
                        <Input {...field} autoComplete="off" placeholder="Opcional" />
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
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={salvando}
                      >
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
                      <Input {...field} autoComplete="off" placeholder="Opcional" />
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
                      <Input {...field} autoComplete="off" placeholder="Opcional" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4 rounded-lg border border-dashed p-4">
              <div>
                <h3 className="text-sm font-medium">Inteligência de ERP</h3>
                <p className="text-sm text-muted-foreground">
                  O ERP que a empresa usa hoje e o que ela paga por ele. Pode ser preenchido depois.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="erp_atual"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ERP atual</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete="off" placeholder="Opcional" />
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
                        Em reais, por mês: o que a empresa paga pelo ERP atual. Não é receita da
                        ONE OS.
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
                        <Input {...field} autoComplete="off" placeholder="Opcional" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cadastrar empresa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
