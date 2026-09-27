'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { TIPOS_MATERIAL, TIPO_MATERIAL_LABELS, type TipoMaterial } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { salvarMaterialAction } from '@/actions/agentes-gestao'
import { nomeDeArquivoSeguro } from './gestao-format'
import { enviarArquivoAgentes, gestaoAgentesKeys, type Material } from './queries-gestao'

/**
 * O CADASTRO DE UM MATERIAL (§5).
 *
 * ─── `quando_usar` É O CAMPO QUE O AGENTE LÊ ────────────────────────────────
 * O agente recebe o catálogo (nome + descrição + QUANDO USAR + canais) e escolhe. Sem
 * esse campo, ou ele manda o material errado, ou não manda nenhum. Por isso ele é
 * obrigatório, tem mínimo de dez letras e fica em destaque no formulário: "apresentação
 * institucional" é um nome; "quando o decisor pediu algo por escrito antes de uma
 * reunião, ou disse que não conhece a One" é um critério.
 *
 * ─── O ARQUIVO SOBE ANTES, O REGISTRO DEPOIS ────────────────────────────────
 * O upload vai do navegador ao bucket privado `agentes-materiais` com o client do
 * usuário (só gestor escreve), em `materiais/<uuid>/<arquivo>`. Se a gravação do registro
 * falhar depois disso, sobra um arquivo órfão no bucket — o contrário (registro apontando
 * para arquivo que não existe) faria o agente mandar um link quebrado ao cliente.
 */

const TIPOS_COM_ARQUIVO: readonly TipoMaterial[] = ['pdf', 'imagem', 'video']

/** Os tipos que o bucket aceita (0270c), por tipo de material. */
const MIMES: Record<'pdf' | 'imagem' | 'video', string[]> = {
  pdf: ['application/pdf'],
  imagem: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4'],
}

const LIMITE_BYTES = 25 * 1024 * 1024

interface Rascunho {
  nome: string
  descricao: string
  quando_usar: string
  tipo: TipoMaterial
  arquivo_path: string | null
  url: string
  corpo: string
  tags: string
  email: boolean
  whatsapp: boolean
  ativo: boolean
}

function rascunhoDe(m: Material | null): Rascunho {
  return {
    nome: m?.nome ?? '',
    descricao: m?.descricao ?? '',
    quando_usar: m?.quando_usar ?? '',
    tipo: (m?.tipo as TipoMaterial) ?? 'pdf',
    arquivo_path: m?.arquivo_path ?? null,
    url: m?.url ?? '',
    corpo: m?.corpo ?? '',
    tags: (m?.tags ?? []).join(', '),
    email: m ? m.canais.includes('email') : true,
    whatsapp: m ? m.canais.includes('whatsapp') : true,
    ativo: m?.ativo ?? true,
  }
}

/** O payload de `materialSchema` a partir de uma linha — para desativar sem abrir o formulário. */
export function payloadDoMaterial(m: Material, mudancas: Partial<{ ativo: boolean }> = {}) {
  return {
    id: m.id,
    nome: m.nome,
    descricao: m.descricao,
    quando_usar: m.quando_usar,
    tipo: m.tipo,
    arquivo_path: m.arquivo_path,
    url: m.url,
    corpo: m.corpo,
    tags: m.tags,
    canais: m.canais,
    ativo: m.ativo,
    ...mudancas,
  }
}

