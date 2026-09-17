import { formatCnpj } from '../schemas/cnpj.js'

/**
 * Os documentos da análise indo à seguradora POR E-MAIL (04d §4.2).
 *
 * ── POR QUE E-MAIL, E NÃO A API ─────────────────────────────────────────────
 * A rota de anexo (`covers/{id}/documents`) nunca foi confirmada — entrou no código com
 * essa ressalva escrita, porque a alternativa era não mandar nada. Em 17/09/2026 a
 * própria Atradius respondeu que a API NÃO recebe documento, e pediu que a papelada vá
 * por e-mail junto do pedido de cobertura. Então este arquivo substitui aquela rota: o
 * destino mudou de host para caixa de entrada, e o resto do contrato continua igual —
 * quem escolhe os documentos é o analista, e cada linha de `analise_docs` continua
 * gravando se foi ou não.
 *
 * ── O QUE MORA AQUI ─────────────────────────────────────────────────────────
 * A leitura da configuração, o texto do e-mail e o agrupamento por tamanho. Tudo puro:
 * o worker traz os bytes e chama o Resend, e o que ele manda é decidido (e testado)
 * aqui. Nada neste arquivo toca rede, disco ou builtin do Node — ele é alcançável pelo
 * barril do core, que o bundler do Next carrega no browser.
 */

// ─── Configuração (credito_config.documentos_email) ─────────────────────────

export interface DestinatarioDocumentos {
  email: string
  /** Opcional, e só cosmético: entra no "Nome <email>" do cabeçalho. */
  nome?: string | null
}

export interface EmailDocumentos {
  /** Para quem os documentos vão. Lista VAZIA significa que nada sai. */
  destinatarios: DestinatarioDocumentos[]
  /**
   * Para onde a Atradius responde.
   *
   * Importa mais do que parece: o remetente é um subdomínio de automação, e uma resposta
   * do analista da seguradora caindo nele é uma resposta que ninguém lê. Vazio mantém o
   * comportamento do Resend (responde para o remetente).
   */
  responder_para: string | null
  /** `null` usa `ASSUNTO_PADRAO`. Os mesmos marcadores do padrão valem aqui. */
  assunto_template: string | null
}

/**
 * Validação deliberadamente frouxa: `algo@algo.dominio`.
 *
 * Um regex que tenta implementar a RFC 5322 rejeita endereço válido e ninguém descobre
 * por quê. O que esta guarda precisa pegar é o erro de digitação óbvio e o campo em
 * branco — quem decide de verdade se o endereço existe é o bounce, que o webhook do
 * Resend já lê.
 */
export function ehEmailValido(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
}

/**
 * A lista limpa: sem inválido, sem repetido, sem espaço sobrando.
 *
 * A deduplicação é por endereço em minúsculas porque e-mail não diferencia caixa no
 * domínio e, na prática, nenhum provedor que a gente usa diferencia na caixa local. Dois
 * nomes diferentes para o mesmo endereço mandariam o mesmo anexo duas vezes.
 */
export function normalizarDestinatarios(bruto: unknown): DestinatarioDocumentos[] {
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const saida: DestinatarioDocumentos[] = []
  for (const item of bruto) {
    const email = typeof item === 'string' ? item : (item as { email?: unknown } | null)?.email
    if (!ehEmailValido(email)) continue
    const limpo = email.trim()
    const chave = limpo.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const nome = typeof item === 'object' && item !== null ? (item as { nome?: unknown }).nome : null
    saida.push({ email: limpo, nome: typeof nome === 'string' && nome.trim() !== '' ? nome.trim() : null })
  }
  return saida
}

/** Lê o bloco `credito_config.documentos_email` sem confiar em nada dele. */
export function lerEmailDocumentos(bruto: unknown): EmailDocumentos {
  const b = (bruto ?? {}) as Record<string, unknown>
  const responder = b.responder_para
  const assunto = b.assunto_template
  return {
    destinatarios: normalizarDestinatarios(b.destinatarios),
    responder_para: ehEmailValido(responder) ? responder.trim() : null,
    assunto_template:
      typeof assunto === 'string' && assunto.trim() !== '' ? assunto.trim() : null,
  }
}

/** `Nome <email>` quando há nome; só o endereço quando não. O que o Resend aceita em `to`. */
export function enderecoCompleto(d: DestinatarioDocumentos): string {
  // Aspas no nome com vírgula: sem elas o cabeçalho vira DOIS destinatários, e o segundo
  // não existe. É o único caso em que o nome pode quebrar o envio.
  if (!d.nome) return d.email
  const nome = /[,;<>]/.test(d.nome) ? `"${d.nome.replace(/"/g, '')}"` : d.nome
  return `${nome} <${d.email}>`
}

// ─── Tamanho: o que cabe num e-mail ─────────────────────────────────────────

/**
 * Teto do CONTEÚDO BRUTO de anexos por e-mail.
 *
 * O Resend aceita 40 MB por mensagem, mas o anexo viaja em base64 — cada 3 bytes viram
 * 4, um terço a mais. 25 MB de PDF já chegam perto do teto depois de codificados, e o
 * que sobra é cabeçalho e corpo. 20 MB é o número com folga para os dois.
 *
 * Quem estoura não é recusado: vai num segundo e-mail (ver `agruparAnexos`). Um balanço
 * que não chega porque veio na mesma leva que o SPED é exatamente o tipo de falha que
 * só aparece semanas depois, quando a seguradora cobra o documento.
 */
export const TETO_ANEXOS_BYTES = 20 * 1024 * 1024

export interface AnexoDimensionado {
  id: string
  bytes: number
}

