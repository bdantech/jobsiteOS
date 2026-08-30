'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, PhoneOff } from 'lucide-react'
import { ACAO_LABELS, ACOES_AGENTE, FUNIL_LABELS, type AcaoAgente, type Funil } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { salvarPlaybookAction } from '@/actions/comunicacao'
import { buscarPlaybooks, type Playbook } from './queries'

/**
 * Os playbooks do agente (§7.3). Config, não código.
 *
 * ── EDITAR CRIA UMA VERSÃO NOVA ────────────────────────────────────────────
 * A anterior fica inativa e as decisões que ela produziu continuam apontando para
 * ela. Sobrescrever faria o painel de eficácia comparar resultados de instruções
 * diferentes sob o mesmo nome — a forma mais silenciosa de aprender errado.
 *
 * ── `ligar` APARECE E ESTÁ DESLIGADA ───────────────────────────────────────
 * Ela é uma ferramenta declarada (§7.2): o agente pode escolhê-la, o executor
 * recusa. Mostrá-la riscada é honesto e é o que faz o log de "quantas vezes ligar
 * era o passo certo" ter dono.
 */
export function PlaybooksLista({ ehAdmin }: { ehAdmin: boolean }) {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: ['comunicacao', 'playbooks'], queryFn: buscarPlaybooks })
  const [editando, setEditando] = React.useState<Playbook | null>(null)

  if (consulta.isLoading) return <Skeleton className="h-64" />

  const ativos = (consulta.data ?? []).filter((p) => p.ativo)
  const antigos = (consulta.data ?? []).filter((p) => !p.ativo)

  return (
    <div className="space-y-4">
      {editando ? (
        <Editor
          pb={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            void qc.invalidateQueries({ queryKey: ['comunicacao', 'playbooks'] })
          }}
        />
      ) : null}

      <ul className="space-y-3">
        {ativos.map((p) => (
          <li key={p.id} className="rounded-lg border p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 text-primary" aria-hidden />
              <span className="font-medium">{p.nome}</span>
              <Badge variant="outline" className="h-5 text-[10px]">
                {FUNIL_LABELS[p.funil as Funil] ?? p.funil}
              </Badge>
              <Badge variant="secondary" className="h-5 text-[10px]">
                v{p.versao}
              </Badge>
            </div>
            <p className="mb-2 text-sm text-muted-foreground">{p.instrucoes}</p>
            <div className="flex flex-wrap gap-1">
              {p.acoes_permitidas.map((a) => (
                <Badge key={a} variant="outline" className="h-5 text-[10px]">
                  {ACAO_LABELS[a as AcaoAgente] ?? a}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Silêncio: {(p.prazos as Record<string, number>)?.silencio_dias ?? '—'} dias · máx.{' '}
              {(p.prazos as Record<string, number>)?.max_tentativas ?? '—'} tentativas · desiste em{' '}
              {(p.prazos as Record<string, number>)?.desistir_apos_dias ?? '—'} dias
            </p>
            {ehAdmin ? (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditando(p)}>
                Editar (cria a v{p.versao + 1})
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {antigos.length > 0 ? (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Versões anteriores ({antigos.length})</summary>
          <ul className="mt-2 space-y-1">
            {antigos.map((p) => (
              <li key={p.id}>
                {p.nome} v{p.versao} — {FUNIL_LABELS[p.funil as Funil] ?? p.funil}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function Editor({ pb, onFechar, onSalvo }: { pb: Playbook; onFechar: () => void; onSalvo: () => void }) {
  const [instrucoes, setInstrucoes] = React.useState(pb.instrucoes)
  const [acoes, setAcoes] = React.useState<string[]>(pb.acoes_permitidas)
  const prazos = (pb.prazos ?? {}) as Record<string, number>
  const [silencio, setSilencio] = React.useState(String(prazos.silencio_dias ?? 3))
  const [tentativas, setTentativas] = React.useState(String(prazos.max_tentativas ?? 4))
  const [desistir, setDesistir] = React.useState(String(prazos.desistir_apos_dias ?? 21))
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      const r = await salvarPlaybookAction({
        id: pb.id,
        nome: pb.nome,
        funil: pb.funil,
        objetivo: pb.objetivo,
        instrucoes,
        acoes_permitidas: acoes,
        templates_disponiveis: pb.templates_disponiveis ?? [],
        prazos: {
          silencio_dias: Number(silencio),
          max_tentativas: Number(tentativas),
          desistir_apos_dias: Number(desistir),
        },
        ativo: true,
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
    <div className="space-y-3 rounded-lg border border-primary/40 p-4">
      <p className="text-sm font-medium">
        {pb.nome} — nova versão (v{pb.versao + 1})
      </p>

      <div className="space-y-1">
        <Label className="text-xs">Instruções para o modelo</Label>
        <Textarea value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)} rows={6} />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Ações permitidas</Label>
        <div className="flex flex-wrap gap-2">
          {ACOES_AGENTE.map((a) => {
            const desligada = a === 'ligar'
            const marcada = acoes.includes(a)
            return (
              <label
                key={a}
                className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                  marcada ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={(e) =>
                    setAcoes((atual) => (e.target.checked ? [...atual, a] : atual.filter((x) => x !== a)))
                  }
                />
                {ACAO_LABELS[a]}
                {desligada ? (
                  <span title="Ferramenta declarada e desligada — o executor recusa.">
                    <PhoneOff className="h-3 w-3 text-muted-foreground" aria-hidden />
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          O agente só escolhe daqui. Uma decisão fora desta lista é descartada e a cadência fixa
          assume.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Silêncio (dias)</Label>
          <Input type="number" value={silencio} onChange={(e) => setSilencio(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Máx. tentativas</Label>
          <Input type="number" value={tentativas} onChange={(e) => setTentativas(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Desiste após (dias)</Label>
          <Input type="number" value={desistir} onChange={(e) => setDesistir(e.target.value)} className="h-9" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={salvar} disabled={acoes.length === 0 || salvando}>
          Salvar nova versão
        </Button>
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
