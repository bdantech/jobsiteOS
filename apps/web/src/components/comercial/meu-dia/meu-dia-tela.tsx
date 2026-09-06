'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Clock, Wallet } from 'lucide-react'
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
import { concluirTarefaAction, ocultarItemAction } from '@/actions/meu-dia'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  BarrasRanking, GraficoBolhas, ListaRolagem, PizzaPorChave,
  STATUS_CORES, STATUS_ROTULOS, squarify, tintaSobre, useLargura, type Bolha,
} from './graficos'
import { LinhaItem, ListaDeItens, SegmentoFiltro, Widget, destinoDoItem } from './widget'

/**
 * Meu Dia — grade de WIDGETS, não pilha de cards.
 *
 * A primeira versão listava tudo, e o resultado foi o que uma lista longa sempre é:
 * confusa, sem foco, e fechada em vez de trabalhada. A régua desta aqui é outra —
 * POUCA INFORMAÇÃO NO MENOR ESPAÇO, e rolagem é aceitável; o que não é aceitável é a
 * pessoa ter de ler dez cards para descobrir onde está o dinheiro.
 *
 * Cada bloco declara no catálogo a FORMA que responde a pergunta dele (`visual`), e é
 * essa declaração que a tela lê. Não há um `if` por tipo de bloco aqui embaixo: um bloco
 * novo nasce com o widget certo por dizer qual é.
 *
 * E TODO gráfico é clicável. Ele não decora a lista — ele é o índice dela: clicar numa
 * fatia, numa bolha ou numa barra abre os itens daquele recorte, no mesmo lugar.
 */

const brl = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 1000
      ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
      : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const COR_GRUPO: Record<GrupoMeuDia, string> = {
  funil: 'bg-sky-500',
  conversa: 'bg-violet-500',
  carteira: 'bg-emerald-500',
  credito: 'bg-amber-500',
  cadastro: 'bg-slate-400',
}

/**
 * A natureza da conta na carteira do closer.
 *
 * `passivo` é a conta que ele GERE e parou de operar; `prospeccao_ativa` é a conta que
 * ele TRABALHA e ainda não começou. As duas aparecem com limite ocioso e as duas pedem
 * uma ligação — mas não a mesma ligação, e é por isso que o filtro existe.
 */
type Natureza = 'todas' | 'passivo' | 'prospeccao_ativa'

const NATUREZA_ROTULO: Record<Natureza, string> = {
  todas: 'Ambas',
  passivo: 'Passiva',
  prospeccao_ativa: 'Ativa',
}

/**
 * A cor da bolha do inbound: azul aos 0h, vermelho aos 96h.
 *
 * É uma codificação REDUNDANTE de propósito — o eixo X já diz quantas horas passaram, e
 * a cor repete. Nada aqui depende só de matiz, o que é o que torna legítimo usar um par
 * de dois tons numa grandeza que só cresce: ela não separa categorias, ela grita.
 */
