'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Factory, UserPlus } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { promoverFornecedorAction } from '@/actions/antecipacao'
import { cn } from '@/lib/utils'
import { formatarData, formatarInteiro, formatarMoeda } from './format'
import {
  LIMITE_PROSPECTAR_FORNECEDORES,
  antecipacaoKeys,
  buscarFornecedoresAProspectar,
  type FornecedorProspectar,
} from './queries'
import {
  localDe,
  ordenarFornecedoresProspectar,
  situacaoPreocupa,
  usePreferenciasFornecedoresProspectar,
} from './fornecedores-prospectar-tabela'
import { CabecalhoOrdenavel } from './tabela-ordenavel'

/**
 * Fornecedores a prospectar — quem emite para os sacados que JÁ são nossos e ainda
 * não está na plataforma.
 *
 * É a lista de "sacados a prospectar" com o funil invertido, e o que qualifica o
 * lead aqui é o outro lado da nota: o sacado já ser cadastrado significa relação
 * conhecida, limite analisado, e alguém que atende quando o vendedor liga citando o
 * nome dele. Não há filtro de CNAE — não é o setor do fornecedor que diz se ele é
 * oportunidade, é contra quem ele emite.
 *
 * Ranqueado por NÚMERO DE NOTAS, não por valor: quem emite 40 notas no trimestre
 * para uma construtora nossa tem fluxo recorrente para antecipar. Uma nota grande e
 * única é um evento, não uma carteira.
 *
 * A janela de 90 dias vive na view (0101) e não é ajustável na tela — a lista é
 * sobre quem está emitindo agora.
 */
