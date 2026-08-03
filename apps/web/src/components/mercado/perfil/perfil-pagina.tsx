'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Info, RefreshCw, Users } from 'lucide-react'
import {
  AVISO_VIES,
  TRILHAS,
  TRILHA_LABELS,
  TRILHA_PERGUNTAS,
  comparacao as acharComparacao,
  type Trilha,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { recalcularPerfilAction } from '@/actions/perfil'
import { AchadoCard } from './achado-card'
import { AuditoriaSecao } from './auditoria-secao'
import { SugestaoCard } from './sugestao-card'
import { SugestoesModal } from './sugestoes-modal'
import { buscarPerfil, perfilKeys, type SnapshotPerfil } from './queries'

/**
 * Perfil de Quem Opera (04f §7), no módulo Mercado.
 *
 * A ordem da página é a ordem de uma conversa honesta: o retrato em uma frase,
 * a evidência que o sustenta, o que a régua atual erra, e só então o que fazer a
 * respeito. O aviso de viés fecha, e não abre, porque um aviso no topo é lido
 * como disclaimer e ignorado; no fim, ele é lido como conclusão.
 *
 * O painel NUNCA calcula nada. Tudo vem do último snapshot do worker — inclusive
 * a frase do resumo, que é template e não IA. Um resumo gerado por modelo pode
 * suavizar ou inventar uma causa, e a frase do topo é a que vai ser repetida numa
 * reunião como se fosse um fato medido.
 */

const MAX_ACHADOS_PRINCIPAIS = 6

export function PerfilPagina({ podeRecalcular }: { podeRecalcular: boolean }) {
  const [trilha, setTrilha] = React.useState<Trilha>('sacados')
  const qc = useQueryClient()
  const [rodando, setRodando] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: perfilKeys.trilha(trilha),
    queryFn: () => buscarPerfil(trilha),
  })

  async function recalcular() {
    setRodando(true)
    const r = await recalcularPerfilAction()
    setRodando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.enfileirado
        ? 'Recálculo enfileirado. Ele varre as coortes inteiras — recarregue em alguns minutos.'
        : (r.data.aviso ?? 'O worker não aceitou o job.'),
    )
  }

  // O id da sugestão agora carrega a COMPARAÇÃO que a gerou
  // (`clientes_x_som:afrouxar:sam:3`). Antes não carregava, e as duas comparações
  // da trilha de sacados produziam `afrouxar:sam:3` idêntico — descartar numa
  // fazia a sugestão sumir da outra junto, porque a chave de decisão é o id.
  const decisoes = new Map((data?.decisoes ?? []).map((d) => [d.sugestao_id, d]))

  // Todas as sugestões ainda pendentes da trilha, para o modal agrupado.
  const pendentesDaTrilha = (data?.snapshots ?? []).flatMap((s) =>
    (s.sugestoes ?? [])
      .filter((x) => !decisoes.has(x.id))
      .map((x) => ({ ...x, snapshotId: s.id, comparacao: s.comparacao })),
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Perfil dos Clientes</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            O que as empresas que realmente operam têm em comum — e onde a régua vigente as deixa de
            fora. Cada achado vira, no máximo, uma sugestão de ajuste: nada aqui muda regra sozinho.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SugestoesModal
            sugestoes={pendentesDaTrilha}
            total={pendentesDaTrilha.length}
            onDecidida={() => void qc.invalidateQueries({ queryKey: perfilKeys.trilha(trilha) })}
          />
          {podeRecalcular && (
            <Button variant="outline" size="sm" onClick={() => void recalcular()} disabled={rodando}>
              <RefreshCw className={`mr-2 h-4 w-4 ${rodando ? 'animate-spin' : ''}`} aria-hidden />
              Recalcular agora
            </Button>
          )}
        </div>
      </header>

      <Tabs value={trilha} onValueChange={(v) => setTrilha(v as Trilha)}>
        <TabsList>
          {TRILHAS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TRILHA_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">{TRILHA_PERGUNTAS[trilha]}</p>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Erro ao carregar o perfil.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (data?.snapshots ?? []).length === 0 ? (
        <NuncaCalculado podeRecalcular={podeRecalcular} />
      ) : (
        (data as { snapshots: SnapshotPerfil[] }).snapshots.map((s) => (
          <Comparacao
            key={s.id}
            snapshot={s}
            decisoes={decisoes}
            onDecidida={() => void qc.invalidateQueries({ queryKey: perfilKeys.trilha(trilha) })}
          />
        ))
      )}

      <AvisoVies />
    </div>
  )
}

