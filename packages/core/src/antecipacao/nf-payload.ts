import { normalizeCnpj } from '../schemas/cnpj.js'
import { abaixoDoMinimoOperavel, motivoValorAbaixoDoMinimo } from './economia.js'
import { avaliarNatureza, motivoNaoOperavel } from './natureza-operacao.js'
import { parseNfeXml, vencimentoDasParcelas, type ParcelaXml } from './nfe-xml.js'
import { vencimentoDeTextoLivre } from './vencimento-texto.js'

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

export const MOTIVOS_DESCARTE: readonly MotivoDescarte[] = [
  'sem_access_key',
  'sem_cnpj',
  'sem_valor',
] as const

/**
 * A situação fiscal da nota, NORMALIZADA — e é por isso que ela existe.
 *
 * Depois da migração de 12/09/2026 a plataforma passou a conviver com dois
 * vocabulários de `status`: as notas migradas seguem em português
 * (`sincronizado`/`cancelado`) e as nativas vêm em inglês (`authorized`,
 * `cancelled`, `denied`, `active`). Comparar a string crua contra uma lista
 * significa acertar metade da base e errar a outra, em silêncio.
 *
 * `status_sync` continua gravado CRU — é a evidência do que o outro lado disse.
 * Esta é a leitura, e é ela que decide se a nota sai do funil.
 */
export type SituacaoNota = 'valida' | 'cancelada' | 'denegada'

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function situacaoDaNota(status: string | null | undefined): SituacaoNota {
  const s = semAcento(String(status ?? '').trim().toLowerCase())
  // `includes` e não igualdade: `cancelado`, `cancelled` e `cancelada` são a mesma
  // coisa dita de três jeitos, e a lista de grafias cresce a cada migração deles.
  if (s.includes('cancel')) return 'cancelada'
  if (s.includes('deneg') || s.includes('denied')) return 'denegada'
  return 'valida'
}

/**
 * `NFe` ou `NFSe`, tolerante à grafia e com o XML como desempate.
 *
 * A versão anterior era `type.toUpperCase() === 'NFSE'`: `"NFS-e"` já cairia em
 * `NFe` sem um ruído sequer. Quando o `type` não resolve, o layout do XML resolve
 * — ele é o documento em si, não um rótulo sobre ele.
 */
export function tipoDaNota(
  type: string | null | undefined,
  layout?: 'nfe' | 'resumo' | 'nfse' | 'desconhecido',
): 'NFe' | 'NFSe' {
  const t = semAcento(String(type ?? '')).toUpperCase().replace(/[^A-Z]/g, '')
  if (t === 'NFSE') return 'NFSe'
  if (t === 'NFE') return 'NFe'
  return layout === 'nfse' ? 'NFSe' : 'NFe'
}

const DIRECOES_EMITIDA = new Set(['issued', 'emitida', 'emitidas', 'saida', 'outbound'])

/**
 * `issued` ou `received`. Devolve também se o valor foi RECONHECIDO: cair no
 * padrão calado é como uma nota emitida vira uma nota recebida sem ninguém notar,
 * e o worker precisa poder logar o valor novo em vez de engoli-lo.
 */
