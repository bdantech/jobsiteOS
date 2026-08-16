import { avaliarCertificado, parseDataCertificado } from '../../../../../packages/core/src/certificados/estado.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { normalizeCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * Sync diário dos certificados digitais (04b §3).
 *
 * Certificado vencido = cegueira de NF-e naquela empresa, então este job é o que
 * garante que a cegueira seja AVISADA em vez de descoberta quando as notas param de
 * chegar. Puxa o endpoint paginado, guarda TODOS os certificados (inclusive de
 * fornecedores — o grid filtra depois, o KPI de total conta tudo) e emite os alertas.
 *
 * Encadeado ao sync de clientes Onepay: os dois vêm do mesmo BI, no mesmo cron, e a
 * ordem importa pouco — mas rodar junto significa uma janela só de indisponibilidade
 * do fornecedor em vez de duas.
 */

interface ItemCertificado {
  companyName?: string
  taxId?: string
  expiresAt?: string | null
  status?: string
}

interface RespostaCertificados {
  data?: ItemCertificado[]
  items?: ItemCertificado[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
}

export interface ResultadoCertificados {
  paginas: number
  itens: number
  novos: number
  atualizados: number
  eventos: number
}

const PAGE_SIZE = 200

function autorizacao(): Record<string, string> {
  return env.ONEPAY_BI_TOKEN ? { authorization: `Bearer ${env.ONEPAY_BI_TOKEN}` } : {}
}

function extrair(resp: RespostaCertificados): ItemCertificado[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as ItemCertificado[]
  return []
}

/**
 * Uma linha por CNPJ. Se a página trouxer dois certificados do mesmo `taxId`
 * (renovação em andamento), fica o de MAIOR `expires_at` (§2) — o antigo já não
 * descreve a capacidade de emitir nota.
 */
function consolidarPorCnpj(itens: readonly ItemCertificado[]): Map<string, ItemCertificado> {
  const porCnpj = new Map<string, ItemCertificado>()
  for (const item of itens) {
    const cnpj = normalizeCnpj(item.taxId ?? '')
    if (cnpj.length !== 14) continue
    const atual = porCnpj.get(cnpj)
    if (!atual) {
      porCnpj.set(cnpj, item)
      continue
    }
    const novo = parseDataCertificado(item.expiresAt)?.getTime() ?? -Infinity
    const velho = parseDataCertificado(atual.expiresAt)?.getTime() ?? -Infinity
    if (novo > velho) porCnpj.set(cnpj, item)
  }
  return porCnpj
}

export async function sincronizarCertificados(): Promise<ResultadoCertificados> {
  if (!env.ONEPAY_BI_URL) {
    throw new Error('ONEPAY_BI_URL não configurado — configure o secret no worker antes de rodar.')
  }
  const base = env.ONEPAY_BI_URL.replace(/\/+$/, '')
  const acc: ResultadoCertificados = { paginas: 0, itens: 0, novos: 0, atualizados: 0, eventos: 0 }

  // Acumula as páginas antes de gravar: a consolidação por CNPJ (renovação) precisa
  // enxergar o conjunto todo, e duas páginas podem trazer o mesmo taxId.
  const todos: ItemCertificado[] = []
  let page = 1
  let totalPages = 1
  do {
    const url = `${base}/api/v1/certificates?page=${page}&pageSize=${PAGE_SIZE}`
    const resp = await requisitarJson<RespostaCertificados>(url, {
      headers: autorizacao(),
      timeoutMs: 60_000,
    })
    totalPages = Math.max(1, resp.totalPages ?? 1)
    todos.push(...extrair(resp))
    page++
  } while (page <= totalPages)

  acc.paginas = totalPages
  const consolidados = consolidarPorCnpj(todos)
  acc.itens = consolidados.size

  for (const [cnpj, item] of consolidados) {
    const r = await gravarEAlertar(cnpj, item)
    if (r.novo) acc.novos++
    else acc.atualizados++
    acc.eventos += r.eventos
  }

  /*
   * O funil de captura (0116) reconcilia AQUI, e não num cron próprio: ele é uma
   * leitura da tabela que acabou de ser reescrita, e agendá-lo separado criaria uma
   * janela em que a tela mostra a coluna de ontem sobre o certificado de hoje.
   *
   * Falha do funil não derruba o sync. O certificado já está gravado — que é o dado
   * de verdade — e a reconciliação é idempotente: a próxima rodada, ou o botão
   * "Sincronizar" na tela, resolve.
   */
  const { data: funil, error: erroFunil } = await supabaseAdmin.rpc('certificado_funil_sincronizar')
  if (erroFunil) logger.error({ err: erroFunil.message }, 'Funil de certificados não reconciliou.')
  else logger.info({ funil }, 'Funil de certificados reconciliado.')

  logger.info({ ...acc, recebidos: todos.length }, 'Sync de certificados concluído.')
  return acc
}

/**
 * O dedupe dos alertas (§3) é `ultimo_alerta`: só emite quando o ESTADO muda. Sem
 * isso, "vencendo" seria reemitido todo dia durante os 30 dias — e um alerta que
 * chega todo dia deixa de ser lido no terceiro.
 */
async function gravarEAlertar(
  cnpj: string,
  item: ItemCertificado,
): Promise<{ novo: boolean; eventos: number }> {
  const { data: anterior } = await supabaseAdmin
    .from('certificados')
    .select('expires_at, status, ultimo_alerta')
    .eq('cnpj', cnpj)
    .maybeSingle()

  const expiresAt = parseDataCertificado(item.expiresAt)?.toISOString() ?? null
  const anteriorMs = parseDataCertificado(anterior?.expires_at)?.getTime() ?? null
  const novoMs = parseDataCertificado(expiresAt)?.getTime() ?? null
  const renovou = anteriorMs !== null && novoMs !== null && novoMs > anteriorMs

  const { estado } = avaliarCertificado({ expires_at: expiresAt, status: item.status ?? null })

  // `renovado` é um estado de TRANSIÇÃO, não um estado do certificado: some assim que
  // o alerta é emitido, e o próximo sync grava o estado real (que será 'valido').
  const alerta = renovou ? 'renovado' : estado === 'vencendo' || estado === 'vencido' ? estado : null

  const { error } = await supabaseAdmin.from('certificados').upsert(
    {
      cnpj,
      company_name: item.companyName ?? null,
      expires_at: expiresAt,
      status: item.status ?? null,
      expires_at_anterior: anterior?.expires_at ?? null,
      ultimo_alerta: alerta,
      sincronizado_em: new Date().toISOString(),
    },
    { onConflict: 'cnpj' },
  )
  if (error) {
    logger.error({ cnpj, erro: error.message }, 'Falha ao gravar certificado.')
    return { novo: !anterior, eventos: 0 }
  }

  const eventos = alerta && alerta !== anterior?.ultimo_alerta ? await emitir(cnpj, alerta, item, expiresAt) : 0
  return { novo: !anterior, eventos }
}

/** Só empresas NA BASE geram evento — um alerta sobre CNPJ que ninguém acompanha é ruído. */
async function emitir(
  cnpj: string,
  alerta: 'vencendo' | 'vencido' | 'renovado',
  item: ItemCertificado,
  expiresAt: string | null,
): Promise<number> {
  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('id, razao_social')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (!empresa) return 0

  const nome = empresa.razao_social ?? item.companyName ?? cnpj
  const quando = expiresAt ? new Date(expiresAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'sem data'

  const tipo =
    alerta === 'vencendo'
      ? EVENTO_TIPOS.CERTIFICADO_VENCENDO
      : alerta === 'vencido'
        ? EVENTO_TIPOS.CERTIFICADO_VENCIDO
        : EVENTO_TIPOS.CERTIFICADO_RENOVADO

  const resumo =
    alerta === 'vencendo'
      ? `O certificado digital de ${nome} vence em ${quando}. Sem ele, paramos de ingerir NF-e desta empresa.`
      : alerta === 'vencido'
        ? `O certificado digital de ${nome} está vencido (${quando}). As NF-e desta empresa não estão sendo ingeridas.`
        : `O certificado digital de ${nome} foi renovado até ${quando}.`

  await emitirEvento(empresa.id, tipo, {
    titulo:
      alerta === 'vencendo'
        ? 'Certificado digital vencendo'
        : alerta === 'vencido'
          ? 'Certificado digital vencido'
          : 'Certificado digital renovado',
    resumo,
    url: '/empresas/certificados',
    cnpj,
    expira_em: expiresAt,
  })
  return 1
}
