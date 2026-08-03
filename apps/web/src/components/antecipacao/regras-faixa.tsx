'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Check, Info, Lightbulb, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import {
  FAIXAS,
  FAIXA_DESCRICOES,
  FAIXA_LABELS,
  descreverFaixa,
  faixaEngine,
  type Faixa,
  type Grupo,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConstrutorRegra } from '@/components/filtros/construtor-regra'
import { criarHelpersArvore } from '@/components/filtros/arvore'
import { ativarFaixaRegraAction, salvarFaixaRegraAction } from '@/actions/antecipacao'
import { vincularVersaoSugestaoAction } from '@/actions/perfil'
import { buscarSugestaoAceita, perfilKeys } from '@/components/mercado/perfil/queries'
import { cn } from '@/lib/utils'
import { FAIXA_BADGE, formatarDataHora } from './format'
import { antecipacaoKeys, buscarRegrasFaixa } from './queries'

/**
 * Editor de regras de faixa — mesmo padrão da pirâmide (§4): editor visual, regra
 * ativa em prosa, versões e ativação.
 *
 * Duas coisas que a UI não deixa esquecer:
 *
 * 1. SALVAR CRIA VERSÃO, nunca edita. Uma regra que já classificou notas é a
 *    explicação daquelas classificações; reescrevê-la apagaria o histórico que a
 *    tela de métricas usa para comparar v1 com v2.
 *
 * 2. ATIVAR RECLASSIFICA O FUNIL INTEIRO. Ativar sem reclassificar deixaria as
 *    notas carregando a faixa da regra ANTIGA — o Kanban mostraria um número que
 *    nenhuma regra ativa justifica. A ação já dispara o job.
 *
 * O catálogo aqui é o das FAIXAS (`faixaEngine`), sobre `notas_funil` — não o do
 * Mercado. Oferecer `capital_social` num editor de faixa montaria uma regra que
 * compila para uma coluna que a view do funil não tem.
 */

const helpers = criarHelpersArvore(faixaEngine)

/** Precedência que o job aplica ANTES de qualquer regra. Documentar evita duplicação. */
function Precedencia() {
  return (
    <div className={cn('space-y-1 rounded-lg border p-3 text-xs', STATUS_SUPERFICIE.info)}>
      <p className="flex items-center gap-1 font-medium">
        <Info className="h-3.5 w-3.5" aria-hidden />
        Duas condições valem antes de qualquer regra
      </p>
      <p>
        Fornecedor suprimido sai das faixas (motivo <code>suprimido</code>), e nota com prazo abaixo
        do mínimo operável sai das faixas (motivo <code>expirada</code>). Não repita essas duas
        condições nas regras — esquecer numa delas seria mandar mensagem para quem pediu para não
        ser abordado.
      </p>
    </div>
  )
}

