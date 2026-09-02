import { NextResponse } from 'next/server'
import { criarAnaliseExternaSchema, estagioInicial, documentosFaltantes } from '@jobsiteos/core'
import { montarPayloadCredito } from '@jobsiteos/core/server/credito-api'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispararDominioEmpresa } from '@/lib/mercado/worker'
import {
  autenticar,
  erroApi,
  guardarIdempotencia,
  lerConfigApi,
  registrarRequisicao,
  respostaIdempotente,
} from '../../_lib/api-key'

/**
 * `POST /api/v1/credito/analises` — a plataforma de produção cria a análise.
 *
 * ── O PAYLOAD É INSUMO, NUNCA DECISÃO (§1) ─────────────────────────────────
 * Nada do que chega aqui define estágio, limite ou aprovação. O que a produção
 * manda é o pedido; quem governa a esteira é o Crédito. A única coisa que o
 * corpo decide é se a análise nasce em `solicitada` ou `docs_pendentes`, e mesmo
 * isso sai do checklist que o Crédito configurou — não de um campo do JSON.
 *
 * ── DUAS PORTAS DE IDEMPOTÊNCIA ────────────────────────────────────────────
 * A `Idempotency-Key` cobre o reenvio cego (timeout, retry de fila): devolve a
 * MESMA resposta guardada, não um 409 que o cliente não sabe interpretar. O
 * `external_id` cobre o reenvio consciente do mesmo pedido com outra chave —
 * devolve 200 com o recurso que já existe. As duas juntas fecham o caso em que
 * ninguém sabe se a primeira chamada chegou.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROTA = 'POST /api/v1/credito/analises'

export async function POST(request: Request): Promise<NextResponse> {
  const inicio = Date.now()
  const idem = request.headers.get('idempotency-key')?.trim() || null

  const auth = await autenticar(request, 'credito:write')
  if (!auth.ok) {
    await registrarRequisicao({
      keyId: null, rota: ROTA, metodo: 'POST', status: auth.falha.status,
      duracaoMs: Date.now() - inicio, idempotencyKey: idem, erro: auth.falha.codigo,
    })
    return erroApi(auth.falha)
  }
  const { ctx } = auth

  const fim = async (status: number, corpo: unknown, erro?: string): Promise<NextResponse> => {
    await registrarRequisicao({
      keyId: ctx.keyId, rota: ROTA, metodo: 'POST', status,
      duracaoMs: Date.now() - inicio, idempotencyKey: idem, erro: erro ?? null,
    })
    return NextResponse.json(corpo, { status })
  }

  if (!idem) {
    return fim(400, { erro: { codigo: 'sem_idempotency_key', mensagem: 'O header Idempotency-Key é obrigatório nesta rota.', detalhes: null } }, 'sem_idempotency_key')
  }

  // Reenvio cego: a resposta guardada volta igual, com 200.
  const guardada = await respostaIdempotente(ctx.keyId, idem)
  if (guardada) return fim(200, guardada.corpo)

  const cfg = await lerConfigApi()
  const bruto = await request.text()
  if (Buffer.byteLength(bruto, 'utf8') > cfg.payload_max_kb * 1024) {
    return fim(413, { erro: { codigo: 'payload_grande', mensagem: `Corpo acima de ${cfg.payload_max_kb} KB.`, detalhes: null } }, 'payload_grande')
  }

  let json: unknown
  try {
    json = JSON.parse(bruto)
  } catch {
    return fim(400, { erro: { codigo: 'json_invalido', mensagem: 'Corpo não é JSON válido.', detalhes: null } }, 'json_invalido')
  }

  const parsed = criarAnaliseExternaSchema.safeParse(json)
  if (!parsed.success) {
    return fim(422, {
      erro: {
        codigo: 'payload_invalido',
        mensagem: 'O corpo não passou na validação.',
        detalhes: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      },
    }, 'payload_invalido')
  }
  const dados = parsed.data
  const admin = createAdminClient()

  // Reenvio consciente: mesmo pedido, outra chave de idempotência.
  const { data: existente } = await admin
    .from('analises_credito')
    .select('id')
    .eq('external_id', dados.external_id)
    .maybeSingle()
  if (existente) {
    const payload = await montarPayloadCredito(admin, existente.id, {
      evento: 'credito.analise_criada',
      eventoId: crypto.randomUUID(),
    })
    const corpo = resumo(payload)
    await guardarIdempotencia(ctx.keyId, idem, ROTA, 200, corpo)
    return fim(200, corpo)
  }

  /*
   * A empresa é resolvida por CNPJ. Não existindo, nasce aqui — com `tipo`
   * 'construtora' e `origem` 'api_producao', e vai para a fila de lookup, que é o
   * enriquecimento cadastral gratuito. Recusar a análise por falta de ficha faria
   * a produção ter de cadastrar a empresa antes, o que é o nosso trabalho.
   */
  const { data: empresaExistente } = await admin
    .from('empresas')
    .select('id')
    .eq('cnpj', dados.cnpj)
    .maybeSingle()

  let empresaId = empresaExistente?.id ?? null
  if (!empresaId) {
    const { data: nova, error } = await admin
      .from('empresas')
      .insert({
        cnpj: dados.cnpj,
        razao_social: dados.razao_social ?? null,
        tipo: 'construtora',
        estagio: 'mercado',
        origem: 'api_producao',
      })
      .select('id')
      .single()
    if (error || !nova) {
      return fim(500, { erro: { codigo: 'falha_empresa', mensagem: 'Não foi possível criar a ficha da empresa.', detalhes: null } }, error?.message)
    }
    empresaId = nova.id
    await admin.from('cnpj_lookup_fila').upsert(
      { cnpj: dados.cnpj, motivo: 'api_credito' },
      { onConflict: 'cnpj', ignoreDuplicates: true },
    )
  }

  const essenciais = await essenciaisDoChecklist(admin)
  const tiposEnviados = dados.documentos.map((d) => d.tipo)
  const faltantes = documentosFaltantes(tiposEnviados, essenciais)

  const { data: analise, error: erroAnalise } = await admin
    .from('analises_credito')
    .insert({
      empresa_id: empresaId,
      cnpj: dados.cnpj,
      estagio: estagioInicial(faltantes),
      limite_solicitado: dados.limite_solicitado ?? null,
      observacoes: dados.observacoes ?? null,
      // `origem` é QUAL SISTEMA criou (o CHECK só conhece três valores); o
      // `origem` do payload é o MOTIVO do pedido, e vai para a coluna própria.
      origem: 'api_producao',
      origem_motivo: dados.origem,
      origem_externa: 'plataforma_producao',
      external_id: dados.external_id,
      contato_externo: (dados.contato ?? null) as never,
    })
    .select('id, estagio, criada_em')
    .single()

  if (erroAnalise || !analise) {
    return fim(500, { erro: { codigo: 'falha_analise', mensagem: 'Não foi possível criar a análise.', detalhes: null } }, erroAnalise?.message)
  }

  /*
   * Os documentos declarados na criação viram linhas com a URL de origem. Quem
   * BAIXA é o worker (§2.2): o arquivo tem de viver conosco, e fazer o download
   * dentro desta requisição a deixaria refém do servidor do outro lado.
   */
  if (dados.documentos.length > 0) {
    await admin.from('analise_docs').insert(
      dados.documentos.map((d) => ({
        analise_id: analise.id,
        tipo: d.tipo,
        nome_arquivo: d.nome_arquivo,
        arquivo_url: d.url ?? '',
        exercicio: d.exercicio ?? null,
        external_id: d.external_id ?? null,
        origem: 'plataforma_producao',
      })),
    )
  }

  // Enriquecimento gratuito (§2.4): o domínio destrava o resto da cascata. É
  // best-effort — a análise já existe e não pode falhar por causa disto.
  void dispararDominioEmpresa(empresaId).catch(() => undefined)

  const corpo = {
    analise_id: analise.id,
    external_id: dados.external_id,
    cnpj: dados.cnpj,
    estagio: analise.estagio,
    documentos_faltantes: faltantes,
    criada_em: analise.criada_em,
  }
  await guardarIdempotencia(ctx.keyId, idem, ROTA, 201, corpo)
  return fim(201, corpo)
}