function corPorEspera(horas: number): string {
  const t = Math.min(Math.max(horas / 96, 0), 1)
  const de = [42, 120, 214]
  const para = [208, 59, 59]
  const c = de.map((v, i) => Math.round(v + (para[i]! - v) * t))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export interface MeuDiaTelaProps {
  dia: MeuDia
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
    .filter((b) => b.itens.length > 0)
    .filter((b) => !filtro || blocoCatalogado(b.tipo)?.grupo === filtro)

  const compromissos = ordenarItens(dia.blocos.flatMap((b) => b.itens).filter((i) => i.quando)).sort(
    (a, b) => (a.quando ?? '').localeCompare(b.quando ?? ''),
  )

  async function ocultar(bloco: string, item: ItemMeuDia, acao: 'adiado' | 'irrelevante', ate?: string) {
    const r = await ocultarItemAction({
      tipoItem: bloco,
      referenciaId: item.referencia_id,
      acao,
      adiadoAte: ate ?? null,
      motivo: acao === 'irrelevante' ? 'Marcado como irrelevante na tela' : null,
      empresaId: item.empresa_id,
    })
    if (!r.ok) return toast.error(r.message)
    toast.success(acao === 'adiado' ? 'Adiado — volta na data.' : 'Fora da lista.')
    setAdiando(null)
    router.refresh()
  }

  async function concluir(item: ItemMeuDia) {
    const r = await concluirTarefaAction(String(item.meta.tarefa_id))
    if (!r.ok) return toast.error(r.message)
    toast.success('Feito.')
    router.refresh()
  }

  if (!dia.tem_acesso) {
    return (
      <div className="rounded-lg border border-border p-16 text-center text-sm text-muted-foreground">
        Este dia não é seu para ver.
      </div>
    )
  }

  const acoes = {
    onAdiar: (bloco: string) => (i: ItemMeuDia) => setAdiando({ bloco, item: i }),
    onDescartar: (bloco: string) => (i: ItemMeuDia) => void ocultar(bloco, i, 'irrelevante'),
    onConcluir: (i: ItemMeuDia) => void concluir(i),
  }

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {dia.espelhado ? `Carteira de ${dia.vendedor_nome ?? '—'}` : 'Meu Dia'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {total === 0
              ? 'Nada esperando por você agora.'
              : `${total} ${total === 1 ? 'item' : 'itens'}${
                  urgentes.length > 0 ? `, ${urgentes.length} com relógio correndo` : ''
                }`}
          </p>
        </div>

        {ehGestor && visiveis.length > 0 && (
          <select
            aria-label="Ver o dia de"
            value={dia.vendedor_id ?? ''}
            onChange={(e) => router.push(`/comercial/meu-dia?vendedor=${e.target.value}`)}
            className="h-8 w-52 rounded-md border border-input bg-background px-2 text-xs"
          >
            {visiveis.map((v) => (
              <option key={v.id} value={v.id}>{v.nome}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Indicadores + composição, numa faixa só ───────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Indicador
            icone={Wallet}
            rotulo="Em jogo hoje"
            valor={brl(emJogo)}
            detalhe={`${total} ${total === 1 ? 'item' : 'itens'}`}
            onClick={() =>
              setModal({
                titulo: 'Tudo o que está em jogo hoje',
                itens: ordenarItens(dia.blocos.flatMap((b) => b.itens)),
              })
            }
          />
          <Indicador
            icone={AlertTriangle}
            rotulo="Urgentes"
            valor={String(urgentes.length)}
            detalhe={urgentes.length > 0 ? 'relógio correndo' : 'nada vencendo'}
            alerta={urgentes.length > 0}
            onClick={() => setModal({ titulo: 'O que tem relógio correndo', itens: urgentes })}
          />
          <IndicadorDoCargo dia={dia} onAbrir={setModal} />
        </div>

        {composicao.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
            {composicao.map((f) => (
              <button
                key={f.grupo}
                type="button"
                onClick={() => setFiltro((a) => (a === f.grupo ? null : f.grupo))}
                className={cn(
                  'flex items-center gap-1.5 text-xs transition-opacity',
                  filtro && filtro !== f.grupo ? 'opacity-40' : 'opacity-100',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', COR_GRUPO[f.grupo])} aria-hidden />
                <span className="hidden font-medium sm:inline">{GRUPO_MEU_DIA_LABELS[f.grupo]}</span>
                <span className="tabular-nums text-muted-foreground">{f.itens}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── A grade de widgets ────────────────────────────────────────────── */}
      {blocos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <CheckCircle2 className="h-9 w-9 text-emerald-600" aria-hidden />
          <p className="text-base font-medium">Tudo em dia por aqui</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {filtro
              ? 'Nada pendente nesta fatia. Tire o filtro para ver o resto.'
              : 'Nenhum item pedindo ação agora.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {blocos.map((bloco) => (
            <WidgetDoBloco
              key={bloco.tipo}
              bloco={bloco}
              dia={dia}
              onAbrirLista={(titulo, itens) => setModal({ titulo, itens })}
              onAdiar={acoes.onAdiar(bloco.tipo)}
              onDescartar={acoes.onDescartar(bloco.tipo)}
              onConcluir={acoes.onConcluir}
            />
          ))}

          {dia.mapa_carteira.length > 0 && <MapaCarteira clientes={dia.mapa_carteira} />}
          {dia.funil_semana.length > 0 && <FunilSemana etapas={dia.funil_semana} />}
          {dia.evolucao.length > 0 && <Evolucao serie={dia.evolucao} />}
          {compromissos.length > 0 && <Timeline itens={compromissos} />}
        </div>
      )}

      <ModalDeItens
        aberto={modal}
        onFechar={() => setModal(null)}
        onAdiar={(bloco, item) => setAdiando({ bloco, item })}
      />
      <DialogAdiar
        alvo={adiando}
        onFechar={() => setAdiando(null)}
        onConfirmar={(ate) => adiando && void ocultar(adiando.bloco, adiando.item, 'adiado', ate)}
      />
    </div>
  )
}

// ─── O widget de um bloco, escolhido pelo catálogo ──────────────────────────

function WidgetDoBloco({
  bloco, dia, onAbrirLista, onAdiar, onDescartar, onConcluir,
}: {
  bloco: BlocoMeuDia
  dia: MeuDia
  onAbrirLista: (titulo: string, itens: ItemMeuDia[]) => void
  onAdiar: (i: ItemMeuDia) => void
  onDescartar: (i: ItemMeuDia) => void
  onConcluir: (i: ItemMeuDia) => void
}) {
  const cat = blocoCatalogado(bloco.tipo)
  const [fatia, setFatia] = React.useState<string | null>(null)
  const [natureza, setNatureza] = React.useState<Natureza>('todas')
  const rotulo = cat?.rotulo ?? bloco.tipo
  const contexto = bloco.valor_total > 0 ? brl(bloco.valor_total) : `${bloco.total}`
  const restantes = bloco.total - bloco.itens.length
  const rodape =
    restantes > 0 ? (
      <button type="button" className="underline" onClick={() => onAbrirLista(rotulo, bloco.itens)}>
        e mais {restantes} — ver todos
      </button>
    ) : null

  // ── Pizza: composição por cedente, e a fatia abre as notas dela ──────────
  if (cat?.visual === 'pizza') {
    const daFatia = fatia
      ? bloco.itens.filter((i) => String(i.meta.cedente_nome ?? i.titulo) === fatia)
      : bloco.itens
    return (
      <Widget
        titulo={rotulo}
        descricao="Por cedente — doze notas do mesmo fornecedor são uma conversa, não doze"
        contexto={contexto}
        rodape={
          fatia ? (
            <button type="button" className="underline" onClick={() => onAbrirLista(fatia, daFatia)}>
              ver as {daFatia.length} nota(s) de {fatia}
            </button>
          ) : (
            rodape
          )
        }
      >
        <PizzaPorChave
          itens={bloco.itens}
          chave="cedente_nome"
          fatiaAtiva={fatia}
          onFatia={setFatia}
        />
      </Widget>
    )
  }

  // ── Bolhas: certificados e inbound ──────────────────────────────────────
  if (cat?.visual === 'bolhas' && bloco.tipo === 'certificados_a_prospectar') {
    const bolhas: Bolha[] = bloco.itens.map((i) => ({
      id: i.referencia_id,
      nome: i.titulo,
      x: Number(i.meta.faltantes ?? 0),
      y: Number(i.meta.limite_ocioso ?? 0),
      tamanho: Number(i.meta.limite_ocioso ?? 0),
      cor: '#2a78d6',
      detalhe: `${i.meta.faltantes} CNPJ(s) sem certificado · ${brl(Number(i.meta.limite_ocioso ?? 0))} ociosos`,
    }))
    return (
      <Widget
        titulo={rotulo}
        descricao="Quanto está parado × quantos CNPJs estão cegos. Bolha grande e à direita é o maior potencial não atacado."
        contexto={contexto}
        rodape={rodape}
      >
        <GraficoBolhas
          bolhas={bolhas}
          rotuloX="CNPJs sem certificado"
          rotuloY="Limite ocioso"
          formatarX={(n) => String(Math.round(n))}
          onBolha={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) onAbrirLista(item.titulo, [item])
          }}
        />
      </Widget>
    )
  }

  if (cat?.visual === 'bolhas' && bloco.tipo === 'inbound_nao_contatado') {
    const bolhas: Bolha[] = bloco.itens.map((i) => ({
      id: i.referencia_id,
      nome: i.titulo,
      x: Number(i.meta.horas ?? i.dias ?? 0),
      y: i.valor ?? 0,
      tamanho: i.valor ?? 1,
      cor: corPorEspera(Number(i.meta.horas ?? 0)),
      detalhe: `${i.meta.horas}h sem resposta · ${brl(i.valor ?? 0)}/mês de potencial`,
    }))
    return (
      <Widget
        titulo={rotulo}
        descricao="Tamanho pelo faturamento, cor pela espera — azul agora, vermelho às 96h"
        contexto={`${bloco.total}`}
        rodape={rodape}
      >
        <GraficoBolhas
          bolhas={bolhas}
          rotuloX="Horas sem contato"
          rotuloY="Potencial mensal"
          dominioX={[0, 96]}
          formatarX={(n) => `${Math.round(n)}h`}
          onBolha={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) onAbrirLista(item.titulo, [item])
          }}
        />
      </Widget>
    )
  }

  // ── Barras: ranking por uma grandeza ────────────────────────────────────
  if (cat?.visual === 'barras') {
    const ehEspera = bloco.tipo === 'conversas_aguardando_resposta'
    const ehCarteira = bloco.tipo === 'carteira_ociosa'

    const naNatureza = (i: ItemMeuDia, n: Natureza) =>
      n === 'todas' || String(i.meta.gestao_operacao ?? '') === n

    const doFiltro = ehCarteira ? bloco.itens.filter((i) => naNatureza(i, natureza)) : bloco.itens

    /* A barra mais longa continua sendo a maior do BLOCO, e não a maior do recorte:
       trocar a referência a cada filtro faria a segunda maior conta virar 100% e parecer
       que ela é o problema. */
    const teto = Math.max(
      ...bloco.itens.map((i) => (ehEspera ? Number(i.meta.horas ?? 0) : (i.valor ?? 0))),
      1,
    )

    const itens = ordenarItens(doFiltro)
      .slice(0, 8)
      .map((i) => ({
        id: i.referencia_id,
        nome: i.titulo,
        valor: ehEspera ? Number(i.meta.horas ?? 0) : (i.valor ?? 0),
        detalhe: i.motivo,
        cor: ehEspera
          ? corPorEspera(Number(i.meta.horas ?? 0))
          : STATUS_CORES[String(i.meta.operation_status ?? '')],
      }))

    const ocioso = doFiltro.reduce((s, i) => s + (i.valor ?? 0), 0)
    const sobrando = doFiltro.length - itens.length

    return (
      <Widget
        titulo={rotulo}
        descricao={
          ehEspera
            ? 'Do que espera há mais tempo para o mais recente'
            : ehCarteira
              ? 'Do maior limite parado para o menor, com a cor do temperature report'
              : cat.descricao
        }
        contexto={ehCarteira ? brl(ocioso) : contexto}
        filtro={
          ehCarteira ? (
            <SegmentoFiltro<Natureza>
              rotulo="Natureza da conta"
              valor={natureza}
              onMudar={setNatureza}
              opcoes={(['todas', 'passivo', 'prospeccao_ativa'] as const).map((v) => ({
                valor: v,
                rotulo: NATUREZA_ROTULO[v],
                total: bloco.itens.filter((i) => naNatureza(i, v)).length,
              }))}
            />
          ) : null
        }
        rodape={
          ehCarteira ? (
            doFiltro.length === 0 ? (
              <span>Nenhuma conta desta natureza está com limite parado.</span>
            ) : sobrando > 0 ? (
              <button
                type="button"
                className="underline"
                onClick={() => onAbrirLista(rotulo, doFiltro)}
              >
                e mais {sobrando} — ver todas
              </button>
            ) : null
          ) : (
            rodape
          )
        }
      >
        <BarrasRanking
          itens={itens}
          maximo={teto}
          formatar={ehEspera ? (n) => `${n}h` : brl}
          onItem={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) onAbrirLista(item.titulo, [item])
          }}
        />
      </Widget>
    )
  }

  // ── Rolagem: a lista longa que cabe num cartão ──────────────────────────
  if (cat?.visual === 'rolagem') {
    return (
      <Widget
        titulo={rotulo}
        descricao={`${bloco.total} no total, do que mais emite para o que menos`}
        contexto={contexto}
      >
        <ListaRolagem
          itens={bloco.itens}
          onItem={(i) => onAbrirLista(i.titulo, [i])}
        />
      </Widget>
    )
  }

  // ── Lista: o padrão ─────────────────────────────────────────────────────
  return (
    <Widget titulo={rotulo} descricao={cat?.descricao} contexto={contexto} rodape={rodape}>
      <ListaDeItens
        bloco={bloco}
        onAdiar={onAdiar}
        onDescartar={onDescartar}
        onConcluir={onConcluir}
      />
    </Widget>
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
        'rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        alerta ? 'border-red-500/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icone className={cn('h-3 w-3', alerta && 'text-red-600')} aria-hidden />
        <span className="truncate">{rotulo}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{valor}</div>
      <div className="truncate text-[11px] text-muted-foreground">{detalhe}</div>
    </button>
  )
}

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
        icone={Wallet}
        rotulo="NF alta parada"
        valor={brl(b?.valor_total ?? 0)}
        detalhe={`${b?.total ?? 0} nota(s)`}
        onClick={() => onAbrir({ titulo: 'NFs de alta probabilidade', itens: b?.itens ?? [] })}
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
        onClick={() => onAbrir({ titulo: 'Inbound não contatado', itens: b?.itens ?? [] })}
      />
    )
  }

  const b = bloco('carteira_ociosa')
  return (
    <Indicador
      icone={Wallet}
      rotulo="Limite ocioso"
      valor={brl(b?.valor_total ?? 0)}
      detalhe={`${b?.total ?? 0} cliente(s)`}
      onClick={() => onAbrir({ titulo: 'Carteira ociosa', itens: b?.itens ?? [] })}
    />
  )
}

