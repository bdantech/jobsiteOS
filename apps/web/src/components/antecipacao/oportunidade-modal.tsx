'use client'

import * as React from 'react'
import { AlarmClock, Building2, Handshake, Landmark, Loader2 } from 'lucide-react'
import {
  STATUS_PRE_AUTORIZACAO_LABELS,
  SITUACAO_TITULO_LABELS,
  GUARD_REASON_LABELS,
  ORIGEM_PRE_AUTORIZACAO_LABELS,
  TIPO_OPORTUNIDADE_LABELS,
  valorLiquidoEstimado,
  type TipoOportunidade,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { AbaEmpresa } from '@/components/comercial/aba-empresa'
import { AbaMensagens } from '@/components/comercial/modal-card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { promoverFornecedorAction } from '@/actions/antecipacao'
import { antecipacaoKeys } from './queries'
import { formatarData, formatarMoedaExata, labelCredito, textoPrazo } from './format'
import { MenuAcoesOportunidade } from './acoes-oportunidade'
import type { Oportunidade } from './queries'

/**
 * A pré-autorização e a parcela do Sienge, abertas.
 *
 * ── POR QUE NÃO O `NotaModal` ───────────────────────────────────────────────
 * Aquele modal é um LEITOR DE XML: ele busca o documento, desenha o DANFE e tem
 * uma aba com o XML cru. O corpo inteiro dele é `!documento ? null : (…)`, então
 * abri-lo para uma oferta — que não tem documento fiscal nenhum — renderiza uma
 * caixa vazia. Foi por isso que o card nasceu sem clique, e foi a decisão errada:
 * um card que não abre é um card de que não se consegue cuidar.
 *
 * ── O QUE ESTE MODAL MOSTRA, E POR QUE NESTA ORDEM ──────────────────────────
 * A aba "Oportunidade" existe para responder uma pergunta só: o que eu falo com
 * essa pessoa? Valor, líquido de hoje, prazo, e — quando há — o RELÓGIO, que é a
 * única informação deste funil medida em dias que se contam nos dedos.
 *
 * As outras duas abas são o trabalho em si: quem é o fornecedor, e a conversa com
 * ele. São as mesmas do card da NF, de propósito — quem trabalha os três tipos no
 * mesmo dia não pode reaprender a tela a cada troca.
 */

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      <div className="rounded-lg border px-3">{children}</div>
    </section>
  )
}

function Linha({
  rotulo,
  children,
  destaque = false,
}: {
  rotulo: string
  children: React.ReactNode
  destaque?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={cn('text-right text-sm tabular-nums', destaque && 'font-semibold')}>
        {children}
      </dd>
    </div>
  )
}

/**
 * Os três números que decidem o telefonema, lado a lado e em corpo grande.
 *
 * Eles estavam numa lista vertical junto com data de entrada, identificação e
 * chave de acesso — do mesmo tamanho e com o mesmo peso. Quem abre o card abre
 * para saber quanto vale e quanto o fornecedor recebe; procurar isso numa lista de
 * onze linhas é fazer a pessoa ler tudo para achar duas coisas.
 *
 * O LÍQUIDO é o que se fala em voz alta ("cai R$ 98.010 na sua conta"), não o valor
 * de face — esse o fornecedor já sabe.
 */
function Numero({
  rotulo,
  valor,
  nota,
  forte = false,
}: {
  rotulo: string
  valor: string
  nota?: string | null
  forte?: boolean
}) {
  return (
    <div className="flex-1 rounded-lg border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{rotulo}</p>
      <p className={cn('tabular-nums', forte ? 'text-lg font-bold' : 'text-base font-semibold')}>
        {valor}
      </p>
      {nota ? <p className="text-[11px] text-muted-foreground">{nota}</p> : null}
    </div>
  )
}

/** Dias até o relógio zerar. Negativo = já passou. */
function diasParaExpirar(relogio: string | null): number | null {
  if (!relogio) return null
  const ms = new Date(relogio).getTime() - Date.now()
  return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null
}

