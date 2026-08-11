'use client'

import * as React from 'react'
import type { FornecedorProspectar } from './queries'
import { proximaOrdenacao, usePreferenciasTabela, type Direcao } from './tabela-ordenavel'

/**
 * Ordenação da lista "fornecedores a prospectar" — a parte sem JSX.
 *
 * Mesma mecânica da lista de sacados (`prospectar-tabela.ts`), com UMA diferença
 * que importa: lá a leitura cabe inteira no cliente, aqui não. São 5.512
 * fornecedores na janela e o teto traz 500, escolhidos pelo servidor por número de
 * notas. Reordenar por valor aqui responde "quem factura mais ENTRE os que mais
 * emitem", não "quem factura mais" — e é por isso que a tela diz isso em letras
 * miúdas embaixo da tabela.
 *
 * O padrão é `notas`, e ele é duplo: é o pedido da tela e é o critério que decide
 * quais 500 chegaram até aqui. Começar em qualquer outra coluna abriria a lista já
 * mostrando um recorte enviesado.
 */

export type ColunaFornecedorProspectar =
  | 'nome'
  | 'cnae'
  | 'local'
  | 'notas'
  | 'operaveis'
  | 'sacados'
  | 'valor'
  | 'ultimaNota'

const PRIMEIRA_DIRECAO: Record<ColunaFornecedorProspectar, Direcao> = {
  nome: 'asc',
  cnae: 'asc',
  local: 'asc',
  notas: 'desc',
  operaveis: 'desc',
  sacados: 'desc',
  valor: 'desc',
  ultimaNota: 'desc',
}

const COLUNAS_VALIDAS = new Set<string>(Object.keys(PRIMEIRA_DIRECAO))

export function localDe(f: FornecedorProspectar): string {
  return [f.fornecedor_municipio, f.fornecedor_uf].filter(Boolean).join(' / ')
}

/**
 * Busca por nome ou CNPJ. Existe porque a lista tem 1.808 linhas: sem ela, achar um
 * fornecedor específico é rolar a tela procurando a olho.
 *
 * O CNPJ é comparado só por DÍGITOS — quem cola "66.872.185/0001-32" de outro
 * sistema não deveria ter de apagar a pontuação, e quem digita "66872185" também
 * acha. Mesma regra da busca de clientes Onepay, de propósito: duas buscas que se
 * comportam diferente viram duas convenções.
 */
export function combinaBusca(f: FornecedorProspectar, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true

  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && (f.fornecedor_cnpj ?? '').includes(digitos)) return true

  return (f.fornecedor_nome ?? '').toLowerCase().includes(t)
}

/**
 * Situação cadastral que NÃO é "ativa" desqualifica o lead antes da ligação. São 22
 * dos 5.512, e `null` (fornecedor fora de `mercado_universo`) não é um deles: não
 * saber não é o mesmo que estar inapta.
 */
export function situacaoPreocupa(situacao: string | null | undefined): boolean {
  return !!situacao && situacao.toLowerCase() !== 'ativa'
}

function numeroDe(f: FornecedorProspectar, coluna: ColunaFornecedorProspectar): number {
  switch (coluna) {
    case 'notas':
      return Number(f.notas ?? 0)
    case 'operaveis':
      return Number(f.notas_operaveis ?? 0)
    case 'sacados':
      return Number(f.sacados ?? 0)
    case 'valor':
      return Number(f.valor_agregado ?? 0)
    case 'ultimaNota':
      // Sem data vai para o fim em ordem decrescente (o padrão da coluna), que é
      // onde "nunca emitiu" pertence.
      return f.ultima_nota_em ? Date.parse(f.ultima_nota_em) : Number.NEGATIVE_INFINITY
    default:
      return 0
  }
}

const COLUNAS_TEXTO = new Set<ColunaFornecedorProspectar>(['nome', 'cnae', 'local'])

function textoDe(f: FornecedorProspectar, coluna: ColunaFornecedorProspectar): string {
  if (coluna === 'nome') return f.fornecedor_nome ?? ''
  if (coluna === 'cnae') return f.fornecedor_cnae_principal ?? ''
  return localDe(f)
}

/**
 * O desempate é sempre por nome, ascendente, mesmo com a coluna em `desc`. Sem ele,
 * os milhares de fornecedores empatados em uma nota trocariam de lugar entre dois
 * carregamentos.
 */
export function ordenarFornecedoresProspectar(
  linhas: readonly FornecedorProspectar[],
  coluna: ColunaFornecedorProspectar,
  dir: Direcao,
): FornecedorProspectar[] {
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
    return (a.fornecedor_nome ?? '').localeCompare(b.fornecedor_nome ?? '', 'pt-BR')
  })
}

export interface PreferenciasFornecedorProspectar {
  coluna: ColunaFornecedorProspectar
  dir: Direcao
}

const PADRAO: PreferenciasFornecedorProspectar = { coluna: 'notas', dir: 'desc' }

const CHAVE_STORAGE = 'jobsiteos.antecipacao.prospectar-fornecedores.v1'

function sanear(o: Record<string, unknown>): PreferenciasFornecedorProspectar {
  return {
    coluna:
      typeof o.coluna === 'string' && COLUNAS_VALIDAS.has(o.coluna)
        ? (o.coluna as ColunaFornecedorProspectar)
        : PADRAO.coluna,
    dir: o.dir === 'asc' || o.dir === 'desc' ? o.dir : PADRAO.dir,
  }
}

export function usePreferenciasFornecedoresProspectar() {
  const { prefs, atualizar } = usePreferenciasTabela(CHAVE_STORAGE, PADRAO, sanear)

  const ordenarPor = React.useCallback(
    (coluna: ColunaFornecedorProspectar) =>
      atualizar(proximaOrdenacao(prefs, coluna, PRIMEIRA_DIRECAO)),
    [prefs, atualizar],
  )

  return { prefs, ordenarPor }
}
