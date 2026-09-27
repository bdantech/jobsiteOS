import { z } from 'zod'
import { hojeSaoPaulo, diasEntreDatas } from '../../../../../packages/core/src/cobranca/datas.js'
import { memoriaAtualizacaoMarkdown, type ResultadoAtualizacao } from '../../../../../packages/core/src/cobranca/atualizacao.js'
import {
  ErroModeloCobranca,
  formatarCnpjCobranca,
  renderizarModeloCobranca,
  valoresDoContexto,
  type ContextoNotificacao,
  type LinhaTituloNotificacao,
} from '../../../../../packages/core/src/cobranca/modelos.js'
import { tabelaParcelasMarkdown, type SimulacaoParcelamento } from '../../../../../packages/core/src/cobranca/parcelamento.js'
import type { EnderecoDestinatario, TipoModeloCobranca } from '../../../../../packages/core/src/cobranca/schemas.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { BUCKET_COBRANCAS, lerConfigCobranca, sha256Hex, subirArquivo } from './comum.js'
import { markdownParaPdf } from './pdf.js'
import { carimbo, formatarAvalistas, formatarTestemunhas, valoresDaMemoria, type AvalistaMinuta } from './regras.js'

/**
 * `POST /jobs/cobranca/documentos` — o PDF da notificação extrajudicial (§5) e o da
 * minuta de confissão de dívida (§9.3). SÍNCRONO: quem clicou "Gerar PDF" está com a
 * tela aberta e precisa do documento para revisar antes de enviar.
 *
 * ── OS VALORES SÃO OS GRAVADOS ──────────────────────────────────────────────
 * O valor atualizado de cada título vem da `memoria_calculo` que a tela gravou na
 * notificação, e não de um cálculo refeito aqui. A carta tem de mostrar exatamente o
 * número que a pessoa viu quando decidiu enviá-la; recalcular no worker (com o índice
 * do mês que virou no meio) produziria um PDF que discorda da tela em centavos.
 *
 * ── IMUTÁVEL DEPOIS DE ENVIADO ──────────────────────────────────────────────
 * Cada geração é um arquivo NOVO (carimbo no nome, `upsert: false`), e a linha só é
 * atualizada enquanto está em rascunho/pronta. Uma notificação enviada nunca ganha
 * outro PDF: mudança depois do envio é nova rodada (§5).
 *
 * Placeholder sem valor é erro com a mensagem do core ("Falta preencher…"), e não um
 * PDF com um buraco no lugar do valor.
 */

export const documentosCobrancaSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('notificacoes'), notificacao_ids: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ tipo: z.literal('minuta'), acordo_id: z.string().uuid() }),
])
export type DocumentosCobrancaInput = z.infer<typeof documentosCobrancaSchema>

export interface ResultadoDocumentos {
  gerados: { id: string; caminho: string; sha256: string }[]
  erros: { id: string; mensagem: string }[]
}

class ErroDocumento extends Error {}

export async function gerarDocumentosCobranca(input: DocumentosCobrancaInput): Promise<ResultadoDocumentos> {
  const out: ResultadoDocumentos = { gerados: [], erros: [] }
  const ids = input.tipo === 'notificacoes' ? input.notificacao_ids : [input.acordo_id]
  for (const id of ids) {
    try {
      const g = input.tipo === 'notificacoes' ? await gerarNotificacao(id) : await gerarMinuta(id)
      out.gerados.push({ id, ...g })
    } catch (erro) {
      const mensagem =
        erro instanceof ErroModeloCobranca || erro instanceof ErroDocumento
          ? erro.message
          : 'Não foi possível gerar o documento. Tente de novo; se persistir, avise o suporte.'
      if (!(erro instanceof ErroModeloCobranca || erro instanceof ErroDocumento)) {
        logger.error({ id, tipo: input.tipo, erro: String(erro) }, 'Falha ao gerar documento da cobrança.')
      }
      out.erros.push({ id, mensagem })
    }
  }
  return out
}

