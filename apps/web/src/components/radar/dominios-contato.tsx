'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Check, Globe } from 'lucide-react'
import {
  CASO_DOMINIO_LABELS,
  formatCnpj,
  sugerirDominiosPorContato,
  type CasoDominio,
  type SugestaoDominio,
} from '@jobsiteos/core'
import { atualizarEmpresaAction } from '@/actions/empresas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { radarKeys } from './queries'

/**
 * O que os e-mails dos contatos dizem sobre o domínio da empresa.
 *
 * O domínio é a unidade de consulta do Apollo: contatos e headcount são pedidos POR
 * DOMÍNIO. Uma empresa sem ele é uma empresa que os dois enriquecimentos só sabem
 * recusar — e o e-mail que resolveria isso muitas vezes já está gravado num contato,
 * sem ninguém ter lido.
 *
 * NÃO é automático, e isso é o desenho, não uma etapa que faltou. Medido na base: das
 * quatro divergências reais, uma é uma construtora cujo contato usa o domínio da marca
 * de vendas — os dois domínios estão certos, cada um para uma coisa, e adotar o do
 * e-mail seria trocar o correto pelo comercial. Uma rotina que "equaliza tudo" acerta
 * três e estraga a quarta em silêncio; a decisão fica com quem conhece a empresa.
 */

/** O teto existe para a página não morrer calada; se for atingido, ela avisa. */
const LIMITE_CONTATOS = 10_000

interface EmpresaSugerida extends SugestaoDominio {
  cnpj: string | null
  razaoSocial: string | null
  nomeFantasia: string | null
  dominioOrigem: string | null
  dominioConfianca: string | null
}

interface Resultado {
  sugestoes: EmpresaSugerida[]
  contatosLidos: number
  truncado: boolean
}

async function buscarSugestoes(): Promise<Resultado> {
  const supabase = createClient()
  // Embed pela FK empresa_id: uma ida só. A RLS decide o que volta — quem não enxerga a
  // empresa não recebe o e-mail dela por este caminho.
  const { data, error } = await supabase
    .from('contatos')
    .select(
      'empresa_id, email, empresas(id, cnpj, razao_social, nome_fantasia, dominio, dominio_origem, dominio_confianca)',
    )
    .not('email', 'is', null)
    .limit(LIMITE_CONTATOS)
  if (error) throw new Error(error.message)

  type Empresa = {
    id: string
    cnpj: string | null
    razao_social: string | null
    nome_fantasia: string | null
    dominio: string | null
    dominio_origem: string | null
    dominio_confianca: string | null
  }
  type Raw = { empresa_id: string | null; email: string | null; empresas: Empresa | null }

  const linhas = (data ?? []) as unknown as Raw[]
  const empresas = new Map<string, Empresa>()
  for (const l of linhas) if (l.empresas) empresas.set(l.empresas.id, l.empresas)

  const sugestoes = sugerirDominiosPorContato(
    linhas
      .filter((l) => l.empresa_id !== null)
      .map((l) => ({ empresaId: l.empresa_id as string, email: l.email })),
    [...empresas.values()].map((e) => ({ id: e.id, dominio: e.dominio })),
  )

  const ordem: Record<CasoDominio, number> = { malformado: 0, divergente: 1, ausente: 2 }

  return {
    contatosLidos: linhas.length,
    truncado: linhas.length >= LIMITE_CONTATOS,
    sugestoes: sugestoes
      .map((s) => {
        const e = empresas.get(s.empresaId)
        return {
          ...s,
          cnpj: e?.cnpj ?? null,
          razaoSocial: e?.razao_social ?? null,
          nomeFantasia: e?.nome_fantasia ?? null,
          dominioOrigem: e?.dominio_origem ?? null,
          dominioConfianca: e?.dominio_confianca ?? null,
        }
      })
      // Primeiro o que está quebrado, depois o que é decisão, por último o volume.
      .sort(
        (a, b) =>
          ordem[a.caso] - ordem[b.caso] ||
          b.contatosSugerido - a.contatosSugerido ||
          (a.razaoSocial ?? '').localeCompare(b.razaoSocial ?? ''),
      ),
  }
}

const CASO_BADGE: Record<CasoDominio, string> = {
  malformado: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200',
  divergente: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  ausente: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200',
}

