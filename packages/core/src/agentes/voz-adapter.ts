import { normalizarTelefoneBr } from '../fornecedores/telefone.js'
import type { PedidoLigacao } from '../voz/schemas.js'
import type { PoliticaIdentificacao } from './identificacao.js'
import { OBJETIVOS_LIGACAO, type ObjetivoLigacao, type VersaoVoz } from './schemas.js'

/**
 * O ADAPTER DE VOZ (Prompt 09 §4.3): a ferramenta `ligar` do agente fala em OBJETIVO, e
 * a Ana fala em contrato.
 *
 * ─── NÃO SIMULAR CAPACIDADE QUE NÃO EXISTE ──────────────────────────────────
 * A v1 da Ana só sabe uma coisa: ofertar a antecipação de uma NF, com os números da
 * oferta. Enquanto ela não responder v2, qualquer outro objetivo (agendar reunião,
 * qualificar, reativar) é RECUSADO com um erro que o agente lê e contorna por outro
 * canal — nunca traduzido para uma oferta de NF "parecida". Uma ligação que o cliente não
 * esperava, sobre um assunto que o agente não pediu, é pior que nenhuma.
 *
 * O contrato v2 está sendo fechado com o time da Ana em paralelo. O que está aqui é o
 * lado do JobsiteOS: o payload que mandaremos (`versao: '2'`, objetivo, contexto,
 * janelas) e o que esperamos de volta (`desfecho` estruturado). Quando o documento
 * companheiro fechar, só este arquivo muda.
 */

export interface ContatoParaLigacao {
  id: string | null
  nome: string
  cargo?: string | null
  telefone_e164: string
  email?: string | null
}

export interface JanelaOferecida {
  /** Id da reserva temporária (`agenda_reservas.id`). É o que a Ana devolve ao confirmar. */
  id: string
  inicio: string
  fim: string
  /** Até quando a reserva segura o horário. Depois disso a Ana não pode mais oferecê-lo. */
  expira_em?: string
}

export interface ContextoLigacao {
  id_externo: string
  objetivo: ObjetivoLigacao
  contato: ContatoParaLigacao
  empresa: { razao_social: string; cnpj: string | null }
  persona: { nome: string; voz_conta_id: string | null }
  /** Por que o agente está ligando, em português — vai como briefing para a Ana. */
  motivo: string
  /** Só em `ofertar_antecipacao`: o pedido v1 já montado e validado pelo portão de conteúdo. */
  pedido_v1?: PedidoLigacao | null
  /** Só em `agendar_reuniao`: um conjunto FECHADO. A Ana confirma uma ou devolve `agendar_retorno`. */
  janelas?: JanelaOferecida[]
  /**
   * A política de identificação vigente (09 §10). Vai no pedido porque vale em todos os
   * canais, voz inclusive, e muda por config sem deploy. Pedidos enfileirados antes de ela
   * existir não a têm: a Ana segue o padrão dela, que é o mesmo `se_perguntada`.
   */
  identificacao?: PoliticaIdentificacao
}

export type Traducao =
  | { ok: true; versao: 'v1' | 'v2'; payload: Record<string, unknown> }
  | { ok: false; codigo: 'objetivo_nao_suportado' | 'falta_pedido' | 'falta_janelas'; erro: string }

/**
 * `objetivos` é a lista que a v2 anuncia em `GET /api/versao`. A Ana pode liberar os
 * objetivos um de cada vez: com a lista, só mandamos os que estão nela; sem a lista
 * (`null`), uma v2 aceita os quatro.
 */
