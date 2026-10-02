'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EyeOff, Link2, Mail, MessageCircle, Search, Undo2, X } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  ignorarConversaAction,
  ocultarConversaAction,
  reabrirConversaAction,
  vincularConversaAction,
} from '@/actions/comunicacao'
import {
  contarIdentificacao,
  listarIdentificacao,
  type EscopoIdentificacao,
  type LinhaIdentificacao,
} from './queries'
import { useEscopoFila } from './use-escopo-fila'
import { desde, identificadorLegivel } from './format'

/**
 * A fila de identificação (§4) — LISTA, e o vínculo num modal.
 *
 * A primeira versão era um formulário inteiro por linha, e com quarenta contatos na
 * fila a tela virava quarenta formulários: ninguém conseguia ver de relance quantos
 * eram, de quem, e há quanto tempo. Agora a lista responde isso, e o formulário só
 * existe para a linha que alguém decidiu vincular.
 *
 * ── O NOME VEM PRÉ-PREENCHIDO, E ISSO NÃO É DETALHE ────────────────────────
 * O `pushName` do WhatsApp e o display name do e-mail são o que a própria pessoa
 * escolheu se chamar. Pedir para digitar do zero é o atrito que faz a fila
 * acumular — e uma fila de identificação acumulada é a mesma coisa que não ter
 * fila nenhuma.
 *
 * ── VINCULAR CRIA O CONTATO OFICIAL ────────────────────────────────────────
 * Não é só apontar para a empresa: o contato passa a existir, com base legal
 * derivada, e as mensagens já recebidas migram para a thread dele. Tudo numa
 * transação — meia vinculação seria um contato criado com a conversa órfã, e a
 * pessoa vincularia de novo criando um segundo contato.
 *
 * ── IGNORADOS TÊM VOLTA ────────────────────────────────────────────────────
 * Ignorar tira a conversa da fila e do Meu Dia (0278). A aba "Ignorados" é onde o
 * engano se desfaz, sem esperar a pessoa escrever de novo.
 */

const TODOS = '__todos__'

type Aba = 'pendente' | 'ignorada'

