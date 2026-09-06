'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Clock, Coins,
  ExternalLink, MoreHorizontal, Wallet,
} from 'lucide-react'
import {
  GRUPO_MEU_DIA_LABELS,
  blocoCatalogado,
  composicaoDoDia,
  itensUrgentes,
  ordenarItens,
  totalDeItens,
  valorEmJogo,
  type BlocoMeuDia,
  type GrupoMeuDia,
  type ItemMeuDia,
  type MeuDia,
} from '@jobsiteos/core'
import { ocultarItemAction, concluirTarefaAction } from '@/actions/meu-dia'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Meu Dia — a lista de trabalho, e não um painel.
 *
 * TRÊS REGRAS DE INTERAÇÃO governam o arquivo inteiro, e cada uma resolve um jeito
 * conhecido de matar a adoção de uma tela dessas:
 *
 *   INDICADOR ABRE MODAL, NUNCA NAVEGA. Clicar num número e perder a página é perder o
 *   contexto do dia; a pessoa volta e não sabe onde parou. Do modal ela age e fecha.
 *
 *   O GRÁFICO É O NAVEGADOR, e é o ÚNICO. Clicar numa fatia filtra os cards abaixo. Ele
 *   responde "meu dia é feito de quê" — e é por isso que não abre modal: quem clica ali
 *   está escolhendo o que trabalhar, não pedindo uma lista.
 *
 *   BLOCO VAZIO SOME. A página encolhe conforme o dia é feito, e o fim dela é uma tela
 *   comemorando, não uma lista de zeros.
 */

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const FAIXA_URGENCIA: Record<string, string> = {
  alta: 'bg-red-500',
  media: 'bg-amber-500',
  baixa: 'bg-slate-300 dark:bg-slate-600',
}

const COR_GRUPO: Record<GrupoMeuDia, string> = {
  funil: 'bg-sky-500',
  conversa: 'bg-violet-500',
  carteira: 'bg-emerald-500',
  credito: 'bg-amber-500',
  cadastro: 'bg-slate-400',
}

export interface MeuDiaTelaProps {
  dia: MeuDia & { comissao_projetada: number }
  /** Vendedores que o gestor pode abrir. Vazio para quem só vê o próprio dia. */
  visiveis: { id: string; nome: string; tipo: string }[]
  ehGestor: boolean
}

