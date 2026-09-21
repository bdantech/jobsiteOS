'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, LayoutGrid, Table2 } from 'lucide-react'
import {
  COLUNAS_ESTEIRA,
  DECISAO_FINAL_LABELS,
  ESTAGIO_ANALISE_LABELS,
  ehEstagioDecidido,
  formatCnpj,
  type DecisaoFinal,
  type EstagioAnalise,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CabecalhoDaColuna,
  CardDoFunil,
  ChipDoCard,
  ColunaVazia,
  TiraDoCard,
  type TomDaTira,
} from '@/components/comercial/card-funil'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buscarEsteira, creditoKeys, type AnaliseNaEsteira } from './queries'

/**
 * A esteira (04d §4.4): kanban por estágio, com tabela como alternativa.
 *
 * O kanban NÃO tem arrastar-e-soltar, e a ausência é deliberada: metade dos estágios
 * (enviada, em análise, aprovada, negada) só é escrita depois de uma resposta da
 * seguradora ou de uma decisão registrada no confronto. Uma coluna que aceita um card
 * arrastado promete um poder que não existe — e o RPC recusaria a escrita, transformando
 * um gesto natural num erro inexplicável.
 *
 * ─── ESTA TELA NÃO ESCREVE NADA ─────────────────────────────────────────────
 * Nem move estágio, nem envia à seguradora. O envio morava aqui como um botão de lote
 * alimentado por checkboxes nos cards, e era a ação mais cara do módulo sendo disparada
 * de uma lista onde só se vê nome e valor. Ele foi para a página de detalhe, ao lado dos
 * documentos, do score e dos protestos — o único lugar onde dá para saber se vale gastar
 * a consulta antes de gastá-la.
 *
 * O que sobra é uma lista que se lê e por onde se entra. Um card, um clique, um destino.
 */

const moeda = (v: number | null): string =>
  v === null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** `expira_em` é `date`: sem o `T00:00:00` o fuso rouba um dia no Brasil. */
const data = (v: string | null): string => {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Dias inteiros de hoje até a data, negativo quando já passou. */
function diasAte(v: string | null): number | null {
  if (!v) return null
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime())) return null
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000)
}

/**
 * O tom do desfecho, UMA vez, para o bloco da direita e para a tira.
 *
 * Fora dos três estágios decididos não há veredito nenhum — e `neutro` é o que
 * diz isso. Pintar de cinza é diferente de não pintar: aqui o bloco some.
 */
const TOM_DO_ESTAGIO: Partial<Record<EstagioAnalise, TomDaTira>> = {
  aprovada: 'bom',
  aprovada_parcial: 'alerta',
  negada: 'ruim',
}

function nomeDe(a: AnaliseNaEsteira): string {
  return a.razao_social ?? a.nome_fantasia ?? formatCnpj(a.cnpj)
}

/**
 * O card da esteira, no desenho dos outros funis (`CardDoFunil`).
 *
 * Ele era o último com geometria própria — borda tingida por estágio, tipografia
 * e espaçamentos que não batiam com NFs, Sacados, Vendas, SDR e Certificados.
 * Quem trabalha em dois funis no mesmo dia reaprendia onde olhar em cada um.
 *
 * A BORDA TINGIDA POR ESTÁGIO SAIU e não faz falta: no kanban o estágio é a
 * COLUNA, e repeti-lo na cor do card gastava o recurso mais escasso da tela para
 * dizer o que o cabeçalho acima já diz. O tom passa a carregar o que varia DENTRO
 * da coluna — quanto do pedido foi aprovado, e o que a seguradora condicionou.
 *
 * O CARD CONTINUA SENDO UM LINK, e é por isso que `CardDoFunil` ganhou `href`:
 * nos outros cinco funis abrir é revelar algo ali mesmo, aqui é ir para outra
 * página. Trocar a âncora por um `onClick` que navega perderia abrir em nova aba,
 * copiar o endereço e o anúncio "link para {empresa}" — em silêncio, porque para
 * o mouse esquerdo tudo continuaria igual.
 */
