import { z } from 'zod'
import { isValidCnpj, normalizeCnpj } from '../schemas/cnpj.js'
import { TIPOS_DOC_CONTABEIS, type TipoDocContabil } from './analise.js'
import type { PayloadProducao } from './precificacao.js'
import { ESTAGIOS_ANALISE, type EstagioAnalise } from './schemas.js'

/**
 * O CONTRATO da API de Crédito (04n): o que a plataforma de produção manda para
 * cá e o que ela recebe de volta.
 *
 * Vive no core, e não na rota, porque as duas pontas precisam dele: a rota valida
 * a entrada com estes schemas, e o worker monta o payload de saída com o mesmo
 * `PayloadCredito`. Um contrato definido dentro do handler é um contrato que o
 * webhook copia — e cópias divergem na primeira mudança feita em só uma.
 */

// ─── Eventos ────────────────────────────────────────────────────────────────

export const EVENTOS_WEBHOOK = [
  'credito.analise_criada',
  'credito.estagio_alterado',
  'credito.documento_recebido',
  'credito.limite_alterado',
  'credito.decisao_registrada',
  // 04o: as condições comerciais foram definidas e publicadas. É o único evento
  // ACIONÁVEL do contrato — o `payload_producao` dele vira um POST do outro lado.
  'credito.condicoes_definidas',
  'webhook.teste',
] as const
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number]

export const EVENTO_WEBHOOK_LABELS: Record<EventoWebhook, string> = {
  'credito.analise_criada': 'Análise criada',
  'credito.estagio_alterado': 'Estágio alterado',
  'credito.documento_recebido': 'Documento recebido',
  'credito.limite_alterado': 'Limite alterado',
  'credito.decisao_registrada': 'Decisão registrada',
  'credito.condicoes_definidas': 'Condições comerciais definidas',
  'webhook.teste': 'Evento de teste',
}

// ─── Entrada: criar análise ─────────────────────────────────────────────────

/**
 * O CNPJ aceita máscara e sai em 14 dígitos, com dígito verificador conferido.
 *
 * Checar só o tamanho aceitaria `00000000000000`, e um CNPJ inválido aqui não é
 * um erro de digitação: é uma ficha de empresa corrompida que todo módulo a
 * jusante herda, porque o CNPJ é a chave natural de `empresas`.
 */
const cnpjApi = z
  .string()
  .transform(normalizeCnpj)
  .refine(isValidCnpj, { message: 'CNPJ inválido (dígito verificador não confere).' })

const tipoDocSchema = z.enum(TIPOS_DOC_CONTABEIS as unknown as [string, ...string[]])

export const documentoExternoSchema = z.object({
  tipo: tipoDocSchema,
  nome_arquivo: z.string().trim().min(1).max(300),
  /** Quando vem `url`, o worker BAIXA e guarda no nosso bucket (§2.2). */
  url: z.string().url().optional().nullable(),
  exercicio: z.number().int().min(1900).max(2100).optional().nullable(),
  external_id: z.string().trim().max(200).optional().nullable(),
})
export type DocumentoExterno = z.infer<typeof documentoExternoSchema>

export const ORIGENS_ANALISE_EXTERNA = [
  'cadastro_plataforma',
  'solicitacao_cliente',
  'renovacao',
] as const

export const criarAnaliseExternaSchema = z.object({
  external_id: z.string().trim().min(1).max(200),
  cnpj: cnpjApi,
  razao_social: z.string().trim().max(300).optional().nullable(),
  /** Só sacado nesta versão (§8). O campo existe para o contrato não quebrar depois. */
  papel: z.literal('sacado').default('sacado'),
  limite_solicitado: z.number().positive().max(1_000_000_000).optional().nullable(),
  origem: z.enum(ORIGENS_ANALISE_EXTERNA).default('cadastro_plataforma'),
  contato: z
    .object({
      nome: z.string().trim().max(160).optional().nullable(),
      email: z.string().trim().email().max(200).optional().nullable(),
      telefone: z.string().trim().max(40).optional().nullable(),
    })
    .optional()
    .nullable(),
  observacoes: z.string().trim().max(4000).optional().nullable(),
  documentos: z.array(documentoExternoSchema).max(50).optional().default([]),
})
export type CriarAnaliseExterna = z.infer<typeof criarAnaliseExternaSchema>

// ─── Checklist de documentos ────────────────────────────────────────────────

