'use client'

import * as React from 'react'
import { AlertTriangle, ArrowRight, Lightbulb } from 'lucide-react'
import { comparacao as acharComparacao, type Sugestao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SugestaoCard } from './sugestao-card'

/**
 * Todas as sugestões da trilha, agrupadas por RÉGUA.
 *
 * A tela continua mostrando cada sugestão dentro da comparação que a gerou — é
 * ali que a evidência está. Este modal responde outra pergunta: "o que, no
 * total, está sendo proposto para a regra de SOM?".
 *
 * E foi montando ele que apareceu o motivo de verdade para existir: a MESMA
 * condição é sugerida por comparações diferentes, com valores diferentes. Capital
 * social sai de "≥ 500 mil" para um valor quando quem manda é a coorte de
 * clientes, e para outro quando é a de sacados pesados. Na página, as duas
 * propostas ficam a oitocentos pixels de distância e ninguém percebe que são a
 * mesma linha da regra. Aqui elas ficam lado a lado, marcadas como conflito.
 *
 * Aceitar uma delas leva ao editor com AQUELA árvore. Não há como aplicar as
 * duas — e é bom que não haja: são propostas concorrentes para o mesmo corte, e
 * escolher é o trabalho.
 */

interface Grupo {
  chave: string
  titulo: string
  sugestoes: Array<Sugestao & { snapshotId: string; comparacaoLabel: string }>
}

export function SugestoesModal({
  sugestoes,
  total,
  onDecidida,
}: {
  sugestoes: Array<Sugestao & { snapshotId: string; comparacao: string }>
  total: number
  onDecidida: () => void
}) {
  const [aberto, setAberto] = React.useState(false)

  const grupos = React.useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>()
    for (const s of sugestoes) {
      const chave = `${s.alvo.tipo}:${s.alvo.chave}`
      const titulo =
        s.alvo.tipo === 'camada'
          ? `Regra de camada — ${s.alvo.chave.toUpperCase()} (v${s.alvo.versao})`
          : `Regra de faixa — ${s.alvo.chave} (v${s.alvo.versao})`
      const grupo = mapa.get(chave) ?? { chave, titulo, sugestoes: [] }
      grupo.sugestoes.push({
        ...s,
        comparacaoLabel: acharComparacao(s.comparacao)?.label ?? s.comparacao,
      })
      mapa.set(chave, grupo)
    }
    return [...mapa.values()].sort((a, b) => a.titulo.localeCompare(b.titulo))
  }, [sugestoes])

  if (total === 0) return null

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Lightbulb className="mr-2 h-4 w-4" aria-hidden />
          Ver todas as sugestões ({total})
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sugestões de ajuste, por régua</DialogTitle>
          <DialogDescription>
            As mesmas sugestões da página, reunidas pela regra que cada uma altera. Aceitar abre o
            editor com o ajuste no rascunho — nada é ativado daqui.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {grupos.map((g) => (
            <GrupoDeRegra key={g.chave} grupo={g} onDecidida={onDecidida} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GrupoDeRegra({ grupo, onDecidida }: { grupo: Grupo; onDecidida: () => void }) {
  // Duas sugestões que mexem na MESMA condição são concorrentes, não
  // complementares: só uma pode valer. `de` identifica a condição de origem.
  const porCondicao = new Map<string, number>()
  for (const s of grupo.sugestoes) porCondicao.set(s.de, (porCondicao.get(s.de) ?? 0) + 1)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <h3 className="text-sm font-medium">{grupo.titulo}</h3>
        <Badge variant="secondary">{grupo.sugestoes.length}</Badge>
      </div>

      {grupo.sugestoes.map((s) => {
        const concorrentes = (porCondicao.get(s.de) ?? 1) > 1
        return (
          <div key={s.id} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>a partir de: {s.comparacaoLabel}</span>
              {concorrentes && (
                <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  propostas concorrentes para a mesma condição
                </Badge>
              )}
            </div>
            <SugestaoCard sugestao={s} snapshotId={s.snapshotId} onDecidida={onDecidida} />
          </div>
        )
      })}

      {[...porCondicao.entries()]
        .filter(([, n]) => n > 1)
        .map(([de, n]) => (
          <p
            key={de}
            className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              {n} coortes diferentes propõem valores diferentes para <strong>{de}</strong>. Só uma
              pode valer — a mais frouxa inclui mais gente e admite mais ruído. Vale olhar o
              impacto simulado das duas antes de escolher.
            </span>
          </p>
        ))}
    </section>
  )
}