function CartaoAnalise({ a }: { a: AnaliseNaEsteira }) {
  const decidida = ehEstagioDecidido(a.estagio)
  const tom = TOM_DO_ESTAGIO[a.estagio as EstagioAnalise] ?? 'neutro'

  const aprovado = a.limite_aprovado === null ? null : Number(a.limite_aprovado)
  const solicitado = a.limite_solicitado === null ? null : Number(a.limite_solicitado)
  const operacional = a.limite_operacional === null ? null : Number(a.limite_operacional)

  /*
   * O BLOCO DA DIREITA responde "vale meu tempo?", e aqui isso é: quanto do que
   * pedimos a seguradora concedeu. Uma parcial de 30% e uma de 95% moram na mesma
   * coluna e são decisões comerciais opostas — e o card antigo mostrava as duas
   * como "Aprovada parcial".
   *
   * Só aparece com DECISÃO e com PEDIDO. Sem o pedido não há fração: 500 mil
   * aprovados sobre um denominador que ninguém registrou é uma conta sem chão, e
   * o card prefere não desenhar o bloco a desenhar um número inventado.
   */
  const fracaoDoPedido =
    decidida && solicitado !== null && solicitado > 0
      ? Math.max(0, Math.min(100, ((aprovado ?? 0) / solicitado) * 100))
      : null

  const dias = diasAte(a.expira_em)
  const vencida = dias !== null && dias < 0

  /*
   * A TIRA leva a condição da seguradora — o mesmo texto que antes ficava no
   * corpo em três linhas. Ela não mudou de importância, mudou de lugar: a tira é
   * o último elemento lido e é o que faz o olho voltar ao card. "É condição
   * suspensiva a existência de garantia incondicional" não é detalhe jurídico, é
   * um limite que só vale se alguém providenciar a garantia.
   *
   * Sem botão de expandir, como antes: o card inteiro é um link para o detalhe,
   * onde o texto aparece inteiro, e um "ver mais" competiria com essa área.
   */
  const tira = a.motivo ? (
    <TiraDoCard tom={tom}>
      <span className="line-clamp-3 font-normal">{a.motivo}</span>
    </TiraDoCard>
  ) : undefined

  return (
    <CardDoFunil
      rotuloAbrir={`Abrir a análise de ${nomeDe(a)}`}
      href={`/credito/analises/${a.id}`}
      titulo={nomeDe(a)}
      valor={
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-bold leading-none tracking-[-0.02em]">
            {moeda(decidida ? aprovado : solicitado)}
          </span>
          {/*
            A SEGUNDA LINHA, no lugar que o "líquido hoje" ocupa no card de NF e
            pelo mesmo motivo: é o que se lê depois de ter PARADO no card.

            E é o número que a Antecipação de fato usa. Pelo comentário da coluna:
            `limite_operacional` é "o limite com que a casa DECIDIU operar",
            distinto do da seguradora — existe operacional sem aprovado e aprovado
            sem operacional. O card nunca mostrou o nosso, e é ele que decide se a
            nota é operável.
          */}
          <span className="text-[11px] font-normal text-muted-foreground">
            {operacional !== null && operacional !== aprovado ? (
              <>
                operamos com{' '}
                <span className="font-semibold text-foreground/80">{moeda(operacional)}</span>
              </>
            ) : decidida && solicitado !== null ? (
              <>de {moeda(solicitado)} solicitados</>
            ) : (
              'solicitado'
            )}
          </span>
        </span>
      }
      score={
        fracaoDoPedido === null
          ? null
          : {
              valor: fracaoDoPedido,
              faixa: a.estagio,
              tom,
              rotulo: 'do pedido',
              sufixo: '%',
            }
      }
      chips={
        <>
          <ChipDoCard className="font-mono tabular-nums">{formatCnpj(a.cnpj)}</ChipDoCard>
          {/* A validade era uma coluna só da vista em tabela. Um limite aprovado
              que vence em 9 dias é outra conversa que um que vence em 9 meses. */}
          {a.expira_em && decidida ? (
            <ChipDoCard tom={vencida ? 'ruim' : dias !== null && dias <= 30 ? 'alerta' : 'neutro'}>
              {vencida ? `vencida em ${data(a.expira_em)}` : `vence ${data(a.expira_em)}`}
            </ChipDoCard>
          ) : null}
          {a.decisao_interna ? (
            <ChipDoCard tom={a.decisao_interna === 'nao_operar' ? 'ruim' : 'destaque'} forte>
              {DECISAO_FINAL_LABELS[a.decisao_interna as DecisaoFinal] ?? a.decisao_interna}
            </ChipDoCard>
          ) : null}
          {a.origem === 'atradius_backfill' ? (
            // A marca importa: a esteira não pode levar crédito por decisões que
            // ela não tomou, e o funil de conversão ficaria errado se elas
            // entrassem juntas.
            <ChipDoCard>da apólice</ChipDoCard>
          ) : null}
          {a.origem_externa === 'plataforma_producao' ? (
            /*
             * Veio pela API (04n §4). A marca e o `external_id` ficam no card
             * porque a primeira pergunta sobre uma dessas análises é sempre "de
             * qual pedido lá deles isso veio?" — e a resposta é o número que o
             * suporte da produção vai citar no chamado.
             */
            <ChipDoCard tom="info" className="max-w-full">
              <span className="truncate">produção · {a.external_id ?? 'sem id'}</span>
            </ChipDoCard>
          ) : null}
        </>
      }
      /* O rodapé dos outros funis é do dono. A esteira não tem dono; tem RELÓGIO,
         e o quadro já vem ordenado por ele. Numa coluna de espera — documentos
         pendentes, enviada à seguradora — "parada há 12 dias" é a única coisa que
         distingue dois cards, e ela não estava em lugar nenhum da tela. */
      rodapeEsquerda={
        <span className="text-[11.5px] text-muted-foreground">
          atualizada em {data(a.atualizada_em)}
        </span>
      }
      tira={tira}
    />
  )
}

