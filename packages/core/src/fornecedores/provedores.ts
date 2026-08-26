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

/**
 * A FORMA de uma resposta, sem o conteúdo dela.
 *
 * Existe porque `sem_dados` é ambíguo e caro, e ela provou o valor no primeiro uso: a
 * consulta à Nova Vida custou R$ 0,35 e devolveu zero contatos, e a forma registrada
 * mostrou `{d: {CONSULTA: {... TELEFONES: [4× …] ...}}}` — quatro telefones que o
 * mapeamento estava jogando fora. Sem ela, a hipótese "o CNPJ não tem contato" e a
 * hipótese "o parser errou a chave" só se separariam repetindo a chamada paga.
 *
 * Devolve só nomes de chave e tipos. NUNCA valores: a resposta traz nome, CPF e
 * telefone de pessoa física, e um log de diagnóstico não é lugar para isso.
 */
// Três níveis, e não dois: a resposta vem com duplo embrulho (`{d: {CONSULTA: {...}}}`),
// e a dois níveis as listas já saíam como `…` — justamente o que se quer diagnosticar.
export function formaDaResposta(valor: unknown, profundidade = 3): string {
  if (valor === null) return 'null'
  if (Array.isArray(valor)) {
    return valor.length === 0
      ? '[]'
      : `[${valor.length}× ${profundidade > 0 ? formaDaResposta(valor[0], profundidade - 1) : '…'}]`
  }
  if (typeof valor !== 'object') return typeof valor
  const chaves = Object.keys(valor as Record<string, unknown>)
  if (chaves.length === 0) return '{}'
  if (profundidade <= 0) return `{${chaves.length} chaves}`
  const dentro = chaves
    .slice(0, 12)
    .map((k) => `${k}: ${formaDaResposta((valor as Record<string, unknown>)[k], profundidade - 1)}`)
  return `{${dentro.join(', ')}${chaves.length > 12 ? ', …' : ''}}`
}

/** Tira o embrulho do ASMX até chegar no miolo (`CONSULTA`, quando houver). */
function desembrulharObjeto(resposta: unknown): unknown {
  if (typeof resposta !== 'object' || resposta === null) return resposta
  const r = resposta as Record<string, unknown>
  // `CONSULTA` é o miolo: parar nele impede o desembrulho de descer demais.
  if (r.CONSULTA !== undefined) return r
  for (const chave of ['d', 'NVCHECKJsonResult', 'Resultado', 'resultado']) {
    if (r[chave] !== undefined) {
      const dentro = r[chave]
      // O ASMX às vezes devolve o objeto SERIALIZADO dentro do embrulho.
      if (typeof dentro === 'string') {
        try {
          return desembrulharObjeto(JSON.parse(dentro))
        } catch {
          return null
        }
      }
      return desembrulharObjeto(dentro)
    }
  }
  return r
}

/*
 * ─── O SCHEMA REAL DA NVCHECK (PESSOA JURÍDICA) ──────────────────────────────
 *
 * A primeira versão deste mapeamento foi escrita a partir da descrição do prompt
 * ("mapear telefones/e-mails de sócios") e procurava uma chave `Socios` na raiz. O
 * schema é outro, e o erro custou R$ 1,40 em quatro consultas que voltaram marcadas
 * como "sem dados" tendo trazido dados:
 *
 *   { d: { CONSULTA: { CADASTRAIS: {...}, ENDERECOS: [...], TELEFONES: [...],
 *                      EMAILS: [...], CONTATOSRUINS: [...], QSA: [ { QSA: [...] } ] } } }
 *
 * Três coisas que a versão anterior não fazia, e cada uma sozinha zerava o resultado:
 *
 *   1. descer em `CONSULTA` (o desembrulho parava em `d`);
 *   2. ler `QSA`, que ainda é ANINHADA: `QSA[0].QSA[]` é a lista de sócios;
 *   3. ler `TELEFONES` e `EMAILS` da PRÓPRIA EMPRESA — que são o dado mais valioso
 *      aqui e nem sequer eram procurados. Uma das consultas trouxe quatro telefones.
 */

interface TelefoneNvti {
  DDD?: string
  TELEFONE?: string
  ASSINANTE?: string
  /** `C` celular, `F` fixo. */
  TIPO_TELEFONE?: string
  PROCON?: string
  OPERADORA?: string
  FLHOT?: string
  FLWHATS?: string
}