export function FornecedoresProspectar() {
  const qc = useQueryClient()
  const [promovendo, setPromovendo] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.prospectarFornecedores(),
    queryFn: buscarFornecedoresAProspectar,
  })

  const { prefs, ordenarPor } = usePreferenciasFornecedoresProspectar()

  const linhas = React.useMemo(
    () => (data ? ordenarFornecedoresProspectar(data, prefs.coluna, prefs.dir) : []),
    [data, prefs.coluna, prefs.dir],
  )

  /**
   * Promover é a mesma porta manual da ficha do fornecedor: fornecedor de aquisição
   * não vira `empresas` no sync, e é este clique que cria contatos, timeline e
   * toques para ele. `promoverFornecedorAction` (e não a de Mercado) porque o
   * público desta tela é o Comercial, que só tem o módulo `antecipacao`.
   */
  async function promover(cnpj: string) {
    setPromovendo(cnpj)
    const r = await promoverFornecedorAction(cnpj)
    setPromovendo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Fornecedor promovido — agora ele tem ficha, contatos e histórico.')
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.prospectarFornecedores() })
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const totalNotas = data.reduce((s, f) => s + Number(f.notas ?? 0), 0)
  const totalValor = data.reduce((s, f) => s + Number(f.valor_agregado ?? 0), 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">Fornecedores a prospectar</CardTitle>
          </div>
          <CardDescription>
            Quem emitiu NF nos <strong>últimos 90 dias</strong> contra sacados que{' '}
            <strong>já estão</strong> na plataforma e ainda <strong>não está</strong>. Ordenado por
            número de notas — clique em qualquer cabeçalho para reordenar.
            {data.length > 0 ? (
              <>
                {' '}
                {formatarInteiro(data.length)} fornecedor{data.length > 1 ? 'es' : ''} somando{' '}
                {formatarInteiro(totalNotas)} notas e {formatarMoeda(totalValor)}.
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <CabecalhoOrdenavel coluna="nome" ativa={prefs.coluna} dir={prefs.dir} onClick={ordenarPor}>
                    Fornecedor
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel coluna="cnae" ativa={prefs.coluna} dir={prefs.dir} onClick={ordenarPor}>
                    CNAE
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel coluna="local" ativa={prefs.coluna} dir={prefs.dir} onClick={ordenarPor}>
                    Local
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel
                    coluna="notas"
                    ativa={prefs.coluna}
                    dir={prefs.dir}
                    onClick={ordenarPor}
                    className="text-right"
                    title="Notas emitidas contra sacados cadastrados nos últimos 90 dias."
                  >
                    Notas
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel
                    coluna="operaveis"
                    ativa={prefs.coluna}
                    dir={prefs.dir}
                    onClick={ordenarPor}
                    className="text-right"
                    title="Quantas dessas notas passam na regra de natureza de operação. Zero é um lead que a operação não consegue atender."
                  >
                    Operáveis
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel
                    coluna="sacados"
                    ativa={prefs.coluna}
                    dir={prefs.dir}
                    onClick={ordenarPor}
                    className="text-right"
                    title="Sacados cadastrados distintos contra os quais ele emite — cada um é uma porta de entrada."
                  >
                    Sacados
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel
                    coluna="valor"
                    ativa={prefs.coluna}
                    dir={prefs.dir}
                    onClick={ordenarPor}
                    className="text-right"
                  >
                    Valor emitido
                  </CabecalhoOrdenavel>
                  <CabecalhoOrdenavel
                    coluna="ultimaNota"
                    ativa={prefs.coluna}
                    dir={prefs.dir}
                    onClick={ordenarPor}
                  >
                    Última nota
                  </CabecalhoOrdenavel>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      Nenhum fornecedor nesta condição nos últimos 90 dias. A lista se enche quando
                      o sync trouxer notas emitidas contra sacados já cadastrados por um CNPJ que
                      ainda não está na plataforma.
                    </TableCell>
                  </TableRow>
                )}

                {linhas.map((f: FornecedorProspectar) => (
                  <TableRow key={f.fornecedor_cnpj}>
                    <TableCell className="max-w-[18rem]">
                      <Link
                        href={`/antecipacao/fornecedores/${f.fornecedor_cnpj}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {f.fornecedor_nome ?? '—'}
                      </Link>
                      <p className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                        {f.fornecedor_cnpj ? formatCnpj(f.fornecedor_cnpj) : '—'}
                        {/*
                         * Situação cadastral só aparece quando ATRAPALHA. Carimbar
                         * "ativa" em 5.400 linhas gastaria a atenção que as 22
                         * inaptas precisam ter.
                         */}
                        {situacaoPreocupa(f.fornecedor_situacao_cadastral) ? (
                          <span className="font-sans font-medium text-destructive">
                            {f.fornecedor_situacao_cadastral}
                          </span>
                        ) : null}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {f.fornecedor_cnae_principal ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {localDe(f) || '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatarInteiro(f.notas)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        // Zero operável com notas no contador é a armadilha desta
                        // tela: volume alto que a operação não consegue atender.
                        (f.notas_operaveis ?? 0) === 0 && 'text-muted-foreground',
                      )}
                    >
                      {formatarInteiro(f.notas_operaveis)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarInteiro(f.sacados)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarMoeda(f.valor_agregado)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatarData(f.ultima_nota_em)}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.fornecedor_empresa_id ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/empresas/${f.fornecedor_empresa_id}`}>
                            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                            Ficha
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={promovendo === f.fornecedor_cnpj}
                          onClick={() => f.fornecedor_cnpj && void promover(f.fornecedor_cnpj)}
                        >
                          <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
                          {promovendo === f.fornecedor_cnpj ? 'Promovendo…' : 'Promover'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data.length >= LIMITE_PROSPECTAR_FORNECEDORES && (
            // Diferente da lista de sacados, aqui o teto encosta SEMPRE: são milhares
            // de fornecedores na janela. Dizer isso não é rodapé jurídico — sem a
            // frase, ordenar por valor parece responder "quem factura mais" quando
            // responde "quem factura mais entre os que mais emitem".
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              Mostrando os {formatarInteiro(LIMITE_PROSPECTAR_FORNECEDORES)} fornecedores que mais
              emitiram nos últimos 90 dias. A ordenação vale sobre esse recorte, não sobre a lista
              inteira.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
