'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Building2, Copy, Mail, MessageSquare, Phone, Search, Sparkles, Star, ThumbsDown, UserPlus,
} from 'lucide-react'
import {
  CUSTOS_PADRAO,
  ESTAGIOS_FORNECEDOR_ATIVOS,
  lacunasDeContato,
  ESTAGIO_FORNECEDOR_LABELS,
  MOTIVOS_SEM_INTERESSE,
  MOTIVO_SEM_INTERESSE_LABELS,
  PROVEDOR_LABELS,
  TEMPLATE_PADRAO,
  ordenarSacadosParaPedido,
  planejarDescobertaSobDemanda,
  renderizarApresentacao,
  type Confianca,
  type EstagioFornecedor,
  type MotivoSemInteresse,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AbaEmpresa } from '../aba-empresa'
import { DonoDoCard } from '../dono-do-card'
import { EtapasDoFunil } from '../etapas-funil'
import { ModalDoCard } from '../modal-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  buscaAprofundadaAction,
  buscarContatosAction,
  descartarFornecedorAction,
  moverFornecedorAction,
  pedirApresentacaoAction,
  promoverContatoAction,
  registrarToqueAction,
} from '@/actions/fornecedores'
import {
  buscarContatosDescobertos,
  buscarConfigFornecedores,
  buscarPainelFornecedores,
  buscarPedidos,
  buscarSacadosDoFornecedor,
  fornecedoresKeys,
  type FornecedorCard,
} from './queries'
import {
  brl, brlExato, cnpjFormatado, dia, exibirValor, linkDoContato, rotuloConfianca,
  rotuloDescarte, rotuloFonte, rotuloTipo, varianteConfianca,
} from './formato'

/**
 * A ficha de abordagem (04l §5) — a munição ANTES do contato.
 *
 * A ordem da tela é a ordem em que a pessoa precisa das coisas numa ligação: primeiro
 * o que ela vai DIZER (volume, notas, prazo, contra quem ele fatura), depois POR ONDE
 * falar (os contatos, com fonte e evidência), e só então os dois botões que custam
 * alguma coisa.
 *
 * ─── FONTE E EVIDÊNCIA FICAM VISÍVEIS, SEMPRE ────────────────────────────────
 *
 * Um telefone sem procedência é um telefone que a pessoa vai discar com a confiança
 * de quem tem um dado apurado. "Achado no `emit` da NF 12345 de agosto" e "achado
 * numa página do Google" pedem tons de voz diferentes na primeira frase — e é a
 * primeira frase que decide se a ligação continua.
 */

const brlNum = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

interface SacadoJson {
  cnpj: string
  nome: string | null
  valor: number
  notas: number
}