// ─── Leituras comuns ────────────────────────────────────────────────────────

interface Modelo {
  id: string
  tipo: TipoModeloCobranca
  corpo_markdown: string
}

async function modeloPara(modeloId: string | null, tipoPadrao: TipoModeloCobranca): Promise<Modelo> {
  if (modeloId) {
    const { data } = await supabaseAdmin.from('cobranca_modelos').select('id, tipo, corpo_markdown').eq('id', modeloId).maybeSingle()
    if (data) return data as Modelo
  }
  const { data } = await supabaseAdmin
    .from('cobranca_modelos')
    .select('id, tipo, corpo_markdown')
    .eq('tipo', tipoPadrao)
    .eq('ativo', true)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) throw new ErroDocumento(`Nenhum modelo ativo do tipo "${tipoPadrao}". Cadastre um em Cobrança › Modelos.`)
  return data as Modelo
}

function lerMemoria(bruto: unknown): ResultadoAtualizacao | null {
  if (!bruto || typeof bruto !== 'object' || !Array.isArray((bruto as { memoria?: unknown }).memoria)) return null
  return bruto as ResultadoAtualizacao
}

/** A memória em Markdown, ou `null` — e aí `{{memoria_calculo}}` acusa a falta. */
function memoriaMarkdown(m: ResultadoAtualizacao | null): string | null {
  if (!m) return null
  try {
    return memoriaAtualizacaoMarkdown(m)
  } catch (erro) {
    logger.warn({ erro: String(erro) }, 'Memória de cálculo gravada não pôde ser lida.')
    return null
  }
}

interface LinhaCt {
  id: string
  titulo_id: string
  valor_face_snapshot: number
  vencimento_snapshot: string
  sacado_cnpj_snapshot: string
  cedente_cnpj_snapshot: string
  titulos: {
    numero: string | null
    nf_chave_acesso: string | null
    emissao: string | null
    sacado_nome: string | null
    cedente_nome: string | null
  } | null
}

/** O número da NF, e não a chave de 44 dígitos: é o que o devedor encontra na contabilidade dele. */
async function numerosDeNf(chaves: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (chaves.length === 0) return m
  const { data } = await supabaseAdmin.from('notas_fiscais').select('access_key, numero').in('access_key', chaves)
  for (const n of data ?? []) if (n.numero) m.set(n.access_key, n.numero)
  return m
}

async function linhasDeTitulos(
  cts: readonly LinhaCt[],
  memoria: ResultadoAtualizacao | null,
  dataBase: string,
): Promise<LinhaTituloNotificacao[]> {
  const nfs = await numerosDeNf(cts.map((c) => c.titulos?.nf_chave_acesso).filter((x): x is string => !!x))
  const porId = valoresDaMemoria(memoria)
  return [...cts]
    .sort((a, b) => a.vencimento_snapshot.localeCompare(b.vencimento_snapshot))
    .map((ct) => {
      const t = ct.titulos
      const linha = porId.get(ct.id) ?? porId.get(ct.titulo_id) ?? null
      const chave = t?.nf_chave_acesso ?? null
      return {
        numero: t?.numero ?? null,
        nf: chave ? (nfs.get(chave) ?? chave) : null,
        cedente: t?.cedente_nome ?? formatarCnpjCobranca(ct.cedente_cnpj_snapshot),
        spe_devedora: `${t?.sacado_nome ?? ''} (${formatarCnpjCobranca(ct.sacado_cnpj_snapshot)})`.trim(),
        emissao: t?.emissao ?? null,
        vencimento: ct.vencimento_snapshot,
        dias_atraso: linha?.dias_em_atraso ?? Math.max(0, diasEntreDatas(ct.vencimento_snapshot, dataBase)),
        valor_face: Number(ct.valor_face_snapshot),
        valor_atualizado: linha ? Number(linha.subtotal) : null,
      }
    })
}

