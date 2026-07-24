import dns from 'node:dns/promises'
import { fetch } from 'undici'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { formatCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import type { Tables } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { lerCustos } from '../../radar/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import type { ProcessarItem, ResultadoItem } from './lote.js'

/**
 * Cascata de resolução de domínio (§3). Ordem obrigatória, só avança quando a etapa
 * anterior não resolve:
 *   1. e-mail da Receita   2. e-mails de contatos   3. site de listas (placeholder)
 *   4. heurística + validação (DNS → MX → CNPJ na página)
 *   5. busca com Claude (paga, só se o lote pedir) — NUNCA aceita direto: revalida.
 */

type Confianca = 'alta' | 'media' | 'baixa'
type Origem = 'rfb' | 'contato' | 'lista' | 'heuristica' | 'claude_busca'
interface Achado {
  dominio: string
  origem: Origem
  confianca: Confianca
  evidencia: string
}

const PROVEDORES_GENERICOS = new Set([
  'gmail', 'hotmail', 'outlook', 'live', 'yahoo', 'uol', 'terra', 'bol', 'ig', 'globo', 'r7', 'msn', 'icloud',
])

function dominioDeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const m = email.trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/)
  const dom = m?.[1]
  if (!dom) return null
  const raiz = dom.split('.')[0] ?? ''
  return PROVEDORES_GENERICOS.has(raiz) ? null : dom
}

/** 4-8 candidatos a partir de razão social / nome fantasia. */
function gerarCandidatos(razao?: string | null, fantasia?: string | null): string[] {
  const cands = new Set<string>()
  for (const nome of [fantasia, razao].filter(Boolean) as string[]) {
    const limpo = nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\b(ltda|sa|s a|eireli|me|epp|mei|cia|companhia)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const palavras = limpo.split(' ').filter((w) => w.length >= 2)
    if (!palavras.length) continue
    const bases = new Set([palavras.join(''), palavras[0] as string, palavras.slice(0, 2).join('')])
    for (const base of bases) for (const ext of ['.com.br', '.com', '.eng.br']) cands.add(base + ext)
  }
  return [...cands].slice(0, 8)
}

/** DNS → MX → CNPJ na página. Retorna null se o domínio nem resolve. */
async function validar(dominio: string, cnpj: string): Promise<Omit<Achado, 'origem'> | null> {
  try {
    await dns.resolve(dominio)
  } catch {
    return null // não existe
  }

  let temMx = false
  try {
    temMx = (await dns.resolveMx(dominio)).length > 0
  } catch {
    /* sem MX é ok */
  }

  for (const proto of ['https', 'http'] as const) {
    try {
      const res = await fetch(`${proto}://${dominio}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'JobsiteOS-Radar/1.0' },
      })
      if (!res.ok) continue
      const html = (await res.text()).slice(0, 500_000)
      const semPont = html.replace(/[.\-/\s]/g, '')
      if (semPont.includes(cnpj)) {
        return { dominio, confianca: 'alta', evidencia: `${proto}://${dominio} (CNPJ na página)` }
      }
      return { dominio, confianca: temMx ? 'media' : 'baixa', evidencia: `${proto}://${dominio}` }
    } catch {
      /* tenta o próximo protocolo */
    }
  }
  // Resolve no DNS mas não respondeu HTTP.
  return { dominio, confianca: temMx ? 'media' : 'baixa', evidencia: `DNS${temMx ? '+MX' : ''}: ${dominio}` }
}

interface DadosEmpresa {
  razao_social: string | null
  nome_fantasia: string | null
  email_rfb: string | null
}

/** Etapa 5: pergunta ao Claude COM busca web e revalida o resultado (nunca aceita direto). */
async function buscaClaude(cnpj: string, dados: DadosEmpresa): Promise<Achado | null> {
  if (!env.ANTHROPIC_API_KEY) return null
  const prompt =
    `Encontre o site oficial (domínio) desta empresa brasileira. Pesquise na web.\n` +
    `Razão social: ${dados.razao_social ?? '—'}\nNome fantasia: ${dados.nome_fantasia ?? '—'}\n` +
    `CNPJ: ${formatCnpj(cnpj)}\n` +
    `Responda APENAS com JSON: {"dominio": "exemplo.com.br"|null, "confianca":"alta|media|baixa", "evidencia":"URL", "motivo":"curto"}`

  let resp: { content?: Array<{ type: string; text?: string }> }
  try {
    resp = await requisitarJson<{ content?: Array<{ type: string; text?: string }> }>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      },
      timeoutMs: 60_000,
      tentativas: 2,
    })
  } catch (e) {
    logger.error({ cnpj, erro: String(e) }, 'Busca Claude falhou.')
    return null
  }

  const texto = (resp.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
  const m = texto.match(/\{[\s\S]*\}/)
  if (!m) return null
  let json: { dominio?: string | null; evidencia?: string }
  try {
    json = JSON.parse(m[0])
  } catch {
    return null
  }
  if (!json.dominio) return null

  // NUNCA aceita direto: passa pela mesma validação da etapa 4.
  const v = await validar(json.dominio.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), cnpj)
  if (!v) return null
  return { ...v, origem: 'claude_busca', evidencia: json.evidencia || v.evidencia }
}

