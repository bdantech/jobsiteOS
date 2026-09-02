'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Mail,
  Megaphone,
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
import { buscarContatosEmCampanha } from '@/components/campanhas/queries'
import { BotaoDeToque } from '@/components/comunicacao/botao-toque'
import { Compositor } from '@/components/comunicacao/compositor'
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
import {
  rodarContatosEmpresaAction,
  ultimoEnriquecimentoContatosAction,
  type DesfechoContatos,
} from '@/actions/radar'
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
  resolverEmpresaId,
  aberto,
  onOpenChange,
  onCriado,
}: {
  /** Resolve a empresa no SUBMIT — pode promover um fornecedor que ainda não existe. */
  resolverEmpresaId: () => Promise<string | null>
  aberto: boolean
  onOpenChange: (v: boolean) => void
  onCriado: (empresaId: string) => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const valores: Record<string, unknown> = {}
    for (const c of CAMPOS) valores[c.id] = String(fd.get(c.id) ?? '').trim()

    setSalvando(true)
    setErro(null)

    // A empresa é resolvida AQUI, e não ao abrir o diálogo: para o fornecedor não
    // promovido isso significa criar a empresa, e criar uma empresa porque alguém
    // abriu um formulário e desistiu é lixo que ninguém vai limpar.
    const empresaId = await resolverEmpresaId()
    if (!empresaId) {
      setSalvando(false)
      setErro('Não foi possível preparar a empresa para receber o contato.')
      return
    }

    const r = await criarContatoAction({ ...valores, empresa_id: empresaId })
    setSalvando(false)
    if (!r.ok) {
      // A regra "informe ao menos um contato" chega como fieldError de `nome`.
      setErro(r.fieldErrors?.nome?.[0] ?? r.message)
      return
    }
    toast.success('Contato adicionado.')
    onOpenChange(false)
    onCriado(empresaId)
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

export interface EmpresaContatosProps {
  /** `null` quando a empresa ainda não existe — ver `aoPrecisarDeEmpresa`. */
  empresaId: string | null
  /**
   * Chamado antes de qualquer escrita quando `empresaId` é `null`, e devolve o id da
   * empresa (criando-a). Existe para o fornecedor do funil, que não é promovido no
   * sync: quem tem contato merece ficha, e a promoção vira consequência da ação em
   * vez de um passo separado que a pessoa precisa lembrar de fazer antes.
   */
  aoPrecisarDeEmpresa?: () => Promise<string | null>
}

export function EmpresaContatos({ empresaId, aoPrecisarDeEmpresa }: EmpresaContatosProps) {
  const qc = useQueryClient()
  const [marcando, setMarcando] = React.useState<string | null>(null)
  const [novoAberto, setNovoAberto] = React.useState(false)
  const [enriquecendo, setEnriquecendo] = React.useState(false)
  const [excluindo, setExcluindo] = React.useState<string | null>(null)
  /** Qual contato tem o compositor aberto. Um por vez: dois seriam duas mensagens. */
  const [compondo, setCompondo] = React.useState<string | null>(null)

  /**
   * Recebe o id explicitamente porque, no caminho da promoção, ele acabou de nascer:
   * ler o `empresaId` da prop aqui pegaria o `null` do render anterior e a lista
   * ficaria vazia logo depois de adicionar o primeiro contato.
   */
  function recarregar(id: string | null = empresaId) {
    if (!id) return
    void qc.invalidateQueries({ queryKey: empresasKeys.contatos(id) })
    void qc.invalidateQueries({ queryKey: empresasKeys.eventos(id) })
  }

  const resolverEmpresaId = React.useCallback(async (): Promise<string | null> => {
    if (empresaId) return empresaId
    return (await aoPrecisarDeEmpresa?.()) ?? null
  }, [empresaId, aoPrecisarDeEmpresa])

  /**
   * O enriquecimento é ASSÍNCRONO: o worker devolve 202 e processa em segundo plano.
   * Por isso a mensagem fala em "alguns instantes" e não promete contato na tela —
   * prometer resultado imediato aqui produziria "clicou e não veio nada".
   */
  /*
   * O DESFECHO DA BUSCA, e não só o disparo.
   *
   * O job é assíncrono e a tela dizia "recarregue em alguns instantes". Quando o
   * Apollo achava 300 pessoas e nenhuma casava os cargos-alvo, o motivo ficava
   * gravado no lote e ninguém via — a pessoa recarregava, não via contato e não
   * tinha o que fazer com isso. "Não achou ninguém" e "achou 300 e nenhuma serve"
   * pedem ações diferentes: a primeira é um problema de domínio, a segunda é de
   * filtro de cargo.
   */
  const [acompanhando, setAcompanhando] = React.useState<string | null>(null)
  const desfecho = useQuery({
    queryKey: ['empresa', 'contatos-desfecho', empresaId ?? acompanhando],
    queryFn: async () => {
      const r = await ultimoEnriquecimentoContatosAction((empresaId ?? acompanhando)!)
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    enabled: Boolean(empresaId ?? acompanhando),
    // Só enquanto está rodando. Um polling permanente numa ficha aberta o dia
    // inteiro seria uma consulta a cada 4s para ver um resultado que não muda.
    refetchInterval: (q) =>
      acompanhando && (q.state.data?.status === 'processando' || !q.state.data) ? 4000 : false,
  })

  React.useEffect(() => {
    if (!acompanhando || !desfecho.data || desfecho.data.status === 'processando') return
    setAcompanhando(null)
    // Invalida direto, sem passar por `recarregar`: aquela função é recriada a cada
    // render (ela lê `empresaId` da prop) e como dependência faria este efeito
    // rodar sempre. `qc` e o id são estáveis, que é tudo de que ele precisa.
    void qc.invalidateQueries({ queryKey: empresasKeys.contatos(acompanhando) })
    void qc.invalidateQueries({ queryKey: empresasKeys.eventos(acompanhando) })
  }, [acompanhando, desfecho.data, qc])

  async function enriquecerApollo() {
    setEnriquecendo(true)
    const id = await resolverEmpresaId()
    if (!id) {
      setEnriquecendo(false)
      toast.error('Não foi possível preparar a empresa para o enriquecimento.')
      return
    }
    const r = await rodarContatosEmpresaAction({ empresaId: id })
    setEnriquecendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.enfileirado) {
      toast.error(r.data.aviso ?? 'Não foi possível disparar o enriquecimento.')
      return
    }
    toast.success('Buscando contatos no Apollo — o resultado aparece aqui em alguns segundos.')
    // Acorda o acompanhamento: daqui a diante ele repete até o item sair de "processando".
    setAcompanhando(id)
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

  // Sem empresa não há o que buscar — e `enabled: false` deixa a query em `pending`
  // para sempre, então os estados de carregamento abaixo também olham o `empresaId`.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: empresasKeys.contatos(empresaId ?? 'sem-empresa'),
    queryFn: () => buscarContatos(empresaId as string),
    enabled: empresaId !== null,
  })

  /*
   * "Esta pessoa está em campanha AGORA?" (05B §8).
   *
   * Existe para responder antes de o telefonema acontecer: o clássico é o
   * vendedor ligar sem saber que a pessoa recebeu um disparo nosso hoje de
   * manhã. A view só traz campanhas VIVAS — de campanha concluída há dois meses
   * o badge seria ruído.
   */
  const emCampanha = useQuery({
    queryKey: ['campanhas', 'contatos-da-empresa', empresaId ?? 'sem-empresa'],
    queryFn: () => buscarContatosEmCampanha(empresaId as string),
    enabled: empresaId !== null,
    staleTime: 60_000,
  })

  const campanhaPorContato = new Map(
    (emCampanha.data ?? [])
      .filter((x) => x.contato_id !== null)
      .map((x) => [x.contato_id as string, x]),
  )

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

  if (empresaId !== null && isPending) {
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

  if (empresaId !== null && isError) {
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

  const contatos = data ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Contatos</CardTitle>
            <CardDescription>
              O ponto focal é quem toda abordagem procura primeiro — outbox da Antecipação e botões
              de contato no app. Só um por empresa; marcar outro desmarca o anterior.
              {empresaId === null && (
                <>
                  {' '}
                  Este fornecedor ainda não tem ficha em Empresas — ela é criada
                  automaticamente quando você salvar o primeiro contato.
                </>
              )}
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
              {enriquecendo ? 'Disparando…' : acompanhando ? 'Buscando…' : 'Buscar no Apollo'}
            </Button>
          </div>
        </div>
        {desfecho.data ? <DesfechoApollo d={desfecho.data} /> : null}
      </CardHeader>

      <NovoContatoDialog
        resolverEmpresaId={resolverEmpresaId}
        aberto={novoAberto}
        onOpenChange={setNovoAberto}
        onCriado={recarregar}
      />

      <CardContent className="p-0">
        {contatos.length === 0 ? (
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
            {contatos.map((c) => (
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
                    {campanhaPorContato.has(c.id) && (
                      <Link
                        href={`/comercial/campanhas/${campanhaPorContato.get(c.id)!.campanha_id}`}
                        title="Recebeu (ou vai receber) um disparo desta campanha"
                      >
                        <Badge className="gap-1 bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-200">
                          <Megaphone className="h-3 w-3" aria-hidden />
                          {campanhaPorContato.get(c.id)!.campanha_nome}
                        </Badge>
                      </Link>
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
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" aria-hidden />
                        {c.email}
                      </span>
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
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {c.whatsapp}
                      </span>
                    )}
                  </div>

                  {/*
                    O botão de um toque (05A §5). As duas formas continuam existindo:
                    enviar pela casa grava no ledger e mantém a thread; abrir no app é
                    mais rápido e continua registrando o toque, com a semântica honesta
                    de "o app abriu". Tirar a segunda faria o vendedor abrir o WhatsApp
                    por fora, e aí o toque não fica registrado em lugar nenhum.
                  */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.whatsapp ? (
                      <BotaoDeToque
                        link={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}
                        rotulo="Abrir no meu WhatsApp"
                        onEnviarPelaCasa={() => setCompondo(c.id)}
                      />
                    ) : null}
                    {c.email ? (
                      <BotaoDeToque
                        link={`mailto:${c.email}`}
                        rotulo="Abrir no meu e-mail"
                        onEnviarPelaCasa={() => setCompondo(c.id)}
                      />
                    ) : null}
                  </div>

                  {/* `empresaId` é nulo enquanto a empresa não foi criada (o fluxo de
                      promoção do Radar). Sem empresa não há thread para escrever. */}
                  {compondo === c.id && empresaId ? (
                    <div className="mt-3">
                      <Compositor
                        empresaId={empresaId}
                        contatoIdInicial={c.id}
                        onEnviado={() => setCompondo(null)}
                      />
                    </div>
                  ) : null}
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

/**
 * O que a última busca no Apollo devolveu, em uma linha.
 *
 * `sem_dados` com `encontradas` é o caso que mais confundia: a busca funcionou, o
 * Apollo tinha gente, e o filtro de cargos-alvo não deixou ninguém passar. Dizer
 * o número é o que transforma "não veio nada" numa informação acionável — o
 * problema não é a empresa, é a régua de cargos.
 */
function DesfechoApollo({ d }: { d: DesfechoContatos }) {
  const quando = new Date(d.quando).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const texto =
    d.status === 'processando'
      ? 'Buscando no Apollo…'
      : d.status === 'sucesso'
        ? `${d.criados ?? 0} contato(s) trazido(s) do Apollo.`
        : d.status === 'sem_dados' && d.encontradas
          ? `${d.encontradas} pessoas na empresa e nenhuma nos cargos-alvo — ninguém foi revelado, ` +
            `e nada foi cobrado. A régua de cargos vive na configuração do Radar.`
          : (d.motivo ?? 'A busca não trouxe contatos.')

  return (
    <p className="mt-2 text-[11px] text-muted-foreground">
      Última busca ({quando}): {texto}
    </p>
  )
}