/**
 * O que falta para a análise sair de `docs_pendentes`.
 *
 * A lista de essenciais vem de `credito_config.docs` — a MESMA que a esteira usa
 * na tela. Ter uma constante aqui faria a API prometer um checklist e o Crédito
 * cobrar outro.
 */
export function documentosFaltantes(
  recebidos: readonly string[],
  essenciais: readonly string[],
): string[] {
  const tem = new Set(recebidos)
  return essenciais.filter((e) => !tem.has(e))
}

/**
 * O estágio com que a análise NASCE. Nunca depois de nascer: a partir daí quem
 * manda é a esteira, e o payload da integração é insumo, não decisão (§1).
 *
 * Dossiê completo nasce em `docs_recebidos`, e não mais em `solicitada`: é o mesmo
 * destino a que o gatilho do checklist leva quando o último essencial chega depois.
 * O fato observado é um só — "temos os documentos" — e ele não pode produzir dois
 * estágios diferentes conforme a hora em que o arquivo chegou.
 */
export function estagioInicial(faltantes: readonly string[]): EstagioAnalise {
  return faltantes.length > 0 ? 'docs_pendentes' : 'docs_recebidos'
}

// ─── Entrega do webhook ─────────────────────────────────────────────────────

/**
 * 1min, 5min, 15min, 1h, 6h, 24h — seis tentativas, cobrindo pouco mais de um
 * dia. Curto no começo porque a falha mais comum é um deploy do outro lado; longo
 * no fim porque, passada uma hora, o que resta é indisponibilidade de verdade e
 * insistir de minuto em minuto só enche o log.
 */
export const BACKOFF_WEBHOOK_MIN = [1, 5, 15, 60, 360, 1440] as const
export const MAX_TENTATIVAS_WEBHOOK = BACKOFF_WEBHOOK_MIN.length

/** Devolve `null` quando as tentativas acabaram — aí a entrega vira 'falhou'. */
export function proximaTentativaWebhook(tentativasFeitas: number, agora = new Date()): Date | null {
  const minutos = BACKOFF_WEBHOOK_MIN[tentativasFeitas]
  if (minutos === undefined) return null
  return new Date(agora.getTime() + minutos * 60_000)
}

// ─── Payload de saída ───────────────────────────────────────────────────────

/**
 * O payload COMPLETO (§3.2). Uma interface e não um objeto solto porque o
 * contrato promete que **nenhuma chave é omitida** — campo sem valor vai como
 * `null`. Um consumidor que faz `payload.credito.score` não pode receber
 * `undefined` num dia porque a empresa não tinha score naquele momento.
 */
export interface PayloadCredito {
  evento: EventoWebhook
  evento_id: string
  ocorrido_em: string
  analise: {
    analise_id: string
    external_id: string | null
    estagio_anterior: EstagioAnalise | null
    estagio_atual: EstagioAnalise
    limite_solicitado: number | null
    limite_aprovado: number | null
    validade: string | null
    motivo: string | null
    decisao_final: string | null
    atualizada_em: string | null
  }
  empresa: {
    cnpj: string
    razao_social: string | null
    tipo: string | null
    uf: string | null
    municipio: string | null
    situacao_cadastral: string | null
    porte: string | null
    faturamento_estimado: number | null
    faturamento_origem: string | null
  }
  credito: {
    score: number | null
    faixa: string | null
    completude: number | null
    chance_concessao: number | null
    limite_potencial: number | null
    tem_protesto: boolean | null
    analise_proprietaria: {
      recomendacao: string | null
      limite_recomendado: number | null
      cenarios: Record<string, number> | null
    } | null
    seguradora: {
      nome: string | null
      status: string | null
      limite: number | null
      expira_em: string | null
    } | null
  }
  documentos: {
    recebidos: string[]
    faltantes: string[]
  }
  /**
   * As condições comerciais publicadas (04o §7). `null` enquanto ninguém publicou —
   * a CHAVE existe sempre, como todas as outras, e vai em TODOS os eventos, não só
   * no `credito.condicoes_definidas`.
   *
   * É o único bloco acionável do payload: `payload_producao` é repassado como está
   * para o `POST /api/backoffice/credit-analyses` do outro lado.
   */
  condicoes_comerciais: {
    definidas_em: string
    versao: number
    payload_producao: PayloadProducao
  } | null
}

/** Os estágios, para o glossário da documentação e para validar entrada. */
export const ESTAGIOS_PUBLICOS: readonly EstagioAnalise[] = ESTAGIOS_ANALISE

export type { TipoDocContabil }
