import 'server-only'

import type { Json } from '@jobsiteos/core'
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
    nome_fantasia: string | null
    uf: string | null
    municipio: string | null
    situacao_cadastral: string | null
  }[],
): Candidato[] {
  const municipioBuscado = chave.municipio ? normalizarNome(chave.municipio) : null

  return linhas
    .map((linha) => {
      // O melhor dos dois nomes: a lista pode trazer a razão social de uma e a
      // marca de outra, e perder o match por ter comparado com o campo errado
      // seria perder a linha por detalhe de cadastro.
      const base = Math.max(
        similaridade(chave.razao_social, linha.razao_social ?? ''),
        similaridade(chave.razao_social, linha.nome_fantasia ?? ''),
      )
      const mesmoMunicipio =
        municipioBuscado !== null &&
        linha.municipio !== null &&
        normalizarNome(linha.municipio) === municipioBuscado

      return {
        cnpj: linha.cnpj,
        razao_social: linha.razao_social,
        nome_fantasia: linha.nome_fantasia,
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
 * Cache por nome+UF dentro de uma mesma importação: listas de ERP repetem a
 * mesma razão social em várias linhas (uma por contrato, uma por módulo), e o
 * mesmo nome não precisa de duas idas ao banco.
 *
 * O client é o do USUÁRIO. A busca em si é uma RPC SECURITY DEFINER (0082), que
 * refaz o mesmo gate de módulo da policy — não há caminho aqui que leia o universo
 * sem ter `mercado`.
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

    // A chave inclui o NOME, não só o token: a RPC ordena por similaridade com o
    // nome, então reaproveitar o resultado de outro nome devolveria os 60 melhores
    // para a empresa errada. Listas de ERP repetem a MESMA razão social em várias
    // linhas — que é o caso que o cache existe para servir, e ele continua servindo.
    const chaveCache = `${normalizarNome(chave.razao_social)}|${chave.uf ?? ''}`
    const emCache = cache.get(chaveCache)

    let linhas = emCache

    if (linhas === undefined) {
      if (consultas >= MAX_CONSULTAS_UNIVERSO) return []
      consultas++

      // RPC, e não PostgREST, por uma razão medida: sob RLS o `ilike` não alcança os
      // índices GIN de trigrama (a policy de `mercado_universo` é barreira de
      // segurança e `ILIKE` não é LEAKPROOF), e a mesma busca que leva 60 ms passava
      // de 8 s — o statement_timeout do papel `authenticated`. Detalhes e números no
      // cabeçalho da migração 0082. A autorização não se perde: a função checa
      // `app_tem_modulo('mercado')` no topo.
      const { data, error } = await supabase.rpc('app_buscar_candidatos_universo', {
        p: {
          token,
          nome: chave.razao_social,
          uf: chave.uf,
          limite: LIMITE_BUSCA,
        } as unknown as Json,
      })
      if (error) throw new Error(`Falha ao buscar candidatos no universo: ${error.message}`)

      // O cache guarda as linhas CRUAS; o score depende também do município, que
      // varia entre linhas que compartilham o mesmo nome.
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