/**
 * `GET /api/v1/credito/analises?external_id=` — reconciliação e polling de
 * emergência. Devolve o MESMO payload do webhook (§2.3).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const inicio = Date.now()
  const auth = await autenticar(request, 'credito:read')
  if (!auth.ok) {
    await registrarRequisicao({ keyId: null, rota: 'GET /api/v1/credito/analises', metodo: 'GET', status: auth.falha.status, duracaoMs: Date.now() - inicio })
    return erroApi(auth.falha)
  }

  const externalId = new URL(request.url).searchParams.get('external_id')?.trim()
  if (!externalId) {
    await registrarRequisicao({ keyId: auth.ctx.keyId, rota: 'GET /api/v1/credito/analises', metodo: 'GET', status: 400, duracaoMs: Date.now() - inicio })
    return erroApi({ status: 400, codigo: 'sem_external_id', mensagem: 'Informe ?external_id=' })
  }

  const admin = createAdminClient()
  const { data } = await admin
    .from('analises_credito')
    .select('id')
    .eq('external_id', externalId)
    .maybeSingle()

  const status = data ? 200 : 404
  await registrarRequisicao({ keyId: auth.ctx.keyId, rota: 'GET /api/v1/credito/analises', metodo: 'GET', status, duracaoMs: Date.now() - inicio })
  if (!data) return erroApi({ status: 404, codigo: 'nao_encontrada', mensagem: 'Nenhuma análise com este external_id.' })

  const payload = await montarPayloadCredito(admin, data.id, {
    evento: 'credito.estagio_alterado',
    eventoId: crypto.randomUUID(),
  })
  return NextResponse.json(payload)
}

async function essenciaisDoChecklist(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin.from('credito_config').select('valor').eq('chave', 'docs').maybeSingle()
  const tipos = ((data?.valor as { tipos?: { id: string; essencial?: boolean }[] } | null)?.tipos ?? [])
  return tipos.filter((t) => t.essencial).map((t) => t.id)
}

function resumo(p: Awaited<ReturnType<typeof montarPayloadCredito>>): unknown {
  if (!p) return null
  return {
    analise_id: p.analise.analise_id,
    external_id: p.analise.external_id,
    cnpj: p.empresa.cnpj,
    estagio: p.analise.estagio_atual,
    documentos_faltantes: p.documentos.faltantes,
    criada_em: p.analise.atualizada_em,
  }
}
