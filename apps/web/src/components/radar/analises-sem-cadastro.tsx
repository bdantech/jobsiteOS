'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarAnalisesSemCadastro, radarKeys } from './queries'

/**
 * "Análise aprovada, nunca cadastrada" — a regra de ouro da fonte (04h §1) virada
 * em lista.
 *
 * `company.id`/`company.name` nulos no payload da análise significam que a empresa
 * passou pela análise de crédito e NUNCA foi cadastrada na plataforma. Não é
 * ex-cliente (nunca foi cliente), e é a prospecção mais quente que existe: a análise
 * foi paga, o crédito saiu, e ninguém operou. Falta só o cadastro.
 *
 * Ordenada por LIMITE, ao contrário da lista de ex-clientes: lá o que esfria é o
 * tempo desde a saída, aqui não há relação passada para esfriar — o que ordena é o
 * tamanho da oportunidade parada.
 */

const brl = (n: number | null) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

function combina(c: { nome: string | null; cnpj: string | null }, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true
  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && (c.cnpj ?? '').includes(digitos)) return true
  return (c.nome ?? '').toLowerCase().includes(t)
}

export function AnalisesSemCadastro({ termo }: { termo: string }) {
  const { data, isPending } = useQuery({
    queryKey: radarKeys.analisesSemCadastro(),
    queryFn: buscarAnalisesSemCadastro,
  })

  if (isPending) return <Skeleton className="h-48 w-full" />

  const todas = data ?? []
  const linhas = todas.filter((c) => combina(c, termo))

  if (todas.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 py-10 text-center text-sm text-muted-foreground">
          <p>Nenhuma análise aprovada sem cadastro.</p>
          {/*
           * A honestidade aqui importa mais que a mensagem genérica: o endpoint de
           * análises passou a NÃO devolver documento sem cadastro na plataforma (CNPJ
           * avulso ou CPF). Enquanto for assim, esta lista fica permanentemente vazia
           * — e "vazio porque não há" é indistinguível de "vazio porque a fonte não
           * conta" para quem só vê a tela.
           */}
          <p className="mx-auto max-w-lg text-xs">
            A fonte deixou de devolver análises de documento sem cadastro na plataforma, então
            esta lista tende a ficar vazia. Ela volta a se encher se a plataforma expuser esses
            casos de novo.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{todas.length}</strong> empresa
          {todas.length > 1 ? 's' : ''} com análise <strong>aprovada</strong> e{' '}
          <strong>sem cadastro</strong> na plataforma. O crédito já saiu e ninguém operou — falta
          o cadastro.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Empresa</th>
              <th className="px-4 py-2 font-medium">Análise</th>
              <th className="px-4 py-2 font-medium">Validade</th>
              <th className="px-4 py-2 text-right font-medium">Limite aprovado</th>
              <th className="px-4 py-2 text-right font-medium">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhuma empresa para “{termo.trim()}”.
                </td>
              </tr>
            )}
            {linhas.map((c) => (
              <tr key={c.cnpj}>
                <td className="max-w-[20rem] px-4 py-3">
                  <p className="truncate font-medium">{c.nome ?? '—'}</p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {c.cnpj ? formatCnpj(c.cnpj) : '—'}
                    {c.uf ? <span className="ml-2 font-sans">{c.municipio ?? ''} / {c.uf}</span> : null}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {/*
                   * Vigente x vencida muda a conversa: com a análise no ar o cadastro
                   * destrava a operação hoje; vencida, é preciso reanalisar (e pagar
                   * de novo). Sem essa distinção a lista prometeria o que não tem.
                   */}
                  {c.vigente ? (
                    <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
                      Vigente
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Vencida
                    </Badge>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">{dataBr(c.expiration_date)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {brl(c.credit_limit)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {c.empresa_id ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/empresas/${c.empresa_id}`}>
                        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Company 360
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/mercado/universo/${c.cnpj}`}>
                        <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Universo
                      </Link>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
