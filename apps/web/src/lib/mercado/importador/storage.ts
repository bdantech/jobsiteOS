import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * O arquivo da importação no Supabase Storage.
 *
 * ⚠️ SERVICE ROLE, DE PROPÓSITO E SÓ AQUI.
 *
 * Não existe migração de policies de Storage neste repositório: `storage.objects`
 * tem RLS ligado por padrão e ZERO policies, então o client do usuário não
 * consegue nem gravar nem ler nada — e este agente não pode escrever migrações.
 * Todo o acesso ao bucket, portanto, passa pelo client de serviço, dentro de uma
 * server action que JÁ verificou sessão + módulo `mercado` antes de chamar
 * qualquer função deste módulo. O `server-only` acima garante que nada disto
 * atravessa para o bundle do cliente.
 *
 * O bucket é PRIVADO (`public: false`) e não é negociável: uma lista de
 * prospecção é o ativo comercial, não um asset estático. O download só existe
 * como URL ASSINADA de vida curta, gerada sob demanda.
 */

export const BUCKET_IMPORTACOES = 'importacoes'

/** Uma lista pré-qualificada não tem 20MB. Acima disso é um dump da Receita. */
export const MAX_ARQUIVO_BYTES = 15 * 1024 * 1024

export const EXTENSOES_ACEITAS = ['xlsx', 'csv', 'txt'] as const

/** Vida da URL assinada: tempo de clicar em "Baixar", e não mais que isso. */
const VALIDADE_URL_SEGUNDOS = 120

export class ErroStorage extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroStorage'
  }
}

type Admin = ReturnType<typeof createAdminClient>

export function extensaoDe(nomeArquivo: string): string {
  return nomeArquivo.toLowerCase().split('.').pop() ?? ''
}

export function extensaoAceita(nomeArquivo: string): boolean {
  return (EXTENSOES_ACEITAS as readonly string[]).includes(extensaoDe(nomeArquivo))
}

/**
 * Cria o bucket na primeira importação da instância.
 *
 * `createBucket` devolve erro quando o bucket já existe, e é exatamente isso que
 * torna a chamada segura de repetir: quem já existe não é recriado (nem tem a
 * visibilidade alterada). Checar antes com `getBucket` evita transformar o caso
 * normal — bucket existente — em um erro que precisa ser interpretado por string.
 */
async function garantirBucket(admin: Admin): Promise<void> {
  const { data, error } = await admin.storage.getBucket(BUCKET_IMPORTACOES)
  if (data && !error) return

  const { error: erroCriacao } = await admin.storage.createBucket(BUCKET_IMPORTACOES, {
    public: false,
    fileSizeLimit: MAX_ARQUIVO_BYTES,
  })

  if (erroCriacao) {
    // Corrida entre dois uploads simultâneos: o outro criou o bucket primeiro.
    const { data: existente } = await admin.storage.getBucket(BUCKET_IMPORTACOES)
    if (existente) return

    throw new ErroStorage(`Não foi possível preparar o armazenamento: ${erroCriacao.message}`)
  }
}

/**
 * O caminho é `<uuid>/<nome sanitizado>`: o uuid isola cada arquivo (dois uploads
 * de "clientes.xlsx" não se sobrescrevem) e o nome sobrevive para que quem baixa
 * a lista meses depois receba o arquivo com o nome que enviou.
 */
function caminhoPara(nomeArquivo: string): string {
  const extensao = extensaoDe(nomeArquivo)
  const base = nomeArquivo
    .slice(0, nomeArquivo.length - extensao.length - 1)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  const nome = base.length > 0 ? `${base}.${extensao}` : `lista.${extensao}`
  return `${crypto.randomUUID()}/${nome}`
}

/** Sobe o arquivo e devolve o caminho gravado em `importacoes_listas.arquivo_url`. */
export async function enviarArquivo(arquivo: File): Promise<string> {
  const admin = createAdminClient()
  await garantirBucket(admin)

  const caminho = caminhoPara(arquivo.name)
  const bytes = Buffer.from(await arquivo.arrayBuffer())

  const { error } = await admin.storage.from(BUCKET_IMPORTACOES).upload(caminho, bytes, {
    contentType: arquivo.type || 'application/octet-stream',
    upsert: false,
  })

  if (error) throw new ErroStorage(`Falha ao enviar o arquivo: ${error.message}`)

  return caminho
}

export async function baixarArquivo(caminho: string): Promise<Buffer> {
  const admin = createAdminClient()

  const { data, error } = await admin.storage.from(BUCKET_IMPORTACOES).download(caminho)
  if (error || !data) {
    throw new ErroStorage(
      `Não foi possível ler o arquivo da importação: ${error?.message ?? 'arquivo não encontrado'}`,
    )
  }

  return Buffer.from(await data.arrayBuffer())
}

export async function urlAssinada(caminho: string): Promise<string> {
  const admin = createAdminClient()

  const { data, error } = await admin.storage
    .from(BUCKET_IMPORTACOES)
    .createSignedUrl(caminho, VALIDADE_URL_SEGUNDOS)

  if (error || !data) {
    throw new ErroStorage(`Não foi possível gerar o link do arquivo: ${error?.message ?? 'erro'}`)
  }

  return data.signedUrl
}

/** Limpeza de arquivo órfão quando a criação da importação falha depois do upload. */
export async function removerArquivo(caminho: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(BUCKET_IMPORTACOES).remove([caminho])
  if (error) console.error('[importador] falha ao remover arquivo órfão', error.message)
}
