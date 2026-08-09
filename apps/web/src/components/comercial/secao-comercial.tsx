'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Handshake } from 'lucide-react'
import {
  ESTAGIO_SDR_LABELS, ESTAGIO_VENDA_LABELS, GESTAO_OPERACAO_DESCRICOES, GESTAO_OPERACAO_LABELS,
  PAPEL_CARTEIRA_LABELS, TIPO_VENDEDOR_LABELS,
  type EstagioSdr, type EstagioVenda, type GestaoOperacao, type PapelCarteira, type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { definirGestaoAction } from '@/actions/comercial'
import { buscarVendedores, comercialKeys } from './queries'

/**
 * A seção "Comercial" da Company 360 (04g §7): quem é dono desta empresa, o que está
 * vivo nos funis, e a decisão ativo × passivo.
 *
 * A decisão mora aqui, e não numa tela de administração, porque ela é sobre ESTA
 * empresa e se toma olhando o histórico dela — não numa lista de cem contas.
 */

async function buscarComercialDaEmpresa(empresaId: string) {
  const supabase = createClient()
  const [carteira, leads, vendas, empresa] = await Promise.all([
    supabase
      .from('vendedor_carteira')
      .select('id, papel, desde, ate, vendedores(id, nome, tipo)')
      .eq('empresa_id', empresaId)
      .order('desde', { ascending: false }),
    supabase
      .from('sdr_leads')
      .select('id, estagio, distribuido_em, vendedores!sdr_leads_sdr_id_fkey(nome)')
      .eq('empresa_id', empresaId)
      .order('distribuido_em', { ascending: false })
      .limit(10),
    supabase
      .from('vendas')
      .select('id, estagio, criada_em, vendedores(nome)')
      .eq('empresa_id', empresaId)
      .order('criada_em', { ascending: false })
      .limit(10),
    supabase
      .from('empresas')
      .select('gestao_operacao, gestao_definida_em')
      .eq('id', empresaId)
      .maybeSingle(),
  ])
  return {
    carteira: carteira.data ?? [],
    leads: leads.data ?? [],
    vendas: vendas.data ?? [],
    gestao: empresa.data ?? null,
  }
}

export function SecaoComercial({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient()
  const [editando, setEditando] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  const chave = ['comercial', 'empresa', empresaId] as const
  const { data } = useQuery({ queryKey: chave, queryFn: () => buscarComercialDaEmpresa(empresaId) })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })

  if (!data) return null

  const vigentes = data.carteira.filter((c) => c.ate === null)
  const historico = data.carteira.filter((c) => c.ate !== null)
  const gestao = (data.gestao?.gestao_operacao ?? null) as GestaoOperacao | null

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const nova = String(fd.get('gestao') ?? '')
    setSalvando(true)
    const r = await definirGestaoAction({
      empresa_id: empresaId,
      gestao_operacao: nova === '' ? null : nova,
      vendedor_gestao_id: nova === 'passivo' ? String(fd.get('gestor') ?? '') : null,
    })
    setSalvando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success('Gestão da conta atualizada.')
    setEditando(false)
    void qc.invalidateQueries({ queryKey: chave })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Handshake className="h-4 w-4" aria-hidden />
              Comercial
            </CardTitle>
            <CardDescription>
              {gestao
                ? GESTAO_OPERACAO_DESCRICOES[gestao]
                : 'Ainda não definido se esta conta é trabalhada em prospecção ativa ou é passiva.'}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {gestao ? (
              <Badge variant={gestao === 'passivo' ? 'secondary' : 'default'}>
                {GESTAO_OPERACAO_LABELS[gestao]}
              </Badge>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
              Definir gestão
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Donos vigentes</p>
          {vigentes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dono em nenhum papel.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {vigentes.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3">
                  <span>
                    <Badge variant="outline" className="mr-2 text-[10px]">
                      {PAPEL_CARTEIRA_LABELS[c.papel as PapelCarteira] ?? c.papel}
                    </Badge>
                    {c.vendedores?.nome ?? '—'}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {TIPO_VENDEDOR_LABELS[(c.vendedores?.tipo ?? '') as TipoVendedorId] ?? ''}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    desde {new Date(c.desde).toLocaleDateString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(data.leads.length > 0 || data.vendas.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.leads.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Funil de reuniões</p>
                <ul className="space-y-1 text-sm">
                  {data.leads.map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-2">
                      <span>{ESTAGIO_SDR_LABELS[l.estagio as EstagioSdr] ?? l.estagio}</span>
                      <span className="text-xs text-muted-foreground">{l.vendedores?.nome ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.vendas.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Funil de vendas</p>
                <ul className="space-y-1 text-sm">
                  {data.vendas.map((v) => (
                    <li key={v.id} className="flex items-baseline justify-between gap-2">
                      <Link href="/comercial/vendas" className="hover:underline">
                        {ESTAGIO_VENDA_LABELS[v.estagio as EstagioVenda] ?? v.estagio}
                      </Link>
                      <span className="text-xs text-muted-foreground">{v.vendedores?.nome ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {historico.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Histórico de donos ({historico.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {historico.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {PAPEL_CARTEIRA_LABELS[c.papel as PapelCarteira] ?? c.papel} · {c.vendedores?.nome ?? '—'}
                  </span>
                  <span className="tabular-nums">
                    {new Date(c.desde).toLocaleDateString('pt-BR')} →{' '}
                    {c.ate ? new Date(c.ate).toLocaleDateString('pt-BR') : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={salvar}>
            <DialogHeader>
              <DialogTitle>Gestão da operação</DialogTitle>
              <DialogDescription>
                Passivo tem efeito real: as NFs desta empresa deixam de gerar abordagem e saem da
                carteira de originação. Só o volume conta, na comissão de quem a gere.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="gestao">Como esta conta é trabalhada</Label>
                <select
                  id="gestao"
                  name="gestao"
                  defaultValue={gestao ?? ''}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Não definido</option>
                  <option value="prospeccao_ativa">{GESTAO_OPERACAO_LABELS.prospeccao_ativa}</option>
                  <option value="passivo">{GESTAO_OPERACAO_LABELS.passivo}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gestor">Vendedor que gere (obrigatório se passiva)</Label>
                <select
                  id="gestor"
                  name="gestor"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione…</option>
                  {(vendedores.data ?? [])
                    .filter((v) => v.ativo && v.tipo === 'vendedor')
                    .map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Passiva sem gestor é conta órfã com rótulo — o banco recusa.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditando(false)}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
