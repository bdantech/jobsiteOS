import { statusDaResposta, type StatusVoz } from '../../../../packages/core/src/agentes/voz-adapter.js'
import type { RespostaEnfileiramento } from '../../../../packages/core/src/voz/schemas.js'
import { respostaEnfileiramentoSchema } from '../../../../packages/core/src/voz/schemas.js'
import { env } from '../env.js'
import { HttpError, requisitarJson } from '../net/http.js'

/**
 * O cliente da Ana — o serviço de voz da OnePay.
 *
 * Ela tem fila própria: a gente manda o pedido e ela liga quando for a vez, em
 * horário comercial, uma por vez. Por isso aqui não existe "ligar agora": existe
 * enfileirar, e o resultado volta por webhook minutos depois.
 *
 * Credencial de SAÍDA (`VOZ_API_TOKEN`) é outra coisa que o segredo de ENTRADA
 * do webhook (`VOZ_WEBHOOK_SECRET`), e as duas nunca se misturam — mesma regra
 * do Escavador e do Apollo.
 */

export interface VozConfigurada {
  url: string
  token: string
}

/** `null` quando a integração não está configurada: o job pula em vez de quebrar. */
export function configDaVoz(): VozConfigurada | null {
  const url = env.VOZ_API_URL?.replace(/\/$/, '')
  const token = env.VOZ_API_TOKEN
  if (!url || !token) return null
  return { url, token }
}

export type EnvioLigacao =
  | { ok: true; resposta: RespostaEnfileiramento }
  | { ok: false; erro: string; retryavel: boolean }

/**
 * `POST /api/ligacoes`. 202 = entrou na fila; 200 = já estava lá (o `id_externo`
 * é a `access_key`, então reenviar é inofensivo de propósito).
 *
 * 422 é recusa de conteúdo — telefone inválido, oferta incompleta — e não
 * adianta tentar de novo com o mesmo corpo: volta `retryavel: false` e a linha
 * morre com o motivo à vista.
 */
export async function enfileirarLigacao(
  cfg: VozConfigurada,
  /** v1 (`PedidoLigacao`) ou v2 (`versao: '2'`) — quem decide o formato é o adapter do core. */
  pedido: Record<string, unknown>,
): Promise<EnvioLigacao> {
  try {
    const bruto = await requisitarJson<unknown>(`${cfg.url}/api/ligacoes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}` },
      body: pedido,
      // A fila dela responde na hora: quem demora é a ligação, não o enfileiramento.
      timeoutMs: 20_000,
      tentativas: 3,
    })
    return { ok: true, resposta: respostaEnfileiramentoSchema.parse(bruto) }
  } catch (erro) {
    if (erro instanceof HttpError) {
      // 401/403 é configuração errada — insistir só gasta tentativa.
      const retryavel = erro.status === 429 || erro.status >= 500
      return { ok: false, erro: `HTTP ${erro.status}: ${(erro.corpo ?? '').slice(0, 300)}`, retryavel }
    }
    return { ok: false, erro: String(erro), retryavel: true }
  }
}

/**
 * O que o `DELETE` respondeu. A Ana: `200` antes de discar, `409` depois (a ligação
 * acontece e o `ligacao.encerrada` vem normalmente), `404` quando ela não conhece o id.
 */
export type CancelamentoNaAna = 'cancelada' | 'ja_discou' | 'nao_existe' | 'erro'

/** `DELETE /api/ligacoes/{id}` — só funciona enquanto ninguém discou. */
export async function cancelarLigacao(cfg: VozConfigurada, ligacaoId: string): Promise<CancelamentoNaAna> {
  try {
    await requisitarJson(`${cfg.url}/api/ligacoes/${ligacaoId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${cfg.token}` },
      tentativas: 1,
    })
    return 'cancelada'
  } catch (erro) {
    if (erro instanceof HttpError && erro.status === 409) return 'ja_discou'
    if (erro instanceof HttpError && erro.status === 404) return 'nao_existe'
    return 'erro'
  }
}

/**
 * QUAL ANA ESTÁ DO OUTRO LADO (09 §15.4). `GET /api/versao`: 404 é a v1 (o endpoint não
 * existe nela), `{versao: "2…"}` é a v2. Qualquer falha de rede vira `desconhecida`, e o
 * adapter trata `desconhecida` como v1 — degradar é a direção segura do erro: recusar um
 * objetivo que a Ana talvez suportasse custa um canal alternativo; mandar um que ela não
 * suporta custa uma ligação errada.
 *
 * A v2 pode anunciar também `objetivos`: os que ela já aceita. A Ana libera um objetivo de
 * cada vez, e mandar um que ela ainda não conduz é o mesmo erro de mandar para a v1.
 */
export async function statusDaAna(cfg: VozConfigurada): Promise<StatusVoz> {
  try {
    const res = await fetch(`${cfg.url}/api/versao`, {
      headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const corpo = await res.json().catch(() => null)
    return statusDaResposta(res.status, corpo)
  } catch {
    return { versao: 'desconhecida', objetivos: null }
  }
}
