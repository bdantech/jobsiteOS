import { z } from 'zod'
import { diasEntreDatas, hojeSaoPaulo } from '../../../../../packages/core/src/cobranca/datas.js'
import { formatarBrl, formatarCnpjCobranca, formatarDataBr } from '../../../../../packages/core/src/cobranca/modelos.js'
import { escreverNoLedger } from '../../comunicacao/ledger.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { BUCKET_COBRANCAS, baixarArquivo, lerConfigCobranca, sha256Hex } from './comum.js'
import { gerarDossieSinistro, indiceDoZip } from './dossie.js'
import {
  enviarDocumentos,
  enviarSinistro,
  nonPaymentsHabilitada,
  notificarNaoPagamento,
  type AvisoNaoPagamento,
} from './non-payments.js'

/**
 * `POST /jobs/cobranca/seguradora` — a notificação de inadimplemento (cl. 18500.01, o
 * D+90) e o envio do sinistro (cl. 22100.20) à Atradius. SÍNCRONO, e só transporte:
 * NÃO muda o estágio do sinistro. A action da web chama `moverSinistro` DEPOIS do
 * `ok`, com o protocolo — o prazo registrado é o do ato confirmado, não o do clique.
 *
 * ── DOIS MODOS, UM CONTEÚDO (§7.4) ──────────────────────────────────────────
 *   manual  (padrão, funciona hoje) — e-mail formal ao contato da apólice, com o ZIP do
 *           dossiê no envio do sinistro. O protocolo da Atradius chega depois, por
 *           resposta, e a pessoa o cola na tela.
 *   api     (flag ATRADIUS_NON_PAYMENTS_ENABLED + config `modo_envio = api`) — a
 *           Non-Payments API, com o MESMO conteúdo. Qualquer falha devolve `ok: false`
 *           mandando para o manual: o prazo nunca depende da API.
 *
 * ── POR QUE FORA DA FILA DA COMUNICAÇÃO ─────────────────────────────────────
 * A mesma decisão de `credito/documentos-email.ts`: a fila aplica cooldown, janela e
 * teto de conversa com cliente, e qualquer um deles pode ADIAR o e-mail. O aviso do
 * D+90 adiado para a próxima janela é um prazo perdido. O envio é direto; o registro
 * no ledger vem depois, como prova.
 */

export const seguradoraSchema = z.object({
  sinistro_id: z.string().uuid(),
  acao: z.enum(['notificar', 'enviar']),
  /** Força o modo desta chamada — é o "use o manual" depois de uma falha da API. */
  modo: z.enum(['manual', 'api']).optional(),
})
export type SeguradoraInput = z.infer<typeof seguradoraSchema>

export interface ResultadoSeguradoraEnvio {
  ok: boolean
  modo: 'manual' | 'api'
  protocolo?: string
  mensagem: string
}

/** O Resend aceita até 40 MB por mensagem, já em base64 (+33%). */
const TETO_ZIP_BYTES = 28 * 1024 * 1024

interface Contexto {
  s: {
    id: string
    codigo: string | null
    cobranca_id: string | null
    sacado_matriz_cnpj: string
    sacado_empresa_id: string | null
    causa: string
    data_perda: string
    dossie_path: string | null
    protocolo_externo: string | null
    responsavel_id: string | null
  }
  apoliceNumero: string
  seguradora: string
  sacadoNome: string
  cobrancaCodigo: string | null
  titulos: AvisoNaoPagamento['titulos']
  limiteNotificacao: string | null
}

export async function envioSeguradora(input: SeguradoraInput): Promise<ResultadoSeguradoraEnvio> {
  const cfg = await lerConfigCobranca()
  const modoConfig = cfg.apolice.modo_envio === 'api' && nonPaymentsHabilitada() ? 'api' : 'manual'
  const modo = input.modo ?? modoConfig

  if (modo === 'api' && !nonPaymentsHabilitada()) {
    return {
      ok: false,
      modo,
      mensagem: 'A Non-Payments API não está habilitada no worker (ATRADIUS_NON_PAYMENTS_ENABLED). Use o modo manual.',
    }
  }

  const ctx = await carregar(input.sinistro_id)
  if (!ctx) return { ok: false, modo, mensagem: 'Sinistro não encontrado.' }
  if (ctx.titulos.length === 0) return { ok: false, modo, mensagem: 'O sinistro não tem títulos.' }

  return modo === 'api' ? viaApi(input.acao, ctx, cfg.apolice.contato_seguradora) : viaEmail(input.acao, ctx, cfg)
}

