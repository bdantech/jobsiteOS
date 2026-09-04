'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, Loader2, ShieldCheck, Unlink } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { createClient } from '@/lib/supabase/client'
import { desvincularCnpjContaAction, vincularCnpjContaAction } from '@/actions/comercial'

/**
 * CNPJs pendurados manualmente nesta conta.
 *
 * O grafo de grupos econômicos erra por baixo DE PROPÓSITO: uma SPE com dois donos PJ é
 * tratada como folha e não une as holdings dela, senão uma joint venture colaria dois
 * grupos sem relação. O preço, medido em 04/09/2026: 248 SPEs de clientes nossos fora do
 * grupo do dono, 9 delas operando, R$ 842 mil sem conta.
 *
 * E há o caso que o grafo nunca vai ver — a SPE cujos sócios são as mesmas PESSOAS FÍSICAS
 * do cliente, sem vínculo societário entre as empresas. O CPF vem mascarado da Receita;
 * não existe aresta para seguir, e só quem conhece a operação sabe.
 *
 * O vínculo aponta para a CONTA, não para o grupo, mesmo morando na aba do grupo:
 * `app_holding_do_sacado` precisa devolver uma empresa só, e um grupo pode ter dois
 * clientes. Amarrar ao grupo reintroduziria a ambiguidade que ele existe para evitar.
 */

interface Vinculo {
  cnpj: string
  razao_social: string | null
  motivo: string
  criado_em: string
  criado_por_nome: string | null
  monitorada: boolean
  is_spe: boolean
  cessoes: number
  volume: number | null
}

async function buscarVinculos(empresaId: string): Promise<Vinculo[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_vinculos_da_conta', { p_empresa_id: empresaId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((v) => ({
    ...(v as unknown as Vinculo),
    cessoes: Number(v.cessoes ?? 0),
    volume: v.volume === null || v.volume === undefined ? null : Number(v.volume),
  }))
}

const brl = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export function CnpjsVinculados({
  empresaId, estagio,
}: {
  empresaId: string
  estagio: string | null
}) {
  const qc = useQueryClient()
  const [abrindo, setAbrindo] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [monitorar, setMonitorar] = React.useState(true)
  const [removendo, setRemovendo] = React.useState<string | null>(null)

  const chave = ['comercial', 'vinculos', empresaId] as const
  const { data, isPending, isError } = useQuery({ queryKey: chave, queryFn: () => buscarVinculos(empresaId) })

  // Só cliente e ex-cliente recebem vínculo — é a mesma régua do RPC, e oferecer o botão
  // numa empresa de mercado seria oferecer um erro.
  const podeVincular = estagio === 'cliente' || estagio === 'ex_cliente'
  if (isError) return null
  if (isPending) return <Skeleton className="h-40 w-full" />

  const lista = data ?? []
  if (!podeVincular && lista.length === 0) return null

  async function remover(v: Vinculo) {
    setRemovendo(v.cnpj)
    const r = await desvincularCnpjContaAction({ cnpj: v.cnpj, desmonitorar: true })
    setRemovendo(null)
    if (!r.ok) return toast.error(r.message)
    toast.success('Vínculo removido. As cessões deste CNPJ deixam de pertencer a esta conta.')
    void qc.invalidateQueries({ queryKey: chave })
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Link2 className="h-4 w-4" aria-hidden />
            <span className="text-xs font-medium uppercase tracking-wide">Vínculos manuais</span>
          </div>
          <CardTitle className="text-base">CNPJs que operam por baixo desta conta</CardTitle>
          <CardDescription>
            Para o que o grafo de sócios não alcança: a SPE em sociedade com outra holding, ou a
            que é dos mesmos sócios pessoas físicas. O que for vinculado aqui passa a gerar
            comissão <strong>para esta conta</strong>.
          </CardDescription>
        </div>
        {podeVincular ? (
          <Button size="sm" variant="outline" onClick={() => { setAbrindo(true); setErro(null); setMonitorar(true) }}>
            Vincular CNPJ
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        {lista.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nenhum CNPJ vinculado à mão. O que o grafo de sócios já resolve não precisa aparecer
            aqui — esta lista é só das exceções.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {lista.map((v) => (
              <li key={v.cnpj} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {v.razao_social ?? formatCnpj(v.cnpj)}
                    {v.monitorada ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        <ShieldCheck className="mr-1 h-2.5 w-2.5" aria-hidden />
                        afiançada
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                    {formatCnpj(v.cnpj)}
                    {v.cessoes > 0 ? ` · ${v.cessoes} cessão(ões) · ${brl(v.volume)}` : ' · sem operação'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{v.motivo}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={removendo === v.cnpj}
                  onClick={() => void remover(v)}
                >
                  {removendo === v.cnpj ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Unlink className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className="sr-only">Desvincular</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={abrindo} onOpenChange={setAbrindo}>
        <DialogContent className="sm:max-w-lg">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              setSalvando(true)
              setErro(null)
              const r = await vincularCnpjContaAction({
                empresa_id: empresaId,
                cnpj: String(fd.get('cnpj') ?? '').replace(/\D/g, ''),
                motivo: String(fd.get('motivo') ?? ''),
                monitorar,
              })
              setSalvando(false)
              if (!r.ok) return setErro(r.message)
              toast.success(
                `${r.data.razao_social ?? 'CNPJ'} vinculado${r.data.criada ? ' e cadastrado' : ''}` +
                  `${r.data.monitorada ? ', com monitoramento de protesto ligado' : ''}.`,
              )
              setAbrindo(false)
              void qc.invalidateQueries({ queryKey: chave })
            }}
          >
            <DialogHeader>
              <DialogTitle>Vincular um CNPJ a esta conta</DialogTitle>
              <DialogDescription>
                As cessões deste CNPJ passam a ser desta conta — classificação, titular e comissão.
                Vale para o que ainda não foi lançado; o que já está no extrato guarda a conta do
                dia em que converteu.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="cnpj-vinculo">CNPJ</Label>
                <Input
                  id="cnpj-vinculo"
                  name="cnpj"
                  required
                  placeholder="00.000.000/0000-00"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Se ainda não estiver cadastrado, a empresa é criada como <strong>mercado</strong> —
                  não como cliente. Quem é cliente é esta conta; criá-la como cliente a faria contar
                  duas vezes na carteira.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="motivo-vinculo-grupo">Por que este CNPJ é desta conta</Label>
                <Input
                  id="motivo-vinculo-grupo"
                  name="motivo"
                  required
                  minLength={3}
                  placeholder="Ex.: SPE do mesmo sócio, aberta fora da holding."
                />
                <p className="text-xs text-muted-foreground">
                  Obrigatório: o parentesco não está no dado público, senão o sistema já o teria
                  achado sozinho.
                </p>
              </div>

              <label className="flex items-start justify-between gap-3 rounded-md border p-3">
                <span className="text-sm">
                  Marcar como afiançada
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Entra na rotina mensal de protesto. Cada CNPJ monitorado é{' '}
                    <strong>uma consulta paga por mês</strong>.
                  </span>
                </span>
                <Switch checked={monitorar} onCheckedChange={setMonitorar} />
              </label>

              {erro ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {erro}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAbrindo(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Vinculando…' : 'Vincular'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
