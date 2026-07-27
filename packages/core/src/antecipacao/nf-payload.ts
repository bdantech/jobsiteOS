import { normalizeCnpj } from '../schemas/cnpj.js'
import { parseNfeXml, vencimentoDasParcelas, type ParcelaXml } from './nfe-xml.js'

/**
 * O CONTRATO do payload de NFs, e a normalização dele.
 *
 * Vive no core pelo mesmo motivo de `sync-plano.ts`: é o formato de uma API de
 * terceiro, e a primeira versão errou três nomes de campo (`value`, `issuedAt`,
 * `xml` em vez de `amount`, `issueDate`, `rawXml`). Erro assim não aparece em
 * typecheck — aparece como zero notas sincronizadas, com HTTP 200.
 *
 * Todo campo é opcional de propósito. É uma API que não controlamos, e uma nota
 * sem `series` não pode derrubar a página inteira.
 */

export interface ContatoPayload {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export interface ParticipantePayload {
  taxId?: string | null
  name?: string | null
  registered?: boolean | null
  contact?: ContatoPayload | null
}

export interface CreditAnalysisPayload {
  status?: string | null
  role?: string | null
  viaHeadquarters?: boolean | null
  /** O CNPJ efetivamente analisado — a MATRIZ quando `viaHeadquarters`. */
  analyzedTaxId?: string | null
  creditLimit?: number | null
  availableLimit?: number | null
  consumedLimit?: number | null
  expirationDate?: string | null
  monthlyRateD0?: number | null
  monthlyRateD1?: number | null
}

export interface NfPayload {
  id?: string | null
  accessKey?: string | null
  type?: string | null
  direction?: string | null
  number?: string | number | null
  series?: string | number | null
  /** O valor da nota. Os aliases existem só como rede — o campo real é `amount`. */
  amount?: number | string | null
  value?: number | string | null
  /** Data de emissão. O campo real é `issueDate`. */
  issueDate?: string | null
  issuedAt?: string | null
  dueDate?: string | null
  status?: string | null
  /** Quando o lado de lá sincronizou a nota. */
  syncedAt?: string | null
  recipient?: ParticipantePayload | null
  supplier?: ParticipantePayload | null
  creditAnalysis?: CreditAnalysisPayload | null
  /** O XML bruto. O campo real é `rawXml`. */
  rawXml?: string | null
  xml?: string | null
}

export interface RespostaNf {
  data?: NfPayload[]
  items?: NfPayload[]
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  /** Tolerância a uma variante snake_case da resposta. */
  total_pages?: number
  period?: { startDate?: string; endDate?: string }
}

export function extrairNotas(resp: RespostaNf): NfPayload[] {
  if (Array.isArray(resp.data)) return resp.data
  if (Array.isArray(resp.items)) return resp.items
  if (Array.isArray(resp)) return resp as NfPayload[]
  return []
}

export function totalDePaginas(resp: RespostaNf): number | undefined {
  return resp.totalPages ?? resp.total_pages
}

// ─── Coerções ───────────────────────────────────────────────────────────────

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Só a parte da data: `2026-07-23T10:15:00` e `2026-08-22` viram `2026-08-22`. */
function data(v: unknown): string | null {
  const s = texto(v)
  if (!s) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m?.[1] ?? null
}

// ─── A normalização ─────────────────────────────────────────────────────────

export type MotivoDescarte = 'sem_access_key' | 'sem_cnpj' | 'sem_valor'

export interface NotaNormalizada {
  access_key: string
  nf_id_externo: string | null
  tipo: 'NFe' | 'NFSe'
  direction: 'received' | 'issued'
  numero: string | null
  serie: string | null
  valor: number
  emitida_em: string | null
  vencimento: string | null
  vencimento_origem: 'xml' | 'endpoint' | 'estimado' | null
  parcelas: ParcelaXml[]
  status_sync: string | null
  sincronizada_em: string
  sacado_cnpj: string
  sacado_nome: string | null
  sacado_cadastrado: boolean | null
  contato_sacado: ContatoPayload | null
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  fornecedor_cadastrado: boolean | null
  contato_fornecedor: ContatoPayload | null
  credito: CreditAnalysisPayload | null
  /** Itens e erro do parse do XML — o XML bruto é guardado à parte, sempre. */
  raw_xml: string | null
  xml_parse_erro: string | null
  itens: ReturnType<typeof parseNfeXml>['itens']
}

export type ResultadoNormalizacao =
  | { ok: true; nota: NotaNormalizada }
  | { ok: false; motivo: MotivoDescarte; id: string | null }

/**
 * Payload + XML → a linha de `notas_fiscais`, sem tocar no banco.
 *
 * O XML é a SEGUNDA fonte de tudo: quando o JSON não traz `accessKey`, `amount`,
 * `number` ou as datas, o XML tem. É por isso que ele é parseado aqui e não só
 * guardado — e é por isso que uma falha de parse não descarta a nota.
 *
 * O vencimento tem uma cascata própria, e a ORIGEM é sempre gravada: uma data de
 * emissão + 30 dias não pode se passar por uma duplicata real na hora de decidir
 * se a nota é operável.
 */
export function normalizarNfPayload(
  item: NfPayload,
  hoje: Date = new Date(),
): ResultadoNormalizacao {
  const parsed = parseNfeXml(item.rawXml ?? item.xml)

  const accessKey = texto(item.accessKey) ?? parsed.access_key
  if (!accessKey) return { ok: false, motivo: 'sem_access_key', id: texto(item.id) }

  const fornecedorCnpj = normalizeCnpj(item.supplier?.taxId ?? parsed.emitente_cnpj ?? '')
  const sacadoCnpj = normalizeCnpj(item.recipient?.taxId ?? parsed.destinatario_cnpj ?? '')
  if (fornecedorCnpj.length !== 14 || sacadoCnpj.length !== 14) {
    return { ok: false, motivo: 'sem_cnpj', id: texto(item.id) }
  }

  const valor = numero(item.amount) ?? numero(item.value) ?? parsed.valor_total
  if (valor === null) return { ok: false, motivo: 'sem_valor', id: texto(item.id) }

  const emitidaEm = texto(item.issueDate) ?? texto(item.issuedAt) ?? parsed.emitida_em

  // XML → endpoint → estimado.
  const doXml = vencimentoDasParcelas(parsed.parcelas, hoje)
  const doEndpoint = data(item.dueDate)
  let vencimento = doXml ?? doEndpoint
  let vencimentoOrigem: NotaNormalizada['vencimento_origem'] = doXml
    ? 'xml'
    : doEndpoint
      ? 'endpoint'
      : null

  if (!vencimento && emitidaEm) {
    const base = new Date(emitidaEm)
    if (!Number.isNaN(base.getTime())) {
      vencimento = new Date(base.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
      vencimentoOrigem = 'estimado'
    }
  }

  return {
    ok: true,
    nota: {
      access_key: accessKey,
      nf_id_externo: texto(item.id),
      tipo: (texto(item.type) ?? 'NFe').toUpperCase() === 'NFSE' ? 'NFSe' : 'NFe',
      direction: texto(item.direction) === 'issued' ? 'issued' : 'received',
      numero: texto(item.number) ?? parsed.numero,
      serie: texto(item.series) ?? parsed.serie,
      valor,
      emitida_em: emitidaEm,
      vencimento,
      vencimento_origem: vencimentoOrigem,
      parcelas: parsed.parcelas,
      status_sync: texto(item.status),
      // `syncedAt` é o carimbo do LADO DE LÁ. Preferi-lo a now() é o que torna
      // "quando esta nota entrou" uma pergunta respondível depois de um backfill:
      // com now(), 60 dias de nota antiga chegariam todos carimbados com o mesmo
      // instante da recuperação.
      sincronizada_em: texto(item.syncedAt) ?? hoje.toISOString(),
      sacado_cnpj: sacadoCnpj,
      sacado_nome: texto(item.recipient?.name),
      sacado_cadastrado: item.recipient?.registered ?? null,
      contato_sacado: item.recipient?.contact ?? null,
      fornecedor_cnpj: fornecedorCnpj,
      fornecedor_nome: texto(item.supplier?.name),
      fornecedor_cadastrado: item.supplier?.registered ?? null,
      // O fornecedor é a UNIDADE DE ABORDAGEM: o contato dele é exatamente o que
      // a outbox procura antes de descartar por `sem_contato`. Descartá-lo aqui
      // seria jogar fora o dado que o módulo mais precisa.
      contato_fornecedor: item.supplier?.contact ?? null,
      credito: item.creditAnalysis ?? null,
      raw_xml: item.rawXml ?? item.xml ?? null,
      xml_parse_erro: parsed.erro,
      itens: parsed.itens,
    },
  }
}
