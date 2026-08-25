import { formatCnpj } from '../../../../../../packages/core/src/schemas/cnpj.js'
import {
  filtrarContatosDoClaude,
  type ContatoDeProvedor,
} from '../../../../../../packages/core/src/fornecedores/provedores.js'
import { env } from '../../../env.js'
import { logger } from '../../../logger.js'
import { requisitarJson } from '../../../net/http.js'
import type { CadastralFornecedor } from '../descoberta.js'

/**
 * Claude com busca web (§4.2c) — a última etapa da cascata paga, e a que existe
 * justamente para a PME que não está em base nenhuma.
 *
 * ─── A FERRAMENTA DE BUSCA É OBRIGATÓRIA ─────────────────────────────────────
 *
 * Sem `web_search` habilitada, o modelo responde do treino — e para uma serralheria
 * de Sorocaba isso significa um telefone plausível e inventado, entregue com a mesma
 * confiança de um verdadeiro. É a única configuração deste arquivo que não é
 * ajustável: sem busca, o provedor não deve rodar.
 *
 * ─── INSTAGRAM E FACEBOOK SÃO O PONTO ────────────────────────────────────────
 *
 * O prompt pede explicitamente essas redes porque muita PME de construção só existe
 * nelas: não tem site, não tem LinkedIn, e o WhatsApp comercial está na bio do
 * Instagram. Procurar "site oficial" e parar aí é procurar o tipo de empresa que os
 * outros provedores já cobrem.
 *
 * ─── SEM EVIDÊNCIA, DESCARTA ─────────────────────────────────────────────────
 *
 * O filtro mora no core, com teste. Um contato sem URL de origem é indistinguível de
 * um inventado, e a evidência não é auditoria — é a prova de que a busca aconteceu.
 */

const MODELO = 'claude-sonnet-4-6'

export interface ResultadoClaude {
  contatos: ContatoDeProvedor[]
  disponivel: boolean
  erro?: string
}

export async function buscarComClaude(
  cadastral: CadastralFornecedor,
  sacadosPrincipais: readonly { nome: string | null }[] = [],
): Promise<ResultadoClaude> {
  if (!env.ANTHROPIC_API_KEY) {
    return { contatos: [], disponivel: false, erro: 'ANTHROPIC_API_KEY não configurada.' }
  }

  const sacados = sacadosPrincipais
    .map((s) => s.nome)
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')

  const prompt =
    `Encontre contatos comerciais desta empresa brasileira. Pesquise na web.\n\n` +
    `Razão social: ${cadastral.razao_social ?? '—'}\n` +
    `Nome fantasia: ${cadastral.nome_fantasia ?? '—'}\n` +
    `CNPJ: ${formatCnpj(cadastral.cnpj)}\n` +
    `Município/UF: ${cadastral.municipio ?? '—'}/${cadastral.uf ?? '—'}\n` +
    (sacados ? `Fornece para: ${sacados}\n` : '') +
    `\nProcure, nesta ordem: site oficial; perfil comercial no Instagram e no Facebook ` +
    `(muita PME de construção só existe nessas redes); ficha no Google Maps; listas ` +
    `locais e sindicatos ou associações do setor.\n\n` +
    `Regras:\n` +
    `- Só devolva contato que você VIU numa página, com a URL dessa página em "evidencia".\n` +
    `- Não invente e não deduza um e-mail a partir do domínio.\n` +
    `- Confirme que a empresa é a do CNPJ/município acima antes de aceitar o contato.\n\n` +
    `Responda APENAS com JSON, sem texto em volta:\n` +
    `{"contatos":[{"tipo":"telefone|email|whatsapp|instagram|site","valor":"...",` +
    `"nome_pessoa":null,"cargo":null,"confianca":"alta|media|baixa","evidencia":"URL"}]}`

  try {
    const resp = await requisitarJson<{ content?: Array<{ type: string; text?: string }> }>(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: {
          model: MODELO,
          max_tokens: 2048,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }],
        },
        timeoutMs: 90_000,
        tentativas: 2,
      },
    )

    const texto = (resp.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')

    // O modelo às vezes embrulha o JSON em prosa apesar da instrução. O recorte pelo
    // primeiro `{` até o último `}` é o mesmo da cascata de domínio do Radar.
    const m = texto.match(/\{[\s\S]*\}/)
    if (!m) return { contatos: [], disponivel: true }

    let json: unknown
    try {
      json = JSON.parse(m[0])
    } catch {
      logger.warn({ cnpj: cadastral.cnpj }, 'Claude devolveu JSON inválido na busca de contatos.')
      return { contatos: [], disponivel: true }
    }

    return { contatos: filtrarContatosDoClaude(json, { dddPadrao: cadastral.ddd }), disponivel: true }
  } catch (e) {
    logger.error({ cnpj: cadastral.cnpj, erro: String(e) }, 'Busca de contatos com Claude falhou.')
    return { contatos: [], disponivel: true, erro: String(e) }
  }
}