async function carregar(sinistroId: string): Promise<Contexto | null> {
  const { data: s } = await supabaseAdmin
    .from('sinistros')
    .select('id, codigo, cobranca_id, sacado_matriz_cnpj, sacado_empresa_id, causa, data_perda, dossie_path, protocolo_externo, responsavel_id, apolice_id')
    .eq('id', sinistroId)
    .maybeSingle()
  if (!s) return null

  const [{ data: apolice }, { data: cobranca }, { data: st }, { data: prazos }] = await Promise.all([
    supabaseAdmin.from('apolices').select('numero, seguradora').eq('id', s.apolice_id).maybeSingle(),
    s.cobranca_id
      ? supabaseAdmin.from('cobrancas').select('codigo').eq('id', s.cobranca_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from('sinistro_titulos')
      .select('valor_face, titulos(numero, externo_id, nf_chave_acesso, emissao, vencimento, sacado_cnpj, sacado_nome, valor_pago)')
      .eq('sinistro_id', s.id),
    supabaseAdmin.from('apolice_prazos').select('data_limite_notificacao').eq('sinistro_id', s.id),
  ])

  const linhas = (st ?? []).map((r) => ({
    face: Number(r.valor_face),
    t: r.titulos as {
      numero: string | null
      externo_id: string
      nf_chave_acesso: string | null
      emissao: string | null
      vencimento: string
      sacado_cnpj: string
      sacado_nome: string | null
      valor_pago: number | null
    } | null,
  }))

  let sacadoNome: string | null = null
  if (s.sacado_empresa_id) {
    const { data } = await supabaseAdmin.from('empresas').select('razao_social').eq('id', s.sacado_empresa_id).maybeSingle()
    sacadoNome = data?.razao_social ?? null
  }
  sacadoNome ??=
    linhas.find((l) => l.t?.sacado_cnpj === s.sacado_matriz_cnpj)?.t?.sacado_nome ??
    linhas.find((l) => l.t?.sacado_nome)?.t?.sacado_nome ??
    formatarCnpjCobranca(s.sacado_matriz_cnpj)

  return {
    s,
    apoliceNumero: apolice?.numero ?? '—',
    seguradora: apolice?.seguradora ?? 'Atradius Crédito y Caución',
    sacadoNome,
    cobrancaCodigo: cobranca?.codigo ?? null,
    titulos: linhas
      .filter((l) => l.t)
      .map((l) => ({
        numero: l.t!.numero ?? l.t!.externo_id,
        nf_chave_acesso: l.t!.nf_chave_acesso,
        emissao: l.t!.emissao,
        vencimento: l.t!.vencimento,
        valor_face: l.face,
        valor_em_aberto: Math.max(0, Math.round((l.face - Number(l.t!.valor_pago ?? 0)) * 100) / 100),
      }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    limiteNotificacao: (prazos ?? []).map((p) => p.data_limite_notificacao).sort()[0] ?? null,
  }
}

// ─── API ────────────────────────────────────────────────────────────────────

async function viaApi(
  acao: SeguradoraInput['acao'],
  ctx: Contexto,
  contato: { nome: string | null; email: string | null },
): Promise<ResultadoSeguradoraEnvio> {
  const aviso: AvisoNaoPagamento = {
    referencia: ctx.s.codigo ?? ctx.s.id,
    comprador_cnpj: ctx.s.sacado_matriz_cnpj,
    comprador_nome: ctx.sacadoNome,
    causa: ctx.s.causa === 'insolvencia' ? 'insolvencia' : 'mora_prolongada',
    data_perda: ctx.s.data_perda,
    titulos: ctx.titulos,
    contato,
  }
  const falhou = (erro: string): ResultadoSeguradoraEnvio => ({
    ok: false,
    modo: 'api',
    mensagem:
      `A Non-Payments API da Atradius falhou: ${erro}. Nada foi registrado como enviado. ` +
      'O prazo não depende da API — envie agora pelo modo manual (e-mail formal ao contato da apólice).',
  })

  if (acao === 'notificar') {
    const r = await notificarNaoPagamento(aviso)
    if (!r.ok) return falhou(r.erro)
    return {
      ok: true,
      modo: 'api',
      ...(r.dados.protocolo ? { protocolo: r.dados.protocolo } : {}),
      mensagem: `Aviso de não pagamento enviado pela API${r.dados.protocolo ? ` (protocolo ${r.dados.protocolo})` : ''}.`,
    }
  }

  const zip = await dossieAtual(ctx)
  if ('erro' in zip) return falhou(zip.erro)
  const r = await enviarSinistro(aviso, ctx.s.protocolo_externo)
  if (!r.ok) return falhou(r.erro)
  const protocolo = r.dados.protocolo
  if (protocolo) {
    const d = await enviarDocumentos(protocolo, { nome: `dossie-${ctx.s.codigo ?? ctx.s.id}.zip`, bytes: zip.bytes, sha256: zip.sha256 })
    if (!d.ok) return falhou(`sinistro aceito (protocolo ${protocolo}), mas o dossiê não subiu — ${d.erro}`)
  }
  return {
    ok: true,
    modo: 'api',
    ...(protocolo ? { protocolo } : {}),
    mensagem: `Sinistro enviado pela API${protocolo ? ` (protocolo ${protocolo})` : ''}, com o dossiê anexado.`,
  }
}

// ─── Manual: e-mail formal ──────────────────────────────────────────────────

async function dossieAtual(ctx: Contexto): Promise<{ caminho: string; bytes: Uint8Array; sha256: string } | { erro: string }> {
  let caminho = ctx.s.dossie_path
  if (!caminho) {
    try {
      caminho = (await gerarDossieSinistro(ctx.s.id)).dossie_path
    } catch (e) {
      return { erro: `não foi possível gerar o dossiê (${e instanceof Error ? e.message : String(e)})` }
    }
  }
  const bytes = await baixarArquivo(caminho)
  if (!bytes) return { erro: 'o ZIP do dossiê não pôde ser lido do bucket; gere o dossiê de novo' }
  return { caminho, bytes, sha256: sha256Hex(bytes) }
}

const CAUSA: Record<string, string> = { mora_prolongada: 'mora prolongada', insolvencia: 'insolvência' }

function listaDeTitulos(ctx: Contexto, hoje: string): string[] {
  return ctx.titulos.map(
    (t) =>
      `  • Título ${t.numero}${t.nf_chave_acesso ? ` · NF ${Number(t.nf_chave_acesso.slice(25, 34)) || t.nf_chave_acesso}` : ''}` +
      ` · vencimento ${formatarDataBr(t.vencimento)} (D+${diasEntreDatas(t.vencimento, hoje)})` +
      ` · ${formatarBrl(t.valor_em_aberto)}`,
  )
}

async function viaEmail(
  acao: SeguradoraInput['acao'],
  ctx: Contexto,
  cfg: Awaited<ReturnType<typeof lerConfigCobranca>>,
): Promise<ResultadoSeguradoraEnvio> {
  const contato = cfg.apolice.contato_seguradora
  if (!contato.email) {
    return {
      ok: false,
      modo: 'manual',
      mensagem: 'O e-mail do contato da seguradora não está cadastrado. Preencha em Cobrança › Configurações › Apólice e tente de novo.',
    }
  }
  const remetente = env.RESEND_REMETENTE_INTERNO ?? env.RESEND_REMETENTE
  if (!env.RESEND_API_KEY || !remetente) {
    return {
      ok: false,
      modo: 'manual',
      mensagem: 'RESEND_API_KEY ou o remetente não estão configurados no worker — nenhum e-mail saiu.',
    }
  }

  const hoje = hojeSaoPaulo()
  const total = ctx.titulos.reduce((s, t) => s + t.valor_em_aberto, 0)
  const ref = ctx.s.codigo ?? ctx.s.id
  const saudacao = contato.nome ? `Prezado(a) ${contato.nome},` : 'Prezados,'
  const comprador = `${ctx.sacadoNome} — CNPJ ${formatarCnpjCobranca(ctx.s.sacado_matriz_cnpj)}`
  const assinatura = ['Atenciosamente,', cfg.credor.razao_social, `CNPJ ${formatarCnpjCobranca(cfg.credor.cnpj)}`]

  let assunto: string
  let corpo: string
  const anexos: { filename: string; content: string }[] = []
  let anexoLedger: Record<string, unknown> | null = null

  if (acao === 'notificar') {
    const maisAntigo = ctx.titulos[0]!.vencimento
    assunto = `Aviso de não pagamento — Apólice ${ctx.apoliceNumero} — ${ref} — ${ctx.sacadoNome}`
    corpo = [
      saudacao,
      '',
      `Na qualidade de segurada da apólice ${ctx.apoliceNumero} (${ctx.seguradora}), comunicamos, nos termos da cl. 18500.01, ` +
        'o inadimplemento do comprador abaixo identificado.',
      '',
      `Comprador: ${comprador}`,
      `Causa: ${CAUSA[ctx.s.causa] ?? ctx.s.causa}`,
      `Referência: sinistro ${ref}${ctx.cobrancaCodigo ? ` · cobrança ${ctx.cobrancaCodigo}` : ''}`,
      '',
      'Títulos vencidos e não pagos (vencimento ORIGINAL, cl. 16900.20):',
      ...listaDeTitulos(ctx, hoje),
      '',
      `Total em aberto: ${formatarBrl(total)} em ${ctx.titulos.length} título(s).`,
      `Vencimento mais antigo: ${formatarDataBr(maisAntigo)}.` +
        (ctx.limiteNotificacao ? ` Prazo de notificação (D+90): ${formatarDataBr(ctx.limiteNotificacao)}.` : ''),
      `${ctx.s.causa === 'insolvencia' ? 'Data da Perda' : 'Data da Perda prevista'}: ${formatarDataBr(ctx.s.data_perda)}.`,
      '',
      'Seguimos com as medidas de cobrança (notificação extrajudicial e, quando cabível, protesto e medidas judiciais), ' +
        'e a documentação completa do sinistro será encaminhada no prazo da apólice. Pedimos a confirmação do recebimento ' +
        'com o número de protocolo.',
      '',
      ...assinatura,
    ].join('\n')
  } else {
    const zip = await dossieAtual(ctx)
    if ('erro' in zip) return { ok: false, modo: 'manual', mensagem: `O dossiê não está disponível: ${zip.erro}.` }
    if (zip.bytes.byteLength > TETO_ZIP_BYTES) {
      return {
        ok: false,
        modo: 'manual',
        mensagem:
          `O dossiê tem ${(zip.bytes.byteLength / 1024 / 1024).toFixed(1)} MB, acima do limite de um e-mail. ` +
          'Baixe o ZIP na tela do sinistro e envie por um link de transferência; depois registre o envio com o protocolo.',
      }
    }
    const indice = indiceDoZip(zip.bytes) ?? '(índice indisponível — ver 00-indice.pdf no ZIP)'
    const nome = `dossie-${ref}.zip`
    assunto = `Sinistro ${ref} — Apólice ${ctx.apoliceNumero} — ${ctx.sacadoNome}`
    corpo = [
      saudacao,
      '',
      `Encaminhamos, nos termos da cl. 22100.20 da apólice ${ctx.apoliceNumero} (${ctx.seguradora}), o sinistro do comprador ` +
        `${comprador}, com a documentação da cl. 22208.00 no arquivo anexo (${nome}).`,
      '',
      `Total reclamado (face em aberto): ${formatarBrl(total)} em ${ctx.titulos.length} título(s). ` +
        `Data da Perda: ${formatarDataBr(ctx.s.data_perda)} (${CAUSA[ctx.s.causa] ?? ctx.s.causa}).`,
      ctx.s.protocolo_externo ? `Protocolo do aviso de não pagamento: ${ctx.s.protocolo_externo}.` : '',
      '',
      `SHA-256 do arquivo anexo: ${zip.sha256}`,
      '',
      '—— Índice do dossiê ——',
      indice,
      '',
      'Pedimos a confirmação do recebimento com o número de protocolo.',
      '',
      ...assinatura,
    ]
      .filter((l, k, arr) => !(l === '' && arr[k - 1] === ''))
      .join('\n')
    anexos.push({ filename: nome, content: Buffer.from(zip.bytes).toString('base64') })
    anexoLedger = { nome, bucket: BUCKET_COBRANCAS, caminho: zip.caminho, mime: 'application/zip', sha256: zip.sha256 }
  }

  // Cópia para o responsável: a resposta da seguradora precisa chegar a quem cuida do caso.
  let cc: string | null = null
  if (ctx.s.responsavel_id) {
    const { data: u } = await supabaseAdmin.from('usuarios').select('email').eq('id', ctx.s.responsavel_id).maybeSingle()
    cc = u?.email ?? null
  }

  const r = await enviarResend({
    apiKey: env.RESEND_API_KEY,
    remetente,
    para: contato.email,
    cc,
    assunto,
    corpo,
    anexos,
  })
  if (!r.ok) {
    logger.error({ sinistro: ctx.s.id, acao, erro: r.erro }, 'E-mail à seguradora falhou.')
    return { ok: false, modo: 'manual', mensagem: `O e-mail à seguradora não saiu: ${r.erro}. Nada foi registrado como enviado.` }
  }

  /*
   * No ledger, como prova: é correspondência do sinistro, e o dossiê (item g) e a
   * auditoria precisam achá-la. Sem conversa nem contato — a seguradora não é contato
   * de ninguém —, mas na empresa do sacado, que é de quem o e-mail fala. O corpo é o
   * enviado, o anexo vai como referência ao bucket (sem os bytes).
   */
  const comunicacaoId = await escreverNoLedger({
    conversaId: null,
    empresaId: ctx.s.sacado_empresa_id,
    contatoId: null,
    canal: 'email',
    direcao: 'saida',
    assunto,
    corpo,
    anexos: anexoLedger ? [anexoLedger] : [],
    provedor: 'resend',
    idExterno: r.id,
    contaRemetente: remetente,
    statusEnvio: 'enviada',
    origem: 'cobranca',
    enviadoEm: new Date(),
  })
  if (!comunicacaoId) logger.warn({ sinistro: ctx.s.id }, 'E-mail à seguradora enviado, mas não gravado no ledger.')

  return {
    ok: true,
    modo: 'manual',
    mensagem:
      `E-mail ${acao === 'notificar' ? 'de aviso de não pagamento' : 'do sinistro, com o dossiê,'} enviado a ${contato.email}` +
      `${cc ? ` (cópia para ${cc})` : ''}. Registre o protocolo da seguradora quando a resposta chegar.`,
  }
}

/** Três tentativas para 429/5xx/rede; 4xx volta na hora (anexo grande continua grande). */
async function enviarResend(m: {
  apiKey: string
  remetente: string
  para: string
  cc: string | null
  assunto: string
  corpo: string
  anexos: { filename: string; content: string }[]
}): Promise<{ ok: true; id: string | null } | { ok: false; erro: string }> {
  let ultimo = 'sem tentativa'
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${m.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: m.remetente,
          to: [m.para],
          ...(m.cc && m.cc !== m.para ? { cc: [m.cc], reply_to: m.cc } : {}),
          subject: m.assunto,
          text: m.corpo,
          ...(m.anexos.length ? { attachments: m.anexos } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      })
      const corpo = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
      if (res.ok) return { ok: true, id: corpo.id ?? null }
      ultimo = corpo.message ?? `HTTP ${res.status}`
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, erro: ultimo }
    } catch (erro) {
      ultimo = String(erro)
    }
    if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa))
  }
  return { ok: false, erro: ultimo }
}
