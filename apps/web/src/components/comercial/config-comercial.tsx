'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import {
  FONTES_DISTRIBUICAO, FONTE_DISTRIBUICAO_LABELS, PARAMETRO_DA_REGRA, TIPOS_VENDEDOR,
  TIPO_VENDEDOR_LABELS, type FonteDistribuicao, type TipoVendedorId, type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { salvarConfigAction, salvarMotivoAction, salvarRegraAction } from '@/actions/comercial'
import { buscarVendedores, comercialKeys } from './queries'
import { VendedorForm } from './vendedor-form'

/**
 * Configurações do Comercial: quem vende, com qual território, por quanto.
 *
 * São as três coisas que, mal preenchidas, fazem o roteamento entregar nota errada e a
 * comissão pagar valor errado — então tudo aqui escreve por RPC com audit_log, e a
 * mensagem de erro vem do banco em português em vez de virar violação de constraint.
 *
 * Não há EXCLUIR em lugar nenhum desta tela. Vendedor se desativa, regra se substitui
 * (a nova encerra a anterior na véspera), motivo se inativa. Apagar qualquer um dos três
 * levaria junto a explicação de uma comissão já paga.
 */

const brl = (n: unknown) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function buscarConfig() {
  const supabase = createClient()
  const [config, regras, territorios, motivos] = await Promise.all([
    supabase.from('comercial_config').select('chave, valor'),
    supabase.from('comissao_regras').select('*').order('tipo_vendedor').order('vigente_de', { ascending: false }),
    supabase.from('vendedor_territorios').select('*'),
    supabase.from('motivos_perda').select('*').order('contexto').order('ordem'),
  ])
  return {
    config: Object.fromEntries((config.data ?? []).map((c) => [c.chave, c.valor as Record<string, unknown>])),
    regras: regras.data ?? [],
    territorios: territorios.data ?? [],
    motivos: motivos.data ?? [],
  }
}

/**
 * Campo que salva no BLUR, não a cada tecla.
 *
 * Salvar por tecla mandaria "2", "25", "250" ao banco e o job pegaria o número do meio
 * se rodasse no instante errado. Salvar só quando o valor mudou evita gravar (e auditar)
 * um clique que não mudou nada.
 */
function CampoNumero({
  rotulo, valor, onSalvar, disabled,
}: {
  rotulo: string
  valor: number
  onSalvar: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(String(valor))
  React.useEffect(() => setTexto(String(valor)), [valor])

  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd>
        <Input
          aria-label={rotulo}
          type="number"
          min={1}
          value={texto}
          disabled={disabled}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            const n = Number(texto)
            if (!Number.isFinite(n) || n <= 0) return setTexto(String(valor))
            if (n !== valor) onSalvar(n)
          }}
          className="h-8 w-24 text-right tabular-nums"
        />
      </dd>
    </div>
  )
}

function CampoBool({
  rotulo, valor, onSalvar, disabled, nota,
}: {
  rotulo: string
  valor: boolean
  onSalvar: (b: boolean) => void
  disabled?: boolean
  nota?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">
        {rotulo}
        {nota ? <span className="block text-xs">{nota}</span> : null}
      </dt>
      <dd>
        <input
          aria-label={rotulo}
          type="checkbox"
          checked={valor}
          disabled={disabled}
          onChange={(e) => onSalvar(e.target.checked)}
        />
      </dd>
    </div>
  )
}

/**
 * Nova regra de comissão.
 *
 * O campo de valor muda de rótulo com o tipo, e isso não é polimento: gravar
 * `valor_por_reuniao` numa regra de originador faz o cálculo não achar o parâmetro,
 * devolver null, e a pessoa simplesmente não receber — sem erro nenhum, sem linha na
 * folha, sem ninguém saber por quê. O schema no core monta o parâmetro certo pelo tipo.
 */
