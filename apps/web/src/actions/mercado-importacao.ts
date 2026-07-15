'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  canAccessRoute,
  mapeamentoImportacaoSchema,
  MutationError,
  resolverLinhaSchema,
  type FieldErrors,
  type Json,
  type MapeamentoImportacao,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { validarMapeamento } from '@/components/mercado/importador/mapeamento'
import { aplicarLote, contarResolvidas, type ResultadoLote } from '@/lib/mercado/importador/aplicar'
import {
  emitirEvento,
  garantirRegraDeConclusao,
  garantirRegraDeRevisao,
} from '@/lib/mercado/importador/eventos'
import { ErroPlanilha, lerPlanilha } from '@/lib/mercado/importador/planilha'
import { processarImportacao } from '@/lib/mercado/importador/processar'
import {
  enviarArquivo,
  ErroStorage,
  extensaoAceita,
  MAX_ARQUIVO_BYTES,
  removerArquivo,
  urlAssinada,
} from '@/lib/mercado/importador/storage'

/**
 * O Importador de listas (§5.5) — todas as mutações.
 *
 * Cada export de um módulo 'use server' é um endpoint RPC público, então TODA
 * função aqui começa pela autorização, sem exceção. A UI que esconde um botão é
 * cortesia; a checagem é esta.
 *
 * DOIS MÓDULOS, NÃO UM. Ver `autorizarEscrita`: o importador lê do Mercado e
 * ESCREVE em `empresas`/`contatos`/`empresa_eventos`, cujas policies (migração
 * 0002) exigem `app_tem_modulo('empresas')`. Quem tem só o Mercado consegue
 * enviar e mapear a lista, mas não aplicá-la — e é melhor dizer isso em português
 * do que deixar o RLS devolver um 42501 no meio do lote.
 *
 * O client de serviço aparece em exatamente três lugares, todos comentados na
 * origem: Storage (não há policies em storage.objects), o INSERT/DELETE em
 * `importacoes_linhas` (a 0012 só criou policies de SELECT e UPDATE) e a regra por
 * usuário em `notificacao_regras` (policy admin-only). Nenhuma linha de `empresas`
 * ou `contatos` é escrita com ele — essas passam pelo client do usuário, sob RLS,
 * pelos write helpers do core.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = {
  ok: false,
  message: 'Sua sessão expirou. Entre novamente para continuar.',
  code: 'forbidden',
}

const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Mercado.',
  code: 'forbidden',
}

const SEM_EMPRESAS: Falha = {
  ok: false,
  message:
    'Importar uma lista cria empresas e contatos, e você não tem acesso ao módulo Empresas. Peça o acesso a um administrador.',
  code: 'forbidden',
}

type Cliente = Awaited<ReturnType<typeof createClient>>
type Autorizacao =
  | { erro: Falha; supabase: null; usuarioId: null }
  | { erro: null; supabase: Cliente; usuarioId: string }

async function autorizar(): Promise<Autorizacao> {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null, usuarioId: null }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return { erro: SEM_MODULO, supabase: null, usuarioId: null }
  }

  return { erro: null, supabase: await createClient(), usuarioId: context.usuario.id }
}

/** Mercado + Empresas: exigido por tudo que grava empresa, contato ou evento. */
async function autorizarEscrita(): Promise<Autorizacao> {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null, usuarioId: null }
  if (!canAccessRoute('/mercado', context.grantedModuleIds)) {
    return { erro: SEM_MODULO, supabase: null, usuarioId: null }
  }
  if (!canAccessRoute('/empresas', context.grantedModuleIds)) {
    return { erro: SEM_EMPRESAS, supabase: null, usuarioId: null }
  }

  return { erro: null, supabase: await createClient(), usuarioId: context.usuario.id }
}