function PainelFaixa({
  faixa,
  sugestao,
}: {
  faixa: Faixa
  /** Rascunho vindo do Perfil dos Clientes (04f §6). Nada é ativado por ele. */
  sugestao?: { logId: string; frase: string; arvore: Grupo } | null
}) {
  const qc = useQueryClient()
  /** null ⇒ o editor espelha a regra ativa; nenhuma edição local ainda. */
  const [rascunho, setRascunho] = React.useState<Grupo | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const [ativandoId, setAtivandoId] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.regras(faixa),
    queryFn: () => buscarRegrasFaixa(faixa),
  })

  const ativa = React.useMemo(() => (data ?? []).find((r) => r.ativa) ?? null, [data])

  // Trocar de faixa não pode carregar o rascunho: um editor com a árvore da faixa
  // boa enquanto o cabeçalho diz "alta" é como se salva a regra errada.
  //
  // A sugestão do Perfil chega JUNTO com a faixa, então entra neste mesmo efeito:
  // num segundo efeito ela seria apagada pela troca de faixa logo em seguida.
  React.useEffect(() => {
    setRascunho(sugestao?.arvore ?? null)
  }, [faixa, sugestao])

  const base = React.useMemo<Grupo>(
    () => helpers.arvoreDeJson(ativa?.definicao) ?? helpers.grupoPadrao(),
    [ativa],
  )
  const arvore = rascunho ?? base
  const problemas = React.useMemo(() => helpers.problemasDaArvore(arvore), [arvore])

  async function salvar(ativar: boolean) {
    setSalvando(true)
    const r = await salvarFaixaRegraAction({ faixa, definicao: arvore, ativar })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      ativar
        ? r.data.enfileirado
          ? `Regra v${r.data.regra.versao} ativada. Reclassificação do funil em andamento.`
          : `Regra v${r.data.regra.versao} ativada, mas o worker não aceitou o job: ${r.data.aviso ?? 'motivo desconhecido'}.`
        : `Regra v${r.data.regra.versao} salva (inativa).`,
    )
    setRascunho(null)
    // Fecha o ciclo do um-clique: o log passa a saber que versão a sugestão gerou.
    // Best-effort — a regra já foi salva, e uma falha aqui não desfaz nada.
    if (sugestao) {
      void vincularVersaoSugestaoAction({
        log_id: sugestao.logId,
        regra_versao_criada: r.data.regra.versao,
      })
    }
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  async function ativar(id: string) {
    setAtivandoId(id)
    const r = await ativarFaixaRegraAction(id)
    setAtivandoId(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.enfileirado
        ? `Regra v${r.data.regra.versao} ativada. Reclassificação em andamento.`
        : `Regra ativada, mas o worker não aceitou o job: ${r.data.aviso ?? 'motivo desconhecido'}.`,
    )
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={FAIXA_BADGE[faixa]}>{FAIXA_LABELS[faixa]}</Badge>
          <CardTitle className="text-base">Regra da faixa</CardTitle>
        </div>
        <CardDescription>{FAIXA_DESCRICOES[faixa]}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {sugestao && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Rascunho vindo do Perfil dos Clientes</p>
              <p className="text-xs leading-relaxed">
                {sugestao.frase} O ajuste já está no editor abaixo — confira e salve se concordar.
                Nada foi alterado ainda.
              </p>
            </div>
          </div>
        )}

        <Precedencia />

        {/* ─── Regra ativa ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Regra ativa
          </h3>

          {isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Erro desconhecido.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !ativa ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <div className="rounded-full bg-muted p-3">
                <SlidersHorizontal className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
              <div className="space-y-1">
                <p className="font-medium">Nenhuma regra ativa</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Sem regra ativa, nenhuma nota entra na faixa {FAIXA_LABELS[faixa]}. Monte uma no
                  editor abaixo.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="tabular-nums">
                  v{ativa.versao}
                </Badge>
                <span className="text-muted-foreground">
                  {formatarDataHora(ativa.criada_em)}
                  {ativa.autor_nome ? ` — ${ativa.autor_nome}` : ' — seed do sistema'}
                </span>
              </div>
              <div className="rounded-lg border bg-muted/40 p-4">
                {helpers.arvoreDeJson(ativa.definicao) ? (
                  <p className="text-sm leading-relaxed">
                    {descreverFaixa(helpers.arvoreDeJson(ativa.definicao) as Grupo)}
                  </p>
                ) : (
                  <p className="text-sm text-destructive">
                    A regra ativa usa uma variável que não existe mais no catálogo. Ela continua
                    valendo no banco — monte e ative uma nova versão para corrigir.
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Faixa é classificação COMPUTADA. Não confunda com estágio do funil, que só muda por
                ação humana.
              </p>
            </>
          )}
        </section>

        <Separator />

        {/* ─── Editor ───────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Editor
          </h3>

          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <ConstrutorRegra engine={faixaEngine} arvore={arvore} onChange={setRascunho} />

              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Como esta regra se lê
                </p>
                <p className="mt-1 text-sm leading-relaxed">
                  {problemas.length === 0 ? descreverFaixa(arvore) : '—'}
                </p>
              </div>

              {problemas.length > 0 && (
                <ul className={cn('space-y-1 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}>
                  {problemas.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={problemas.length > 0 || salvando}
                  onClick={() => void salvar(true)}
                >
                  <Check className="mr-2 h-4 w-4" aria-hidden />
                  {salvando ? 'Salvando…' : 'Salvar e ativar'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={problemas.length > 0 || salvando}
                  onClick={() => void salvar(false)}
                >
                  <Save className="mr-2 h-4 w-4" aria-hidden />
                  Salvar sem ativar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={rascunho === null}
                  onClick={() => setRascunho(null)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  Descartar alterações
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Salvar cria a próxima versão — nenhuma versão é editada. Ativar reclassifica o funil
                inteiro em segundo plano.
              </p>
            </>
          )}
        </section>

        <Separator />

        {/* ─── Histórico ────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Histórico de versões
          </h3>

          {isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma versão salva ainda.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {(data ?? []).map((r) => {
                const arv = helpers.arvoreDeJson(r.definicao)
                return (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="tabular-nums">
                          v{r.versao}
                        </Badge>
                        {r.ativa && <Badge className={FAIXA_BADGE[faixa]}>Ativa</Badge>}
                        <span className="text-xs text-muted-foreground">
                          {formatarDataHora(r.criada_em)}
                          {r.autor_nome ? ` — ${r.autor_nome}` : ' — seed'}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {arv ? descreverFaixa(arv) : 'Definição inválida para o catálogo atual.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {arv && (
                        <Button variant="ghost" size="sm" onClick={() => setRascunho(arv)}>
                          Usar como base
                        </Button>
                      )}
                      {!r.ativa && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={ativandoId === r.id}
                          onClick={() => void ativar(r.id)}
                        >
                          {ativandoId === r.id ? 'Ativando…' : 'Ativar'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

export function RegrasFaixa({ sugestaoLogId }: { sugestaoLogId?: string }) {
  const [faixa, setFaixa] = React.useState<Faixa>('alta')

  const { data: sugestao } = useQuery({
    queryKey: perfilKeys.sugestao(sugestaoLogId ?? ''),
    queryFn: () => buscarSugestaoAceita(sugestaoLogId as string),
    enabled: Boolean(sugestaoLogId),
  })

  // Chegando pelo um-clique, a faixa da sugestão abre sozinha.
  React.useEffect(() => {
    const alvo = sugestao?.sugestao.alvo
    if (alvo?.tipo === 'faixa') setFaixa(alvo.chave as Faixa)
  }, [sugestao])

  return (
    <div className="space-y-4">
      <Tabs value={faixa} onValueChange={(v) => setFaixa(v as Faixa)}>
        <TabsList>
          {FAIXAS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {FAIXA_LABELS[f]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">
        As faixas são avaliadas em ordem <strong>alta → boa → média</strong>; a primeira que casar
        define a faixa da nota.
      </p>

      <PainelFaixa
        faixa={faixa}
        sugestao={
          sugestao && sugestao.sugestao.alvo.chave === faixa
            ? {
                logId: sugestao.log_id,
                frase: sugestao.sugestao.frase,
                arvore: sugestao.sugestao.definicao_proposta,
              }
            : null
        }
      />
    </div>
  )
}
