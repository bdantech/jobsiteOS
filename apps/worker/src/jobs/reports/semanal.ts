import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  assuntoDoEmail,
  brlCurto,
  nomeDoArquivo,
  variacaoTexto,
  type ReportSemanal,
} from '../../../../../packages/core/src/reports/semanal.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { semanaFechada } from './janela.js'
import { gerarPdfSemanal } from './pdf.js'
import { gerarResumoSemanal } from './resumo-ia.js'

/**
 * O Report Semanal Executivo (04q): gerar, guardar e enviar.
 *
 * ─── A ORDEM IMPORTA ────────────────────────────────────────────────────────
 * Grava a execução ANTES de gerar. Um job que estoura no meio deixa a linha com
 * `status = 'gerando'` e o erro escrito, e alguém consegue ver que houve tentativa — em
 * vez de um domingo em que simplesmente não aconteceu nada e ninguém soube.
 *
 * ─── O SNAPSHOT ─────────────────────────────────────────────────────────────
 * `dados` guarda a estrutura inteira. É o que faz um report de três meses atrás abrir com
 * os números daquela época, depois de a nota ter mudado de estágio e o cliente ter saído
 * da carteira. Recalcular ao abrir mostraria um passado que nunca existiu.
 */

const BUCKET = 'reports-semanais'

export interface ResultadoReportSemanal {
  execucao_id: string | null
  periodo: { inicio: string; fim: string }
  pdf_url: string | null
  resumo_ia: boolean
  enviados: number
  falhas: number
  motivo?: string
}

interface Destinatario {
  email?: string
  nome?: string
  usuario_id?: string
}

export interface OpcoesReport {
  inicio?: string
  fim?: string
  /** Prévia sob demanda: gera e guarda, e NÃO envia. */
  enviar?: boolean
  /** "Enviar teste agora": ignora a lista e manda só para estes. */
  destinatariosTeste?: Destinatario[]
  criadoPor?: string | null
}

