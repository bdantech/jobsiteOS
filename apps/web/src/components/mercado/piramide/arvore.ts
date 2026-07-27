import { mercadoEngine } from '@jobsiteos/core'
import { criarHelpersArvore } from '@/components/filtros/arvore'

/**
 * Os helpers da árvore, AMARRADOS ao engine do Mercado.
 *
 * A mecânica genérica mora em components/filtros — ela é compartilhada com o
 * construtor de regras de FAIXA da Antecipação, que roda sobre outro catálogo.
 * Este arquivo existe para que tudo na pirâmide continue importando os mesmos
 * nomes de sempre e para que nenhum ponto do Mercado precise passar um engine
 * a cada chamada.
 */
const helpers = criarHelpersArvore(mercadoEngine)

export const primeiroOperador = helpers.primeiroOperador
export const condicaoPadrao = helpers.condicaoPadrao
export const grupoPadrao = helpers.grupoPadrao
export const problemasDaArvore = helpers.problemasDaArvore
export const arvoreDeJson = helpers.arvoreDeJson

export {
  adicionar,
  labelOperador,
  pedeIntervalo,
  pedeLista,
  pedeValor,
  remover,
  substituir,
  trocarOperadorGrupo,
  valorPadrao,
  type Caminho,
} from '@/components/filtros/arvore'