/**
 * Criar a ficha do fornecedor, num clique, de dentro do card.
 *
 * ── DUAS COISAS QUE NÃO SÃO A MESMA, E CONFUNDI-LAS SERIA CARO ──────────────
 * `fornecedor_cadastrado` é `contracted.registered`: se ele tem conta NA
 * PLATAFORMA da Onepay. Este botão cria a ficha DELE NO NOSSO CRM. São
 * independentes de verdade — há 8 ofertas vivas de fornecedores com ficha aqui e
 * sem conta lá.
 *
 * Então este botão NÃO faz a oferta ficar aceitável. Ela já é válida; o que falta
 * é o fornecedor se cadastrar na plataforma para poder aceitar — e isso é
 * exatamente o trabalho do originador, que é por isso que chamamos esse card de
 * oportunidade de AQUISIÇÃO.
 *
 * O que a ficha destrava é o trabalho: sem `empresas` não há timeline, não há
 * contatos, não há Company 360 e não há para onde a aba de Comunicação escrever.
 * O originador fica com um card que não dá para trabalhar.
 *
 * `promoverFornecedorAction` e não a de Mercado: aquela autoriza por `/mercado`, e
 * o público desta tela tem só `antecipacao`.
 */
function CriarFichaDoFornecedor({ item }: { item: Oportunidade }) {
  const qc = useQueryClient()
  const [criando, setCriando] = React.useState(false)

  async function criar() {
    if (!item.fornecedor_cnpj) return
    setCriando(true)
    const r = await promoverFornecedorAction(item.fornecedor_cnpj)
    setCriando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Ficha de ${r.data.razao_social ?? item.fornecedor_cnpj} criada.`)
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/40">
      <p className="text-xs text-sky-900 dark:text-sky-200">
        <strong>Fornecedor sem ficha aqui.</strong> Criar a ficha destrava contatos,
        timeline e o envio de mensagem — sem ela não há onde registrar o trabalho.
        {item.fornecedor_cadastrado === false ? (
          <span className="mt-0.5 block opacity-80">
            Ele também não tem conta na plataforma, e é isso que o impede de aceitar a
            oferta. Criar a ficha aqui não resolve aquilo — é o começo da conversa que
            resolve.
          </span>
        ) : null}
      </p>
      <Button size="sm" variant="outline" disabled={criando} onClick={() => void criar()}>
        {criando ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Building2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        {criando ? 'Criando…' : 'Criar ficha'}
      </Button>
    </div>
  )
}

export function OportunidadeModal({
  item,
  titulo,
  subtitulo,
  aberto,
  onOpenChange,
  minimoOperavel,
}: {
  item: Oportunidade
  titulo: string
  subtitulo?: string
  aberto: boolean
  onOpenChange: (v: boolean) => void
  minimoOperavel: number
}) {
  const [aba, setAba] = React.useState('oportunidade')
  const [contatoEscolhido, setContatoEscolhido] = React.useState<string | null>(null)

  const tipo = (item.tipo ?? 'pre_autorizacao') as TipoOportunidade
  const expiraEm = diasParaExpirar(item.relogio)
  const relogioCurto = expiraEm !== null && expiraEm <= 2
  const liquido = valorLiquidoEstimado({
    valor: item.valor,
    receitaEsperada: item.receita_esperada,
    tac: item.tac_estimada,
    seguro: item.seguro_estimado,
  })

  const estado = item.estado_origem ?? '—'
  const estadoLegivel =
    tipo === 'pre_autorizacao'
      ? (STATUS_PRE_AUTORIZACAO_LABELS[estado] ?? estado)
      : (SITUACAO_TITULO_LABELS[estado] ?? estado)

  const nomeFornecedor = item.fornecedor_nome ?? item.fornecedor_cnpj ?? '—'

  /*
   * Credor pessoa física NÃO entra: `empresas` é por CNPJ, e ele não tem um. Sem
   * esta guarda o botão apareceria e falharia no check da tabela.
   */
  const podeCriarFicha =
    !item.fornecedor_empresa_id &&
    Boolean(item.fornecedor_cnpj) &&
    item.credor_pessoa_fisica !== true

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/*
        Mesma forma E MESMA LARGURA do `NotaModal` (`max-w-5xl`). Não é simetria
        gratuita: quem trabalha os três tipos no mesmo dia abre um card atrás do
        outro, e um modal que muda de tamanho a cada tipo obriga o olho a se
        reorientar em cada abertura. A aba de Comunicação é a mesma nos dois — numa
        caixa mais estreita, a thread ficava com a metade da largura do mesmo
        conteúdo visto pela NF.

        `flex flex-col gap-0` e corpo `flex-1 min-h-0`: o grid com `gap-4` do
        primitivo deixa um vão entre as faixas DEPOIS da borda de cada uma, e a
        altura fixa corta a barra de ações nas abas altas.
      */}
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <div className="min-w-0 pr-8">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{titulo}</span>
              <Badge variant="secondary">{TIPO_OPORTUNIDADE_LABELS[tipo]}</Badge>
              {relogioCurto ? (
                <Badge variant="destructive">
                  <AlarmClock className="mr-1 h-3 w-3" aria-hidden />
                  {expiraEm !== null && expiraEm <= 0 ? 'expirou' : `expira em ${expiraEm}d`}
                </Badge>
              ) : null}
            </DialogTitle>
            {subtitulo ? (
              <p className="truncate text-xs text-muted-foreground">{subtitulo}</p>
            ) : null}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Tabs value={aba} onValueChange={setAba}>
            <TabsList className="mb-3">
              <TabsTrigger value="oportunidade">Oportunidade</TabsTrigger>
              <TabsTrigger value="fornecedor">Fornecedor</TabsTrigger>
              <TabsTrigger value="mensagens">Comunicação</TabsTrigger>
            </TabsList>

            <TabsContent value="oportunidade" className="mt-0 space-y-4">
              {/*
                O que MUDA O QUE SE FAZ vem antes do que apenas descreve.
                O selo da oferta e a falta de ficha são as duas coisas que alteram a
                próxima ação; os números vêm logo depois; o resto é referência.
              */}
              {item.pre_autorizacao_id && tipo !== 'pre_autorizacao' ? (
                <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <Handshake className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Já tem pré-autorização #{item.pre_autorizacao_id}
                  {item.pre_autorizacao_status
                    ? ` — ${STATUS_PRE_AUTORIZACAO_LABELS[item.pre_autorizacao_status] ?? item.pre_autorizacao_status}`
                    : ''}
                  {item.pre_autorizacao_em ? ` · ${formatarData(item.pre_autorizacao_em)}` : ''}
                </p>
              ) : null}

              {podeCriarFicha ? <CriarFichaDoFornecedor item={item} /> : null}

              {/* ── Os três números que decidem o telefonema ── */}
              <div className="flex flex-wrap gap-2">
                <Numero rotulo="Valor" valor={formatarMoedaExata(item.valor)} />
                <Numero
                  rotulo="Líquido hoje"
                  valor={formatarMoedaExata(liquido)}
                  nota="o que o fornecedor recebe se antecipar hoje"
                  forte
                />
                <Numero
                  rotulo="Receita esperada"
                  valor={formatarMoedaExata(item.receita_esperada)}
                  nota={
                    item.taxa_usada !== null && item.taxa_usada !== undefined
                      ? `a ${Number(item.taxa_usada).toLocaleString('pt-BR')}% a.m.`
                      : null
                  }
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Secao titulo="Prazo">
                  <dl>
                    <Linha rotulo="Vencimento">
                      {formatarData(item.vencimento)}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {textoPrazo(item.dias_para_vencimento)}
                      </span>
                    </Linha>
                    {/*
                      O relógio só existe na pré-autorização, e é o único prazo deste
                      sistema medido em dias que se contam nos dedos. Quando é curto,
                      ele é a informação mais importante da tela inteira.
                    */}
                    {expiraEm !== null ? (
                      <Linha rotulo="A oferta expira" destaque={relogioCurto}>
                        <span className={cn(relogioCurto && 'text-destructive')}>
                          {formatarData(item.relogio)}
                        </span>
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {expiraEm <= 0 ? 'já expirou' : `em ${expiraEm} dia(s)`}
                        </span>
                      </Linha>
                    ) : null}
                  </dl>
                </Secao>

                <Secao titulo="Crédito do sacado">
                  <dl>
                    <Linha rotulo="Status">{labelCredito(item.sacado_credito_status)}</Linha>
                    <Linha rotulo="Limite disponível">
                      {formatarMoedaExata(item.sacado_limite_disponivel)}
                    </Linha>
                    <Linha rotulo="Cobre este valor?">
                      {/*
                        `=== false` e não `!`: o campo é NULO quando não se sabe o
                        disponível, e `!null` diria "não cobre" justamente no caso em
                        que não há nada a afirmar.
                      */}
                      {item.sacado_limite_cobre_valor === false ? (
                        <span className="text-destructive">Não cobre</span>
                      ) : item.sacado_limite_cobre_valor === true ? (
                        'Cobre'
                      ) : (
                        <span className="text-muted-foreground">Não sabemos</span>
                      )}
                    </Linha>
                  </dl>
                </Secao>

                <Secao titulo="Partes">
                  <dl>
                    <Linha rotulo="Fornecedor">
                      {nomeFornecedor}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {item.credor_pessoa_fisica
                          ? 'Credor pessoa física — fora do roteamento'
                          : (item.fornecedor_cnpj ?? '—')}
                      </span>
                    </Linha>
                    <Linha rotulo="Sacado">
                      {item.sacado_nome ?? item.sacado_cnpj ?? '—'}
                      {/* A SPE é o detalhe da operação; a matriz é quem carrega a
                          relação. Mostrar as duas é o que explica o card. */}
                      {item.sacado_matriz_cnpj && item.sacado_matriz_cnpj !== item.sacado_cnpj ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          SPE {item.sacado_cnpj} · matriz {item.sacado_matriz_cnpj}
                        </span>
                      ) : null}
                    </Linha>
                  </dl>
                </Secao>

                <Secao titulo="Origem">
                  <dl>
                    <Linha rotulo="Situação">
                      {estadoLegivel}
                      {/* O código CRU embaixo: é o vocabulário deles, é o que aparece
                          no suporte da plataforma, e traduzir sem mostrar faria as
                          duas telas parecerem discordar. */}
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {estado}
                      </span>
                    </Linha>
                    <Linha rotulo="Identificação">{item.linha_contexto ?? '—'}</Linha>
                    <Linha rotulo="Entrou em">{formatarData(item.data_base)}</Linha>
                    {item.access_key ? (
                      <Linha rotulo="NF vinculada">
                        <span className="break-all text-[11px]">{item.access_key}</span>
                      </Linha>
                    ) : null}
                  </dl>
                </Secao>
              </div>

              {/*
                O `guardReason` só aparece quando existe — e quando existe, ele É o
                card: diz QUAL é o trabalho. `SUPPLIER_CNPJ_MISSING` é cadastrar o
                fornecedor, três minutos, e a parcela vira ofertável.
              */}
              {item.estado_origem === 'not_eligible' ? (
                <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                  Não elegível, mas destravável:{' '}
                  {GUARD_REASON_LABELS[item.linha_contexto?.split(' · ').at(-1) ?? ''] ??
                    'veja o motivo na linha de contexto'}
                  .
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="fornecedor" className="mt-0">
              <AbaEmpresa
                empresaId={item.fornecedor_empresa_id}
                fornecedorCnpj={item.fornecedor_cnpj}
                fornecedorNome={nomeFornecedor}
                onMandarMensagem={(id) => {
                  setContatoEscolhido(id)
                  setAba('mensagens')
                }}
              />
            </TabsContent>

            <TabsContent value="mensagens" className="mt-0">
              <AbaMensagens
                empresaId={item.fornecedor_empresa_id}
                funil="nfs"
                /* O card do ledger é a identidade do funil unificado, `tipo:id` —
                   `access_key` não serve: a oferta não tem uma. */
                funilCardId={`${item.tipo}:${item.id}`}
                fornecedorCnpj={item.fornecedor_cnpj}
                contatoIdInicial={contatoEscolhido}
                onIrParaFornecedor={() => setAba('fornecedor')}
              />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          <MenuAcoesOportunidade item={item} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