interface SocioNvti {
  NOME?: string
  QUALIFICACAO?: string
  DDD_SOCIO?: string
  CEL_SOCIO?: string
  FLWHATS?: string
}

/** O que o cadastral da PJ traz de graça e alimenta o gate do Apollo. */
export interface CadastraisNovaVida {
  porte: string | null
  funcionarios: number | null
  faturamento_presumido: number | null
  razao_social: string | null
  nome_fantasia: string | null
  situacao: string | null
}

export interface RetornoNovaVida {
  contatos: ContatoDeProvedor[]
  cadastrais: CadastraisNovaVida | null
  /** Telefones que a própria base marca como ruins. Nunca viram contato. */
  descartados: number
}

const ehSim = (v: unknown): boolean => String(v ?? '').trim().toUpperCase().startsWith('S')

function lista<T>(valor: unknown): T[] {
  if (Array.isArray(valor)) return valor as T[]
  // Um único item às vezes vem como objeto, não como array de um.
  if (valor && typeof valor === 'object') return [valor as T]
  return []
}

function numeroOuNulo(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(/[^\d]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * A NVCHECK devolve ERRO COMO TEXTO, com HTTP 200 e no lugar do objeto.
 *
 * A documentação lista quatro: credencial errada, consulta não liberada, cota do
 * cliente e cota do usuário. A detecção existia só para o TOKEN — a consulta em si
 * não era verificada, e um "SEM ACESSO AO SISTEMA" viraria zero contatos com R$ 0,35
 * cobrados e nada dizendo por quê.
 */
export function erroDeConsultaNovaVida(resposta: unknown): string | null {
  const texto =
    typeof resposta === 'string'
      ? resposta
      : typeof (resposta as { d?: unknown })?.d === 'string'
        ? ((resposta as { d: string }).d)
        : null
  if (texto === null) return null
  const t = texto.trim()
  return t.length > 0 && t.length < 200 ? t : null
}

/**
 * A resposta da NVCHECK → contatos, cadastral e o que foi descartado.
 *
 * ─── CONFIANÇA ───────────────────────────────────────────────────────────────
 *
 * Telefone e e-mail DA EMPRESA entram como média: é cadastro de terceiro, sem a data
 * que o `emit` de uma NF-e tem. Celular de SÓCIO também é média, e por outra razão —
 * é pessoa física, pode ser de quem saiu da sociedade.
 *
 * `FLWHATS = S` promove o registro a `whatsapp`, que é o canal que o originador de
 * fato usa. É afirmação do provedor, não palpite nosso, e por isso entra em
 * `validado.tem_whatsapp` na gravação.
 *
 * ─── CONTATOSRUINS SÃO EXCLUÍDOS ─────────────────────────────────────────────
 *
 * A própria base marca telefones que já se sabe que não atendem. Gravá-los seria
 * pagar para pôr na tela um número que o fornecedor da informação já avisou que não
 * serve — e ele apareceria com a mesma cara dos bons até alguém discar.
 */
export function mapearNovaVida(
  resposta: unknown,
  opcoes: { dddPadrao?: string | null } = {},
): RetornoNovaVida {
  const raiz = desembrulharObjeto(resposta)
  const consulta = (raiz && typeof raiz === 'object'
    ? ((raiz as Record<string, unknown>).CONSULTA ?? raiz)
    : null) as Record<string, unknown> | null

  if (!consulta || typeof consulta !== 'object') {
    return { contatos: [], cadastrais: null, descartados: 0 }
  }

  const out: ContatoDeProvedor[] = []
  const vistos = new Set<string>()

  // Os ruins primeiro: eles entram no conjunto de exclusão antes de qualquer leitura.
  const ruins = new Set<string>()
  for (const r of lista<TelefoneNvti>(consulta.CONTATOSRUINS)) {
    const tel = normalizarTelefoneBr(`${r.DDD ?? ''}${r.TELEFONE ?? ''}`, {
      dddPadrao: opcoes.dddPadrao,
    })
    if (tel.e164) ruins.add(tel.e164)
  }

  const push = (c: ContatoDeProvedor): void => {
    const chave = `${c.tipo}|${c.valor}`
    if (vistos.has(chave) || ruins.has(c.valor)) return
    vistos.add(chave)
    out.push(c)
  }

  // ── Telefones da EMPRESA ──────────────────────────────────────────────────
  for (const t of lista<TelefoneNvti>(consulta.TELEFONES)) {
    const tel = normalizarTelefoneBr(`${t.DDD ?? ''}${t.TELEFONE ?? ''}`, {
      dddPadrao: opcoes.dddPadrao,
    })
    if (!tel.e164) continue
    const whats = ehSim(t.FLWHATS)
    const detalhes = [
      t.TIPO_TELEFONE === 'C' ? 'celular' : t.TIPO_TELEFONE === 'F' ? 'fixo' : null,
      t.OPERADORA || null,
      ehSim(t.PROCON) ? 'no Procon' : null,
      whats ? 'com WhatsApp' : null,
    ].filter(Boolean)
    push({
      tipo: whats ? 'whatsapp' : 'telefone',
      valor: tel.e164,
      original: `${t.DDD ?? ''}${t.TELEFONE ?? ''}`,
      nome_pessoa: null,
      cargo: null,
      confianca: 'media',
      evidencia: `Nova Vida TI · telefone da empresa${detalhes.length ? ` (${detalhes.join(', ')})` : ''}`,
    })
  }

  // ── E-mails da EMPRESA ────────────────────────────────────────────────────
  for (const e of lista<{ EMAIL?: string }>(consulta.EMAILS)) {
    const valor = (e.EMAIL ?? '').trim().toLowerCase()
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(valor)) continue
    push({
      tipo: 'email',
      valor,
      original: e.EMAIL as string,
      nome_pessoa: null,
      cargo: null,
      confianca: 'media',
      evidencia: 'Nova Vida TI · e-mail da empresa',
    })
  }

  // ── Sócios (QSA, aninhada) ────────────────────────────────────────────────
  for (const bloco of lista<{ QSA?: unknown }>(consulta.QSA)) {
    for (const socio of lista<SocioNvti>(bloco.QSA)) {
      const nome = (socio.NOME ?? '').trim() || null
      const cargo = (socio.QUALIFICACAO ?? '').trim() || null
      const tel = normalizarTelefoneBr(`${socio.DDD_SOCIO ?? ''}${socio.CEL_SOCIO ?? ''}`, {
        dddPadrao: opcoes.dddPadrao,
      })
      if (!tel.e164) continue
      const whats = ehSim(socio.FLWHATS)
      push({
        tipo: whats ? 'whatsapp' : 'telefone',
        valor: tel.e164,
        original: `${socio.DDD_SOCIO ?? ''}${socio.CEL_SOCIO ?? ''}`,
        nome_pessoa: nome,
        cargo,
        confianca: 'media',
        evidencia: `Nova Vida TI · sócio ${nome ?? 'sem nome'}${whats ? ' (com WhatsApp)' : ''}`,
      })
    }
  }

  const cad = (consulta.CADASTRAIS ?? {}) as Record<string, unknown>

  return {
    contatos: out,
    /*
     * O cadastral vem DE GRAÇA na mesma consulta, e é ele que destrava o Apollo:
     * `QTDEFUNCIONARIOS` é exatamente o número que o gate de porte procura e que
     * nenhum fornecedor deste funil tem em `empresas`.
     */
    cadastrais: {
      porte: (cad.PORTE as string | undefined)?.trim() || null,
      funcionarios: numeroOuNulo(cad.QTDEFUNCIONARIOS),
      faturamento_presumido: numeroOuNulo(cad.FATURAMENTOPRESUMIDO),
      razao_social: (cad.RAZAO as string | undefined)?.trim() || null,
      nome_fantasia: (cad.NOME_FANTASIA as string | undefined)?.trim() || null,
      situacao:
        ((consulta.SITUACAOCADASTRAL as Record<string, unknown> | undefined)?.DESCRICAO as
          | string
          | undefined)?.trim() || null,
    },
    descartados: ruins.size,
  }
}

/** Compatibilidade: só os contatos. */
export function mapearSociosNovaVida(
  resposta: unknown,
  opcoes: { dddPadrao?: string | null } = {},
): ContatoDeProvedor[] {
  return mapearNovaVida(resposta, opcoes).contatos
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
