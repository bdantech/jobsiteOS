'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, RotateCcw, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { editarParecerAction } from '@/actions/credito-analise'
import { analisePropriaKeys } from './queries'

/**
 * O parecer narrativo (04j §5).
 *
 * ─── UM RENDERIZADOR DE 30 LINHAS, E NÃO UMA BIBLIOTECA ─────────────────────
 * O formato do memorando é NOSSO e é fixo (oito seções em `##`, parágrafos, listas com
 * `-`, ênfase em `**`). Trazer react-markdown para essa gramática seria pagar uma
 * dependência, um bundle e uma superfície de sanitização por uma tela só. Aqui nada vira
 * HTML: cada pedaço vira nó de texto React, o que dispensa a pergunta de sanitização
 * inteira — e o texto vem de um modelo, então essa pergunta seria feita.
 *
 * ─── O ORIGINAL NUNCA SOME ──────────────────────────────────────────────────
 * Editar grava em outro campo. "A IA escreveu isso ou foi alguém?" precisa ter resposta
 * no dia em que o parecer for questionado, e ela não existe se a edição sobrescrever.
 */

/** Ênfase `**assim**` dentro de uma linha. Só isso — nada de links nem HTML. */
function comEnfase(texto: string): React.ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    ),
  )
}

function Memorando({ texto }: { texto: string }) {
  const blocos: React.ReactNode[] = []
  let lista: string[] = []

  const fecharLista = (chave: string) => {
    if (lista.length === 0) return
    blocos.push(
      <ul key={`ul-${chave}`} className="my-2 space-y-1 pl-4">
        {lista.map((item, i) => (
          <li key={i} className="list-disc text-sm">
            {comEnfase(item)}
          </li>
        ))}
      </ul>,
    )
    lista = []
  }

  texto.split('\n').forEach((linha, i) => {
    const l = linha.trim()
    if (l.startsWith('- ') || l.startsWith('* ')) {
      lista.push(l.slice(2))
      return
    }
    fecharLista(String(i))
    if (l === '') return
    if (l.startsWith('### ')) {
      blocos.push(
        <h4 key={i} className="mt-4 text-sm font-semibold">
          {l.slice(4)}
        </h4>,
      )
      return
    }
    if (l.startsWith('## ')) {
      blocos.push(
        <h3 key={i} className="mt-5 border-b pb-1 text-base font-semibold first:mt-0">
          {l.slice(3)}
        </h3>,
      )
      return
    }
    if (l.startsWith('# ')) {
      blocos.push(
        <h2 key={i} className="mt-5 text-lg font-semibold first:mt-0">
          {l.slice(2)}
        </h2>,
      )
      return
    }
    blocos.push(
      <p key={i} className="my-2 text-sm leading-relaxed">
        {comEnfase(l)}
      </p>,
    )
  })
  fecharLista('fim')

  return <div>{blocos}</div>
}

export function Parecer({
  analiseId,
  analiseCreditoId,
  original,
  editado,
  modelo,
  tokens,
  editadoEm,
}: {
  analiseId: string
  analiseCreditoId: string
  original: string | null
  editado: string | null
  modelo: string | null
  tokens: number | null
  editadoEm: string | null
}) {
  const qc = useQueryClient()
  const [editando, setEditando] = React.useState(false)
  const [rascunho, setRascunho] = React.useState(editado ?? original ?? '')
  const [salvando, setSalvando] = React.useState(false)
  const [verOriginal, setVerOriginal] = React.useState(false)

  if (!original) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          O parecer é escrito depois do cálculo. Ele ainda não foi gerado para esta análise.
        </CardContent>
      </Card>
    )
  }

  const exibido = verOriginal ? original : (editado ?? original)

  async function salvar() {
    setSalvando(true)
    const r = await editarParecerAction({ id: analiseId, texto: rascunho })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Parecer salvo. A versão original do modelo continua guardada.')
    setEditando(false)
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
            Parecer
            {editado && (
              <Badge variant="secondary" className="text-[10px]">
                editado
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {editado && (
              <Button variant="ghost" size="sm" onClick={() => setVerOriginal((v) => !v)}>
                <RotateCcw className="mr-1 h-3 w-3" aria-hidden />
                {verOriginal ? 'Ver o editado' : 'Ver o original'}
              </Button>
            )}
            {!editando && (
              <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
                <Pencil className="mr-1 h-3 w-3" aria-hidden />
                Editar
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          Texto gerado por IA sobre números já calculados. Ele comenta o limite — não o altera.
          {modelo ? ` Modelo: ${modelo}.` : ''}
          {tokens ? ` ${tokens.toLocaleString('pt-BR')} tokens.` : ''}
          {editadoEm ? ` Editado em ${new Date(editadoEm).toLocaleDateString('pt-BR')}.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {editando ? (
          <div className="space-y-2">
            <Textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={24}
              className="font-mono text-xs"
              aria-label="Parecer em markdown"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRascunho(editado ?? original ?? '')
                  setEditando(false)
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Memorando texto={exibido} />
        )}
      </CardContent>
    </Card>
  )
}
