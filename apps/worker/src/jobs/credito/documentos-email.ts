import {
  agruparAnexos,
  enderecoCompleto,
  montarAssunto,
  montarCorpo,
  type DocumentoNoEmail,
} from '../../../../../packages/core/src/credito/documentos-email.js'
import type { DocumentoParaSeguradora } from '../../../../../packages/core/src/credito/seguradora.js'
import { lerConfigEmailDocumentos, lerTiposDoc } from '../../credito/config.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'

/**
 * A papelada da análise indo à seguradora por e-mail (04d §4.2).
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────────
 * Até 17/09/2026 os documentos iam pela API, por uma rota de anexo que nunca tinha sido
 * confirmada. A Atradius confirmou o contrário: a API NÃO recebe documento, e a papelada
 * tem de ir por e-mail junto do pedido de cobertura. Trocou-se o transporte; o resto do
 * contrato é o mesmo de antes — quem escolhe os arquivos continua sendo o analista, e
 * cada linha de `analise_docs` continua dizendo se foi, quando foi e, se não foi, por quê.
 *
 * ── POR QUE NÃO PASSA PELA FILA DA COMUNICAÇÃO ──────────────────────────────
 * `mensagens_outbox` é o LEDGER de conversa com cliente: supressão, cooldown, teto por
 * thread, janela de horário, base legal. Nada disso se aplica a mandar um balanço ao
 * analista da seguradora — e o pior, tudo isso pode RECUSAR o envio. Um documento que
 * não chega porque o cooldown do contato estava quente seria uma falha impossível de
 * explicar. Mesma decisão, e pelo mesmo motivo, do report semanal.
 *
 * ── O QUE NÃO VAI JUNTO ─────────────────────────────────────────────────────
 * O parecer da análise proprietária. Ele é a NOSSA leitura de risco, escrita para decidir
 * aqui dentro; mandá-lo à seguradora entrega uma opinião que ninguém decidiu entregar e
 * que pode ancorar a decisão dela. Quem quiser mandar, anexa o PDF à análise como
 * documento e marca no diálogo — aí é escolha explícita.
 */

export interface ResultadoEnvioDocsEmail {
  /** Documentos efetivamente aceitos pelo Resend (por e-mail entregue à API). */
  enviados: number
  /** E-mails disparados. Mais de um quando os anexos não couberam num só. */
  emails: number
  motivo?: 'sem_destinatarios' | 'sem_credencial' | 'sem_documentos' | 'falha'
}

interface DadosDaAnalise {
  id: string
  cnpj: string
  razao_social: string | null
  case_id: string | null
  limite_solicitado: number | null
  moeda: string | null
}

/**
 * Manda por e-mail os documentos ESCOLHIDOS desta análise.
 *
 * `docIds` vazio significa NENHUM, e não TODOS — a mesma régua de quando o destino era a
 * API. A pasta de uma análise tem coisa que a seguradora precisa e coisa que é nossa, e
 * mandar tudo por omissão entrega dado de terceiro que ninguém decidiu entregar. É
 * irreversível: e-mail não se desenvia.
 *
 * Nada aqui lança. Uma exceção subiria ao laço da esteira e mataria as análises seguintes
 * por causa de um PDF.
 */
