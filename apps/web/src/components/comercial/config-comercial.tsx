'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarClock, Plus } from 'lucide-react'
import {
  FONTES_DISTRIBUICAO, FONTE_DISTRIBUICAO_LABELS,
  TIPO_VENDEDOR_LABELS, type FonteDistribuicao, type TipoVendedorId, type Tables,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { salvarConfigAction, salvarMotivoAction } from '@/actions/comercial'
import { buscarVendedores, comercialKeys } from './queries'
import { VendedorForm } from './vendedor-form'
import { Parametros } from './comissao/parametros'
import { ConfigFornecedores } from './fornecedores/config'

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
  const [config, territorios, motivos] = await Promise.all([
    supabase.from('comercial_config').select('chave, valor'),
    supabase.from('vendedor_territorios').select('*'),
    supabase.from('motivos_perda').select('*').order('contexto').order('ordem'),
  ])
  return {
    config: Object.fromEntries((config.data ?? []).map((c) => [c.chave, c.valor as Record<string, unknown>])),
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

export function ConfigComercial() {
  const qc = useQueryClient()
  const dados = useQuery({ queryKey: comercialKeys.config(), queryFn: buscarConfig })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })
  const [editando, setEditando] = React.useState<Tables<'vendedores'> | null>(null)
  const [abrindoForm, setAbrindoForm] = React.useState(false)
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
            <strong> Closer</strong> recebe CONTA, por território — UF e faixa de faturamento — e
            ainda carrega uma carteira de contas passivas, cujo volume é a comissão dele.
            Território em branco não significa &quot;atende tudo&quot;: vazio é ignorado, senão
            um cadastro incompleto abocanha a base inteira.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {(vendedores.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum vendedor cadastrado ainda.</p>
          ) : (
            /*
             * Tabela de verdade, não linhas de flex.
             *
             * Com `justify-between` cada linha se alinhava sozinha: nome curto empurrava o
             * território para a esquerda, nome longo para a direita, e os "Editar" ficavam
             * numa diagonal. Colunas fixas fazem a coluna do meio ser comparável de linha
             * em linha, que é a única razão de existir uma lista assim.
             *
             * `overflow-x-auto` no wrapper: em telas estreitas quem rola é a tabela, nunca
             * a página inteira.
             */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-normal">Nome</th>
                    <th scope="col" className="px-3 py-2 font-normal">Tipo</th>
                    <th scope="col" className="px-3 py-2 font-normal">Território ou carteira</th>
                    <th scope="col" className="w-16 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(vendedores.data ?? []).map((v) => {
                    const t = terrPorVendedor.get(v.id)
                    const s = (v.settings ?? {}) as { direcao?: string; empresas_escolhidas?: string[] }
                    return (
                      <tr key={v.id} className="align-middle">
                        <td className="px-3 py-2">
                          <span className={v.ativo ? 'font-medium' : 'font-medium text-muted-foreground line-through'}>
                            {v.nome}
                          </span>
                          {v.is_ia ? <Badge className="ml-2 text-[10px]">IA</Badge> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
                          </Badge>
                          {s.direcao ? (
                            <Badge variant="secondary" className="ml-1 text-[10px]">{s.direcao}</Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {/*
                            O que se mostra depende do tipo, porque a régua é outra: o
                            originador só tem carteira, e um "sem território" ao lado do
                            nome dele sugeriria um campo faltando que não existe.
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
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => { setEditando(v); setAbrindoForm(true) }}>
                            Editar
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        Regras de comissão = os PARÂMETROS do motor v2 (04k §7.5). As `comissao_regras`
        do 04g continuam no banco como histórico read-only e NÃO têm tela: editá-las não
        teria efeito nenhum sobre a folha, e deixar o formulário antigo aqui só ensinaria
        alguém a mexer no lugar errado.
      */}
      <Parametros vendedores={vendedores.data ?? []} />

      {/*
        O relógio mora em tela própria, e não aqui dentro, porque ele é uma LISTA — uma
        linha por cliente, com edição — e os parâmetros são um catálogo de vinte e três
        números. Empilhar as duas coisas faria a tela de regras abrir rolando.
      */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4" aria-hidden />
            Relógio das contas
          </CardTitle>
          <CardDescription>
            Os parâmetros acima dizem quantos meses dura cada fase. Esta lista diz quando o
            relógio de cada conta começou a contar — e deixa corrigir a data ou fixar a fase à
            mão, recalculando a comissão do mês aberto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/comercial/admin/contas">Abrir lista de contas</Link>
          </Button>
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

      {/*
        Funil de cadastro de fornecedores (04l §7). As CREDENCIAIS não estão lá: usuário,
        senha e cliente da Nova Vida e a chave do Google Places vivem só em variável de
        ambiente do worker. `fornecedores_config` é lida por `authenticated` para que o
        card mostre o custo do clique — pôr uma credencial nela seria distribuí-la a todo
        mundo que tem o módulo.
      */}
      <ConfigFornecedores />

      <VendedorForm
        aberto={abrindoForm}
        onOpenChange={setAbrindoForm}
        vendedor={editando}
        territorio={editando ? (terrPorVendedor.get(editando.id) ?? null) : null}
        vendedores={vendedores.data ?? []}
      />

    </div>
  )
}
