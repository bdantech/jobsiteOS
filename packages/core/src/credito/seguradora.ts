/**
 * A seguradora, atrás de uma interface (04d §4.2).
 *
 * O prompt pede "provedor plugável" e o motivo é concreto: a Atradius é a de hoje, não a
 * definição do problema. Trocar de seguradora (ou operar duas) tem de ser escrever um
 * arquivo novo, não refatorar a esteira.
 *
 * A interface vive no CORE e a implementação no worker porque só o worker tem as
 * credenciais — e porque este arquivo precisa ser importável pela web (para os tipos das
 * telas) sem arrastar um cliente HTTP junto.
 *
 * ── A regra de custo, que é de desenho e não de implementação ──────────────────
 * `resolverBuyer` PODE SER COBRADO pela seguradora. Por isso ele não aparece em nenhum
 * caminho de lote, varredura ou pré-cálculo: a única chamada está no envio de uma
 * análise, que é um clique humano deliberado. O backfill (§4.3) usa `listarPortfolio` e
 * `listarDecisoes`, que leem o que a apólice JÁ tem, e só chama `detalharBuyer` para
 * buyers que vieram nessas listas. Busca aberta de buyer não existe neste arquivo — e é
 * por isso que não existe um método para ela.
 */

/**
 * ── Ambiente: sandbox ou produção ────────────────────────────────────────────
 * A escolha é uma SETTING (linha `atradius` de `credito_config`), e não uma variável de
 * ambiente, por um motivo operacional: quem precisa alternar é a pessoa que está
 * homologando a integração, e uma variável de ambiente obriga um redeploy do worker a
 * cada ida e volta. Aqui vira um clique em /credito/config.
 *
 * As URLs vivem no CORE porque a tela de configuração precisa MOSTRAR para onde o
 * worker vai bater. Duas cópias da mesma URL — uma no worker, outra na tela — divergem
 * no dia em que a seguradora mudar o host, e a tela passa a mentir.
 *
 * O padrão é `sandbox`, e não `producao`: se a linha de config sumir ou vier com lixo,
 * o pior caso tem de ser "não valeu nada em homologação", nunca "pedi cobertura de
 * verdade sem querer".
 */
export type AmbienteSeguradora = 'sandbox' | 'producao'

export const AMBIENTES_SEGURADORA: Record<
  AmbienteSeguradora,
  { label: string; base_url: string; descricao: string }
> = {
  sandbox: {
    label: 'Homologação (sandbox)',
    base_url: 'https://api-uat.atradius.com',
    descricao:
      'Ambiente de testes da Atradius. Nada enviado daqui vira cobertura de verdade — é onde se confere rota, campo e paginação antes de valer.',
  },
  producao: {
    label: 'Produção',
    base_url: 'https://api.atradius.com',
    descricao:
      'Ambiente real. Um envio daqui é um pedido de cobertura de verdade, e a busca de buyer pode ser cobrada.',
  },
}

export const AMBIENTE_SEGURADORA_PADRAO: AmbienteSeguradora = 'sandbox'

export function ehAmbienteSeguradora(v: unknown): v is AmbienteSeguradora {
  return v === 'sandbox' || v === 'producao'
}

/**
 * ── Como o CNPJ se apresenta à Atradius ──────────────────────────────────────
 * `uidType` é um enum FECHADO da API (confirmado na doc), e `CNPJ` não está nele. Qual
 * dos sete vale para um registro nacional brasileiro é o que falta descobrir — o apêndice
 * da doc lista os aceitos por país.
 *
 * Por isso é setting e não constante: errar aqui não devolve erro de rota, devolve "buyer
 * não encontrado", que a esteira lê como "não existe na Atradius" e manda para revisão
 * manual. Falha silenciosa, numa chamada que pode ser cobrada — e a forma de descobrir é
 * tentar na sandbox, o que precisa ser um clique e não um deploy.
 */
export const UID_TYPES_SEGURADORA = ['VAT', 'NRN', 'CR', 'DB', 'FC', 'SN', 'TK'] as const
export type UidTypeSeguradora = (typeof UID_TYPES_SEGURADORA)[number]

/**
 * NRN — "national registration number" é a leitura mais próxima do que o CNPJ é: o
 * registro nacional de uma pessoa jurídica. CR (company registration) é o segundo
 * candidato. Nenhum dos dois está confirmado.
 */
export const UID_TYPE_SEGURADORA_PADRAO: UidTypeSeguradora = 'NRN'

