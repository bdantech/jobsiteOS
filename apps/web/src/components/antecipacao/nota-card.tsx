'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, BadgeCheck, Files, Gavel } from 'lucide-react'
import {
  FAIXA_LABELS,
  TIPAGEM_LABELS,
  urgenciaDe,
  type Faixa,
  type Tipagem,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MenuAcoesNota } from './acoes-nota'
import { NotaModal } from './documento/nota-modal'
import { AbaEmpresa } from '@/components/comercial/aba-empresa'
import { AbaMensagens } from '@/components/comercial/modal-card'
import {
  FAIXA_BADGE,
  TIPAGEM_BADGE,
  creditoBadge,
  formatarData,
  formatarMoedaExata,
  labelCredito,
  textoPrazo,
} from './format'
import type { FornecedorFunil, NotaFunil } from './queries'

/**
 * O card do funil.
 *
 * ENXUTO por decisão: o corpo mostra fornecedor, número/tipo da nota, valor,
 * sacado e crédito — e para. Receita esperada e vencimento saíram do corpo e
 * vivem no TOOLTIP, junto do nome completo do fornecedor (que quase sempre está
 * truncado). Uma coluna do Kanban tem 40 cards; cada linha a menos é uma linha a
 * mais de contexto visível sem rolar.
 *
 * Isso vale para o DESKTOP, onde existe hover. O card do mobile mantém o prazo
 * com cor de urgência — lá não há tooltip para compensar, e o §9 pede o sinal.
 *
 * CLICAR ABRE A NOTA como documento. O caminho para o fornecedor não se perdeu:
 * o nome é um link, o "+N notas" é um link, e o menu tem "Ver notas do
 * fornecedor" — três portas, nenhuma delas roubada pelo modal.
 */

