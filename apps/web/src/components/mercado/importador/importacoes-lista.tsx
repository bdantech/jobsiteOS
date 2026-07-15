'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileSpreadsheet, ListChecks } from 'lucide-react'
import { STATUS_TEXTO } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDataHora, formatNumero } from './format'
import { NovaImportacaoDialog } from './nova-importacao-dialog'
import { buscarContadores, buscarImportacoes, importadorKeys } from './queries'
import { StatusImportacaoBadge } from './status-badge'

const COLUNAS = 6

/**
 * Contadores de UMA importação, em sua própria query.
 *
 * Cada linha da tabela busca as suas contagens (quatro `count` com `head: true`,
 * que o Postgres resolve pelo índice sem trafegar linha nenhuma). Assim cada
 * linha tem o seu próprio estado de carregamento, e uma importação de 20 mil
 * linhas não segura a renderização da lista inteira.
 */
function Contadores({ importacaoId, status }: { importacaoId: string; status: string }) {
  const query = useQuery({
    queryKey: importadorKeys.contadores(importacaoId),
    queryFn: () => buscarContadores(importacaoId),
    staleTime: 15_000,
  })

  if (query.isPending) return <Skeleton className="h-4 w-32" />
  if (query.isError) return <span className="text-xs text-muted-foreground">—</span>

  const { total, resolvidas, aRevisar, ignoradas } = query.data

  if (total === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {status === 'mapeando' ? 'Aguardando mapeamento' : 'Sem linhas'}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-medium">{formatNumero(total)} linhas</span>
      {/* Mesmo canal de status das badges: verde = resolvido, âmbar = espera gente.
          O número vem sempre com a palavra — a cor não carrega o significado sozinha. */}
      <span className={STATUS_TEXTO.success}>{formatNumero(resolvidas)} resolvidas</span>
      {aRevisar > 0 && (
        <span className={STATUS_TEXTO.warning}>{formatNumero(aRevisar)} a revisar</span>
      )}
      {ignoradas > 0 && (
        <span className="text-muted-foreground">{formatNumero(ignoradas)} ignoradas</span>
      )}
    </div>
  )
}

function LinhasCarregando() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: COLUNAS }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function Vazio() {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-muted p-3">
            <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Nenhuma lista importada ainda</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Listas de prospecção são pré-qualificadas: elas pulam o staging do Mercado e entram
              direto em Empresas, com o ERP atual, o MRR do ERP e os contatos que vieram na planilha.
            </p>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

function Erro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUNAS} className="h-64">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Não foi possível carregar as importações</p>
            <p className="max-w-md text-sm text-muted-foreground">{mensagem}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onTentar}>
            Tentar novamente
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ImportacoesLista() {
  const query = useQuery({
    queryKey: importadorKeys.lista(),
    queryFn: buscarImportacoes,
  })

  const importacoes = query.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Importador de listas</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Suba uma planilha de prospecção, diga o que é cada coluna e revise as linhas sem CNPJ. O
            que for resolvido entra direto em Empresas — com <strong>MRR do ERP</strong> (o que a
            empresa paga hoje pelo ERP que usa), contatos e sinal de churn no concorrente.
          </p>
        </div>
        <NovaImportacaoDialog />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lista</TableHead>
              <TableHead className="w-[10rem]">Status</TableHead>
              <TableHead>Linhas</TableHead>
              <TableHead className="w-[12rem]">Criada por</TableHead>
              <TableHead className="w-[11rem]">Criada em</TableHead>
              <TableHead className="w-[7rem] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending && <LinhasCarregando />}

            {query.isError && (
              <Erro
                mensagem={
                  query.error instanceof Error
                    ? query.error.message
                    : 'Erro desconhecido ao consultar o banco.'
                }
                onTentar={() => void query.refetch()}
              />
            )}

            {query.isSuccess && importacoes.length === 0 && <Vazio />}

            {query.isSuccess &&
              importacoes.map((importacao) => (
                <TableRow key={importacao.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/mercado/importacoes/${importacao.id}`}
                      className="hover:underline"
                    >
                      {importacao.nome}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusImportacaoBadge status={importacao.status} />
                  </TableCell>
                  <TableCell>
                    <Contadores importacaoId={importacao.id} status={importacao.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {importacao.criado_por_nome ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDataHora(importacao.criado_em)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/mercado/importacoes/${importacao.id}`}>
                        <ListChecks className="mr-2 h-4 w-4" aria-hidden />
                        Abrir
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
