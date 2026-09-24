'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, BellRing, Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import {
  FILTROS_MODELO,
  FREQUENCIAS_NOTIFICACAO,
  MODULOS_NOTIFICACAO,
  PAPEIS,
  PAPEIS_NOTIFICACAO,
  type PapelNotificacao,
} from '@jobsiteos/core'
import {
  alternarTipoAction,
  excluirRegraAction,
  previaAction,
  salvarModeloAction,
  salvarRegraAction,
  testarAction,
  type Previa,
} from '@/actions/notificacoes-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface RegraDoAviso {
  id: string
  perfil_id: string | null
  usuario_id: string | null
  papel: string | null
  canais: string[]
  frequencia: string
  respeita_silencio: boolean
  dedup_horas: number
  fallback_admin: boolean
  ativo: boolean
}

interface Aviso {
  tipo: string
  modulo: string
  nome: string
  descricao: string | null
  gravidade: string
  ativo: boolean
  titulo_modelo: string | null
  corpo_modelo: string | null
  url_modelo: string | null
}

type Opcao = { id: string; nome: string }

export function DetalheAviso({
  aviso,
  regras,
  perfis,
  pessoas,
  previaInicial,
  historico,
}: {
  aviso: Aviso
  regras: RegraDoAviso[]
  perfis: Opcao[]
  pessoas: Opcao[]
  previaInicial: Previa
  historico: { id: string; quando: string; quem: string; descricao: string }[]
}) {
  const [ativo, setAtivo] = React.useState(aviso.ativo)
  const [testando, iniciarTeste] = React.useTransition()
  const [alternando, iniciarAlternar] = React.useTransition()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/notificacoes"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Notificações
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{aviso.nome}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="text-xs text-muted-foreground">{aviso.tipo}</code>
              <Badge variant="outline" className="text-[11px]">
                {MODULOS_NOTIFICACAO[aviso.modulo] ?? aviso.modulo}
              </Badge>
              {aviso.gravidade === 'critica' && (
                <Badge variant="destructive" className="text-[11px]">
                  Crítico — fura o silêncio
                </Badge>
              )}
            </div>
            {aviso.descricao && <p className="max-w-2xl text-sm text-muted-foreground">{aviso.descricao}</p>}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={ativo}
                disabled={alternando}
                onCheckedChange={(v) => {
                  setAtivo(v)
                  iniciarAlternar(async () => {
                    const r = await alternarTipoAction({ tipo: aviso.tipo, ativo: v })
                    if (!r.ok) {
                      setAtivo(!v)
                      toast.error(r.message)
                    }
                  })
                }}
              />
              {ativo ? 'Ativo' : 'Pausado'}
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={testando}
              onClick={() =>
                iniciarTeste(async () => {
                  const r = await testarAction({ tipo: aviso.tipo })
                  if (r.ok) toast.success('Teste enviado.', { description: 'Confira o sino — e o push, se estiver ativo.' })
                  else toast.error(r.message)
                })
              }
            >
              {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar teste para mim
            </Button>
          </div>
        </div>
      </div>

      <EditorDoTexto aviso={aviso} previaInicial={previaInicial} />
      <RegrasDoAviso tipo={aviso.tipo} regras={regras} perfis={perfis} pessoas={pessoas} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
          <CardDescription>Quem mudou este aviso, e quando.</CardDescription>
        </CardHeader>
        <CardContent>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma mudança feita pelo painel ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {historico.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(h.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="font-medium">{h.quem}</span>
                  <span>{h.descricao.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Texto ──────────────────────────────────────────────────────────────────

type Campo = 'titulo' | 'corpo' | 'url'

/**
 * O texto do aviso, com prévia AO VIVO renderizada no banco com o último evento real.
 *
 * A prévia vem do mesmo `notificacao_renderizar` que o envio usa — escrever a
 * substituição de variáveis de novo no navegador seria ter duas versões dela, e a
 * da tela mentiria no primeiro filtro que só a do banco conhece.
 */
function EditorDoTexto({ aviso, previaInicial }: { aviso: Aviso; previaInicial: Previa }) {
  const [titulo, setTitulo] = React.useState(aviso.titulo_modelo ?? '')
  const [corpo, setCorpo] = React.useState(aviso.corpo_modelo ?? '')
  const [url, setUrl] = React.useState(aviso.url_modelo ?? '')
  const [previa, setPrevia] = React.useState<Previa>(previaInicial)
  const [salvando, iniciar] = React.useTransition()
  const ultimoCampo = React.useRef<Campo>('corpo')
  const refs = {
    titulo: React.useRef<HTMLInputElement>(null),
    corpo: React.useRef<HTMLTextAreaElement>(null),
    url: React.useRef<HTMLInputElement>(null),
  }

  const mudou =
    titulo !== (aviso.titulo_modelo ?? '') || corpo !== (aviso.corpo_modelo ?? '') || url !== (aviso.url_modelo ?? '')

  // Prévia com um respiro de 400ms: uma ida ao banco por tecla seria desperdício.
  React.useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previaAction({
        tipo: aviso.tipo,
        titulo_modelo: titulo || null,
        corpo_modelo: corpo || null,
        url_modelo: url || null,
      })
      if (r.ok) setPrevia(r.data)
    }, 400)
    return () => clearTimeout(t)
  }, [aviso.tipo, titulo, corpo, url])

  function inserir(variavel: string) {
    const campo = ultimoCampo.current
    const alvo = refs[campo].current
    const trecho = `{{${variavel}}}`
    const atual = campo === 'titulo' ? titulo : campo === 'corpo' ? corpo : url
    const inicio = alvo?.selectionStart ?? atual.length
    const fim = alvo?.selectionEnd ?? atual.length
    const novo = atual.slice(0, inicio) + trecho + atual.slice(fim)
    if (campo === 'titulo') setTitulo(novo)
    else if (campo === 'corpo') setCorpo(novo)
    else setUrl(novo)
    requestAnimationFrame(() => {
      alvo?.focus()
      alvo?.setSelectionRange(inicio + trecho.length, inicio + trecho.length)
    })
  }

  function salvar(modelo: { titulo: string; corpo: string; url: string }) {
    iniciar(async () => {
      const r = await salvarModeloAction({
        tipo: aviso.tipo,
        titulo_modelo: modelo.titulo || null,
        corpo_modelo: modelo.corpo || null,
        url_modelo: modelo.url || null,
      })
      if (r.ok) toast.success('Texto salvo. Vale a partir do próximo aviso.')
      else toast.error(r.message)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Texto do aviso</CardTitle>
        <CardDescription>
          Em branco, vale o texto que o sistema escreve. Use as variáveis do aviso entre chaves duplas, e os filtros{' '}
          {FILTROS_MODELO.map((f) => `|${f}`).join(', ')} — por exemplo {'{{valor|moeda}}'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="flex flex-col gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="modelo-titulo">Título</Label>
            <Input
              id="modelo-titulo"
              ref={refs.titulo}
              value={titulo}
              placeholder="Texto padrão do sistema"
              onFocus={() => (ultimoCampo.current = 'titulo')}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="modelo-corpo">Corpo</Label>
            <Textarea
              id="modelo-corpo"
              ref={refs.corpo}
              rows={3}
              value={corpo}
              placeholder="Texto padrão do sistema"
              onFocus={() => (ultimoCampo.current = 'corpo')}
              onChange={(e) => setCorpo(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="modelo-url">Link ao tocar</Label>
            <Input
              id="modelo-url"
              ref={refs.url}
              value={url}
              placeholder="Link padrão do sistema"
              onFocus={() => (ultimoCampo.current = 'url')}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Variáveis deste aviso {previa.tem_exemplo ? '(toque para inserir)' : ''}
            </span>
            {previa.tem_exemplo ? (
              <div className="flex flex-wrap gap-1.5">
                {previa.variaveis.map((v) => (
                  <button
                    key={v.nome}
                    type="button"
                    onClick={() => inserir(v.nome)}
                    title={v.exemplo ? `Ex.: ${v.exemplo}` : undefined}
                    className="rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-[11px] hover:bg-muted"
                  >
                    {`{{${v.nome}}}`}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Este aviso ainda não disparou nenhuma vez, então não há exemplo para mostrar as variáveis.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!mudou || salvando} onClick={() => salvar({ titulo, corpo, url })}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar texto
            </Button>
            {(aviso.titulo_modelo || aviso.corpo_modelo || aviso.url_modelo) && (
              <Button
                variant="ghost"
                disabled={salvando}
                onClick={() => {
                  setTitulo('')
                  setCorpo('')
                  setUrl('')
                  salvar({ titulo: '', corpo: '', url: '' })
                }}
              >
                Voltar ao texto do sistema
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Prévia {previa.tem_exemplo ? 'com o último aviso real' : ''}
          </span>
          <div className="flex gap-3 rounded-lg border bg-card p-3 shadow-sm">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{previa.titulo || '—'}</span>
              {previa.corpo && <span className="whitespace-pre-line text-sm text-muted-foreground">{previa.corpo}</span>}
              {previa.url && <code className="truncate text-[11px] text-muted-foreground">{previa.url}</code>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Regras ─────────────────────────────────────────────────────────────────

type TipoAlvo = 'papel' | 'perfil' | 'usuario'

interface Rascunho {
  id?: string
  alvoTipo: TipoAlvo
  alvoId: string
  push: boolean
  email: boolean
  frequencia: 'imediato' | 'resumo_diario'
  respeita_silencio: boolean
  dedup_horas: number
  fallback_admin: boolean
  ativo: boolean
}

const NOVA: Rascunho = {
  alvoTipo: 'papel',
  alvoId: '',
  push: true,
  email: false,
  frequencia: 'imediato',
  respeita_silencio: true,
  dedup_horas: 0,
  fallback_admin: false,
  ativo: true,
}

function rascunhoDe(r: RegraDoAviso): Rascunho {
  return {
    id: r.id,
    alvoTipo: r.papel ? 'papel' : r.perfil_id ? 'perfil' : 'usuario',
    alvoId: r.papel ?? r.perfil_id ?? r.usuario_id ?? '',
    push: r.canais.includes('push'),
    email: r.canais.includes('email'),
    frequencia: r.frequencia === 'resumo_diario' ? 'resumo_diario' : 'imediato',
    respeita_silencio: r.respeita_silencio,
    dedup_horas: r.dedup_horas,
    fallback_admin: r.fallback_admin,
    ativo: r.ativo,
  }
}

function RegrasDoAviso({
  tipo,
  regras,
  perfis,
  pessoas,
}: {
  tipo: string
  regras: RegraDoAviso[]
  perfis: Opcao[]
  pessoas: Opcao[]
}) {
  const [editando, setEditando] = React.useState<Rascunho | null>(null)
  const [pendente, iniciar] = React.useTransition()
  const nomePerfil = new Map(perfis.map((p) => [p.id, p.nome]))
  const nomePessoa = new Map(pessoas.map((p) => [p.id, p.nome]))

  const destino = (r: RegraDoAviso) =>
    r.papel
      ? (PAPEIS_NOTIFICACAO[r.papel as PapelNotificacao]?.rotulo ?? r.papel)
      : r.perfil_id
        ? `Perfil ${nomePerfil.get(r.perfil_id) ?? '—'}`
        : (nomePessoa.get(r.usuario_id ?? '') ?? 'Pessoa inativa')

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Quem recebe</CardTitle>
          <CardDescription>
            Cada pessoa recebe um aviso só, mesmo que várias regras a alcancem. Quem causou o fato não é avisado dele.
          </CardDescription>
        </div>
        {!editando && (
          <Button size="sm" variant="outline" onClick={() => setEditando({ ...NOVA })}>
            <Plus className="h-4 w-4" /> Adicionar regra
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {regras.length === 0 && !editando && (
          <p className="text-sm text-muted-foreground">
            Nenhuma regra: este evento só aparece na timeline. Adicionar uma regra cria o aviso — sem código.
          </p>
        )}

        {regras.map((r) =>
          editando?.id === r.id ? null : (
            <div
              key={r.id}
              className={cn('flex flex-wrap items-center justify-between gap-3 rounded-md border p-3', !r.ativo && 'opacity-60')}
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{destino(r)}</span>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Badge variant="secondary">
                    {FREQUENCIAS_NOTIFICACAO[r.frequencia as keyof typeof FREQUENCIAS_NOTIFICACAO] ?? r.frequencia}
                  </Badge>
                  <Badge variant="outline">
                    {['Sino', r.canais.includes('push') && 'Push', r.canais.includes('email') && 'E-mail']
                      .filter(Boolean)
                      .join(' + ')}
                  </Badge>
                  {r.dedup_horas > 0 && <Badge variant="outline">Não repete em {r.dedup_horas}h</Badge>}
                  {r.fallback_admin && <Badge variant="outline">Se ninguém, Admin</Badge>}
                  {!r.respeita_silencio && <Badge variant="outline">Ignora o silêncio</Badge>}
                  {!r.ativo && <Badge variant="outline">Desligada</Badge>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label="Editar regra" onClick={() => setEditando(rascunhoDe(r))}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Excluir regra"
                  disabled={pendente}
                  onClick={() =>
                    iniciar(async () => {
                      const res = await excluirRegraAction({ id: r.id, tipo_evento: tipo })
                      if (res.ok) toast.success('Regra excluída.')
                      else toast.error(res.message)
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ),
        )}

        {editando && (
          <EditorDeRegra
            tipo={tipo}
            inicial={editando}
            perfis={perfis}
            pessoas={pessoas}
            onFechar={() => setEditando(null)}
          />
        )}
      </CardContent>
    </Card>
  )
}

function EditorDeRegra({
  tipo,
  inicial,
  perfis,
  pessoas,
  onFechar,
}: {
  tipo: string
  inicial: Rascunho
  perfis: Opcao[]
  pessoas: Opcao[]
  onFechar: () => void
}) {
  const [r, setR] = React.useState<Rascunho>(inicial)
  const [salvando, iniciar] = React.useTransition()
  const muda = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((atual) => ({ ...atual, [k]: v }))

  const opcoes: Opcao[] =
    r.alvoTipo === 'papel'
      ? PAPEIS.map((p) => ({ id: p, nome: PAPEIS_NOTIFICACAO[p].rotulo }))
      : r.alvoTipo === 'perfil'
        ? perfis
        : pessoas

  return (
    <div className="flex flex-col gap-4 rounded-md border border-primary/40 bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="grid gap-1.5">
          <Label>Destinatário</Label>
          <Select value={r.alvoTipo} onValueChange={(v) => setR({ ...r, alvoTipo: v as TipoAlvo, alvoId: '' })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="papel">Por papel</SelectItem>
              <SelectItem value="perfil">Por perfil</SelectItem>
              <SelectItem value="usuario">Uma pessoa</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>&nbsp;</Label>
          <Select value={r.alvoId} onValueChange={(v) => muda('alvoId', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {r.alvoTipo === 'papel' && r.alvoId && (
            <p className="text-xs text-muted-foreground">
              {PAPEIS_NOTIFICACAO[r.alvoId as PapelNotificacao]?.descricao} Precisa de um destes dados no aviso:{' '}
              {PAPEIS_NOTIFICACAO[r.alvoId as PapelNotificacao]?.usa.join(', ')}.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Quando</Label>
          <Select value={r.frequencia} onValueChange={(v) => muda('frequencia', v as Rascunho['frequencia'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FREQUENCIAS_NOTIFICACAO).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="regra-dedup">Não repetir o mesmo aviso em (horas)</Label>
          <Input
            id="regra-dedup"
            type="number"
            min={0}
            max={8760}
            value={r.dedup_horas}
            onChange={(e) => muda('dedup_horas', Math.max(0, Math.min(8760, Number(e.target.value) || 0)))}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Alternar rotulo="Push no celular e no navegador" valor={r.push} onChange={(v) => muda('push', v)} />
        <Alternar rotulo="E-mail" valor={r.email} onChange={(v) => muda('email', v)} />
        <Alternar
          rotulo="Respeitar o horário de silêncio"
          valor={r.respeita_silencio}
          onChange={(v) => muda('respeita_silencio', v)}
        />
        <Alternar
          rotulo="Se ninguém for alcançado, mandar ao Admin"
          valor={r.fallback_admin}
          onChange={(v) => muda('fallback_admin', v)}
        />
        <Alternar rotulo="Regra ligada" valor={r.ativo} onChange={(v) => muda('ativo', v)} />
      </div>

      <div className="flex gap-2">
        <Button
          disabled={!r.alvoId || salvando}
          onClick={() =>
            iniciar(async () => {
              const res = await salvarRegraAction({
                ...(r.id ? { id: r.id } : {}),
                tipo_evento: tipo,
                alvo: { tipo: r.alvoTipo, id: r.alvoId },
                push: r.push,
                email: r.email,
                frequencia: r.frequencia,
                respeita_silencio: r.respeita_silencio,
                dedup_horas: r.dedup_horas,
                fallback_admin: r.fallback_admin,
                ativo: r.ativo,
              })
              if (res.ok) {
                toast.success('Regra salva. Vale a partir do próximo aviso.')
                onFechar()
              } else toast.error(res.message)
            })
          }
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar regra
        </Button>
        <Button variant="ghost" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function Alternar({ rotulo, valor, onChange }: { rotulo: string; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={valor} onCheckedChange={onChange} />
      {rotulo}
    </label>
  )
}
