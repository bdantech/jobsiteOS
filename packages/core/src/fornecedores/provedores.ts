import { normalizarDominio } from '../radar/dominio.js'
import { normalizarTelefoneBr } from './telefone.js'
import type { Confianca, TipoContatoDescoberto } from './schemas.js'

/**
 * A parte PURA dos provedores pagos: desembrulhar respostas, decidir confiança e
 * medir a validade do token.
 *
 * O I/O mora no worker; o que está aqui é tudo que dá para provar sem rede. Não é
 * separação por gosto: a resposta da Nova Vida é o tipo de contrato que só se aprende
 * quebrando, e uma vez aprendido o conhecimento precisa ficar num lugar onde um teste
 * o segure. Um mock de HTTP no worker testaria o nosso mock.
 */

export interface ContatoDeProvedor {
  tipo: TipoContatoDescoberto
  valor: string
  original: string
  nome_pessoa: string | null
  cargo: string | null
  confianca: Confianca
  evidencia: string
}

// ─── Nova Vida TI ───────────────────────────────────────────────────────────

/**
 * O token vem embrulhado, e o embrulho varia.
 *
 * O serviço é ASMX (.NET clássico) exposto como JSON. Nesse formato a resposta pode
 * vir como `{"d": "<token>"}`, como `{"GerarTokenJsonResult": "<token>"}`, como
 * `{"token": "..."}` ou como a string crua — as quatro formas são a mesma API em
 * versões diferentes do stack. Escolher uma e torcer é como a integração passa em
 * homologação e quebra em produção.
 */
export function desembrulharTokenNovaVida(resposta: unknown): string | null {
  if (typeof resposta === 'string') return resposta.trim() || null
  if (typeof resposta !== 'object' || resposta === null) return null
  const r = resposta as Record<string, unknown>
  for (const chave of ['d', 'GerarTokenJsonResult', 'token', 'Token']) {
    const v = r[chave]
    if (typeof v === 'string' && v.trim()) return v.trim()
    // `d` pode trazer outro objeto dentro (duplo embrulho do ASMX).
    if (typeof v === 'object' && v !== null) {
      const dentro = desembrulharTokenNovaVida(v)
      if (dentro) return dentro
    }
  }
  return null
}

/**
 * A armadilha central desta integração: ERRO VEM COM HTTP 200.
 *
 * Credencial errada, cota esgotada e acesso negado voltam como texto puro, status
 * 200, no lugar do token. Um cliente HTTP que só olha o status guarda no cache, por
 * 23,5 horas, a string "USUARIO OU SENHA INCORRETO" como se fosse a credencial — e a
 * integração fica um dia inteiro devolvendo "sem dados" em vez de "não autenticou".
 *
 * O corte por tamanho é a segunda rede: um token real é longo. Qualquer coisa com
 * menos de 10 caracteres não é um, mesmo que não case nenhuma das palavras.
 */
const PADROES_ERRO_NOVAVIDA = /INCORRETO|SEM ACESSO|ATINGIDA|INVALID|NAO AUTORIZAD|NÃO AUTORIZAD|ERRO/i

export function tokenNovaVidaEhErro(valor: string | null): boolean {
  if (!valor) return true
  const v = valor.trim()
  if (v.length < 10) return true
  return PADROES_ERRO_NOVAVIDA.test(v)
}

/**
 * 23,5 horas, e a meia hora a menos é o ponto.
 *
 * A validade real é 24h. Guardar por 24h significa que a última consulta da janela
 * usa um token que expira no meio do voo, e o erro que ela devolve é o mesmo "sem
 * dados" de um CNPJ desconhecido — indistinguível, e por isso invisível. Meia hora de
 * folga custa uma renovação a mais por dia e elimina a classe inteira de falha.
 */
export const VALIDADE_TOKEN_NOVAVIDA_MS = 23.5 * 60 * 60 * 1000

export function expiracaoTokenNovaVida(agora: Date): Date {
  return new Date(agora.getTime() + VALIDADE_TOKEN_NOVAVIDA_MS)
}

export function tokenNovaVidaExpirado(expiraEm: string | Date | null, agora: Date): boolean {
  if (!expiraEm) return true
  const t = expiraEm instanceof Date ? expiraEm.getTime() : Date.parse(expiraEm)
  return !Number.isFinite(t) || t <= agora.getTime()
}

interface SocioNovaVida {
  Nome?: string
  NOME?: string
  nome?: string
  Qualificacao?: string
  QUALIFICACAO?: string
  qualificacao?: string
  Telefones?: unknown
  TELEFONES?: unknown
  telefones?: unknown
  Emails?: unknown
  EMAILS?: unknown
  emails?: unknown
}

function primeiro<T>(obj: Record<string, unknown>, chaves: string[]): T | undefined {
  for (const c of chaves) if (obj[c] !== undefined) return obj[c] as T
  return undefined
}