// ─── Rodapé ─────────────────────────────────────────────────────────────────

function Timeline({ itens }: { itens: ItemMeuDia[] }) {
  return (
    <Widget titulo="A agenda de hoje" descricao="Reuniões, prazos e tarefas com data">
      <ol className="max-h-56 space-y-2.5 overflow-y-auto border-l border-border pl-3">
        {itens.slice(0, 10).map((i) => (
          <li key={`${i.referencia_id}-${i.quando}`} className="relative">
            <span
              className={cn(
                'absolute -left-[1.05rem] top-1.5 h-1.5 w-1.5 rounded-full',
                i.urgencia === 'alta' ? 'bg-red-500' : 'bg-amber-500',
              )}
              aria-hidden
            />
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {i.quando
                ? new Date(i.quando).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })
                : '—'}
            </p>
            <p className="truncate text-xs font-medium">{i.titulo}</p>
          </li>
        ))}
      </ol>
    </Widget>
  )
}

/**
 * O mapa da carteira passiva: tamanho pelo limite, COR PELO TEMPERATURE REPORT.
 *
 * A cor era a ociosidade em dias, que é um proxy. O report é a leitura da plataforma
 * sobre a saúde da conta — usar o proxy existindo a leitura direta é escolher o pior dos
 * dois. E cada quadrado leva o nome: um mapa de retângulos sem rótulo é bonito e mudo.
 *
 * O LAYOUT é um treemap (squarify), e não uma fileira de quadrados que quebra linha. Os
 * dois desenham a mesma informação; a diferença é a sobra. Com `flex-wrap`, a última
 * linha ficava pela metade e o vazio à direita entrava na leitura como se dissesse algo.
 * No treemap a área é a fração do limite e a soma delas é o componente inteiro — não há
 * espaço morto para interpretar.
 */
