'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, Paperclip, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

/**
 * As notas do CARD (0220).
 *
 * ─── DO CARD, NÃO DA EMPRESA ────────────────────────────────────────────────
 * O que o SDR anota na reunião NÃO aparece no funil de vendas. Foi a escolha de quem
 * pediu, e ela tem consequência real na passagem de bastão — está escrita aqui para
 * que ninguém a descubra por acidente.
 *
 * ─── PUBLICADA, NÃO EDITÁVEL ────────────────────────────────────────────────
 * Uma anotação é o registro do que alguém sabia NAQUELE momento. Reescrevê-la depois
 * de o negócio mudar transforma o histórico em versão dos vencedores — e o histórico
 * é justamente o que faz a nota valer alguma coisa três semanas depois.
 *
 * Apagar a própria continua possível: errar o card ao escrever é comum, e o texto
 * fica visível para o time. Só o autor apaga, e a RLS é quem garante — o botão some
 * para os outros porque oferecer e depois recusar ensina que o sistema erra.
 */

const BUCKET = 'funil-notas'
/** O mesmo teto do bucket. Conferido aqui para a recusa ter explicação, não erro. */
const MAX_BYTES = 20 * 1024 * 1024

export type FunilDaNota = 'sdr' | 'vendedor' | 'certificado'

interface AnexoDaNota {
  caminho: string
  nome: string
  mime: string | null
  tamanho: number | null
}

interface NotaDoFunil {
  id: string
  conteudo: string
  anexos: AnexoDaNota[]
  criado_em: string
  autor_usuario_id: string
  autor: string | null
}

export const notasKeys = {
  card: (funil: string, cardId: string) => ['comercial', 'notas', funil, cardId] as const,
}

/**
 * `autor_usuario_id` NÃO tem FK para `usuarios` no schema das notas de empresa, e aqui
 * tem — mas o join embutido do PostgREST depende da FK estar exposta, e a de
 * `funil_notas` aponta para uma tabela que o Comercial pode não ler inteira. Duas
 * consultas resolvem sem depender disso, e a segunda é sobre um punhado de ids.
 */
async function buscarNotas(funil: FunilDaNota, cardId: string): Promise<NotaDoFunil[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('funil_notas')
    .select('id, conteudo, anexos, criado_em, autor_usuario_id')
    .eq('funil', funil)
    .eq('card_id', cardId)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)

  const linhas = (data ?? []) as unknown as Omit<NotaDoFunil, 'autor'>[]
  const ids = [...new Set(linhas.map((n) => n.autor_usuario_id))]
  const nomes = new Map<string, string>()
  if (ids.length > 0) {
    const { data: us } = await supabase.from('usuarios').select('id, nome').in('id', ids)
    for (const u of us ?? []) nomes.set(u.id, u.nome)
  }

  return linhas.map((n) => ({
    ...n,
    anexos: Array.isArray(n.anexos) ? (n.anexos as AnexoDaNota[]) : [],
    autor: nomes.get(n.autor_usuario_id) ?? null,
  }))
}

