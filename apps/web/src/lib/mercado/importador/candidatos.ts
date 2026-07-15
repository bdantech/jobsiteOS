import 'server-only'

import {
  LIMITE_SIMILARIDADE,
  MAX_CANDIDATOS,
  normalizarNome,
  similaridade,
  tokenDeBusca,
  type Candidato,
} from '@/components/mercado/importador/similaridade'
import type { createClient } from '@/lib/supabase/server'

/**
 * A fila de resolução: quem é a empresa desta linha, quando a planilha não trouxe
 * um CNPJ utilizável.
 *
 * Postgres FILTRA, Node ORDENA (ver o comentário longo em
 * components/mercado/importador/similaridade.ts): o `ilike '%TOKEN%'` usa o índice
 * GIN de trigramas da migração 0011, e o ranqueamento por `similarity()` acontece
 * aqui sobre as poucas linhas devolvidas, porque o PostgREST não expõe a função.
 *
 * Nada aqui RESOLVE nada. O que sai é uma lista de candidatos com score, gravada
 * em `importacoes_linhas.candidatos` para um humano decidir.
 */

export type ClienteServidor = Awaited<ReturnType<typeof createClient>>

/** Quantas linhas do universo o Postgres devolve por token, antes do ranqueamento. */
const LIMITE_BUSCA = 60

/**
 * Teto de consultas ao universo por importação. Uma lista de 20 mil linhas sem
 * CNPJ nenhum não pode virar 20 mil queries dentro de uma server action — as
 * linhas além do teto continuam `ambigua`, apenas sem candidatos sugeridos, e o
 * revisor ainda pode informar o CNPJ na mão.
 */
export const MAX_CONSULTAS_UNIVERSO = 400

export interface ChaveBusca {
  razao_social: string
  uf: string | null
  municipio: string | null
}

/**
 * Município não entra no WHERE — a grafia do município na planilha ("S. José dos
 * Campos") raramente bate com a da Receita, e um `eq` transformaria um bom
 * candidato em zero candidatos. Ele entra no SCORE: quando bate, empurra o
 * candidato para cima; quando não bate, não custa nada.
 */
const BONUS_MUNICIPIO = 0.1

function ranquear(
  chave: ChaveBusca,
  linhas: readonly {
    cnpj: string
    razao_social: string | null
    uf: string | null
    municipio: string | null
    situacao_cadastral: string | null
  }[],
): Candidato[] {
  const municipioBuscado = chave.municipio ? normalizarNome(chave.municipio) : null

  return linhas
    .map((linha) => {
      const base = similaridade(chave.razao_social, linha.razao_social ?? '')
      const mesmoMunicipio =
        municipioBuscado !== null &&
        linha.municipio !== null &&
        normalizarNome(linha.municipio) === municipioBuscado

      return {
        cnpj: linha.cnpj,
        razao_social: linha.razao_social,
        uf: linha.uf,
        municipio: linha.municipio,
        situacao_cadastral: linha.situacao_cadastral,
        score: Math.min(1, base + (mesmoMunicipio ? BONUS_MUNICIPIO : 0)),
      }
    })
    .filter((c) => c.score >= LIMITE_SIMILARIDADE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATOS)
}

/**
 * Cache por token+UF dentro de uma mesma importação: listas de ERP repetem a
 * mesma razão social em várias linhas (uma por contrato, uma por módulo), e o
 * mesmo token não precisa de duas idas ao banco.
 *
 * O client é o do USUÁRIO — `mercado_universo` é SELECT sob
 * `app_tem_modulo('mercado')` (migração 0012), então o RLS continua decidindo.
 */
export function criarBuscadorDeCandidatos(supabase: ClienteServidor): {
  buscar: (chave: ChaveBusca) => Promise<Candidato[]>
  consultas: () => number
} {
  const cache = new Map<string, Candidato[]>()
  let consultas = 0

  async function buscar(chave: ChaveBusca): Promise<Candidato[]> {
    const token = tokenDeBusca(chave.razao_social)
    if (!token) return []

    const chaveCache = `${token}|${chave.uf ?? ''}`
    const emCache = cache.get(chaveCache)

    let linhas = emCache

    if (linhas === undefined) {
      if (consultas >= MAX_CONSULTAS_UNIVERSO) return []
      consultas++

      let query = supabase
        .from('mercado_universo')
        .select('cnpj, razao_social, uf, municipio, situacao_cadastral')
        // `token` sai de normalizarNome(): só [A-Z0-9], então não há curinga a
        // escapar aqui — nem `%`, nem `_`, nem vírgula (que quebraria o PostgREST).
        .ilike('razao_social', `%${token}%`)
        .limit(LIMITE_BUSCA)

      if (chave.uf) query = query.eq('uf', chave.uf)

      const { data, error } = await query
      if (error) throw new Error(`Falha ao buscar candidatos no universo: ${error.message}`)

      // O cache guarda as linhas CRUAS (por token+UF); o score depende também do
      // município, que varia entre linhas que compartilham o mesmo token.
      const brutas = data ?? []
      cache.set(
        chaveCache,
        brutas.map((linha) => ({ ...linha, score: 0 })),
      )
      linhas = cache.get(chaveCache)!
    }

    return ranquear(chave, linhas)
  }

  return { buscar, consultas: () => consultas }
}
