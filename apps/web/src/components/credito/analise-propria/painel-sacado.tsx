'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import {
  FAIXA_SCORE_LABELS,
  KNOCKOUT_LABELS,
  STATUS_ANALISE_PROPRIA_LABELS,
  formatCnpj,
  type DecisaoFinal,
  type FaixaScore,
  type Knockout,
  type Quadrante,
  type StatusAnalisePropria,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { rodarAnalisePropriaAction } from '@/actions/credito-analise'
import { Confronto } from './confronto'
import { Parecer } from './parecer'
import { RevisaoExtracao } from './revisao-extracao'
import { Cenarios, Indicadores, Lacunas, Tetos, brl } from './resultado'
import { analisePropriaKeys, buscarPainelSacado } from './queries'

/**
 * O painel do sacado (04j §8): tudo que se sabe sobre um CNPJ, numa tela.
 *
 * ─── POR QUE ABAS, E NÃO UMA PÁGINA ROLÁVEL ─────────────────────────────────
 * São seis camadas de informação sobre a mesma empresa — contexto, análise, parecer,
 * seguradora, documentos. Numa página só, a decisão (que é a razão de a tela existir)
 * ficaria no fim de uma rolagem de dois metros, e o parecer de oito seções empurraria
 * todo o resto para fora da vista.
 *
 * ─── A ABA QUE ABRE DEPENDE DO ESTADO ───────────────────────────────────────
 * Extração aguardando revisão abre em "Revisão"; análise concluída abre em "Análise".
 * A tela pergunta o que ela mesma precisa que a pessoa responda agora, em vez de fazer
 * a pessoa procurar.
 */

const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR')

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 truncate text-right">{valor}</span>
    </div>
  )
}

