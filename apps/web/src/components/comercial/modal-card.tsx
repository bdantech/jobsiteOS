'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Compositor } from '@/components/comunicacao/compositor'
import { ProximoPasso } from '@/components/comunicacao/proximo-passo'
import { Thread } from '@/components/comunicacao/thread'
import { buscarContatos } from '@/components/comunicacao/queries'
import { promoverContatoAction } from '@/actions/fornecedores'
import { buscarContatosDescobertos, fornecedoresKeys } from './fornecedores/queries'
import { exibirValor, rotuloConfianca, rotuloFonte, varianteConfianca } from './fornecedores/formato'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * O modal do card — um só, para os quatro funis do Comercial.
 *
 * ─── POR QUE AS AÇÕES SAEM DO CARD ──────────────────────────────────────────
 * Três botões por card, vezes quatro colunas, vezes dezenas de cards: a coluna vira
 * uma parede de botões e sobra pouco para o que o card tinha a dizer. Pior, cada
 * clique é uma decisão tomada sem abrir o item — e as decisões que importam (perder,
 * ganhar, reatribuir) merecem o contexto que só o modal mostra.
 *
 * ─── POR QUE ABAS, E NÃO UMA PÁGINA LONGA ───────────────────────────────────
 * O que se lê ao abrir um card é sempre a mesma coisa em três camadas: o ITEM (a
 * nota, o lead, o negócio), a EMPRESA por trás dele, e a conversa que já houve. Uma
 * página longa faria rolar até o que interessa; abas deixam cada camada a um clique e
 * mantêm a primeira idêntica ao que já existia.
 *
 * A ALTURA é fixa com teto e miolo rolável, e não o `grid` sem altura do primitivo:
 * conteúdo variável (uma nota fiscal inteira, 371 CNPJs) fazia a caixa crescer além da
 * viewport, e cabeçalho e rodapé apareciam fora do fundo pintado.
 *
 * ─── AS AÇÕES SUBIRAM PARA O CANTO SUPERIOR DIREITO ─────────────────────────
 * Ganhar, perder e julgar fit são decisões sobre o item INTEIRO, e o rodapé as colocava
 * depois de todo o conteúdo — atrás de uma rolagem, quando a aba era longa. No topo elas
 * ficam onde o olho já está ao abrir o card, e a mesma posição em todos os funis.
 *
 * O rodapé deixou de existir junto: sem ele o miolo ganha altura, que é o recurso escasso
 * num modal.
 *
 * ─── A TRILHA DE ETAPAS SUBSTITUIU AVANÇAR/RECUAR ───────────────────────────
 * Ver `EtapasDoFunil`. Ela fica entre o cabeçalho e as abas porque é a informação que
 * responde "onde este negócio está" — a primeira pergunta de quem abre um card.
 */

export interface AbaModal {
  id: string
  label: string
  conteudo: React.ReactNode
  /** Desabilitada com motivo no title — usada pela aba de comunicação, que ainda não existe. */
  desabilitada?: boolean
}