export function MeuDiaTela({ dia, visiveis, ehGestor }: MeuDiaTelaProps) {
  const router = useRouter()
  const [filtro, setFiltro] = React.useState<GrupoMeuDia | null>(null)
  const [modal, setModal] = React.useState<{ titulo: string; itens: ItemMeuDia[] } | null>(null)
  const [adiando, setAdiando] = React.useState<{ bloco: string; item: ItemMeuDia } | null>(null)

  const urgentes = itensUrgentes(dia)
  const emJogo = valorEmJogo(dia)
  const total = totalDeItens(dia)
  const composicao = composicaoDoDia(dia)

  const blocos = dia.blocos
    .filter((b) => !filtro || blocoCatalogado(b.tipo)?.grupo === filtro)
    .filter((b) => b.itens.length > 0)

  const compromissos = ordenarItens(
    dia.blocos.flatMap((b) => b.itens).filter((i) => i.quando),
  ).sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? ''))

  async function ocultar(bloco: string, item: ItemMeuDia, acao: 'adiado' | 'irrelevante', ate?: string) {
    const r = await ocultarItemAction({
      tipoItem: bloco,
      referenciaId: item.referencia_id,
      acao,
      adiadoAte: ate ?? null,
      motivo: acao === 'irrelevante' ? 'Marcado como irrelevante na tela' : null,
    })
    if (!r.ok) return toast.error(r.message)
    toast.success(acao === 'adiado' ? 'Adiado — volta na data.' : 'Fora da lista.')
    setAdiando(null)
    router.refresh()
  }

  if (!dia.tem_acesso) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          Este dia não é seu para ver.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho: de quem é o dia ───────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {dia.espelhado ? `Carteira de ${dia.vendedor_nome ?? '—'}` : 'Meu Dia'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? 'Nada esperando por você agora.'
              : `${total} ${total === 1 ? 'item' : 'itens'} para hoje${
                  urgentes.length > 0 ? `, ${urgentes.length} com relógio correndo` : ''
                }.`}
          </p>
        </div>

        {ehGestor && visiveis.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="ver-dia" className="text-xs text-muted-foreground">Ver o dia de</label>
            <select
              id="ver-dia"
              value={dia.vendedor_id ?? ''}
              onChange={(e) => router.push(`/comercial/meu-dia?vendedor=${e.target.value}`)}
              className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
            >
              {visiveis.map((v) => (
                <option key={v.id} value={v.id}>{v.nome}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Timeline: no mobile ela vem PRIMEIRO ─────────────────────────── */}
      {compromissos.length > 0 && (
        <div className="lg:order-last">
          <Timeline itens={compromissos} />
        </div>
      )}

      {/* ── Indicadores ──────────────────────────────────────────────────── */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
        <Indicador
          icone={Wallet}
          rotulo="R$ em jogo hoje"
          valor={brl(emJogo)}
          detalhe={`${total} ${total === 1 ? 'item acionável' : 'itens acionáveis'}`}
          onClick={() => setModal({ titulo: 'Tudo o que está em jogo hoje', itens: ordenarItens(dia.blocos.flatMap((b) => b.itens)) })}
        />
        <Indicador
          icone={Coins}
          rotulo="Comissão projetada"
          valor={brl(dia.comissao_projetada)}
          detalhe="se tudo converter"
          onClick={() =>
            setModal({
              titulo: 'De onde vem a comissão projetada',
              itens: ordenarItens(
                dia.blocos
                  .filter((b) => b.tipo === 'nfs_alta_nao_prospectadas' || b.tipo === 'antecipacoes_travadas')
                  .flatMap((b) => b.itens),
              ),
            })
          }
        />
        <Indicador
          icone={AlertTriangle}
          rotulo="Itens urgentes"
          valor={String(urgentes.length)}
          detalhe={urgentes.length > 0 ? 'com relógio correndo' : 'nada vencendo'}
          alerta={urgentes.length > 0}
          onClick={() => setModal({ titulo: 'O que tem relógio correndo', itens: urgentes })}
        />
        <IndicadorDoCargo dia={dia} onAbrir={setModal} />
      </div>

      {/* ── O gráfico: o navegador da página ─────────────────────────────── */}
      {composicao.length > 0 && (
        <Composicao
          fatias={composicao}
          total={total}
          filtro={filtro}
          onFiltrar={(g) => setFiltro((atual) => (atual === g ? null : g))}
        />
      )}

      {/* ── Os cards ─────────────────────────────────────────────────────── */}
      {blocos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" aria-hidden />
            <p className="text-lg font-medium">Tudo em dia por aqui</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {filtro
                ? 'Nada pendente nesta fatia. Tire o filtro para ver o resto.'
                : 'Nenhum item pedindo ação agora. O que aparecer chega aqui sozinho.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {blocos.map((bloco) => (
            <BlocoDeCards
              key={bloco.tipo}
              bloco={bloco}
              onAdiar={(item) => setAdiando({ bloco: bloco.tipo, item })}
              onDescartar={(item) => void ocultar(bloco.tipo, item, 'irrelevante')}
              onConcluir={async (item) => {
                const r = await concluirTarefaAction(String(item.meta.tarefa_id))
                if (!r.ok) return toast.error(r.message)
                toast.success('Feito.')
                router.refresh()
              }}
              onVerTodos={() =>
                setModal({ titulo: blocoCatalogado(bloco.tipo)?.rotulo ?? bloco.tipo, itens: bloco.itens })
              }
            />
          ))}
        </div>
      )}

      {/* ── Rodapé: o contexto do cargo ──────────────────────────────────── */}
      {dia.mapa_carteira.length > 0 && <MapaCarteira clientes={dia.mapa_carteira} />}
      {dia.funil_semana.length > 0 && <FunilSemana etapas={dia.funil_semana} />}
      {dia.evolucao.length > 0 && <Evolucao serie={dia.evolucao} />}

      <ModalDeItens aberto={modal} onFechar={() => setModal(null)} />
      <DialogAdiar
        alvo={adiando}
        onFechar={() => setAdiando(null)}
        onConfirmar={(ate) => adiando && void ocultar(adiando.bloco, adiando.item, 'adiado', ate)}
      />
    </div>
  )
}

// ─── Indicadores ────────────────────────────────────────────────────────────

function Indicador({
  icone: Icone, rotulo, valor, detalhe, onClick, alerta = false,
}: {
  icone: typeof Wallet
  rotulo: string
  valor: string
  detalhe: string
  onClick: () => void
  alerta?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-[15rem] snap-start rounded-lg border bg-card p-4 text-left transition-colors',
        'hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        alerta ? 'border-red-500/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icone className={cn('h-3.5 w-3.5', alerta && 'text-red-600')} aria-hidden />
        {rotulo}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detalhe}</div>
    </button>
  )
}