export function DominiosContato({ podeVerEmpresas }: { podeVerEmpresas: boolean }) {
  const qc = useQueryClient()
  const [adotando, setAdotando] = React.useState<string | null>(null)

  const { data, isPending, isError, error } = useQuery({
    queryKey: [...radarKeys.all, 'dominios-contato'],
    queryFn: buscarSugestoes,
    enabled: podeVerEmpresas,
  })

  if (!podeVerEmpresas) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Esta tela lê os e-mails dos contatos, que exigem o módulo <strong>Empresas</strong>.
            Sem ele a lista viria vazia — e uma lista vazia aqui parece uma base limpa.
          </p>
        </CardContent>
      </Card>
    )
  }

  async function adotar(s: EmpresaSugerida) {
    setAdotando(s.empresaId)
    const r = await atualizarEmpresaAction({ id: s.empresaId, dominio: s.sugerido })
    setAdotando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    // O write helper 0038 marca `dominio_origem = 'manual'`, e a cascata do Radar não
    // sobrescreve manual — a decisão sobrevive ao próximo lote de domínio.
    toast.success(`Domínio de ${s.razaoSocial ?? 'empresa'}: ${s.sugerido}.`)
    void qc.invalidateQueries({ queryKey: [...radarKeys.all, 'dominios-contato'] })
  }

  if (isPending) return <Skeleton className="h-64 w-full rounded-lg" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar as sugestões.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const porCaso = (c: CasoDominio) => data.sugestoes.filter((s) => s.caso === c).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Domínios pelos contatos</CardTitle>
        <CardDescription>
          O domínio é a unidade de consulta do Apollo — contatos e headcount são pedidos por
          domínio. Aqui estão as empresas cujos <strong>e-mails de contato</strong> discordam do
          domínio salvo (ou o preenchem, quando não há nenhum). Provedores genéricos como Gmail
          e Hotmail são ignorados: não dizem nada sobre a empresa.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['malformado', 'divergente', 'ausente'] as const).map((c) => (
            <Badge key={c} className={cn('text-[11px]', CASO_BADGE[c])}>
              {CASO_DOMINIO_LABELS[c]}: {porCaso(c)}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          <strong>Adotar não é automático de propósito.</strong> Domínio diferente nem sempre é
          domínio errado: uma construtora cujo contato escreve pelo domínio da marca de vendas
          tem os dois corretos, cada um para uma coisa. Uma rotina que equalizasse tudo acertaria
          a maioria e estragaria essas em silêncio. O que for adotado aqui fica marcado como
          <em> manual</em>, e a cascata do Radar não sobrescreve manual.
        </p>

        {data.truncado && (
          <p className="text-xs text-destructive">
            Foram lidos os primeiros {LIMITE_CONTATOS.toLocaleString('pt-BR')} contatos — há mais
            além deste teto, e o que ficou de fora não está nesta lista.
          </p>
        )}

        {data.sugestoes.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Globe className="mx-auto mb-2 h-5 w-5" aria-hidden />
            <p className="font-medium text-foreground">Nenhuma divergência.</p>
            <p className="mt-1">
              Todo contato com e-mail corporativo bate com o domínio salvo da empresa dele.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Caso</TableHead>
                  <TableHead>Domínio salvo</TableHead>
                  <TableHead>Pelos contatos</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sugestoes.map((s) => (
                  <TableRow key={s.empresaId}>
                    <TableCell className="max-w-[22rem]">
                      <Link
                        href={`/empresas/${s.empresaId}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {s.razaoSocial ?? s.nomeFantasia ?? 'Empresa'}
                      </Link>
                      {s.cnpj ? (
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCnpj(s.cnpj)}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <Badge className={cn('whitespace-nowrap text-[11px]', CASO_BADGE[s.caso])}>
                        {CASO_DOMINIO_LABELS[s.caso]}
                      </Badge>
                    </TableCell>

                    <TableCell className="align-top">
                      {s.dominioAtual ? (
                        <>
                          <p className="font-mono text-xs">{s.dominioAtual}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {s.dominioOrigem ?? '—'}
                            {s.dominioConfianca ? ` · ${s.dominioConfianca}` : ''}
                            {` · ${s.contatosNoAtual} contato(s)`}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      <p className="flex items-center gap-1.5 font-mono text-xs">
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                        {s.sugerido}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.contatosSugerido} contato(s)
                        {s.candidatos.length > 1
                          ? ` · outros: ${s.candidatos
                              .slice(1)
                              .map((c) => c.dominio)
                              .join(', ')}`
                          : ''}
                      </p>
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={adotando !== null}
                        onClick={() => void adotar(s)}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                        {adotando === s.empresaId ? 'Adotando…' : 'Adotar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