// ─── Uma comparação ─────────────────────────────────────────────────────────

function Comparacao({
  snapshot,
  decisoes,
  onDecidida,
}: {
  snapshot: SnapshotPerfil
  decisoes: Map<string, { acao: string }>
  onDecidida: () => void
}) {
  const [verTudo, setVerTudo] = React.useState(false)
  const meta = acharComparacao(snapshot.comparacao)
  const r = snapshot.resultados

  const principais = r.achados.filter((a) => !a.suprimido)
  const visiveis = verTudo ? r.achados : principais.slice(0, MAX_ACHADOS_PRINCIPAIS)
  const ocultos = r.achados.length - visiveis.length

  // Sugestões já decididas somem (§7.4). O log preserva — e a decisão não se
  // repete todo mês como se ninguém tivesse olhado.
  const pendentes = (snapshot.sugestoes ?? []).filter((s) => !decisoes.has(s.id))

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{meta?.label ?? snapshot.comparacao}</CardTitle>
            <Badge variant="secondary" className="gap-1 tabular-nums">
              <Users className="h-3 w-3" aria-hidden />
              {snapshot.coorte_a} × {snapshot.coorte_b}
            </Badge>
            <span className="text-xs text-muted-foreground">
              calculado em {new Date(snapshot.calculado_em).toLocaleDateString('pt-BR')}
            </span>
          </div>
          {meta?.descricao && <CardDescription>{meta.descricao}</CardDescription>}
        </CardHeader>
        <CardContent>
          <p className="rounded-lg bg-muted/50 p-4 text-sm leading-relaxed">{r.resumo}</p>
        </CardContent>
      </Card>

      {visiveis.length > 0 && (
        <div className="space-y-3">
          {visiveis.map((a) => (
            <AchadoCard
              key={a.variavel}
              achado={a}
              rotulos={r.rotulos}
              rotuloA={r.rotulo_a}
              rotuloB={r.rotulo_b}
            />
          ))}
          {(ocultos > 0 || verTudo) && (
            <Button variant="ghost" size="sm" onClick={() => setVerTudo((v) => !v)}>
              {verTudo
                ? 'Mostrar só os principais'
                : `Ver todas as ${r.achados.length} variáveis (${ocultos} ocultas por dado escasso ou lift baixo)`}
            </Button>
          )}
        </div>
      )}

      <AuditoriaSecao auditoria={snapshot.auditoria} rotuloCoorte={r.rotulo_a} />

      {pendentes.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Sugestões de ajuste</h2>
          {pendentes.map((s) => (
            <SugestaoCard
              key={s.id}
              sugestao={s}
              snapshotId={snapshot.id}
              onDecidida={onDecidida}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhuma sugestão de ajuste nesta comparação. Uma sugestão só nasce com evidência sólida:
          célula com amostra dos dois lados, cobertura suficiente e lift alto. Sem isso, o sistema
          prefere não sugerir a sugerir com base em ruído.
        </p>
      )}
    </section>
  )
}

// ─── Estados de borda ───────────────────────────────────────────────────────

function NuncaCalculado({ podeRecalcular }: { podeRecalcular: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="rounded-full bg-muted p-3">
          <Users className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Este perfil ainda não foi calculado</p>
          <p className="max-w-md text-sm text-muted-foreground">
            O cálculo roda uma vez por mês, depois das calibrações de faturamento e de crédito — ele
            lê os números delas.
            {podeRecalcular ? ' Você pode antecipá-lo pelo botão acima.' : ''}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * O aviso de viés (§7.5). Fixo no rodapé de toda aba, e com o texto vindo do
 * core — a mesma frase aparece no mobile e na resposta do assistente. Um aviso
 * que existe na tela e some na resposta do assistente é um aviso que não existe.
 */
function AvisoVies() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{AVISO_VIES}</p>
    </div>
  )
}