function falha(error: unknown): Falha {
  if (error instanceof MutationError) {
    return { ok: false, message: error.message, code: error.code, fieldErrors: error.fieldErrors }
  }
  if (error instanceof ErroPlanilha || error instanceof ErroStorage) {
    return { ok: false, message: error.message, code: 'validation' }
  }

  console.error('[importador] erro inesperado', error)
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

async function carregarImportacao(
  supabase: Cliente,
  id: string,
): Promise<Tables<'importacoes_listas'> | null> {
  const { data, error } = await supabase
    .from('importacoes_listas')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

function lerMapeamento(importacao: Tables<'importacoes_listas'>): MapeamentoImportacao {
  const parsed = mapeamentoImportacaoSchema.safeParse(importacao.mapeamento)
  if (!parsed.success) {
    throw new MutationError(
      'O mapeamento desta importação está inválido. Refaça o mapeamento das colunas.',
      'validation',
    )
  }
  return parsed.data
}

function urlDaImportacao(id: string): string {
  return `/mercado/importacoes/${id}`
}

// ─── 1. Upload ──────────────────────────────────────────────────────────────

export interface ImportacaoCriada {
  id: string
}

/**
 * Sobe o arquivo e abre a importação em `mapeando`.
 *
 * O arquivo vai para o Storage ANTES da linha do banco de propósito: se o insert
 * falhar, sobra um objeto órfão (que removemos em seguida); na ordem inversa,
 * sobraria uma importação sem arquivo — visível na tela, impossível de continuar,
 * e sem DELETE concedido a `authenticated` para limpar.
 *
 * A planilha é lida aqui, no upload, só para FALHAR CEDO: um .xlsx corrompido
 * vira uma frase agora, e não uma tela de mapeamento quebrada depois.
 */
export async function criarImportacaoAction(
  formData: FormData,
): Promise<ActionResult<ImportacaoCriada>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  const arquivo = formData.get('arquivo')
  const nomeBruto = formData.get('nome')

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, message: 'Selecione um arquivo .xlsx ou .csv.', code: 'validation' }
  }
  if (!extensaoAceita(arquivo.name)) {
    return {
      ok: false,
      message: 'Formato não suportado. Envie um arquivo .xlsx ou .csv.',
      code: 'validation',
    }
  }
  if (arquivo.size > MAX_ARQUIVO_BYTES) {
    return {
      ok: false,
      message: `O arquivo tem mais de ${Math.round(MAX_ARQUIVO_BYTES / 1024 / 1024)} MB. Divida a lista antes de importar.`,
      code: 'validation',
    }
  }

  const nome =
    typeof nomeBruto === 'string' && nomeBruto.trim().length > 0
      ? nomeBruto.trim().slice(0, 120)
      : arquivo.name

  let caminho: string | null = null

  try {
    // Falha cedo: se não dá para ler, não adianta guardar.
    lerPlanilha(Buffer.from(await arquivo.arrayBuffer()), arquivo.name)

    caminho = await enviarArquivo(arquivo)

    const { data, error } = await auth.supabase
      .from('importacoes_listas')
      .insert({
        nome,
        arquivo_url: caminho,
        status: 'mapeando',
        // A policy de insert exige criado_por = auth.uid(): a importação é de
        // quem a criou, e é essa coluna que a regra de notificação vai mirar.
        criado_por: auth.usuarioId,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)

    // A regra do sininho nasce aqui, no upload — é por usuário, então nenhuma
    // migração pode semeá-la (ver o comentário na 0014).
    await garantirRegraDeRevisao(auth.usuarioId)
    await garantirRegraDeConclusao(auth.usuarioId)

    revalidatePath('/mercado/importacoes')
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    if (caminho) await removerArquivo(caminho)
    return falha(error)
  }
}

// ─── 2. Mapeamento + processamento ──────────────────────────────────────────

const salvarMapeamentoSchema = z.object({
  importacao_id: z.string().uuid(),
  mapeamento: mapeamentoImportacaoSchema,
})

export interface ResultadoMapeamento {
  total: number
  resolvidas: number
  ambiguas: number
  ignoradas: number
  /** 'revisao' quando há linhas sem CNPJ; senão a lista já está pronta para aplicar. */
  status: string
  buscaTruncada: boolean
}

/**
 * Grava o mapeamento e processa o arquivo: extrai as linhas, deduplica por CNPJ
 * normalizado e manda o que sobrou sem CNPJ para a fila de resolução.
 *
 * O que NÃO acontece aqui: aplicar. Nenhuma empresa é criada antes de um humano
 * ver os números — quantas linhas, quantas duplicadas, quantas ambíguas. Aplicar
 * é um segundo clique, explícito.
 */
