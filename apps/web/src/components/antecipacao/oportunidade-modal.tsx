'use client'

import * as React from 'react'
import { AlarmClock, Handshake, Landmark } from 'lucide-react'
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
import { formatarData, formatarMoedaExata, textoPrazo } from './format'
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

/** Dias até o relógio zerar. Negativo = já passou. */
function diasParaExpirar(relogio: string | null): number | null {
  if (!relogio) return null
  const ms = new Date(relogio).getTime() - Date.now()
  return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null
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

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/*
        Mesma forma do `NotaModal`: `flex flex-col gap-0`, corpo `flex-1 min-h-0`.
        O grid com `gap-4` do primitivo deixa um vão entre as faixas DEPOIS da
        borda de cada uma, e a altura fixa corta a barra de ações nas abas altas —
        a thread de mensagens é a mais alta de todas.
      */}
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
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

            <TabsContent value="oportunidade" className="mt-0">
              {/*
                O selo da oferta vem PRIMEIRO, acima dos números, quando existe.
                Ele muda o que a pessoa vai dizer no telefone: não é mais "convença
                o fornecedor a antecipar", é "a construtora já ofereceu, lembre-o de
                aceitar". É outra conversa, e ela precisa ser lida antes do valor.
              */}
              {item.pre_autorizacao_id && tipo !== 'pre_autorizacao' ? (
                <p className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <Handshake className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Já tem pré-autorização #{item.pre_autorizacao_id}
                  {item.pre_autorizacao_status
                    ? ` — ${STATUS_PRE_AUTORIZACAO_LABELS[item.pre_autorizacao_status] ?? item.pre_autorizacao_status}`
                    : ''}
                  {item.pre_autorizacao_em ? ` · ${formatarData(item.pre_autorizacao_em)}` : ''}
                </p>
              ) : null}

              <dl>
                <Linha rotulo="Valor" destaque>
                  {formatarMoedaExata(item.valor)}
                </Linha>
                <Linha rotulo="Líquido hoje" destaque>
                  {formatarMoedaExata(liquido)}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    o que o fornecedor recebe se antecipar hoje
                  </span>
                </Linha>
                <Linha rotulo="Receita esperada">
                  {formatarMoedaExata(item.receita_esperada)}
                  {item.taxa_usada !== null && item.taxa_usada !== undefined ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      a {Number(item.taxa_usada).toLocaleString('pt-BR')}% a.m.
                    </span>
                  ) : null}
                </Linha>
                <Linha rotulo="Vencimento">
                  {formatarData(item.vencimento)}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {textoPrazo(item.dias_para_vencimento)}
                  </span>
                </Linha>
                {expiraEm !== null ? (
                  <Linha rotulo="A oferta expira" destaque={relogioCurto}>
                    {formatarData(item.relogio)}
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {expiraEm <= 0 ? 'já expirou' : `em ${expiraEm} dia(s)`}
                    </span>
                  </Linha>
                ) : null}
                <Linha rotulo="Situação na origem">
                  {estadoLegivel}
                  {/*
                    O código CRU embaixo do rótulo, de propósito: é o vocabulário
                    deles, é o que aparece no suporte da plataforma, e traduzir sem
                    mostrar faria as duas telas parecerem discordar.
                  */}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {estado}
                  </span>
                </Linha>
                <Linha rotulo="Identificação">{item.linha_contexto ?? '—'}</Linha>
                <Linha rotulo="Entrou em">{formatarData(item.data_base)}</Linha>
                <Linha rotulo="Sacado">
                  {item.sacado_nome ?? item.sacado_cnpj ?? '—'}
                  {item.sacado_matriz_cnpj && item.sacado_matriz_cnpj !== item.sacado_cnpj ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      SPE {item.sacado_cnpj} · matriz {item.sacado_matriz_cnpj}
                    </span>
                  ) : null}
                </Linha>
                <Linha rotulo="Fornecedor">
                  {nomeFornecedor}
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {item.credor_pessoa_fisica
                      ? 'Credor pessoa física — fora do roteamento e do agrupamento'
                      : (item.fornecedor_cnpj ?? '—')}
                  </span>
                </Linha>
                {tipo === 'pre_autorizacao' && item.estado_origem ? (
                  <Linha rotulo="Origem da oferta">
                    {/* `linha_contexto` já traz a origem; aqui vai o rótulo legível. */}
                    {ORIGEM_PRE_AUTORIZACAO_LABELS[
                      (item.linha_contexto ?? '').split('· ').at(-1) ?? ''
                    ] ?? '—'}
                  </Linha>
                ) : null}
                {item.access_key ? (
                  <Linha rotulo="NF vinculada">
                    <span className="break-all text-[11px]">{item.access_key}</span>
                  </Linha>
                ) : null}
              </dl>

              {/*
                O `guardReason` só aparece quando existe, e quando existe é o card
                inteiro: ele diz QUAL é o trabalho. `SUPPLIER_CNPJ_MISSING` é
                cadastrar o fornecedor — três minutos, e a parcela vira ofertável.
              */}
              {item.estado_origem === 'not_eligible' ? (
                <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
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