export function NotaCard({
  nota,
  fornecedor,
  minimoOperavel,
  compacto = false,
  dono,
}: {
  nota: NotaFunil
  fornecedor?: FornecedorFunil
  minimoOperavel: number
  compacto?: boolean
  /**
   * O dono da nota, só quando a lista NÃO está recortada por vendedor. Vem pronto de
   * cima em vez de ser buscado aqui: são dezenas de cards por coluna, e cada um
   * resolvendo o próprio nome seria uma leitura por card.
   */
  dono?: React.ReactNode
}) {
  const [notaAberta, setNotaAberta] = React.useState(false)
  const urgencia = urgenciaDe(nota.dias_para_vencimento, minimoOperavel)
  const outras = (fornecedor?.notas_vivas ?? 1) - 1
  const nomeFornecedor = nota.fornecedor_nome ?? nota.fornecedor_cnpj ?? '—'

  return (
    <>
      {/* 700ms (o padrão, calibrado para o rail de ícones) é longo demais num card
          que a pessoa varre com o olho. */}
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <article
            role="button"
            tabIndex={0}
            aria-label={`Abrir a nota ${nota.numero ?? nota.access_key} de ${nomeFornecedor}`}
            onClick={() => setNotaAberta(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setNotaAberta(true)
              }
            }}
            className={cn(
              'cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-colors',
              'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              nota.fornecedor_suprimido && 'opacity-60',
            )}
          >
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                {/* O link tem de parar a propagação: clicar no NOME vai para o
                    fornecedor, clicar em qualquer outro lugar abre a nota. */}
                <Link
                  href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {nomeFornecedor}
                </Link>

                <div className="flex flex-wrap items-center gap-1">
                  {nota.faixa && (
                    <Badge className={FAIXA_BADGE[nota.faixa as Faixa]}>
                      {FAIXA_LABELS[nota.faixa as Faixa]}
                    </Badge>
                  )}
                  {nota.fornecedor_tipagem && (
                    <Badge className={TIPAGEM_BADGE[nota.fornecedor_tipagem as Tipagem]}>
                      {TIPAGEM_LABELS[nota.fornecedor_tipagem as Tipagem]}
                    </Badge>
                  )}
                  {nota.fornecedor_tem_protesto && (
                    <Badge variant="outline" className="gap-1 text-destructive">
                      <Gavel className="h-3 w-3" aria-hidden />
                      Protesto
                    </Badge>
                  )}
                </div>
              </div>

              {/* As ações foram para o modal: um menu por card, vezes dezenas de
                  cards, é um clique de decisão tomado sem abrir a nota. */}
            </header>

            {/* Identificação da nota + valor, numa linha só. */}
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-medium">
                  {nota.tipo_nf ?? 'NFe'}
                </Badge>
                <span className="tabular-nums">
                  nº {nota.numero ?? '—'}
                  {nota.serie ? `/${nota.serie}` : ''}
                </span>
              </span>
              <span className="font-medium tabular-nums">{formatarMoedaExata(nota.valor)}</span>
            </div>

            {/* O dono, quando a lista não está recortada por vendedor. Fora do modal:
                o clique abre o dropdown, não a nota. */}
            {dono ? (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                {dono}
              </div>
            ) : null}

            {!compacto && (
              <footer className="mt-3 space-y-2 border-t pt-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {nota.sacado_nome ?? nota.sacado_cnpj}
                  </span>
                  <Badge className={cn('shrink-0', creditoBadge(nota.sacado_credito_status))}>
                    {labelCredito(nota.sacado_credito_status)}
                  </Badge>
                </div>

                {nota.sacado_credito_status === 'APPROVED' && !nota.sacado_limite_cobre_nota && (
                  <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    Aprovado, mas o limite não cobre esta nota.
                  </p>
                )}

                {outras > 0 && (
                  <Link
                    href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <Files className="h-3 w-3" aria-hidden />+{outras} nota{outras > 1 ? 's' : ''} do
                    fornecedor
                  </Link>
                )}

                {nota.fornecedor_suprimido && (
                  <p className="text-xs text-muted-foreground">
                    Fornecedor suprimido — fora das faixas até a supressão expirar.
                  </p>
                )}

                {/*
                 * O selo da conversão automática (04e §6). Só aparece quando a
                 * antecipação existe de verdade — é o que distingue uma nota que
                 * alguém arrastou para "convertida" de uma que a plataforma
                 * antecipou, e com que valores.
                 */}
                {nota.conversao_antecipacao_id && (
                  <p
                    className={cn(
                      'flex items-start gap-1 text-xs',
                      nota.conversao_em_disputa
                        ? 'text-destructive'
                        : 'text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {nota.conversao_em_disputa ? (
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    ) : (
                      <BadgeCheck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    )}
                    <span>
                      Convertida via antecipação #{nota.conversao_antecipacao_id}
                      {nota.conversao_valor
                        ? ` · ${formatarMoedaExata(nota.conversao_valor)}`
                        : ''}
                      {nota.conversao_taxa ? ` a ${nota.conversao_taxa}% a.m.` : ''}
                      {nota.conversao_em_disputa ? ' — em disputa, revise.' : ''}
                    </span>
                  </p>
                )}
              </footer>
            )}
          </article>
        </TooltipTrigger>

        {/*
         * O que saiu do corpo do card mora aqui.
         *
         * O fundo do tooltip é `primary` (navy no claro, azul-claro no escuro), então
         * NADA aqui usa `text-muted-foreground` nem cores semânticas: elas são
         * calibradas contra `background`, e sobre a primária uma delas fica ilegível em
         * algum dos dois temas. A hierarquia vem de OPACIDADE sobre
         * `primary-foreground`, que é a única cor garantida a contrastar aqui — e a
         * urgência, que no card é cor, aqui vira PALAVRA.
         */}
        <TooltipContent side="right" className="max-w-xs px-3 py-2">
          <dl className="space-y-1.5 text-xs">
            <div>
              <dt className="sr-only">Fornecedor</dt>
              <dd className="font-semibold leading-snug">{nomeFornecedor}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Valor da nota</dt>
              <dd className="tabular-nums">{formatarMoedaExata(nota.valor)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Vencimento</dt>
              <dd className="tabular-nums">{formatarData(nota.vencimento)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="opacity-70">Prazo</dt>
              <dd className={cn('tabular-nums', urgencia !== 'confortavel' && 'font-semibold')}>
                {textoPrazo(nota.dias_para_vencimento)}
                {urgencia === 'vencida' || urgencia === 'critica' ? ' — não operável' : ''}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              {/*
               * A taxa junto do número porque ela é metade dele: quando o sacado já
               * tem análise de crédito, é a monthlyRateD0 dele que precifica a nota;
               * quando não tem, é a padrão da carteira. Sem o rótulo, as duas receitas
               * têm a mesma cara — e uma delas é uma média chutada.
               */}
              <dt className="opacity-70">Receita esperada</dt>
              <dd className="text-right tabular-nums">
                {formatarMoedaExata(nota.receita_esperada)}
                {nota.taxa_usada === null || nota.taxa_usada === undefined ? null : (
                  <span className="block text-[11px] opacity-70">
                    a {Number(nota.taxa_usada).toLocaleString('pt-BR')}% a.m.
                  </span>
                )}
              </dd>
            </div>
            {nota.vencimento_origem === 'estimado' ? (
              <p className="pt-0.5 text-[11px] leading-snug opacity-70">
                Vencimento estimado (emissão + 30 dias) — não veio do XML nem do endpoint.
              </p>
            ) : null}
            <p className="pt-0.5 text-[11px] opacity-70">Clique para abrir a nota.</p>
          </dl>
        </TooltipContent>
      </Tooltip>

      {notaAberta && nota.access_key ? (
        <NotaModal
          accessKey={nota.access_key}
          titulo={`Nota ${nota.numero ?? nota.access_key}${nota.serie ? `/${nota.serie}` : ''}`}
          subtitulo={`${nomeFornecedor} → ${nota.sacado_nome ?? nota.sacado_cnpj ?? '—'}`}
          aberto={notaAberta}
          onOpenChange={setNotaAberta}
          abasExtras={[
            {
              id: 'fornecedor',
              label: 'Fornecedor',
              // Aqui a "empresa" do card é o FORNECEDOR: é com ele que se fala sobre
              // antecipar esta nota, não com o sacado.
              conteudo: <AbaEmpresa empresaId={nota.fornecedor_empresa_id} />,
            },
            { id: 'mensagens', label: 'Mensagens', conteudo: <AbaMensagens /> },
          ]}
          acoes={<MenuAcoesNota nota={nota} />}
        />
      ) : null}
    </>
  )
}
