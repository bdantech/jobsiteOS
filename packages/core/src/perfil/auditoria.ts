import type { Grupo, No } from '../mercado/filters.js'

/**
 * O formato da auditoria (04f §5) — a parte que morde.
 *
 * Não é "as regras estão boas?". É a pergunta concreta: **quantos dos que
 * REALMENTE operam a régua vigente deixaria de fora, e por causa de qual
 * condição?** Uma regra que barra metade dos operadores pesados não é rigorosa,
 * é míope — e ninguém descobre isso lendo a regra, só rodando a coorte por ela.
 *
 * O tipo vive no core porque três lugares o consomem: o worker que o calcula, a
 * tela que o mostra e o gerador de sugestões que o transforma em ajuste.
 */

export interface CondicaoBarreira {
  /** Posição no array de condições do topo da regra — é por ela que o ajuste entra. */
  indice: number
  /** A condição em português, pelo `descrever` do engine. */
  descricao: string
  /** Quantos da coorte operadora esta condição sozinha reprova. */
  barrados: number
  /** `barrados / total da coorte`. */
  fracao: number
  /** O nó original, para o gerador propor a versão afrouxada. */
  no: No
}

export interface AuditoriaCamada {
  camada: string
  versao: number
  /** Qual coorte foi passada pela régua ('pesados', 'clientes'…). */
  coorte: string
  /** Quantos da coorte puderam ser avaliados — os que existem no universo. */
  total: number
  passam: number
  nao_passam: number
  /**
   * Os que NÃO puderam ser avaliados: operam de verdade mas não têm linha no
   * universo (nunca passaram pelo lookup cadastral). Contá-los como reprovados
   * inflaria a mordida; omiti-los sem dizer esconderia que a régua sequer os
   * enxerga. Aparecem à parte, que é a única leitura honesta.
   */
  sem_cadastro: number
  /** Ordenadas por `barrados` decrescente. */
  barreiras: CondicaoBarreira[]
  /** A regra vigente, para o gerador partir dela. */
  definicao: Grupo | null
}

export interface TaxaPorFaixa {
  faixa: string
  versao: number | null
  nfs: number
  convertidas: number
  /** `convertidas / nfs`. */
  taxa: number
}

export interface AuditoriaFaixas {
  janela_dias: number
  por_faixa: TaxaPorFaixa[]
  convertidas_total: number
  /**
   * NFs que converteram estando FORA de qualquer faixa. É o número que diz se a
   * régua está cega para um pedaço do que dá dinheiro — e a única evidência que
   * justifica afrouxar uma faixa em vez de apertar.
   */
  convertidas_sem_faixa: number
  fracao_sem_faixa: number
}

export interface Auditoria {
  camadas: AuditoriaCamada[]
  faixas: AuditoriaFaixas | null
}
