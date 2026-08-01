import type { Grupo } from '@jobsiteos/core'
import { PARAM_FILTRO, lerFiltroDaUrl, rotaExploradorComFiltro } from '../queries'
import { COLUNAS_POR_ID } from './colunas'

/**
 * O estado do Explorador vive na URL, não no componente.
 *
 * Isso é o que torna uma visão filtrada compartilhável ("manda o link do SOM de
 * SP com obra ativa") e é o que permite ao Mapa do Mercado dar deep link em
 * qualquer fatia dos gráficos dele.
 *
 * O CODEC DA ÁRVORE NÃO MORA AQUI: é `PARAM_FILTRO`/`rotaExploradorComFiltro`/
 * `lerFiltroDaUrl` em components/mercado/queries.ts — o contrato compartilhado
 * entre o Mapa (que escreve a URL) e o Explorador (que a lê). Um segundo codec
 * aqui significaria que o clique numa fatia do Mapa abriria o Explorador SEM
 * filtro, em silêncio. Este módulo só acrescenta o resto do estado (termo,
 * ordenação, página) ao redor dele.
 *
 * Nada que sai daqui é confiável: `lerFiltroDaUrl` devolve a árvore SOMENTE se
 * ela passar por `parseArvore` (zod + catálogo). Um `?filtro=` forjado com uma
 * variável inventada não vira SQL — vira `null`, e o Explorador abre sem filtro.
 */

export { PARAM_FILTRO }

export const PARAM_TERMO = 'q'
export const PARAM_ORDEM = 's'
export const PARAM_DIRECAO = 'd'
export const PARAM_PAGINA = 'p'
export const PARAM_TAMANHO = 'n'

export const TAMANHOS_PAGINA = [25, 50, 100, 200] as const
export const TAMANHO_PADRAO = 50

/**
 * ORDENAR PELO UNIVERSO, e não por uma coluna de `empresas`.
 *
 * Eu tinha trocado isto por `valor_esperado_mensal` (04d §5) achando que `nulls last`
 * bastava. Não basta, e o motivo é o plano, não os dados: a chave de ordenação vive na
 * tabela do LEFT JOIN, então o `limit 51` não desce — o Postgres materializa as 881 mil
 * linhas através de cinco joins antes de ordenar. Medido:
 *
 *   order by cnpj                    →      4,2 ms  (index scan, para nas 51 primeiras)
 *   order by valor_esperado_mensal   → 23.350,0 ms  (full join + top-N sort)
 *
 * Com `statement_timeout` de 8s, isso não é lento: é uma tela que não abre. E não é um
 * problema de a coluna estar vazia hoje — com dados o plano é o mesmo. Ordenar o universo
 * inteiro por valor esperado só fica viável denormalizando a coluna em `mercado_universo`,
 * que é como `camada` e `grupo_id` já vivem lá.
 *
 * A coluna continua ORDENÁVEL: sobre uma seleção filtrada o sort é barato, e é assim que
 * a régua de R$ esperados serve para priorizar de verdade.
 */
export const ORDEM_PADRAO = 'cnpj'
export const DIRECAO_PADRAO: Direcao = 'asc'
export type Direcao = 'asc' | 'desc'

export interface EstadoExplorador {
  termo: string
  arvore: Grupo | null
  ordem: string
  direcao: Direcao
  pagina: number
  tamanho: number
}

export const ESTADO_INICIAL: EstadoExplorador = {
  termo: '',
  arvore: null,
  ordem: ORDEM_PADRAO,
  direcao: DIRECAO_PADRAO,
  pagina: 0,
  tamanho: TAMANHO_PADRAO,
}

function numero(valor: string | null, padrao: number, minimo: number): number {
  if (!valor) return padrao
  const n = Number(valor)
  if (!Number.isInteger(n) || n < minimo) return padrao
  return n
}

export function lerEstado(params: URLSearchParams): EstadoExplorador {
  const ordemBruta = params.get(PARAM_ORDEM)
  const coluna = ordemBruta ? COLUNAS_POR_ID.get(ordemBruta) : undefined

  const tamanho = numero(params.get(PARAM_TAMANHO), TAMANHO_PADRAO, 1)

  return {
    termo: params.get(PARAM_TERMO) ?? '',
    arvore: lerFiltroDaUrl(params.get(PARAM_FILTRO)),
    // Uma coluna fora do catálogo (ou não ordenável) viraria um 400 no PostgREST.
    // Cai no padrão em silêncio.
    ordem: coluna?.ordenarPor ? coluna.id : ORDEM_PADRAO,
    // Sem `d` na URL, vale o padrão da ordenação escolhida — e o padrão de dinheiro é
    // decrescente. Fixar 'asc' aqui faria a régua de valor esperado abrir pelo fim.
    direcao: params.get(PARAM_DIRECAO)
      ? params.get(PARAM_DIRECAO) === 'desc'
        ? 'desc'
        : 'asc'
      : DIRECAO_PADRAO,
    pagina: numero(params.get(PARAM_PAGINA), 0, 0),
    tamanho: (TAMANHOS_PAGINA as readonly number[]).includes(tamanho) ? tamanho : TAMANHO_PADRAO,
  }
}

/** Só grava o que difere do padrão: a URL de um Explorador limpo é /mercado/explorador. */
export function escreverEstado(estado: EstadoExplorador): string {
  const params = new URLSearchParams()

  if (estado.termo.trim()) params.set(PARAM_TERMO, estado.termo.trim())
  if (estado.arvore) params.set(PARAM_FILTRO, JSON.stringify(estado.arvore))
  if (estado.ordem !== ORDEM_PADRAO) params.set(PARAM_ORDEM, estado.ordem)
  if (estado.direcao !== DIRECAO_PADRAO) params.set(PARAM_DIRECAO, estado.direcao)
  if (estado.pagina > 0) params.set(PARAM_PAGINA, String(estado.pagina))
  if (estado.tamanho !== TAMANHO_PADRAO) params.set(PARAM_TAMANHO, String(estado.tamanho))

  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Deep link para o Explorador filtrado — o mesmo que o Mapa usa. */
export function urlDoExplorador(arvore: Grupo): string {
  return rotaExploradorComFiltro(arvore)
}
