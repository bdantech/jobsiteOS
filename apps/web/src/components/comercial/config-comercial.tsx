'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FONTE_DISTRIBUICAO_LABELS, ORIGEM_LANCAMENTO_LABELS, PAPEL_CARTEIRA_LABELS,
  TIPO_VENDEDOR_LABELS, type FonteDistribuicao, type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { buscarVendedores, comercialKeys } from './queries'

/**
 * Configurações do Comercial — LEITURA nesta versão.
 *
 * Mostrar antes de deixar editar é deliberado: as três coisas desta tela (quem vende,
 * qual território, quanto paga) são exatamente as que, mal preenchidas, fazem o
 * roteamento entregar nota errada e a comissão pagar valor errado. E as duas primeiras
 * já têm RPC de escrita (`app_definir_carteira`) usada pela ficha da empresa.
 *
 * O que falta aqui é o CRUD de vendedor e de regra, e ele fica de fora com o mesmo
 * critério do resto do sistema: escrita passa por RPC com auditoria, e cadastrar
 * vendedor pela tela sem isso seria a única porta do módulo sem rastro. Enquanto isso,
 * o cadastro é por migração/SQL — que é auditável e raro (um vendedor novo por mês, não
 * por hora).
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

export function ConfigComercial() {
  const dados = useQuery({ queryKey: comercialKeys.config(), queryFn: buscarConfig })
  const vendedores = useQuery({ queryKey: comercialKeys.vendedores(), queryFn: buscarVendedores })

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
          O que decide roteamento, distribuição e pagamento. Alterações são por migração —
          escrita sem rastro nestas três coisas é como uma comissão muda sem ninguém saber.
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
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Fonte</dt>
                <dd>{FONTE_DISTRIBUICAO_LABELS[String(dist.fonte) as FonteDistribuicao] ?? String(dist.fonte)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Empresas por SDR/semana</dt>
                <dd className="tabular-nums">{String(dist.empresas_por_semana ?? '—')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">SLA do lead a contatar</dt>
                <dd className="tabular-nums">{String(dist.sla_lead_dias ?? '—')} dias</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Carência após &quot;sem fit&quot;</dt>
                <dd className="tabular-nums">{String(dist.sem_fit_carencia_dias ?? '—')} dias</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Painel e passivos</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Leaderboard</dt>
                <dd>{painel.leaderboard ? 'Ligado' : 'Desligado'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Alerta de inatividade</dt>
                <dd className="tabular-nums">{String(painel.sem_atividade_dias_uteis ?? '—')} dias úteis</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Passivo: mínimo de antecipações</dt>
                <dd className="tabular-nums">{String(passivos.min_antecipacoes ?? '—')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Passivo: janela</dt>
                <dd className="tabular-nums">{String(passivos.janela_meses ?? '—')} meses</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Estorno de no-show</dt>
                <dd>{comissao.estorno_no_show ? 'Ligado' : 'Desligado'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vendedores e territórios</CardTitle>
          <CardDescription>
            Território em branco NÃO significa &quot;atende tudo&quot;: o roteador ignora
            território vazio, senão um cadastro incompleto abocanharia a base inteira.
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
                    <span className="text-xs text-muted-foreground">
                      {t && ((t.ufs ?? []).length > 0 || t.faturamento_min || t.faturamento_max)
                        ? `${(t.ufs ?? []).join(', ') || 'todas as UFs'} · ${
                            t.faturamento_min ? brl(t.faturamento_min) : 'sem piso'
                          } → ${t.faturamento_max ? brl(t.faturamento_max) : 'sem teto'}`
                        : 'sem território'}
                      {(s.empresas_escolhidas ?? []).length > 0
                        ? ` · ${s.empresas_escolhidas?.length} na carteira explícita`
                        : ''}
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
          <CardTitle className="text-base">Regras de comissão</CardTitle>
          <CardDescription>
            Regra tem VIGÊNCIA: mudar o valor hoje não reprecifica o que já foi apurado.
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
            <Badge key={m.id} variant={m.contexto === 'sdr_sem_fit' ? 'secondary' : 'outline'} className="text-[11px]">
              {m.motivo}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Papéis de carteira: {Object.values(PAPEL_CARTEIRA_LABELS).join(' · ')}. Origens de lançamento:{' '}
        {Object.values(ORIGEM_LANCAMENTO_LABELS).join(' · ')}.
      </p>
    </div>
  )
}
