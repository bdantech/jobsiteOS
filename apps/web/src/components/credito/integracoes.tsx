'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, KeyRound, RefreshCw, Send, Trash2, Webhook } from 'lucide-react'
import { EVENTOS_WEBHOOK, EVENTO_WEBHOOK_LABELS, type EventoWebhook } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  criarApiKeyAction,
  enviarWebhookTesteAction,
  reenviarEntregaAction,
  revogarApiKeyAction,
  salvarWebhookAction,
} from '@/actions/credito'
import { createClient } from '@/lib/supabase/client'

/**
 * Integrações do Crédito (04n §4): chaves, webhook e o log de entregas.
 *
 * ── A CHAVE APARECE UMA VEZ ────────────────────────────────────────────────
 * Ela é mostrada no diálogo da criação e não volta. Não é rigor de tela: o banco
 * guarda o SHA-256, então não existe consulta que a devolva. A tela diz isso na
 * hora, porque descobrir depois é descobrir tarde.
 *
 * ── O LOG É A PRIMEIRA TELA QUE ALGUÉM ABRE QUANDO ALGO QUEBRA ─────────────
 * Por isso ele mostra status HTTP, tentativas, o erro e o payload inteiro — e tem
 * o botão de reenvio ao lado. Um log que obriga a abrir o banco para entender o
 * que aconteceu não é log, é registro.
 */

const chave = ['credito', 'integracoes'] as const

interface ApiKeyLinha {
  id: string
  nome: string
  prefixo: string
  escopos: string[]
  ativa: boolean
  ultimo_uso_em: string | null
  criada_em: string
  revogada_em: string | null
}

interface WebhookLinha {
  id: string
  nome: string
  url: string
  eventos: string[]
  ativo: boolean
  criado_em: string
}

interface EntregaLinha {
  id: string
  evento: string
  evento_id: string
  status: string
  tentativas: number
  ultimo_status_http: number | null
  ultimo_erro: string | null
  ultima_resposta: string | null
  payload: unknown
  criado_em: string
  entregue_em: string | null
  proxima_tentativa_em: string
}

const quando = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export function Integracoes({ ehAdmin }: { ehAdmin: boolean }) {
  const qc = useQueryClient()
  const invalidar = (): void => void qc.invalidateQueries({ queryKey: chave })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-medium">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          A plataforma de produção cria análises pela API e recebe de volta cada mudança de
          estágio. As chaves e o webhook desta tela são as duas pontas disso.
        </p>
      </div>

      <PainelDaApi />
      <Chaves ehAdmin={ehAdmin} onMudou={invalidar} />
      <ConfiguracaoWebhook onMudou={invalidar} />
      <LogDeEntregas onMudou={invalidar} />
    </div>
  )
}

// ─── Chaves ─────────────────────────────────────────────────────────────────

