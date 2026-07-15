'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { CAMPO_IMPORTACAO_LABELS, type MapeamentoImportacao } from '@jobsiteos/core'
import { gerarUrlDownloadAction } from '@/actions/mercado-importacao'
import { STATUS_SUPERFICIE, STATUS_TEXTO } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AplicarImportacao } from './aplicar-importacao'
import { FilaResolucao } from './fila-resolucao'
import { formatDataHora, formatNumero } from './format'
import { buscarContadores, importadorKeys, type Importacao } from './queries'
import { StatusImportacaoBadge } from './status-badge'

/**
 * A tela de uma importação depois do mapeamento: os números, a fila e o botão de
 * aplicar.
 *
 * Os contadores são a única fonte de verdade sobre o lote — vêm de `count` sobre
 * `importacoes_linhas`, não de um cache na linha da importação. Uma linha
 * resolvida na fila muda o número aqui na hora seguinte.
 */

interface ImportacaoDetalheProps {
  importacao: Importacao
  mapeamento: MapeamentoImportacao
}

function Metrica({
  titulo,
  valor,
  descricao,
  destaque,
}: {
  titulo: string
  valor: string
  descricao: string
  destaque?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
        <p className={`text-2xl font-semibold ${destaque ?? ''}`}>{valor}</p>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </CardContent>
    </Card>
  )
}

function BotaoDownload({ importacaoId }: { importacaoId: string }) {
  const [gerando, setGerando] = React.useState(false)

  async function baixar() {
    if (gerando) return
    setGerando(true)

    try {
      const resultado = await gerarUrlDownloadAction(importacaoId)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      // O bucket é privado: o que se abre é uma URL assinada de vida curta, gerada
      // sob demanda no servidor. Nunca uma URL pública.
      window.open(resultado.data.url, '_blank', 'noopener,noreferrer')
    } catch (erro) {
      console.error('[importador] falha ao gerar o link do arquivo', erro)
      toast.error('Não foi possível gerar o link do arquivo.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <Button variant="outline" disabled={gerando} onClick={() => void baixar()}>
      {gerando ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Download className="mr-2 h-4 w-4" aria-hidden />
      )}
      Arquivo original
    </Button>
  )
}

export function ImportacaoDetalhe({ importacao, mapeamento }: ImportacaoDetalheProps) {
  const contadores = useQuery({
    queryKey: importadorKeys.contadores(importacao.id),
    queryFn: () => buscarContadores(importacao.id),
  })

  const concluida = importacao.status === 'concluida'

  const colunasMapeadas = Object.entries(mapeamento).filter(([, campo]) => campo !== null)

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/mercado/importacoes">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Importações
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{importacao.nome}</h1>
              <StatusImportacaoBadge status={importacao.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              Criada em {formatDataHora(importacao.criado_em)} — {colunasMapeadas.length} colunas
              mapeadas.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <BotaoDownload importacaoId={importacao.id} />
            {!concluida && (
              <AplicarImportacao
                importacaoId={importacao.id}
                totalResolvidas={contadores.data?.resolvidas ?? 0}
                aRevisar={contadores.data?.aRevisar ?? 0}
                desabilitado={contadores.isPending}
              />
            )}
          </div>
        </div>
      </div>

      {concluida && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-lg border p-4 text-sm',
            STATUS_SUPERFICIE.success,
          )}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Importação concluída</p>
            <p>
              As linhas resolvidas viraram empresas com origem <span className="font-mono">lista</span>
              . Elas estão em{' '}
              <Link href="/empresas" className="underline">
                Empresas
              </Link>{' '}
              e no Explorador do Mercado.
            </p>
          </div>
        </div>
      )}

      {contadores.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {contadores.isError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-medium">Não foi possível carregar os contadores</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {contadores.error instanceof Error ? contadores.error.message : 'Erro desconhecido.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void contadores.refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {contadores.isSuccess && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metrica
            titulo="Linhas"
            valor={formatNumero(contadores.data.total)}
            descricao="Toda linha da planilha virou uma linha aqui."
          />
          <Metrica
            titulo="Resolvidas"
            valor={formatNumero(contadores.data.resolvidas)}
            descricao="Com CNPJ — entram em Empresas ao aplicar."
            destaque={STATUS_TEXTO.success}
          />
          <Metrica
            titulo="A revisar"
            valor={formatNumero(contadores.data.aRevisar)}
            descricao="Sem CNPJ. Esperam uma decisão humana."
            destaque={STATUS_TEXTO.warning}
          />
          <Metrica
            titulo="Ignoradas"
            valor={formatNumero(contadores.data.ignoradas)}
            descricao="Duplicadas no arquivo ou descartadas na revisão."
          />
        </div>
      )}

      {contadores.isSuccess && contadores.data.aRevisar > 0 && (
        <FilaResolucao
          importacaoId={importacao.id}
          mapeamento={mapeamento}
          bloqueada={concluida}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mapeamento usado</CardTitle>
          <CardDescription>
            A tradução entre as colunas da planilha e os campos da base — o registro de como os
            dados chegaram aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {colunasMapeadas.map(([coluna, campo]) => (
              <div key={coluna} className="flex items-baseline justify-between gap-2 border-b py-1.5">
                <dt className="truncate text-sm text-muted-foreground" title={coluna}>
                  {coluna}
                </dt>
                <dd className="shrink-0 text-sm font-medium">
                  {campo ? CAMPO_IMPORTACAO_LABELS[campo] : '—'}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
