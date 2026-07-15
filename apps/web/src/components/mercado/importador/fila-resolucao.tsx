'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CircleSlash, Loader2, SearchX, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { formatCnpj, isValidCnpj, normalizeCnpj, type MapeamentoImportacao } from '@jobsiteos/core'
import { resolverLinhaAction } from '@/actions/mercado-importacao'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMrrErp, formatScore } from './format'
import { extrairLinha } from './mapeamento'
import { buscarFila, importadorKeys, LIMITE_FILA, type LinhaDaFila } from './queries'

/**
 * A fila de resolução (§5.5).
 *
 * Estas são as linhas que chegaram SEM CNPJ utilizável. O `pg_trgm` sugeriu
 * candidatos do universo, com o score à vista — mas NADA aqui é resolvido
 * automaticamente: um match de 90% entre "CONSTRUTORA SILVA LTDA" e "CONSTRUTORA
 * SILVA S/A" pode ser duas empresas diferentes do mesmo dono, e criar a empresa
 * errada contamina o funil inteiro. Quem decide é o humano.
 *
 * Três saídas para cada linha: escolher um candidato, digitar o CNPJ na mão, ou
 * ignorar. A linha ignorada CONTINUA no banco — rastreabilidade total.
 */

interface FilaResolucaoProps {
  importacaoId: string
  mapeamento: MapeamentoImportacao
  bloqueada: boolean
}