/**
 * O quarto indicador muda com o cargo (§2.1) — e cada um é a pergunta que aquela pessoa
 * faz primeiro de manhã: quanto de nota boa está parada, quantos leads esfriando, quanto
 * limite aprovado não está sendo usado.
 */
function IndicadorDoCargo({
  dia, onAbrir,
}: {
  dia: MeuDia
  onAbrir: (m: { titulo: string; itens: ItemMeuDia[] }) => void
}) {
  const bloco = (tipo: string) => dia.blocos.find((b) => b.tipo === tipo)

  if (dia.tipo === 'originador') {
    const b = bloco('nfs_alta_nao_prospectadas')
    return (
      <Indicador
        icone={ArrowUpRight}
        rotulo="NF alta não prospectada"
        valor={brl(b?.valor_total ?? 0)}
        detalhe={`${b?.total ?? 0} nota(s) esperando`}
        onClick={() => onAbrir({ titulo: 'NFs de alta probabilidade não prospectadas', itens: b?.itens ?? [] })}
      />
    )
  }

  if (dia.tipo === 'sdr') {
    const b = bloco('inbound_nao_contatado')
    const maisAntigo = b?.itens[0]?.dias ?? 0
    return (
      <Indicador
        icone={Clock}
        rotulo="Inbound sem resposta"
        valor={String(b?.total ?? 0)}
        detalhe={maisAntigo > 0 ? `o mais antigo há ${maisAntigo}h` : 'nada esperando'}
        alerta={(b?.total ?? 0) > 0}
        onClick={() => onAbrir({ titulo: 'Inbound novo não contatado', itens: b?.itens ?? [] })}
      />
    )
  }

  const b = bloco('carteira_ociosa')
  return (
    <Indicador
      icone={Wallet}
      rotulo="Limite ocioso"
      valor={brl(b?.valor_total ?? 0)}
      detalhe={`${b?.total ?? 0} cliente(s) parados`}
      onClick={() => onAbrir({ titulo: 'Carteira passiva ociosa', itens: b?.itens ?? [] })}
    />
  )
}

// ─── O gráfico de composição ────────────────────────────────────────────────

