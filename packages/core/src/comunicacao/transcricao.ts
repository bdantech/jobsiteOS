/**
 * TRANSCRIÇÃO DO ÁUDIO DO WHATSAPP — o que é contrato com a ElevenLabs, sem HTTP.
 *
 * ─── POR QUE EXISTE ─────────────────────────────────────────────────────────
 * Até 10/2026 um áudio era, para todo leitor de máquina, o texto "(áudio · 17s)". Os 690
 * áudios recebidos até então saíram da triagem como "outro": um "não me manda mais
 * mensagem" dito em voz passava pela detecção de opt-out sem ser visto, e um terço das
 * janelas analisadas pela Qualidade julgava o vendedor sem saber o que ele disse.
 *
 * ─── O CORPO NÃO MUDA ───────────────────────────────────────────────────────
 * `corpo` continua "(áudio · 17s)": é o que chegou, e a bolha continua tocando o arquivo.
 * A transcrição mora ao lado (`comunicacoes.transcricao`) e quem lê a mensagem para
 * DECIDIR alguma coisa — triagem, agente, análise — lê por `textoDaMensagem`. Um leitor
 * novo que esqueça a função volta a ver só o rótulo, não um texto inventado.
 */

export const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
export const ELEVENLABS_USER_URL = 'https://api.elevenlabs.io/v1/user'

export const STATUS_TRANSCRICAO = ['pendente', 'feita', 'vazia', 'falhou', 'ignorada'] as const
export type StatusTranscricao = (typeof STATUS_TRANSCRICAO)[number]

/** O que a bolha diz no lugar da transcrição, quando ela não existe. */
export const STATUS_TRANSCRICAO_LABELS: Record<Exclude<StatusTranscricao, 'feita'>, string> = {
  pendente: 'Transcrevendo…',
  vazia: 'Nenhuma fala reconhecida no áudio.',
  falhou: 'Não foi possível transcrever este áudio.',
  ignorada: 'Áudio longo demais para transcrever.',
}

/**
 * O texto da mensagem como um MODELO deve lê-lo: o rótulo do áudio seguido do que foi
 * dito. O rótulo fica porque "foi áudio" é informação — quem responde por áudio a uma
 * proposta escrita está dizendo alguma coisa — e as aspas separam a fala do resto.
 */
export function textoDaMensagem(m: {
  corpo: string | null
  preview?: string | null
  transcricao?: string | null
}): string | null {
  const base = m.corpo ?? m.preview ?? null
  const fala = m.transcricao?.trim()
  if (!fala) return base
  return `${base ?? '(áudio)'} «${fala}»`
}

/** A prévia do inbox: o começo da fala, que é o que diz se vale abrir a conversa. */
export function previewComTranscricao(corpo: string | null, transcricao: string, max = 160): string {
  const t = textoDaMensagem({ corpo, transcricao }) ?? transcricao
  return t.length > max ? `${t.slice(0, max - 2).trimEnd()}…»` : t
}

export interface ResultadoScribe {
  texto: string
  /** O que a ElevenLabs diz ter ouvido — é sobre isto que ela cobra. */
  segundos: number | null
  idioma: string | null
}

/**
 * Lê a resposta síncrona do `POST /v1/speech-to-text`. Devolve null se a forma não for a
 * esperada (quem chama trata como falha e tenta de novo). Texto vazio é resposta válida:
 * é o áudio só de barulho, e vira `vazia` — não um erro a repetir.
 */
export function lerRespostaScribe(corpo: unknown): ResultadoScribe | null {
  if (!corpo || typeof corpo !== 'object') return null
  const o = corpo as { text?: unknown; audio_duration_secs?: unknown; language_code?: unknown }
  if (typeof o.text !== 'string') return null
  const segundos = Number(o.audio_duration_secs)
  return {
    // Eventos de áudio vêm entre parênteses quando `tag_audio_events` está ligado; nós o
    // desligamos, mas um "(risos)" sozinho continua não sendo fala.
    texto: o.text.replace(/\s+/g, ' ').trim(),
    segundos: Number.isFinite(segundos) && segundos > 0 ? segundos : null,
    idioma: typeof o.language_code === 'string' && o.language_code ? o.language_code : null,
  }
}

/** Só pontuação e eventos entre parênteses não é fala. */
export function ehFalaVazia(texto: string): boolean {
  return texto.replace(/\([^)]*\)/g, '').replace(/[\s.,;:!?…"'«»-]/g, '') === ''
}

/**
 * Os limites do lado deles (batch): até 1000 termos, cada um com menos de 50 caracteres e
 * no máximo 5 palavras. Um termo fora disso faria a chamada inteira falhar — melhor
 * descartá-lo aqui do que perder a transcrição.
 */
export function normalizarTermosChave(lista: readonly string[]): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const bruto of lista) {
    const t = bruto.replace(/\s+/g, ' ').trim()
    if (!t || t.length >= 50 || t.split(' ').length > 5) continue
    const k = t.toLocaleLowerCase('pt-BR')
    if (vistos.has(k)) continue
    vistos.add(k)
    saida.push(t)
  }
  return saida.slice(0, 1000)
}

/** Recusa por causa dos termos (formato ou limite): vale tentar de novo sem eles. */
export function recusaPorTermos(status: number, corpo: unknown): boolean {
  if (status !== 400 && status !== 422) return false
  return JSON.stringify(corpo ?? '').toLowerCase().includes('keyterm')
}

export type ConferenciaChaveElevenLabs =
  | { valida: true }
  | { valida: false; motivo: string }
  | { valida: null; motivo: string }

/**
 * Lê a resposta de `GET /v1/user`. Só recusa a chave que a ElevenLabs disse ser inválida:
 * uma chave restrita (só speech-to-text) pode não ter permissão de ler o usuário, e isso
 * devolve 401 também — com outro motivo. Recusar essa seria impedir a chave certa.
 */
export function lerConferenciaChaveElevenLabs(status: number, corpo: unknown): ConferenciaChaveElevenLabs {
  if (status >= 200 && status < 300) return { valida: true }
  const detalhe = JSON.stringify((corpo as { detail?: unknown } | null)?.detail ?? corpo ?? '').toLowerCase()
  if ((status === 401 || status === 403) && detalhe.includes('invalid_api_key')) {
    return {
      valida: false,
      motivo: 'A ElevenLabs recusou esta chave. Copie de novo em Developers → API Keys e cole aqui.',
    }
  }
  return { valida: null, motivo: `A ElevenLabs não confirmou a chave (HTTP ${status}).` }
}