export function FilaNaoVinculadas({ ehAdmin }: { ehAdmin: boolean }) {
  const qc = useQueryClient()
  const fila = useEscopoFila()
  const [todosEscolhido, setTodosEscolhido] = React.useState<boolean | null>(null)
  const [aba, setAba] = React.useState<Aba>('pendente')
  const [vinculando, setVinculando] = React.useState<LinhaIdentificacao | null>(null)
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  /*
   * O Admin sem fila própria abre em "Todos": a alternativa era uma tela pedindo para
   * escolher alguém antes de mostrar qualquer coisa — e as linhas sem dono, que só
   * aparecem aqui, ficariam sem ninguém olhando.
   */
  const verTodos = ehAdmin && (todosEscolhido ?? (!fila.temFilaPropria && fila.escolhido === null))
  const escopo: EscopoIdentificacao = verTodos
    ? { todos: true }
    : { todos: false, vendedorId: fila.vendedorId }
  const chave = verTodos ? TODOS : fila.vendedorId

  const lista = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'lista', chave, aba],
    queryFn: () => listarIdentificacao(escopo, aba),
  })
  const nPendentes = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'n', chave, 'pendente'],
    queryFn: () => contarIdentificacao(escopo, 'pendente'),
  })
  const nIgnorados = useQuery({
    queryKey: ['comunicacao', 'nao-vinculadas', 'n', chave, 'ignorada'],
    queryFn: () => contarIdentificacao(escopo, 'ignorada'),
  })

  function atualizar() {
    void qc.invalidateQueries({ queryKey: ['comunicacao'] })
  }

  async function executar(id: string, acao: () => Promise<{ ok: boolean; message?: string }>, sucesso?: string) {
    setOcupado(id)
    try {
      const r = await acao()
      if (!r.ok) {
        toast.error(r.message ?? 'Não deu certo.')
        return
      }
      if (sucesso) toast.success(sucesso)
      atualizar()
    } finally {
      setOcupado(null)
    }
  }

  const valorSeletor = verTodos
    ? TODOS
    : (fila.escolhido ?? (fila.temFilaPropria ? '' : '__nenhum__'))

  /**
   * O seletor só aparece para quem enxerga mais de uma fila. Um vendedor comum
   * recebe uma lista de um em `comercial_vendedores_visiveis` e continua vendo
   * exatamente o que via — a própria fila, sem controle nenhum a mais na tela.
   */
  const seletor = fila.podeTrocar || ehAdmin ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Fila de</span>
      <select
        aria-label="Ver a fila de identificação de outra pessoa"
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={valorSeletor}
        onChange={(e) => {
          const v = e.target.value
          if (v === TODOS) {
            setTodosEscolhido(true)
            return
          }
          setTodosEscolhido(false)
          fila.escolher(v === '' ? null : v)
        }}
      >
        {ehAdmin ? <option value={TODOS}>Todos</option> : null}
        {fila.temFilaPropria ? <option value="">Minha fila</option> : null}
        {!fila.temFilaPropria && !ehAdmin ? (
          <option value="__nenhum__" disabled>
            Escolha uma pessoa
          </option>
        ) : null}
        {fila.visiveis.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nome}
          </option>
        ))}
      </select>
    </div>
  ) : null

  const pendentes = nPendentes.data ?? 0
  const ignorados = nIgnorados.data ?? 0
  const deQuem = verTodos
    ? 'no time'
    : fila.escolhido
      ? `na fila de ${fila.visiveis.find((v) => v.id === fila.escolhido)?.nome ?? 'outra pessoa'}`
      : 'na sua fila'

  const linhas = lista.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {nPendentes.isLoading ? '—' : pendentes}
          </p>
          <p className="text-xs text-muted-foreground">
            {pendentes === 1 ? 'contato' : 'contatos'} para vincular {deQuem}
          </p>
        </div>
        {seletor}
      </div>

      <div className="flex gap-1 border-b">
        <AbaBotao ativa={aba === 'pendente'} onClick={() => setAba('pendente')}>
          Para vincular <Contagem n={pendentes} />
        </AbaBotao>
        <AbaBotao ativa={aba === 'ignorada'} onClick={() => setAba('ignorada')}>
          Ignorados <Contagem n={ignorados} />
        </AbaBotao>
      </div>

      {lista.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {/* Vazio por não haver fila e vazio por não ter escolhido de quem ver
              são coisas diferentes; dizer "está tudo identificado" para quem
              ainda não escolheu seria mentira. */}
          {!escopo.todos && escopo.vendedorId === null ? (
            <>
              <p className="font-medium text-foreground">Escolha uma pessoa.</p>
              <p className="mt-1">
                Seu usuário não tem fila própria. Escolha acima para ver a fila de alguém da equipe.
              </p>
            </>
          ) : aba === 'pendente' ? (
            <>
              <p className="font-medium text-foreground">Ninguém esperando identificação.</p>
              <p className="mt-1">Toda conversa recebida está vinculada a uma empresa.</p>
            </>
          ) : (
            <p className="font-medium text-foreground">Nenhum contato ignorado.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                {verTodos ? <TableHead>Fila de</TableHead> : null}
                <TableHead className="text-right">Msgs</TableHead>
                <TableHead>Última mensagem</TableHead>
                {aba === 'ignorada' ? <TableHead>Ignorado</TableHead> : null}
                <TableHead className="text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((n) => {
                const Icone = n.canal === 'email' ? Mail : MessageCircle
                const ident = identificadorLegivel(n.canal, n.identificador_externo)
                return (
                  <TableRow key={n.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{n.nome_sugerido ?? ident}</p>
                          {n.nome_sugerido ? (
                            <p className="truncate text-xs text-muted-foreground">{ident}</p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    {verTodos ? (
                      <TableCell className="text-sm">
                        {n.vendedor?.nome ?? <span className="text-muted-foreground">Sem dono</span>}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right tabular-nums">{n.qtd_mensagens}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {desde(n.ultima_mensagem_em)}
                    </TableCell>
                    {aba === 'ignorada' ? (
                      <TableCell className="text-sm text-muted-foreground">
                        {desde(n.resolvida_em)}
                        {n.resolvedor?.nome ? ` · por ${n.resolvedor.nome}` : ''}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {aba === 'pendente' ? (
                          <>
                            <Button size="sm" onClick={() => setVinculando(n)} disabled={ocupado === n.id}>
                              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                              Vincular
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={ocupado === n.id}
                              onClick={() =>
                                void executar(n.id, () => ignorarConversaAction({ id: n.id }), 'Ignorado. Dá para desfazer na aba Ignorados.')
                              }
                            >
                              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                              Ignorar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Ocultar para mim"
                              aria-label="Ocultar para mim"
                              disabled={ocupado === n.id}
                              onClick={() =>
                                void executar(
                                  n.id,
                                  () => ocultarConversaAction({ nao_vinculada_id: n.id }),
                                  'Some do seu inbox. O time continua vendo.',
                                )
                              }
                            >
                              <EyeOff className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={ocupado === n.id}
                            onClick={() =>
                              void executar(n.id, () => reabrirConversaAction({ id: n.id }), 'De volta à fila para vincular.')
                            }
                          >
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            Tirar do ignorado
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {aba === 'pendente' && linhas.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Ignorar tira da fila de todo mundo — e ela volta se a pessoa escrever de novo, ou pela aba
          Ignorados. Ocultar (<EyeOff className="inline h-3 w-3" aria-hidden />) tira só do seu inbox, e é
          reversível lá.
        </p>
      ) : null}

      {vinculando ? (
        <DialogoVincular
          key={vinculando.id}
          n={vinculando}
          onFechar={() => setVinculando(null)}
          onVinculada={() => {
            setVinculando(null)
            atualizar()
          }}
        />
      ) : null}
    </div>
  )
}

function AbaBotao({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
        ativa
          ? 'border-foreground font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Contagem({ n }: { n: number }) {
  return (
    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
      {n > 99 ? '99+' : n}
    </Badge>
  )
}

interface EmpresaAchada {
  id: string
  cnpj: string
  nome: string
}

function DialogoVincular({
  n,
  onFechar,
  onVinculada,
}: {
  n: LinhaIdentificacao
  onFechar: () => void
  onVinculada: () => void
}) {
  const [busca, setBusca] = React.useState('')
  const [empresa, setEmpresa] = React.useState<EmpresaAchada | null>(null)
  const [nome, setNome] = React.useState(n.nome_sugerido ?? '')
  const [cargo, setCargo] = React.useState('')
  const [ocupado, setOcupado] = React.useState(false)
  const [achadas, setAchadas] = React.useState<EmpresaAchada[]>([])

  const ident = identificadorLegivel(n.canal, n.identificador_externo)

  async function procurar(termo: string) {
    setBusca(termo)
    const t = termo.trim()
    if (t.length < 3) {
      setAchadas([])
      return
    }
    const supabase = createClient()
    // Por CNPJ quando o que foi digitado são dígitos; por nome no resto. Uma busca
    // só por nome não acha nada quando a pessoa cola um CNPJ, que é o caso comum
    // de quem está identificando alguém a partir de uma assinatura de e-mail.
    const digitos = t.replace(/\D/g, '')
    const q =
      digitos.length >= 8
        ? supabase.from('empresas').select('id, cnpj, razao_social, nome_fantasia').ilike('cnpj', `${digitos}%`)
        : supabase
            .from('empresas')
            .select('id, cnpj, razao_social, nome_fantasia')
            .or(`razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%`)

    const { data } = await q.limit(8)
    setAchadas(
      (data ?? []).map((e) => ({
        id: e.id,
        cnpj: e.cnpj,
        nome: e.razao_social ?? e.nome_fantasia ?? e.cnpj,
      })),
    )
  }

  async function vincular() {
    if (!empresa || !nome.trim()) return
    setOcupado(true)
    try {
      const r = await vincularConversaAction({
        id: n.id,
        empresa_id: empresa.id,
        nome: nome.trim(),
        cargo: cargo.trim() || null,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Contato criado e conversa vinculada.')
      onVinculada()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular {n.nome_sugerido ?? ident}</DialogTitle>
          <DialogDescription>
            {n.nome_sugerido ? `${ident} · ` : ''}
            {n.qtd_mensagens} msg{n.qtd_mensagens === 1 ? '' : 's'} · última {desde(n.ultima_mensagem_em)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-3">
            <Label className="text-xs">Empresa</Label>
            {empresa ? (
              <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {empresa.nome} <span className="text-muted-foreground">{formatCnpj(empresa.cnpj)}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEmpresa(null)}>
                  trocar
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    autoFocus
                    value={busca}
                    onChange={(e) => void procurar(e.target.value)}
                    placeholder="Nome ou CNPJ"
                    className="h-9 pl-8"
                  />
                </div>
                {achadas.length > 0 ? (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border">
                    {achadas.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setEmpresa(e)
                            setAchadas([])
                          }}
                          className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          {e.nome} <span className="text-muted-foreground">{formatCnpj(e.cnpj)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Nome do contato</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cargo (opcional)</Label>
            <Input value={cargo} onChange={(e) => setCargo(e.target.value)} className="h-9" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={vincular} disabled={!empresa || !nome.trim() || ocupado}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
