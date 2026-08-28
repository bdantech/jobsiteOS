'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Pencil, Sparkles } from 'lucide-react'
import { AVISO_PARECER, RISCO_LABELS, type Risco, type Tables } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { editarParecerAction, gerarParecerAction } from '@/actions/juridico'
import { juridicoKeys } from './queries'
import { dataHora } from './format'

/**
 * Parecer jurídico de IA (08 §7).
 *
 * ── O AVISO É FIXO E NÃO SAI DA TELA ───────────────────────────────────────
 * Não é disclaimer de rodapé: é a diferença entre um resumo que ajuda a preparar a
 * conversa com o advogado e um texto que alguém junta aos autos. Ele fica acima do
 * parecer, não abaixo, porque a primeira coisa lida tem de ser a ressalva.
 *
 * ── EDITADO É MARCADO, E VERSIONADO ────────────────────────────────────────
 * A tela distingue "o modelo disse" de "o advogado escreveu". Misturar os dois é
 * como um texto de IA vira citação de autoridade dentro da própria casa — e a edição
 * grava uma linha NOVA, porque a recomendação anterior sustentou uma decisão que
 * alguém pode precisar reler.
 */

const RISCO_COR: Record<Risco, string> = {
  baixo: 'text-emerald-600',
  medio: 'text-amber-600',
  alto: 'text-destructive',
}

/** Markdown mínimo: títulos ##, listas e parágrafos. O parecer não usa mais que isso. */
function Markdown({ texto }: { texto: string }) {
  const blocos = texto.split('\n')
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocos.map((linha, i) => {
        const chave = `${i}-${linha.slice(0, 12)}`
        if (linha.startsWith('## ')) {
          return (
            <h3 key={chave} className="pt-2 text-sm font-semibold">
              {linha.slice(3)}
            </h3>
          )
        }
        if (linha.startsWith('# ')) {
          return (
            <h2 key={chave} className="pt-2 text-base font-semibold">
              {linha.slice(2)}
            </h2>
          )
        }
        if (/^[-*] /.test(linha)) {
          return (
            <div key={chave} className="flex gap-2 pl-2">
              <span aria-hidden>•</span>
              <span>{linha.slice(2)}</span>
            </div>
          )
        }
        if (linha.trim() === '') return null
        return <p key={chave}>{linha}</p>
      })}
    </div>
  )
}

export function ParecerCard({
  numeroCnj,
  pareceres,
}: {
  numeroCnj: string
  pareceres: Tables<'processo_pareceres'>[]
}) {
  const qc = useQueryClient()
  const [gerando, setGerando] = React.useState(false)
  const [editando, setEditando] = React.useState(false)
  const atual = pareceres[0] ?? null

  const [texto, setTexto] = React.useState(atual?.parecer_markdown ?? '')
  const [proximoPasso, setProximoPasso] = React.useState(atual?.proximo_passo ?? '')

  React.useEffect(() => {
    setTexto(atual?.parecer_markdown ?? '')
    setProximoPasso(atual?.proximo_passo ?? '')
  }, [atual?.id, atual?.parecer_markdown, atual?.proximo_passo])

  async function gerar() {
    setGerando(true)
    const r = await gerarParecerAction(numeroCnj)
    setGerando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: juridicoKeys.pareceres(numeroCnj) })
    toast.success(`Parecer gerado (${r.data.tokens.toLocaleString('pt-BR')} tokens).`)
  }

  async function salvar() {
    const r = await editarParecerAction({
      numero_cnj: numeroCnj,
      parecer_markdown: texto,
      proximo_passo: proximoPasso,
      risco: atual?.risco ?? null,
    })
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setEditando(false)
    void qc.invalidateQueries({ queryKey: juridicoKeys.pareceres(numeroCnj) })
    toast.success('Versão salva. A anterior foi preservada.')
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Parecer jurídico</CardTitle>
        <div className="flex gap-2">
          {atual && !editando ? (
            <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
              <Pencil className="mr-1 h-3 w-3" />
              Editar
            </Button>
          ) : null}
          <Button size="sm" onClick={gerar} disabled={gerando}>
            <Sparkles className="mr-1 h-4 w-4" />
            {gerando ? 'Gerando…' : atual ? 'Gerar de novo' : 'Gerar parecer'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* O aviso ACIMA do texto, sempre — inclusive quando não há parecer nenhum. */}
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>{AVISO_PARECER}</span>
        </div>

        {!atual ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum parecer gerado. A geração custa tokens sobre todas as movimentações do processo.
          </p>
        ) : editando ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="proximo-passo">Próximo passo recomendado</Label>
              <Input
                id="proximo-passo"
                value={proximoPasso}
                onChange={(e) => setProximoPasso(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="parecer">Parecer</Label>
              <Textarea
                id="parecer"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={20}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={salvar}>
                Salvar como nova versão
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {atual.risco ? (
                <Badge variant="outline" className={RISCO_COR[atual.risco as Risco]}>
                  Risco {RISCO_LABELS[atual.risco as Risco]}
                </Badge>
              ) : null}
              {atual.editado ? (
                <Badge variant="secondary">Editado por uma pessoa</Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Bot className="h-3 w-3" aria-hidden />
                  {atual.modelo ?? 'IA'}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{dataHora(atual.criado_em)}</span>
              {pareceres.length > 1 ? (
                <span className="text-xs text-muted-foreground">
                  · versão {pareceres.length} de {pareceres.length}
                </span>
              ) : null}
            </div>

            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Próximo passo recomendado
              </div>
              <p className="text-sm">{atual.proximo_passo}</p>
            </div>

            <Markdown texto={atual.parecer_markdown} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
