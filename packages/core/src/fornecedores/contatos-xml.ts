import { blocos, texto } from '../antecipacao/nfe-xml.js'
import { dominioDeEmail, normalizarDominio } from '../radar/dominio.js'
import { normalizarTelefoneBr, type TelefoneNormalizado } from './telefone.js'
import type { Confianca, TipoContatoDescoberto } from './schemas.js'

/**
 * Camada 0 da cascata (§4.1.1): os contatos que já estão dentro do XML das notas que
 * o fornecedor emitiu contra nossos sacados.
 *
 * É a melhor fonte para PME de construção, e não por pouco. Medido nos 688
 * fornecedores que entram no funil pelo corte de volume: 528 (77%) têm telefone no
 * bloco `<emit>` e 201 (29%) têm e-mail. O cadastral da Receita, para os mesmos 688,
 * tem telefone em 75 (11%) e e-mail em 70 (10%). O XML ganha por SETE VEZES e custa
 * zero — ele já está no nosso banco, guardado desde o Prompt 04.
 *
 * ─── O EMITENTE, E SÓ ELE ─────────────────────────────────────────────────────
 *
 * `<dest><enderDest><fone>` é o telefone do NOSSO CLIENTE. Ele está no mesmo
 * documento, na mesma tag `fone`, e uma busca por `fone` no XML inteiro o traria.
 * Gravá-lo como contato do fornecedor faria o originador ligar para a construtora
 * dizendo que quer falar com o fornecedor dela — e o número teria confiança "alta",
 * porque veio de uma tag estruturada. Por isso todo campo estruturado é lido DENTRO
 * do bloco `<emit>`, nunca no documento.
 *
 * ─── AGREGAÇÃO: A REPETIÇÃO É O SINAL ────────────────────────────────────────
 *
 * Um fornecedor tem dezenas de notas na janela, e o mesmo telefone aparece em todas.
 * Isso não é ruído a deduplicar e esquecer: é a evidência mais barata que existe de
 * que o número está VIVO. Um telefone que aparece nas 40 notas dos últimos 90 dias é
 * outra coisa que um que apareceu numa nota de 170 dias atrás. `frequencia` guarda a
 * contagem e `ultima_vez_visto` guarda a recência — juntos, são o critério de ordem.
 */

export interface ContatoExtraido {
  tipo: TipoContatoDescoberto
  /** Forma canônica: E.164 para telefone/whatsapp, minúsculo para e-mail/site. */
  valor: string
  /** Como estava escrito na origem. É o que se mostra quando difere do canônico. */
  original: string
  confianca: Confianca
  evidencia: string
  /** Em quantas notas distintas esta mesma informação apareceu. */
  frequencia: number
  /** Data de emissão da nota mais recente em que apareceu (YYYY-MM-DD). */
  ultima_vez_visto: string | null
  telefone?: TelefoneNormalizado
}

export interface NotaParaExtracao {
  /** Só para a evidência: "NF 12345". */
  numero: string | null
  /** YYYY-MM-DD. Decide a recência. */
  emitida_em: string | null
  raw_xml: string | null
}

/**
 * O que NÃO pode virar contato do fornecedor mesmo aparecendo no texto livre.
 *
 * O `infCpl` é onde a contabilidade escreve de tudo, e "qualquer coisa" inclui o
 * e-mail do setor de contas a pagar do sacado ("enviar boleto para
 * financeiro@construtora.com.br") — que é o caso mais comum de todos, porque é para
 * isso que o campo é usado.
 */
export interface ExclusoesExtracao {
  /** CNPJs cujo domínio de e-mail e telefones devem ser ignorados (o sacado). */
  dominiosExcluidos?: readonly string[]
  telefonesExcluidos?: readonly string[]
}

// ─── Padrões do texto livre ─────────────────────────────────────────────────

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/**
 * Telefone escrito em prosa. Exige DDD entre parênteses OU separador, porque sem
 * isso o padrão casa com qualquer sequência de 10-11 dígitos — e `infCpl` é cheio
 * delas: chave de acesso, número de pedido, CNPJ, inscrição estadual.
 */
const RE_TELEFONE_PROSA = /(?:\(\d{2}\)\s?|\b\d{2}\s)\d{4,5}[-.\s]?\d{4}\b/g

const RE_INSTAGRAM = /(?:instagram\.com\/|@)([A-Za-z0-9_.]{3,30})\b/g

/**
 * O `infCpl` diz de quem é o contato — quando alguém se dá ao trabalho de rotular.
 *
 * Esta linha saiu de uma nota real da base: `Email do Destinatario:
 * fernandabin@imincorporadora.com.br`. É o e-mail do NOSSO CLIENTE, escrito no XML do
 * fornecedor, num campo livre onde nenhuma regra estrutural o pega. Gravá-lo como
 * contato do fornecedor faria o originador escrever para a incorporadora pedindo para
 * falar com o fornecedor dela — e o e-mail estaria no card com evidência e tudo.
 *
 * A janela de 60 caracteres antes do achado é o alcance típico do rótulo. Maior
 * pegaria a frase anterior, que fala de outra coisa.
 */
