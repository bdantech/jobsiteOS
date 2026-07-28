'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Clock, ExternalLink, Landmark } from 'lucide-react'
import type { Tables } from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Campo } from '@/components/ficha/ficha'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * O cadastro da Receita Federal de um CNPJ, onde quer que ele seja útil.
 *
 * Mora fora de `empresas/` e fora de `antecipacao/` porque os dois precisam da
 * mesma coisa pelo mesmo motivo: decidir se vale trabalhar aquele CNPJ. Capital
 * social, idade e situação cadastral respondem isso em três linhas, e nenhum
 * deles está em `empresas` — a tabela guarda o que O TIME sabe (estágio, ERP,
 * dono), não o que a Receita diz.
 *
 * A fonte é `mercado_universo`, e é de propósito: duplicar capital social em
 * `empresas` criaria duas verdades que divergem no dia em que uma das duas for
 * atualizada. Quem alimenta o universo é o lookup cadastral (Antecipação §3.1) e
 * a ingestão da RFB (Mercado).
 *
 * Ausência é ESTADO, não erro. Um CNPJ que ainda não passou pela fila de lookup
 * não tem linha aqui, e dizer isso é diferente de mostrar um card vazio: o
 * primeiro manda esperar, o segundo sugere que a empresa não tem capital.
 */

const COLUNAS =
  'cnpj, razao_social, capital_social, situacao_cadastral, situacao_data, natureza_juridica, porte_rfb, data_inicio_atividade, opcao_simples, data_exclusao_simples, cnae_principal, uf, municipio, origem_ingestao'

type CadastroUniverso = Pick<
  Tables<'mercado_universo'>,
  | 'cnpj'
  | 'razao_social'
  | 'capital_social'
  | 'situacao_cadastral'
  | 'situacao_data'
  | 'natureza_juridica'
  | 'porte_rfb'
  | 'data_inicio_atividade'
  | 'opcao_simples'
  | 'data_exclusao_simples'
  | 'cnae_principal'
  | 'uf'
  | 'municipio'
  | 'origem_ingestao'
>

export const cadastroKeys = {
  rfb: (cnpj: string) => ['cadastro-rfb', cnpj] as const,
}

export async function buscarCadastroRfb(cnpj: string): Promise<CadastroUniverso | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mercado_universo')
    .select(COLUNAS)
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ─── Formatação ─────────────────────────────────────────────────────────────

const VAZIO = '—'

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

function moeda(valor: number | null): string {
  return valor === null || valor === undefined ? VAZIO : MOEDA.format(valor)
}

function data(iso: string | null): string {
  if (!iso) return VAZIO
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : VAZIO
}

function idadeEmAnos(inicio: string | null): number | null {
  if (!inicio) return null
  const d = new Date(`${inicio.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const hoje = new Date()
  let anos = hoje.getFullYear() - d.getFullYear()
  const antesDoAniversario =
    hoje.getMonth() < d.getMonth() ||
    (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())
  if (antesDoAniversario) anos--
  return anos >= 0 ? anos : null
}

function booleano(valor: boolean | null): string {
  if (valor === null || valor === undefined) return VAZIO
  return valor ? 'Sim' : 'Não'
}

/**
 * A situação cadastral é a única informação aqui que muda uma decisão sozinha:
 * não se antecipa nota de empresa baixada. Por isso ela é badge e não texto.
 */
const SITUACAO_ESTILO: Record<string, string> = {
  ativa: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  suspensa: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  inapta: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  baixada: 'border-destructive/30 bg-destructive/10 text-destructive',
  nula: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function SituacaoCadastralBadge({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span className="text-sm text-muted-foreground">{VAZIO}</span>
  return (
    <Badge variant="outline" className={cn('capitalize', SITUACAO_ESTILO[situacao])}>
      {situacao}
    </Badge>
  )
}

// ─── O card ─────────────────────────────────────────────────────────────────

export function CadastroRfb({ cnpj, comLink = true }: { cnpj: string; comLink?: boolean }) {
  const { data: c, isPending, isError } = useQuery({
    queryKey: cadastroKeys.rfb(cnpj),
    queryFn: () => buscarCadastroRfb(cnpj),
  })

  if (isPending) {
    return (
      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  // Erro e ausência dizem coisas diferentes, e nenhuma das duas é "capital zero".
  if (isError || !c) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cadastro (Receita Federal)</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-2 pt-0 text-sm text-muted-foreground">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {isError
              ? 'Não foi possível carregar o cadastro agora.'
              : 'Ainda não temos o cadastro deste CNPJ. Ele entra na fila de enriquecimento assim que aparece numa nota, e o job diário a consome.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const idade = idadeEmAnos(c.data_inicio_atividade)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-base">Cadastro (Receita Federal)</CardTitle>
            </div>
            <CardDescription>
              {c.origem_ingestao === 'lookup'
                ? 'Enriquecido pela consulta pública de CNPJ.'
                : 'Da ingestão do cadastro nacional.'}
            </CardDescription>
          </div>
          {comLink ? (
            <Link
              href={`/mercado/universo/${c.cnpj}`}
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Ficha completa
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Capital social">
          <span className="tabular-nums">{moeda(c.capital_social)}</span>
        </Campo>
        <Campo label="Situação cadastral">
          <SituacaoCadastralBadge situacao={c.situacao_cadastral} />
        </Campo>
        <Campo label="Porte (RFB)">{c.porte_rfb ?? VAZIO}</Campo>
        <Campo label="Início de atividade">
          {data(c.data_inicio_atividade)}
          {idade !== null ? (
            <span className="ml-1.5 text-muted-foreground">
              ({idade} {idade === 1 ? 'ano' : 'anos'})
            </span>
          ) : null}
        </Campo>
        <Campo label="CNAE principal">{c.cnae_principal ?? VAZIO}</Campo>
        <Campo label="Natureza jurídica">{c.natureza_juridica ?? VAZIO}</Campo>
        <Campo label="Optante do Simples">{booleano(c.opcao_simples)}</Campo>
        {c.data_exclusao_simples ? (
          <Campo label="Saiu do Simples em">{data(c.data_exclusao_simples)}</Campo>
        ) : null}
        {c.situacao_data ? (
          <Campo label="Situação desde">{data(c.situacao_data)}</Campo>
        ) : null}
      </CardContent>
    </Card>
  )
}