export function Esteira() {
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('kanban')
  const [busca, setBusca] = React.useState('')

  const { data, isPending, isError, error } = useQuery({
    queryKey: creditoKeys.esteira(),
    queryFn: buscarEsteira,
  })

  /**
   * A busca é local, sobre a lista já carregada — a esteira inteira já vem numa consulta,
   * e ir ao banco a cada tecla trocaria um filtro instantâneo por um com latência.
   *
   * O CNPJ é comparado só por DÍGITOS: quem procura cola do documento, com pontuação, e
   * quem lê a tela vê formatado. Comparar as duas formas cruas faria a busca falhar
   * exatamente para quem copiou do lugar certo.
   */
  const filtradas = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return data ?? []
    const digitos = termo.replace(/\D/g, '')
    return (data ?? []).filter((a) => {
      const nome = `${a.razao_social ?? ''} ${a.nome_fantasia ?? ''}`.toLowerCase()
      if (nome.includes(termo)) return true
      return digitos.length > 0 && a.cnpj.includes(digitos)
    })
  }, [data, busca])

  /*
   * O KANBAN SÓ MOSTRA DECISÃO VIVA (0208).
   *
   * Uma análise substituída continua com `estagio = 'aprovada'` — e tem que continuar,
   * porque foi isso que a seguradora respondeu. Mas ela não é mais a resposta da
   * empresa, e deixá-la na coluna faria o número no alto dela dizer "temos 55
   * aprovadas" contando três versões velhas da mesma cobertura.
   *
   * Some do quadro, não do sistema: a vista em lista continua mostrando as duas, com
   * a substituída marcada. É onde se vai quando a pergunta é "o que a apólice já
   * respondeu sobre esta empresa".
   */
  const substituidas = React.useMemo(
    () => filtradas.filter((a) => a.substituida_em !== null),
    [filtradas],
  )

  const porEstagio = React.useMemo(() => {
    const m = new Map<string, AnaliseNaEsteira[]>()
    for (const a of filtradas) {
      if (a.substituida_em !== null) continue
      const lista = m.get(a.estagio) ?? []
      lista.push(a)
      m.set(a.estagio, lista)
    }
    return m
  }, [filtradas])

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar a esteira.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Esteira de análise</CardTitle>
              <CardDescription>
                Os cinco primeiros estágios são nossos, até documentos recebidos.{' '}
                <strong>Enviada em diante depende de uma resposta</strong> — da seguradora, ou
                da decisão registrada no confronto. Por isso não há arrastar-e-soltar: uma
                coluna que aceita um card promete um poder que não existe. Abra uma análise
                para enviá-la à seguradora, rodar a nossa ou concluí-la.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                className="h-9 w-56"
                aria-label="Buscar na esteira por nome ou CNPJ"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVista(vista === 'kanban' ? 'tabela' : 'kanban')}
              >
                {vista === 'kanban' ? (
                  <>
                    <Table2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Tabela
                  </>
                ) : (
                  <>
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Kanban
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {(data ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhuma análise ainda.</p>
              <p className="mt-1">
                As solicitações nascem na Company 360 de um sacado, ou vêm da importação da apólice.
              </p>
            </div>
          ) : filtradas.length === 0 ? (
            // Vazio POR BUSCA é outro estado: dizer "nenhuma análise ainda" aqui faria a
            // pessoa achar que a esteira está vazia quando ela só não encontrou o termo.
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nada encontrado para “{busca}”.</p>
              <p className="mt-1">{(data ?? []).length} análises na esteira.</p>
            </div>
          ) : vista === 'kanban' ? (
            <div className="space-y-2">
              {/* Mesmas medidas dos outros funis — 300px de coluna, `gap-5` entre
                  elas, `space-y-3` entre cards. O desenho do card só vale como
                  desenho compartilhado se a régua em volta dele for a mesma. */}
              <div className="flex gap-5 overflow-x-auto pb-3">
                {COLUNAS_ESTEIRA.map((estagio) => {
                  const itens = porEstagio.get(estagio) ?? []
                  return (
                    <div key={estagio} className="w-[300px] shrink-0 space-y-3">
                      <CabecalhoDaColuna
                        titulo={ESTAGIO_ANALISE_LABELS[estagio]}
                        total={itens.length}
                      />
                      <div className="space-y-3">
                        {itens.map((a) => (
                          <CartaoAnalise key={a.id} a={a} />
                        ))}
                        {itens.length === 0 && <ColunaVazia>vazio</ColunaVazia>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {substituidas.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {substituidas.length === 1
                    ? '1 decisão anterior foi substituída por uma reanálise e saiu do quadro. Ela continua'
                    : `${substituidas.length} decisões anteriores foram substituídas por reanálises e saíram do quadro. Elas continuam`}{' '}
                  na vista em lista.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead className="text-right">Solicitado</TableHead>
                    <TableHead className="text-right">Aprovado</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((a) => (
                    /* Mesma lista, mesma regra: a linha inteira abre, pelo mesmo link
                       esticado do card. Duas vistas do mesmo dado que se clicam de jeitos
                       diferentes fazem a pessoa reaprender a tela ao trocar de botão. */
                    <TableRow key={a.id} className="relative">
                      <TableCell className="max-w-[20rem]">
                        <Link
                          href={`/credito/analises/${a.id}`}
                          className="text-sm font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {nomeDe(a)}
                        </Link>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCnpj(a.cnpj)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap text-[11px]">
                          {ESTAGIO_ANALISE_LABELS[a.estagio as EstagioAnalise] ?? a.estagio}
                        </Badge>
                        {/* O desfecho continua sendo o que a seguradora disse; esta
                            segunda linha é que diz que ele não é mais o que vale. */}
                        {a.substituida_em !== null && (
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            substituída
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(a.limite_solicitado)}</TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(a.limite_aprovado)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.expira_em ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.origem === 'atradius_backfill' ? 'apólice' : 'esteira'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