export async function enviarDocumentosPorEmail(
  analise: DadosDaAnalise,
  docIds: string[],
): Promise<ResultadoEnvioDocsEmail> {
  if (docIds.length === 0) return { enviados: 0, emails: 0, motivo: 'sem_documentos' }

  const cfg = await lerConfigEmailDocumentos()
  if (cfg.destinatarios.length === 0) {
    await marcarErro(
      docIds,
      'Nenhum destinatário configurado para o envio de documentos. Crédito › Configurações › Envio de documentos por e-mail.',
    )
    logger.warn({ analise: analise.id }, 'Documentos não enviados: lista de destinatários vazia.')
    return { enviados: 0, emails: 0, motivo: 'sem_destinatarios' }
  }

  /*
   * O remetente INTERNO primeiro, e o do sistema como queda. `RESEND_REMETENTE` fala com
   * cliente pela fila da Comunicação; este e-mail fala com a seguradora. Não precisam ser
   * o mesmo endereço, e no dia em que a reputação de um azedar o outro não vai junto.
   */
  const remetente = env.RESEND_REMETENTE_INTERNO ?? env.RESEND_REMETENTE
  if (!env.RESEND_API_KEY || !remetente) {
    await marcarErro(
      docIds,
      'RESEND_API_KEY ou o remetente não estão configurados no worker — nenhum e-mail saiu.',
    )
    logger.error({ analise: analise.id }, 'Documentos não enviados: Resend sem credencial.')
    return { enviados: 0, emails: 0, motivo: 'sem_credencial' }
  }

  const documentos = await baixarDocumentos(analise.id, docIds)
  if (documentos.length === 0) return { enviados: 0, emails: 0, motivo: 'sem_documentos' }

  const rotulos = new Map((await lerTiposDoc()).map((t) => [t.id, t.label]))

  // O agrupamento é do core e testado lá: é ele que garante que o documento excedente vá
  // num SEGUNDO e-mail em vez de sumir.
  const { lotes, recusados } = agruparAnexos(
    documentos.map((d) => ({ ...d, bytes: d.conteudo.byteLength })),
  )
  for (const r of recusados) await marcarErro([r.id], r.motivo)

  const para = cfg.destinatarios.map(enderecoCompleto)
  let enviados = 0
  let emails = 0

  for (const [i, lote] of lotes.entries()) {
    const noEmail: DocumentoNoEmail[] = lote.map((d) => ({
      tipo: d.tipo,
      rotulo: rotulos.get(d.tipo) ?? null,
      nome_arquivo: d.nome_arquivo,
    }))
    const dados = {
      cnpj: analise.cnpj,
      razao_social: analise.razao_social,
      case_id: analise.case_id,
      limite_solicitado: analise.limite_solicitado,
      moeda: analise.moeda,
      referencia: analise.id,
      documentos: noEmail,
      parte: i + 1,
      de: lotes.length,
    }

    const r = await enviarComRetry({
      apiKey: env.RESEND_API_KEY,
      remetente,
      responderPara: cfg.responder_para,
      para,
      assunto: montarAssunto(cfg.assunto_template, dados),
      corpo: montarCorpo(dados),
      anexos: lote.map((d) => ({
        filename: d.nome_arquivo,
        content: Buffer.from(d.conteudo).toString('base64'),
      })),
    })

    if (r.ok) {
      emails++
      enviados += lote.length
      /*
       * "Enviado" aqui é "o Resend aceitou a mensagem", não "o analista leu". É a mesma
       * régua que o `enviado_seguradora_em` tinha quando o destino era a API, e é a única
       * que o momento do envio conhece. Bounce e entrega chegam depois, pelo webhook.
       */
      await supabaseAdmin
        .from('analise_docs')
        .update({ enviado_seguradora_em: new Date().toISOString(), envio_seguradora_erro: null })
        .in('id', lote.map((d) => d.id))
    } else {
      // O motivo é o mesmo para o lote inteiro, mas cada linha precisa carregá-lo: a tela
      // mostra o documento, não o e-mail.
      await marcarErro(lote.map((d) => d.id), r.erro)
      logger.error({ analise: analise.id, erro: r.erro }, 'Falha ao enviar documentos por e-mail.')
    }
  }

  logger.info(
    { analise: analise.id, enviados, emails, destinatarios: para.length, recusados: recusados.length },
    'Documentos da análise enviados por e-mail.',
  )
  return { enviados, emails, ...(enviados === 0 ? { motivo: 'falha' as const } : {}) }
}

/**
 * Traz os bytes do bucket.
 *
 * URL externa é documento que o job de download ainda não trouxe para o nosso bucket.
 * Buscá-lo na origem daqui seria depender justamente da origem que pode ter sumido — é
 * para isso que a 04n §2.2 manda guardar o arquivo conosco.
 */
