'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Factory, Search, UserPlus } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  combinaBusca,
  localDe,
  ordenarFornecedoresProspectar,
  situacaoPreocupa,
  usePreferenciasFornecedoresProspectar,
} from './fornecedores-prospectar-tabela'
import { CabecalhoOrdenavel } from './tabela-ordenavel'

/**
 * Fornecedores a prospectar — quem emite para os sacados que JÁ podem operar e
 * ainda não está na plataforma.
 *
 * É a lista de "sacados a prospectar" com o funil invertido, e o que qualifica o
 * lead aqui é o outro lado da nota: o sacado ter CRÉDITO APROVADO. Não há filtro de
 * CNAE — não é o setor do fornecedor que diz se ele é oportunidade, é contra quem
 * ele emite.
 *
 * "Cadastrado" não bastava, e a 0102 mediu o estrago: 70% da lista original eram
 * notas contra empresas que estão na plataforma mas não têm limite aprovado. Para
 * essas não há operação a oferecer — o lead não era lead. A aprovação vale também
 * quando está noutro CNPJ do grupo (holding ou SPE): são 18 dos 78 sacados, e
 * exigi-la no CNPJ da nota os descartaria em silêncio.
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
  const [termo, setTermo] = React.useState('')

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.prospectarFornecedores(),
    queryFn: buscarFornecedoresAProspectar,
  })

  const { prefs, ordenarPor } = usePreferenciasFornecedoresProspectar()

  const linhas = React.useMemo(
    () =>
      data
        ? ordenarFornecedoresProspectar(
            data.filter((f) => combinaBusca(f, termo)),
            prefs.coluna,
            prefs.dir,
          )
        : [],
    [data, termo, prefs.coluna, prefs.dir],
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
            Quem emitiu NF nos <strong>últimos 90 dias</strong> contra sacados com{' '}
            <strong>crédito aprovado</strong> (no próprio CNPJ ou no grupo, holding ou SPE) e ainda{' '}
            <strong>não está</strong> na plataforma. Só essas notas contam: quem emite 100 e 6 para
            sacado aprovado aparece com 6. Ordenado por número de notas — clique em qualquer
            cabeçalho para reordenar.
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
          {/*
           * Busca antes da tabela: são 1.808 linhas, e o padrão ordena por número de
           * notas — quem procura UM fornecedor pelo nome não deveria rolar até achar.
           */}
          <div className="flex flex-wrap items-center gap-3 border-y border-border p-3">
            <div className="relative min-w-64 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                className="pl-9"
                aria-label="Buscar fornecedores a prospectar"
              />
            </div>
            <span className="shrink-0 text-sm text-muted-foreground">
              {termo.trim()
                ? `${formatarInteiro(linhas.length)} de ${formatarInteiro(data.length)}`
                : `${formatarInteiro(data.length)} fornecedor(es)`}
            </span>
          </div>

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
                    title="Sacados com crédito aprovado, distintos, contra os quais ele emite — cada um é uma porta de entrada."
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
                      {termo.trim() ? (
                        // Lista vazia por BUSCA e lista vazia por falta de dado são
                        // dois problemas diferentes, e mandam para lugares diferentes.
                        <>Nenhum fornecedor para “{termo.trim()}”.</>
                      ) : (
                        <>
                          Nenhum fornecedor nesta condição nos últimos 90 dias. A lista se enche
                          quando o sync trouxer notas emitidas contra sacados com crédito aprovado
                          por um CNPJ que ainda não está na plataforma.
                        </>
                      )}
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
            // O teto foi dimensionado para NÃO encostar (3.000 contra 1.808 hoje). Se
            // encostar, o aviso importa mais do que antes: o recorte é feito por
            // contagem de notas, e foi assim que um lead de R$ 644 mil com uma nota só
            // ficou fora da tela quando o teto era 500.
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              A lista bateu no teto de {formatarInteiro(LIMITE_PROSPECTAR_FORNECEDORES)}{' '}
              fornecedores, recortados pelos que mais emitiram. Quem emitiu poucas notas de valor
              alto pode ter ficado de fora — vale subir o teto.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
