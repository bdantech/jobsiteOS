'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Layers, RotateCcw, Save } from 'lucide-react'
import {
  CAMADAS_COM_REGRA,
  CAMADA_DESCRICOES,
  CAMADA_LABELS,
  descrever,
  type Camada,
  type CamadaComRegra,
  type Grupo,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { grupoPadrao, problemasDaArvore } from './arvore'
import { ConstrutorRegra } from './construtor-regra'
import { CAMADA_BADGE, formatDataHora, formatInteiro, formatParticipacao } from './constants'
import { HistoricoRegras } from './historico-regras'
import { PreviewDialog } from './preview-dialog'
import { buscarRegras, piramideKeys, type ContagensPiramide } from './queries'

/**
 * The rule of ONE layer, in full width: the active rule in prose, the visual builder,
 * and the version history — stacked as sections.
 *
 * They used to be three TABS inside a 28rem side column, and that column was the bug:
 * a condition row of the builder is variable + operator + value + delete, and at 448px
 * those four collapse onto each other. Full width, all three sections fit at once and
 * the tabs stop being necessary — you can read the rule you are editing while you edit
 * it, which is the whole point of the prose line.
 *
 * `universo` has no rule panel on purpose: it is not computed, it is the REMAINDER.
 * Nothing "matches" the universe; a company is in it because no layer's rule claimed
 * it. Giving it a rule editor would suggest otherwise.
 */

function ehCamadaComRegra(camada: Camada): camada is CamadaComRegra {
  return (CAMADAS_COM_REGRA as readonly Camada[]).includes(camada)
}

interface RegraCamadaProps {
  camada: Camada
  contagens: ContagensPiramide
}

// ─── Cabeçalho ──────────────────────────────────────────────────────────────

function Cabecalho({ camada, contagens }: RegraCamadaProps) {
  const total = contagens.porCamada[camada] ?? 0

  return (
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={CAMADA_BADGE[camada]}>{CAMADA_LABELS[camada]}</Badge>
        <CardTitle className="text-base">Regra da camada</CardTitle>
        <span className="text-sm tabular-nums text-muted-foreground">
          · {formatInteiro(total)} empresas · {formatParticipacao(total, contagens.total)} do
          universo
        </span>
      </div>
      <CardDescription>{CAMADA_DESCRICOES[camada]}</CardDescription>
    </CardHeader>
  )
}

/** A section title inside the card — the tabs used to do this job. */
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

// ─── Universo ───────────────────────────────────────────────────────────────

function RegraUniverso(props: RegraCamadaProps) {
  return (
    <Card>
      <Cabecalho {...props} />
      <CardContent>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <div className="rounded-full bg-muted p-3">
            <Layers className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">O universo não tem regra</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ele é o resto: toda empresa do staging da Receita que nenhuma regra de TAM, SAM ou SOM
              reivindicou. Para mudar o que fica aqui, mude a regra do TAM.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Camada com regra ───────────────────────────────────────────────────────

function RegraComRegra({
  camada,
  contagens,
}: {
  camada: CamadaComRegra
  contagens: ContagensPiramide
}) {
  /** null ⇒ the editor still mirrors the active rule; no local edit yet. */
  const [rascunho, setRascunho] = React.useState<Grupo | null>(null)
  const [previewAberto, setPreviewAberto] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: piramideKeys.regras(camada),
    queryFn: () => buscarRegras(camada),
  })

  const regraAtiva = React.useMemo(() => (data ?? []).find((r) => r.ativa) ?? null, [data])

  // Switching layers must not carry the draft across: an editor holding SAM's
  // tree while the header says TAM is how someone saves the wrong rule.
  React.useEffect(() => {
    setRascunho(null)
    setPreviewAberto(false)
  }, [camada])

  const base = React.useMemo<Grupo>(() => regraAtiva?.definicao ?? grupoPadrao(), [regraAtiva])

  const arvoreEditor = rascunho ?? base
  const problemas = React.useMemo(() => problemasDaArvore(arvoreEditor), [arvoreEditor])
  const alterado = rascunho !== null

  return (
    <Card>
      <Cabecalho camada={camada} contagens={contagens} />

      <CardContent className="space-y-6">
        {/* ─── Regra ativa ───────────────────────────────────────────────── */}
        <Secao titulo="Regra ativa">
          {isPending ? (
            <>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">Não foi possível carregar a regra</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : 'Erro desconhecido.'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !regraAtiva ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <Layers className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Nenhuma regra ativa</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Sem regra ativa, nenhuma empresa entra em {CAMADA_LABELS[camada]}. Monte uma no
                  editor abaixo.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="tabular-nums">
                  v{regraAtiva.versao}
                </Badge>
                <span className="text-muted-foreground">
                  {formatDataHora(regraAtiva.criada_em)}
                  {regraAtiva.autor_nome ? ` — ${regraAtiva.autor_nome}` : ' — seed do sistema'}
                </span>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4">
                {regraAtiva.definicao ? (
                  <p className="text-sm leading-relaxed">{descrever(regraAtiva.definicao)}</p>
                ) : (
                  <p className="text-sm text-destructive">
                    A regra ativa usa uma variável que não existe mais no catálogo. Ela continua
                    valendo no banco — monte e ative uma nova versão para corrigir.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Camada é classificação de mercado — o quanto a empresa se encaixa. Não confunda com
                estágio, que é o histórico de relacionamento e só muda por ação humana.
              </p>
            </>
          )}
        </Secao>

        <Separator />

        {/* ─── Editor ────────────────────────────────────────────────────── */}
        <Secao titulo="Editor">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <ConstrutorRegra arvore={arvoreEditor} onChange={setRascunho} />

              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Como esta regra se lê
                </p>
                <p className="mt-1 text-sm leading-relaxed">
                  {problemas.length === 0 ? descrever(arvoreEditor) : '—'}
                </p>
              </div>

              {problemas.length > 0 && (
                <ul
                  className={cn('space-y-1 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}
                >
                  {problemas.map((problema, indice) => (
                    <li key={indice}>{problema}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={problemas.length > 0}
                  onClick={() => setPreviewAberto(true)}
                >
                  <Save className="mr-2 h-4 w-4" aria-hidden />
                  Salvar como nova versão
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  disabled={!alterado}
                  onClick={() => setRascunho(null)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  Descartar alterações
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Salvar cria a próxima versão — nenhuma versão é editada. Antes de gravar, você vê
                quantas empresas a regra move.
              </p>
            </>
          )}
        </Secao>

        <Separator />

        {/* ─── Histórico ─────────────────────────────────────────────────── */}
        <Secao titulo="Histórico de versões">
          <HistoricoRegras camada={camada} onUsarComoBase={setRascunho} />
        </Secao>
      </CardContent>

      {previewAberto && problemas.length === 0 && (
        <PreviewDialog
          aberto={previewAberto}
          onOpenChange={setPreviewAberto}
          camada={camada}
          modo={{ tipo: 'salvar', arvore: arvoreEditor }}
          onConcluido={() => {
            // The saved tree is now the active one (or a new version in history);
            // dropping the draft makes the editor mirror the server again.
            setRascunho(null)
          }}
        />
      )}
    </Card>
  )
}

export function RegraCamada({ camada, contagens }: RegraCamadaProps) {
  return ehCamadaComRegra(camada) ? (
    <RegraComRegra camada={camada} contagens={contagens} />
  ) : (
    <RegraUniverso camada={camada} contagens={contagens} />
  )
}