async function gravarDominio(cnpj: string, empresaId: string | null, achado: Achado): Promise<void> {
  const agora = new Date().toISOString()
  await supabaseAdmin
    .from('mercado_universo')
    .update({ dominio: achado.dominio, dominio_origem: achado.origem, dominio_confianca: achado.confianca })
    .eq('cnpj', cnpj)
  if (empresaId) {
    await supabaseAdmin
      .from('empresas')
      .update({
        dominio: achado.dominio,
        dominio_origem: achado.origem,
        dominio_confianca: achado.confianca,
        dominio_validado_em: agora,
        dominio_evidencia: achado.evidencia,
      })
      .eq('id', empresaId)
  }
}

/** Fabrica o processador de item para um lote de domínio (captura os parâmetros do lote). */
export function criarProcessadorDominio(lote: Tables<'lotes_enriquecimento'>): ProcessarItem {
  const params = (lote.parametros ?? {}) as { incluir_claude?: boolean }

  return async (item: Tables<'lote_itens'>): Promise<ResultadoItem> => {
    const cnpj = item.cnpj
    if (!cnpj) return { status: 'erro', fonte: 'heuristica', erro: 'Item sem CNPJ.' }

    const { data: mu } = await supabaseAdmin
      .from('mercado_universo')
      .select('razao_social, nome_fantasia, email_rfb')
      .eq('cnpj', cnpj)
      .maybeSingle()
    const dados: DadosEmpresa = {
      razao_social: mu?.razao_social ?? null,
      nome_fantasia: mu?.nome_fantasia ?? null,
      email_rfb: mu?.email_rfb ?? null,
    }

    let achado: Achado | null = null

    // Etapa 1 — e-mail da Receita.
    const d1 = dominioDeEmail(dados.email_rfb)
    if (d1) {
      const v = await validar(d1, cnpj)
      if (v) achado = { ...v, origem: 'rfb' }
    }

    // Etapa 2 — e-mails de contatos existentes.
    if (!achado && item.empresa_id) {
      const { data: cts } = await supabaseAdmin
        .from('contatos')
        .select('email')
        .eq('empresa_id', item.empresa_id)
        .not('email', 'is', null)
      for (const c of cts ?? []) {
        const d = dominioDeEmail(c.email)
        if (!d) continue
        const v = await validar(d, cnpj)
        if (v) {
          achado = { ...v, origem: 'contato' }
          break
        }
      }
    }

    // Etapa 3 — coluna de site de listas: placeholder (sem fonte estruturada hoje).

    // Etapa 4 — heurística.
    if (!achado) {
      for (const cand of gerarCandidatos(dados.razao_social, dados.nome_fantasia)) {
        const v = await validar(cand, cnpj)
        if (v) {
          achado = { ...v, origem: 'heuristica' }
          break
        }
      }
    }

    // Etapa 5 — busca Claude (paga; só se o lote pediu e a chave existe).
    let custo = 0
    if (!achado && params.incluir_claude) {
      const { dominio_claude } = await lerCustos()
      custo = dominio_claude
      achado = await buscaClaude(cnpj, dados)
    }

    if (!achado) {
      return { status: 'sem_dados', fonte: params.incluir_claude ? 'claude_busca' : 'heuristica', custo }
    }

    await gravarDominio(cnpj, item.empresa_id, achado)
    await emitirEvento(item.empresa_id, EVENTO_TIPOS.DOMINIO_RESOLVIDO, {
      titulo: 'Domínio resolvido',
      resumo: `${achado.dominio} (${achado.origem}, confiança ${achado.confianca}).`,
      url: item.empresa_id ? `/empresas/${item.empresa_id}` : `/mercado/universo/${cnpj}`,
      cnpj,
      dominio: achado.dominio,
    })
    return { status: 'sucesso', fonte: achado.origem, custo, resultado: achado }
  }
}
