'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { definirPontoFocalAction } from '@/actions/antecipacao'
import { criarContatoAction, excluirContatoAction } from '@/actions/empresas'
import { rodarContatosEmpresaAction } from '@/actions/radar'
import { cn } from '@/lib/utils'
import { buscarContatos, empresasKeys } from './queries'

/**
 * Contatos da empresa, com a curadoria do PONTO FOCAL (§3.2).
 *
 * O ponto focal existe porque "melhor contato disponível" é um heurística, e um
 * heurística escolhe o estagiário do financeiro quando ele é o único com e-mail
 * preenchido. Marcar um ponto focal é a forma de um humano dizer "fale com esta
 * pessoa" — e a hierarquia inteira do sistema (outbox da Antecipação, botões de
 * contato no mobile) passa a respeitar isso.
 *
 * No máximo um por empresa, garantido por índice parcial único. Marcar outro
 * desmarca o anterior NA MESMA TRANSAÇÃO (RPC app_definir_ponto_focal): duas
 * chamadas do cliente deixariam uma janela em que a segunda falha e a empresa fica
 * sem ponto focal nenhum.
 */
const CAMPOS = [
  { id: 'nome', rotulo: 'Nome', tipo: 'text', placeholder: 'Maria Silva' },
  { id: 'cargo', rotulo: 'Cargo', tipo: 'text', placeholder: 'Diretora financeira' },
  { id: 'email', rotulo: 'E-mail', tipo: 'email', placeholder: 'maria@construtora.com.br' },
  { id: 'telefone', rotulo: 'Telefone', tipo: 'tel', placeholder: '(11) 3000-0000' },
  { id: 'whatsapp', rotulo: 'WhatsApp', tipo: 'tel', placeholder: '(11) 99999-0000' },
  { id: 'linkedin_url', rotulo: 'LinkedIn', tipo: 'url', placeholder: 'linkedin.com/in/…' },
] as const

