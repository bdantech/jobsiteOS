import {
  STATUS_IMPORTACAO,
  STATUS_LINHA,
  type StatusImportacao,
  type StatusLinha,
  type Tables,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'
import type { Candidato } from './similaridade'

/**
 * Leituras do Importador.
 *
 * Rodam no NAVEGADOR, com a anon key + a sessão do usuário: o RLS
 * (`app_tem_modulo('mercado')`, migração 0012) decide as linhas, exatamente como
 * decidiria em qualquer outra tela. Quem não tem o módulo lê zero linhas.
 *
 * Toda escrita — upload, mapeamento, resolução, aplicação — é server action
 * (src/actions/mercado-importacao.ts). Nada aqui grava.
 */

export type Importacao = Tables<'importacoes_listas'>
export type LinhaImportacao = Tables<'importacoes_linhas'>

export const LIMITE_IMPORTACOES = 50

/** Quantas linhas da fila de resolução por vez. Ninguém revisa 500 de uma sentada. */
export const LIMITE_FILA = 50

export const importadorKeys = {
  all: ['mercado', 'importacoes'] as const,
  lista: () => ['mercado', 'importacoes', 'lista'] as const,
  detalhe: (id: string) => ['mercado', 'importacoes', 'detalhe', id] as const,
  contadores: (id: string) => ['mercado', 'importacoes', 'contadores', id] as const,
  fila: (id: string) => ['mercado', 'importacoes', 'fila', id] as const,
}

export function isStatusImportacao(valor: string): valor is StatusImportacao {
  return (STATUS_IMPORTACAO as readonly string[]).includes(valor)
}

export function isStatusLinha(valor: string): valor is StatusLinha {
  return (STATUS_LINHA as readonly string[]).includes(valor)
}

export interface ImportacaoComAutor extends Importacao {
  criado_por_nome: string | null
}

/**
 * `usuarios` é legível por si mesmo e pelos admins (migração 0002) — o mesmo
 * caminho que as notas de empresa usam para mostrar o autor. Quando o RLS não
 * devolve o nome, a tela mostra "—" em vez de mentir.
 */
async function nomesDeUsuarios(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id): id is string => id !== null))]
  if (unicos.length === 0) return new Map()

  const supabase = createClient()
  const { data, error } = await supabase.from('usuarios').select('id, nome').in('id', unicos)
  if (error) throw new Error(error.message)

  return new Map((data ?? []).map((u) => [u.id, u.nome]))
}

export async function buscarImportacoes(): Promise<ImportacaoComAutor[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('importacoes_listas')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(LIMITE_IMPORTACOES)

  if (error) throw new Error(error.message)

  const importacoes = data ?? []
  const nomes = await nomesDeUsuarios(importacoes.map((i) => i.criado_por))

  return importacoes.map((importacao) => ({
    ...importacao,
    criado_por_nome: importacao.criado_por ? (nomes.get(importacao.criado_por) ?? null) : null,
  }))
}

export interface Contadores {
  total: number
  resolvidas: number
  aRevisar: number
  ignoradas: number
}

/**
 * Contagens por status, com `head: true`: o Postgres conta pelo índice
 * (`importacoes_linhas_importacao_idx`, migração 0011) e nenhuma linha atravessa a
 * rede. Trazer as linhas para contar no cliente seria trazer a planilha inteira
 * de volta a cada render da lista.
 */
export async function buscarContadores(importacaoId: string): Promise<Contadores> {
  const supabase = createClient()

  const contar = async (status?: StatusLinha[]): Promise<number> => {
    let query = supabase
      .from('importacoes_linhas')
      .select('id', { count: 'exact', head: true })
      .eq('importacao_id', importacaoId)

    if (status) query = query.in('status', status)

    const { count, error } = await query
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  const [total, resolvidas, aRevisar, ignoradas] = await Promise.all([
    contar(),
    contar(['resolvida']),
    // 'pendente' é a linha que não tem nem razão social para buscar: ela também
    // espera um humano, e some da tela se ficar fora desta conta.
    contar(['ambigua', 'pendente']),
    contar(['ignorada']),
  ])

  return { total, resolvidas, aRevisar, ignoradas }
}

export interface LinhaDaFila {
  id: string
  dados: Record<string, string>
  candidatos: Candidato[]
  status: StatusLinha
}

function lerCandidatos(bruto: unknown): Candidato[] {
  if (!Array.isArray(bruto)) return []

  return bruto.flatMap((item): Candidato[] => {
    if (item === null || typeof item !== 'object') return []
    const c = item as Record<string, unknown>
    if (typeof c.cnpj !== 'string') return []

    return [
      {
        cnpj: c.cnpj,
        razao_social: typeof c.razao_social === 'string' ? c.razao_social : null,
        uf: typeof c.uf === 'string' ? c.uf : null,
        municipio: typeof c.municipio === 'string' ? c.municipio : null,
        situacao_cadastral:
          typeof c.situacao_cadastral === 'string' ? c.situacao_cadastral : null,
        score: typeof c.score === 'number' ? c.score : 0,
      },
    ]
  })
}

function lerDados(bruto: unknown): Record<string, string> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return {}

  const saida: Record<string, string> = {}
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    saida[chave] = typeof valor === 'string' ? valor : String(valor ?? '')
  }
  return saida
}

/** A fila: só o que espera um humano. */
export async function buscarFila(importacaoId: string): Promise<LinhaDaFila[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('importacoes_linhas')
    .select('id, dados, candidatos, status')
    .eq('importacao_id', importacaoId)
    .in('status', ['ambigua', 'pendente'])
    .order('id', { ascending: true })
    .limit(LIMITE_FILA)

  if (error) throw new Error(error.message)

  return (data ?? []).map((linha) => ({
    id: linha.id,
    dados: lerDados(linha.dados),
    candidatos: lerCandidatos(linha.candidatos),
    status: isStatusLinha(linha.status) ? linha.status : 'pendente',
  }))
}

export async function buscarImportacao(id: string): Promise<Importacao | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('importacoes_listas')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}
