'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpen, Coins, Lock } from 'lucide-react'
import {
  FERRAMENTAS,
  IDS_FERRAMENTAS,
  TIPO_MANDATO_LABELS,
  type Funil,
  type IdFerramenta,
  type TipoMandato,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { salvarPlaybookMandatoAction } from '@/actions/agentes-gestao'
import { dataHora } from './gestao-format'
import { buscarPlaybooksMandato, gestaoAgentesKeys, type PlaybookMandato } from './queries-gestao'

/**
 * PLAYBOOKS POR TIPO DE MANDATO (Prompt 09 §12) — o "como" de cada tipo de mandato.
 *
 * ─── MORA AQUI, E NÃO EM COMUNICAÇÃO ────────────────────────────────────────
 * A tela de Comunicação editava os dois tipos de playbook com as ações do agente de
 * CONVERSA e só para admin. Num playbook de mandato isso gravava nomes que o loop não
 * conhece, e a versão nova nascia sem `tipo_mandato` — o worker procura o playbook pelo
 * tipo e passava a não achar nenhum. Aqui a lista é o catálogo de FERRAMENTAS do loop, o
 * gestor de agentes edita, e a RPC herda o tipo da versão anterior.
 *
 * ─── EDITAR CRIA UMA VERSÃO NOVA ────────────────────────────────────────────
 * A anterior fica inativa; os mandatos já criados continuam nela (é o que o histórico
 * deles explica) e as regras de mandato que apontavam para ela passam para a nova.
 *
 * ─── TRÊS FERRAMENTAS NÃO SE DESMARCAM ──────────────────────────────────────
 * `atualizar_plano`, `escalar_humano` e `encerrar_mandato` são sempre visíveis ao modelo
 * (`ferramentasDisponiveis`, no core): sem elas o agente não cumpre a regra do ciclo nem
 * sai dele. A tela as mostra marcadas e travadas, para o checkbox não prometer um
 * controle que não existe.
 */

const ESSENCIAIS: readonly IdFerramenta[] = ['atualizar_plano', 'escalar_humano', 'encerrar_mandato']

function rotuloFerramenta(id: string): string {
  return (FERRAMENTAS as Record<string, { rotulo: string } | undefined>)[id]?.rotulo ?? id
}

function rotuloTipo(tipo: string | null): string {
  return tipo ? (TIPO_MANDATO_LABELS[tipo as TipoMandato] ?? tipo) : '—'
}

export function PlaybooksMandato() {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: gestaoAgentesKeys.playbooks(), queryFn: buscarPlaybooksMandato })
  const [editando, setEditando] = React.useState<PlaybookMandato | null>(null)

  const ativos = (consulta.data ?? []).filter((p) => p.ativo)
  const antigos = (consulta.data ?? []).filter((p) => !p.ativo)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" aria-hidden /> Playbooks por tipo de mandato
        </CardTitle>
        <CardDescription className="max-w-2xl">
          As instruções e as ferramentas que o agente usa em cada tipo de mandato. Editar cria uma
          versão nova: os mandatos em andamento seguem na versão com que nasceram, e os próximos
          usam a nova. Os playbooks do agente de conversa ficam em Comunicação › Playbooks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editando ? (
          <Editor
            pb={editando}
            onFechar={() => setEditando(null)}
            onSalvo={() => {
              setEditando(null)
              void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.playbooks() })
            }}
          />
        ) : null}

        {consulta.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : consulta.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os playbooks: {consulta.error.message}</p>
        ) : ativos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum playbook de mandato ativo. Sem ele, o agente trabalha só com as instruções gerais
            do tipo.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {ativos.map((p) => (
              <li key={p.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{p.nome}</p>
                  <Badge variant="neutral">{rotuloTipo(p.tipo_mandato)}</Badge>
                  <Badge variant="outline">v{p.versao}</Badge>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{p.instrucoes}</p>
                <div className="flex flex-wrap gap-1">
                  {p.acoes_permitidas.map((a) => (
                    <Badge key={a} variant="outline" className="h-5 text-[10px] font-normal">
                      {rotuloFerramenta(a)}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Última alteração: {dataHora(p.atualizado_em)}</p>
                  <Button size="sm" variant="outline" onClick={() => setEditando(p)} disabled={editando !== null}>
                    Editar (cria a v{p.versao + 1})
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {antigos.length > 0 ? (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Versões anteriores ({antigos.length})</summary>
            <ul className="mt-2 space-y-1">
              {antigos.map((p) => (
                <li key={p.id}>
                  {p.nome} v{p.versao} — {rotuloTipo(p.tipo_mandato)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Editor({
  pb,
  onFechar,
  onSalvo,
}: {
  pb: PlaybookMandato
  onFechar: () => void
  onSalvo: () => void
}) {
  const [instrucoes, setInstrucoes] = React.useState(pb.instrucoes)
  // Só o que o catálogo conhece: um nome fora dele (de uma edição antiga pela tela de
  // Comunicação) não tem checkbox para ser desmarcado e seria regravado para sempre.
  const [ferramentas, setFerramentas] = React.useState<string[]>(() => {
    const conhecidas = pb.acoes_permitidas.filter((a) => (IDS_FERRAMENTAS as readonly string[]).includes(a))
    return [...new Set([...conhecidas, ...ESSENCIAIS])]
  })
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const r = await salvarPlaybookMandatoAction({
        id: pb.id,
        nome: pb.nome,
        funil: pb.funil as Funil,
        objetivo: pb.objetivo,
        instrucoes,
        // Na ordem do catálogo, para a lista gravada ler igual à da tela.
        acoes_permitidas: IDS_FERRAMENTAS.filter((id) => ferramentas.includes(id)),
        templates_disponiveis: pb.templates_disponiveis ?? [],
        prazos: (pb.prazos ?? {}) as Record<string, number>,
        ativo: true,
        tipo_mandato: pb.tipo_mandato,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success(`Playbook salvo como v${pb.versao + 1}.`)
      onSalvo()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/40 bg-card p-4">
      <p className="text-sm font-medium">
        {pb.nome} — nova versão (v{pb.versao + 1}) · {rotuloTipo(pb.tipo_mandato)}
      </p>

      <div className="space-y-1">
        <Label htmlFor="playbook-mandato-instrucoes" className="text-xs">
          Instruções para o agente
        </Label>
        <Textarea
          id="playbook-mandato-instrucoes"
          value={instrucoes}
          onChange={(e) => setInstrucoes(e.target.value)}
          rows={8}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Ferramentas que o agente pode usar</Label>
        <div className="flex flex-wrap gap-2">
          {IDS_FERRAMENTAS.map((id) => {
            const essencial = ESSENCIAIS.includes(id)
            const marcada = essencial || ferramentas.includes(id)
            const paga = FERRAMENTAS[id].requerOrcamento
            return (
              <label
                key={id}
                title={essencial ? 'Sempre disponível: sem ela o agente não fecha o ciclo nem sai do mandato.' : id}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                  marcada ? 'border-primary bg-primary/5' : ''
                } ${essencial ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={marcada}
                  disabled={essencial}
                  onChange={(e) =>
                    setFerramentas((atual) =>
                      e.target.checked ? [...atual, id] : atual.filter((x) => x !== id),
                    )
                  }
                />
                {rotuloFerramenta(id)}
                {essencial ? <Lock className="h-3 w-3 text-muted-foreground" aria-label="sempre disponível" /> : null}
                {paga ? <Coins className="h-3 w-3 text-muted-foreground" aria-label="gasta orçamento" /> : null}
              </label>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          O agente só vê as marcadas. As que gastam orçamento (moeda) ainda somem num ciclo em que o
          saldo do mandato não cobre o custo delas.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={salvar} disabled={salvando || !instrucoes.trim()}>
          Salvar nova versão
        </Button>
        <Button size="sm" variant="ghost" onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