export async function gerarReportSemanal(opts: OpcoesReport = {}): Promise<ResultadoReportSemanal> {
  const janela = opts.inicio && opts.fim
    ? { inicio: opts.inicio, fim: opts.fim }
    : semanaFechada()

  const { data: execucao, error: erroExec } = await supabaseAdmin
    .from('report_execucoes')
    .insert({
      tipo: 'semanal_executivo',
      periodo_inicio: janela.inicio,
      periodo_fim: janela.fim,
      status: 'gerando',
      dados: {},
      criado_por: opts.criadoPor ?? null,
    })
    .select('id')
    .single()
  if (erroExec || !execucao) {
    throw new Error(`Não foi possível abrir a execução do report: ${erroExec?.message}`)
  }

  try {
    // ── Os números ─────────────────────────────────────────────────────────
    // `app__rp_montar` é a MECÂNICA, sem sessão: a service role não tem `auth.uid()` e
    // reprovaria na checagem de gestor de `app_report_semanal`.
    const { data: bruto, error: erroDados } = await supabaseAdmin.rpc('app__rp_montar' as never, {
      p_inicio: janela.inicio,
      p_fim: janela.fim,
    } as never)
    if (erroDados) throw new Error(`Falha ao montar o report: ${erroDados.message}`)
    const r = bruto as unknown as ReportSemanal

    const resumo = await gerarResumoSemanal(r)
    const pdf = await gerarPdfSemanal(r, resumo)

    // ── O arquivo ──────────────────────────────────────────────────────────
    const nome = nomeDoArquivo(r.periodo)
    const caminho = `${r.periodo.ano}/${nome}`
    const up = await supabaseAdmin.storage.from(BUCKET).upload(caminho, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (up.error) throw new Error(`Falha ao guardar o PDF: ${up.error.message}`)

    await supabaseAdmin
      .from('report_execucoes')
      .update({ dados: r as never, resumo_ia: resumo, pdf_url: caminho, status: 'gerado' })
      .eq('id', execucao.id)

    await emitirEvento(null, EVENTO_TIPOS.REPORT_GERADO, {
      titulo: `Report semanal ${r.periodo.ano}-S${r.periodo.semana_iso}`,
      resumo: `${brlCurto(r.operacao.kpis.volume_convertido.semana)} convertidos na semana.`,
      url: '/comercial/relatorios',
      execucao_id: execucao.id,
      periodo: janela,
    })

    if (opts.enviar === false) {
      return {
        execucao_id: execucao.id,
        periodo: janela,
        pdf_url: caminho,
        resumo_ia: Boolean(resumo),
        enviados: 0,
        falhas: 0,
        motivo: 'previa_sob_demanda',
      }
    }

    // ── O envio ────────────────────────────────────────────────────────────
    const envio = await enviarReport(execucao.id, r, resumo, pdf, nome, opts.destinatariosTeste)
    return {
      execucao_id: execucao.id,
      periodo: janela,
      pdf_url: caminho,
      resumo_ia: Boolean(resumo),
      ...envio,
    }
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    await supabaseAdmin
      .from('report_execucoes')
      .update({ status: 'falhou', erro: msg })
      .eq('id', execucao.id)
    await emitirEvento(null, EVENTO_TIPOS.REPORT_FALHOU, {
      titulo: 'O report semanal falhou',
      resumo: msg,
      url: '/comercial/relatorios',
      execucao_id: execucao.id,
    })
    logger.error({ erro: msg, janela }, 'Report semanal falhou.')
    throw erro
  }
}

// ─── Envio ──────────────────────────────────────────────────────────────────

/**
 * O corpo do e-mail leva o RESUMO EM TEXTO, e não só "segue o anexo".
 *
 * Metade de quem recebe isso às 6h vai ler no celular, andando, sem abrir PDF nenhum. Um
 * e-mail que exige abrir o anexo para saber qualquer coisa é um e-mail que não é lido — e
 * os três parágrafos já são a leitura executiva inteira.
 */
function corpoDoEmail(r: ReportSemanal, resumo: string | null, appUrl: string | null): string {
  const k = r.operacao.kpis
  const linhas = [
    `Semana ${r.periodo.semana_iso} · ${r.periodo.inicio} a ${r.periodo.fim}`,
    '',
    resumo ?? '(o resumo da semana não pôde ser gerado desta vez)',
    '',
    '— Os quatro números —',
    `Volume convertido: ${brlCurto(k.volume_convertido.semana)} (${variacaoTexto(k.volume_convertido.var_semana_pct)} vs média semanal)`,
    `VOP operado: ${brlCurto(k.vop_operado.semana)} (${variacaoTexto(k.vop_operado.var_semana_pct)})`,
    `Receita gerada: ${brlCurto(k.receita.semana)} (${variacaoTexto(k.receita.var_semana_pct)})`,
    `Limite ocioso hoje: ${brlCurto(k.limite_ocioso.foto)}`,
    '',
    'O report completo, com os onze blocos, está no PDF em anexo.',
  ]
  if (appUrl) linhas.push('', `Abrir no JobsiteOS: ${appUrl}/comercial/relatorios`)
  return linhas.join('\n')
}

async function enviarReport(
  execucaoId: string,
  r: ReportSemanal,
  resumo: string | null,
  pdf: Buffer,
  nome: string,
  teste?: Destinatario[],
): Promise<{ enviados: number; falhas: number; motivo?: string }> {
  /*
   * O report é INTERNO: sai pelo remetente interno quando ele existe, e cai no do
   * sistema quando não. O `RESEND_REMETENTE` da fila da Comunicação fala com
   * cliente, e esta lista aqui é a diretoria — não precisam ser o mesmo endereço.
   */
  const remetente = env.RESEND_REMETENTE_INTERNO ?? env.RESEND_REMETENTE

  if (!env.RESEND_API_KEY || !remetente) {
    const motivo =
      'RESEND_API_KEY ou um remetente (RESEND_REMETENTE_INTERNO, RESEND_REMETENTE ou RESEND_FROM_EMAIL) ausentes no worker — o PDF foi gerado e guardado, mas nada saiu.'
    logger.warn(motivo)
    await supabaseAdmin.from('report_execucoes').update({ erro: motivo }).eq('id', execucaoId)
    return { enviados: 0, falhas: 0, motivo: 'sem_credencial' }
  }

  const { data: cfg } = await supabaseAdmin
    .from('report_config')
    .select('destinatarios, assunto_template')
    .eq('tipo', 'semanal_executivo')
    .maybeSingle()

  const lista: { email: string; nome?: string }[] = []
  for (const d of teste ?? ((cfg?.destinatarios ?? []) as Destinatario[])) {
    const email = d.email?.trim()
    if (email) lista.push({ email, nome: d.nome })
  }

  if (lista.length === 0) {
    return { enviados: 0, falhas: 0, motivo: 'sem_destinatarios' }
  }

  const assunto = assuntoDoEmail(cfg?.assunto_template ?? null, r.periodo)
  const corpo = corpoDoEmail(r, resumo, env.APP_BASE_URL ?? null)
  const anexo = { filename: nome, content: pdf.toString('base64') }

  const enviados: string[] = []
  const falharam: { email: string; erro: string }[] = []

  for (const d of lista) {
    /*
     * Um e-mail por destinatário, e não um `to` com a lista inteira: o report nomeia
     * vendedor por vendedor, e um "responder a todos" com a caixa de todo mundo à vista é
     * o tipo de vazamento que ninguém planeja.
     */
    const r2 = await enviarComRetry(assunto, corpo, d.email, anexo, remetente)
    if (r2.ok) enviados.push(d.email)
    else falharam.push({ email: d.email, erro: r2.erro })
  }

  await supabaseAdmin
    .from('report_execucoes')
    .update({
      status: enviados.length > 0 ? 'enviado' : 'falhou',
      destinatarios_enviados: enviados as never,
      erro: falharam.length > 0 ? JSON.stringify(falharam) : null,
      enviado_em: enviados.length > 0 ? new Date().toISOString() : null,
      tentativas: 1,
    })
    .eq('id', execucaoId)

  await emitirEvento(null, enviados.length > 0 ? EVENTO_TIPOS.REPORT_ENVIADO : EVENTO_TIPOS.REPORT_FALHOU, {
    titulo: enviados.length > 0 ? 'Report semanal enviado' : 'O envio do report semanal falhou',
    resumo: `${enviados.length} entregue(s), ${falharam.length} falha(s).`,
    url: '/comercial/relatorios',
    execucao_id: execucaoId,
  })

  if (falharam.length > 0) {
    logger.error({ execucaoId, falharam }, 'Report semanal: destinatários que não receberam.')
  }
  return { enviados: enviados.length, falhas: falharam.length }
}

/**
 * Três tentativas, com espera crescente (§5).
 *
 * Não usa o `TransporteResend` do core de propósito: aquele é o transporte do LEDGER de
 * comunicação — ele grava em `comunicacoes` e não sabe de anexo. O report não é uma
 * conversa com um cliente, e registrá-lo como tal poluiria a thread de quem por acaso
 * também é destinatário.
 */
async function enviarComRetry(
  assunto: string,
  corpo: string,
  para: string,
  anexo: { filename: string; content: string },
  /** Resolvido em `enviarReport` — interno com fallback para o do sistema. */
  remetente: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  let ultimo = 'sem tentativa'
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: remetente,
          to: [para],
          subject: assunto,
          text: corpo,
          attachments: [anexo],
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) return { ok: true }
      const detalhe = (await res.json().catch(() => ({}))) as { message?: string }
      ultimo = detalhe.message ?? `HTTP ${res.status}`
      /* 4xx que não é 429 não melhora tentando de novo: e-mail inválido continua inválido,
         e insistir só atrasa os destinatários seguintes da fila. */
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, erro: ultimo }
    } catch (erro) {
      ultimo = String(erro)
    }
    if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa))
  }
  return { ok: false, erro: ultimo }
}

// ─── Materialização da série (job diário) ───────────────────────────────────

export async function materializarSeriesReport(): Promise<{ linhas: number }> {
  const { data, error } = await supabaseAdmin.rpc('app_report_materializar_series' as never, {} as never)
  if (error) throw new Error(`Falha ao materializar as séries do report: ${error.message}`)
  const r = (data ?? {}) as { linhas?: number }
  logger.info({ linhas: r.linhas }, 'Séries do report materializadas.')
  return { linhas: r.linhas ?? 0 }
}