const SELECT_CT =
  'id, titulo_id, valor_face_snapshot, vencimento_snapshot, sacado_cnpj_snapshot, cedente_cnpj_snapshot, titulos(numero, nf_chave_acesso, emissao, sacado_nome, cedente_nome)'

// ─── Notificação (§5) ───────────────────────────────────────────────────────

async function gerarNotificacao(id: string): Promise<{ caminho: string; sha256: string }> {
  const { data: n, error } = await supabaseAdmin.from('cobranca_notificacoes').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!n) throw new ErroDocumento('Notificação não encontrada.')
  if (!['rascunho', 'pronta'].includes(n.status)) {
    throw new ErroDocumento('Esta notificação já foi enviada: o PDF enviado é imutável. Para mudar, gere uma nova rodada.')
  }

  const { data: c } = await supabaseAdmin.from('cobrancas').select('id, codigo, data_base').eq('id', n.cobranca_id).maybeSingle()
  if (!c) throw new ErroDocumento('Cobrança não encontrada.')

  const { data: vinc } = await supabaseAdmin
    .from('cobranca_notificacao_titulos')
    .select('cobranca_titulo_id')
    .eq('notificacao_id', id)
  const ctIds = (vinc ?? []).map((v) => v.cobranca_titulo_id).filter((x): x is string => !!x)
  if (ctIds.length === 0) throw new ErroDocumento('A notificação não tem títulos.')
  const { data: cts } = await supabaseAdmin.from('cobranca_titulos').select(SELECT_CT).in('id', ctIds)

  const cfg = await lerConfigCobranca()
  const hoje = hojeSaoPaulo()
  const memoria = lerMemoria(n.memoria_calculo)
  const dataBase = memoria?.data_base ?? c.data_base ?? hoje

  const tipoPadrao: TipoModeloCobranca =
    n.rodada > 1 ? 'reiteracao' : n.papel.startsWith('cedente') ? 'notificacao_cedente' : 'notificacao_sacado'
  const modelo = await modeloPara(n.modelo_id, tipoPadrao)

  const ctx: ContextoNotificacao = {
    destinatario: {
      razao_social: n.destinatario_razao_social,
      cnpj: n.destinatario_cnpj,
      endereco: (n.destinatario_endereco as EnderecoDestinatario | null) ?? null,
    },
    credor: cfg.credor,
    codigo: c.codigo ?? c.id,
    rodada: n.rodada,
    titulos: await linhasDeTitulos((cts ?? []) as LinhaCt[], memoria, dataBase),
    mostrar_spe: n.papel === 'sacado_matriz',
    valor_total_face: Number(n.valor_total),
    valor_total_atualizado:
      n.valor_total_atualizado !== null ? Number(n.valor_total_atualizado) : memoria ? Number(memoria.total) : null,
    data_base: dataBase,
    prazo_dias: n.prazo_pagamento_dias,
    prazo_uteis: cfg.cobranca.prazo_pagamento_uteis,
    prazo_data: n.prazo_expira_em,
    data_hoje: hoje,
    memoria_calculo: memoriaMarkdown(memoria),
  }

  const md = renderizarModeloCobranca(modelo.tipo, modelo.corpo_markdown, valoresDoContexto(ctx))
  const pdf = await markdownParaPdf(md, {
    titulo: `Notificação ${ctx.codigo} — ${n.destinatario_razao_social} — rodada ${n.rodada}`,
    rodape: `${ctx.codigo} · ${n.destinatario_razao_social} · rodada ${n.rodada} · emitida em ${hoje.split('-').reverse().join('/')}`,
  })
  const sha = sha256Hex(pdf)
  const caminho = `${n.cobranca_id}/notificacoes/${n.id}-r${n.rodada}-${carimbo()}.pdf`
  await subirArquivo(caminho, pdf, 'application/pdf')

  const { data: gravada, error: erroUpd } = await supabaseAdmin
    .from('cobranca_notificacoes')
    .update({ documento_path: caminho, documento_hash: sha, status: 'pronta', modelo_id: modelo.id })
    .eq('id', n.id)
    .in('status', ['rascunho', 'pronta'])
    .select('id')
  if (erroUpd || !gravada?.length) {
    // Alguém enviou (ou apagou a rodada) enquanto o PDF era gerado: o arquivo novo não
    // é de ninguém, e um órfão no bucket seria um "documento" que nunca existiu.
    await supabaseAdmin.storage.from(BUCKET_COBRANCAS).remove([caminho])
    throw new ErroDocumento(erroUpd?.message ?? 'A notificação mudou de estado durante a geração; nada foi alterado.')
  }
  return { caminho, sha256: sha }
}