export function ehUidTypeSeguradora(v: unknown): v is UidTypeSeguradora {
  return typeof v === 'string' && (UID_TYPES_SEGURADORA as readonly string[]).includes(v)
}

/** ISO 3166-1 Alpha-3, como a API exige. O Brasil não tem sufixo de exceção. */
export const PAIS_SEGURADORA_BR = 'BRA'

/**
 * NÃO existe `expirada` aqui.
 *
 * Uma cobertura que venceu não é um desfecho diferente de uma que foi cancelada: nos
 * dois casos ela deixou de existir, e o que a distingue é o MOTIVO, que já vem no
 * `motivo` e nos códigos crus. Um estágio próprio para o vencimento apagava o desfecho
 * original — depois de expirar, ninguém mais sabia se aquilo tinha sido aprovado ou
 * aprovado parcial — e por isso ele saiu do vocabulário da esteira.
 */
export type EstagioSeguradora =
  | 'em_analise'
  | 'aprovada'
  | 'aprovada_parcial'
  | 'negada'
  | 'cancelada'

export interface BuyerSeguradora {
  buyer_id: string
  /** Identificador nacional devolvido pela seguradora — no Brasil, o CNPJ. */
  identificador_nacional: string | null
  nome: string | null
  rating: string | null
}

export interface DecisaoSeguradora {
  case_id: string
  buyer_id: string
  estagio: EstagioSeguradora
  limite_aprovado: number | null
  moeda: string
  /** Data de validade da cobertura, em AAAA-MM-DD. */
  expira_em: string | null
  decidida_em: string | null
  motivo: string | null
  rating: string | null
  /** A CLASSE do rating (`currentBuyerRatingClass`), que é a régua grossa ao lado da fina. */
  rating_classe?: string | null
  /**
   * Os códigos CRUS da seguradora (`decisionCode`, `historicCode`).
   *
   * Guardados porque o estágio é uma TRADUÇÃO, e tradução perde o original: quando uma
   * linha aparece classificada de um jeito que não bate com a realidade, sem o código não
   * há como saber se o erro está no mapa ou no dado. Foi exatamente o que aconteceu com
   * seis coberturas em vigor gravadas como negadas.
   */
  codigo_decisao?: string | null
  codigo_historico?: string | null
  /**
   * CNPJ e nome do buyer, quando a própria decisão os carrega.
   *
   * A Atradius devolve os dois dentro de cada cobertura — e isso poupa o backfill de
   * detalhar buyer por buyer só para descobrir de quem é a linha. Continuam opcionais
   * porque outra seguradora pode não mandar.
   */
  identificador_nacional?: string | null
  nome_buyer?: string | null
  /**
   * Uma ação já agendada pela seguradora sobre esta cobertura — cancelamento, retirada ou
   * transferência pendente.
   *
   * É diferente de estágio: a cobertura AINDA VALE hoje. Mas é o aviso mais antecipado que
   * a seguradora dá de que vai deixar de valer, e chega antes do corte aparecer no limite.
   */
  pendencia?: string | null
}

export interface PedidoCobertura {
  buyer_id: string
  limite_solicitado: number
  moeda: string
  /** Referência nossa, para reconciliar o retorno com a linha da esteira. */
  referencia_externa: string
}

/**
 * Um documento a caminho da seguradora.
 *
 * Já vem com os BYTES, e não com um caminho de bucket, por dois motivos: quem sabe ler
 * o bucket é o worker, e quem sabe falar com a seguradora é o provedor — misturar as
 * duas coisas obrigaria cada provedor novo a conhecer o nosso storage.
 */
export interface DocumentoParaSeguradora {
  /** O id da linha em `analise_docs`. Volta no resultado para marcar o que foi aceito. */
  id: string
  /** O tipo do catálogo (`balanco_patrimonial`, `dre`, …). */
  tipo: string
  nome_arquivo: string
  mime: string
  conteudo: Uint8Array
}

export interface ResultadoEnvioDocumento {
  id: string
  ok: boolean
  erro?: string
}

/**
 * Toda operação devolve um resultado discriminado em vez de lançar: o job precisa
 * distinguir "a seguradora respondeu que não" de "não consegui falar com a seguradora",
 * e uma exceção genérica apaga essa diferença justamente onde ela decide se o item é
 * retentado ou encerrado.
 */
export type ResultadoSeguradora<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string; recuperavel: boolean }