export function PainelSacado({ analiseCreditoId }: { analiseCreditoId: string }) {
  const qc = useQueryClient()
  const [rodando, setRodando] = React.useState(false)

  const q = useQuery({
    queryKey: analisePropriaKeys.painel(analiseCreditoId),
    queryFn: () => buscarPainelSacado(analiseCreditoId),
    // A extração e o parecer rodam no worker por minutos. Sem refetch, a tela ficaria em
    // "processando" para sempre e a pessoa recarregaria a página para descobrir.
    refetchInterval: (query) =>
      query.state.data?.propria?.status === 'processando' ? 10_000 : false,
  })

  const p = q.data
  const propria = p?.propria ?? null
  const status = (propria?.status ?? null) as StatusAnalisePropria | null

  const [aba, setAba] = React.useState<string>('analise')
  // Só reposiciona quando o STATUS muda: mexer a cada refetch tiraria a aba de baixo de
  // quem estava lendo o parecer.
  React.useEffect(() => {
    if (status === 'aguardando_revisao') setAba('revisao')
    else if (status === 'concluida') setAba('analise')
  }, [status])

  async function rodar(tipo: 'inicial' | 'reanalise') {
    setRodando(true)
    const r = await rodarAnalisePropriaAction({
      analise_credito_id: analiseCreditoId,
      tipo,
      gatilho: 'manual',
    })
    setRodando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.worker_acordado
        ? 'Análise iniciada. A extração roda em segundo plano e para para a sua revisão.'
        : 'Análise registrada, mas o worker não respondeu. A rotina diária a retoma.',
    )
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })
  }

  if (q.isPending) return <Skeleton className="h-96 w-full rounded-lg" />
  if (!p?.encontrado) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Análise não encontrada.
        </CardContent>
      </Card>
    )
  }

  const emAndamento = status === 'processando'
  const podeRodar = !emAndamento && status !== 'aguardando_revisao'
  const docsExtraiveis = p.docs.length

  return (
    <div className="space-y-4">
      {/* ── A faixa de ação: o que fazer agora ─────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Análise proprietária</CardTitle>
              <CardDescription>
                A nossa leitura dos documentos contábeis, ao lado da leitura da seguradora.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {status && (
                <Badge variant={status === 'falhou' ? 'destructive' : 'outline'}>
                  {STATUS_ANALISE_PROPRIA_LABELS[status]}
                </Badge>
              )}
              {emAndamento && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
              {podeRodar && (
                <Button size="sm" onClick={() => void rodar(propria ? 'reanalise' : 'inicial')} disabled={rodando}>
                  {propria ? (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <PlayCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
                  )}
                  {rodando ? 'Iniciando…' : propria ? 'Rodar de novo' : 'Rodar análise proprietária'}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        {(propria?.erro || docsExtraiveis === 0) && (
          <CardContent className="pt-0">
            {propria?.erro && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                Falhou na etapa <strong>{propria.etapa ?? 'desconhecida'}</strong>: {propria.erro}
              </p>
            )}
            {docsExtraiveis === 0 && (
              <p className="mt-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                Nenhum documento anexado ainda. A análise lê o que estiver na aba{' '}
                <strong>Documentos</strong> — sem balanço e DRE, ela roda mas quase tudo vira lacuna.
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="analise">Análise</TabsTrigger>
          {status === 'aguardando_revisao' && <TabsTrigger value="revisao">Revisão</TabsTrigger>}
          <TabsTrigger value="parecer">Parecer</TabsTrigger>
          <TabsTrigger value="confronto">Seguradora e decisão</TabsTrigger>
          <TabsTrigger value="contexto">Contexto</TabsTrigger>
        </TabsList>

        {/* ── Análise ───────────────────────────────────────────────────── */}
        <TabsContent value="analise" className="mt-4 space-y-4">
          {!propria || (status !== 'concluida' && status !== 'falhou') ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {emAndamento
                  ? 'A extração está rodando. Isto leva alguns minutos — a tela se atualiza sozinha.'
                  : status === 'aguardando_revisao'
                    ? 'Nada foi calculado ainda: os campos críticos esperam a sua confirmação na aba Revisão.'
                    : 'Esta esteira ainda não tem análise proprietária.'}
              </CardContent>
            </Card>
          ) : (
            <>
              <Cenarios
                cenarios={propria.cenarios ?? []}
                recomendacao={propria.recomendacao}
                limite={propria.limite_recomendado}
                motivos={propria.motivos_nao_operar ?? []}
              />
              <Tetos tetos={propria.tetos ?? []} />
              <Indicadores indicadores={propria.indicadores ?? []} />
              <Lacunas lacunas={propria.lacunas_calculo ?? []} />
            </>
          )}
        </TabsContent>

        {/* ── Revisão ───────────────────────────────────────────────────── */}
        {status === 'aguardando_revisao' && propria && (
          <TabsContent value="revisao" className="mt-4">
            <RevisaoExtracao
              analiseId={propria.id}
              analiseCreditoId={analiseCreditoId}
              dados={propria.dados_extraidos}
              docs={p.docs}
            />
          </TabsContent>
        )}

        {/* ── Parecer ───────────────────────────────────────────────────── */}
        <TabsContent value="parecer" className="mt-4">
          {propria ? (
            <Parecer
              analiseId={propria.id}
              analiseCreditoId={analiseCreditoId}
              original={propria.parecer_markdown}
              editado={propria.parecer_editado}
              modelo={propria.parecer_modelo}
              tokens={propria.parecer_tokens}
              editadoEm={propria.parecer_editado_em}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Sem análise, sem parecer.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Confronto e decisão ───────────────────────────────────────── */}
        <TabsContent value="confronto" className="mt-4">
          {propria && status === 'concluida' ? (
            <Confronto
              analiseId={propria.id}
              analiseCreditoId={analiseCreditoId}
              quadrante={propria.quadrante as Quadrante | null}
              nossaRecomendacao={propria.recomendacao}
              nossoLimite={propria.limite_recomendado}
              seguradoraStatus={propria.atradius_status}
              seguradoraLimite={propria.atradius_limite}
              decisaoAtual={propria.decisao_final as DecisaoFinal | null}
              decisaoLimite={propria.decisao_limite}
              decisaoMotivo={propria.decisao_motivo}
              decidaEm={propria.decidida_em}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                O confronto exige as duas leituras. A nossa precisa estar concluída.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Contexto ──────────────────────────────────────────────────── */}
        <TabsContent value="contexto" className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scorecard</CardTitle>
              <CardDescription>
                A chance de a SEGURADORA conceder (04d). Diferente da nossa análise, que lê o
                balanço — as duas entram no cálculo, e o scorecard vira um dos cinco tetos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {p.score ? (
                <>
                  <Linha rotulo="Score" valor={p.score.score ?? 'não calculado'} />
                  <Linha
                    rotulo="Faixa"
                    valor={FAIXA_SCORE_LABELS[p.score.faixa as FaixaScore] ?? p.score.faixa}
                  />
                  <Linha
                    rotulo="Completude"
                    valor={`${Math.round(Number(p.score.completude) * 100)}%`}
                  />
                  {p.score.knockout && (
                    <Linha
                      rotulo="Knockout"
                      valor={
                        <Badge variant="destructive">
                          {KNOCKOUT_LABELS[p.score.knockout as Knockout] ?? p.score.knockout}
                        </Badge>
                      }
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Esta empresa ainda não foi pontuada.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">A empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <Linha rotulo="Razão social" valor={p.empresa?.razao_social ?? '—'} />
              <Linha rotulo="CNPJ" valor={p.esteira ? formatCnpj(p.esteira.cnpj) : '—'} />
              <Linha
                rotulo="Local"
                valor={[p.empresa?.municipio, p.empresa?.uf].filter(Boolean).join(' · ') || '—'}
              />
              <Linha
                rotulo="Faturamento"
                valor={
                  <>
                    {brl(p.empresa?.faturamento_anual ?? null)}
                    {p.empresa?.faturamento_confianca ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({p.empresa.faturamento_origem === 'declarado_cliente' ? 'declarado' : 'estimado'},
                        confiança {p.empresa.faturamento_confianca})
                      </span>
                    ) : null}
                  </>
                }
              />
              <Linha rotulo="Funcionários" valor={num(p.empresa?.funcionarios)} />
              <Linha rotulo="Limite potencial" valor={brl(p.empresa?.limite_potencial ?? null)} />
              {p.empresa && (
                <div className="pt-2">
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link href={`/empresas/${p.empresa.id}`}>
                      Abrir a Company 360
                      <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Comportamento observado</CardTitle>
              <CardDescription>
                {p.opera_na_plataforma
                  ? 'A empresa opera: este é o teto mais confiável dos cinco, porque é comportamento e não declaração.'
                  : 'A empresa ainda não opera. O teto operacional fica fora do cálculo — não entra como zero.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Linha rotulo="Opera na plataforma" valor={p.opera_na_plataforma ? 'sim' : 'não'} />
              <Linha
                rotulo={`NF-e (${p.nfe_observada.janela_meses} meses)`}
                valor={`${num(p.nfe_observada.qtd)} notas · ${brl(p.nfe_observada.total)}`}
              />
              <Linha rotulo="Média mensal" valor={brl(p.nfe_observada.media_mensal)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Risco e estrutura</CardTitle>
            </CardHeader>
            <CardContent>
              <Linha
                rotulo="Protestos"
                valor={
                  p.protestos
                    ? p.protestos.tem_protesto
                      ? `${num(p.protestos.qtd_protestos)} · ${brl(p.protestos.valor_total)}`
                      : 'sem protesto'
                    : 'nunca consultado'
                }
              />
              <Linha rotulo="Filiais" valor={num(p.metricas?.qtd_filiais)} />
              <Linha rotulo="SPEs do grupo" valor={num(p.metricas?.grupo_spes_total)} />
              <Linha rotulo="Obras ativas" valor={num(p.metricas?.obras_ativas)} />
              <Linha
                rotulo="Certificado digital"
                valor={
                  p.certificado?.expires_at
                    ? `vence em ${new Date(p.certificado.expires_at).toLocaleDateString('pt-BR')}`
                    : 'não temos'
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
