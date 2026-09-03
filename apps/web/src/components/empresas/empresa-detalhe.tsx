'use client'

import * as React from 'react'
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
  Users,
} from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FichaGrade, FichaIdentidade, FichaTopo } from '@/components/ficha/ficha'
import { VoltarContextual } from '@/components/shell/voltar-contextual'
import { Skeleton } from '@/components/ui/skeleton'
import { GrupoSecao } from '@/components/mercado/grupos/grupo-secao'
import { EstagioBadge, labelTipo } from './estagio-badge'
import { formatData } from './format'
import { AnaliseFinanceira } from './analise-financeira'
import { MonitoramentoProtesto } from './monitoramento-protesto'
import { CadastroRfb } from '@/components/cadastro/cadastro-rfb'
import { EmpresaForm } from './empresa-form'
import { ExClienteMotivo } from './ex-cliente-motivo'
import { EmpresaAcaoEstagio } from './empresa-header'
import { EmpresaContatos } from './empresa-contatos'
import { FaturamentoEquipe } from './faturamento-equipe'
import { CreditoCard } from '@/components/credito/credito-card'
import { SecaoComercial } from '@/components/comercial/secao-comercial'
import { SecaoJuridico } from '@/components/juridico/secao-juridico'
import { QuadroSocietario } from '@/components/mercado/socios/quadro-societario'
import { EmpresaNotas } from './empresa-notas'
import { AbaConversas } from './aba-conversas'
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
export function EmpresaDetalhe({
  empresaId,
  podeAbrirJuridico = false,
}: {
  empresaId: string
  /** Se o usuário tem o módulo `juridico` — decide se a seção Jurídico linka (08 §8). */
  podeAbrirJuridico?: boolean
}) {
  // Controlado (e não `defaultValue`) só por causa do atalho "Ver quadro societário":
  // um botão que leva a uma aba precisa poder escolhê-la.
  const [aba, setAba] = React.useState('dados')

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
      {/*
       * Voltar para de onde a pessoa veio (Antecipação, Radar, Explorador…), não para a
       * lista de Empresas — que na maioria das vezes ela nunca abriu.
       */}
      <VoltarContextual padrao={{ href: '/empresas', label: 'Empresas' }} />

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
      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
          {/*
            Conversas logo depois de Contatos, e antes de Sócios: as duas respondem
            "com quem se fala nesta conta", e a segunda é a que diz o que já foi
            dito. É aqui que as conversas dos cinco funis se encontram (05A §9).
          */}
          <TabsTrigger value="conversas">Conversas</TabsTrigger>
          <TabsTrigger value="socios">Sócios</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
          <TabsTrigger value="financeiro">Análise financeira</TabsTrigger>
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
                  {/*
                   * O "desde quando" ao lado do estágio, e não escondido numa aba: a
                   * primeira pergunta sobre um ex-cliente é há quanto tempo ele saiu,
                   * porque é o que decide se ainda vale ligar. O badge de estágio
                   * sozinho diz "Ex-cliente" e cala justamente a metade que importa.
                   */}
                  {data.estagio === 'ex_cliente' && data.ex_cliente_desde ? (
                    <Badge variant="outline" className="text-destructive">
                      Ex-cliente desde {formatData(data.ex_cliente_desde)}
                    </Badge>
                  ) : null}
                  {data.teve_analise_sem_cadastro ? (
                    <Badge
                      variant="outline"
                      title="Teve análise de crédito aprovada na plataforma e nunca foi cadastrada."
                    >
                      Analisada sem cadastro
                    </Badge>
                  ) : null}
                </>
              }
              abaixoDoNome={
                <button
                  type="button"
                  onClick={() => setAba('socios')}
                  className="mx-auto flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  <Users className="h-3 w-3" aria-hidden />
                  Ver quadro societário
                </button>
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
              {/*
               * O cadastro da Receita ANTES do formulário: quem abre "Dados" quer
               * primeiro saber com quem está lidando (capital, idade, situação) e
               * só depois editar o que é nosso. O card lê `mercado_universo` — os
               * dados da RFB não são duplicados em `empresas` de propósito.
               */}
              <TabsContent value="dados" className="mt-0 space-y-4">
                {/*
                 * Antes do cadastro da Receita quando a empresa saiu: para um
                 * ex-cliente, "o que aconteceu aqui" vem antes de "quem é esta
                 * empresa" — e a classificação é a única coisa nesta ficha que o
                 * sistema não consegue preencher sozinho.
                 */}
                {data.estagio === 'ex_cliente' ? (
                  <ExClienteMotivo
                    empresaId={data.id}
                    desde={data.ex_cliente_desde}
                    motivoId={data.ex_cliente_motivo}
                    observacao={data.ex_cliente_motivo_obs}
                  />
                ) : null}
                <CadastroRfb cnpj={data.cnpj} />
                {/*
                 * Faturamento & Equipe entre o cadastro da Receita e o formulário: é a
                 * ordem da leitura comercial. "Quem é essa empresa" → "de que tamanho
                 * ela é" → "o que a gente sabe/decide sobre ela".
                 */}
                <FaturamentoEquipe
                  empresaId={data.id}
                  cnpj={data.cnpj}
                  faturamento={data.faturamento_anual}
                  faturamentoOrigem={data.faturamento_origem}
                  faturamentoConfianca={data.faturamento_confianca}
                  faturamentoEm={data.faturamento_atualizado_em}
                  funcionarios={data.funcionarios}
                  funcionariosOrigem={data.funcionarios_origem}
                  funcionariosEm={data.funcionarios_atualizado_em}
                  dominio={data.dominio}
                  eCliente={data.estagio === 'cliente'}
                />
                {/*
                 * Crédito depois de Faturamento & Equipe porque DEPENDE dele: o limite
                 * potencial é uma proporção do faturamento estimado. Ler na ordem
                 * inversa faria o número aparecer antes da grandeza que o gera.
                 */}
                <CreditoCard
                  empresaId={data.id}
                  cnpj={data.cnpj}
                  tipo={data.tipo}
                  limitePotencial={data.limite_potencial}
                  limiteConfianca={data.limite_confianca}
                  receitaMensalPrevista={data.receita_mensal_prevista}
                  receitaTaxaAm={data.receita_taxa_am}
                  valorEsperadoMensal={data.valor_esperado_mensal}
                  chanceConcessao={data.chance_concessao}
                  faturamentoEstimado={data.faturamento_anual}
                  creditoCalculadoEm={data.credito_calculado_em}
                />
                {/*
                 * Comercial depois do Crédito, e pelo mesmo motivo da ordem acima: a
                 * decisão ativo × passivo se toma olhando quanto a conta rende e quem
                 * já a trabalha, não antes de saber as duas coisas.
                 */}
                <SecaoComercial empresaId={data.id} />
                {/*
                 * O Jurídico DEPOIS do Comercial e do Crédito, e não antes: a seção só
                 * existe quando há processo, e quando existe ela é a última palavra —
                 * ação nossa em curso é knockout de crédito, então ela contradiz o
                 * limite potencial que está logo acima. Ler na ordem inversa mostraria
                 * a contradição antes do número contradito.
                 */}
                <SecaoJuridico empresaId={data.id} podeAbrirProcesso={podeAbrirJuridico} />
                <EmpresaForm empresa={data} />
              </TabsContent>

              {/* Contatos + curadoria do ponto focal (Antecipação §3.2). */}
              <TabsContent value="contatos" className="mt-0">
                <EmpresaContatos empresaId={data.id} />
              </TabsContent>

              <TabsContent value="conversas" className="mt-0">
                <AbaConversas
                  empresaId={data.id}
                  ultimaConversaEm={data.ultima_conversa_em ?? null}
                />
              </TabsContent>

              {/*
               * O quadro societário vive no Mercado (é QSA da Receita) e continua lá, na
               * ficha do universo. Aqui é o MESMO componente, não uma segunda tabela:
               * duas cópias da mesma pergunta divergem, e a segunda é a que envelhece.
               */}
              <TabsContent value="socios" className="mt-0">
                <QuadroSocietario cnpj={data.cnpj} />
              </TabsContent>

              <TabsContent value="notas" className="mt-0">
                <EmpresaNotas empresaId={data.id} />
              </TabsContent>

              <TabsContent value="financeiro" className="mt-0">
                <AnaliseFinanceira empresaId={data.id} />
              </TabsContent>

              <TabsContent value="historico" className="mt-0">
                <EmpresaTimeline empresaId={data.id} />
              </TabsContent>

              {/* Módulo Mercado (§5.4) + curadoria de monitoramento de protesto (Radar). */}
              {data.grupo_id ? (
                <TabsContent value="grupo" className="mt-0">
                  <div className="space-y-4">
                    <GrupoSecao grupoId={data.grupo_id} />
                    <MonitoramentoProtesto grupoId={data.grupo_id} />
                  </div>
                </TabsContent>
              ) : null}
            </>
          }
        />
      </Tabs>
    </div>
  )
}
