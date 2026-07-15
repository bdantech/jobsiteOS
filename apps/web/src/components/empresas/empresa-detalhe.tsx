'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Cpu,
  Hash,
  MapPin,
  SearchX,
} from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FichaGrade, FichaIdentidade, FichaTopo, FichaVoltar } from '@/components/ficha/ficha'
import { Skeleton } from '@/components/ui/skeleton'
import { GrupoSecao } from '@/components/mercado/grupos/grupo-secao'
import { EstagioBadge, labelTipo } from './estagio-badge'
import { formatData } from './format'
import { EmpresaForm } from './empresa-form'
import { EmpresaAcaoEstagio } from './empresa-header'
import { EmpresaNotas } from './empresa-notas'
import { EmpresaTimeline } from './empresa-timeline'
import { buscarEmpresa, empresasKeys } from './queries'

/**
 * O esqueleto desenha o CARD de identidade, não um cabeçalho solto: se ele mostrar um
 * layout e o conteúdo chegar noutro, a tela salta na frente de quem está esperando.
 */
/**
 * O esqueleto desenha a MESMA forma da ficha — voltar, topo, abas, identidade estreita à
 * esquerda. Um esqueleto que mostra um layout e entrega outro faz a tela saltar na cara
 * de quem estava esperando.
 */
export function DetalheCarregando() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-24" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-44" />
      </div>

      <Skeleton className="h-10 w-80" />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-[70px] w-full rounded-lg" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    </div>
  )
}

function EstadoVazio({
  titulo,
  descricao,
  children,
}: {
  titulo: string
  descricao: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        {children}
        <div className="space-y-1">
          <p className="text-lg font-medium">{titulo}</p>
          <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/empresas">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para empresas
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Company 360.
 *
 * A missing row here is ambiguous by design: RLS returns zero rows both for an
 * id that doesn't exist and for a company the caller may not see. The UI must
 * therefore say the same thing in both cases — anything sharper would be an
 * existence oracle for data the user has no right to.
 */
export function EmpresaDetalhe({ empresaId }: { empresaId: string }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.detalhe(empresaId),
    queryFn: () => buscarEmpresa(empresaId),
  })

  if (isPending) return <DetalheCarregando />

  if (isError) {
    return (
      <EstadoVazio
        titulo="Não foi possível carregar a empresa"
        descricao={error instanceof Error ? error.message : 'Erro desconhecido.'}
      >
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </EstadoVazio>
    )
  }

  if (!data) {
    return (
      <EstadoVazio
        titulo="Empresa não encontrada"
        descricao="Ela pode ter sido removida, ou você pode não ter acesso a ela."
      >
        <div className="rounded-full bg-muted p-3">
          <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
      </EstadoVazio>
    )
  }

  const local = [data.municipio, data.uf].filter(Boolean).join(' / ')

  return (
    <div className="space-y-4">
      <FichaVoltar href="/empresas">Empresas</FichaVoltar>

      <FichaTopo
        titulo="Empresa"
        descricao={formatCnpj(data.cnpj)}
        acao={<EmpresaAcaoEstagio empresa={data} />}
      />

      {/*
       * As abas trocam SÓ a coluna da direita. O card de identidade fica: quem está
       * sendo olhado não é uma aba, e some-lo ao trocar de aba é o caminho mais curto
       * para alguém escrever uma nota na empresa errada.
       *
       * Sem `grupo` quando não há grupo — uma aba que abre para dizer "não tem" é uma
       * aba que só serve para decepcionar quem clicou nela.
       */}
      <Tabs defaultValue="dados" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          {data.grupo_id ? <TabsTrigger value="grupo">Grupo econômico</TabsTrigger> : null}
        </TabsList>

        <FichaGrade
          identidade={
            <FichaIdentidade
              nome={data.razao_social ?? formatCnpj(data.cnpj)}
              papel={data.nome_fantasia}
              tags={
                <>
                  <EstagioBadge estagio={data.estagio} />
                  <Badge variant="secondary">{labelTipo(data.tipo)}</Badge>
                </>
              }
              linhas={[
                {
                  icone: Hash,
                  label: 'CNPJ',
                  valor: (
                    <span className="font-mono tabular-nums">{formatCnpj(data.cnpj)}</span>
                  ),
                },
                { icone: MapPin, label: 'Localização', valor: local || '—' },
                { icone: Briefcase, label: 'CNAE principal', valor: data.cnae_principal ?? '—' },
                { icone: Building2, label: 'Porte', valor: data.porte ?? '—' },
                { icone: Cpu, label: 'ERP atual', valor: data.erp_atual ?? '—' },
              ]}
              rodape={`Criada em ${formatData(data.criado_em)} · Atualizada em ${formatData(
                data.atualizado_em,
              )}`}
            />
          }
          conteudo={
            <>
              <TabsContent value="dados" className="mt-0">
                <EmpresaForm empresa={data} />
              </TabsContent>

              <TabsContent value="notas" className="mt-0">
                <EmpresaNotas empresaId={data.id} />
              </TabsContent>

              <TabsContent value="historico" className="mt-0">
                <EmpresaTimeline empresaId={data.id} />
              </TabsContent>

              {/* Módulo Mercado (§5.4). */}
              {data.grupo_id ? (
                <TabsContent value="grupo" className="mt-0">
                  <GrupoSecao grupoId={data.grupo_id} />
                </TabsContent>
              ) : null}
            </>
          }
        />
      </Tabs>
    </div>
  )
}