async function baixarDocumentos(
  analiseId: string,
  docIds: string[],
): Promise<DocumentoParaSeguradora[]> {
  const { data: linhas } = await supabaseAdmin
    .from('analise_docs')
    .select('id, tipo, nome_arquivo, arquivo_url')
    .eq('analise_id', analiseId)
    .in('id', docIds)
  if (!linhas?.length) return []

  const documentos: DocumentoParaSeguradora[] = []
  for (const d of linhas) {
    if (/^https?:\/\//i.test(d.arquivo_url)) {
      await marcarErro([d.id], 'O arquivo ainda não foi baixado para o nosso bucket.')
      continue
    }
    const baixado = await supabaseAdmin.storage.from('analise-docs').download(d.arquivo_url)
    if (baixado.error || !baixado.data) {
      await marcarErro(
        [d.id],
        `Não foi possível ler o arquivo: ${baixado.error?.message ?? 'sem corpo'}.`,
      )
      continue
    }
    documentos.push({
      id: d.id,
      tipo: d.tipo,
      nome_arquivo: d.nome_arquivo ?? `${d.tipo}.pdf`,
      mime: baixado.data.type || 'application/octet-stream',
      conteudo: new Uint8Array(await baixado.data.arrayBuffer()),
    })
  }
  return documentos
}

async function marcarErro(docIds: string[], erro: string): Promise<void> {
  if (docIds.length === 0) return
  await supabaseAdmin
    .from('analise_docs')
    .update({ envio_seguradora_erro: erro.slice(0, 500), enviado_seguradora_em: null })
    .in('id', docIds)
}

/**
 * Três tentativas, com espera crescente — o mesmo desenho do report semanal.
 *
 * Não usa o `TransporteResend` do core de propósito: aquele grava em `comunicacoes` e não
 * sabe de anexo. Um documento à seguradora não é conversa com cliente, e registrá-lo como
 * tal poluiria a thread de quem por acaso também seja contato.
 */
async function enviarComRetry(m: {
  apiKey: string
  remetente: string
  responderPara: string | null
  para: string[]
  assunto: string
  corpo: string
  anexos: Array<{ filename: string; content: string }>
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  let ultimo = 'sem tentativa'
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${m.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: m.remetente,
          /*
           * Todos no mesmo `to`, e não um e-mail por pessoa (como faz o report).
           * Aqui é o contrário do report: os destinatários são o time que cuida do mesmo
           * pedido, e um "responder a todos" é justamente o que se quer — a resposta do
           * analista precisa chegar a quem mais acompanha o caso.
           */
          to: m.para,
          subject: m.assunto,
          text: m.corpo,
          ...(m.responderPara ? { reply_to: m.responderPara } : {}),
          attachments: m.anexos,
        }),
        // Mais generoso que os 20s do transporte comum: aqui sobem megabytes de PDF.
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) return { ok: true }
      const detalhe = (await res.json().catch(() => ({}))) as { message?: string }
      ultimo = detalhe.message ?? `HTTP ${res.status}`
      /* 4xx que não é 429 não melhora tentando de novo: anexo grande demais continua
         grande demais, e endereço inválido continua inválido. */
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, erro: ultimo }
      }
    } catch (erro) {
      ultimo = String(erro)
    }
    if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa))
  }
  return { ok: false, erro: ultimo }
}

/**
 * Reenvio manual, a partir da tela da análise.
 *
 * Existe porque a falha de um e-mail é, por natureza, recuperável por FORA do sistema:
 * o endereço estava errado, a lista estava vazia, o anexo não cabia. Sem esta porta, o
 * único caminho seria reenviar a análise inteira — e reenviar resolve buyer de novo, que
 * é a chamada que pode ser cobrada.
 *
 * Não exige estágio: uma análise já enviada é exatamente o caso em que o reenvio faz
 * sentido, e é dela que a pessoa está olhando quando descobre que o documento não chegou.
 */
export async function reenviarDocumentosPorEmail(
  analiseId: string,
  docIds: string[],
): Promise<ResultadoEnvioDocsEmail> {
  const { data: a } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, limite_solicitado, moeda, atradius_case_id, empresas(razao_social)')
    .eq('id', analiseId)
    .maybeSingle()
  if (!a) {
    logger.warn({ analiseId }, 'Reenvio de documentos: análise não encontrada.')
    return { enviados: 0, emails: 0, motivo: 'falha' }
  }

  const empresa = a.empresas as { razao_social: string | null } | null
  return enviarDocumentosPorEmail(
    {
      id: a.id,
      cnpj: a.cnpj,
      razao_social: empresa?.razao_social ?? null,
      case_id: a.atradius_case_id,
      limite_solicitado: a.limite_solicitado === null ? null : Number(a.limite_solicitado),
      moeda: a.moeda,
    },
    docIds,
  )
}