export interface AgrupamentoAnexos<T extends AnexoDimensionado> {
  /** Cada lote é um e-mail. Vazio quando nenhum documento coube. */
  lotes: T[][]
  /** Documento que sozinho já estoura o teto — esse não cabe em e-mail nenhum. */
  recusados: Array<{ id: string; motivo: string }>
}

/**
 * Divide os documentos em levas que cabem num e-mail cada.
 *
 * Ordem preservada de propósito: a pasta da análise já vem ordenada por tipo, e embaralhar
 * para "encher melhor" faria o balanço de 2025 chegar depois do contrato social, em outro
 * e-mail, sem explicação. Empacotamento ótimo aqui não vale o que custa em confusão.
 */
export function agruparAnexos<T extends AnexoDimensionado>(
  documentos: readonly T[],
  teto: number = TETO_ANEXOS_BYTES,
): AgrupamentoAnexos<T> {
  const lotes: T[][] = []
  const recusados: Array<{ id: string; motivo: string }> = []
  let atual: T[] = []
  let soma = 0

  for (const doc of documentos) {
    if (doc.bytes > teto) {
      recusados.push({
        id: doc.id,
        motivo: `O arquivo tem ${mb(doc.bytes)} e o limite por e-mail é ${mb(teto)}. Envie este documento à parte.`,
      })
      continue
    }
    if (atual.length > 0 && soma + doc.bytes > teto) {
      lotes.push(atual)
      atual = []
      soma = 0
    }
    atual.push(doc)
    soma += doc.bytes
  }
  if (atual.length > 0) lotes.push(atual)

  return { lotes, recusados }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ─── O texto do e-mail ──────────────────────────────────────────────────────

export interface DocumentoNoEmail {
  /** O id do catálogo (`balanco_patrimonial`, `dre`, …). */
  tipo: string
  /** O rótulo do catálogo, quando a configuração tem um. Cai no tipo quando não. */
  rotulo?: string | null
  nome_arquivo: string
}

export interface DadosDoEmailDocumentos {
  cnpj: string
  razao_social: string | null
  /** O `coverId` que a Atradius devolveu. É por ele que o analista de lá acha o pedido. */
  case_id: string | null
  limite_solicitado: number | null
  moeda: string | null
  /** O id da nossa análise. Vai no corpo para casar o e-mail com a linha daqui. */
  referencia: string
  documentos: DocumentoNoEmail[]
  /** `1` e `2` quando os anexos não couberam num e-mail só. */
  parte?: number
  de?: number
}

/**
 * Marcadores: `{cnpj}`, `{empresa}`, `{case_id}`, `{referencia}`.
 *
 * O CNPJ vem antes do nome porque é por ele que a seguradora indexa o buyer — e um
 * assunto que começa pelo nome faz a busca na caixa de entrada depender de como alguém
 * digitou "Engenharia LTDA".
 */
export const ASSUNTO_PADRAO = 'Documentos — {cnpj} {empresa} — pedido {case_id}'

export function montarAssunto(template: string | null, d: DadosDoEmailDocumentos): string {
  const base = (template ?? ASSUNTO_PADRAO)
    .replaceAll('{cnpj}', formatCnpj(d.cnpj))
    .replaceAll('{empresa}', d.razao_social ?? '')
    .replaceAll('{case_id}', d.case_id ?? 'sem número')
    .replaceAll('{referencia}', d.referencia)
    // Um template com marcador vazio deixa espaço duplo e traço solto; limpar aqui é mais
    // barato que pedir ao usuário um template por caso.
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+—\s*$/, '')
    .trim()
  return d.de && d.de > 1 ? `${base} (${d.parte}/${d.de})` : base
}

/**
 * O corpo, em texto puro.
 *
 * Sem HTML de propósito: o destinatário é o analista de uma seguradora, o conteúdo é uma
 * lista de arquivos, e um template com marca não sobrevive ao encaminhamento interno que
 * essa mensagem certamente vai ter. O que precisa sobreviver é o CNPJ, o número do pedido
 * e a nossa referência — em texto, eles sobrevivem a qualquer cliente de e-mail.
 */
export function montarCorpo(d: DadosDoEmailDocumentos): string {
  const linhas: string[] = []

  linhas.push(
    d.de && d.de > 1
      ? `Segue a documentação de apoio ao pedido de cobertura abaixo (parte ${d.parte} de ${d.de}).`
      : 'Segue a documentação de apoio ao pedido de cobertura abaixo.',
  )
  linhas.push('')
  linhas.push(`Empresa: ${d.razao_social ?? '(razão social não informada)'}`)
  linhas.push(`CNPJ: ${formatCnpj(d.cnpj)}`)
  if (d.case_id) linhas.push(`Pedido na Atradius: ${d.case_id}`)
  if (d.limite_solicitado && d.limite_solicitado > 0) {
    linhas.push(`Limite solicitado: ${moeda(d.limite_solicitado, d.moeda)}`)
  }
  linhas.push(`Nossa referência: ${d.referencia}`)
  linhas.push('')
  linhas.push(
    d.documentos.length === 1 ? 'Documento anexo:' : `Documentos anexos (${d.documentos.length}):`,
  )
  for (const doc of d.documentos) {
    linhas.push(`- ${doc.rotulo ?? doc.tipo}: ${doc.nome_arquivo}`)
  }
  linhas.push('')
  linhas.push('Qualquer documento adicional necessário, é só responder este e-mail.')
  linhas.push('')
  linhas.push('ONE OS')

  return linhas.join('\n')
}

function moeda(valor: number, codigo: string | null): string {
  const cod = codigo ?? 'BRL'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cod }).format(valor)
  } catch {
    // Moeda desconhecida não pode derrubar o envio: o número ainda informa.
    return `${cod} ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  }
}
