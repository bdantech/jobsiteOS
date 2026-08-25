'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Handshake } from 'lucide-react'
import {
  ESTAGIO_SDR_LABELS, ESTAGIO_VENDA_LABELS, GESTAO_OPERACAO_DESCRICOES, GESTAO_OPERACAO_LABELS,
  PAPEL_CARTEIRA_LABELS, TIPO_VENDEDOR_LABELS, aceitaGestaoOperacao,
  type EstagioSdr, type EstagioVenda, type GestaoOperacao, type PapelCarteira, type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
      .select('estagio, gestao_operacao, gestao_definida_em')
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
  // A escolha vive em estado porque o CAMPO SEGUINTE depende dela: conta ativa pede
  // originador, conta passiva pede closer. Um formulário estático mostrava sempre o
  // campo do passivo, e quem marcava "ativa" via um seletor vazio de gente que não
  // existe naquele papel — e concluía, com razão, que a tela estava quebrada.
  const [escolha, setEscolha] = React.useState<'' | GestaoOperacao>('')

  const chave = ['comercial', 'empresa', empresaId] as const
  const { data } = useQuery({ queryKey: chave, queryFn: () => buscarComercialDaEmpresa(empresaId) })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })

  if (!data) return null

  const vigentes = data.carteira.filter((c) => c.ate === null)
  const historico = data.carteira.filter((c) => c.ate !== null)
  const gestao = (data.gestao?.gestao_operacao ?? null) as GestaoOperacao | null
  // A pergunta ativo × passivo só existe para quem antecipa (ou antecipou) conosco. Numa
  // empresa de mercado ela não tem resposta possível, e o banco recusa desde a 0095 —
  // oferecer o botão aqui seria oferecer um erro.
  const podeDefinirGestao = aceitaGestaoOperacao({ estagio: data.gestao?.estagio })

  const ativos = (vendedores.data ?? []).filter((v) => v.ativo)
  const originadores = ativos.filter((v) => v.tipo === 'originador')
  const closers = ativos.filter((v) => v.tipo === 'vendedor')

  /** O dono vigente num papel — o seletor abre já apontando para ele. */
  function donoAtual(papel: PapelCarteira): string | null {
    return vigentes.find((c) => c.papel === papel)?.vendedores?.id ?? null
  }

  function abrir() {
    setEscolha(gestao ?? '')
    setEditando(true)
  }

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSalvando(true)
    const r = await definirGestaoAction({
      empresa_id: empresaId,
      gestao_operacao: escolha === '' ? null : escolha,
      vendedor_gestao_id: escolha === 'passivo' ? String(fd.get('gestor') ?? '') || null : null,
      vendedor_originacao_id:
        escolha === 'prospeccao_ativa' ? String(fd.get('originador') ?? '') || null : null,
      motivo: String(fd.get('motivo') ?? '') || undefined,
    })
    setSalvando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success(
      escolha === 'prospeccao_ativa' && fd.get('originador')
        ? 'Conta ativa e originador definido — as NFs dela (e das SPEs do grupo) vão para ele.'
        : 'Gestão da conta atualizada.',
    )
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
                : podeDefinirGestao
                  ? 'Ainda não definido se esta conta é trabalhada em prospecção ativa ou é passiva.'
                  : 'Prospecção ativa × passiva é decisão de cliente ou ex-cliente da OnePay — '
                    + 'esta empresa ainda não chegou lá.'}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {gestao ? (
              <Badge variant={gestao === 'passivo' ? 'secondary' : 'default'}>
                {GESTAO_OPERACAO_LABELS[gestao]}
              </Badge>
            ) : null}
            {podeDefinirGestao ? (
              <Button size="sm" variant="outline" onClick={abrir}>
                Definir gestão
              </Button>
            ) : null}
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
                  value={escolha}
                  onChange={(e) => setEscolha(e.target.value as '' | GestaoOperacao)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Não definido</option>
                  <option value="prospeccao_ativa">{GESTAO_OPERACAO_LABELS.prospeccao_ativa}</option>
                  <option value="passivo">{GESTAO_OPERACAO_LABELS.passivo}</option>
                </select>
              </div>

              {/* Conta ativa entrega NOTA: o dono é o originador. */}
              {escolha === 'prospeccao_ativa' && (
                <div className="space-y-1.5">
                  <Label htmlFor="originador">Originador desta conta (opcional)</Label>
                  <select
                    id="originador"
                    name="originador"
                    defaultValue={donoAtual('originacao') ?? ''}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Deixar sem dono por enquanto</option>
                    {originadores.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {originadores.length === 0
                      ? 'Nenhum originador ativo cadastrado — cadastre um em Comercial › Configurações.'
                      : 'As NFs desta empresa, e as das SPEs do grupo dela, passam a ser roteadas para ele. Escolher outro troca o dono.'}
                  </p>
                </div>
              )}

              {/* Conta passiva entrega VOLUME: o dono é o closer que a gere. */}
              {escolha === 'passivo' && (
                <div className="space-y-1.5">
                  <Label htmlFor="gestor">Closer que gere a conta</Label>
                  <select
                    id="gestor"
                    name="gestor"
                    required
                    defaultValue={donoAtual('gestao_passiva') ?? ''}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {closers.map((v) => (
                      <option key={v.id} value={v.id}>{v.nome}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {closers.length === 0
                      ? 'Nenhum closer ativo cadastrado — sem ele o banco recusa marcar a conta como passiva.'
                      : 'Passiva sem gestor é conta órfã com rótulo — o banco recusa. O volume dela vira a comissão dele.'}
                  </p>
                </div>
              )}

              {/*
                MOTIVO obrigatório quando a classificação muda (04k §3).
                A classificação decide qual taxa cada cessão paga a partir de amanhã, e
                "por que esta conta virou passiva" é a primeira pergunta que a folha do mês
                seguinte faz. Ninguém lembra a resposta três meses depois.

                Só aparece quando há mudança: pedir motivo para reabrir o diálogo e salvar
                o mesmo valor transformaria o histórico em log de navegação.
              */}
              {escolha !== (gestao ?? '') && (
                <div className="space-y-1.5">
                  <Label htmlFor="motivo-gestao">Motivo da mudança</Label>
                  <Input
                    id="motivo-gestao"
                    name="motivo"
                    required
                    minLength={3}
                    placeholder="Ex.: a conta passou a antecipar sozinha depois do onboarding."
                  />
                  <p className="text-xs text-muted-foreground">
                    Vale a partir do dia seguinte. Cessões já convertidas mantêm a
                    classificação da data em que converteram, e o relógio da conta não
                    reinicia.
                  </p>
                </div>
              )}
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
