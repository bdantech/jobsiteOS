import {
  ELEVENLABS_STT_URL,
  ehFalaVazia,
  lerRespostaScribe,
  normalizarTermosChave,
  previewComTranscricao,
  recusaPorTermos,
  type ResultadoScribe,
  type StatusTranscricao,
} from '../../../../packages/core/src/comunicacao/transcricao.js'
import { custoTranscricaoCentavos, type TranscricaoConfig } from '../../../../packages/core/src/analise/tipos.js'
import type { AnexoComunicacao } from '../../../../packages/core/src/transportes/index.js'
import { supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import { carregarConfigQualidade, segredoQualidade } from '../qualidade/config.js'

/**
 * O ÁUDIO DO WHATSAPP VIRA TEXTO (0292).
 *
 * ─── DOIS CAMINHOS, UMA LINHA ───────────────────────────────────────────────
 * O webhook pede a transcrição assim que o arquivo está no bucket, e ela volta em poucos
 * segundos — antes da triagem, que roda de 5 em 5 minutos e espera por ela. A varredura
 * (`comunicacao-transcrever`) é a garantia: pega o que falhou, o que caiu com um deploy e
 * o que o disparo imediato não chegou a pegar.
 *
 * Os dois disputam a mesma linha, e quem paga a ElevenLabs é quem ganha o ARRENDAMENTO:
 * `transcricao_tentativas` muda só se ainda estiver no valor lido (concorrência otimista),
 * e `transcricao_tentar_apos` empurra a próxima tentativa cinco minutos à frente.
 *
 * ─── O QUE NÃO SE REPETE ────────────────────────────────────────────────────
 * Fala vazia (`vazia`), áudio longo demais (`ignorada`) e arquivo que não existe (`falhou`)
 * fecham na primeira vez: tentar de novo daria a mesma resposta e cobraria de novo.
 * Erro de rede, 5xx e chave ausente voltam para a fila até `MAX_TENTATIVAS`.
 */

const BUCKET = 'comunicacao-midia'
const MAX_TENTATIVAS = 3
const ARRENDAMENTO_MS = 5 * 60_000

/** Chamado pelo webhook logo depois de o arquivo ir para o bucket. Nunca lança. */
export async function pedirTranscricao(comunicacaoId: string, anexo: AnexoComunicacao): Promise<void> {
  if (anexo.tipo !== 'audio') return
  try {
    const cfg = await carregarConfigQualidade()
    if (!cfg.transcricao.ligada) return
    const { data, error } = await supabaseAdmin
      .from('comunicacoes')
      .update({ transcricao_status: 'pendente' })
      .eq('id', comunicacaoId)
      .is('transcricao_status', null)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return
    // Fora do caminho do webhook: a próxima mensagem não espera a ElevenLabs.
    void transcreverComunicacao(comunicacaoId).catch((erro: unknown) =>
      logger.error({ comunicacaoId, erro: String(erro) }, 'Transcrição imediata falhou; a varredura retoma.'),
    )
  } catch (erro) {
    logger.error({ comunicacaoId, erro: String(erro) }, 'Falha ao pedir a transcrição do áudio.')
  }
}

export type DesfechoTranscricao = StatusTranscricao | 'adiada' | 'pulada'

export async function transcreverComunicacao(comunicacaoId: string): Promise<DesfechoTranscricao> {
  const { data: linha, error } = await supabaseAdmin
    .from('comunicacoes')
    .select('id, corpo, anexos, transcricao_status, transcricao_tentativas, transcricao_tentar_apos')
    .eq('id', comunicacaoId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!linha || linha.transcricao_status !== 'pendente') return 'pulada'
  if (linha.transcricao_tentar_apos && new Date(linha.transcricao_tentar_apos).getTime() > Date.now()) return 'pulada'

  const tentativa = linha.transcricao_tentativas + 1
  const { data: arrendada } = await supabaseAdmin
    .from('comunicacoes')
    .update({
      transcricao_tentativas: tentativa,
      transcricao_tentar_apos: new Date(Date.now() + ARRENDAMENTO_MS).toISOString(),
    })
    .eq('id', comunicacaoId)
    .eq('transcricao_status', 'pendente')
    .eq('transcricao_tentativas', linha.transcricao_tentativas)
    .select('id')
    .maybeSingle()
  if (!arrendada) return 'pulada'

  const anexo = (Array.isArray(linha.anexos) ? (linha.anexos as unknown as AnexoComunicacao[]) : []).find(
    (a) => a?.tipo === 'audio' && a.caminho,
  )
  if (!anexo) return fechar(comunicacaoId, 'falhou', { erro: 'A mensagem não tem arquivo de áudio guardado.' })

  try {
    const cfg = await carregarConfigQualidade()
    if (anexo.segundos !== null && anexo.segundos > cfg.transcricao.max_segundos) {
      return fechar(comunicacaoId, 'ignorada', {
        erro: `Áudio de ${anexo.segundos}s, acima do teto de ${cfg.transcricao.max_segundos}s.`,
      })
    }
    const chave = await segredoQualidade('elevenlabs_api_key')
    if (!chave) throw new Error('Chave da API da ElevenLabs não cadastrada (Comercial → Qualidade → Configurações).')

    const { data: arquivo, error: erroArquivo } = await supabaseAdmin.storage.from(BUCKET).download(anexo.caminho)
    if (erroArquivo || !arquivo) {
      return fechar(comunicacaoId, 'falhou', { erro: `Arquivo não encontrado no bucket: ${erroArquivo?.message ?? 'vazio'}.` })
    }

    const r = await chamarScribe(arquivo, anexo, cfg.transcricao, chave)
    const segundos = r.segundos ?? anexo.segundos ?? 0
    const custo = custoTranscricaoCentavos(segundos, r.comTermos, cfg.precos)
    const comum = { segundos, custo, modelo: cfg.transcricao.modelo }
    if (ehFalaVazia(r.texto)) return fechar(comunicacaoId, 'vazia', comum)
    return fechar(comunicacaoId, 'feita', { ...comum, texto: r.texto, corpo: linha.corpo })
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    const desistir = tentativa >= MAX_TENTATIVAS
    await supabaseAdmin
      .from('comunicacoes')
      .update({
        transcricao_erro: msg.slice(0, 500),
        transcricao_status: desistir ? 'falhou' : 'pendente',
        // Recuo crescente: 2, 4 minutos. A ElevenLabs fora do ar não melhora em segundos.
        transcricao_tentar_apos: desistir ? null : new Date(Date.now() + tentativa * 2 * 60_000).toISOString(),
      })
      .eq('id', comunicacaoId)
    logger.warn({ comunicacaoId, tentativa, desistir, erro: msg }, 'Transcrição do áudio não concluída.')
    return desistir ? 'falhou' : 'adiada'
  }
}

async function chamarScribe(
  arquivo: Blob,
  anexo: AnexoComunicacao,
  cfg: TranscricaoConfig,
  chave: string,
): Promise<ResultadoScribe & { comTermos: boolean }> {
  const termos = normalizarTermosChave(cfg.termos_chave)

  async function enviar(comTermos: boolean) {
    const fd = new FormData()
    fd.append('model_id', cfg.modelo)
    fd.append('file', arquivo, anexo.caminho.split('/').pop() ?? 'audio.ogg')
    fd.append('language_code', cfg.idioma)
    fd.append('tag_audio_events', 'false')
    fd.append('diarize', 'false')
    // Uma entrada por termo: é como os SDKs deles mandam lista em multipart.
    if (comTermos) for (const t of termos) fd.append('keyterms', t)
    const res = await fetch(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': chave },
      body: fd,
      signal: AbortSignal.timeout(120_000),
    })
    const corpo: unknown = await res.json().catch(() => null)
    return { res, corpo }
  }

  let comTermos = termos.length > 0
  let { res, corpo } = await enviar(comTermos)
  if (!res.ok && comTermos && recusaPorTermos(res.status, corpo)) {
    // Termos recusados não podem custar a transcrição: vai sem eles, e o log avisa para
    // alguém corrigir a lista.
    logger.warn({ status: res.status, corpo }, 'ElevenLabs recusou os termos-chave; transcrevendo sem eles.')
    comTermos = false
    ;({ res, corpo } = await enviar(false))
  }
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${JSON.stringify(corpo ?? '').slice(0, 300)}`)
  const lido = lerRespostaScribe(corpo)
  if (!lido) throw new Error('ElevenLabs devolveu uma resposta sem texto.')
  return { ...lido, comTermos }
}

async function fechar(
  comunicacaoId: string,
  status: Exclude<StatusTranscricao, 'pendente'>,
  d: { erro?: string; texto?: string; corpo?: string | null; segundos?: number; custo?: number; modelo?: string },
): Promise<StatusTranscricao> {
  const { error } = await supabaseAdmin
    .from('comunicacoes')
    .update({
      transcricao_status: status,
      transcricao: d.texto ?? null,
      transcricao_em: new Date().toISOString(),
      transcricao_tentar_apos: null,
      transcricao_erro: d.erro ?? null,
      transcricao_modelo: d.modelo ?? null,
      transcricao_segundos: d.segundos ?? null,
      transcricao_custo_centavos: d.custo ?? null,
      // A prévia do inbox é a da última mensagem: com a fala nela, a lista diz se vale abrir.
      ...(d.texto ? { preview: previewComTranscricao(d.corpo ?? null, d.texto) } : {}),
    })
    .eq('id', comunicacaoId)
  if (error) throw new Error(error.message)
  return status
}

export interface ResultadoVarredura {
  candidatas: number
  feitas: number
  vazias: number
  adiadas: number
  falhas: number
}

/** A garantia: o que o disparo imediato não fechou. De 5 em 5 minutos, um minuto antes da triagem. */
export async function varrerTranscricoes(limite = 30): Promise<ResultadoVarredura> {
  const acc: ResultadoVarredura = { candidatas: 0, feitas: 0, vazias: 0, adiadas: 0, falhas: 0 }
  const agora = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('comunicacoes')
    .select('id')
    .eq('transcricao_status', 'pendente')
    .or(`transcricao_tentar_apos.is.null,transcricao_tentar_apos.lt.${agora}`)
    .order('criado_em', { ascending: true })
    .limit(limite)
  if (error) throw new Error(error.message)
  acc.candidatas = data?.length ?? 0
  for (const { id } of data ?? []) {
    try {
      const d = await transcreverComunicacao(id)
      if (d === 'feita') acc.feitas++
      else if (d === 'vazia') acc.vazias++
      else if (d === 'adiada') acc.adiadas++
      else if (d === 'falhou') acc.falhas++
    } catch (erro) {
      acc.falhas++
      logger.error({ comunicacaoId: id, erro: String(erro) }, 'Falha na varredura de transcrição.')
    }
  }
  return acc
}
