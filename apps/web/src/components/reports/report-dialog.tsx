'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Bug, ImagePlus, Lightbulb, Loader2, X } from 'lucide-react'
import {
  DESCRICAO_PLACEHOLDER,
  STATUS_REPORT_DESCRICOES,
  TITULO_PLACEHOLDER,
  montarContexto,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'
import { comentarReportAction, criarReportAction } from '@/actions/reports'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ContextoTecnico } from './contexto-tecnico'
import { Numero, StatusBadge, TipoIcone } from './badges'
import { buscarComentarios, buscarMeusReports, reportsKeys } from './queries'

/** Versão da aplicação, para o contexto. Vem do build; ausente é melhor que errado. */
const APP_VERSAO = process.env.NEXT_PUBLIC_APP_VERSAO ?? null

/**
 * O modal de reportar (04m §2), com "Meus reports" como aba secundária.
 *
 * As duas abas juntas não são conveniência: sem a segunda, quem reporta manda o
 * texto para um buraco. Com ela, o acompanhamento não depende de o autor ter
 * visto a notificação — e é isso que faz alguém reportar uma segunda vez.
 */
export function ReportDialog({
  open,
  onOpenChange,
  usuarioId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  usuarioId: string
}) {
  const [aba, setAba] = React.useState('novo')

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        // Reabrir sempre no formulário: quem clica no ícone quer reportar. Quem
        // quer acompanhar sabe que a segunda aba existe.
        if (!v) setAba('novo')
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reportar</DialogTitle>
          <DialogDescription>
            Um problema que você viu ou uma ideia que facilitaria o seu trabalho.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="w-full">
            <TabsTrigger value="novo" className="flex-1">
              Novo report
            </TabsTrigger>
            <TabsTrigger value="meus" className="flex-1">
              Meus reports
            </TabsTrigger>
          </TabsList>

          <TabsContent value="novo" className="pt-4">
            <Formulario onEnviado={() => setAba('meus')} />
          </TabsContent>

          <TabsContent value="meus" className="pt-4">
            <MeusReports usuarioId={usuarioId} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ─── Formulário ─────────────────────────────────────────────────────────────

function Formulario({ onEnviado }: { onEnviado: () => void }) {
  const pathname = usePathname()
  const qc = useQueryClient()
  const [tipo, setTipo] = React.useState<TipoReport>('bug')
  const [titulo, setTitulo] = React.useState('')
  const [descricao, setDescricao] = React.useState('')
  const [anexo, setAnexo] = React.useState<File | null>(null)

  /*
   * O contexto é montado no RENDER, não no submit.
   *
   * Entre abrir o modal e apertar "enviar" o usuário pode redimensionar a janela
   * — e a rota, no App Router, não muda com o modal aberto, mas o viewport muda.
   * O que interessa é o estado em que ele estava quando viu o problema.
   */
  const contexto = React.useMemo(
    () =>
      montarContexto({
        rota: pathname,
        url: typeof window === 'undefined' ? null : window.location.href,
        plataforma: 'web',
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        viewport:
          typeof window === 'undefined'
            ? null
            : { largura: window.innerWidth, altura: window.innerHeight },
        appVersao: APP_VERSAO,
      }),
    [pathname],
  )

  const enviar = useMutation({
    mutationFn: async () => {
      const anexoUrl = anexo ? await subirAnexo(anexo) : null
      const r = await criarReportAction({ tipo, titulo, descricao, contexto, anexo_url: anexoUrl })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (data) => {
      toast.success(`Report #${data.numero} enviado.`, {
        description: 'Você acompanha o andamento em "Meus reports".',
      })
      setTitulo('')
      setDescricao('')
      setAnexo(null)
      void qc.invalidateQueries({ queryKey: reportsKeys.todos })
      onEnviado()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.'),
  })

  const podeEnviar = titulo.trim().length >= 3 && descricao.trim().length >= 5

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (podeEnviar && !enviar.isPending) enviar.mutate()
      }}
    >
      {/* Dois botões grandes, não um dropdown (§2): a escolha muda o resto do
          formulário, e um dropdown esconde metade da decisão atrás de um clique. */}
      <div className="grid grid-cols-2 gap-2">
        <BotaoTipo
          ativo={tipo === 'bug'}
          onClick={() => setTipo('bug')}
          icone={<Bug className="h-5 w-5" aria-hidden />}
          titulo="Bug"
          descricao="Algo não funciona"
        />
        <BotaoTipo
          ativo={tipo === 'melhoria'}
          onClick={() => setTipo('melhoria')}
          icone={<Lightbulb className="h-5 w-5" aria-hidden />}
          titulo="Melhoria"
          descricao="Algo poderia ser melhor"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="report-titulo">Título</Label>
        <Input
          id="report-titulo"
          value={titulo}
          maxLength={140}
          placeholder={TITULO_PLACEHOLDER[tipo]}
          onChange={(e) => setTitulo(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="report-descricao">Descrição</Label>
        <Textarea
          id="report-descricao"
          value={descricao}
          rows={5}
          maxLength={5000}
          placeholder={DESCRICAO_PLACEHOLDER[tipo]}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>

      <Anexo arquivo={anexo} onEscolher={setAnexo} />

      <ContextoTecnico contexto={contexto} />

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!podeEnviar || enviar.isPending}>
          {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Enviar
        </Button>
      </div>
    </form>
  )
}

function BotaoTipo({
  ativo,
  onClick,
  icone,
  titulo,
  descricao,
}: {
  ativo: boolean
  onClick: () => void
  icone: React.ReactNode
  titulo: string
  descricao: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
        ativo ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40',
      )}
    >
      <span className={cn('flex items-center gap-2 font-medium', ativo && 'text-primary')}>
        {icone}
        {titulo}
      </span>
      <span className="text-xs text-muted-foreground">{descricao}</span>
    </button>
  )
}

