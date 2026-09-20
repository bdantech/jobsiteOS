'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Gavel,
  Handshake,
  MessageCircle,
  MoreHorizontal,
  ShieldQuestion,
  Sparkles,
  UserCheck,
} from 'lucide-react'
import {
  ESTAGIO_PROSPECCAO_LABELS,
  formatCnpj,
  renderizarAbordagem,
  type EstagioProspeccao,
} from '@jobsiteos/core'
import { Badge, STATUS_TEXTO } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { moverSacadoAction } from '@/actions/prospeccao'
import { formatarData, formatarInteiro, formatarMoeda, formatarMoedaExata } from './format'
import {
  buscarNotasDoCard,
  buscarQuebraFornecedores,
  prospeccaoKeys,
  type ConfigProspeccao,
  type QuebraFornecedor,
  type SacadoProspeccao,
} from './prospeccao-queries'

/**
 * O card do funil de Sacados por NF (04r §5).
 *
 * ─── OS QUATRO NÚMEROS, E POR QUE SÃO QUATRO ────────────────────────────────
 *
 * Volume 30d diz que o fluxo EXISTE. Valor operável diz o que SOBRA depois da esteira —
 * medido na base em 20/09/2026, de R$ 60,1 milhões emitidos em 30 dias só R$ 436 mil
 * passariam de 55 dias de vida, e a mediana do prazo restante é de 12 dias. Média mensal
 * e recorrência dizem se isso se REPETE.
 *
 * Mostrar só o primeiro faria o originador trabalhar um card de R$ 900 mil por duas
 * semanas e descobrir no fim que não sobrou nota nenhuma. Mostrar só o segundo o faria
 * ignorar um cliente anual porque a nota daquela semana estava curta.
 *
 * ─── A QUEBRA POR FORNECEDOR É O CORAÇÃO ────────────────────────────────────
 *
 * É ela que transforma um número numa abordagem: quem emitiu, quanto, quando, e —
 * sobretudo — se ele já é da MINHA carteira. "Ligar para um cliente meu" e "pedir um
 * favor a um cliente de outra pessoa" são conversas diferentes, e o selo é o que separa
 * as duas antes de alguém discar.
 */

export interface SacadoProspeccaoCardProps {
  sacado: SacadoProspeccao
  config: ConfigProspeccao
  ehGestor: boolean
  onDescartar: (sacado: SacadoProspeccao) => void
  onSolicitarAnalise: (sacado: SacadoProspeccao) => void
  onEnriquecer: (sacado: SacadoProspeccao) => void
  onPedirPonte: (sacado: SacadoProspeccao, fornecedor: QuebraFornecedor) => void
  onReatribuir?: (sacado: SacadoProspeccao) => void
}

/**
 * O badge HONESTO do score (§5): 72 com completude de 45% aparece marcado como frágil.
 *
 * Sem a marca, o número se lê como se os dois casos fossem iguais — e não são: um score
 * alto sobre meia ficha é uma aposta com cara de medição. A régua é a mesma do
 * scorecard (`completude_minima`, hoje 0,5).
 */
function ScoreBadge({ score, completude }: { score: number | null; completude: number | null }) {
  if (score === null) {
    return (
      <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
        Sem score
      </Badge>
    )
  }
  const fragil = (completude ?? 0) < 0.5
  /*
   * O canal de STATUS do design system, não uma cor crua: `warning` é "o número existe
   * mas não se sustenta", `success` é "pode confiar". Repintar isto à mão daria ao card
   * deste funil um âmbar diferente do âmbar de todo o resto do app.
   */
  return (
    <Badge
      variant={fragil ? 'warning' : 'success'}
      className="text-[11px] tabular-nums"
      title={
        fragil
          ? `Score ${score} sobre completude de ${Math.round((completude ?? 0) * 100)}% — frágil: falta cadastral para sustentá-lo.`
          : `Score ${score}, completude de ${Math.round((completude ?? 0) * 100)}%.`
      }
    >
      Score {Number(score).toFixed(0)}
      {fragil ? ' · frágil' : ''}
    </Badge>
  )
}