const ALTURA_MAPA = 240

function MapaCarteira({ clientes }: { clientes: MeuDia['mapa_carteira'] }) {
  const [ref, largura] = useLargura<HTMLDivElement>()

  const ordenados = React.useMemo(
    () => [...clientes].sort((a, b) => b.limite - a.limite),
    [clientes],
  )
  /* Squarify precisa da entrada em ordem decrescente — é o que lhe permite fechar cada
     faixa antes que a proporção dos retângulos piore. */
  const caixas = React.useMemo(
    () => squarify(ordenados.map((c) => c.limite), largura, ALTURA_MAPA),
    [ordenados, largura],
  )

  const porStatus = new Map<string, number>()
  for (const c of ordenados) {
    const s = String((c as { operation_status?: string }).operation_status ?? 'operating_normally')
    porStatus.set(s, (porStatus.get(s) ?? 0) + 1)
  }

  return (
    <Widget
      titulo="Minha carteira passiva"
      descricao="Área pelo limite aprovado, cor pelo temperature report"
      contexto={`${ordenados.length}`}
      rodape={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {[...porStatus.entries()].map(([s, n]) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_CORES[s] ?? '#94a3b8' }}
                aria-hidden
              />
              {STATUS_ROTULOS[s] ?? s} · {n}
            </span>
          ))}
        </span>
      }
    >
      <div ref={ref} className="relative w-full" style={{ height: ALTURA_MAPA }}>
        {ordenados.map((c, i) => {
          const r = caixas[i]
          if (!r || r.w <= 0 || r.h <= 0) return null
          const status = String(
            (c as { operation_status?: string }).operation_status ?? 'operating_normally',
          )
          const fundo = STATUS_CORES[status] ?? '#94a3b8'
          /* O nome só entra onde cabe inteiro o suficiente para ser lido; onde não cabe,
             o `title` e o clique continuam lá. Meio nome truncado num retângulo de 30px
             não informa — só suja. */
          const cabeNome = r.w >= 44 && r.h >= 20
          const cabeValor = r.w >= 92 && r.h >= 44
          return (
            <Link
              key={c.cnpj}
              href={c.empresa_id ? `/empresas/${c.empresa_id}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              title={`${c.nome} — limite de ${brl(c.limite)}, ${brl(c.limite_disponivel)} disponíveis · ${
                STATUS_ROTULOS[status] ?? status
              }`}
              /* O `inset` de 1px de cada lado dá os 2px de superfície entre preenchimentos
                 vizinhos — sem ele, dois retângulos do mesmo status viram um só. */
              style={{
                position: 'absolute',
                left: r.x + 1,
                top: r.y + 1,
                width: Math.max(r.w - 2, 0),
                height: Math.max(r.h - 2, 0),
                backgroundColor: fundo,
                color: tintaSobre(fundo),
              }}
              className="overflow-hidden rounded-[3px] p-1 leading-tight transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {cabeNome ? (
                <span className="line-clamp-2 text-[9px] font-medium">{c.nome}</span>
              ) : null}
              {cabeValor ? (
                <span className="mt-0.5 block text-[9px] tabular-nums opacity-80">
                  {brl(c.limite)}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
    </Widget>
  )
}

function FunilSemana({ etapas }: { etapas: MeuDia['funil_semana'] }) {
  return (
    <Widget titulo="A sua semana" descricao="Contatados → com fit → agendados → realizados">
      <div className="grid grid-cols-4 gap-2">
        {etapas.map((e, i) => {
          const anterior = etapas[i - 1]?.total ?? null
          const taxa = anterior && anterior > 0 ? Math.round((e.total / anterior) * 100) : null
          return (
            <div key={e.etapa} className="rounded-md border border-border p-2">
              <p className="truncate text-[10px] text-muted-foreground">{e.etapa}</p>
              <p className="text-lg font-semibold tabular-nums">{e.total}</p>
              {taxa !== null && <p className="text-[10px] text-muted-foreground">{taxa}% da anterior</p>}
            </div>
          )
        })}
      </div>
    </Widget>
  )
}

function Evolucao({ serie }: { serie: MeuDia['evolucao'] }) {
  const maior = Math.max(...serie.map((s) => s.total), 1)
  return (
    <Widget titulo="Conversões do mês" descricao="Contra a média dos três meses anteriores">
      <div className="space-y-2">
        {serie.map((s) => (
          <div key={s.competencia} className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="tabular-nums text-muted-foreground">
                {new Date(s.competencia).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
              </span>
              <span className="tabular-nums">
                {brl(s.total)}
                {s.media_3m ? (
                  <span className={cn('ml-2', s.total >= s.media_3m ? 'text-emerald-600' : 'text-amber-600')}>
                    {s.total >= s.media_3m ? '↑' : '↓'} {brl(s.media_3m)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(s.total / maior) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Widget>
  )
}

// ─── Modais ─────────────────────────────────────────────────────────────────

function ModalDeItens({
  aberto, onFechar, onAdiar,
}: {
  aberto: { titulo: string; itens: ItemMeuDia[] } | null
  onFechar: () => void
  onAdiar: (bloco: string, item: ItemMeuDia) => void
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