function LinhaDaFilaCard({
  linha,
  mapeamento,
  bloqueada,
  onResolvida,
}: {
  linha: LinhaDaFila
  mapeamento: MapeamentoImportacao
  bloqueada: boolean
  onResolvida: () => Promise<void>
}) {
  const extraida = React.useMemo(
    () => extrairLinha(linha.dados, mapeamento),
    [linha.dados, mapeamento],
  )

  const [escolhido, setEscolhido] = React.useState<string | null>(
    linha.candidatos[0]?.cnpj ?? null,
  )
  const [manual, setManual] = React.useState('')
  const [pendente, setPendente] = React.useState<'resolver' | 'ignorar' | null>(null)

  const cnpjManual = normalizeCnpj(manual)
  const usandoManual = cnpjManual.length > 0
  const manualValido = usandoManual && isValidCnpj(cnpjManual)
  const cnpjEscolhido = usandoManual ? (manualValido ? cnpjManual : null) : escolhido

  async function agir(acao: 'resolver' | 'ignorar') {
    if (pendente || bloqueada) return

    if (acao === 'resolver' && !cnpjEscolhido) {
      toast.error('Escolha um candidato ou informe um CNPJ válido.')
      return
    }

    setPendente(acao)
    try {
      const resultado = await resolverLinhaAction(
        acao === 'ignorar'
          ? { linha_id: linha.id, ignorar: true }
          : { linha_id: linha.id, cnpj: cnpjEscolhido!, ignorar: false },
      )

      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      toast.success(acao === 'ignorar' ? 'Linha ignorada.' : 'Linha resolvida.')
      await onResolvida()
    } catch (erro) {
      console.error('[importador] falha ao resolver a linha', erro)
      toast.error('Não foi possível salvar a decisão.')
    } finally {
      setPendente(null)
    }
  }

  return (
    <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2">
      {/* O que a planilha disse */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{extraida.razao_social ?? 'Linha sem razão social'}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {extraida.uf && <span>UF: {extraida.uf}</span>}
          {extraida.municipio && <span>{extraida.municipio}</span>}
          {extraida.erp_atual && <span>ERP: {extraida.erp_atual}</span>}
          {extraida.erp_mrr !== null && <span>MRR do ERP: {formatMrrErp(extraida.erp_mrr)}</span>}
          {extraida.cnpj_bruto && <span>CNPJ na planilha: {extraida.cnpj_bruto} (inválido)</span>}
        </div>

        <div className="space-y-1.5 pt-2">
          <label
            htmlFor={`cnpj-manual-${linha.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            Ou informe o CNPJ
          </label>
          <Input
            id={`cnpj-manual-${linha.id}`}
            value={manual}
            placeholder="00.000.000/0000-00"
            disabled={bloqueada || pendente !== null}
            onChange={(evento) => setManual(evento.target.value)}
            aria-invalid={usandoManual && !manualValido}
          />
          {usandoManual && !manualValido && (
            <p className="text-xs text-destructive">CNPJ inválido.</p>
          )}
        </div>
      </div>

      {/* Quem o universo acha que ela é */}
      <div className="space-y-2">
        {linha.candidatos.length === 0 ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center">
            <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">
              Nenhum candidato no universo. Informe o CNPJ ou ignore a linha.
            </p>
          </div>
        ) : (
          <fieldset className="space-y-1.5" disabled={bloqueada || usandoManual}>
            <legend className="sr-only">Candidatos do universo</legend>
            {linha.candidatos.map((candidato) => (
              <label
                key={candidato.cnpj}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-2.5 text-sm transition-colors ${
                  escolhido === candidato.cnpj && !usandoManual
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                } ${usandoManual ? 'opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name={`candidato-${linha.id}`}
                  className="mt-1"
                  checked={escolhido === candidato.cnpj && !usandoManual}
                  onChange={() => setEscolhido(candidato.cnpj)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {candidato.razao_social ?? formatCnpj(candidato.cnpj)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatCnpj(candidato.cnpj)}
                    {candidato.municipio ? ` — ${candidato.municipio}` : ''}
                    {candidato.uf ? `/${candidato.uf}` : ''}
                    {candidato.situacao_cadastral ? ` — ${candidato.situacao_cadastral}` : ''}
                  </span>
                </span>
                <Badge variant="outline" className="shrink-0 gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {formatScore(candidato.score)}
                </Badge>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={bloqueada || pendente !== null}
            onClick={() => void agir('ignorar')}
          >
            {pendente === 'ignorar' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CircleSlash className="mr-2 h-4 w-4" aria-hidden />
            )}
            Ignorar
          </Button>
          <Button
            size="sm"
            disabled={bloqueada || pendente !== null || !cnpjEscolhido}
            onClick={() => void agir('resolver')}
          >
            {pendente === 'resolver' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Check className="mr-2 h-4 w-4" aria-hidden />
            )}
            Resolver
          </Button>
        </div>
      </div>
    </div>
  )
}

export function FilaResolucao({ importacaoId, mapeamento, bloqueada }: FilaResolucaoProps) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: importadorKeys.fila(importacaoId),
    queryFn: () => buscarFila(importacaoId),
  })

  const atualizar = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: importadorKeys.fila(importacaoId) }),
      queryClient.invalidateQueries({ queryKey: importadorKeys.contadores(importacaoId) }),
    ])
  }, [queryClient, importacaoId])

  const linhas = query.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fila de resolução</CardTitle>
        <CardDescription>
          Linhas sem CNPJ. Os candidatos vêm da busca por similaridade de razão social (e UF, quando
          a planilha traz) contra o universo da Receita — o score é o quanto os nomes se parecem,
          não uma certeza.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending && (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </>
        )}

        {query.isError && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Não foi possível carregar a fila</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {query.error instanceof Error ? query.error.message : 'Erro desconhecido.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {query.isSuccess && linhas.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-muted p-3">
              <Check className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Nada para revisar</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Todas as linhas foram resolvidas ou ignoradas. Você já pode aplicar a importação.
              </p>
            </div>
          </div>
        )}

        {query.isSuccess &&
          linhas.map((linha) => (
            <LinhaDaFilaCard
              key={linha.id}
              linha={linha}
              mapeamento={mapeamento}
              bloqueada={bloqueada}
              onResolvida={atualizar}
            />
          ))}

        {query.isSuccess && linhas.length === LIMITE_FILA && (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            Mostrando as primeiras {LIMITE_FILA} linhas da fila. Resolva estas e as próximas
            aparecem.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
