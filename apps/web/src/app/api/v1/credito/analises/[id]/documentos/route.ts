import { NextResponse } from 'next/server'
import { z } from 'zod'
import { documentoExternoSchema, documentosFaltantes } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispararBaixarDocumentoExterno } from '@/lib/mercado/worker'
import { autenticar, erroApi, lerConfigApi, registrarRequisicao } from '../../../../_lib/api-key'

/**
 * `POST /api/v1/credito/analises/{id}/documentos` — os dois caminhos do §2.2.
 *
 *   multipart  → o arquivo vem no corpo e é gravado no bucket privado agora.
 *   JSON + url → a linha é criada com a URL de origem e o WORKER baixa depois.
 *
 * ── POR QUE O DOWNLOAD NÃO ACONTECE AQUI ───────────────────────────────────
 * Baixar dentro da requisição a deixaria refém do servidor do outro lado: um
 * arquivo de 20 MB numa conexão ruim estoura o tempo da função e o integrador
 * recebe 504 por um documento que talvez já esteja no nosso bucket. O worker tem
 * timeout, retry e um lugar para registrar a falha.
 *
 * ── E POR QUE BAIXAMOS, EM VEZ DE GUARDAR O LINK ───────────────────────────
 * O documento é prova de decisão de crédito. Uma URL externa vira 404 no dia em
 * que o outro lado faz uma limpeza — e aí a análise perde a base dela. O §2.2 é
 * explícito: o documento tem que viver conosco.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ROTA = 'POST /api/v1/credito/analises/{id}/documentos'
const uuid = z.string().uuid()

const MIME_ACEITOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const inicio = Date.now()
  const auth = await autenticar(request, 'credito:write')
  if (!auth.ok) {
    await registrarRequisicao({ keyId: null, rota: ROTA, metodo: 'POST', status: auth.falha.status, duracaoMs: Date.now() - inicio })
    return erroApi(auth.falha)
  }
  const { ctx } = auth
  const { id } = await params

  const fim = async (status: number, corpo: unknown, erro?: string): Promise<NextResponse> => {
    await registrarRequisicao({ keyId: ctx.keyId, rota: ROTA, metodo: 'POST', status, duracaoMs: Date.now() - inicio, erro: erro ?? null })
    return NextResponse.json(corpo, { status })
  }

  if (!uuid.safeParse(id).success) {
    return fim(400, { erro: { codigo: 'id_invalido', mensagem: 'O id da análise precisa ser um UUID.', detalhes: null } }, 'id_invalido')
  }

  const admin = createAdminClient()
  const { data: analise } = await admin.from('analises_credito').select('id').eq('id', id).maybeSingle()
  if (!analise) {
    return fim(404, { erro: { codigo: 'nao_encontrada', mensagem: 'Análise não encontrada.', detalhes: null } }, 'nao_encontrada')
  }

  const cfg = await lerConfigApi()
  const tipoConteudo = request.headers.get('content-type') ?? ''

  // ── Caminho 1: multipart, o arquivo vem agora ────────────────────────────
  if (tipoConteudo.includes('multipart/form-data')) {
    const form = await request.formData()
    const arquivo = form.get('arquivo')
    const tipo = String(form.get('tipo') ?? '')
    const exercicio = form.get('exercicio') ? Number(form.get('exercicio')) : null

    if (!(arquivo instanceof File)) {
      return fim(422, { erro: { codigo: 'sem_arquivo', mensagem: 'Envie o arquivo no campo "arquivo".', detalhes: null } }, 'sem_arquivo')
    }
    const ext = MIME_ACEITOS[arquivo.type]
    if (!ext) {
      return fim(422, {
        erro: { codigo: 'tipo_nao_aceito', mensagem: 'Tipos aceitos: pdf, jpg, png, xlsx.', detalhes: { recebido: arquivo.type } },
      }, 'tipo_nao_aceito')
    }
    if (arquivo.size > cfg.documento_max_mb * 1024 * 1024) {
      return fim(413, {
        erro: { codigo: 'arquivo_grande', mensagem: `O arquivo passa de ${cfg.documento_max_mb} MB.`, detalhes: null },
      }, 'arquivo_grande')
    }

    // O caminho começa pelo id da análise: é a âncora das policies do bucket.
    const caminho = `${id}/${tipo || 'outros'}-${Date.now()}-${arquivo.name.replace(/[^\w.\-]/g, '_')}`
    const up = await admin.storage.from('analise-docs').upload(caminho, arquivo, { contentType: arquivo.type })
    if (up.error) {
      return fim(500, { erro: { codigo: 'falha_upload', mensagem: 'Não foi possível guardar o arquivo.', detalhes: null } }, up.error.message)
    }

    const { data: doc, error } = await admin
      .from('analise_docs')
      .insert({
        analise_id: id,
        tipo: tipo || 'outros',
        nome_arquivo: arquivo.name,
        arquivo_url: caminho,
        exercicio,
        origem: 'plataforma_producao',
      })
      .select('id')
      .single()
    if (error || !doc) {
      return fim(500, { erro: { codigo: 'falha_registro', mensagem: 'Arquivo guardado, mas não registrado.', detalhes: null } }, error?.message)
    }

    return fim(201, { documento_id: doc.id, analise_id: id, ...(await checklist(admin, id)) })
  }

  // ── Caminho 2: JSON com url, o worker baixa ──────────────────────────────
  const parsed = documentoExternoSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return fim(422, {
      erro: {
        codigo: 'payload_invalido',
        mensagem: 'Envie multipart com o arquivo, ou JSON com { tipo, nome_arquivo, url }.',
        detalhes: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      },
    }, 'payload_invalido')
  }
  if (!parsed.data.url) {
    return fim(422, { erro: { codigo: 'sem_url', mensagem: 'No caminho JSON, "url" é obrigatória.', detalhes: null } }, 'sem_url')
  }

  const { data: doc, error } = await admin
    .from('analise_docs')
    .insert({
      analise_id: id,
      tipo: parsed.data.tipo,
      nome_arquivo: parsed.data.nome_arquivo,
      // A URL de origem fica aqui até o worker trocá-la pelo caminho no bucket.
      arquivo_url: parsed.data.url,
      exercicio: parsed.data.exercicio ?? null,
      external_id: parsed.data.external_id ?? null,
      origem: 'plataforma_producao',
    })
    .select('id')
    .single()
  if (error || !doc) {
    return fim(500, { erro: { codigo: 'falha_registro', mensagem: 'Não foi possível registrar o documento.', detalhes: null } }, error?.message)
  }

  void dispararBaixarDocumentoExterno(doc.id).catch(() => undefined)

  return fim(202, {
    documento_id: doc.id,
    analise_id: id,
    status: 'baixando',
    ...(await checklist(admin, id)),
  })
}

/** O que ainda falta, para a produção saber se o cadastro fechou. */
async function checklist(
  admin: ReturnType<typeof createAdminClient>,
  analiseId: string,
): Promise<{ documentos_faltantes: string[] }> {
  const [docs, cfg] = await Promise.all([
    admin.from('analise_docs').select('tipo').eq('analise_id', analiseId),
    admin.from('credito_config').select('valor').eq('chave', 'docs').maybeSingle(),
  ])
  const tipos = ((cfg.data?.valor as { tipos?: { id: string; essencial?: boolean }[] } | null)?.tipos ?? [])
  const essenciais = tipos.filter((t) => t.essencial).map((t) => t.id)
  const recebidos = (docs.data ?? []).map((d) => d.tipo as string)
  return { documentos_faltantes: documentosFaltantes(recebidos, essenciais) }
}