function NovaRegraDialog({
  aberto, onOpenChange, vendedores, onSalvo,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  vendedores: readonly Tables<'vendedores'>[]
  onSalvo: () => void
}) {
  const [tipo, setTipo] = React.useState<TipoVendedorId>('sdr')
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            setSalvando(true)
            setErro(null)
            const r = await salvarRegraAction({
              tipo_vendedor: tipo,
              vendedor_id: String(fd.get('vendedor_id') ?? '') || null,
              valor: Number(fd.get('valor')),
              vigente_de: String(fd.get('vigente_de') ?? '') || undefined,
            })
            setSalvando(false)
            if (!r.ok) return setErro(r.message)
            toast.success('Regra criada. A anterior foi encerrada na véspera.')
            onOpenChange(false)
            onSalvo()
          }}
        >
          <DialogHeader>
            <DialogTitle>Nova regra de comissão</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="tipo_regra">Tipo de vendedor</Label>
              <select
                id="tipo_regra"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoVendedorId)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TIPOS_VENDEDOR.map((t) => (
                  <option key={t} value={t}>{TIPO_VENDEDOR_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendedor_id_regra">Aplicar a</Label>
              <select
                id="vendedor_id_regra"
                name="vendedor_id"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos deste tipo (regra padrão)</option>
                {vendedores.filter((v) => v.tipo === tipo && v.ativo).map((v) => (
                  <option key={v.id} value={v.id}>{v.nome} (override pessoal)</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="valor">{PARAMETRO_DA_REGRA[tipo].rotulo} (R$)</Label>
              <Input id="valor" name="valor" type="number" min={1} step="0.01" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vigente_de">Vigente a partir de</Label>
              <Input
                id="vigente_de"
                name="vigente_de"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              <p className="text-xs text-muted-foreground">
                Competências já apuradas continuam com a regra que valia nelas.
              </p>
            </div>
          </div>
          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Criar regra'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfigComercial() {
  const qc = useQueryClient()
  const dados = useQuery({ queryKey: comercialKeys.config(), queryFn: buscarConfig })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  const [editando, setEditando] = React.useState<Tables<'vendedores'> | null>(null)
  const [abrindoForm, setAbrindoForm] = React.useState(false)
  const [novaRegra, setNovaRegra] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['comercial'] })
  }

  /** Salva UM campo da config. O RPC faz merge, então mandar só o que mudou é seguro. */
  async function salvarCampo(chave: string, valor: Record<string, unknown>) {
    setSalvando(true)
    const r = await salvarConfigAction({ chave, valor })
    setSalvando(false)
    if (!r.ok) return toast.error(r.message)
    toast.success('Configuração salva.')
    recarregar()
  }

  if (dados.isPending || vendedores.isPending) return <Skeleton className="h-96 w-full" />

  const dist = (dados.data?.config.distribuicao ?? {}) as Record<string, unknown>
  const painel = (dados.data?.config.painel ?? {}) as Record<string, unknown>
  const passivos = (dados.data?.config.passivos ?? {}) as Record<string, unknown>
  const comissao = (dados.data?.config.comissao ?? {}) as Record<string, unknown>
  const terrPorVendedor = new Map((dados.data?.territorios ?? []).map((t) => [t.vendedor_id, t]))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Configurações do Comercial</h1>
        <p className="text-sm text-muted-foreground">
          O que decide roteamento, distribuição e pagamento. Toda mudança aqui vai para o
          audit_log — nestas três coisas, escrita sem rastro é como uma comissão muda sem
          ninguém saber.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Distribuição semanal</CardTitle>
            <CardDescription>Segunda de manhã, para SDRs de saída.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Fonte</dt>
                <dd>
                  <select
                    aria-label="Fonte da distribuição"
                    disabled={salvando}
                    value={String(dist.fonte ?? 'som')}
                    onChange={(e) => void salvarCampo('distribuicao', { fonte: e.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {FONTES_DISTRIBUICAO.map((f) => (
                      <option key={f} value={f}>{FONTE_DISTRIBUICAO_LABELS[f as FonteDistribuicao]}</option>
                    ))}
                  </select>
                </dd>
              </div>
              <CampoNumero
                rotulo="Empresas por SDR/semana"
                valor={Number(dist.empresas_por_semana ?? 25)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('distribuicao', { empresas_por_semana: n })}
              />
              <CampoNumero
                rotulo="SLA do lead a contatar (dias)"
                valor={Number(dist.sla_lead_dias ?? 7)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('distribuicao', { sla_lead_dias: n })}
              />
              <CampoNumero
                rotulo="Carência após sem fit (dias)"
                valor={Number(dist.sem_fit_carencia_dias ?? 90)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('distribuicao', { sem_fit_carencia_dias: n })}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Painel e passivos</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <CampoBool
                rotulo="Leaderboard"
                valor={Boolean(painel.leaderboard)}
                disabled={salvando}
                onSalvar={(b) => void salvarCampo('painel', { leaderboard: b })}
              />
              <CampoNumero
                rotulo="Alerta de inatividade (dias úteis)"
                valor={Number(painel.sem_atividade_dias_uteis ?? 5)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('painel', { sem_atividade_dias_uteis: n })}
              />
              <CampoNumero
                rotulo="Passivo: mínimo de antecipações"
                valor={Number(passivos.min_antecipacoes ?? 4)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('passivos', { min_antecipacoes: n })}
              />
              <CampoNumero
                rotulo="Passivo: janela (meses)"
                valor={Number(passivos.janela_meses ?? 2)}
                disabled={salvando}
                onSalvar={(n) => void salvarCampo('passivos', { janela_meses: n })}
              />
              <CampoBool
                rotulo="Estorno de no-show"
                valor={Boolean(comissao.estorno_no_show)}
                disabled={salvando}
                onSalvar={(b) => void salvarCampo('comissao', { estorno_no_show: b })}
                nota="Ligado, o no-show gera lançamento negativo automático."
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Vendedores e territórios</CardTitle>
            <Button size="sm" onClick={() => { setEditando(null); setAbrindoForm(true) }}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Novo vendedor
            </Button>
          </div>
          <CardDescription>
            <strong>Originador</strong> recebe NOTA, por carteira de empresas escolhidas a dedo.
            <strong> Closer</strong> recebe CONTA, por território — UF e faixa de faturamento.
            Território em branco não significa &quot;atende tudo&quot;: vazio é ignorado, senão
            um cadastro incompleto abocanha a base inteira.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {(vendedores.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum vendedor cadastrado ainda.</p>
          ) : (
            <ul className="divide-y">
              {(vendedores.data ?? []).map((v) => {
                const t = terrPorVendedor.get(v.id)
                const s = (v.settings ?? {}) as { direcao?: string; empresas_escolhidas?: string[] }
                return (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={v.ativo ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>
                        {v.nome}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
                      </Badge>
                      {v.is_ia ? <Badge className="text-[10px]">IA</Badge> : null}
                      {s.direcao ? <Badge variant="secondary" className="text-[10px]">{s.direcao}</Badge> : null}
                    </span>
                    <span className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {/*
                        O que se mostra depende do tipo, porque a régua é outra: o
                        originador só tem carteira, e um "sem território" ao lado do nome
                        dele sugeriria um campo faltando que não existe.
                      */}
                      {v.tipo === 'originador'
                        ? (s.empresas_escolhidas ?? []).length > 0
                          ? `${s.empresas_escolhidas?.length} empresa(s) na carteira`
                          : 'carteira vazia — nenhuma nota é roteada'
                        : t && ((t.ufs ?? []).length > 0 || t.faturamento_min || t.faturamento_max)
                          ? `${(t.ufs ?? []).join(', ') || 'todas as UFs'} · ${
                              t.faturamento_min ? brl(t.faturamento_min) : 'sem piso'
                            } → ${t.faturamento_max ? brl(t.faturamento_max) : 'sem teto'}`
                          : 'sem território'}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => { setEditando(v); setAbrindoForm(true) }}>
                      Editar
                    </Button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Regras de comissão</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setNovaRegra(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Nova regra
            </Button>
          </div>
          <CardDescription>
            Regra tem VIGÊNCIA: mudar o valor hoje não reprecifica o que já foi apurado. A
            regra nova encerra a anterior na véspera — cada período tem exatamente uma.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {(dados.data?.regras ?? []).map((r) => {
              const p = (r.parametros ?? {}) as Record<string, unknown>
              const valor =
                p.valor_por_reuniao !== undefined
                  ? `${brl(p.valor_por_reuniao)} por reunião agendada`
                  : `${brl(p.valor_por_milhao)} por milhão`
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {TIPO_VENDEDOR_LABELS[r.tipo_vendedor as TipoVendedorId] ?? r.tipo_vendedor}
                    </Badge>
                    {r.vendedor_id ? <Badge className="text-[10px]">override pessoal</Badge> : null}
                    {valor}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    vigente de {new Date(`${r.vigente_de}T12:00:00`).toLocaleDateString('pt-BR')}
                    {r.vigente_ate ? ` até ${new Date(`${r.vigente_ate}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Motivos de perda</CardTitle>
          <CardDescription>
            Lista fechada de propósito: &quot;outro&quot; com texto livre não vira gráfico.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {(dados.data?.motivos ?? []).map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.ativo ? 'Clique para desativar' : 'Clique para reativar'}
              disabled={salvando}
              onClick={async () => {
                setSalvando(true)
                const r = await salvarMotivoAction({ id: m.id, contexto: m.contexto, motivo: m.motivo, ativo: !m.ativo })
                setSalvando(false)
                if (!r.ok) return toast.error(r.message)
                recarregar()
              }}
            >
              <Badge
                variant={m.contexto === 'sdr_sem_fit' ? 'secondary' : 'outline'}
                className={m.ativo ? 'text-[11px]' : 'text-[11px] line-through opacity-50'}
              >
                {m.motivo}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Motivo inativo continua nas estatísticas antigas — desativar tira da lista de escolha,
        não do histórico.
      </p>

      <VendedorForm
        aberto={abrindoForm}
        onOpenChange={setAbrindoForm}
        vendedor={editando}
        territorio={editando ? (terrPorVendedor.get(editando.id) ?? null) : null}
      />

      <NovaRegraDialog
        aberto={novaRegra}
        onOpenChange={setNovaRegra}
        vendedores={vendedores.data ?? []}
        onSalvo={recarregar}
      />
    </div>
  )
}