export function ModalDoCard({
  aberto,
  onOpenChange,
  titulo,
  subtitulo,
  cabecalho,
  etapas,
  abas,
  abaInicial,
  acoes,
  largura = 'max-w-4xl',
}: {
  aberto: boolean
  onOpenChange: (a: boolean) => void
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  /** Badges e afins, sob o título e acima das abas. */
  cabecalho?: React.ReactNode
  /** A trilha de etapas do funil. Fica logo abaixo do cabeçalho. */
  etapas?: React.ReactNode
  abas: AbaModal[]
  /**
   * Em qual aba abrir. Sem ela, a primeira — que é o certo quando todo card do
   * funil faz a mesma pergunta.
   *
   * Existe para quando NÃO faz: um lead que chegou por formulário abre com o que a
   * pessoa escreveu, e um que a régua escolheu abre com o pitch, porque para esse
   * não há formulário nenhum. A ORDEM das abas não muda — trocar o lugar delas de
   * card para card obrigaria a reprocurar a mesma aba a cada abertura.
   */
  abaInicial?: string
  /** As decisões sobre o item inteiro (ganhar, perder, fit). Vão no canto superior direito. */
  acoes?: React.ReactNode
  largura?: string
}) {
  // A aba pedida só vale se ela existe: um id que não casa deixaria o modal sem
  // nenhuma aba marcada, e o corpo em branco.
  const inicial = abas.some((a) => a.id === abaInicial) ? (abaInicial as string) : (abas[0]?.id ?? '')
  const [ativa, setAtiva] = React.useState(inicial)

  // Ao trocar de card, volta para a aba inicial: herdar "Comunicação" do card anterior
  // faria o próximo abrir numa aba que não é a resposta da pergunta que se fez.
  React.useEffect(() => {
    if (aberto) setAtiva(inicial)
  }, [aberto, inicial])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/* `h-[85vh]` e não `max-h`: com altura variável, trocar de aba fazia o modal pular
          de tamanho e o conteúdo dançar sob o cursor. Altura fixa mantém a caixa parada. */}
      <DialogContent className={cn('flex h-[85vh] flex-col gap-0 p-0', largura)}>
        <DialogHeader className="space-y-3 border-b p-5 pb-3 text-left">
          <div className="flex items-start justify-between gap-4">
            {/* `pr-6` some daqui: o X do primitivo fica acima das ações, e o espaço para
                ele é reservado pelo `pr-8` do bloco de ações. */}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">{titulo}</DialogTitle>
              {subtitulo ? <DialogDescription>{subtitulo}</DialogDescription> : null}
            </div>
            {acoes ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 pr-8">
                {acoes}
              </div>
            ) : null}
          </div>
          {cabecalho}
          {etapas}
        </DialogHeader>

        <Tabs value={ativa} onValueChange={setAtiva} className="flex min-h-0 flex-1 flex-col">
          {/*
           * Abas sublinhadas, alinhadas ao mesmo `px-5` do cabeçalho e dividindo a mesma
           * linha de borda. A pílula cinza do primitivo flutuava com recuo próprio dentro
           * de uma faixa com borda embaixo — duas molduras concorrentes, e nenhuma das duas
           * alinhada com o título acima. É o mesmo desenho da navegação do Crédito, que já
           * resolve isso no resto do sistema.
           */}
          <div className="border-b px-5">
            <TabsList className="h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0">
              {abas.map((a) => (
                <TabsTrigger
                  key={a.id}
                  value={a.id}
                  disabled={a.desabilitada}
                  className={cn(
                    'rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-xs shadow-none',
                    'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none',
                  )}
                  title={a.desabilitada ? 'Ainda não implementado.' : undefined}
                >
                  {a.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {abas.map((a) => (
            <TabsContent
              key={a.id}
              value={a.id}
              // `min-h-0` é obrigatório: sem ele o filho com overflow se recusa a
              // encolher e empurra o container de volta ao tamanho do conteúdo.
              className="mt-0 min-h-0 flex-1 overflow-y-auto p-5"
            >
              {a.conteudo}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A aba de comunicação, em todos os cinco funis (05A §9).
 *
 * ── ELA MOSTRA A THREAD DA PESSOA, NÃO A DO CARD ───────────────────────────
 * O filtro é a EMPRESA, e o que partiu deste card ganha uma marca — não um
 * recorte. A mesma pessoa fala com o SDR, com o originador e com o closer; se
 * cada card mostrasse só o que saiu dele, o vendedor abriria o card de vendas sem
 * enxergar o que o SDR combinou na semana passada, e essa é exatamente a
 * duplicação que o ledger existe para não ter.
 *
 * ── O PRÓXIMO PASSO APARECE AQUI, NÃO SÓ NO INBOX ──────────────────────────
 * Quem abre um card está decidindo o que fazer com aquela conta agora. A sugestão
 * pronta no lugar onde a decisão acontece é o que separa um copiloto de um
 * relatório.
 */
export function AbaMensagens({
  empresaId,
  funil,
  funilCardId,
  fornecedorCnpj,
  contatoIdInicial,
  onIrParaFornecedor,
}: {
  empresaId?: string | null
  funil?: 'nfs' | 'fornecedores' | 'sdr' | 'vendas' | 'certificados'
  funilCardId?: string | null
  /**
   * O CNPJ do fornecedor, quando o card veio do funil de NFs. Serve para resolver
   * a empresa que acabou de nascer na aba "Fornecedor" — o agente de contato mora
   * lá, que é onde se responde "com quem falar".
   */
  fornecedorCnpj?: string | null
  /** O contato escolhido na aba "Fornecedor". O compositor abre já nele. */
  contatoIdInicial?: string | null
  /** Leva de volta à aba onde se escolhe com quem falar. */
  onIrParaFornecedor?: () => void
}) {
  /*
   * O contato promovido AQUI, na própria aba.
   *
   * Ele não pode vir do prop: quem promove um descoberto no vazio desta aba não
   * passou pela aba Fornecedor, e é neste contato que o compositor tem de abrir.
   */
  const [promovidoAqui, setPromovidoAqui] = React.useState<string | null>(null)

  /*
   * A empresa é resolvida PELO CNPJ quando o card não a conhece.
   *
   * `nota.fornecedor_empresa_id` é do momento em que o funil foi lido. No instante
   * em que alguém cadastra o contato a empresa passa a existir, mas aquele prop
   * continua nulo até o Kanban inteiro recarregar — e a aba ficaria mostrando o
   * agente de contato por cima de uma empresa que já tem contato. Esta consulta é
   * invalidada pela criação e devolve o id na hora.
   */
  const resolvida = useQuery({
    queryKey: ['comunicacao', 'empresa-do-cnpj', fornecedorCnpj],
    queryFn: async () => {
      const { data } = await createClient()
        .from('empresas')
        .select('id')
        .eq('cnpj', fornecedorCnpj!)
        .maybeSingle()
      return data?.id ?? null
    },
    enabled: !empresaId && Boolean(fornecedorCnpj),
  })

  const empresa = empresaId ?? resolvida.data ?? null

  const contatos = useQuery({
    queryKey: ['comunicacao', 'contatos', empresa],
    queryFn: () => buscarContatos(empresa!),
    enabled: Boolean(empresa),
  })

  /*
   * Sem contato OFICIAL não há o que escrever — mas "sem contato" era uma conclusão
   * cedo demais. A descoberta acha por onde falar e grava em `contatos_descobertos`;
   * só o que alguém promoveu vira linha em `contatos`. A aba lia apenas a segunda
   * lista e anunciava "esta empresa ainda não tem contato" com três telefones
   * achados na aba ao lado — que é uma afirmação falsa sobre o próprio banco.
   *
   * A busca continua morando na aba Fornecedor: "com quem falar" é pergunta sobre o
   * fornecedor. O que vem para cá é só o destravamento do que JÁ FOI ACHADO, porque
   * mandar embora quem já tem o número na tela é o beco que esta aba era.
   */
  const semContato = Boolean(empresa) && !contatos.isPending && (contatos.data ?? []).length === 0

  if (!empresa || semContato) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {empresa
              ? 'Esta empresa ainda não tem contato oficial.'
              : 'Este card ainda não tem ficha de empresa.'}
          </p>
          {/* Neutra de propósito: os quatro outros funis não têm descoberta nenhuma
              para oferecer, e prometer uma lista que não vem seria pior que o beco. */}
          <p className="mt-1">O compositor só manda para contato da ficha.</p>
          {onIrParaFornecedor ? (
            <Button size="sm" variant="outline" className="mt-3" onClick={onIrParaFornecedor}>
              Buscar mais contatos na aba Fornecedor
            </Button>
          ) : null}
        </div>
        {fornecedorCnpj ? (
          <DescobertosParaPromover
            cnpj={fornecedorCnpj}
            onPromovido={(id) => setPromovidoAqui(id)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <SugestaoDaEmpresa empresaId={empresa} />
      <Thread empresaId={empresa} funilCardId={funilCardId} alturaClasse="max-h-[38vh]" />
      <Compositor
        empresaId={empresa}
        funil={funil}
        funilCardId={funilCardId}
        contatoIdInicial={promovidoAqui ?? contatoIdInicial}
      />
    </div>
  )
}

/**
 * Os contatos descobertos que ainda não são da ficha, no vazio da aba de comunicação.
 *
 * NÃO é a segunda cópia do agente de contato: aqui não há busca paga, orçamento nem
 * cadastro à mão — isso é da aba Fornecedor, e continua lá. Aqui há uma lista de
 * leitura e um botão que promove, que é o passo que faltava entre "temos o telefone"
 * e "dá para mandar mensagem".
 *
 * A promoção é a MESMA action da estrela da aba Fornecedor. Ela cria a ficha da
 * empresa quando não existe, e é por isso que este bloco também aparece para o card
 * que ainda não está ligado a uma empresa.
 */
function DescobertosParaPromover({
  cnpj,
  onPromovido,
}: {
  cnpj: string
  onPromovido: (contatoId: string) => void
}) {
  const qc = useQueryClient()
  const consulta = useQuery({
    queryKey: fornecedoresKeys.contatos(cnpj),
    queryFn: () => buscarContatosDescobertos(cnpj),
  })

  const promover = useMutation({
    mutationFn: async (id: string) => {
      const r = await promoverContatoAction({ contato_descoberto_id: id, ponto_focal: true })
      if (!r.ok) throw new Error(r.message)
      return r.data.id
    },
    onSuccess: (id) => {
      toast.success('Contato na ficha — o compositor abre nele.')
      // `comunicacao` traz a empresa resolvida pelo CNPJ e a lista de contatos desta
      // aba; `comercial` é o resumo da aba Fornecedor; `fornecedores` é o card do funil.
      void qc.invalidateQueries({ queryKey: ['comunicacao'] })
      void qc.invalidateQueries({ queryKey: ['comercial'] })
      void qc.invalidateQueries({ queryKey: fornecedoresKeys.todos })
      if (id) onPromovido(id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (consulta.isPending) return <Skeleton className="h-16 w-full" />

  // Site e Instagram não recebem mensagem, e a RPC os recusa: mostrá-los aqui
  // ofereceria um botão que só sabe dar erro.
  const lista = (consulta.data ?? []).filter((c) =>
    ['telefone', 'email', 'whatsapp'].includes(c.tipo),
  )
  if (lista.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Contatos descobertos ({lista.length})</p>
        <p className="text-xs text-muted-foreground">
          A descoberta já achou por onde falar. Promova um e ele passa a ser da ficha —
          é o que o compositor precisa para ter destinatário.
        </p>
      </div>
      <ul className="space-y-1.5">
        {lista.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {exibirValor(c.tipo, c.valor)}
                </span>
                {c.nome_pessoa ? (
                  <span className="truncate text-xs text-muted-foreground">
                    · {c.nome_pessoa}
                    {c.cargo ? ` (${c.cargo})` : ''}
                  </span>
                ) : null}
                <Badge variant={varianteConfianca(c.confianca)} className="text-[10px]">
                  {rotuloConfianca(c.confianca)}
                </Badge>
              </div>
              {/* Fonte e evidência à vista, como na aba Fornecedor: um telefone do
                  campo estruturado da NF-e e um achado numa página web pedem
                  primeiras frases diferentes. */}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {rotuloFonte(c.fonte)}
                {c.evidencia ? ` · ${c.evidencia}` : ''}
              </p>
            </div>
            {c.promovido_contato_id ? (
              <Badge variant="secondary" className="text-[10px]">na ficha</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-xs"
                disabled={promover.isPending}
                onClick={() => promover.mutate(c.id)}
                title="Promove a contato oficial (ponto focal) e abre o compositor nele"
              >
                <Star className="mr-1 h-3.5 w-3.5" aria-hidden />
                Usar este contato
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** O "próximo passo sugerido" da conversa mais recente desta empresa. */
function SugestaoDaEmpresa({ empresaId }: { empresaId: string }) {
  const consulta = useQuery({
    queryKey: ['comunicacao', 'sugestao-empresa', empresaId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('inbox_conversas')
        .select('sugestao_id, sugestao_acao, sugestao_conteudo, sugestao_justificativa, sugestao_confianca')
        .eq('empresa_id', empresaId)
        .not('sugestao_id', 'is', null)
        .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
  })

  const s = consulta.data
  if (!s?.sugestao_id) return null

  return (
    <ProximoPasso
      sugestaoId={s.sugestao_id}
      acao={s.sugestao_acao}
      conteudo={s.sugestao_conteudo}
      justificativa={s.sugestao_justificativa}
      confianca={s.sugestao_confianca}
    />
  )
}