/** Formulário do contato manual. Nada é obrigatório além de UMA forma de contato. */
function NovoContatoDialog({
  empresaId,
  aberto,
  onOpenChange,
  onCriado,
}: {
  empresaId: string
  aberto: boolean
  onOpenChange: (v: boolean) => void
  onCriado: () => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const input = { empresa_id: empresaId } as Record<string, unknown>
    for (const c of CAMPOS) input[c.id] = String(fd.get(c.id) ?? '').trim()

    setSalvando(true)
    setErro(null)
    const r = await criarContatoAction(input)
    setSalvando(false)
    if (!r.ok) {
      // A regra "informe ao menos um contato" chega como fieldError de `nome`.
      setErro(r.fieldErrors?.nome?.[0] ?? r.message)
      return
    }
    toast.success('Contato adicionado.')
    onOpenChange(false)
    onCriado()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={enviar}>
          <DialogHeader>
            <DialogTitle>Adicionar contato</DialogTitle>
            <DialogDescription>
              Fica marcado como manual e o enriquecimento do Apollo nunca sobrescreve.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4 sm:grid-cols-2">
            {CAMPOS.map((c) => (
              <div key={c.id} className="space-y-1.5">
                <Label htmlFor={`contato-${c.id}`}>{c.rotulo}</Label>
                <Input id={`contato-${c.id}`} name={c.id} type={c.tipo} placeholder={c.placeholder} />
              </div>
            ))}
          </div>

          {erro ? <p className="pb-2 text-sm text-destructive">{erro}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EmpresaContatos({ empresaId }: { empresaId: string }) {
  const qc = useQueryClient()
  const [marcando, setMarcando] = React.useState<string | null>(null)
  const [novoAberto, setNovoAberto] = React.useState(false)
  const [enriquecendo, setEnriquecendo] = React.useState(false)
  const [excluindo, setExcluindo] = React.useState<string | null>(null)

  function recarregar() {
    void qc.invalidateQueries({ queryKey: empresasKeys.contatos(empresaId) })
    void qc.invalidateQueries({ queryKey: empresasKeys.eventos(empresaId) })
  }

  /**
   * O enriquecimento é ASSÍNCRONO: o worker devolve 202 e processa em segundo plano.
   * Por isso a mensagem fala em "alguns instantes" e não promete contato na tela —
   * prometer resultado imediato aqui produziria "clicou e não veio nada".
   */
  async function enriquecerApollo() {
    setEnriquecendo(true)
    const r = await rodarContatosEmpresaAction({ empresaId })
    setEnriquecendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'Não foi possível disparar o enriquecimento.')
      return
    }
    toast.success('Buscando contatos no Apollo. Recarregue em alguns instantes.')
  }

  async function excluir(id: string) {
    setExcluindo(id)
    const r = await excluirContatoAction({ id })
    setExcluindo(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Contato excluído.')
    recarregar()
  }

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.contatos(empresaId),
    queryFn: () => buscarContatos(empresaId),
  })

  async function alternar(id: string, atual: boolean) {
    setMarcando(id)
    const r = await definirPontoFocalAction({ id, ponto_focal: !atual })
    setMarcando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(atual ? 'Ponto focal removido.' : 'Ponto focal definido.')
    recarregar()
  }

  if (isPending) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar os contatos.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Contatos</CardTitle>
            <CardDescription>
              O ponto focal é quem toda abordagem procura primeiro — outbox da Antecipação e botões
              de contato no app. Só um por empresa; marcar outro desmarca o anterior.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNovoAberto(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Adicionar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={enriquecendo}
              onClick={() => void enriquecerApollo()}
              title="Busca contatos no Apollo. Ação paga, por contato revelado."
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
              {enriquecendo ? 'Disparando…' : 'Buscar no Apollo'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <NovoContatoDialog
        empresaId={empresaId}
        aberto={novoAberto}
        onOpenChange={setNovoAberto}
        onCriado={recarregar}
      />

      <CardContent className="p-0">
        {data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted p-3">
              <UserRound className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="font-medium">Nenhum contato conhecido</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Adicione à mão, busque no Apollo, ou espere o lote de contatos do Radar. Enriquecer
                exige domínio resolvido na empresa.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setNovoAberto(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                Adicionar contato
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={enriquecendo}
                onClick={() => void enriquecerApollo()}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                {enriquecendo ? 'Disparando…' : 'Buscar no Apollo'}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {data.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex flex-wrap items-start justify-between gap-3 px-6 py-4',
                  c.ponto_focal && 'bg-amber-50/60 dark:bg-amber-950/20',
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.nome ?? 'Sem nome'}</p>
                    {c.ponto_focal && (
                      <Badge className="gap-1 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                        <Star className="h-3 w-3 fill-current" aria-hidden />
                        Ponto focal
                      </Badge>
                    )}
                    {c.senioridade && <Badge variant="outline">{c.senioridade}</Badge>}
                    {c.origem === 'manual' && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Manual
                      </Badge>
                    )}
                    {/* 'pendente' significa que o telefone foi pedido ao Apollo e o
                        webhook ainda não voltou — sem isto, "sem telefone" e
                        "esperando telefone" ficam indistinguíveis na tela. */}
                    {c.telefone_status === 'pendente' && !c.telefone && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Telefone a caminho
                      </Badge>
                    )}
                  </div>

                  {c.cargo && <p className="text-sm text-muted-foreground">{c.cargo}</p>}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden />
                        {c.email}
                      </a>
                    )}
                    {c.telefone && (
                      <a
                        href={`tel:${c.telefone.replace(/\D/g, '')}`}
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {c.telefone}
                      </a>
                    )}
                    {c.whatsapp && (
                      <a
                        href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {c.whatsapp}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant={c.ponto_focal ? 'secondary' : 'outline'}
                    size="sm"
                    disabled={marcando === c.id}
                    onClick={() => void alternar(c.id, c.ponto_focal)}
                    aria-pressed={c.ponto_focal}
                  >
                    <Star
                      className={cn('mr-1 h-3.5 w-3.5', c.ponto_focal && 'fill-current')}
                      aria-hidden
                    />
                    {marcando === c.id
                      ? 'Salvando…'
                      : c.ponto_focal
                        ? 'Remover ponto focal'
                        : 'Definir ponto focal'}
                  </Button>

                  {/* Só o manual: o do Apollo voltaria no próximo lote, e um botão que
                      desfaz sozinho é pior que botão nenhum. */}
                  {c.origem === 'manual' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={excluindo === c.id}
                      onClick={() => void excluir(c.id)}
                      aria-label={`Excluir ${c.nome ?? 'contato'}`}
                      title="Excluir contato"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