function Composicao({
  fatias, total, filtro, onFiltrar,
}: {
  fatias: { grupo: GrupoMeuDia; itens: number; valor: number }[]
  total: number
  filtro: GrupoMeuDia | null
  onFiltrar: (g: GrupoMeuDia) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        {fatias.map((f) => (
          <button
            key={f.grupo}
            type="button"
            onClick={() => onFiltrar(f.grupo)}
            style={{ width: `${(f.itens / Math.max(total, 1)) * 100}%` }}
            aria-label={`${GRUPO_MEU_DIA_LABELS[f.grupo]}: ${f.itens} itens`}
            className={cn(
              'h-full transition-opacity',
              COR_GRUPO[f.grupo],
              filtro && filtro !== f.grupo && 'opacity-25',
            )}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {fatias.map((f) => (
          <button
            key={f.grupo}
            type="button"
            onClick={() => onFiltrar(f.grupo)}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-opacity',
              filtro && filtro !== f.grupo ? 'opacity-40' : 'opacity-100',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', COR_GRUPO[f.grupo])} aria-hidden />
            <span className="font-medium">{GRUPO_MEU_DIA_LABELS[f.grupo]}</span>
            <span className="tabular-nums text-muted-foreground">{f.itens}</span>
          </button>
        ))}
        {filtro && (
          <button type="button" onClick={() => onFiltrar(filtro)} className="text-xs underline text-muted-foreground">
            limpar filtro
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────────

function BlocoDeCards({
  bloco, onAdiar, onDescartar, onConcluir, onVerTodos,
}: {
  bloco: BlocoMeuDia
  onAdiar: (i: ItemMeuDia) => void
  onDescartar: (i: ItemMeuDia) => void
  onConcluir: (i: ItemMeuDia) => void
  onVerTodos: () => void
}) {
  const cat = blocoCatalogado(bloco.tipo)
  const restantes = bloco.total - bloco.itens.length

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{cat?.rotulo ?? bloco.tipo}</h2>
          {cat?.descricao && <p className="text-xs text-muted-foreground">{cat.descricao}</p>}
        </div>
        {bloco.valor_total > 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">{brl(bloco.valor_total)}</span>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {ordenarItens(bloco.itens).map((item) => (
          <CardDeItem
            key={item.referencia_id}
            item={item}
            bloco={bloco.tipo}
            onAdiar={() => onAdiar(item)}
            onDescartar={() => onDescartar(item)}
            onConcluir={() => onConcluir(item)}
          />
        ))}
      </div>

      {restantes > 0 && (
        <button type="button" onClick={onVerTodos} className="text-xs underline text-muted-foreground">
          e mais {restantes} — ver todos
        </button>
      )}
    </section>
  )
}

/** Para onde o botão primário leva. O agregador diz o tipo da ação; aqui vira rota. */
function destino(bloco: string, item: ItemMeuDia): string | null {
  const cat = blocoCatalogado(bloco)
  const meta = item.meta as Record<string, string | undefined>
  switch (cat?.acao) {
    case 'abrir_empresa':
    case 'abrir_certificado':
      return item.empresa_id ? `/empresas/${item.empresa_id}` : null
    case 'abrir_card_nf':
      return '/comercial/nfs'
    case 'abrir_card_venda':
      return '/comercial/vendas'
    case 'abrir_card_lead':
      return '/comercial/sdr'
    case 'abrir_fornecedor':
      return '/comercial/fornecedores'
    case 'decidir_aceite':
      return '/comercial/comissoes'
    case 'abrir_conversa':
    case 'enviar_sugestao':
      return meta.conversa_id ? `/comunicacao/${meta.conversa_id}` : '/comunicacao'
    case 'vincular_conversa':
      return '/comunicacao/nao-vinculadas'
    default:
      return null
  }
}

function CardDeItem({
  item, bloco, onAdiar, onDescartar, onConcluir,
}: {
  item: ItemMeuDia
  bloco: string
  onAdiar: () => void
  onDescartar: () => void
  onConcluir: () => void
}) {
  const cat = blocoCatalogado(bloco)
  const href = destino(bloco, item)
  const [menu, setMenu] = React.useState(false)

  return (
    <div className="relative flex overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn('w-1 shrink-0', FAIXA_URGENCIA[item.urgencia] ?? FAIXA_URGENCIA.baixa)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.titulo}</p>
            {item.subtitulo && <p className="truncate text-xs text-muted-foreground">{item.subtitulo}</p>}
          </div>
          {item.valor !== null && item.valor > 0 && (
            <span className="shrink-0 text-sm font-semibold tabular-nums">{brl(item.valor)}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{item.motivo}</p>

        <div className="flex items-center gap-2">
          {cat?.acao === 'concluir_tarefa' ? (
            <Button size="sm" onClick={onConcluir}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
              {cat.acaoRotulo}
            </Button>
          ) : href ? (
            <Button size="sm" asChild>
              {/* Nova aba de propósito: agir sem perder o contexto do dia (§1). */}
              <Link href={href} target="_blank" rel="noopener noreferrer">
                {cat?.acaoRotulo ?? 'Abrir'}
                <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
              </Link>
            </Button>
          ) : null}

          <div className="relative ml-auto">
            <Button variant="ghost" size="sm" onClick={() => setMenu((v) => !v)} aria-label="Mais ações">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
            {menu && (
              <div className="absolute right-0 top-9 z-10 w-44 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => { setMenu(false); onAdiar() }}
                >
                  Adiar até…
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => { setMenu(false); onDescartar() }}
                >
                  Não é relevante
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modais ─────────────────────────────────────────────────────────────────

function ModalDeItens({
  aberto, onFechar,
}: {
  aberto: { titulo: string; itens: ItemMeuDia[] } | null
  onFechar: () => void
}) {
  return (
    <Dialog open={Boolean(aberto)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{aberto?.titulo}</DialogTitle>
          <DialogDescription>
            {aberto?.itens.length ?? 0} item(ns). Abrir leva para a tela de trabalho em outra aba —
            o seu dia continua aqui.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {ordenarItens(aberto?.itens ?? []).map((i) => (
            <li key={i.referencia_id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.titulo}</p>
                <p className="text-xs text-muted-foreground">{i.motivo}</p>
              </div>
              <div className="shrink-0 text-right">
                {i.valor !== null && i.valor > 0 && (
                  <p className="text-sm tabular-nums">{brl(i.valor)}</p>
                )}
                {i.empresa_id && (
                  <Link
                    href={`/empresas/${i.empresa_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline text-muted-foreground"
                  >
                    abrir ficha
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function DialogAdiar({
  alvo, onFechar, onConfirmar,
}: {
  alvo: { bloco: string; item: ItemMeuDia } | null
  onFechar: () => void
  onConfirmar: (ate: string) => void
}) {
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const [data, setData] = React.useState(amanha)

  React.useEffect(() => { if (alvo) setData(amanha) }, [alvo, amanha])

  return (
    <Dialog open={Boolean(alvo)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adiar até quando?</DialogTitle>
          <DialogDescription>
            O item some da lista e volta sozinho na data. Ele não sai do funil — só do seu dia.
          </DialogDescription>
        </DialogHeader>
        <Input type="date" value={data} min={amanha} onChange={(e) => setData(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={() => onConfirmar(data)}>Adiar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Rodapé ─────────────────────────────────────────────────────────────────

/**
 * A timeline do dia: reuniões, prazos de aceite e tarefas com data, na ordem do relógio.
 * No mobile ela sobe para o topo (a classe `lg:order-last` no container) porque é a
 * primeira pergunta de quem abre o app no café: "o que eu tenho hoje?".
 */
function Timeline({ itens }: { itens: ItemMeuDia[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-4 w-4" aria-hidden />
          A agenda de hoje
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        <ol className="relative space-y-3 border-l border-border pl-4">
          {itens.slice(0, 8).map((i) => (
            <li key={`${i.referencia_id}-${i.quando}`} className="relative">
              <span
                className={cn(
                  'absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full',
                  FAIXA_URGENCIA[i.urgencia] ?? FAIXA_URGENCIA.baixa,
                )}
                aria-hidden
              />
              <p className="text-xs tabular-nums text-muted-foreground">
                {i.quando
                  ? new Date(i.quando).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </p>
              <p className="text-sm font-medium">{i.titulo}</p>
              <p className="text-xs text-muted-foreground">{i.motivo}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * O mapa de calor da carteira passiva: um quadrado por cliente, TAMANHO pelo limite e
 * COR pela ociosidade. Substitui uma lista inteira — e responde de relance a pergunta
 * que a lista só responde depois de rolar: onde está o dinheiro parado.
 */
function MapaCarteira({ clientes }: { clientes: MeuDia['mapa_carteira'] }) {
  const maior = Math.max(...clientes.map((c) => c.limite), 1)

  const cor = (dias: number | null) => {
    const d = dias ?? 0
    if (d >= 90) return 'bg-red-500/80'
    if (d >= 45) return 'bg-amber-500/80'
    if (d >= 15) return 'bg-sky-500/70'
    return 'bg-emerald-500/70'
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Mapa da carteira passiva</CardTitle>
        <p className="text-xs text-muted-foreground">
          Tamanho pelo limite, cor pela ociosidade. Vermelho é limite aprovado que não opera há 90 dias.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {clientes.map((c) => {
            const lado = Math.max(28, Math.round(Math.sqrt(c.limite / maior) * 72))
            return (
              <Link
                key={c.cnpj}
                href={c.empresa_id ? `/empresas/${c.empresa_id}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                style={{ width: lado, height: lado }}
                title={`${c.nome} — ${brl(c.limite_disponivel)} disponíveis, ${c.dias_sem_antecipar ?? 0} dias sem antecipar`}
                className={cn('rounded transition-transform hover:scale-105', cor(c.dias_sem_antecipar))}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function FunilSemana({ etapas }: { etapas: MeuDia['funil_semana'] }) {
  const primeiro = etapas[0]?.total ?? 0
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">A sua semana</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-4 gap-2">
        {etapas.map((e, i) => {
          const anterior = etapas[i - 1]?.total ?? null
          const taxa = anterior && anterior > 0 ? Math.round((e.total / anterior) * 100) : null
          return (
            <div key={e.etapa} className="rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">{e.etapa}</p>
              <p className="text-xl font-semibold tabular-nums">{e.total}</p>
              {taxa !== null && <p className="text-[11px] text-muted-foreground">{taxa}% da etapa anterior</p>}
              {i === 0 && primeiro > 0 && <p className="text-[11px] text-muted-foreground">nesta semana</p>}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function Evolucao({ serie }: { serie: MeuDia['evolucao'] }) {
  const maior = Math.max(...serie.map((s) => s.total), 1)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Conversões do mês contra o seu normal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {serie.map((s) => (
          <div key={s.competencia} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="tabular-nums text-muted-foreground">
                {new Date(s.competencia).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
              </span>
              <span className="tabular-nums">
                {brl(s.total)}
                {s.media_3m ? (
                  <span className={cn('ml-2', s.total >= s.media_3m ? 'text-emerald-600' : 'text-amber-600')}>
                    {s.total >= s.media_3m ? '↑' : '↓'} média {brl(s.media_3m)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(s.total / maior) * 100}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
