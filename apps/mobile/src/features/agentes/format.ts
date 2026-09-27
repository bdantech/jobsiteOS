import {
  ESTADO_AGENTE_AO_VIVO_LABELS,
  ESTADO_MANDATO_LABELS,
  FERRAMENTAS,
  MOTIVO_ENCERRAMENTO_LABELS,
  TIPO_MANDATO_LABELS,
  TIPO_VENDEDOR_LABELS,
  type EstadoAgenteAoVivo,
  type EstadoMandato,
  type IdFerramenta,
  type MotivoEncerramento,
  type TipoMandato,
  type TipoVendedorId,
} from '@jobsiteos/core'

import type { BadgeVariant } from '@/components/ui/badge'

/** As formatações dos Agentes no celular. Os rótulos vêm do core — os mesmos da web e da barra de IA. */

/** O dinheiro dos agentes é em CENTAVOS (orçamento, gasto, custo de ação). Centavos aparecem: uma ação custa R$ 0,02. */
export function brlCentavos(c: number | null | undefined): string {
  if (c === null || c === undefined || !Number.isFinite(Number(c))) return '—'
  return (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function desde(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 7) return `${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * A próxima ação do mandato, contada a partir de agora. No passado ela diz "atrasada":
 * é o ciclo que ainda não pegou o mandato — e isso, num agente que devia estar operando,
 * é o que se quer ver primeiro.
 */
export function proximaAcaoTexto(iso: string | null | undefined): string {
  if (!iso) return 'sem ação agendada'
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return '—'
  if (ms < -5 * 60_000) return `atrasada · ${dataHora(iso)}`
  if (ms <= 60_000) return 'agora'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `em ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `em ${h} h`
  return dataHora(iso)
}

/**
 * O `quando` de uma próxima ação do plano é texto do MODELO: às vezes um ISO, às vezes
 * "depois que ele responder". Data válida vira data legível; o resto passa como veio.
 */
export function quandoDoPlano(quando: string): string {
  const d = new Date(quando)
  return /^\d{4}-\d{2}-\d{2}/.test(quando) && !Number.isNaN(d.getTime()) ? dataHora(quando) : quando
}

export function tipoMandatoLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return TIPO_MANDATO_LABELS[t as TipoMandato] ?? t
}

export function estadoMandatoLabel(e: string | null | undefined): string {
  if (!e) return '—'
  return ESTADO_MANDATO_LABELS[e as EstadoMandato] ?? e
}

export function motivoEncerramentoLabel(m: string | null | undefined): string | null {
  if (!m) return null
  return MOTIVO_ENCERRAMENTO_LABELS[m as MotivoEncerramento] ?? m
}

/** O badge do estado do mandato: verde quando atingiu, vermelho quando voltou para um humano. */
export function varianteEstadoMandato(e: string | null | undefined): BadgeVariant {
  if (e === 'concluido') return 'success'
  if (e === 'escalado') return 'destructive'
  if (e === 'encerrado_sem_sucesso' || e === 'pausado') return 'outline'
  return 'secondary'
}

export const MOTIVO_PAUSA_LABELS: Record<string, string> = {
  orcamento_esgotado: 'orçamento esgotado',
  disjuntor_aberto: 'disjuntor do agente aberto',
  agente_pausado: 'agente pausado',
  manual: 'pausado por uma pessoa',
}

export function tipoAgenteLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return TIPO_VENDEDOR_LABELS[t as TipoVendedorId] ?? t
}

export function estadoAgenteLabel(e: EstadoAgenteAoVivo): string {
  return ESTADO_AGENTE_AO_VIVO_LABELS[e]
}

export function varianteEstadoAgente(e: EstadoAgenteAoVivo): BadgeVariant {
  if (e === 'operando') return 'success'
  if (e === 'disjuntor_aberto') return 'destructive'
  if (e === 'ocioso') return 'secondary'
  return 'outline'
}

/**
 * O rótulo da linha do feed. `desfecho_ligacao` não é ferramenta do agente — é a linha
 * que o sistema grava quando a Ana devolve o resultado —, e por isso não está em
 * FERRAMENTAS. Ferramenta que o core ainda não conhece aparece pelo id, não some.
 */
export function ferramentaLabel(f: string): string {
  if (f === 'desfecho_ligacao') return 'Resultado de ligação'
  return FERRAMENTAS[f as IdFerramenta]?.rotulo ?? f
}

/** O nome que o cliente ouve (a persona), com o cadastro como reserva. */
export function nomeDoAgente(agente: { nome: string; persona: unknown } | null | undefined): string {
  if (!agente) return '—'
  const persona = agente.persona as { nome_exibicao?: string } | null
  return persona?.nome_exibicao?.trim() || agente.nome
}

// ─── Ligações (voz_ligacoes) ────────────────────────────────────────────────
// Os mesmos rótulos de components/comunicacao/voz-ligacoes.tsx da web: são os status
// da TABELA (a fila nossa), não os da API da Ana em voz/schemas.ts.

export const STATUS_LIGACAO_LABELS: Record<string, string> = {
  a_enviar: 'Na fila',
  enviada: 'Com a Ana',
  concluida: 'Conversou',
  nao_atendida: 'Não atendeu',
  falhou: 'Falhou',
  cancelada: 'Cancelada',
  recusada: 'Não vai ligar',
}

export function varianteStatusLigacao(s: string): BadgeVariant {
  if (s === 'concluida') return 'success'
  if (s === 'falhou') return 'destructive'
  if (s === 'a_enviar' || s === 'enviada') return 'secondary'
  return 'outline'
}

export const DESFECHO_LIGACAO_LABELS: Record<string, string> = {
  antecipacao_solicitada: 'Antecipação solicitada',
  cadastro_iniciado: 'Cadastro iniciado',
  proposta_enviada: 'Proposta enviada',
  interesse_futuro: 'Interesse futuro',
  retorno_agendado: 'Retorno agendado',
  agendado_com_decisor: 'Agendado com quem decide',
  quer_negociar: 'Quer negociar',
  transferido_humano: 'Transferido',
  pediu_para_nao_contatar: 'Pediu para não contatar',
  recusa: 'Recusou',
  objecao_taxa: 'Objeção à taxa',
  nao_tem_interesse: 'Sem interesse',
  pessoa_errada: 'Pessoa errada',
  caixa_postal: 'Caixa postal',
  nao_atendeu: 'Não atendeu',
  indefinido: 'Indefinido',
  agendar_retorno: 'Pediu retorno',
  indicou_outro_contato: 'Indicou outro contato',
  reuniao_agendada: 'Reunião marcada',
  interesse: 'Interesse',
  nao_e_o_decisor: 'Não é quem decide',
  desconhecido: 'Desfecho novo (ver na web)',
}

export function duracaoTexto(s: number | null | undefined): string | null {
  if (!s) return null
  const min = Math.floor(s / 60)
  const seg = s % 60
  return min > 0 ? `${min} min ${String(seg).padStart(2, '0')} s` : `${seg} s`
}