export function MaterialForm({
  aberto,
  material,
  onFechar,
}: {
  aberto: boolean
  material: Material | null
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const [r, setR] = React.useState<Rascunho>(() => rascunhoDe(material))
  const [arquivo, setArquivo] = React.useState<File | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (aberto) {
      setR(rascunhoDe(material))
      setArquivo(null)
    }
  }, [aberto, material])

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((a) => ({ ...a, [k]: v }))
  const comArquivo = TIPOS_COM_ARQUIVO.includes(r.tipo)

  function escolherArquivo(f: File | undefined) {
    if (!f) return
    const aceitos = MIMES[r.tipo as 'pdf' | 'imagem' | 'video'] ?? []
    if (!aceitos.includes(f.type)) {
      toast.error(`Para ${TIPO_MATERIAL_LABELS[r.tipo]}, o arquivo precisa ser ${aceitos.join(', ')}.`)
      return
    }
    if (f.size > LIMITE_BYTES) {
      toast.error('O arquivo passa de 25 MB, o limite do bucket.')
      return
    }
    setArquivo(f)
  }

  async function salvar() {
    if (r.nome.trim().length < 2) return void toast.error('Dê um nome ao material.')
    if (r.descricao.trim().length < 5) return void toast.error('Descreva o material (5 letras ou mais).')
    if (r.quando_usar.trim().length < 10) {
      return void toast.error('“Quando usar” precisa de pelo menos 10 letras — é o que o agente lê para escolher.')
    }
    if (!r.email && !r.whatsapp) return void toast.error('Escolha pelo menos um canal.')
    if (comArquivo && !arquivo && !r.arquivo_path && !r.url.trim()) {
      return void toast.error('Envie o arquivo ou informe a URL.')
    }
    if (r.tipo === 'link' && !r.url.trim()) return void toast.error('Link exige a URL.')
    if (r.tipo === 'texto' && !r.corpo.trim()) return void toast.error('Texto exige o corpo.')

    setSalvando(true)
    let arquivoPath = comArquivo ? r.arquivo_path : null
    try {
      if (comArquivo && arquivo) {
        arquivoPath = `materiais/${crypto.randomUUID()}/${nomeDeArquivoSeguro(arquivo.name)}`
        await enviarArquivoAgentes(arquivoPath, arquivo)
      }
    } catch (e) {
      setSalvando(false)
      toast.error(e instanceof Error ? `Upload falhou: ${e.message}` : 'Upload falhou.')
      return
    }

    const tags = r.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20)
    const canais = [r.email ? 'email' : null, r.whatsapp ? 'whatsapp' : null].filter(Boolean)
    const res = await salvarMaterialAction({
      id: material?.id,
      nome: r.nome.trim(),
      descricao: r.descricao.trim(),
      quando_usar: r.quando_usar.trim(),
      tipo: r.tipo,
      arquivo_path: arquivoPath,
      url: r.tipo === 'texto' ? null : r.url.trim() || null,
      corpo: r.tipo === 'texto' ? r.corpo : null,
      tags,
      canais,
      ativo: r.ativo,
    })
    setSalvando(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(material ? 'Material salvo.' : 'Material adicionado à biblioteca.')
    void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.materiais() })
    onFechar()
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{material ? 'Editar material' : 'Novo material'}</DialogTitle>
          <DialogDescription>
            O agente vê nome, descrição, “quando usar” e canais — e escolhe sozinho o que mandar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1">
              <Label htmlFor="m-nome">Nome</Label>
              <Input
                id="m-nome"
                value={r.nome}
                maxLength={120}
                onChange={(e) => set('nome', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={r.tipo}
                onValueChange={(v) => {
                  set('tipo', v as TipoMaterial)
                  setArquivo(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MATERIAL.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_MATERIAL_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-descricao">Descrição</Label>
            <Textarea
              id="m-descricao"
              rows={2}
              maxLength={600}
              value={r.descricao}
              onChange={(e) => set('descricao', e.target.value)}
              placeholder="O que tem no material, em uma ou duas frases."
            />
          </div>

          <div className="space-y-1 rounded-lg border border-primary/40 p-3">
            <Label htmlFor="m-quando">Quando usar</Label>
            <Textarea
              id="m-quando"
              rows={3}
              maxLength={600}
              value={r.quando_usar}
              onChange={(e) => set('quando_usar', e.target.value)}
              placeholder="Ex.: quando o decisor pede algo por escrito antes de marcar a reunião, ou diz que não conhece a One."
            />
            <p className="text-xs text-muted-foreground">
              É o campo que o agente usa para escolher. Escreva a SITUAÇÃO em que este material é o
              certo — não o que ele é.
            </p>
          </div>

          {comArquivo ? (
            <div className="space-y-2">
              <Label>Arquivo</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm hover:bg-muted">
                  <Upload className="mr-2 h-4 w-4" aria-hidden />
                  {arquivo || r.arquivo_path ? 'Trocar arquivo' : 'Escolher arquivo'}
                  <input
                    type="file"
                    className="sr-only"
                    accept={(MIMES[r.tipo as 'pdf' | 'imagem' | 'video'] ?? []).join(',')}
                    onChange={(e) => escolherArquivo(e.target.files?.[0])}
                  />
                </Label>
                <span className="truncate text-xs text-muted-foreground">
                  {arquivo ? arquivo.name : r.arquivo_path ? r.arquivo_path.split('/').pop() : 'Nenhum arquivo'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Até 25 MB. Ou, em vez do arquivo, informe uma URL pública abaixo.
              </p>
            </div>
          ) : null}

          {r.tipo !== 'texto' ? (
            <div className="space-y-1">
              <Label htmlFor="m-url">URL{r.tipo === 'link' ? '' : ' (opcional)'}</Label>
              <Input
                id="m-url"
                type="url"
                value={r.url}
                maxLength={800}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="m-corpo">Texto</Label>
              <Textarea
                id="m-corpo"
                rows={6}
                maxLength={4000}
                value={r.corpo}
                onChange={(e) => set('corpo', e.target.value)}
                placeholder="Um bloco reutilizável: como funciona a antecipação, perguntas frequentes…"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="m-tags">Tags</Label>
              <Input
                id="m-tags"
                value={r.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="institucional, antecipação"
              />
              <p className="text-xs text-muted-foreground">Separadas por vírgula.</p>
            </div>
            <div className="space-y-2">
              <Label>Canais</Label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.email} onCheckedChange={(v) => set('email', v)} /> E-mail
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={r.whatsapp} onCheckedChange={(v) => set('whatsapp', v)} /> WhatsApp
                </label>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={r.ativo} onCheckedChange={(v) => set('ativo', v)} />
            Ativo — o agente só vê materiais ativos
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