/** A expansão de um cedente: as notas, uma a uma, com a marca de operável. */
function NotasDoFornecedor({
  cnpjSacado,
  fornecedorCnpj,
}: {
  cnpjSacado: string
  fornecedorCnpj: string
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: prospeccaoKeys.notas(cnpjSacado, fornecedorCnpj),
    queryFn: () => buscarNotasDoCard(cnpjSacado, fornecedorCnpj),
  })

  if (isPending) return <Skeleton className="mt-2 h-16 w-full" />
  if (isError) {
    return (
      <p className="mt-2 text-xs text-destructive">
        {error instanceof Error ? error.message : 'Erro ao carregar as notas.'}
      </p>
    )
  }
  if (data.notas.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">Nenhuma nota na janela.</p>
  }

  return (
    <div className="mt-2 space-y-1 rounded-md border border-dashed p-2">
      {data.notas.map((n) => (
        <div key={n.access_key} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-mono text-muted-foreground">
            {n.numero ?? '—'}
            {n.serie ? `/${n.serie}` : ''}
          </span>
          <span className="tabular-nums">{formatarMoedaExata(n.valor)}</span>
          <span className="text-muted-foreground">
            {formatarData(n.emitida_em)} → {formatarData(n.vencimento)}
          </span>
          <span
            className={cn(
              'tabular-nums',
              n.operavel ? STATUS_TEXTO.success : 'text-muted-foreground',
            )}
            title={
              n.operavel
                ? `Sobra prazo: mais de ${data.prazo_minimo_operavel_dias} dias de vida.`
                : `Não sobrevive à esteira: precisaria de mais de ${data.prazo_minimo_operavel_dias} dias.`
            }
          >
            {n.dias_para_vencimento === null ? 'sem prazo' : `${n.dias_para_vencimento}d`}
            {n.operavel ? ' ✓' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

export function SacadoProspeccaoCard({
  sacado,
  config,
  ehGestor,
  onDescartar,
  onSolicitarAnalise,
  onEnriquecer,
  onPedirPonte,
  onReatribuir,
}: SacadoProspeccaoCardProps) {
  const qc = useQueryClient()
  const [aberto, setAberto] = React.useState(false)
  const [expandido, setExpandido] = React.useState<string | null>(null)
  const [movendo, setMovendo] = React.useState(false)

  const quebra = useQuery({
    queryKey: prospeccaoKeys.fornecedores(sacado.id as string),
    queryFn: () => buscarQuebraFornecedores(sacado.id as string),
    enabled: aberto,
  })

  async function mover(estagio: EstagioProspeccao) {
    setMovendo(true)
    const r = await moverSacadoAction({ cnpj_sacado: sacado.cnpj_sacado, estagio })
    setMovendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Movido para "${ESTAGIO_PROSPECCAO_LABELS[estagio]}".`)
    void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
  }

  /*
   * "Falar com o fornecedor" abre o COMPOSITOR na thread do cedente, com o texto já
   * montado a partir DESTE card. O rascunho é passado por querystring porque o
   * compositor vive noutra rota (a Company 360 do fornecedor) — e é lá que estão os
   * contatos, a base legal e a janela de envio que o §6 manda respeitar.
   *
   * §6 — O TEXTO SAI PELO FORNECEDOR, e é ele que pode ver estes números: são as notas
   * dele. Nenhuma mensagem deste módulo vai à construtora, e nenhuma pode citar volume,
   * nome de cedente ou detalhe de nota se um dia for.
   */
  function linkCompositor(f: QuebraFornecedor): string {
    const texto = renderizarAbordagem(config.templates.abordagem_fornecedor, {
      sacado_nome: sacado.sacado_nome ?? formatCnpj(sacado.cnpj_sacado ?? ''),
      valor_total: formatarMoedaExata(f.valor_30d),
      fornecedor_nome: f.fornecedor_nome,
    })
    const base = f.fornecedor_empresa_id
      ? `/empresas/${f.fornecedor_empresa_id}`
      : `/antecipacao/fornecedores/${f.fornecedor_cnpj}`
    return `${base}?aba=mensagens&rascunho=${encodeURIComponent(texto)}`
  }

  const estagio = (sacado.estagio ?? 'identificado') as EstagioProspeccao
  const local = [sacado.municipio, sacado.uf].filter(Boolean).join(' / ')
  const recorrencia = sacado.meses_com_emissao_6m ?? 0
  const janelaMeses = config.janelas.janela_recorrencia_meses

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-sm">
      {/* ── Cabeçalho ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {sacado.empresa_id ? (
              <Link
                href={`/empresas/${sacado.empresa_id}`}
                className="truncate text-sm font-medium hover:underline"
              >
                {sacado.sacado_nome ?? '—'}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">{sacado.sacado_nome ?? '—'}</span>
            )}
          </div>
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {sacado.cnpj_sacado ? formatCnpj(sacado.cnpj_sacado) : '—'}
            {local ? ` · ${local}` : ''}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Ações do sacado">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Mover para</DropdownMenuLabel>
            {(['identificado', 'fornecedor_consultado', 'apresentacao_solicitada'] as const)
              .filter((e) => e !== estagio)
              .map((e) => (
                <DropdownMenuItem key={e} disabled={movendo} onSelect={() => void mover(e)}>
                  {ESTAGIO_PROSPECCAO_LABELS[e]}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSolicitarAnalise(sacado)}>
              <ShieldQuestion className="mr-2 h-3.5 w-3.5" aria-hidden />
              Solicitar análise de crédito
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEnriquecer(sacado)}>
              <Gavel className="mr-2 h-3.5 w-3.5" aria-hidden />
              Enriquecer (protesto)
            </DropdownMenuItem>
            {ehGestor && onReatribuir ? (
              <DropdownMenuItem onSelect={() => onReatribuir(sacado)}>
                <UserCheck className="mr-2 h-3.5 w-3.5" aria-hidden />
                Reatribuir originador
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onDescartar(sacado)}
            >
              Descartar / sem interesse
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Badges de qualificação ───────────────────────────────────────── */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ScoreBadge
          score={sacado.score_credito === null ? null : Number(sacado.score_credito)}
          completude={sacado.score_completude === null ? null : Number(sacado.score_completude)}
        />
        {sacado.porte_rfb ? (
          <Badge variant="outline" className="text-[11px] font-normal">
            {sacado.porte_rfb}
          </Badge>
        ) : null}
        {sacado.cnae_principal ? (
          <Badge variant="outline" className="font-mono text-[11px] font-normal">
            {sacado.cnae_principal}
          </Badge>
        ) : null}
        {sacado.analise_estagio ? (
          <Badge variant="outline" className="text-[11px] font-normal">
            Esteira: {sacado.analise_estagio}
          </Badge>
        ) : null}
      </div>

      {/* ── Os quatro números ────────────────────────────────────────────── */}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Volume {config.janelas.janela_emissao_dias}d</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(sacado.volume_30d)}</dd>
        </div>
        <div>
          <dt
            className="text-muted-foreground"
            title={
              `Só as notas com mais de ${sacado.prazo_minimo_operavel_dias ?? '—'} dias de vida — o tempo da esteira ` +
              `(${sacado.prazo_minimo_origem === 'medido' ? 'medido' : 'estimado'}) mais a margem. ` +
              'Uma nota que vence antes da análise sair não é uma nota que dá para operar.'
            }
          >
            Valor operável
          </dt>
          <dd
            className={cn(
              'font-medium tabular-nums',
              Number(sacado.valor_operavel ?? 0) > 0 ? STATUS_TEXTO.success : 'text-muted-foreground',
            )}
          >
            {formatarMoeda(sacado.valor_operavel)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Média mensal ({janelaMeses}m)</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(sacado.media_mensal_6m)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Recorrência</dt>
          <dd
            className={cn(
              'font-medium tabular-nums',
              recorrencia >= Math.ceil(janelaMeses / 2) ? '' : 'text-muted-foreground',
            )}
            title="Meses com emissão na janela de recorrência. É o que separa a anuidade do pico."
          >
            {recorrencia} de {janelaMeses} meses
          </dd>
        </div>
      </dl>

      {/* ── Valor esperado + rodapé ──────────────────────────────────────── */}
      <div className="mt-2 flex items-baseline justify-between gap-2 border-t pt-2 text-xs">
        <span
          className="text-muted-foreground"
          title="Média mensal × chance de concessão × margem. É a ordenação default: o snapshot de 30 dias premiaria o pico; isto premia o fluxo que se destrava."
        >
          Valor esperado
        </span>
        <span className="font-semibold tabular-nums">
          {formatarMoeda(sacado.valor_esperado_mensal)}/mês
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {formatarInteiro(sacado.qtd_fornecedores)} cedente
          {(sacado.qtd_fornecedores ?? 0) === 1 ? '' : 's'} ·{' '}
          {formatarInteiro(sacado.qtd_nfs_30d)} nota{(sacado.qtd_nfs_30d ?? 0) === 1 ? '' : 's'}
        </span>
        <span>Última em {formatarData(sacado.ultima_nf_em)}</span>
      </div>

      {sacado.originador_nome ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Dono: {sacado.originador_nome}</p>
      ) : (
        <p className={cn('mt-1 text-[11px]', STATUS_TEXTO.warning)}>
          Sem dono — está na fila do gestor.
        </p>
      )}

      {sacado.motivo_saida ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Saída: {sacado.motivo_saida}
          {sacado.observacao_saida ? ` — ${sacado.observacao_saida}` : ''}
        </p>
      ) : null}

      {/* ── A quebra por fornecedor ──────────────────────────────────────── */}
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 h-7 w-full justify-start px-1 text-xs"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        {aberto ? (
          <ChevronDown className="mr-1 h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronRight className="mr-1 h-3.5 w-3.5" aria-hidden />
        )}
        De onde vem o volume
      </Button>

      {aberto ? (
        <div className="space-y-2">
          {quebra.isPending ? <Skeleton className="h-16 w-full" /> : null}
          {quebra.isError ? (
            <p className="text-xs text-destructive">
              {quebra.error instanceof Error ? quebra.error.message : 'Erro ao carregar.'}
            </p>
          ) : null}
          {(quebra.data ?? []).map((f) => (
            <div key={f.id} className="rounded-md border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{f.fornecedor_nome ?? '—'}</p>
                  <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatCnpj(f.fornecedor_cnpj)}
                  </p>
                </div>
                {f.na_carteira_do_originador ? (
                  <Badge
                    variant="success"
                    className="shrink-0 text-[10px]"
                    title="Este cedente já é da sua carteira — é uma ligação para um cliente seu, não um favor pedido a um cliente de outra pessoa."
                  >
                    <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                    Sua carteira
                  </Badge>
                ) : null}
              </div>

              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {formatarMoeda(f.valor_30d)}
                </span>
                <span className="tabular-nums">
                  {formatarInteiro(f.qtd_nfs_30d)} nota{(f.qtd_nfs_30d ?? 0) === 1 ? '' : 's'}
                </span>
                <span className="tabular-nums">
                  {formatarMoeda(f.media_mensal_6m)}/mês ({f.meses_com_emissao_6m}/{janelaMeses})
                </span>
                <span>última {formatarData(f.ultima_nf_em)}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                  <Link href={linkCompositor(f)}>
                    <MessageCircle className="mr-1 h-3 w-3" aria-hidden />
                    Falar com o cedente
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onPedirPonte(sacado, f)}
                >
                  <Handshake className="mr-1 h-3 w-3" aria-hidden />
                  Pedir apresentação
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setExpandido((v) => (v === f.fornecedor_cnpj ? null : f.fornecedor_cnpj))
                  }
                  aria-expanded={expandido === f.fornecedor_cnpj}
                >
                  <ExternalLink className="mr-1 h-3 w-3" aria-hidden />
                  {expandido === f.fornecedor_cnpj ? 'Ocultar notas' : 'Ver notas'}
                </Button>
              </div>

              {expandido === f.fornecedor_cnpj ? (
                <NotasDoFornecedor
                  cnpjSacado={sacado.cnpj_sacado as string}
                  fornecedorCnpj={f.fornecedor_cnpj}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}