function tamanhoLegivel(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AbaNotas({ funil, cardId }: { funil: FunilDaNota; cardId: string }) {
  const qc = useQueryClient()

  /*
   * Quem está olhando, perguntado AQUI e não recebido por prop.
   *
   * Ele decide de quais notas o botão de apagar aparece — e só isso. Enfiar a resposta
   * por três funis seria três lugares para esquecer de passar, num dado que o cliente
   * do Supabase já tem em memória. A guarda de verdade é a RLS: o botão escondido é
   * cortesia, não permissão.
   */
  const eu = useQuery({
    queryKey: ['auth', 'usuario-atual'],
    queryFn: async () => (await createClient().auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  })
  const meuUsuarioId = eu.data ?? null
  const [texto, setTexto] = React.useState('')
  const [arquivos, setArquivos] = React.useState<File[]>([])
  const inputRef = React.useRef<HTMLInputElement>(null)

  const notas = useQuery({
    queryKey: notasKeys.card(funil, cardId),
    queryFn: () => buscarNotas(funil, cardId),
  })

  const publicar = useMutation({
    mutationFn: async () => {
      const supabase = createClient()

      /*
       * Os anexos sobem ANTES da nota. Se um falhar, nada é publicado — uma nota que
       * cita "segue o print" sem o print é pior que a recusa, porque ninguém descobre
       * que faltou até precisar dele.
       *
       * O caminho é `{funil}/{cardId}/...` porque é ele que carrega a permissão: a
       * policy do bucket lê as duas primeiras pastas e pergunta ao mesmo
       * `app_ve_card_do_funil` que guarda a tabela.
       */
      const anexos: AnexoDaNota[] = []
      for (const f of arquivos) {
        const caminho = `${funil}/${cardId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.\-]/g, '_')}`
        const { error } = await supabase.storage.from(BUCKET).upload(caminho, f)
        if (error) throw new Error(`Falha ao subir "${f.name}": ${error.message}`)
        anexos.push({ caminho, nome: f.name, mime: f.type || null, tamanho: f.size })
      }

      const { error } = await supabase.rpc('app_criar_nota_funil' as never, {
        p: { funil, card_id: cardId, conteudo: texto, anexos },
      } as never)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setTexto('')
      setArquivos([])
      if (inputRef.current) inputRef.current.value = ''
      void qc.invalidateQueries({ queryKey: notasKeys.card(funil, cardId) })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient()
      const { error } = await supabase.from('funil_notas').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: notasKeys.card(funil, cardId) }),
    onError: (e: Error) => toast.error(e.message),
  })

  async function abrirAnexo(caminho: string, nome: string) {
    const supabase = createClient()
    // Assinado NO CLIQUE, e com validade curta: assinar a lista inteira no render
    // geraria URLs válidas para arquivos que ninguém pediu.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300, {
      download: nome,
    })
    if (error || !data) {
      toast.error('Não foi possível abrir o anexo.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function escolherArquivos(lista: FileList | null) {
    const novos = [...(lista ?? [])]
    const grandes = novos.filter((f) => f.size > MAX_BYTES)
    if (grandes.length > 0) {
      toast.error(
        `${grandes.map((f) => `"${f.name}"`).join(', ')} passa${grandes.length > 1 ? 'm' : ''} de 20 MB.`,
      )
    }
    setArquivos((a) => [...a, ...novos.filter((f) => f.size <= MAX_BYTES)])
  }

  const podePublicar = texto.trim() !== '' && !publicar.isPending

  return (
    <div className="space-y-4">
      {/*
        O compositor fica em CIMA, e a lista embaixo em ordem decrescente: quem abre a
        aba Notas ou vem escrever, ou vem ler a última. As duas coisas estão no topo.
      */}
      <div className="space-y-2 rounded-lg border p-3">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          placeholder="O que aconteceu, o que ficou combinado, o que o cliente disse…"
          aria-label="Nova nota"
        />

        {arquivos.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {arquivos.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
              >
                <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="max-w-48 truncate">{f.name}</span>
                <span className="text-muted-foreground">{tamanhoLegivel(f.size)}</span>
                <button
                  type="button"
                  aria-label={`Remover ${f.name}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => escolherArquivos(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => inputRef.current?.click()}
            >
              <Paperclip className="mr-1 size-3.5" aria-hidden />
              Anexar
            </Button>
          </div>
          <Button size="sm" disabled={!podePublicar} onClick={() => publicar.mutate()}>
            {publicar.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="mr-1 size-3.5" aria-hidden />
            )}
            {publicar.isPending ? 'Publicando…' : 'Publicar'}
          </Button>
        </div>
      </div>

      {notas.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : (notas.data ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma nota ainda. O que você escrever aqui fica no card — visível para quem
          enxerga este funil, e não para o cliente.
        </p>
      ) : (
        <ul className="space-y-2">
          {(notas.data ?? []).map((n) => (
            <li key={n.id} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium">{n.autor ?? 'Alguém'}</p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(n.criado_em).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {meuUsuarioId === n.autor_usuario_id && (
                    <button
                      type="button"
                      aria-label="Apagar nota"
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      disabled={apagar.isPending}
                      onClick={() => apagar.mutate(n.id)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {/* `whitespace-pre-wrap`: quem escreveu em linhas quis linhas. */}
              <p className="whitespace-pre-wrap text-sm">{n.conteudo}</p>

              {n.anexos.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 pt-0.5">
                  {n.anexos.map((a) => (
                    <li key={a.caminho}>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
                        onClick={() => void abrirAnexo(a.caminho, a.nome)}
                      >
                        <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="max-w-48 truncate">{a.nome}</span>
                        {a.tamanho ? (
                          <span className="text-muted-foreground">{tamanhoLegivel(a.tamanho)}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