// ─── Minuta de confissão de dívida (§9.3) ───────────────────────────────────

interface ParcelaGravada {
  numero?: number
  vencimento?: string | null
  valor?: number
}

async function gerarMinuta(acordoId: string): Promise<{ caminho: string; sha256: string }> {
  const { data: a, error } = await supabaseAdmin.from('acordos').select('*').eq('id', acordoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!a) throw new ErroDocumento('Acordo não encontrado.')
  if (!['simulado', 'minuta_gerada'].includes(a.status)) {
    throw new ErroDocumento(
      a.status === 'assinado' ? 'O acordo já está assinado: a minuta não é mais regerada.' : 'O acordo foi cancelado.',
    )
  }

  const { data: c } = await supabaseAdmin
    .from('cobrancas')
    .select('id, codigo, data_base, sacado_matriz_cnpj, sacado_empresa_id')
    .eq('id', a.cobranca_id)
    .maybeSingle()
  if (!c) throw new ErroDocumento('Cobrança não encontrada.')

  const { data: cts } = await supabaseAdmin
    .from('cobranca_titulos')
    .select(SELECT_CT)
    .eq('cobranca_id', c.id)
    .neq('situacao', 'retirado')

  const cfg = await lerConfigCobranca()
  const hoje = hojeSaoPaulo()
  const memoria = lerMemoria(a.memoria_calculo)
  const dataBase = memoria?.data_base ?? c.data_base ?? hoje
  const devedor = await qualificacaoDoSacado(c.id, c.sacado_matriz_cnpj, c.sacado_empresa_id)

  const parcelas = (Array.isArray(a.parcelas) ? (a.parcelas as ParcelaGravada[]) : []).map((p, k) => ({
    numero: Number(p.numero ?? k + 1),
    vencimento: p.vencimento ?? null,
    amortizacao: 0,
    juros: 0,
    valor: Number(p.valor ?? 0),
    saldo_devedor: 0,
  }))
  // A tabela lê só número, vencimento, valor e o rodapé (total, sistema, juros): o
  // cronograma é o GRAVADO no acordo, não uma simulação refeita.
  const simulacao = {
    parcelas,
    qtd_parcelas: a.qtd_parcelas,
    valor_total_projetado: Number(a.valor_total_projetado ?? parcelas.reduce((s, p) => s + p.valor, 0)),
    sistema: a.sistema,
    juros_mes: Number(a.juros_parcelamento_mes),
  } as unknown as SimulacaoParcelamento

  const dados = (a.dados_minuta ?? {}) as {
    avalistas?: AvalistaMinuta[]
    bem_garantia?: string
    foro?: string
    testemunhas?: { nome: string; cpf: string }[]
  }
  const modelo = await modeloPara(a.modelo_minuta_id, 'confissao_divida_simples')
  const titulos = await linhasDeTitulos((cts ?? []) as LinhaCt[], memoria, dataBase)

  const ctx: ContextoNotificacao = {
    destinatario: devedor,
    credor: cfg.credor,
    codigo: c.codigo ?? c.id,
    rodada: 1,
    titulos,
    mostrar_spe: true,
    valor_total_face: titulos.reduce((s, t) => s + t.valor_face, 0),
    valor_total_atualizado: Number(a.valor_atualizado),
    data_base: dataBase,
    prazo_dias: cfg.cobranca.prazo_pagamento_dias,
    prazo_uteis: cfg.cobranca.prazo_pagamento_uteis,
    prazo_data: null,
    data_hoje: hoje,
    memoria_calculo: memoriaMarkdown(memoria),
    confissao: {
      tabela_parcelas: tabelaParcelasMarkdown(simulacao),
      valor_confessado: Number(a.valor_atualizado),
      avalistas: formatarAvalistas(dados.avalistas),
      bem_garantia: dados.bem_garantia?.trim() || null,
      foro: dados.foro?.trim() || null,
      testemunhas: formatarTestemunhas(dados.testemunhas),
    },
  }

  const md = renderizarModeloCobranca(modelo.tipo, modelo.corpo_markdown, valoresDoContexto(ctx))
  const pdf = await markdownParaPdf(md, {
    titulo: `Confissão de dívida ${ctx.codigo}`,
    rodape: `${ctx.codigo} · minuta de confissão de dívida · gerada em ${hoje.split('-').reverse().join('/')}`,
  })
  const sha = sha256Hex(pdf)
  const caminho = `${c.id}/acordos/${a.id}-minuta-${carimbo()}.pdf`
  await subirArquivo(caminho, pdf, 'application/pdf')

  const { data: gravado, error: erroUpd } = await supabaseAdmin
    .from('acordos')
    .update({ minuta_path: caminho, minuta_hash: sha, status: 'minuta_gerada', modelo_minuta_id: modelo.id })
    .eq('id', a.id)
    .in('status', ['simulado', 'minuta_gerada'])
    .select('id')
  if (erroUpd || !gravado?.length) {
    await supabaseAdmin.storage.from(BUCKET_COBRANCAS).remove([caminho])
    throw new ErroDocumento(erroUpd?.message ?? 'O acordo mudou de estado durante a geração; nada foi alterado.')
  }
  return { caminho, sha256: sha }
}