const RE_ROTULO_DO_OUTRO_LADO = /destinat[áa]rio|comprador|do cliente|tomador/i

const RE_SITE = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi

/** Tudo que soa como e-mail mas é o campo obrigatório preenchido de qualquer jeito. */
const EMAILS_PLACEHOLDER = new Set([
  'nao@tem.com', 'sememail@sememail.com', 'a@a.com', 'x@x.com', 'teste@teste.com',
  'naotem@naotem.com', 'email@email.com', 'nao@possui.com',
])

function limparEmail(valor: string): string | null {
  const e = valor.trim().toLowerCase().replace(/[.,;:)\]]+$/, '')
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null
  if (EMAILS_PLACEHOLDER.has(e)) return null
  const host = e.split('@')[1]
  return normalizarDominio(host) ? e : null
}

// ─── Acumulador ─────────────────────────────────────────────────────────────

interface Acumulado {
  tipo: TipoContatoDescoberto
  valor: string
  original: string
  confianca: Confianca
  evidencia: string
  notas: Set<string>
  ultima: string | null
  telefone?: TelefoneNormalizado
}

const FORCA: Record<Confianca, number> = { alta: 3, media: 2, baixa: 1 }

/**
 * Uma nota, sem estado. Exportado porque o backfill do worker processa nota a nota e
 * o teste precisa de um XML de cada vez.
 */
export function contatosDoXmlNfe(
  nota: NotaParaExtracao,
  opcoes: { dddPadrao?: string | null } & ExclusoesExtracao = {},
): ContatoExtraido[] {
  const xml = nota.raw_xml
  if (!xml) return []

  const achados: ContatoExtraido[] = []
  const rotulo = nota.numero ? `NF ${nota.numero}` : 'NF-e'
  const visto = nota.emitida_em?.slice(0, 10) ?? null

  const push = (
    tipo: TipoContatoDescoberto,
    valor: string,
    original: string,
    confianca: Confianca,
    onde: string,
    telefone?: TelefoneNormalizado,
  ): void => {
    achados.push({
      tipo,
      valor,
      original,
      confianca,
      evidencia: `${rotulo} · ${onde}`,
      frequencia: 1,
      ultima_vez_visto: visto,
      ...(telefone ? { telefone } : {}),
    })
  }

  const excluirTel = new Set(
    (opcoes.telefonesExcluidos ?? [])
      .map((t) => normalizarTelefoneBr(t, { dddPadrao: opcoes.dddPadrao }).e164)
      .filter((t): t is string => t !== null),
  )
  const excluirDom = new Set(
    (opcoes.dominiosExcluidos ?? [])
      .map((d) => normalizarDominio(d))
      .filter((d): d is string => d !== null),
  )

  // ── Estruturado: SÓ o bloco do emitente ───────────────────────────────────
  const emit = texto(xml, 'emit') ?? ''

  const fone = texto(emit, 'fone')
  if (fone) {
    const tel = normalizarTelefoneBr(fone, { dddPadrao: opcoes.dddPadrao })
    if (tel.e164 && !excluirTel.has(tel.e164)) {
      // Alta: é campo estruturado, declarado pelo próprio emitente à SEFAZ, numa nota
      // que ele emitiu. Não há fonte mais direta do que essa.
      push('telefone', tel.e164, fone, 'alta', 'emit/enderEmit/fone', tel)
    }
  }

  const emailEmit = texto(emit, 'email')
  const emailLimpo = emailEmit ? limparEmail(emailEmit) : null
  if (emailLimpo) {
    const host = emailLimpo.split('@')[1] as string
    if (!excluirDom.has(normalizarDominio(host) ?? host)) {
      push('email', emailLimpo, emailEmit as string, 'alta', 'emit/email')
      // O domínio corporativo do e-mail do emitente é um candidato a site — e é o
      // insumo da etapa 4 (cascata de domínio) sem gastar nada.
      const dom = dominioDeEmail(emailLimpo)
      if (dom) push('site', dom, dom, 'media', 'domínio do e-mail do emitente')
    }
  }

  // ── Texto livre: infCpl e obsCont ─────────────────────────────────────────
  //
  // Confiança MÉDIA, sempre. O campo é livre e serve ao sacado tanto quanto ao
  // emitente: "dúvidas: (11) 3333-4444" pode ser o telefone de quem emitiu ou o do
  // financeiro de quem recebe. A tela mostra a evidência com o trecho, e quem liga
  // decide — o que não se pode é vender esse palpite como campo estruturado.
  const livres: string[] = []
  const infCpl = texto(xml, 'infCpl')
  if (infCpl) livres.push(infCpl)
  for (const obs of blocos(xml, 'obsCont')) {
    const v = texto(obs, 'xTexto')
    if (v) livres.push(v)
  }
  const livre = livres.join('\n')

  if (livre) {
    for (const m of livre.matchAll(RE_EMAIL)) {
      const e = limparEmail(m[0])
      if (!e) continue
      const host = normalizarDominio(e.split('@')[1]) ?? ''
      if (excluirDom.has(host)) continue
      if (rotuladoComoDoOutroLado(livre, m.index ?? 0)) continue
      push('email', e, m[0], 'media', trecho(livre, m.index ?? 0))
    }
    for (const m of livre.matchAll(RE_TELEFONE_PROSA)) {
      const tel = normalizarTelefoneBr(m[0], { dddPadrao: opcoes.dddPadrao })
      if (!tel.e164 || excluirTel.has(tel.e164)) continue
      if (rotuladoComoDoOutroLado(livre, m.index ?? 0)) continue
      push('telefone', tel.e164, m[0], 'media', trecho(livre, m.index ?? 0), tel)
    }
    for (const m of livre.matchAll(RE_INSTAGRAM)) {
      const perfil = (m[1] ?? '').toLowerCase()
      // `@` casa com o meio de qualquer e-mail. Sem esta guarda, `nf@acme.com.br`
      // vira o Instagram "acme".
      if (!perfil || perfil.includes('.com') || livre.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0).match(/[A-Za-z0-9]/)) continue
      push('instagram', perfil, m[0], 'baixa', trecho(livre, m.index ?? 0))
    }
    for (const m of livre.matchAll(RE_SITE)) {
      const dom = normalizarDominio(m[1] ?? '')
      if (!dom || excluirDom.has(dom)) continue
      // `.com.br` sem `www` casa com o final de qualquer e-mail já capturado acima.
      if (livre.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0) === '@') continue
      if (!/\.(com|net|org|ind|eng|arq|srv)(\.br)?$|\.br$/.test(dom)) continue
      push('site', dom, m[0], 'baixa', trecho(livre, m.index ?? 0))
    }
  }

  return achados
}