export interface Seguradora {
  readonly id: string
  readonly nome: string
  /**
   * False quando faltam credenciais. A esteira usa isto para explicar em vez de falhar.
   *
   * É assíncrono porque QUAIS credenciais são exigidas depende do ambiente escolhido na
   * configuração — que mora no banco. Um `configurada()` síncrono só conseguiria olhar
   * as variáveis de um ambiente fixo, e responderia "sim" com as credenciais de produção
   * enquanto a tela dissesse homologação.
   */
  configurada(): Promise<boolean>

  /**
   * Resolve o buyer pelo identificador nacional (CNPJ). **PODE SER COBRADO.**
   * Só é chamado no envio de uma análise — nunca em lote, nunca especulativamente.
   */
  resolverBuyer(cnpj: string): Promise<ResultadoSeguradora<BuyerSeguradora | null>>

  /** Detalha um buyer que JÁ veio de uma listagem da apólice. */
  detalharBuyer(buyerId: string): Promise<ResultadoSeguradora<BuyerSeguradora | null>>

  /**
   * Os buyers que JÁ estão na apólice. Leitura do que existe — não descobre buyer novo, e
   * por isso não cai na regra de custo de `resolverBuyer`.
   *
   * Devolve `null` (e não erro) quando a listagem não está disponível: o backfill trata
   * isso caindo no detalhamento um a um, que é mais caro em chamadas mas dá o mesmo mapa.
   */
  listarBuyersDaApolice(): Promise<ResultadoSeguradora<BuyerSeguradora[] | null>>

  /**
   * A apólice sob a qual esta credencial opera.
   *
   * Existe como método próprio — e não como detalhe interno — por causa da ordem do
   * envio: `resolverBuyer` PODE SER COBRADO e roda antes do pedido. Sem um ponto para
   * garantir a apólice ANTES do laço, uma apólice irresolvível viraria uma busca de buyer
   * paga por análise seguida de falha, e a fatura chegaria por um erro de configuração.
   *
   * Devolve `descricao` para o log: qual contrato recebeu o pedido é a primeira pergunta
   * quando o limite aprovado vem de onde ninguém esperava.
   */
  apoliceVigente(): Promise<ResultadoSeguradora<{ policy_id: string; descricao: string }>>

  /** Submete o pedido de cobertura. */
  pedirCobertura(pedido: PedidoCobertura): Promise<ResultadoSeguradora<{ case_id: string }>>

  /**
   * Anexa documentos ao pedido já aberto.
   *
   * Um resultado POR DOCUMENTO, e não um `ok` do lote: metade aceita e metade recusada
   * é o caso comum (tamanho, formato), e um booleano só do conjunto obrigaria o Crédito
   * a reenviar tudo para descobrir o que faltou. A esteira grava linha a linha.
   *
   * Falhar aqui NUNCA desfaz o pedido de cobertura: ele já foi submetido, já pode ter
   * sido cobrado, e a seguradora aceita documento depois. O envio segue valendo.
   */
  enviarDocumentos(
    caseId: string,
    documentos: DocumentoParaSeguradora[],
  ): Promise<ResultadoSeguradora<ResultadoEnvioDocumento[]>>

  /** Estado atual de um pedido. Usado pelo poll. */
  consultarDecisao(caseId: string): Promise<ResultadoSeguradora<DecisaoSeguradora | null>>

  /** Limites vigentes na apólice. Leitura do que já existe — não descobre buyer novo. */
  listarPortfolio(cursor?: string): Promise<
    ResultadoSeguradora<{ itens: DecisaoSeguradora[]; proximoCursor: string | null }>
  >

  /** Decisões da apólice (histórico e pendentes). Mesma restrição do portfólio. */
  listarDecisoes(
    desde?: string,
    cursor?: string,
  ): Promise<ResultadoSeguradora<{ itens: DecisaoSeguradora[]; proximoCursor: string | null }>>
}

/** Mapeia o estágio devolvido pela seguradora para o vocabulário da esteira. */
export function estagioDaDecisao(e: EstagioSeguradora): string {
  return e
}

/**
 * Uma redução de limite é um evento próprio, e não um caso dentro de "atualizada":
 * a seguradora cortando cobertura que já tinha concedido é o sinal de risco mais forte
 * que este sistema recebe de fora, e ele não pode depender de alguém estar olhando a
 * esteira no dia certo.
 */
export function houveReducaoDeLimite(
  anterior: number | null | undefined,
  novo: number | null | undefined,
): boolean {
  const a = Number(anterior ?? 0)
  const n = Number(novo ?? 0)
  return a > 0 && n < a
}