export function traduzirPedido(
  versao: VersaoVoz,
  ctx: ContextoLigacao,
  objetivos: readonly ObjetivoLigacao[] | null = null,
): Traducao {
  if (versao !== 'v2') {
    if (ctx.objetivo !== 'ofertar_antecipacao') {
      return {
        ok: false,
        codigo: 'objetivo_nao_suportado',
        erro:
          `A Ana (v1) só liga para ofertar a antecipação de uma NF. O objetivo "${ctx.objetivo}" não é ` +
          'suportado por telefone ainda — use WhatsApp ou e-mail para isso.',
      }
    }
    if (!ctx.pedido_v1) {
      return {
        ok: false,
        codigo: 'falta_pedido',
        erro: 'Ofertar antecipação exige uma NF do mandato com oferta calculável (taxa, TAC e líquido).',
      }
    }
    return { ok: true, versao: 'v1', payload: { ...ctx.pedido_v1, id_externo: ctx.id_externo, telefone: ctx.contato.telefone_e164 } }
  }

  if (objetivos && !objetivos.includes(ctx.objetivo)) {
    return {
      ok: false,
      codigo: 'objetivo_nao_suportado',
      erro:
        `A Ana (v2) ainda não liberou o objetivo "${ctx.objetivo}" por telefone. ` +
        'Use WhatsApp ou e-mail para isso por enquanto.',
    }
  }
  if (ctx.objetivo === 'ofertar_antecipacao' && !ctx.pedido_v1) {
    return {
      ok: false,
      codigo: 'falta_pedido',
      erro: 'Ofertar antecipação exige uma NF do mandato com oferta calculável (taxa, TAC e líquido).',
    }
  }
  if (ctx.objetivo === 'agendar_reuniao' && !(ctx.janelas && ctx.janelas.length > 0)) {
    return {
      ok: false,
      codigo: 'falta_janelas',
      erro: 'Agendar reunião por telefone exige janelas do closer: consulte a agenda antes de ligar.',
    }
  }

  return {
    ok: true,
    versao: 'v2',
    payload: {
      versao: '2',
      id_externo: ctx.id_externo,
      telefone: ctx.contato.telefone_e164,
      objetivo: ctx.objetivo,
      persona: ctx.persona,
      contato: {
        nome: ctx.contato.nome,
        cargo: ctx.contato.cargo ?? null,
        email: ctx.contato.email ?? null,
      },
      empresa: ctx.empresa,
      briefing: ctx.motivo,
      identificacao: ctx.identificacao ?? 'se_perguntada',
      ...(ctx.pedido_v1 ? { oferta: ctx.pedido_v1.oferta } : {}),
      ...(ctx.janelas?.length ? { janelas: ctx.janelas } : {}),
    },
  }
}

// ─── O que volta ────────────────────────────────────────────────────────────

/** Um contato que a ligação revelou (indicado, ou quem vai retornar). */
export interface ContatoRevelado {
  nome: string
  cargo: string | null
  telefone_e164: string | null
  email: string | null
}

export type DesfechoEstruturado =
  | { tipo: 'agendar_retorno'; quando: string | null; contato: ContatoRevelado | null; observacao: string | null }
  | { tipo: 'indicou_outro_contato'; contato: ContatoRevelado; observacao: string | null }
  | { tipo: 'reuniao_agendada'; janela_id: string | null; inicio: string | null; observacao: string | null }
  | {
      tipo: 'qualificacao'
      fit: TalvezSimNao | null
      decisor: ContatoRevelado | null
      volume_mensal_brl: number | null
      sacados: string[]
      observacao: string | null
    }
  | { tipo: 'reativacao'; motivo_saida: string | null; quer_voltar: TalvezSimNao | null; observacao: string | null }
  | { tipo: 'nenhum' }

