'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, History, Plus } from 'lucide-react'
import {
  ErroModeloCobranca,
  PLACEHOLDER_DESCRICOES,
  TIPOS_MODELO_COBRANCA,
  TIPO_MODELO_COBRANCA_LABELS,
  contextoDeExemplo,
  placeholdersValidos,
  renderizarModeloCobranca,
  validarModeloCobranca,
  valoresDoContexto,
  type Tables,
  type TipoModeloCobranca,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { arquivarModeloAction, salvarModeloAction } from '@/actions/cobranca-gestao'
import { buscarModelos, buscarSouGestor, gestaoKeys } from './gestao-queries'
import { MarkdownSimples } from './modelos-markdown'
import { dataHora } from './format'

/**
 * Modelos de notificação e de confissão de dívida (§5, §9.3, §13).
 *
 * ── VERSIONADO, NUNCA SOBRESCRITO ──────────────────────────────────────────
 * Salvar grava uma VERSÃO NOVA da família e desativa a anterior. A notificação de
 * março continua apontando para o texto de março — o dossiê mostra o que foi enviado,
 * não o que o modelo diz hoje.
 *
 * ── PLACEHOLDER DESCONHECIDO É ERRO ────────────────────────────────────────
 * `{{valr_total}}` impresso como vazio é uma carta com um buraco no lugar do valor.
 * A tela marca o desconhecido enquanto se digita, a action recusa e a RPC recusa de
 * novo. A pré-visualização roda o MESMO renderizador do worker sobre dados de exemplo.
 */

type Modelo = Tables<'cobranca_modelos'>

interface Familia {
  familia_id: string
  tipo: TipoModeloCobranca
  atual: Modelo
  ativa: boolean
  versoes: Modelo[]
}

function familiasDe(modelos: Modelo[]): Familia[] {
  const m = new Map<string, Modelo[]>()
  for (const x of modelos) {
    const l = m.get(x.familia_id) ?? []
    l.push(x)
    m.set(x.familia_id, l)
  }
  return [...m.entries()].map(([familia_id, versoes]) => {
    const ordenadas = [...versoes].sort((a, b) => b.versao - a.versao)
    const ativa = ordenadas.find((v) => v.ativo)
    return {
      familia_id,
      tipo: ordenadas[0]!.tipo as TipoModeloCobranca,
      atual: ativa ?? ordenadas[0]!,
      ativa: !!ativa,
      versoes: ordenadas,
    }
  })
}

type Selecao = { modo: 'familia'; familiaId: string } | { modo: 'novo' } | null

export function ModelosCobranca() {
  const modelos = useQuery({ queryKey: gestaoKeys.modelos(), queryFn: buscarModelos })
  const gestor = useQuery({ queryKey: gestaoKeys.gestor(), queryFn: buscarSouGestor })
  const [selecao, setSelecao] = React.useState<Selecao>(null)
  const [verArquivados, setVerArquivados] = React.useState(false)

  const familias = React.useMemo(() => familiasDe(modelos.data ?? []), [modelos.data])
  const familia = selecao?.modo === 'familia' ? (familias.find((f) => f.familia_id === selecao.familiaId) ?? null) : null

  React.useEffect(() => {
    if (!selecao && familias.length) {
      const primeira = familias.find((f) => f.ativa)
      if (primeira) setSelecao({ modo: 'familia', familiaId: primeira.familia_id })
    }
  }, [familias, selecao])

  if (modelos.isLoading) return <Skeleton className="h-96 w-full" />
  const podeEditar = gestor.data === true

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card className="h-fit">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Modelos</CardTitle>
            {podeEditar ? (
              <Button size="sm" variant="outline" onClick={() => setSelecao({ modo: 'novo' })}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Novo
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {TIPOS_MODELO_COBRANCA.map((tipo) => {
            const doTipo = familias.filter((f) => f.tipo === tipo && (verArquivados || f.ativa))
            return (
              <div key={tipo}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">{TIPO_MODELO_COBRANCA_LABELS[tipo]}</p>
                {doTipo.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">
                    {tipo.startsWith('confissao') || tipo.startsWith('notificacao') ? 'sem modelo ativo' : '—'}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {doTipo.map((f) => (
                      <li key={f.familia_id}>
                        <button
                          type="button"
                          onClick={() => setSelecao({ modo: 'familia', familiaId: f.familia_id })}
                          className={cn(
                            'w-full rounded px-2 py-1 text-left text-sm hover:bg-accent',
                            familia?.familia_id === f.familia_id && 'bg-accent font-medium',
                            !f.ativa && 'text-muted-foreground line-through',
                          )}
                        >
                          {f.atual.nome} <span className="text-xs text-muted-foreground">v{f.atual.versao}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          <label className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} />
            Mostrar arquivados
          </label>
        </CardContent>
      </Card>

      {selecao?.modo === 'novo' ? (
        <Editor
          key="novo"
          familia={null}
          podeEditar={podeEditar}
          onSalvo={(m) => setSelecao({ modo: 'familia', familiaId: m.familia_id })}
        />
      ) : familia ? (
        <Editor key={familia.familia_id} familia={familia} podeEditar={podeEditar} onSalvo={() => undefined} />
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Escolha um modelo à esquerda.</CardContent>
        </Card>
      )}
    </div>
  )
}

function Editor({
  familia,
  podeEditar,
  onSalvo,
}: {
  familia: Familia | null
  podeEditar: boolean
  onSalvo: (m: Modelo) => void
}) {
  const qc = useQueryClient()
  const textoRef = React.useRef<HTMLTextAreaElement>(null)
  const [tipo, setTipo] = React.useState<TipoModeloCobranca>(familia?.tipo ?? 'notificacao_sacado')
  const [nome, setNome] = React.useState(familia?.atual.nome ?? '')
  const [corpo, setCorpo] = React.useState(familia?.atual.corpo_markdown ?? '')
  const [versaoVista, setVersaoVista] = React.useState<Modelo | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  // Troca de versão atual (outra pessoa salvou): recarrega o editor se ele não foi mexido.
  const atualId = familia?.atual.id
  React.useEffect(() => {
    if (familia) {
      setNome(familia.atual.nome)
      setCorpo(familia.atual.corpo_markdown)
      setVersaoVista(null)
    }
    // só quando a versão atual muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atualId])

  const validos = placeholdersValidos(tipo)
  const { desconhecidos } = validarModeloCobranca(tipo, corpo)
  const alterado = !familia || corpo !== familia.atual.corpo_markdown || nome !== familia.atual.nome

  const preview = React.useMemo(() => {
    try {
      return { html: renderizarModeloCobranca(tipo, corpo, valoresDoContexto(contextoDeExemplo())), erro: null }
    } catch (e) {
      return { html: null, erro: e instanceof ErroModeloCobranca || e instanceof Error ? e.message : 'Erro ao renderizar.' }
    }
  }, [tipo, corpo])

  function inserir(p: string) {
    const el = textoRef.current
    const token = `{{${p}}}`
    if (!el) {
      setCorpo((c) => c + token)
      return
    }
    const ini = el.selectionStart ?? corpo.length
    const fim = el.selectionEnd ?? corpo.length
    const novo = corpo.slice(0, ini) + token + corpo.slice(fim)
    setCorpo(novo)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(ini + token.length, ini + token.length)
    })
  }

  async function salvar() {
    setSalvando(true)
    const r = await salvarModeloAction({
      id: familia?.atual.id,
      tipo: familia ? undefined : tipo,
      nome: nome.trim() || undefined,
      corpo_markdown: corpo,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Versão ${r.data.versao} salva e ativa.`)
    void qc.invalidateQueries({ queryKey: gestaoKeys.modelos() })
    onSalvo(r.data)
  }

  async function arquivar() {
    if (!familia) return
    if (!window.confirm('Arquivar este modelo? Nenhuma versão dele ficará ativa para novas notificações.')) return
    const r = await arquivarModeloAction(familia.familia_id)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Modelo arquivado.')
    void qc.invalidateQueries({ queryKey: gestaoKeys.modelos() })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {familia ? (
                <>
                  {familia.atual.nome}{' '}
                  <Badge variant={familia.ativa ? 'success' : 'neutral'} className="ml-1">
                    {familia.ativa ? `v${familia.atual.versao} ativa` : 'arquivado'}
                  </Badge>
                </>
              ) : (
                'Novo modelo'
              )}
            </CardTitle>
            {familia && podeEditar && familia.ativa ? (
              <Button size="sm" variant="ghost" onClick={() => void arquivar()}>
                <Archive className="mr-1 h-3.5 w-3.5" />
                Arquivar
              </Button>
            ) : null}
          </div>
          {!podeEditar ? (
            <p className="text-xs text-muted-foreground">Somente leitura: modelos são editados pela gestão de cobrança.</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoModeloCobranca)} disabled={!!familia || !podeEditar}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MODELO_COBRANCA.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_MODELO_COBRANCA_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="modelo-nome">Nome</Label>
              <Input id="modelo-nome" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!podeEditar} />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Placeholders (clique para inserir no cursor)</p>
            <div className="flex flex-wrap gap-1">
              {validos.map((p) => (
                <button
                  key={p}
                  type="button"
                  title={PLACEHOLDER_DESCRICOES[p] ?? p}
                  disabled={!podeEditar}
                  onClick={() => inserir(p)}
                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent disabled:opacity-60"
                >
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
          </div>

          <Textarea
            ref={textoRef}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            readOnly={!podeEditar}
            rows={22}
            className="font-mono text-xs"
            aria-label="Corpo do modelo em markdown"
          />

          {desconhecidos.length ? (
            <p className="text-sm text-destructive">
              Placeholder desconhecido: {desconhecidos.map((p) => `{{${p}}}`).join(', ')}. Corrija antes de salvar — ele sairia
              como um buraco na carta.
            </p>
          ) : null}

          {podeEditar ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => void salvar()} disabled={salvando || !alterado || desconhecidos.length > 0 || corpo.trim().length < 20 || (!familia && nome.trim().length < 2)}>
                {salvando ? 'Salvando…' : familia ? `Salvar como v${Math.max(...familia.versoes.map((v) => v.versao)) + 1}` : 'Criar modelo'}
              </Button>
              {familia && alterado ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNome(familia.atual.nome)
                    setCorpo(familia.atual.corpo_markdown)
                  }}
                >
                  Descartar alterações
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Pré-visualização com dados de exemplo</CardTitle>
        </CardHeader>
        <CardContent>
          {preview.erro ? (
            <p className="text-sm text-destructive">{preview.erro}</p>
          ) : (
            <div className="rounded-md border border-border bg-background p-6">
              <MarkdownSimples texto={preview.html ?? ''} />
            </div>
          )}
        </CardContent>
      </Card>

      {familia ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" aria-hidden />
              Histórico de versões
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {familia.versoes.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>
                    v{v.versao} · {v.nome}{' '}
                    <span className="text-xs text-muted-foreground">{dataHora(v.criado_em)}</span>
                    {v.ativo ? <Badge variant="success" className="ml-2">ativa</Badge> : null}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setVersaoVista(versaoVista?.id === v.id ? null : v)}>
                      {versaoVista?.id === v.id ? 'Fechar' : 'Ver'}
                    </Button>
                    {podeEditar && !v.ativo ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCorpo(v.corpo_markdown)
                          toast.info(`Texto da v${v.versao} carregado no editor. Salvar cria uma versão nova.`)
                        }}
                      >
                        Carregar no editor
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {versaoVista ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs">
                {versaoVista.corpo_markdown}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