/** O texto logo antes do achado atribui o contato ao sacado? */
function rotuladoComoDoOutroLado(texto: string, pos: number): boolean {
  return RE_ROTULO_DO_OUTRO_LADO.test(texto.slice(Math.max(0, pos - 60), pos))
}

/** Um pedaço legível em volta do achado — é a `evidencia` que a tela mostra. */
function trecho(texto: string, pos: number): string {
  const de = Math.max(0, pos - 30)
  const ate = Math.min(texto.length, pos + 60)
  return `infCpl: …${texto.slice(de, ate).replace(/\s+/g, ' ').trim()}…`
}

/**
 * Todas as notas de um fornecedor, agregadas. É o que o job grava.
 *
 * A confiança do agregado é a MAIOR entre as ocorrências, não a última nem a média:
 * o mesmo número achado uma vez em `emit/enderEmit/fone` e cinco vezes no `infCpl`
 * continua sendo um número declarado à SEFAZ. Rebaixá-lo pela maioria seria deixar o
 * texto livre desmentir o campo estruturado.
 */
export function agregarContatosDoFornecedor(
  notas: readonly NotaParaExtracao[],
  opcoes: { dddPadrao?: string | null } & ExclusoesExtracao = {},
): ContatoExtraido[] {
  const mapa = new Map<string, Acumulado>()

  for (const [i, nota] of notas.entries()) {
    // Duas notas podem repetir número (série diferente); o índice desempata para que
    // a frequência conte NOTAS e não ocorrências dentro da mesma nota.
    const idNota = nota.numero ? `${nota.numero}#${i}` : String(i)
    for (const c of contatosDoXmlNfe(nota, opcoes)) {
      const chave = `${c.tipo}|${c.valor}`
      const atual = mapa.get(chave)
      if (!atual) {
        mapa.set(chave, {
          tipo: c.tipo,
          valor: c.valor,
          original: c.original,
          confianca: c.confianca,
          evidencia: c.evidencia,
          notas: new Set([idNota]),
          ultima: c.ultima_vez_visto,
          ...(c.telefone ? { telefone: c.telefone } : {}),
        })
        continue
      }
      atual.notas.add(idNota)
      if (FORCA[c.confianca] > FORCA[atual.confianca]) {
        atual.confianca = c.confianca
        atual.evidencia = c.evidencia
      }
      if (c.ultima_vez_visto && (!atual.ultima || c.ultima_vez_visto > atual.ultima)) {
        atual.ultima = c.ultima_vez_visto
      }
    }
  }

  return [...mapa.values()]
    .map((a) => ({
      tipo: a.tipo,
      valor: a.valor,
      original: a.original,
      confianca: a.confianca,
      evidencia: a.evidencia,
      frequencia: a.notas.size,
      ultima_vez_visto: a.ultima,
      ...(a.telefone ? { telefone: a.telefone } : {}),
    }))
    .sort(
      (x, y) =>
        FORCA[y.confianca] - FORCA[x.confianca] ||
        y.frequencia - x.frequencia ||
        (y.ultima_vez_visto ?? '').localeCompare(x.ultima_vez_visto ?? ''),
    )
}