/** A resposta traz telefone como string, objeto ou lista. Todas viram lista de string. */
function comoLista(valor: unknown): string[] {
  if (valor === null || valor === undefined) return []
  if (typeof valor === 'string') return valor.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(valor)) return valor.flatMap((v) => comoLista(v))
  if (typeof valor === 'object') {
    const o = valor as Record<string, unknown>
    return comoLista(
      primeiro<unknown>(o, ['Telefone', 'TELEFONE', 'telefone', 'Numero', 'NUMERO', 'numero', 'Email', 'EMAIL', 'email', 'Valor', 'valor']),
    )
  }
  return []
}

/**
 * Sócios da Nova Vida → contatos.
 *
 * Confiança MÉDIA, sempre, e não é modéstia. O telefone é do SÓCIO como pessoa
 * física, não da empresa: pode ser o celular pessoal de alguém que não trabalha na
 * operação, ou de um sócio que saiu e continua no cadastro. É um contato de verdade —
 * em PME de construção o sócio quase sempre É quem decide — mas não tem a certeza do
 * campo que o próprio emitente declarou à SEFAZ.
 */
export function mapearSociosNovaVida(
  resposta: unknown,
  opcoes: { dddPadrao?: string | null } = {},
): ContatoDeProvedor[] {
  const raiz = (desembrulharObjeto(resposta) ?? {}) as Record<string, unknown>
  const lista = primeiro<unknown>(raiz, ['Socios', 'SOCIOS', 'socios', 'QuadroSocietario', 'quadroSocietario'])
  const socios: SocioNovaVida[] = Array.isArray(lista) ? (lista as SocioNovaVida[]) : []

  const out: ContatoDeProvedor[] = []
  const vistos = new Set<string>()

  for (const s of socios) {
    const o = s as unknown as Record<string, unknown>
    const nome = (primeiro<string>(o, ['Nome', 'NOME', 'nome']) ?? '').trim() || null
    const cargo = (primeiro<string>(o, ['Qualificacao', 'QUALIFICACAO', 'qualificacao']) ?? '').trim() || null

    for (const bruto of comoLista(primeiro<unknown>(o, ['Telefones', 'TELEFONES', 'telefones']))) {
      const tel = normalizarTelefoneBr(bruto, { dddPadrao: opcoes.dddPadrao })
      if (!tel.e164) continue
      const chave = `telefone|${tel.e164}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      out.push({
        tipo: 'telefone',
        valor: tel.e164,
        original: bruto,
        nome_pessoa: nome,
        cargo,
        confianca: 'media',
        evidencia: `Nova Vida TI · sócio ${nome ?? 'sem nome'}`,
      })
    }

    for (const bruto of comoLista(primeiro<unknown>(o, ['Emails', 'EMAILS', 'emails']))) {
      const e = bruto.trim().toLowerCase()
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) continue
      const chave = `email|${e}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      out.push({
        tipo: 'email',
        valor: e,
        original: bruto,
        nome_pessoa: nome,
        cargo,
        confianca: 'media',
        evidencia: `Nova Vida TI · sócio ${nome ?? 'sem nome'}`,
      })
    }
  }

  return out
}

function desembrulharObjeto(resposta: unknown): unknown {
  if (typeof resposta !== 'object' || resposta === null) return resposta
  const r = resposta as Record<string, unknown>
  for (const chave of ['d', 'NVCHECKJsonResult', 'Resultado', 'resultado']) {
    if (r[chave] !== undefined) {
      const dentro = r[chave]
      // O ASMX às vezes devolve o objeto SERIALIZADO dentro do embrulho.
      if (typeof dentro === 'string') {
        try {
          return JSON.parse(dentro)
        } catch {
          return null
        }
      }
      return desembrulharObjeto(dentro)
    }
  }
  return r
}

// ─── Google Places ──────────────────────────────────────────────────────────

export interface LugarGoogle {
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  /** `id` do Place — é a evidência: dá para reabrir o registro depois. */
  id?: string
}

export interface CadastralParaConferencia {
  municipio: string | null
  uf: string | null
  logradouro: string | null
  numero: string | null
}

/** Sem acento, sem caixa, sem pontuação: é assim que dois endereços se comparam. */
export function achatar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * O endereço do Places bate com o cadastral da Receita?
 *
 * É esta pergunta que decide entre confiança alta e média (§4.1.5), e por isso ela
 * precisa ser mais forte do que "o município aparece no texto". "Sorocaba" também
 * aparece no endereço de uma empresa de Votorantim cuja rua se chama Sorocaba. O
 * critério: município E (UF OU logradouro), todos achatados.
 */
export function enderecoConfere(
  formatado: string | null | undefined,
  cadastral: CadastralParaConferencia,
): boolean {
  const alvo = achatar(formatado)
  if (!alvo) return false
  const mun = achatar(cadastral.municipio)
  if (!mun || !alvo.includes(mun)) return false
  const uf = achatar(cadastral.uf)
  if (uf && new RegExp(`\\b${uf}\\b`).test(alvo)) return true
  const log = achatar(cadastral.logradouro)
  // Logradouro só conta com nome de rua de verdade: "rua" sozinho casa com tudo.
  const nucleo = log.replace(/^(rua|avenida|av|travessa|rodovia|estrada|alameda|praca|r|tv)\s+/, '')
  return nucleo.length >= 5 && alvo.includes(nucleo)
}

