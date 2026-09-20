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
  CardDoFunil,
  ChipDoCard,
  DonoNoRodape,
  TiraDoCard,
  type TomDoScore,
} from '@/components/comercial/card-funil'
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
 * A faixa do score, para a barra e a cor do canto superior direito.
 *
 * Os mesmos cortes do scorecard (04c): é o número que decide se vale o tempo, e
 * dois funis com réguas diferentes para o mesmo score ensinariam que a cor não
 * quer dizer nada.
 */
function faixaDoScore(score: number): string {
  if (score >= 70) return 'alta'
  if (score >= 50) return 'boa'
  if (score >= 30) return 'media'
  return 'baixa'
}

/*
 * O tom é declarado aqui e não herdado do mapa geral do card, pelo mesmo motivo
 * que o funil de NFs declara o dele: o mapa compartilhado só conhece três faixas,
 * e as que faltassem cairiam em cinza — "não sei" pintado por cima de um score
 * que é conhecido. Aqui `alta` é VERDE (é score de crédito), enquanto na NF a
 * faixa alta é âmbar.
 */
const TOM_DO_SCORE: Record<string, TomDoScore> = {
  alta: 'bom',
  boa: 'bom',
  media: 'alerta',
  baixa: 'ruim',
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
  const fragil = Number(sacado.score_completude ?? 0) < 0.5

  const menu = (
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
  )

  /*
   * A TIRA: UM fato que muda a decisão, no lugar onde os outros funis já o
   * colocam — o último elemento lido, o que faz o olho voltar ao card.
   *
   * Aqui esse fato é o DESFECHO DA ANÁLISE. `analise_limite_aprovado` já vinha na
   * consulta do card desde que o funil nasceu e não era desenhado em lugar
   * nenhum: o card dizia "Esteira: aprovada" e obrigava a abrir a ficha para
   * descobrir de quanto foi o limite — que é a única coisa que se quer saber.
   *
   * A taxa NÃO entra aqui porque ela não existe na análise: a decisão interna
   * aprova um limite, e o preço nasce depois, na condição comercial publicada
   * pelo Crédito. Citar uma taxa que ainda não foi publicada seria inventar
   * condição.
   */
  const tira = (() => {
    const limite = Number(sacado.analise_limite_aprovado ?? 0)
    if (estagio === 'aprovado' || (sacado.analise_estagio ?? '') === 'aprovada') {
      return (
        <TiraDoCard tom="bom">
          {limite > 0
            ? `Aprovado — limite de ${formatarMoedaExata(limite)}`
            : 'Aprovado na esteira'}
          {sacado.analise_decidida_em ? ` · ${formatarData(sacado.analise_decidida_em)}` : ''}
        </TiraDoCard>
      )
    }
    if (estagio === 'recusado' || (sacado.analise_estagio ?? '') === 'recusada') {
      return (
        <TiraDoCard tom="ruim">
          Recusado na esteira
          {sacado.motivo_saida ? ` — ${sacado.motivo_saida}` : ''}
        </TiraDoCard>
      )
    }
    /*
     * O ATALHO, e não só um aviso: no estágio em que a próxima coisa a fazer é
     * pedir a análise, o botão que pede fica na tira em vez de escondido atrás
     * do menu de três pontos. É o mesmo princípio do menu no card — quem varre
     * a coluna já sabe o que fazer, e o atrito não protege ninguém aqui.
     */
    if (estagio === 'apresentacao_solicitada' && !sacado.analise_credito_id) {
      return (
        <TiraDoCard tom="alerta">
          <span className="relative z-10 flex items-center justify-between gap-2">
            <span>Sem análise de crédito — é o próximo passo.</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 text-[11px]"
              onClick={(e) => {
                e.stopPropagation()
                onSolicitarAnalise(sacado)
              }}
            >
              Solicitar
            </Button>
          </span>
        </TiraDoCard>
      )
    }
    if (estagio === 'analise_solicitada' || estagio === 'em_analise') {
      return (
        <TiraDoCard tom="neutro">
          Na esteira desde {formatarData(sacado.estagio_alterado_em)} — a decisão move o card
          sozinha.
        </TiraDoCard>
      )
    }
    return undefined
  })()

  return (
    <CardDoFunil
      rotuloAbrir={`Abrir ${sacado.sacado_nome ?? sacado.cnpj_sacado ?? 'o sacado'}`}
      onAbrir={() => setAberto((v) => !v)}
      esmaecido={estagio === 'descartado' || estagio === 'sem_interesse'}
      titulo={
        /* Clicar no NOME vai para a ficha; o resto do card abre a quebra.
           `z-10` para ficar acima do botão que cobre o card. */
        sacado.empresa_id ? (
          <Link
            href={`/empresas/${sacado.empresa_id}`}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 hover:underline"
          >
            {sacado.sacado_nome ?? '—'}
          </Link>
        ) : (
          (sacado.sacado_nome ?? '—')
        )
      }
      valor={
        <span className="flex flex-col gap-0.5">
          {/*
           * O VALOR ESPERADO é o número grande, e não o volume de 30 dias.
           *
           * É ele que ordena a coluna (média mensal × chance de concessão ×
           * margem), então é o número pelo qual a pessoa está comparando dois
           * cards de relance. O volume de 30 dias é um retrato que premia o pico
           * de uma obra que acabou.
           */}
          <span className="text-[15px] font-bold leading-none tracking-[-0.02em]">
            {formatarMoeda(sacado.valor_esperado_mensal)}
            <span className="text-[11px] font-normal text-muted-foreground">/mês</span>
          </span>
          {/*
           * O OPERÁVEL debaixo, menor — o mesmo lugar que o líquido ocupa no card
           * de NF, e pelo mesmo motivo: é o que se lê depois de ter parado no
           * card. De R$ 60,1 milhões emitidos em 30 dias, só R$ 436 mil passam de
           * 55 dias de vida; sem este número o originador trabalha um card de R$
           * 900 mil por duas semanas e descobre no fim que não sobrou nota.
           */}
          <span className="text-[11px] font-normal text-muted-foreground">
            operável{' '}
            <span
              className={cn(
                'font-semibold',
                Number(sacado.valor_operavel ?? 0) > 0 ? STATUS_TEXTO.success : 'text-foreground/80',
              )}
            >
              {formatarMoeda(sacado.valor_operavel)}
            </span>
          </span>
        </span>
      }
      /*
       * O bloco da direita é o SCORE, na mesma geometria dos outros funis: quem
       * varre os quatro no mesmo dia já sabe que o canto superior direito responde
       * "vale meu tempo?".
       *
       * `tom` warning quando a completude não sustenta o número: 72 sobre meia
       * ficha é uma aposta com cara de medição, e a régua é a do scorecard.
       */
      score={
        sacado.score_credito === null
          ? { valor: null, faixa: 'sem', rotulo: 'sem score' }
          : {
              valor: Number(sacado.score_credito),
              faixa: faixaDoScore(Number(sacado.score_credito)),
              tom: fragil
                ? 'alerta'
                : (TOM_DO_SCORE[faixaDoScore(Number(sacado.score_credito))] ?? 'neutro'),
              rotulo: fragil ? 'score frágil' : 'score',
            }
      }
      chips={
        <>
          <ChipDoCard className="font-mono tabular-nums">
            {sacado.cnpj_sacado ? formatCnpj(sacado.cnpj_sacado) : '—'}
          </ChipDoCard>
          {local ? <ChipDoCard>{local}</ChipDoCard> : null}
          {sacado.porte_rfb ? <ChipDoCard>{sacado.porte_rfb}</ChipDoCard> : null}
          {sacado.cnae_principal ? (
            <ChipDoCard className="font-mono">{sacado.cnae_principal}</ChipDoCard>
          ) : null}
          {sacado.analise_estagio ? (
            <ChipDoCard tom="info" forte>
              Esteira: {sacado.analise_estagio}
            </ChipDoCard>
          ) : null}
        </>
      }
      rodapeEsquerda={
        // `z-10` e `stopPropagation`: é interativo e precisa ficar acima do botão
        // que abre o card, senão trocar de dono viraria abrir a quebra.
        <span className="relative z-10 block" onClick={(e) => e.stopPropagation()}>
          {sacado.originador_nome ? (
            <DonoNoRodape nome={sacado.originador_nome} />
          ) : (
            <span className={cn('text-[11.5px]', STATUS_TEXTO.warning)}>
              Sem dono — fila do gestor
            </span>
          )}
        </span>
      }
      rodapeDireita={
        <span className="flex items-center gap-1.5">
          <span>
            {formatarInteiro(sacado.qtd_fornecedores)} cedente
            {(sacado.qtd_fornecedores ?? 0) === 1 ? '' : 's'} ·{' '}
            {formatarInteiro(sacado.qtd_nfs_30d)} nota{(sacado.qtd_nfs_30d ?? 0) === 1 ? '' : 's'}
          </span>
          {/*
            O menu no CARD, além do modal — o mesmo desenho do funil de NFs. Quem
            varre uma coluna de trinta sacados já sabe o que fazer com a maioria
            deles, e obrigar a abrir cada um para mover uma etapa é atrito sem
            proteção.
          */}
          <span className="relative z-10" onClick={(e) => e.stopPropagation()}>
            {menu}
          </span>
        </span>
      }
      tira={tira}
    >
      {/* ── Os quatro números ────────────────────────────────────────────── */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Volume {config.janelas.janela_emissao_dias}d</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(sacado.volume_30d)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Média mensal ({janelaMeses}m)</dt>
          <dd className="font-medium tabular-nums">{formatarMoeda(sacado.media_mensal_6m)}</dd>
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
            Prazo mínimo
          </dt>
          <dd className="font-medium tabular-nums">
            {sacado.prazo_minimo_operavel_dias ?? '—'} dias
          </dd>
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

      {sacado.motivo_saida ? (
        <p className="text-[11px] text-muted-foreground">
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
    </CardDoFunil>
  )
}
