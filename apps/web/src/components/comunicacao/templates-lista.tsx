'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Mail, MessageCircle, Plus } from 'lucide-react'
import {
  FUNIL_LABELS,
  VARIAVEIS_MENSAGEM,
  variavelEhAutomatica,
  variaveisDesconhecidasDoTemplate,
  variaveisDoTemplate,
  type Funil,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { salvarTemplateAction } from '@/actions/comunicacao'
import { CampoComVariaveis } from './campo-variaveis'
import { buscarTodosTemplates, type TemplateMensagem } from './queries'

/**
 * Os templates (§5). Config, não código.
 *
 * ── O CATÁLOGO NÃO SE DECORA: DIGITE `/` ───────────────────────────────────
 * Ele continua listado embaixo, para quem quiser ler tudo de uma vez. Mas a chave
 * certa se escolhe da lista que `/` abre no meio da frase, porque `{qtd_notas}`
 * só funciona escrito exatamente assim e ninguém devia ter que lembrar disso.
 *
 * As chaves desconhecidas continuam apontadas ANTES de salvar. Um `{taxa_do_dia}`
 * que ninguém preenche não some na renderização — ele sai literal na mensagem,
 * para o cliente ver. Avisar aqui é mais barato que descobrir lá.
 */
export function TemplatesLista() {
  const qc = useQueryClient()
  const consulta = useQuery({ queryKey: ['comunicacao', 'templates', 'todos'], queryFn: buscarTodosTemplates })
  const [editando, setEditando] = React.useState<TemplateMensagem | 'novo' | null>(null)

  if (consulta.isLoading) return <Skeleton className="h-64" />

  const templates = consulta.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditando('novo')}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Novo template
        </Button>
      </div>

      {editando ? (
        <Editor
          template={editando === 'novo' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            void qc.invalidateQueries({ queryKey: ['comunicacao', 'templates'] })
          }}
        />
      ) : null}

      <ul className="space-y-2">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setEditando(t)}
              className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                {t.canal === 'email' ? (
                  <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
                ) : (
                  <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
                <span className="font-medium">{t.nome}</span>
                {t.funil ? (
                  <Badge variant="outline" className="h-5 text-[10px]">
                    {FUNIL_LABELS[t.funil as Funil] ?? t.funil}
                  </Badge>
                ) : null}
                {!t.ativo ? (
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    inativo
                  </Badge>
                ) : null}
              </div>
              {t.assunto ? <p className="mt-1 text-sm">{t.assunto}</p> : null}
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.corpo}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Editor({
  template,
  onFechar,
  onSalvo,
}: {
  template: TemplateMensagem | null
  onFechar: () => void
  onSalvo: () => void
}) {
  const [nome, setNome] = React.useState(template?.nome ?? '')
  const [canal, setCanal] = React.useState(template?.canal ?? 'whatsapp')
  const [funil, setFunil] = React.useState(template?.funil ?? 'nenhum')
  const [assunto, setAssunto] = React.useState(template?.assunto ?? '')
  const [corpo, setCorpo] = React.useState(template?.corpo ?? '')
  const [ativo, setAtivo] = React.useState(template?.ativo ?? true)
  const [salvando, setSalvando] = React.useState(false)

  const usadas = variaveisDoTemplate(`${assunto}\n${corpo}`)
  const desconhecidas = variaveisDesconhecidasDoTemplate(`${assunto}\n${corpo}`)

  async function salvar() {
    setSalvando(true)
    try {
      const r = await salvarTemplateAction({
        id: template?.id ?? null,
        nome,
        canal,
        funil: funil === 'nenhum' ? null : funil,
        assunto: assunto || null,
        corpo,
        variaveis: usadas,
        ativo,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Template salvo.')
      onSalvo()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Canal</Label>
          <Select value={canal} onValueChange={setCanal}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">E-mail</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Funil</Label>
          <Select value={funil} onValueChange={setFunil}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhum">Qualquer</SelectItem>
              {Object.entries(FUNIL_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {canal === 'email' ? (
        <div className="space-y-1">
          <Label className="text-xs">Assunto</Label>
          <CampoComVariaveis value={assunto} onChange={setAssunto} />
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs">Corpo</Label>
        <CampoComVariaveis value={corpo} onChange={setCorpo} multiline rows={8} />
        <p className="text-[11px] text-muted-foreground">
          Digite <code className="rounded bg-muted px-1">/</code> para escolher uma variável.
        </p>
      </div>

      {desconhecidas.length > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Estas chaves não existem no catálogo e vão sair literais na mensagem:{' '}
            {desconhecidas.map((v) => `{${v}}`).join(', ')}
          </span>
        </p>
      ) : null}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Variáveis disponíveis</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {Object.entries(VARIAVEIS_MENSAGEM).map(([chave, descricao]) => (
            <li key={chave}>
              <code className="rounded bg-muted px-1">{`{${chave}}`}</code> — {descricao}
              {!variavelEhAutomatica(chave) ? ' (preenchida à mão)' : ''}
            </li>
          ))}
        </ul>
      </details>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Ativo
      </label>

      <div className="flex gap-2">
        <Button size="sm" onClick={salvar} disabled={!nome.trim() || !corpo.trim() || salvando}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