export type TalvezSimNao = 'sim' | 'nao' | 'talvez'

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const talvezSimNao = (v: unknown): TalvezSimNao | null => {
  const t = texto(v)?.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  return t === 'sim' || t === 'nao' || t === 'talvez' ? t : null
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function contatoDe(bruto: unknown): ContatoRevelado | null {
  if (!bruto || typeof bruto !== 'object') return null
  const o = bruto as Record<string, unknown>
  const nome = texto(o.nome) ?? texto(o.name)
  const tel = normalizarTelefoneBr(texto(o.telefone) ?? texto(o.telefone_e164) ?? texto(o.phone))
  const email = texto(o.email)
  if (!nome) return null
  const telefone = tel.valido ? tel.e164 : null
  if (!telefone && !email) return null
  return { nome, cargo: texto(o.cargo) ?? texto(o.title), telefone_e164: telefone, email }
}

/**
 * Lê o desfecho estruturado do webhook — v2 (`desfecho: {tipo, …}`) e, na falta dele, o
 * que a v1 já manda de útil (`outcome` + `chamada.decisor` + `chamada.proximo_passo`).
 *
 * É o que destrava o comportamento que o módulo existe para ter: "não era o decisor, ele
 * indicou o Carlos" vira contato novo e próxima ação, em vez de um resumo que ninguém lê.
 */
export function desfechoEstruturado(corpo: unknown): DesfechoEstruturado {
  if (!corpo || typeof corpo !== 'object') return { tipo: 'nenhum' }
  const p = corpo as Record<string, unknown>
  const chamada = (p.chamada && typeof p.chamada === 'object' ? p.chamada : {}) as Record<string, unknown>
  const d = (p.desfecho && typeof p.desfecho === 'object' ? p.desfecho : chamada.desfecho) as
    | Record<string, unknown>
    | undefined
  const outcome = texto(p.outcome)
  const observacao = texto(d?.observacao) ?? texto(chamada.proximo_passo) ?? texto(chamada.resumo)

  const tipo = texto(d?.tipo) ?? outcome
  switch (tipo) {
    case 'agendar_retorno':
    case 'retorno_agendado':
    case 'agendado_com_decisor': {
      const contato = contatoDe(d?.contato) ?? contatoDe(chamada.decisor)
      return { tipo: 'agendar_retorno', quando: texto(d?.quando) ?? texto(chamada.retorno_em), contato, observacao }
    }
    case 'indicou_outro_contato':
    case 'nao_e_o_decisor':
    case 'pessoa_errada': {
      const contato = contatoDe(d?.contato) ?? contatoDe(chamada.decisor)
      if (!contato) return { tipo: 'nenhum' }
      return { tipo: 'indicou_outro_contato', contato, observacao }
    }
    case 'reuniao_agendada':
      return {
        tipo: 'reuniao_agendada',
        janela_id: texto(d?.janela_id),
        inicio: texto(d?.inicio) ?? texto(d?.quando),
        observacao,
      }
    case 'qualificacao': {
      const sacados: unknown = d?.sacados
      return {
        tipo: 'qualificacao',
        fit: talvezSimNao(d?.fit),
        decisor: contatoDe(d?.decisor),
        volume_mensal_brl: numero(d?.volume_mensal_brl),
        sacados: Array.isArray(sacados) ? sacados.map(texto).filter((s): s is string => !!s) : [],
        observacao,
      }
    }
    case 'reativacao':
      return {
        tipo: 'reativacao',
        motivo_saida: texto(d?.motivo_saida),
        quer_voltar: talvezSimNao(d?.quer_voltar),
        observacao,
      }
    default:
      return { tipo: 'nenhum' }
  }
}

/** O que `GET /api/versao` diz: a versão e, na v2, quais objetivos ela já aceita. */
export interface StatusVoz {
  versao: VersaoVoz
  objetivos: ObjetivoLigacao[] | null
}

/**
 * A lista `objetivos` só vale na v2 e só com nomes que conhecemos; lista ausente ou vazia
 * vira `null` (sem restrição além da versão). Um nome desconhecido é ignorado, não erro:
 * a Ana pode anunciar um objetivo que o JobsiteOS ainda não pede.
 */
export function statusDaResposta(status: number, corpo: unknown): StatusVoz {
  const versao = versaoDaResposta(status, corpo)
  if (versao !== 'v2') return { versao, objetivos: null }
  const bruto = corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>).objetivos : null
  if (!Array.isArray(bruto)) return { versao, objetivos: null }
  const conhecidos = bruto.filter((o): o is ObjetivoLigacao =>
    (OBJETIVOS_LIGACAO as readonly string[]).includes(String(o)),
  )
  return { versao, objetivos: conhecidos.length ? conhecidos : null }
}

/** Resposta de `GET /api/versao`. Qualquer coisa fora de `2` é tratada como v1. */
export function versaoDaResposta(status: number, corpo: unknown): VersaoVoz {
  if (status === 404 || status === 405) return 'v1'
  if (status >= 400) return 'desconhecida'
  const v = corpo && typeof corpo === 'object' ? String((corpo as Record<string, unknown>).versao ?? '') : ''
  return v.startsWith('2') ? 'v2' : 'v1'
}
