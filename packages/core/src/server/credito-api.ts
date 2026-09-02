import { createHmac, timingSafeEqual } from 'node:crypto'
import { documentosFaltantes, type EventoWebhook, type PayloadCredito } from '../credito/api.js'
import type { EstagioAnalise } from '../credito/schemas.js'
import type { Supabase } from '../registry/types.js'

/**
 * SERVER ONLY. A assinatura do webhook e o construtor ÚNICO do payload.
 *
 * ── POR QUE UM CONSTRUTOR SÓ ───────────────────────────────────────────────
 * O mesmo objeto sai por dois canais: o webhook (empurrado) e o `GET
 * /analises/{id}` (puxado, para reconciliação). O 04n pede explicitamente que
 * eles nunca divirjam — e a única forma de garantir isso é não existir um segundo
 * lugar que monte. Quem mudar o contrato muda aqui, e as duas pontas mudam juntas.
 */

// ─── Assinatura ─────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 do CORPO EXATO que vai no fio, em hex.
 *
 * Assinar o objeto e serializar depois seria assinar outra coisa: quem valida do
 * outro lado trabalha sobre os BYTES que recebeu. Por isso esta função recebe a
 * string, e quem envia manda a mesma string que assinou.
 */
export function assinarWebhook(secret: string, corpo: string): string {
  return createHmac('sha256', secret).update(corpo, 'utf8').digest('hex')
}

/** Comparação em tempo constante — a mesma régua dos webhooks de entrada. */
export function assinaturaConfere(secret: string, corpo: string, recebida: string): boolean {
  const a = Buffer.from(assinarWebhook(secret, corpo), 'utf8')
  const b = Buffer.from(recebida ?? '', 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ─── Construtor do payload ──────────────────────────────────────────────────

export interface ContextoEvento {
  evento: EventoWebhook
  eventoId: string
  ocorridoEm?: Date
  /** O que só o gatilho sabia: o estágio de antes. */
  semente?: { estagio_anterior?: string | null } | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Monta o payload completo de uma análise. Toda chave existe SEMPRE — ausência
 * vira `null`, nunca campo omitido (§3.2). Um consumidor que lê
 * `payload.credito.score` não pode receber `undefined` no dia em que a empresa
 * ainda não tinha score.
 *
 * São seis leituras porque o dossiê mora em seis lugares. Juntá-las numa view
 * faria a RLS de cinco módulos ter de concordar; aqui o service role lê o que
 * precisa e o resultado sai por um canal já autenticado.
 */
export async function montarPayloadCredito(
  supabase: Supabase,
  analiseId: string,
  ctx: ContextoEvento,
): Promise<PayloadCredito | null> {
  const { data: analise } = await supabase
    .from('analises_credito')
    .select(
      'id, external_id, estagio, limite_solicitado, limite_aprovado, expira_em, motivo, decisao_interna, atualizada_em, cnpj, empresa_id, seguradora, rating_seguradora, analise_propria_id',
    )
    .eq('id', analiseId)
    .maybeSingle()
  if (!analise) return null

  const [empresaRes, universoRes, protestoRes, propriaRes, docsRes, cfgRes] = await Promise.all([
    analise.empresa_id
      ? supabase
          .from('empresas')
          .select(
            'razao_social, tipo, uf, municipio, porte, faturamento_anual, faturamento_origem, score_credito, score_faixa, score_completude, chance_concessao, limite_potencial',
          )
          .eq('id', analise.empresa_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('mercado_universo')
      .select('situacao_cadastral, razao_social, uf, municipio, porte_rfb')
      .eq('cnpj', analise.cnpj)
      .maybeSingle(),
    supabase.from('protestos_atual').select('tem_protesto').eq('cnpj', analise.cnpj).maybeSingle(),
    analise.analise_propria_id
      ? supabase
          .from('analises_proprietarias')
          .select('recomendacao, limite_recomendado, cenarios, decisao_final')
          .eq('id', analise.analise_propria_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('analise_docs').select('tipo').eq('analise_id', analiseId),
    supabase.from('credito_config').select('valor').eq('chave', 'docs').maybeSingle(),
  ])

  const e = (empresaRes.data ?? null) as Record<string, unknown> | null
  const u = (universoRes.data ?? null) as Record<string, unknown> | null
  const propria = (propriaRes.data ?? null) as Record<string, unknown> | null

  const recebidos = [...new Set((docsRes.data ?? []).map((d) => d.tipo as string))].sort()
  const tipos = ((cfgRes.data?.valor as { tipos?: { id: string; essencial?: boolean }[] } | null)
    ?.tipos ?? []) as { id: string; essencial?: boolean }[]
  const essenciais = tipos.filter((t) => t.essencial).map((t) => t.id)

  return {
    evento: ctx.evento,
    evento_id: ctx.eventoId,
    ocorrido_em: (ctx.ocorridoEm ?? new Date()).toISOString(),
    analise: {
      analise_id: analise.id,
      external_id: analise.external_id ?? null,
      estagio_anterior: (ctx.semente?.estagio_anterior ?? null) as EstagioAnalise | null,
      estagio_atual: analise.estagio as EstagioAnalise,
      limite_solicitado: num(analise.limite_solicitado),
      limite_aprovado: num(analise.limite_aprovado),
      validade: analise.expira_em ?? null,
      motivo: analise.motivo ?? null,
      // A decisão do 04j ganha da anotada na esteira: é a mais específica das duas,
      // e um contrato com dois campos para a mesma pergunta convida a discordarem.
      decisao_final: ((propria?.decisao_final as string | null) ?? analise.decisao_interna) ?? null,
      atualizada_em: analise.atualizada_em ?? null,
    },
    empresa: {
      cnpj: analise.cnpj,
      razao_social: (e?.razao_social as string | null) ?? (u?.razao_social as string | null) ?? null,
      tipo: (e?.tipo as string | null) ?? null,
      uf: (e?.uf as string | null) ?? (u?.uf as string | null) ?? null,
      municipio: (e?.municipio as string | null) ?? (u?.municipio as string | null) ?? null,
      situacao_cadastral: (u?.situacao_cadastral as string | null) ?? null,
      porte: (e?.porte as string | null) ?? (u?.porte_rfb as string | null) ?? null,
      faturamento_estimado: num(e?.faturamento_anual),
      faturamento_origem: (e?.faturamento_origem as string | null) ?? null,
    },
    credito: {
      score: num(e?.score_credito),
      faixa: (e?.score_faixa as string | null) ?? null,
      completude: num(e?.score_completude),
      chance_concessao: num(e?.chance_concessao),
      limite_potencial: num(e?.limite_potencial),
      tem_protesto: (protestoRes.data?.tem_protesto as boolean | undefined) ?? null,
      analise_proprietaria: propria
        ? {
            recomendacao: (propria.recomendacao as string | null) ?? null,
            limite_recomendado: num(propria.limite_recomendado),
            cenarios: (propria.cenarios as Record<string, number> | null) ?? null,
          }
        : null,
      seguradora: {
        nome: analise.seguradora ?? null,
        status: analise.rating_seguradora ?? null,
        limite: num(analise.limite_aprovado),
        expira_em: analise.expira_em ?? null,
      },
    },
    documentos: { recebidos, faltantes: documentosFaltantes(recebidos, essenciais) },
  }
}