export function FichaFornecedor({
  card,
  ehGestor,
  aberta,
  onFechar,
  originadorNome,
}: {
  card: FornecedorCard
  ehGestor: boolean
  aberta: boolean
  onFechar: () => void
  originadorNome: string | null
}) {
  const qc = useQueryClient()
  const cnpj = card.fornecedor_cnpj

  const contatos = useQuery({
    queryKey: fornecedoresKeys.contatos(cnpj),
    queryFn: () => buscarContatosDescobertos(cnpj),
    enabled: aberta,
  })
  const pedidos = useQuery({
    queryKey: fornecedoresKeys.pedidos(cnpj),
    queryFn: () => buscarPedidos(cnpj),
    enabled: aberta,
  })

  const sacadosJson = React.useMemo<SacadoJson[]>(
    () =>
      Array.isArray(card.sacados_principais)
        ? (card.sacados_principais as unknown as SacadoJson[])
        : [],
    [card.sacados_principais],
  )

  const sacados = useQuery({
    queryKey: fornecedoresKeys.sacados(cnpj),
    queryFn: () => buscarSacadosDoFornecedor(cnpj, sacadosJson),
    enabled: aberta && sacadosJson.length > 0,
  })

  const invalidar = (): void => {
    void qc.invalidateQueries({ queryKey: fornecedoresKeys.todos })
  }

  const [semInteresse, setSemInteresse] = React.useState(false)
  const [pedido, setPedido] = React.useState(false)
  const [confirmandoBusca, setConfirmandoBusca] = React.useState(false)

  const mover = useMutation({
    mutationFn: async (estagio: EstagioFornecedor) => {
      const r = await moverFornecedorAction({ fornecedor_cnpj: cnpj, estagio })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Estágio atualizado.')
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /*
   * `estourouOTeto` guarda a recusa por SALDO, e só ela.
   *
   * "Já existe contato de confiança alta" também devolve `ok: false`, e oferecer
   * "buscar mesmo assim" ali seria convidar o gestor a gastar R$ 1,65 para confirmar
   * o que está na tela. A liberação existe para saldo, que é uma decisão de
   * orçamento, não para contornar a regra que evita o gasto.
   */
  const [estourouOTeto, setEstourouOTeto] = React.useState(false)

  const buscar = useMutation({
    mutationFn: async (forcar: boolean) => {
      const r = await buscarContatosAction({ cnpj, forcar })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (d) => {
      if (!d.ok) {
        setEstourouOTeto((d.motivo ?? '').includes('saldo do mês'))
        toast.warning(d.motivo ?? 'A busca não rodou.')
        return
      }
      setEstourouOTeto(false)
      // O custo REAL, não o estimado: a cascata pode ter parado antes, e dizer o
      // número que foi cobrado é o que faz o teto do mês fazer sentido depois.
      toast.success(
        d.contatosNovos > 0
          ? `${d.contatosNovos} contato(s) novo(s). Custou ${brlExato(d.custo)}.`
          : `Nenhum contato novo. Custou ${brlExato(d.custo)}.`,
      )
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /*
   * A SEGUNDA busca, e ela só aparece quando tem o que procurar.
   *
   * `lacunasDeContato` é a MESMA função que o worker usa para decidir — a tela não faz
   * uma estimativa própria. Se ela dissesse "vale" e o worker recusasse, o originador
   * clicaria num botão que devolve "não acrescentaria", que é a pior forma de aprender
   * uma regra.
   */
  const lacunas = React.useMemo(
    () =>
      lacunasDeContato(
        (contatos.data ?? []).map((c) => ({
          tipo: c.tipo,
          valor: c.valor,
          confianca: c.confianca as Confianca,
          nome_pessoa: c.nome_pessoa,
          valido:
            typeof c.validado === 'object' && c.validado !== null
              ? ((c.validado as Record<string, unknown>).valido as boolean | undefined) ?? null
              : null,
        })),
      ),
    [contatos.data],
  )

  const aprofundar = useMutation({
    mutationFn: async (forcar: boolean) => {
      const r = await buscaAprofundadaAction({ cnpj, forcar })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (d) => {
      if (!d.ok) {
        setEstourouOTeto((d.motivo ?? '').includes('saldo do mês'))
        toast.warning(d.motivo ?? 'A busca aprofundada não rodou.')
        return
      }
      setEstourouOTeto(false)
      toast.success(
        d.contatosNovos > 0
          ? `${d.contatosNovos} contato(s) novo(s) na busca aprofundada. Custou ${brlExato(d.custo)}.`
          : `A busca aprofundada não achou nada novo. Custou ${brlExato(d.custo)}.`,
      )
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const promover = useMutation({
    mutationFn: async (id: string) => {
      const r = await promoverContatoAction({ contato_descoberto_id: id, ponto_focal: true })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Promovido a ponto focal da empresa.')
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toque = useMutation({
    mutationFn: async (v: { canal: 'ligacao' | 'whatsapp' | 'email'; id: string }) => {
      const r = await registrarToqueAction({
        fornecedor_cnpj: cnpj,
        canal: v.canal,
        contato_descoberto_id: v.id,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: invalidar,
  })

  const estagio = card.estagio as EstagioFornecedor
  const suprimido = card.suprimido === true

  const listaSacados = ordenarSacadosParaPedido(
    (sacados.data ?? sacadosJson.map((s) => ({ ...s, tem_ponto_focal: false }))).map((s) => ({
      cnpj: s.cnpj,
      nome: s.nome,
      valor: brlNum(s.valor),
      tem_ponto_focal: 'tem_ponto_focal' in s ? Boolean(s.tem_ponto_focal) : false,
    })),
  )

  return (
    <>
      <ModalDoCard
        aberto={aberta}
        onOpenChange={(o) => !o && onFechar()}
        largura="max-w-4xl"
        titulo={card.fornecedor_nome ?? cnpjFormatado(cnpj)}
        subtitulo={
          <>
            {cnpjFormatado(cnpj)}
            {card.municipio ? ` · ${card.municipio}/${card.uf ?? ''}` : ''}
            {card.porte_rfb ? ` · ${card.porte_rfb}` : ''}
            {` · última NF em ${dia(card.ultima_nf_em)}`}
          </>
        }
        cabecalho={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {brl(card.potencial_mensal)}/mês de potencial
            </Badge>
            {suprimido ? (
              <Badge variant="destructive" className="text-[10px]">
                {rotuloDescarte(card.sem_interesse_ate, card.sem_interesse_origem)}
              </Badge>
            ) : null}
            <div className="relative z-10">
              <DonoDoCard nome={card.originador_nome} tipos={['originador']} podeTrocar={false} />
            </div>
          </div>
        }
        etapas={
          <EtapasDoFunil
            etapas={ESTAGIOS_FORNECEDOR_ATIVOS.map((e) => ({
              id: e,
              label: ESTAGIO_FORNECEDOR_LABELS[e],
              bloqueada: suprimido ? 'sem interesse — reabra antes de mover' : undefined,
            }))}
            atual={estagio}
            ocupado={mover.isPending}
            onIr={(id) => mover.mutate(id as EstagioFornecedor)}
          />
        }
        acoes={
          <>
            <Button variant="outline" size="sm" onClick={() => setPedido(true)}>
              <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Pedir apresentação
            </Button>
            {suprimido ? (
              <Button
                variant="outline"
                size="sm"
                disabled={mover.isPending}
                onClick={() => mover.mutate('a_cadastrar')}
              >
                Reabrir
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSemInteresse(true)}>
                <ThumbsDown className="mr-1 h-3.5 w-3.5" aria-hidden />
                Sem interesse
              </Button>
            )}
          </>
        }
        abas={[
          {
            id: 'abordagem',
            label: 'Abordagem',
            conteudo: (
              /*
                O LAYOUT EM CARDS DO MODAL ANTERIOR, mantido porque funcionava: os
                números soltos no topo, e cada bloco seguinte num cartão com título e
                uma linha dizendo para que ele serve.
                
                A ordem é a ordem de quem vai ligar: o que eu vou DIZER (munição),
                contra QUEM ele fatura (as portas de entrada), e POR ONDE falar (os
                contatos, com o botão de buscar ali mesmo). Mandar procurar o botão
                noutra aba separava a pergunta da resposta.
              */
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Numero rotulo="Volume 90 dias" valor={brl(card.volume_90d)} />
                  <Numero rotulo="Notas em 90 dias" valor={String(card.qtd_nfs_90d ?? '—')} />
                  <Numero
                    rotulo="Prazo médio"
                    valor={card.prazo_medio_dias === null ? '—' : `${card.prazo_medio_dias} dias`}
                  />
                  <Numero rotulo="Potencial mensal" valor={brl(card.potencial_mensal)} destaque />
                </div>
                <p className="text-xs text-muted-foreground">
                  Potencial mensal é o volume de 90 dias dividido por três — quanto ele fatura
                  por mês contra nossos sacados, não quanto vai antecipar. Última NF em{' '}
                  {dia(card.ultima_nf_em)}.
                </p>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contra quem ele fatura</CardTitle>
                    <CardDescription className="text-xs">
                      Cada um é uma porta de entrada. Quem tem ponto focal conhecido aparece
                      marcado — é por ele que o pedido de apresentação funciona.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {listaSacados.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Sem notas na janela de 90 dias.
                      </p>
                    ) : (
                      listaSacados.map((s) => (
                        <div
                          key={s.cnpj}
                          className="flex items-baseline justify-between gap-2 text-sm"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{s.nome ?? cnpjFormatado(s.cnpj)}</span>
                            {s.tem_ponto_focal ? (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                ponto focal
                              </Badge>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {brl(s.valor)}
                          </span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-sm">
                        Contatos descobertos
                        {card.contatos_encontrados ? ` (${card.contatos_encontrados})` : ''}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Fonte e evidência ficam visíveis: um telefone do campo estruturado da
                        NF-e e um achado numa página web pedem primeiras frases diferentes.
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={buscar.isPending || aprofundar.isPending}
                        onClick={() => setConfirmandoBusca(true)}
                      >
                        <Search className="mr-1 h-3.5 w-3.5" aria-hidden />
                        {buscar.isPending ? 'Buscando…' : 'Buscar contatos'}
                      </Button>
                      {/*
                        A SEGUNDA passada só aparece depois da primeira ter rodado E
                        quando há lacuna. Um botão sempre visível que responde "não
                        acrescentaria" ensina a ignorá-lo.
                      */}
                      {card.ultima_busca_em && lacunas.vale_aprofundar ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={buscar.isPending || aprofundar.isPending}
                          onClick={() => aprofundar.mutate(false)}
                          title={
                            `Segunda busca, mais funda: manda o que já achamos e o que não ` +
                            `funciona, e procura ${lacunas.faltam.join(', ')} em sindicato, ` +
                            `junta comercial, notícia local e perfil de sócio.`
                          }
                        >
                          <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                          {aprofundar.isPending ? 'Buscando…' : 'Buscar Mais'}
                        </Button>
                      ) : null}
                      {estourouOTeto && ehGestor ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={buscar.isPending}
                          onClick={() => buscar.mutate(true)}
                          title="Libera este clique acima do teto mensal do originador"
                        >
                          Liberar mesmo assim
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {contatos.isPending ? (
                      <Skeleton className="h-24 w-full" />
                    ) : (contatos.data ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nada encontrado ainda. A varredura automática (XML das notas, Receita,
                        site) roda de madrugada; o botão acima aciona as fontes pagas.
                      </p>
                    ) : (
                      (contatos.data ?? []).map((c) => {
                        const link = linkDoContato(c.tipo, c.valor)
                        const invalido =
                          typeof c.validado === 'object' &&
                          c.validado !== null &&
                          (c.validado as Record<string, unknown>).valido === false
                        const canal =
                          c.tipo === 'email'
                            ? 'email'
                            : c.tipo === 'whatsapp'
                              ? 'whatsapp'
                              : 'ligacao'
                        return (
                          <div key={c.id} className="rounded-md border p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <IconeTipo tipo={c.tipo} />
                                {link ? (
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="truncate font-medium hover:underline"
                                    onClick={() => toque.mutate({ canal, id: c.id })}
                                  >
                                    {exibirValor(c.tipo, c.valor)}
                                  </a>
                                ) : (
                                  <span className="truncate font-medium">
                                    {exibirValor(c.tipo, c.valor)}
                                  </span>
                                )}
                                {c.nome_pessoa ? (
                                  <span className="truncate text-sm text-muted-foreground">
                                    · {c.nome_pessoa}
                                    {c.cargo ? ` (${c.cargo})` : ''}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Badge
                                  variant={varianteConfianca(c.confianca)}
                                  className="text-[10px]"
                                >
                                  {rotuloConfianca(c.confianca)}
                                </Badge>
                                {invalido ? (
                                  <Badge variant="destructive" className="text-[10px]">
                                    não valida
                                  </Badge>
                                ) : null}
                                {c.promovido_contato_id ? (
                                  <Badge variant="secondary" className="text-[10px]">
                                    na ficha
                                  </Badge>
                                ) : ['telefone', 'email', 'whatsapp'].includes(c.tipo) ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    disabled={promover.isPending}
                                    onClick={() => promover.mutate(c.id)}
                                    title="Promover a contato oficial e marcar como ponto focal"
                                  >
                                    <Star className="h-3.5 w-3.5" aria-hidden />
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {rotuloTipo(c.tipo)} · {rotuloFonte(c.fonte)}
                              {c.frequencia > 1 ? ` · visto ${c.frequencia}×` : ''}
                              {c.ultima_vez_visto
                                ? ` · última vez ${dia(c.ultima_vez_visto)}`
                                : ''}
                              {c.evidencia ? ` · ${c.evidencia}` : ''}
                            </p>
                          </div>
                        )
                      })
                    )}
                    {(contatos.data ?? []).length > 0 && lacunas.faltam.length > 0 ? (
                      <p className="pt-1 text-[11px] text-muted-foreground">
                        Ainda falta: <strong>{lacunas.faltam.join(', ')}</strong>.
                        {lacunas.falharam.length > 0
                          ? ` ${lacunas.falharam.length} contato(s) reprovaram na validação.`
                          : ''}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>

                {(pedidos.data ?? []).length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Pedidos de apresentação</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-xs text-muted-foreground">
                      {(pedidos.data ?? []).map((p) => (
                        <p key={p.id}>
                          {cnpjFormatado(p.sacado_cnpj)} · {p.status} · {dia(p.criado_em)}
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            ),
          },
          {
            id: 'empresa',
            label: 'Empresa',
            conteudo: <AbaEmpresa empresaId={card.empresa_id} />,
          },
        ]}
      />

      <DialogConfirmarBusca
        card={card}
        originadorId={card.originador_id}
        aberto={confirmandoBusca}
        onFechar={() => setConfirmandoBusca(false)}
        onConfirmar={() => {
          setConfirmandoBusca(false)
          buscar.mutate(false)
        }}
      />

      <DialogSemInteresse
        cnpj={cnpj}
        nome={card.fornecedor_nome ?? cnpj}
        aberto={semInteresse}
        onFechar={() => setSemInteresse(false)}
        onOk={() => {
          setSemInteresse(false)
          onFechar()
          invalidar()
        }}
      />

      <DialogPedirApresentacao
        cnpj={cnpj}
        card={card}
        sacados={sacados.data ?? []}
        originadorNome={originadorNome}
        aberto={pedido}
        onFechar={() => setPedido(false)}
        onOk={() => {
          setPedido(false)
          invalidar()
        }}
      />
    </>
  )
}

/**
 * O custo ANTES do clique (§4.2), não depois.
 *
 * O plano é calculado no cliente pela MESMA função do core que o worker usa para
 * executar. Não é duplicação: é a razão de ela ser pura. Se a tela estimasse por uma
 * regra e o worker cobrasse por outra, a diferença apareceria na fatura, não no código.
 *
 * O número é o TETO. Com `parar_ao_encontrar_alta` ligado a cascata para na primeira
 * fonte de confiança alta e a fatura sai menor — e a tela diz isso, porque prometer o
 * teto e cobrar menos é a única direção aceitável do erro.
 */
function DialogConfirmarBusca({
  card, originadorId, aberto, onFechar, onConfirmar,
}: {
  card: FornecedorCard
  originadorId: string | null
  aberto: boolean
  onFechar: () => void
  onConfirmar: () => void
}) {
  const config = useQuery({
    queryKey: fornecedoresKeys.config(),
    queryFn: buscarConfigFornecedores,
    enabled: aberto,
  })
  const painel = useQuery({
    queryKey: fornecedoresKeys.painel(originadorId),
    queryFn: () => buscarPainelFornecedores(originadorId),
    enabled: aberto,
  })

  // `config.data ?? {}` cria um objeto novo a cada render, e ele é dependência do
  // useMemo abaixo — o plano seria recalculado sempre. Memoizado à parte.
  const d = React.useMemo(() => config.data ?? {}, [config.data])
  const plano = React.useMemo(
    () =>
      planejarDescobertaSobDemanda(
        {
          dominio: card.dominio,
          /*
           * `funcionarios` e faturamento vêm da ficha da empresa, e um fornecedor do
           * funil quase nunca tem ficha — por definição, ele não está na plataforma.
           * Null aqui faz o Apollo ser pulado, que é a resposta certa para a PME em
           * que ele não teria nada: o worker refaz a mesma conta com o dado que ele
           * enxerga, e só pode ser mais permissivo, nunca menos.
           */
          funcionarios: null,
          faturamento_estimado: null,
          // O porte da Receita é o sinal que EXISTE aqui: nenhum fornecedor do funil
          // tem ficha em `empresas`, então `funcionarios` é sempre nulo. Sem ele, a
          // tela diria "Apollo pulado por porte" sobre uma empresa cujo porte ninguém
          // mediu — e o worker, que lê o mesmo campo, discordaria da estimativa.
          porte_rfb: card.porte_rfb,
          municipio: card.municipio,
          uf: card.uf,
          razao_social: card.fornecedor_nome,
          melhor_confianca: (card.melhor_confianca as Confianca | null) ?? null,
        },
        {
          custos: { ...CUSTOS_PADRAO, ...((d.custos as Record<string, number>) ?? {}) },
          pararAoEncontrarAlta: d.parar_ao_encontrar_alta !== false,
          apolloMinimoFuncionarios: Number(d.apollo_minimo_funcionarios ?? 10),
          apolloMinimoFaturamento: Number(d.apollo_minimo_faturamento ?? 0) || undefined,
        },
      ),
    [card, d],
  )

  const teto = Number(painel.data?.teto_mensal ?? 0)
  const gasto = Number(painel.data?.gasto_mes ?? 0)
  const saldo = Math.max(0, teto - gasto)
  const cabe = plano.custo_estimado <= saldo

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buscar contatos — {card.fornecedor_nome}</DialogTitle>
          <DialogDescription>
            As fontes gratuitas (XML das notas, Receita, site) já rodaram de madrugada. Isto
            aciona as pagas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {plano.etapas.map((e) => (
            <div key={e.provedor} className="flex items-start justify-between gap-3">
              <div className={e.rodara ? '' : 'text-muted-foreground'}>
                {PROVEDOR_LABELS[e.provedor]}
                {e.motivo ? <span className="block text-[11px]">{e.motivo}</span> : null}
              </div>
              <span className="shrink-0 tabular-nums">{e.rodara ? brlExato(e.custo) : '—'}</span>
            </div>
          ))}

          <div className="flex items-baseline justify-between border-t pt-2 font-medium">
            <span>{plano.pode_custar_menos ? 'Custo máximo' : 'Custo'}</span>
            <span className="tabular-nums">{brlExato(plano.custo_estimado)}</span>
          </div>

          {plano.pode_custar_menos ? (
            <p className="text-[11px] text-muted-foreground">
              É um teto: a cascata para na primeira fonte de confiança alta, e aí a busca
              custa menos.
            </p>
          ) : null}

          {plano.apollo_depende_da_busca ? (
            <p className="text-[11px] text-muted-foreground">
              O Apollo só roda se a busca achar um domínio — ele consulta por domínio, e este
              fornecedor ainda não tem um. Por isso ele vem depois dela, e não antes.
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Seu orçamento do mês: {brlExato(gasto)} usados de {brlExato(teto)} —{' '}
            <strong>{brlExato(saldo)} disponíveis</strong>.
          </p>

          {plano.custo_estimado === 0 ? (
            <p className="text-xs text-destructive">
              Nada a buscar: {plano.etapas[0]?.motivo ?? 'nenhum provedor se aplica.'}
            </p>
          ) : !cabe ? (
            <p className="text-xs text-destructive">
              Não cabe no saldo. Um gestor pode liberar depois que a busca for recusada.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={plano.custo_estimado === 0} onClick={onConfirmar}>
            Buscar por {brlExato(plano.custo_estimado)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={destaque ? 'text-lg font-semibold' : 'text-lg'}>{valor}</p>
    </div>
  )
}

function IconeTipo({ tipo }: { tipo: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
  if (tipo === 'email') return <Mail className={cls} />
  if (tipo === 'whatsapp') return <MessageSquare className={cls} />
  if (tipo === 'telefone') return <Phone className={cls} />
  return <Building2 className={cls} />
}

// ─── Sem interesse ──────────────────────────────────────────────────────────

function DialogSemInteresse({
  cnpj, nome, aberto, onFechar, onOk,
}: {
  cnpj: string
  nome: string
  aberto: boolean
  onFechar: () => void
  onOk: () => void
}) {
  const [motivo, setMotivo] = React.useState<MotivoSemInteresse>('nao_utiliza_antecipacao')
  const [observacao, setObservacao] = React.useState('')
  const [eterna, setEterna] = React.useState(false)

  const salvar = useMutation({
    mutationFn: async () => {
      const r = await descartarFornecedorAction({
        fornecedor_cnpj: cnpj,
        motivo,
        observacao: observacao || undefined,
        dias: eterna ? null : 90,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success(eterna ? 'Suprimido em definitivo.' : 'Volta ao funil em 90 dias.')
      onOk()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sem interesse — {nome}</DialogTitle>
          <DialogDescription>
            Isto suprime o CNPJ em todos os canais, não só aqui: ele também sai da lista a
            prospectar da Antecipação e para de gerar mensagem na outbox.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="motivo-sem-interesse">Motivo</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoSemInteresse)}>
              <SelectTrigger id="motivo-sem-interesse"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOTIVOS_SEM_INTERESSE.map((m) => (
                  <SelectItem key={m} value={m}>{MOTIVO_SEM_INTERESSE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              A lista é a mesma da Antecipação de propósito: &quot;quantos perdemos porque já
              operam com outro?&quot; só tem resposta se os dois funis responderem igual.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="obs-sem-interesse">
              Observação {motivo === 'outro' ? '(obrigatória)' : '(opcional)'}
            </Label>
            <Textarea
              id="obs-sem-interesse"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={eterna}
              onChange={(e) => setEterna(e.target.checked)}
              className="mt-1"
            />
            <span>
              Nunca mais procurar
              <span className="block text-[11px] text-muted-foreground">
                Sem marcar, ele volta ao funil em 90 dias. Marcado, a supressão é eterna e tem
                peso de LGPD — é a única ação daqui sem desfazer pela tela.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={salvar.isPending || (motivo === 'outro' && observacao.trim().length < 3)}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? 'Salvando…' : 'Marcar sem interesse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Pedido de apresentação ─────────────────────────────────────────────────

function DialogPedirApresentacao({
  cnpj, card, sacados, originadorNome, aberto, onFechar, onOk,
}: {
  cnpj: string
  card: FornecedorCard
  sacados: { cnpj: string; nome: string | null; valor: number; tem_ponto_focal: boolean; contato_id: string | null; contato_nome: string | null }[]
  originadorNome: string | null
  aberto: boolean
  onFechar: () => void
  onOk: () => void
}) {
  const config = useQuery({
    queryKey: fornecedoresKeys.config(),
    queryFn: buscarConfigFornecedores,
    enabled: aberto,
  })

  const ordenados = React.useMemo(() => ordenarSacadosParaPedido(sacados), [sacados])
  const [alvo, setAlvo] = React.useState<string>('')
  const escolhido = ordenados.find((s) => s.cnpj === (alvo || ordenados[0]?.cnpj))

  const template =
    typeof config.data?.template_apresentacao === 'string'
      ? (config.data.template_apresentacao as string)
      : TEMPLATE_PADRAO

  const [mensagem, setMensagem] = React.useState('')
  const [editado, setEditado] = React.useState(false)

  React.useEffect(() => {
    if (!aberto || editado || !escolhido) return
    setMensagem(
      renderizarApresentacao(template, {
        fornecedor_nome: card.fornecedor_nome ?? null,
        fornecedor_cnpj: cnpj,
        sacado_nome: escolhido.nome,
        contato_sacado_nome: escolhido.contato_nome,
        originador_nome: originadorNome,
        volume_90d: card.volume_90d === null ? null : Number(card.volume_90d),
        qtd_nfs_90d: card.qtd_nfs_90d,
        potencial_mensal: card.potencial_mensal === null ? null : Number(card.potencial_mensal),
      }),
    )
  }, [aberto, editado, escolhido, template, card, cnpj, originadorNome])

  const salvar = useMutation({
    mutationFn: async () => {
      if (!escolhido) throw new Error('Escolha o sacado.')
      const r = await pedirApresentacaoAction({
        fornecedor_cnpj: cnpj,
        sacado_cnpj: escolhido.cnpj,
        contato_sacado_id: escolhido.contato_id,
        mensagem,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Pedido registrado. Copie o texto e mande pelo seu canal.')
      onOk()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pedir apresentação ao sacado</DialogTitle>
          <DialogDescription>
            É a maior taxa de conversão do conjunto: transforma uma ligação fria numa
            introdução. O texto é <strong>copiável</strong> — o envio pelo sistema é do
            Prompt 05, e um botão &quot;Enviar&quot; que na verdade copia faria alguém achar
            que mandou uma mensagem que nunca saiu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sacado-pedido">Sacado</Label>
            <Select value={alvo || ordenados[0]?.cnpj || ''} onValueChange={(v) => { setAlvo(v); setEditado(false) }}>
              <SelectTrigger id="sacado-pedido"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {ordenados.map((s) => (
                  <SelectItem key={s.cnpj} value={s.cnpj}>
                    {s.nome ?? cnpjFormatado(s.cnpj)}
                    {s.tem_ponto_focal ? ` — ${s.contato_nome ?? 'ponto focal'}` : ' — sem ponto focal'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Quem tem ponto focal aparece primeiro — não quem compra mais. O pedido é um
              favor pessoal, e ele funciona com quem atende.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mensagem-pedido">Mensagem</Label>
            <Textarea
              id="mensagem-pedido"
              value={mensagem}
              onChange={(e) => { setMensagem(e.target.value); setEditado(true) }}
              rows={12}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(mensagem)
              toast.success('Texto copiado.')
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copiar
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button disabled={salvar.isPending || mensagem.trim().length < 10} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Registrar pedido'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