/**
 * Os formatos que o bucket aceita (`allowed_mime_types`, migração 0141). A lista
 * está aqui de novo para o recado ser em português: o `accept` do <input> é uma
 * sugestão que todo navegador deixa contornar em "todos os arquivos".
 */
const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** 5 MB — o mesmo teto que o bucket impõe, dito antes da viagem. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024

/**
 * O upload acontece no SUBMIT, não ao escolher o arquivo.
 *
 * Quem escolhe um print e desiste do report não deve deixar um objeto órfão num
 * bucket que ninguém mais consegue apagar (a policy de DELETE é só do admin, de
 * propósito). Escolher é local; subir é parte de enviar.
 */
async function subirAnexo(arquivo: File): Promise<string> {
  const supabase = createClient()
  const { data: sessao } = await supabase.auth.getUser()
  const uid = sessao.user?.id
  if (!uid) throw new Error('Sua sessão expirou. Entre novamente.')

  // O caminho COMEÇA pelo id de quem envia: é o primeiro segmento que a policy
  // do Storage usa como âncora, e o report ainda não existe para servir de chave.
  const nome = arquivo.name.replace(/[^\w.\-]/g, '_').slice(-60)
  const caminho = `${uid}/${Date.now()}-${nome}`
  const { error } = await supabase.storage
    .from('report-anexos')
    .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type })
  if (error) throw new Error(`Não foi possível enviar a imagem: ${error.message}`)
  return caminho
}

function Anexo({
  arquivo,
  onEscolher,
}: {
  arquivo: File | null
  onEscolher: (f: File | null) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>Anexo (opcional)</Label>
      {arquivo ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
          <button
            type="button"
            onClick={() => onEscolher(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Remover anexo"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
          <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
          Anexar um print
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              // O bucket recusa os dois casos, mas recusar aqui evita que a pessoa
              // preencha o formulário inteiro para descobrir isso no envio.
              if (f && f.size > TAMANHO_MAXIMO) {
                toast.error('A imagem passa de 5 MB.')
                return
              }
              if (f && !TIPOS_ACEITOS.includes(f.type)) {
                toast.error('Formato não aceito. Use JPG, PNG, WEBP ou GIF.')
                return
              }
              onEscolher(f)
            }}
          />
        </label>
      )}
    </div>
  )
}

// ─── Meus reports ───────────────────────────────────────────────────────────

function MeusReports({ usuarioId }: { usuarioId: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: reportsKeys.meus(),
    queryFn: () => buscarMeusReports(usuarioId),
  })

  if (isPending) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  if (isError) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Não foi possível carregar.</p>
  }
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Você ainda não reportou nada. O que você mandar aparece aqui com o status atual.
      </p>
    )
  }

  return (
    <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
      {data.map((r) => (
        <MeuReport key={r.id} id={r.id} numero={r.numero} tipo={r.tipo} titulo={r.titulo} status={r.status} />
      ))}
    </div>
  )
}

function MeuReport({
  id,
  numero,
  tipo,
  titulo,
  status,
}: {
  id: string
  numero: number
  tipo: string
  titulo: string
  status: string
}) {
  const [aberto, setAberto] = React.useState(false)
  // Os comentários só são buscados quando a linha abre: a aba costuma listar
  // dezenas de reports, e uma consulta por linha ao montar seria dezenas de
  // consultas para ler nenhuma delas.
  const comentarios = useQuery({
    queryKey: reportsKeys.comentarios(id),
    queryFn: () => buscarComentarios(id),
    enabled: aberto,
  })

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-start gap-2 p-3 text-left"
      >
        <TipoIcone tipo={tipo} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Numero numero={numero} />
            <StatusBadge status={status} />
          </span>
          <span className="mt-1 block text-sm">{titulo}</span>
        </span>
      </button>

      {aberto && (
        <div className="space-y-3 border-t px-3 py-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {STATUS_REPORT_DESCRICOES[status as StatusReport] ?? ''}
          </p>

          {comentarios.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : comentarios.data && comentarios.data.length > 0 ? (
            <ul className="space-y-2">
              {comentarios.data.map((c) => (
                <li key={c.id} className="rounded-md bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">
                    {c.autor_nome ?? 'Equipe'} ·{' '}
                    {new Date(c.criado_em).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </p>
                  <p className="whitespace-pre-wrap">{c.texto}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Ainda sem comentários.</p>
          )}

          <ResponderNoReport reportId={id} />
        </div>
      )}
    </div>
  )
}

/**
 * O autor responde no próprio report.
 *
 * Sem isto, "qual navegador você usou?" é uma pergunta que a thread não tem como
 * responder — e a triagem para na primeira dúvida.
 */
function ResponderNoReport({ reportId }: { reportId: string }) {
  const qc = useQueryClient()
  const [texto, setTexto] = React.useState('')

  const responder = useMutation({
    mutationFn: async () => {
      const r = await comentarReportAction({ report_id: reportId, texto })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      setTexto('')
      void qc.invalidateQueries({ queryKey: reportsKeys.comentarios(reportId) })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível comentar.'),
  })

  return (
    <div className="flex gap-2">
      <Input
        value={texto}
        placeholder="Responder…"
        maxLength={5000}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && texto.trim() && !responder.isPending) responder.mutate()
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!texto.trim() || responder.isPending}
        onClick={() => responder.mutate()}
      >
        Enviar
      </Button>
    </div>
  )
}