/**
 * Um lugar do Google → contatos.
 *
 * Cobertura excelente para PME local de construção: serralheria, marmoraria e
 * locadora de equipamento têm ficha no Maps mesmo sem site — é onde o cliente final
 * as procura. É por isso que este provedor está na camada AUTOMÁTICA apesar de custar:
 * o custo é baixo o bastante para caber no orçamento do lote, e o retorno é alto
 * justamente na faixa em que o Apollo não tem nada.
 */
export function mapearGooglePlaces(
  lugar: LugarGoogle | null | undefined,
  cadastral: CadastralParaConferencia,
  opcoes: { dddPadrao?: string | null } = {},
): ContatoDeProvedor[] {
  if (!lugar) return []
  const confere = enderecoConfere(lugar.formattedAddress, cadastral)
  const confianca: Confianca = confere ? 'alta' : 'baixa'
  const ondeBase = lugar.id ? `Google Places · ${lugar.id}` : 'Google Places'
  const onde = confere ? `${ondeBase} (endereço confere)` : `${ondeBase} (endereço NÃO confere)`

  const out: ContatoDeProvedor[] = []

  const bruto = lugar.nationalPhoneNumber ?? lugar.internationalPhoneNumber ?? null
  if (bruto) {
    const tel = normalizarTelefoneBr(bruto, { dddPadrao: opcoes.dddPadrao })
    if (tel.e164) {
      out.push({
        tipo: 'telefone',
        valor: tel.e164,
        original: bruto,
        nome_pessoa: null,
        cargo: null,
        confianca,
        evidencia: onde,
      })
    }
  }

  const site = normalizarDominio(lugar.websiteUri)
  if (site) {
    out.push({
      tipo: 'site',
      valor: site,
      original: lugar.websiteUri as string,
      nome_pessoa: null,
      cargo: null,
      // O site vem do próprio dono da ficha; ele não depende de o endereço bater.
      confianca: confere ? 'alta' : 'media',
      evidencia: onde,
    })
  }

  return out
}

// ─── Claude com busca web ───────────────────────────────────────────────────

export interface ContatoDoClaude {
  tipo?: string
  valor?: string
  nome_pessoa?: string | null
  cargo?: string | null
  confianca?: string
  evidencia?: string | null
}

/**
 * O JSON que o Claude devolve, filtrado.
 *
 * SEM EVIDÊNCIA, DESCARTA (§4.2c, explícito). Um telefone sem URL de origem é
 * indistinguível de um telefone inventado — e um modelo com busca web habilitada que
 * não achou nada ainda assim produz um número plausível se o prompt o deixar. A
 * evidência não é auditoria: é o teste de que a busca aconteceu.
 *
 * A confiança também é rebaixada aqui, e não no prompt: `alta` vinda do modelo vira
 * `media`. "Alta" no nosso vocabulário significa campo estruturado declarado pela
 * própria empresa (o `emit` da NF-e, a ficha do Places conferida) — nada que saia de
 * uma leitura de página web alcança isso, por melhor que a leitura seja.
 */
export function filtrarContatosDoClaude(
  bruto: unknown,
  opcoes: { dddPadrao?: string | null } = {},
): ContatoDeProvedor[] {
  const raiz = bruto as { contatos?: ContatoDoClaude[] } | null
  const lista = Array.isArray(raiz?.contatos) ? raiz.contatos : []
  const out: ContatoDeProvedor[] = []
  const vistos = new Set<string>()

  for (const c of lista) {
    const evidencia = (c.evidencia ?? '').trim()
    if (!/^https?:\/\/\S+$/i.test(evidencia)) continue

    const tipo = (c.tipo ?? '').trim().toLowerCase()
    const valorBruto = (c.valor ?? '').trim()
    if (!valorBruto) continue

    let valor = valorBruto
    if (tipo === 'telefone' || tipo === 'whatsapp') {
      const tel = normalizarTelefoneBr(valorBruto, { dddPadrao: opcoes.dddPadrao })
      if (!tel.e164) continue
      valor = tel.e164
    } else if (tipo === 'email') {
      valor = valorBruto.toLowerCase()
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(valor)) continue
    } else if (tipo === 'site') {
      const d = normalizarDominio(valorBruto)
      if (!d) continue
      valor = d
    } else if (tipo === 'instagram') {
      valor = valorBruto.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '').toLowerCase()
      if (!/^[a-z0-9_.]{3,30}$/.test(valor)) continue
    } else {
      continue
    }

    const chave = `${tipo}|${valor}`
    if (vistos.has(chave)) continue
    vistos.add(chave)

    const declarada = (c.confianca ?? '').toLowerCase()
    const confianca: Confianca = declarada === 'baixa' ? 'baixa' : 'media'

    out.push({
      tipo: tipo as TipoContatoDescoberto,
      valor,
      original: valorBruto,
      nome_pessoa: c.nome_pessoa?.trim() || null,
      cargo: c.cargo?.trim() || null,
      confianca,
      evidencia,
    })
  }

  return out
}