function Chaves({ ehAdmin, onMudou }: { ehAdmin: boolean; onMudou: () => void }) {
  const [nome, setNome] = React.useState('')
  const [criada, setCriada] = React.useState<{ chave: string; prefixo: string } | null>(null)

  const consulta = useQuery({
    queryKey: [...chave, 'keys'],
    queryFn: async (): Promise<ApiKeyLinha[]> => {
      const { data, error } = await createClient()
        .from('api_keys')
        // Colunas explícitas: `key_hash` não tem por que sair do banco, e um
        // `select *` o traria para o bundle do navegador sem ninguém notar.
        .select('id, nome, prefixo, escopos, ativa, ultimo_uso_em, criada_em, revogada_em')
        .order('criada_em', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as ApiKeyLinha[]
    },
  })

  const criar = useMutation({
    mutationFn: async () => {
      const r = await criarApiKeyAction({ nome, escopos: ['credito:write', 'credito:read'] })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (d) => {
      setCriada({ chave: d.chave, prefixo: d.prefixo })
      setNome('')
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revogar = useMutation({
    mutationFn: async (id: string) => {
      const r = await revogarApiKeyAction(id)
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Chave revogada. As chamadas com ela passam a receber 401.')
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" aria-hidden /> Chaves de API
        </CardTitle>
        <CardDescription>
          Uma chave por integração. O segredo aparece só na criação — depois só o prefixo, que
          é como se sabe qual revogar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {ehAdmin ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1">
              <Label className="text-xs">Nome da integração</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="plataforma-producao"
                className="h-9"
              />
            </div>
            <Button size="sm" disabled={nome.trim().length < 2 || criar.isPending} onClick={() => criar.mutate()}>
              {criar.isPending ? 'Criando…' : 'Criar chave'}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Só administradores criam e revogam chaves.</p>
        )}

        {consulta.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (consulta.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma chave criada.</p>
        ) : (
          <ul className="space-y-1.5">
            {(consulta.data ?? []).map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {k.nome}
                    {k.ativa ? (
                      <Badge variant="outline" className="text-[10px]">ativa</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">revogada</Badge>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {k.prefixo}… · {k.escopos.join(', ')}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Criada em {quando(k.criada_em)} · último uso {quando(k.ultimo_uso_em)}
                  </p>
                </div>
                {ehAdmin && k.ativa ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={revogar.isPending}
                    onClick={() => revogar.mutate(k.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Revogar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={criada !== null} onOpenChange={(o) => !o && setCriada(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guarde a chave agora</DialogTitle>
            <DialogDescription>
              Ela não será mostrada de novo — o banco guarda só o hash, então não existe
              consulta que a devolva. Se perder, crie outra e revogue esta.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={criada?.chave ?? ''} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(criada?.chave ?? '')
                toast.success('Chave copiada.')
              }}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCriada(null)}>Guardei</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── Webhook ────────────────────────────────────────────────────────────────

function ConfiguracaoWebhook({ onMudou }: { onMudou: () => void }) {
  const consulta = useQuery({
    queryKey: [...chave, 'webhooks'],
    queryFn: async (): Promise<WebhookLinha[]> => {
      const { data, error } = await createClient()
        .from('webhooks_saida')
        // O `secret` fica de fora: ele é comparado no worker, nunca lido na tela.
        .select('id, nome, url, eventos, ativo, criado_em')
        .order('criado_em', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as WebhookLinha[]
    },
  })

  const atual = (consulta.data ?? [])[0] ?? null

  const [nome, setNome] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [eventos, setEventos] = React.useState<EventoWebhook[]>([...EVENTOS_WEBHOOK])

  React.useEffect(() => {
    if (!atual) return
    setNome(atual.nome)
    setUrl(atual.url)
    setEventos(atual.eventos as EventoWebhook[])
  }, [atual])

  const salvar = useMutation({
    mutationFn: async () => {
      const r = await salvarWebhookAction({
        id: atual?.id ?? null,
        nome: nome || 'Plataforma de produção',
        url,
        secret: secret || null,
        eventos,
        ativo: true,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success(secret ? 'Webhook salvo com o secret novo — o anterior parou de valer.' : 'Webhook salvo.')
      setSecret('')
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const testar = useMutation({
    mutationFn: async () => {
      if (!atual) throw new Error('Salve o webhook antes de testar.')
      const r = await enviarWebhookTesteAction(atual.id)
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Evento de teste na fila. Acompanhe no log abaixo.')
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="h-4 w-4" aria-hidden /> Webhook de saída
        </CardTitle>
        <CardDescription>
          Para onde mandamos cada mudança de estágio. O corpo vai assinado em HMAC-SHA256 no
          header <code>X-JobsiteOS-Signature</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" placeholder="Plataforma de produção" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">URL (https)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="h-9" placeholder="https://api.exemplo.com/webhooks/jobsiteos" />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Secret</Label>
          <Input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="h-9 font-mono text-xs"
            placeholder={atual ? 'Deixe em branco para manter o atual' : 'Mínimo 16 caracteres'}
          />
          <p className="text-[11px] text-muted-foreground">
            Rotacionar quebra a validação do outro lado até eles trocarem também — combine antes.
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Eventos</Label>
          <div className="flex flex-wrap gap-1.5">
            {EVENTOS_WEBHOOK.map((e) => {
              const marcado = eventos.includes(e)
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEventos((atuais) => (marcado ? atuais.filter((x) => x !== e) : [...atuais, e]))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    marcado ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {EVENTO_WEBHOOK_LABELS[e]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!url.startsWith('https://') || eventos.length === 0 || salvar.isPending || (!atual && secret.trim().length < 16)}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button size="sm" variant="outline" disabled={!atual || testar.isPending} onClick={() => testar.mutate()}>
            <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
            {testar.isPending ? 'Enviando…' : 'Enviar evento de teste'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Log ────────────────────────────────────────────────────────────────────

function LogDeEntregas({ onMudou }: { onMudou: () => void }) {
  const [filtro, setFiltro] = React.useState<'todos' | 'pendente' | 'entregue' | 'falhou'>('todos')
  const [aberta, setAberta] = React.useState<string | null>(null)

  const consulta = useQuery({
    queryKey: [...chave, 'entregas', filtro],
    queryFn: async (): Promise<EntregaLinha[]> => {
      let q = createClient()
        .from('webhook_entregas')
        .select('id, evento, evento_id, status, tentativas, ultimo_status_http, ultimo_erro, ultima_resposta, payload, criado_em, entregue_em, proxima_tentativa_em')
        .order('criado_em', { ascending: false })
        .limit(100)
      if (filtro !== 'todos') q = q.eq('status', filtro)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as EntregaLinha[]
    },
    // Enquanto houver pendente, a tela se atualiza sozinha: quem acabou de clicar
    // em "testar" está olhando para esta lista esperando a linha mudar.
    refetchInterval: (q) => ((q.state.data ?? []).some((e) => e.status === 'pendente') ? 5000 : false),
  })

  const reenviar = useMutation({
    mutationFn: async (id: string) => {
      const r = await reenviarEntregaAction(id)
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('De volta para a fila.')
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Entregas</CardTitle>
          <CardDescription>As últimas 100. Seis tentativas com espera crescente: 1min, 5min, 15min, 1h, 6h, 24h.</CardDescription>
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="entregue">Entregues</SelectItem>
            <SelectItem value="falhou">Falhadas</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {consulta.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (consulta.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega ainda.</p>
        ) : (
          <ul className="divide-y">
            {(consulta.data ?? []).map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setAberta(aberta === e.id ? null : e.id)}
                    className="flex min-w-0 items-center gap-2 text-left text-sm hover:underline"
                  >
                    <Badge
                      variant={e.status === 'entregue' ? 'outline' : e.status === 'falhou' ? 'destructive' : 'secondary'}
                      className="text-[10px]"
                    >
                      {e.status}
                    </Badge>
                    <span className="truncate">{e.evento}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {quando(e.criado_em)}
                      {e.ultimo_status_http ? ` · HTTP ${e.ultimo_status_http}` : ''}
                      {e.tentativas > 0 ? ` · ${e.tentativas} tentativa(s)` : ''}
                    </span>
                  </button>
                  {e.status !== 'entregue' ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={reenviar.isPending} onClick={() => reenviar.mutate(e.id)}>
                      <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Reenviar
                    </Button>
                  ) : null}
                </div>
                {e.ultimo_erro ? <p className="mt-1 text-[11px] text-destructive">{e.ultimo_erro}</p> : null}
                {aberta === e.id ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      evento_id <code className="font-mono">{e.evento_id}</code> · próxima tentativa {quando(e.proxima_tentativa_em)}
                    </p>
                    {e.ultima_resposta ? (
                      <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-[11px]">{e.ultima_resposta}</pre>
                    ) : null}
                    <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-[11px]">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}


// ─── Painel (§5) ────────────────────────────────────────────────────────────

interface RequisicaoLinha {
  rota: string
  metodo: string
  status_http: number
  duracao_ms: number | null
  erro: string | null
  criado_em: string
}

/**
 * "A integração está de pé?" respondida sem abrir o banco (§5).
 *
 * Quatro números e as últimas falhas — não um dashboard. A pergunta que se faz
 * numa tela de integração é binária, e ela se responde com volume, taxa de erro e
 * latência. O resto é o log de entregas logo abaixo, que já mostra caso a caso.
 */
function PainelDaApi() {
  const consulta = useQuery({
    queryKey: [...chave, 'painel'],
    queryFn: async (): Promise<RequisicaoLinha[]> => {
      const desde = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data, error } = await createClient()
        .from('api_requests_log')
        .select('rota, metodo, status_http, duracao_ms, erro, criado_em')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(1000)
      if (error) throw new Error(error.message)
      return (data ?? []) as RequisicaoLinha[]
    },
  })

  const linhas = consulta.data ?? []
  const hoje = new Date().toISOString().slice(0, 10)
  const doDia = linhas.filter((l) => l.criado_em.slice(0, 10) === hoje)
  const comErro = linhas.filter((l) => l.status_http >= 400)
  const latencias = linhas.map((l) => l.duracao_ms ?? 0).filter((n) => n > 0)
  const media = latencias.length > 0 ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length) : null
  const taxaErro = linhas.length > 0 ? Math.round((comErro.length / linhas.length) * 100) : 0

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">A integração está de pé?</CardTitle>
        <CardDescription>Requisições recebidas na API nos últimos 7 dias.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {consulta.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metrica rotulo="Hoje" valor={String(doDia.length)} />
              <Metrica rotulo="7 dias" valor={String(linhas.length)} />
              <Metrica
                rotulo="Taxa de erro"
                valor={`${taxaErro}%`}
                alerta={taxaErro >= 10}
              />
              <Metrica rotulo="Latência média" valor={media === null ? '—' : `${media} ms`} />
            </dl>

            {comErro.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-muted-foreground">Últimas falhas</p>
                <ul className="space-y-0.5">
                  {comErro.slice(0, 5).map((l, i) => (
                    <li key={`${l.criado_em}-${i}`} className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{quando(l.criado_em)}</span>
                      <span className="font-medium text-destructive">{l.status_http}</span>
                      <span className="truncate">{l.metodo} {l.rota}</span>
                      {l.erro ? <span className="truncate">· {l.erro}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">Nenhuma falha na janela.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Metrica({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${alerta ? 'text-destructive' : ''}`}>{valor}</dd>
    </div>
  )
}