export async function salvarMapeamentoAction(
  input: unknown,
): Promise<ActionResult<ResultadoMapeamento>> {
  const auth = await autorizarEscrita()
  if (auth.erro) return auth.erro

  const parsed = salvarMapeamentoSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Mapeamento inválido.', code: 'validation' }
  }

  const { importacao_id, mapeamento } = parsed.data

  const problema = validarMapeamento(mapeamento)
  if (problema) return { ok: false, message: problema, code: 'validation' }

  try {
    const importacao = await carregarImportacao(auth.supabase, importacao_id)
    if (!importacao) {
      return { ok: false, message: 'Importação não encontrada.', code: 'not_found' }
    }
    if (importacao.status === 'concluida') {
      return {
        ok: false,
        message: 'Esta importação já foi concluída. Crie uma nova para importar de novo.',
        code: 'conflict',
      }
    }

    const { error: erroStatus } = await auth.supabase
      .from('importacoes_listas')
      .update({ mapeamento: mapeamento as unknown as Json, status: 'processando' })
      .eq('id', importacao.id)

    if (erroStatus) throw new Error(erroStatus.message)

    const resultado = await processarImportacao(auth.supabase, importacao, mapeamento)

    // Sempre 'revisao' depois do processamento: mesmo sem nenhuma linha ambígua, é
    // um humano quem manda aplicar. `concluida` só depois que as empresas
    // realmente entraram.
    const { error: erroFinal } = await auth.supabase
      .from('importacoes_listas')
      .update({ status: 'revisao' })
      .eq('id', importacao.id)

    if (erroFinal) throw new Error(erroFinal.message)

    if (resultado.ambiguas > 0) {
      await emitirEvento(auth.supabase, {
        tipo: 'importacao.revisao_pendente',
        titulo: `Importação "${importacao.nome}" precisa de revisão`,
        resumo: `${resultado.ambiguas.toLocaleString('pt-BR')} de ${resultado.total.toLocaleString('pt-BR')} linhas não têm CNPJ e aguardam resolução.`,
        url: urlDaImportacao(importacao.id),
        importacao_id: importacao.id,
      })
    }

    revalidatePath('/mercado/importacoes')
    revalidatePath(urlDaImportacao(importacao.id))

    return { ok: true, data: { ...resultado, status: 'revisao' } }
  } catch (error) {
    // O processamento morreu no meio: a importação volta para 'mapeando', que é o
    // único estado do qual dá para tentar de novo.
    await auth.supabase
      .from('importacoes_listas')
      .update({ status: 'mapeando' })
      .eq('id', importacao_id)

    return falha(error)
  }
}

// ─── 3. Fila de resolução ───────────────────────────────────────────────────

/**
 * O revisor decide: um dos candidatos, um CNPJ digitado à mão, ou ignorar a linha.
 * `resolverLinhaSchema` (core) é o contrato — nada de esquema paralelo aqui.
 *
 * A linha ignorada fica no banco, com status `ignorada` e sem CNPJ: é o que
 * distingue "o revisor descartou" de "duplicada no arquivo" (essa tem
 * cnpj_resolvido preenchido). Rastreabilidade total.
 */
export async function resolverLinhaAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  const parsed = resolverLinhaSchema.safeParse(input)
  if (!parsed.success) {
    const primeiro = parsed.error.errors[0]
    return {
      ok: false,
      message: primeiro?.message ?? 'Dados inválidos.',
      code: 'validation',
    }
  }

  const { linha_id, cnpj, ignorar } = parsed.data

  if (!ignorar && !cnpj) {
    return {
      ok: false,
      message: 'Escolha um candidato, informe um CNPJ ou ignore a linha.',
      code: 'validation',
    }
  }

  try {
    const { data: linha, error: erroLinha } = await auth.supabase
      .from('importacoes_linhas')
      .select('id, importacao_id, status')
      .eq('id', linha_id)
      .maybeSingle()

    if (erroLinha) throw new Error(erroLinha.message)
    if (!linha) return { ok: false, message: 'Linha não encontrada.', code: 'not_found' }

    const importacao = await carregarImportacao(auth.supabase, linha.importacao_id)
    if (importacao?.status === 'concluida') {
      return {
        ok: false,
        message: 'Esta importação já foi concluída e não aceita mais alterações.',
        code: 'conflict',
      }
    }

    const { error } = await auth.supabase
      .from('importacoes_linhas')
      .update(
        ignorar
          ? { status: 'ignorada', cnpj_resolvido: null }
          : { status: 'resolvida', cnpj_resolvido: cnpj! },
      )
      .eq('id', linha.id)

    if (error) throw new Error(error.message)

    revalidatePath(urlDaImportacao(linha.importacao_id))
    return { ok: true, data: { id: linha.id } }
  } catch (error) {
    return falha(error)
  }
}

