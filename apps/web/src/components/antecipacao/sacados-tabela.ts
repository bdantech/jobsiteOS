'use client'

import * as React from 'react'
import type { SacadoFunil } from './queries'
import { proximaOrdenacao, usePreferenciasTabela, type Direcao } from './tabela-ordenavel'

/**
 * Ordenação e filtro da tabela "por sacado" — a parte sem JSX.
 *
 * Ordena e filtra NO CLIENTE de propósito. A view tem 154 linhas hoje e a leitura
 * já traz até `LIMITE_SACADOS` de uma vez; refazer a consulta a cada clique de
 * cabeçalho trocaria um `sort` instantâneo por um round-trip com skeleton. A troca
 * só deixa de valer se a lista passar do limite — e aí a tela avisa, em vez de
 * ordenar 300 de 400 linhas e parecer certa.
 */

export type ColunaSacado =
  | 'nome'
  | 'credito'
  | 'notas'
  | 'fornecedores'
  | 'demanda'
  | 'excedente'
  | 'receita'

/**
 * A direção do PRIMEIRO clique. Em coluna de número o que se procura é o topo
 * (maior demanda, maior excedente); em nome, o alfabeto. Clicar e ter de clicar de
 * novo para ver o que interessa é atrito puro.
 */
const PRIMEIRA_DIRECAO: Record<ColunaSacado, Direcao> = {
  nome: 'asc',
  credito: 'asc',
  notas: 'desc',
  fornecedores: 'desc',
  demanda: 'desc',
  excedente: 'desc',
  receita: 'desc',
}

const COLUNAS_VALIDAS = new Set<string>(Object.keys(PRIMEIRA_DIRECAO))

/**
 * Ordem de crédito por PROXIMIDADE DE OPERAR, não alfabética: aprovado primeiro,
 * sem análise por último. Ordenar "Aprovado, Bloqueado, Em análise" por texto
 * juntaria quem opera hoje com quem nunca vai operar.
 */
const RANK_CREDITO: Record<string, number> = {
  APPROVED: 0,
  IN_ANALYSIS: 1,
  PENDING: 2,
  EXPIRED: 3,
  DENIED: 4,
  BLOCKED: 5,
}

function rankCredito(status: string | null | undefined): number {
  if (!status) return 9
  return RANK_CREDITO[status.toUpperCase()] ?? 8
}

export function excedenteDe(s: SacadoFunil): number {
  return Math.max(0, Number(s.demanda_pipeline ?? 0) - Number(s.available_limit ?? 0))
}

function numeroDe(s: SacadoFunil, coluna: ColunaSacado): number {
  switch (coluna) {
    case 'notas':
      return Number(s.notas_em_faixa ?? 0)
    case 'fornecedores':
      return Number(s.fornecedores ?? 0)
    case 'demanda':
      return Number(s.demanda_pipeline ?? 0)
    case 'excedente':
      return excedenteDe(s)
    case 'receita':
      return Number(s.receita_esperada_total ?? 0)
    default:
      return 0
  }
}

/**
 * O desempate por nome é sempre ascendente, mesmo com a coluna em `desc`: sem ele,
 * os 108 sacados sem análise de crédito trocariam de lugar entre dois carregamentos
 * e a mesma tela pareceria outra lista.
 */
export function ordenarSacados(
  linhas: readonly SacadoFunil[],
  coluna: ColunaSacado,
  dir: Direcao,
): SacadoFunil[] {
  const sinal = dir === 'asc' ? 1 : -1
  return [...linhas].sort((a, b) => {
    let r = 0
    if (coluna === 'nome') r = (a.sacado_nome ?? '').localeCompare(b.sacado_nome ?? '', 'pt-BR')
    else if (coluna === 'credito') r = rankCredito(a.credito_status) - rankCredito(b.credito_status)
    else r = numeroDe(a, coluna) - numeroDe(b, coluna)

    if (r !== 0) return r * sinal
    return (a.sacado_nome ?? '').localeCompare(b.sacado_nome ?? '', 'pt-BR')
  })
}

/** Valor do filtro: `todos`, `sem` (sem análise) ou o status cru da API. */
export const CREDITO_TODOS = 'todos'
export const CREDITO_SEM = 'sem'

export function passaNoFiltro(s: SacadoFunil, credito: string): boolean {
  if (credito === CREDITO_TODOS) return true
  if (credito === CREDITO_SEM) return !s.credito_status
  return (s.credito_status ?? '').toUpperCase() === credito
}

export interface PreferenciasSacados {
  credito: string
  coluna: ColunaSacado
  dir: Direcao
}

const PADRAO: PreferenciasSacados = { credito: CREDITO_TODOS, coluna: 'demanda', dir: 'desc' }

const CHAVE_STORAGE = 'jobsiteos.antecipacao.sacados.v1'

function sanear(o: Record<string, unknown>): PreferenciasSacados {
  return {
    coluna:
      typeof o.coluna === 'string' && COLUNAS_VALIDAS.has(o.coluna)
        ? (o.coluna as ColunaSacado)
        : PADRAO.coluna,
    dir: o.dir === 'asc' || o.dir === 'desc' ? o.dir : PADRAO.dir,
    credito: typeof o.credito === 'string' && o.credito !== '' ? o.credito : PADRAO.credito,
  }
}

/**
 * O filtro fica salvo entre visitas porque quem trabalha essa tela trabalha um
 * recorte só ("só aprovados"), e refazer a escolha toda vez é o tipo de atrito que
 * faz a pessoa parar de usar o filtro. É preferência do NAVEGADOR, não da URL: um
 * link colado no WhatsApp tem de abrir a lista inteira para quem receber.
 */
export function usePreferenciasSacados() {
  const { prefs, atualizar } = usePreferenciasTabela(CHAVE_STORAGE, PADRAO, sanear)

  const ordenarPor = React.useCallback(
    (coluna: ColunaSacado) => atualizar(proximaOrdenacao(prefs, coluna, PRIMEIRA_DIRECAO)),
    [prefs, atualizar],
  )

  return { prefs, atualizar, ordenarPor }
}
