'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarClock,
  ExternalLink,
  HardHat,
  Landmark,
  Loader2,
  MapPin,
  Rocket,
  SearchX,
  Users,
} from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { promoverEmpresaAction } from '@/actions/mercado'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Campo,
  FichaGrade,
  FichaIdentidade,
  FichaTopo,
  FichaVoltar,
} from '@/components/ficha/ficha'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CamadaBadge, SituacaoBadge } from './camada-badge'
import {
  VAZIO,
  formatBooleano,
  formatCnae,
  formatDataISO,
  formatDocumentoSocio,
  formatLista,
  formatM2,
  formatMoeda,
  formatNumero,
  idadeEmAnos,
} from './format'
import {
  buscarFichaGrupo,
  buscarFichaUniverso,
  buscarObras,
  buscarSocios,
  mercadoKeys,
} from './queries'

/**
 * A ficha de um CNPJ do universo — o registro cru da Receita, os sócios, as
 * obras, o grupo econômico, e o botão que o traz para dentro.
 *
 * Uma empresa PROMOVIDA não aparece aqui: o Explorador manda direto para o
 * Company 360 dela. Esta tela é o que existe ANTES de existir uma empresa — por
 * isso ela não tem timeline, não tem notas e não tem estágio. Tem camada, que é
 * outro eixo: o quanto essa empresa se encaixa no nosso mercado, calculado por
 * regra, sem ninguém ter falado com ninguém.
 */

export function FichaCarregando() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-24" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-52" />
      </div>

      <Skeleton className="h-10 w-96" />

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

