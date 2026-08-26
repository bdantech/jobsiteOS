import { formatCnpj } from '../../../../../../packages/core/src/schemas/cnpj.js'
import {
  filtrarContatosDoClaude,
  type ContatoDeProvedor,
} from '../../../../../../packages/core/src/fornecedores/provedores.js'
import { env } from '../../../env.js'
import { logger } from '../../../logger.js'
import { requisitarJson } from '../../../net/http.js'
import type { LacunasDeContato } from '../../../../../../packages/core/src/fornecedores/cascata.js'
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

/**
 * A SEGUNDA passada (§4.2c, aprofundada).
 *
 * Ela não repete a primeira — recebe o que já foi achado, o que morreu na validação, e
 * a lacuna específica. A diferença está inteira no prompt:
 *
 *   primeira    "ache contatos comerciais desta empresa"
 *   aprofundada "estes aqui já temos, estes não funcionam; ache uma PESSOA com celular"
 *
 * Repetir o mesmo prompt pagaria duas vezes pela mesma resposta. Dizer o que não
 * serviu é o que muda a pergunta — e é o que autoriza procurar em lugares mais caros
 * de varrer: sindicato patronal, junta comercial, notícia local, perfil de sócio,
 * ficha de obra pública.
 *
 * O rebaixamento de confiança continua valendo: nada que sai daqui é "alta".
 */
export async function buscarComClaudeAprofundado(
  cadastral: CadastralFornecedor,
  lacunas: LacunasDeContato,
  sacadosPrincipais: readonly { nome: string | null }[] = [],
): Promise<ResultadoClaude> {
  if (!env.ANTHROPIC_API_KEY) {
    return { contatos: [], disponivel: false, erro: 'ANTHROPIC_API_KEY não configurada.' }
  }

  const sacados = sacadosPrincipais.map((s) => s.nome).filter(Boolean).slice(0, 3).join(', ')

  const pedido: Record<LacunasDeContato['faltam'][number], string> = {
    pessoa: 'o NOME de alguém que decide (sócio, diretor, gerente comercial ou financeiro) e como falar com essa pessoa',
    celular: 'um CELULAR ou WhatsApp — os fixos que temos não resolvem',
    whatsapp: 'um WhatsApp comercial',
    email: 'um e-mail que receba mensagem',
    qualquer: 'qualquer canal de contato: telefone, e-mail, WhatsApp ou perfil comercial',
  }

  const prompt =
    `Segunda busca, mais profunda, sobre esta empresa brasileira. Pesquise na web.\n\n` +
    `Razão social: ${cadastral.razao_social ?? '—'}\n` +
    `Nome fantasia: ${cadastral.nome_fantasia ?? '—'}\n` +
    `CNPJ: ${formatCnpj(cadastral.cnpj)}\n` +
    `Município/UF: ${cadastral.municipio ?? '—'}/${cadastral.uf ?? '—'}\n` +
    (cadastral.dominio ? `Site: ${cadastral.dominio}\n` : '') +
    (sacados ? `Fornece para: ${sacados}\n` : '') +
    `\nJÁ TEMOS (não devolva estes de novo):\n` +
    (lacunas.temos.length ? lacunas.temos.map((t) => `- ${t}`).join('\n') : '- nada') +
    `\n\nJÁ TENTAMOS E NÃO FUNCIONA (não devolva estes):\n` +
    (lacunas.falharam.length ? lacunas.falharam.map((t) => `- ${t}`).join('\n') : '- nada') +
    `\n\nO QUE FALTA: ${lacunas.faltam.map((f) => pedido[f]).join('; ')}.\n\n` +
    `A primeira busca já cobriu site oficial, Instagram, Facebook e Google Maps. Vá além:\n` +
    `- sindicato patronal e associação do setor da região;\n` +
    `- junta comercial, quadro societário e publicações legais;\n` +
    `- notícias e portais locais que citem a empresa ou os sócios;\n` +
    `- LinkedIn de pessoas que se dizem da empresa;\n` +
    `- portais de licitação e ficha de obra, quando houver.\n\n` +
    `Regras (as mesmas):\n` +
    `- Só devolva contato que você VIU numa página, com a URL dessa página em "evidencia".\n` +
    `- Não invente e não deduza um e-mail a partir do domínio.\n` +
    `- Confirme que a empresa é a do CNPJ/município acima antes de aceitar o contato.\n` +
    `- Se não achar nada novo, devolva a lista vazia. Repetir o que já temos não ajuda.\n\n` +
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
          // Mais buscas que a primeira: é a passada que vasculha fontes esparsas.
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
          messages: [{ role: 'user', content: prompt }],
        },
        timeoutMs: 120_000,
        tentativas: 2,
      },
    )

    const texto = (resp.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
    const m = texto.match(/\{[\s\S]*\}/)
    if (!m) return { contatos: [], disponivel: true }

    let json: unknown
    try {
      json = JSON.parse(m[0])
    } catch {
      logger.warn({ cnpj: cadastral.cnpj }, 'Busca aprofundada devolveu JSON inválido.')
      return { contatos: [], disponivel: true }
    }

    return { contatos: filtrarContatosDoClaude(json, { dddPadrao: cadastral.ddd }), disponivel: true }
  } catch (e) {
    logger.error({ cnpj: cadastral.cnpj, erro: String(e) }, 'Busca aprofundada falhou.')
    return { contatos: [], disponivel: true, erro: String(e) }
  }
}
