'use client'

import * as React from 'react'
import type { SacadoProspectar } from './queries'
import { proximaOrdenacao, usePreferenciasTabela, type Direcao } from './tabela-ordenavel'

/**
 * Ordenação da lista "sacados a prospectar" — a parte sem JSX.
 *
 * Mesma decisão da tabela por sacado: ordena no cliente sobre o que a leitura já
 * trouxe (279 construtoras hoje, teto de `LIMITE_PROSPECTAR`). O padrão continua
 * sendo valor recebido, que é o que paga a abordagem.
 */

export type ColunaProspectar =
  | 'nome'
  | 'cnae'
  | 'local'
  | 'camada'
  | 'notas'
  | 'fornecedores'
  | 'jaAntecipa'
  | 'valor'
  | 'ultimaNota'

const PRIMEIRA_DIRECAO: Record<ColunaProspectar, Direcao> = {
  nome: 'asc',
  cnae: 'asc',
  local: 'asc',
  // Camada e data começam pelo topo útil: SOM primeiro, nota mais recente primeiro.
  camada: 'asc',
  notas: 'desc',
  fornecedores: 'desc',
  jaAntecipa: 'desc',
  valor: 'desc',
  ultimaNota: 'desc',
}

const COLUNAS_VALIDAS = new Set<string>(Object.keys(PRIMEIRA_DIRECAO))

/**
 * Camada ordena por PROXIMIDADE DE VIRAR CLIENTE, não por alfabeto: SOM tem sinal de
 * compra hoje, `universo` recebe nota e não passou em nenhuma regra de Mercado.
 * Alfabético devolveria "sam, som, tam, universo", que não quer dizer nada.
 */
const RANK_CAMADA: Record<string, number> = { som: 0, sam: 1, tam: 2, universo: 3 }

function rankCamada(camada: string | null | undefined): number {
  if (!camada) return 9
  return RANK_CAMADA[camada.toLowerCase()] ?? 8
}

export function localDe(s: SacadoProspectar): string {
  return [s.sacado_municipio, s.sacado_uf].filter(Boolean).join(' / ')
}

function numeroDe(s: SacadoProspectar, coluna: ColunaProspectar): number {
  switch (coluna) {
    case 'camada':
      return rankCamada(s.sacado_camada)
    case 'notas':
      return Number(s.notas ?? 0)
    case 'fornecedores':
      return Number(s.fornecedores ?? 0)
    case 'jaAntecipa':
      return Number(s.notas_de_quem_ja_antecipou ?? 0)
    case 'valor':
      return Number(s.valor_agregado ?? 0)
    case 'ultimaNota':
      // Sem data vai para o fim em ordem decrescente (o padrão da coluna), que é
      // onde "nunca emitiu" pertence.
      return s.ultima_nota_em ? Date.parse(s.ultima_nota_em) : Number.NEGATIVE_INFINITY
    default:
      return 0
  }
}

const COLUNAS_TEXTO = new Set<ColunaProspectar>(['nome', 'cnae', 'local'])

function textoDe(s: SacadoProspectar, coluna: ColunaProspectar): string {
  if (coluna === 'nome') return s.sacado_nome ?? ''
  if (coluna === 'cnae') return s.sacado_cnae_principal ?? ''
  return localDe(s)
}

/**
 * O desempate é sempre por nome, ascendente, mesmo com a coluna em `desc`. Sem ele,
 * as 149 construtoras em `universo` trocariam de lugar entre dois carregamentos.
 */
export function ordenarProspectar(
  linhas: readonly SacadoProspectar[],
  coluna: ColunaProspectar,
  dir: Direcao,
): SacadoProspectar[] {
  const sinal = dir === 'asc' ? 1 : -1
  return [...linhas].sort((a, b) => {
    let r: number

    if (COLUNAS_TEXTO.has(coluna)) {
      const ta = textoDe(a, coluna)
      const tb = textoDe(b, coluna)
      if (ta === '' || tb === '') {
        // Vazio SEMPRE por último, nas duas direções: uma coluna que abre com
        // travessões esconde justamente o que se procura. Multiplicar por `sinal`
        // aqui é o que neutraliza o `* sinal` de baixo (sinal² = 1).
        r = ta === tb ? 0 : ta === '' ? sinal : -sinal
      } else {
        r = ta.localeCompare(tb, 'pt-BR')
      }
    } else {
      r = numeroDe(a, coluna) - numeroDe(b, coluna)
    }

    if (r !== 0) return r * sinal
    return (a.sacado_nome ?? '').localeCompare(b.sacado_nome ?? '', 'pt-BR')
  })
}

export interface PreferenciasProspectar {
  coluna: ColunaProspectar
  dir: Direcao
}

const PADRAO: PreferenciasProspectar = { coluna: 'valor', dir: 'desc' }

const CHAVE_STORAGE = 'jobsiteos.antecipacao.prospectar.v1'

function sanear(o: Record<string, unknown>): PreferenciasProspectar {
  return {
    coluna:
      typeof o.coluna === 'string' && COLUNAS_VALIDAS.has(o.coluna)
        ? (o.coluna as ColunaProspectar)
        : PADRAO.coluna,
    dir: o.dir === 'asc' || o.dir === 'desc' ? o.dir : PADRAO.dir,
  }
}

export function usePreferenciasProspectar() {
  const { prefs, atualizar } = usePreferenciasTabela(CHAVE_STORAGE, PADRAO, sanear)

  const ordenarPor = React.useCallback(
    (coluna: ColunaProspectar) => atualizar(proximaOrdenacao(prefs, coluna, PRIMEIRA_DIRECAO)),
    [prefs, atualizar],
  )

  return { prefs, ordenarPor }
}