function CardGrupo({ grupoId }: { grupoId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: mercadoKeys.grupo(grupoId),
    queryFn: () => buscarFichaGrupo(grupoId),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          Grupo econômico
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/mercado/grupos/${grupoId}`}>
            Abrir
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <>
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar o grupo.</p>
        ) : (
          <>
            <div className="space-y-1">
              <p className="font-medium">{data.grupo.nome ?? '(grupo sem nome)'}</p>
              <p className="text-sm text-muted-foreground">
                Cabeça: {data.grupo.cnpj_cabeca ? formatCnpj(data.grupo.cnpj_cabeca) : VAZIO}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Campo label="Empresas no grupo">
                <span className="tabular-nums">{formatNumero(data.total)}</span>
              </Campo>
              <Campo label="SPEs">
                <span className="tabular-nums">
                  {formatNumero(data.membros.filter((m) => m.is_spe).length)}
                  {data.total > data.membros.length && ' +'}
                </span>
              </Campo>
            </div>

            <div className="space-y-1.5">
              {data.membros.slice(0, 8).map((membro) => (
                <Link
                  key={membro.cnpj ?? membro.empresa_id}
                  href={
                    membro.empresa_id
                      ? `/empresas/${membro.empresa_id}`
                      : `/mercado/universo/${membro.cnpj}`
                  }
                  className="flex items-baseline justify-between gap-3 rounded px-1 py-0.5 text-sm hover:bg-muted"
                >
                  <span className="truncate">{membro.razao_social ?? formatCnpj(membro.cnpj ?? '')}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {membro.data_inicio_atividade?.slice(0, 4) ?? VAZIO}
                  </span>
                </Link>
              ))}
              {data.total > 8 && (
                <p className="px-1 pt-1 text-xs text-muted-foreground">
                  e mais {data.total - 8} {data.total - 8 === 1 ? 'empresa' : 'empresas'}.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function CardSocios({ cnpj }: { cnpj: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: mercadoKeys.socios(cnpj),
    queryFn: () => buscarSocios(cnpj),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          Quadro societário
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar os sócios.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum sócio no dump da Receita para este CNPJ.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sócio</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Qualificação</TableHead>
                <TableHead>Entrada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((socio) => (
                <TableRow key={socio.id}>
                  <TableCell className="font-medium">
                    {socio.nome_socio ?? VAZIO}
                    {socio.tipo_socio && (
                      <span className="ml-2 text-xs text-muted-foreground">{socio.tipo_socio}</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatDocumentoSocio(socio.cpf_cnpj_socio)}
                  </TableCell>
                  <TableCell>{socio.qualificacao ?? VAZIO}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDataISO(socio.data_entrada)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function CardObras({ cnpj }: { cnpj: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: mercadoKeys.obras(cnpj),
    queryFn: () => buscarObras(cnpj),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardHat className="h-4 w-4 text-muted-foreground" aria-hidden />
          Obras (CNO)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar as obras.</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma obra registrada no CNO com este CNPJ como responsável.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CNO</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>Destinação</TableHead>
                <TableHead className="text-right">Área</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((obra) => (
                <TableRow key={obra.cno}>
                  <TableCell className="tabular-nums">{obra.cno}</TableCell>
                  <TableCell>{obra.situacao ?? VAZIO}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDataISO(obra.data_inicio_obra)}
                  </TableCell>
                  <TableCell>
                    {obra.municipio ? `${obra.municipio}${obra.uf ? `/${obra.uf}` : ''}` : VAZIO}
                  </TableCell>
                  <TableCell>{obra.destinacao ?? VAZIO}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatM2(obra.metragem_m2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function UniversoFicha({ cnpj }: { cnpj: string }) {
  const queryClient = useQueryClient()
  const [promovendo, setPromovendo] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: mercadoKeys.universo(cnpj),
    queryFn: () => buscarFichaUniverso(cnpj),
  })

  async function promover() {
    setPromovendo(true)
    const resultado = await promoverEmpresaAction({ cnpj })
    setPromovendo(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    // A ficha muda de estado (ganha empresa_id) e o Explorador precisa refletir
    // que esta linha agora é promovida.
    await queryClient.invalidateQueries({ queryKey: mercadoKeys.all })

    toast.success('Empresa promovida.', {
      description: resultado.data.razao_social ?? formatCnpj(cnpj),
      action: {
        label: 'Abrir',
        onClick: () => {
          window.location.href = `/empresas/${resultado.data.id}`
        },
      },
    })
  }

  if (isPending) return <FichaCarregando />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium">Não foi possível carregar o CNPJ</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Erro desconhecido.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <div className="rounded-full bg-muted p-3">
            <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-medium">CNPJ não encontrado no universo</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {formatCnpj(cnpj)} não está no recorte da construção ingerido da Receita Federal — ou
              a ingestão ainda não rodou.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/mercado/explorador">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para o Explorador
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { universo, grupo, metricas, empresa } = data
  const idade = idadeEmAnos(universo.data_inicio_atividade)
  const secundarios = universo.cnaes_secundarios ?? []
  const local = [universo.municipio, universo.uf].filter(Boolean).join(' / ')

  const acao = empresa ? (
    <>
      <Button asChild>
        <Link href={`/empresas/${empresa.id}`}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Ver na base de Empresas
        </Link>
      </Button>
      <span className="text-xs text-muted-foreground">
        Já promovida{empresa.estagio ? ` — estágio: ${empresa.estagio}` : ''}.
      </span>
    </>
  ) : (
    <>
      <Button onClick={promover} disabled={promovendo}>
        {promovendo ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Rocket className="mr-2 h-4 w-4" />
        )}
        Promover para Empresas
      </Button>
      <span className="text-xs text-muted-foreground">
        Ganha timeline, notas e eventos. A camada não muda.
      </span>
    </>
  )

  return (
    <div className="space-y-4">
      <FichaVoltar href="/mercado/explorador">Explorador</FichaVoltar>

      <FichaTopo titulo="CNPJ do universo" descricao={formatCnpj(universo.cnpj)} acao={acao} />

      {/* A identidade fica; as abas trocam só a direita. Sócios e obras são tabelas
          largas que competiam por altura no layout antigo — cada uma na sua aba respira,
          e a ficha abre no Cadastro, que é o que se lê primeiro. */}
      <Tabs defaultValue="cadastro" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          <TabsTrigger value="socios">Sócios</TabsTrigger>
          <TabsTrigger value="obras">Obras</TabsTrigger>
          <TabsTrigger value="mercado">Mercado</TabsTrigger>
          <TabsTrigger value="grupo">Grupo econômico</TabsTrigger>
        </TabsList>

        <FichaGrade
          identidade={
            <FichaIdentidade
              nome={universo.razao_social ?? formatCnpj(universo.cnpj)}
              papel={universo.nome_fantasia}
              tags={
                <>
                  <CamadaBadge camada={universo.camada} />
                  <SituacaoBadge situacao={universo.situacao_cadastral} />
                  {universo.is_spe && <Badge variant="secondary">SPE</Badge>}
                  {universo.matriz_filial && (
                    <Badge variant="outline">{universo.matriz_filial}</Badge>
                  )}
                  {universo.grafo_sefaz && <Badge variant="outline">Grafo SEFAZ</Badge>}
                </>
              }
              // Os quatro números que dizem o TAMANHO desta empresa no mercado — os
              // mesmos que a regra da camada lê. O resto das métricas fica na aba Mercado.
              resumo={[
                { label: 'Filiais', valor: formatNumero(metricas?.qtd_filiais ?? 0) },
                { label: 'Obras ativas', valor: formatNumero(metricas?.obras_ativas ?? 0) },
                { label: 'm² execução', valor: formatM2(metricas?.m2_em_execucao ?? 0) },
              ]}
              linhas={[
                { icone: MapPin, label: 'Localização', valor: local || VAZIO },
                { icone: Briefcase, label: 'CNAE principal', valor: formatCnae(universo.cnae_principal) },
                { icone: Building2, label: 'Porte', valor: universo.porte_rfb ?? VAZIO },
                {
                  icone: Landmark,
                  label: 'Capital social',
                  valor: <span className="tabular-nums">{formatMoeda(universo.capital_social)}</span>,
                },
                {
                  icone: CalendarClock,
                  label: 'Início de atividade',
                  valor: (
                    <>
                      {formatDataISO(universo.data_inicio_atividade)}
                      {idade !== null && (
                        <span className="ml-1.5 text-muted-foreground">
                          ({idade} {idade === 1 ? 'ano' : 'anos'})
                        </span>
                      )}
                    </>
                  ),
                },
              ]}
              rodape={
                universo.camada_regra_versao !== null
                  ? `Camada calculada pela regra v${universo.camada_regra_versao}.`
                  : undefined
              }
            />
          }
          conteudo={
            <>
              <TabsContent value="cadastro" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Cadastro (Receita Federal)</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Campo label="Natureza jurídica">{universo.natureza_juridica ?? VAZIO}</Campo>
                    <Campo label="Situação desde">{formatDataISO(universo.situacao_data)}</Campo>
                    <Campo label="Situação motivo">{universo.situacao_motivo ?? VAZIO}</Campo>
                    <Campo label="Optante do Simples">{formatBooleano(universo.opcao_simples)}</Campo>
                    <Campo label="Saiu do Simples em">
                      {formatDataISO(universo.data_exclusao_simples)}
                    </Campo>
                    <Campo label="MEI">{formatBooleano(universo.opcao_mei)}</Campo>

                    <div className="sm:col-span-2">
                      <Campo label="CNAEs secundários">
                        {secundarios.length === 0
                          ? VAZIO
                          : secundarios.map((c) => formatCnae(c)).join(' · ')}
                      </Campo>
                    </div>
                    <div className="sm:col-span-2">
                      <Campo label="Endereço">
                        {[
                          universo.logradouro,
                          universo.numero,
                          universo.bairro,
                          universo.municipio,
                          universo.uf,
                          universo.cep,
                        ]
                          .filter((parte) => parte)
                          .join(', ') || VAZIO}
                      </Campo>
                    </div>
                    <Campo label="E-mail (RFB)">{universo.email_rfb ?? VAZIO}</Campo>
                    <Campo label="Telefone (RFB)">
                      {[universo.telefone1_rfb, universo.telefone2_rfb]
                        .filter((t) => t)
                        .join(' · ') || VAZIO}
                    </Campo>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="socios" className="mt-0">
                <CardSocios cnpj={cnpj} />
              </TabsContent>

              <TabsContent value="obras" className="mt-0">
                <CardObras cnpj={cnpj} />
              </TabsContent>

              <TabsContent value="mercado" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Métricas de mercado</CardTitle>
                  </CardHeader>
                  {/* Filiais, obras ativas e m² NÃO estão aqui: são a tira do card de
                      identidade. Repeti-los imprimiria o mesmo número duas vezes, e a
                      segunda cópia é a que envelhece. */}
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Campo label="SPEs no grupo">
                      <span className="tabular-nums">
                        {formatNumero(metricas?.grupo_spes_total ?? 0)}
                      </span>
                    </Campo>
                    <Campo label="SPEs abertas (24m)">
                      <span className="tabular-nums">
                        {formatNumero(metricas?.grupo_spes_24m ?? 0)}
                      </span>
                    </Campo>
                    <Campo label="Obras iniciadas (24m)">
                      <span className="tabular-nums">
                        {formatNumero(metricas?.obras_iniciadas_24m ?? 0)}
                      </span>
                    </Campo>
                    <Campo label="UFs do grupo">{formatLista(metricas?.grupo_ufs)}</Campo>
                    <Campo label="Capital do grupo">
                      <span className="tabular-nums">
                        {formatMoeda(metricas?.grupo_capital_agregado ?? null)}
                      </span>
                    </Campo>
                    <Campo label="Tem contato">
                      {formatBooleano(metricas?.tem_contato ?? false)}
                    </Campo>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="grupo" className="mt-0">
                {grupo ? (
                  <CardGrupo grupoId={grupo.id} />
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                        Grupo econômico
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Este CNPJ não foi ligado a nenhum grupo econômico. Grupos são montados a
                        partir dos vínculos de sócio-PJ, na ingestão.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </>
          }
        />
      </Tabs>
    </div>
  )
}
