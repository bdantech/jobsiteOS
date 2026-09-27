import {
  ESTADO_MANDATO_LABELS,
  FERRAMENTAS,
  MOTIVO_ENCERRAMENTO_LABELS,
  TIPO_MANDATO_LABELS,
  type EstadoMandato,
  type MotivoEncerramento,
  type TipoMandato,
} from '@jobsiteos/core'

/**
 * Formatação das telas de operação dos Agentes (Ao vivo, Mandatos, modal do mandato).
 *
 * Dinheiro é SEMPRE centavos inteiros no banco — orçamento, gasto, custo de ação, teto do
 * mês. A conversão acontece só aqui, na hora de mostrar: uma divisão por 100 espalhada
 * pelos componentes é o caminho mais curto para um "R$ 1.500,00" que era R$ 15.
 *
 * Datas no fuso de São Paulo, explícito: o monitor que fica aberto no escritório e o
 * notebook de quem viaja têm de dizer a mesma hora para a mesma ação.
 */

const FUSO = 'America/Sao_Paulo'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function reais(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return '—'
  return BRL.format(centavos / 100)
}

/** "15,00" → 1500. Aceita vírgula ou ponto decimal e separador de milhar com ponto. */
export function centavosDoTexto(texto: string): number | null {
  const limpo = texto.trim().replace(/\s|R\$/g, '')
  if (!limpo) return null
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** 1500 → "15,00", para preencher um campo de reais. */
export function textoDosCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

export function hora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' })
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function data(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "agora", "há 3 min", "há 2 h", depois a data. O feed ao vivo lê distância, não relógio. */
export function desde(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return dataHora(iso)
}

/** "em 25 min", "em 1 h 10", "atrasada 5 min" — a linha do tempo das próximas 2 horas. */
export function daqui(iso: string | null | undefined): string {
  if (!iso) return '—'
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (min < -1) return `atrasada ${-min} min`
  if (min <= 1) return 'agora'
  if (min < 60) return `em ${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto ? `em ${h} h ${String(resto).padStart(2, '0')}` : `em ${h} h`
}

/**
 * A meia-noite de HOJE em São Paulo, como ISO UTC — o corte do "consumo do dia", das
 * cotas e das reuniões marcadas hoje. É o mesmo corte do worker (`inicioDoDiaSp` em
 * `apps/worker/src/agentes/contexto.ts`); se os dois divergissem, a barra de cota da tela
 * diria "sobram 3" enquanto o agente já se considera no teto.
 */
export function inicioDoDiaSp(agora: Date = new Date()): string {
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: FUSO })
  return new Date(`${hoje}T00:00:00-03:00`).toISOString()
}

/** O primeiro dia do mês corrente em São Paulo, no formato de `agentes_orcamento.mes`. */
export function mesCorrenteSp(agora: Date = new Date()): string {
  const hoje = agora.toLocaleDateString('en-CA', { timeZone: FUSO })
  return `${hoje.slice(0, 7)}-01`
}

// ─── Rótulos ────────────────────────────────────────────────────────────────

export function tipoLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return TIPO_MANDATO_LABELS[t as TipoMandato] ?? t
}

export function estadoLabel(e: string | null | undefined): string {
  if (!e) return '—'
  return ESTADO_MANDATO_LABELS[e as EstadoMandato] ?? e
}

export function motivoLabel(m: string | null | undefined): string | null {
  if (!m) return null
  return MOTIVO_ENCERRAMENTO_LABELS[m as MotivoEncerramento] ?? m
}

/**
 * Linhas que o sistema grava em `mandato_acoes` sem serem ferramentas do catálogo: o
 * custo do ciclo de decisão e o desfecho de ligação que a Ana devolve. Elas aparecem no
 * feed e na linha do tempo, e sem rótulo sairiam como o identificador cru.
 */
const FERRAMENTAS_DO_SISTEMA: Record<string, string> = {
  ciclo: 'Ciclo de decisão',
  desfecho_ligacao: 'Resultado de ligação',
}

export function ferramentaLabel(f: string): string {
  return FERRAMENTAS_DO_SISTEMA[f] ?? (FERRAMENTAS as Record<string, { rotulo: string }>)[f]?.rotulo ?? f
}

/** Ações previstas no plano (`proximas_acoes[].acao`), que o modelo escreve livremente. */
const ACAO_PLANO_LABELS: Record<string, string> = {
  ligar: 'Ligar',
  enviar_whatsapp: 'WhatsApp',
  enviar_email: 'E-mail',
  enviar_material: 'Enviar material',
  agendar_reuniao: 'Marcar reunião',
  agendar_ligacao: 'Agendar ligação',
  buscar_contatos_apollo: 'Buscar contatos',
  enriquecer_telefone: 'Enriquecer telefone',
  consultar_agenda_closer: 'Ver agenda do closer',
  aguardar: 'Aguardar retorno',
}

export function acaoPlanoLabel(a: string): string {
  return ACAO_PLANO_LABELS[a] ?? ferramentaLabel(a)
}

export const STATUS_LIGACAO_LABELS: Record<string, string> = {
  a_enviar: 'Na fila',
  enviada: 'Com a Ana',
  concluida: 'Conversou',
  nao_atendida: 'Não atendeu',
  falhou: 'Falhou',
  cancelada: 'Cancelada',
  recusada: 'Não vai ligar',
}

export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  return (partes[0]![0]! + (partes.length > 1 ? partes[partes.length - 1]![0]! : '')).toUpperCase()
}

/** Proporção 0–100 com teto, para barras. Denominador zero é "sem teto": barra vazia. */
export function pct(usado: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((usado / total) * 100)))
}