export function direcaoDaNota(direction: string | null | undefined): {
  direction: 'issued' | 'received'
  conhecida: boolean
} {
  const d = semAcento(String(direction ?? '')).trim().toLowerCase()
  if (DIRECOES_EMITIDA.has(d)) return { direction: 'issued', conhecida: true }
  if (d === 'received' || d === 'recebida' || d === 'entrada' || d === 'inbound') {
    return { direction: 'received', conhecida: true }
  }
  return { direction: 'received', conhecida: d === '' }
}

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
  /**
   * `xml` = duplicata/fatura; `endpoint` = o que o Onepay mandou; `xml_texto` = lido
   * da prosa da nota (infCpl / discriminação do serviço); `estimado` = emissão + 30,
   * que é palpite e não pode se passar por dado.
   */
  vencimento_origem: 'xml' | 'endpoint' | 'xml_texto' | 'estimado' | null
  natureza_operacao: string | null
  /** Remessa, devolução, retorno e afins não geram crédito — saem do funil. */
  operavel: boolean
  nao_operavel_motivo: string | null
  parcelas: ParcelaXml[]
  /** O que o outro lado disse, cru. A leitura dele é `situacao`. */
  status_sync: string | null
  situacao: SituacaoNota
  /**
   * A NFe recebida chega primeiro como RESUMO (`resNFe`) e só ganha o XML
   * completo depois da manifestação. Enquanto isto for `true` a nota está
   * incompleta — sem itens e sem duplicata, logo sem vencimento real — e precisa
   * ser relida. É o que alimenta a fila de promoção.
   */
  xml_resumo: boolean
  /** Valores de enum que não reconhecemos. O worker loga; ninguém engole calado. */
  avisos: string[]
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
  valorMinimoOperavel?: number,
): ResultadoNormalizacao {
  const parsed = parseNfeXml(item.rawXml ?? item.xml)

  const accessKey = texto(item.accessKey) ?? parsed.access_key
  if (!accessKey) return { ok: false, motivo: 'sem_access_key', id: texto(item.id) }

  const fornecedorCnpj = normalizeCnpj(item.supplier?.taxId ?? parsed.emitente_cnpj ?? '')
  const sacadoCnpj = normalizeCnpj(item.recipient?.taxId ?? parsed.destinatario_cnpj ?? '')
  if (fornecedorCnpj.length !== 14 || sacadoCnpj.length !== 14) {
    return { ok: false, motivo: 'sem_cnpj', id: texto(item.id) }
  }

  /*
   * O XML não é rede de segurança aqui — é a FONTE, hoje.
   *
   * Desde a migração de 12/09/2026 toda NFS-e nativa vem com `amount: null` (229 de
   * 229 na amostra que a plataforma mediu), e o valor só existe em `vServ`, dentro
   * do `rawXml`. Enquanto `parseNfeXml` só sabia ler `ICMSTot/vNF`, este `??` caía
   * em null e a nota morria em `sem_valor` — foram nove dias e 9.463 notas.
   *
   * A ordem continua a mesma de propósito: quando a plataforma corrigir o campo,
   * `amount` volta a ganhar do XML sem uma linha de código nova.
   */
  const valor = numero(item.amount) ?? numero(item.value) ?? parsed.valor_total
  if (valor === null) return { ok: false, motivo: 'sem_valor', id: texto(item.id) }

  const emitidaEm = texto(item.issueDate) ?? texto(item.issuedAt) ?? parsed.emitida_em

  // Duplicata → endpoint → texto livre da nota → emissão + 30.
  //
  // O texto livre entra DEPOIS do endpoint de propósito: é heurística sobre prosa, e
  // dado estruturado, quando existe, ganha. Mas entra ANTES do estimado, e é aí que
  // está o ganho — 70% da base caía direto no palpite de 30 dias, sendo que a data
  // estava escrita na nota.
  const doXml = vencimentoDasParcelas(parsed.parcelas, hoje)
  const doEndpoint = data(item.dueDate)
  let vencimento = doXml ?? doEndpoint
  let vencimentoOrigem: NotaNormalizada['vencimento_origem'] = doXml
    ? 'xml'
    : doEndpoint
      ? 'endpoint'
      : null

  if (!vencimento) {
    const doTexto = vencimentoDeTextoLivre(parsed.texto_livre, emitidaEm, hoje)
    if (doTexto) {
      vencimento = doTexto.vencimento
      vencimentoOrigem = 'xml_texto'
    }
  }

  if (!vencimento && emitidaEm) {
    const base = new Date(emitidaEm)
    if (!Number.isNaN(base.getTime())) {
      vencimento = new Date(base.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
      vencimentoOrigem = 'estimado'
    }
  }

  const direcao = direcaoDaNota(item.direction)
  const avisos: string[] = []
  if (!direcao.conhecida) avisos.push(`direction desconhecida: ${String(item.direction)}`)

  const natureza = avaliarNatureza(parsed.natureza_operacao)
  // Duas razões independentes para a nota não ser operável. A natureza vem primeiro
  // porque é a mais fundamental: uma remessa não gera crédito em valor NENHUM, e
  // dizer "abaixo de R$ 500" sobre ela explicaria a coisa errada.
  const abaixoDoMinimo = abaixoDoMinimoOperavel(valor, valorMinimoOperavel)

  return {
    ok: true,
    nota: {
      access_key: accessKey,
      nf_id_externo: texto(item.id),
      tipo: tipoDaNota(item.type, parsed.layout),
      direction: direcao.direction,
      numero: texto(item.number) ?? parsed.numero,
      serie: texto(item.series) ?? parsed.serie,
      valor,
      emitida_em: emitidaEm,
      vencimento,
      vencimento_origem: vencimentoOrigem,
      natureza_operacao: parsed.natureza_operacao,
      operavel: natureza.operavel && !abaixoDoMinimo,
      nao_operavel_motivo:
        motivoNaoOperavel(natureza.termo) ??
        (abaixoDoMinimo ? motivoValorAbaixoDoMinimo(valorMinimoOperavel) : null),
      parcelas: parsed.parcelas,
      status_sync: texto(item.status),
      situacao: situacaoDaNota(item.status),
      xml_resumo: parsed.layout === 'resumo',
      avisos,
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
