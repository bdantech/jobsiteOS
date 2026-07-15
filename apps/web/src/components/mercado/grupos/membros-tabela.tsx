'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CamadaBadge } from './camada-badge'
import { anoDe, formatInteiro } from './format'
import { LIMITE_MEMBROS, type MembroGrupo } from './queries'

/**
 * Cabeça + SPEs. A cabeça vem sempre primeiro, depois as SPEs mais novas —
 * quem abriu ontem é quem tem obra para lançar amanhã.
 *
 * O link de cada linha depende de onde a empresa vive: promovida → Company 360;
 * só no universo → a ficha do Explorador. A view `mercado_explorador` é a única
 * que sabe a diferença (empresa_id), e é dela que a resposta vem.
 */

/**
 * Situação cadastral é STATUS — o estado da empresa na Receita. Verde/âmbar/vermelho
 * são deste canal e de mais nenhum: a rampa ordinal da pirâmide vive em CamadaBadge e
 * significa outra coisa. O rótulo vai sempre junto da cor.
 */
const SITUACAO_VARIANTE: Record<string, NonNullable<BadgeProps['variant']>> = {
  ativa: 'success',
  suspensa: 'warning',
  inapta: 'warning',
  baixada: 'neutral',
  nula: 'critical',
}

function SituacaoBadge({ situacao }: { situacao: string | null }) {
  if (!situacao) return <span className="text-muted-foreground">—</span>
  const variante = SITUACAO_VARIANTE[situacao]
  if (!variante) return <Badge variant="outline">{situacao}</Badge>
  return (
    <Badge variant={variante} className="capitalize">
      {situacao}
    </Badge>
  )
}

function rotaDoMembro(membro: MembroGrupo): string {
  return membro.empresa_id ? `/empresas/${membro.empresa_id}` : `/mercado/universo/${membro.cnpj}`
}

function ordenar(membros: readonly MembroGrupo[], cabeca: string | null): MembroGrupo[] {
  return [...membros].sort((a, b) => {
    if (a.cnpj === cabeca) return -1
    if (b.cnpj === cabeca) return 1
    const anoA = anoDe(a.data_inicio_atividade) ?? 0
    const anoB = anoDe(b.data_inicio_atividade) ?? 0
    if (anoA !== anoB) return anoB - anoA
    return (a.razao_social ?? '').localeCompare(b.razao_social ?? '', 'pt-BR')
  })
}

export function MembrosTabela({
  membros,
  cnpjCabeca,
}: {
  membros: readonly MembroGrupo[]
  cnpjCabeca: string | null
}) {
  const [termo, setTermo] = React.useState('')

  const ordenados = React.useMemo(() => ordenar(membros, cnpjCabeca), [membros, cnpjCabeca])

  const filtrados = React.useMemo(() => {
    const busca = termo.trim().toLowerCase()
    if (!busca) return ordenados
    const digitos = busca.replace(/\D/g, '')
    return ordenados.filter(
      (m) =>
        (m.razao_social ?? '').toLowerCase().includes(busca) ||
        (m.nome_fantasia ?? '').toLowerCase().includes(busca) ||
        (m.municipio ?? '').toLowerCase().includes(busca) ||
        (digitos.length >= 2 && m.cnpj.includes(digitos)),
    )
  }, [ordenados, termo])

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Empresas do grupo</CardTitle>
          <CardDescription>
            {formatInteiro(membros.length)}{' '}
            {membros.length === 1 ? 'empresa listada' : 'empresas listadas'}
            {membros.length >= LIMITE_MEMBROS
              ? ` — exibindo as ${LIMITE_MEMBROS} primeiras`
              : ''}
            .
          </CardDescription>
        </div>
        <Input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Filtrar por razão social, CNPJ ou município"
          className="sm:w-72"
          aria-label="Filtrar empresas do grupo"
        />
      </CardHeader>

      <CardContent>
        {filtrados.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {membros.length === 0
              ? 'Nenhuma empresa vinculada a este grupo.'
              : 'Nenhuma empresa corresponde ao filtro.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead className="text-right">Abertura</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Camada</TableHead>
                  <TableHead className="text-right">Obras ativas</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((membro) => {
                  const ehCabeca = membro.cnpj === cnpjCabeca
                  return (
                    <TableRow key={membro.cnpj}>
                      <TableCell className="max-w-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">
                            {membro.razao_social ?? formatCnpj(membro.cnpj)}
                          </span>
                          {ehCabeca && <Badge variant="secondary">Cabeça</Badge>}
                          {membro.is_spe && <Badge variant="outline">SPE</Badge>}
                        </div>
                        {membro.municipio && (
                          <span className="text-xs text-muted-foreground">{membro.municipio}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                        {formatCnpj(membro.cnpj)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {anoDe(membro.data_inicio_atividade) ?? '—'}
                      </TableCell>
                      <TableCell>{membro.uf ?? '—'}</TableCell>
                      <TableCell>
                        <SituacaoBadge situacao={membro.situacao_cadastral} />
                      </TableCell>
                      <TableCell>
                        <CamadaBadge camada={membro.camada} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInteiro(membro.obras_ativas)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" asChild>
                          <Link
                            href={rotaDoMembro(membro)}
                            aria-label={`Abrir ${membro.razao_social ?? formatCnpj(membro.cnpj)}`}
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