/**
 * Quem confessa é o cabeça do grupo. A qualificação vem, nesta ordem, da notificação da
 * matriz (que alguém pode ter corrigido antes do envio), do cadastro da empresa e do
 * cadastral da Receita.
 */
async function qualificacaoDoSacado(
  cobrancaId: string,
  matriz: string,
  empresaId: string | null,
): Promise<ContextoNotificacao['destinatario']> {
  const { data: notif } = await supabaseAdmin
    .from('cobranca_notificacoes')
    .select('destinatario_razao_social, destinatario_endereco')
    .eq('cobranca_id', cobrancaId)
    .eq('papel', 'sacado_matriz')
    .order('rodada', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (notif?.destinatario_endereco) {
    return { razao_social: notif.destinatario_razao_social, cnpj: matriz, endereco: notif.destinatario_endereco as EnderecoDestinatario }
  }
  const { data: u } = await supabaseAdmin
    .from('mercado_universo')
    .select('razao_social, logradouro, numero, bairro, municipio, uf, cep')
    .eq('cnpj', matriz)
    .maybeSingle()
  let razao = notif?.destinatario_razao_social ?? u?.razao_social ?? null
  if (!razao && empresaId) {
    const { data: e } = await supabaseAdmin.from('empresas').select('razao_social').eq('id', empresaId).maybeSingle()
    razao = e?.razao_social ?? null
  }
  return {
    razao_social: razao ?? formatarCnpjCobranca(matriz),
    cnpj: matriz,
    endereco: u ? { logradouro: u.logradouro, numero: u.numero, bairro: u.bairro, municipio: u.municipio, uf: u.uf, cep: u.cep } : null,
  }
}