// ─── 4. Aplicar ─────────────────────────────────────────────────────────────

const aplicarLoteSchema = z.object({
  importacao_id: z.string().uuid(),
  /** Último id aplicado. O cliente devolve o que recebeu, e a aplicação retoma dali. */
  cursor: z.string().uuid().nullable().default(null),
})

export interface ProgressoAplicacao extends ResultadoLote {
  /** Total de linhas resolvidas na importação — o denominador do progresso. */
  totalResolvidas: number
}

/**
 * Aplica UM LOTE e devolve o cursor. O cliente chama em loop até `concluido`.
 *
 * Por que em lotes: uma lista de milhares de linhas não cabe em um único request
 * de server action sem estourar o tempo da função. Em lotes, cada chamada é curta,
 * o progresso é visível, e uma queda no meio não perde o que já entrou — a
 * próxima chamada retoma pelo cursor. A aplicação é idempotente por construção
 * (upsert por CNPJ + dedupe de contato por e-mail/telefone), então repetir um lote
 * não duplica nada.
 */
export async function aplicarLoteAction(input: unknown): Promise<ActionResult<ProgressoAplicacao>> {
  const auth = await autorizarEscrita()
  if (auth.erro) return auth.erro

  const parsed = aplicarLoteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Parâmetros inválidos.', code: 'validation' }
  }

  const { importacao_id, cursor } = parsed.data

  try {
    const importacao = await carregarImportacao(auth.supabase, importacao_id)
    if (!importacao) {
      return { ok: false, message: 'Importação não encontrada.', code: 'not_found' }
    }
    if (importacao.status === 'concluida') {
      return {
        ok: false,
        message: 'Esta importação já foi concluída.',
        code: 'conflict',
      }
    }
    if (importacao.status === 'mapeando') {
      return {
        ok: false,
        message: 'Mapeie as colunas antes de aplicar a importação.',
        code: 'conflict',
      }
    }

    const mapeamento = lerMapeamento(importacao)
    const totalResolvidas = await contarResolvidas(auth.supabase, importacao.id)

    if (totalResolvidas === 0) {
      return {
        ok: false,
        message: 'Nenhuma linha resolvida para aplicar. Resolva a fila antes de importar.',
        code: 'conflict',
      }
    }

    const lote = await aplicarLote(auth.supabase, importacao, mapeamento, cursor)

    if (lote.concluido) {
      const { error } = await auth.supabase
        .from('importacoes_listas')
        .update({ status: 'concluida' })
        .eq('id', importacao.id)

      if (error) throw new Error(error.message)

      await emitirEvento(auth.supabase, {
        tipo: 'importacao.concluida',
        titulo: `Importação "${importacao.nome}" concluída`,
        resumo: `${totalResolvidas.toLocaleString('pt-BR')} empresas processadas a partir da lista.`,
        url: urlDaImportacao(importacao.id),
        importacao_id: importacao.id,
      })

      revalidatePath('/empresas')
      revalidatePath('/mercado/explorador')
    }

    revalidatePath('/mercado/importacoes')
    revalidatePath(urlDaImportacao(importacao.id))

    return { ok: true, data: { ...lote, totalResolvidas } }
  } catch (error) {
    return falha(error)
  }
}

// ─── 5. Arquivo original ────────────────────────────────────────────────────

/**
 * URL assinada de vida curta para o arquivo original — a ponta final da
 * rastreabilidade: da empresa em `empresas` até a planilha que a trouxe.
 * O bucket é privado; nada aqui devolve uma URL pública.
 */
export async function gerarUrlDownloadAction(id: string): Promise<ActionResult<{ url: string }>> {
  const auth = await autorizar()
  if (auth.erro) return auth.erro

  try {
    const importacao = await carregarImportacao(auth.supabase, id)
    if (!importacao?.arquivo_url) {
      return { ok: false, message: 'Arquivo não encontrado.', code: 'not_found' }
    }

    return { ok: true, data: { url: await urlAssinada(importacao.arquivo_url) } }
  } catch (error) {
    return falha(error)
  }
}
