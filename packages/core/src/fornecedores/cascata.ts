import { PESO_CONFIANCA, type Confianca, type FonteContato } from './schemas.js'

/**
 * A cascata de descoberta de contato (§4): o que roda, em que ordem, e o que cada
 * clique vai custar ANTES de o originador clicar.
 *
 * Este arquivo é puro de propósito. O plano precisa ser calculável na tela (para
 * mostrar "este clique custa R$ 0,47"), no worker (para executar) e no teste (para
 * provar que a ordem não mudou). Se a tela estimasse por uma regra e o worker
 * cobrasse por outra, a diferença apareceria na fatura, não no código.
 *
 * ─── POR QUE A ORDEM É ESTA ──────────────────────────────────────────────────
 *
 * Do mais barato e mais certo para o mais caro e mais incerto. Medido nos 688
 * fornecedores do funil: o XML da NF-e tem telefone para 528 deles (77%) e custa
 * zero; a Receita, para 75 (11%). Rodar um provedor pago antes de esgotar os dois é
 * pagar por 77% de informação que já está no nosso banco.
 *
 * Camada 0+1 roda sozinha, para todos, no job. Camada 2+4 só roda quando alguém
 * clica — e debita do teto mensal do originador.
 */

/** Todo provedor da cascata, na ordem em que a cascata os tenta. */
export const PROVEDORES_CASCATA = [
  'xml_nfe',
  'receita',
  'contatos_base',
  'site_empresa',
  'google_places',
  'novavida',
  'apollo',
  'claude_busca',
] as const
export type ProvedorCascata = (typeof PROVEDORES_CASCATA)[number]

export const PROVEDOR_LABELS: Record<ProvedorCascata, string> = {
  xml_nfe: 'XML das notas',
  receita: 'Cadastro da Receita',
  contatos_base: 'Contatos que já temos',
  site_empresa: 'Site da empresa',
  google_places: 'Google Places',
  novavida: 'Nova Vida TI (sócios)',
  apollo: 'Apollo',
  claude_busca: 'Busca do Claude',
}

/** Em que `contatos_descobertos.fonte` cada provedor grava. */
export const FONTE_DO_PROVEDOR: Record<ProvedorCascata, FonteContato> = {
  xml_nfe: 'xml_nfe',
  receita: 'receita',
  contatos_base: 'site_empresa',
  site_empresa: 'site_empresa',
  google_places: 'google_places',
  novavida: 'novavida',
  apollo: 'apollo',
  claude_busca: 'claude_busca',
}

export const PROVEDORES_AUTOMATICOS: readonly ProvedorCascata[] = [
  'xml_nfe',
  'receita',
  'contatos_base',
  'site_empresa',
  'google_places',
]

export const PROVEDORES_SOB_DEMANDA: readonly ProvedorCascata[] = [
  'novavida',
  'apollo',
  'claude_busca',
]

export interface CustosDescoberta {
  google_places: number
  novavida: number
  apollo: number
  claude_busca: number
}

export const CUSTOS_PADRAO: CustosDescoberta = {
  // Text Search do Places: US$ 0,032/consulta na faixa básica, ~R$ 0,18 ao câmbio de
  // referência. Fica em config porque câmbio e tabela do Google mudam sem avisar.
  google_places: 0.18,
  novavida: 0.35,
  // O mesmo crédito de revelação do Radar (`contato_apollo`), mantido igual de
  // propósito: é a mesma cobrança, e dois valores diferentes para ela fariam o
  // orçamento do Radar e o deste módulo divergirem sobre a mesma fatura.
  apollo: 1.2,
  claude_busca: 0.1,
}

/** O que já sabemos sobre o fornecedor, e que decide o que vale a pena rodar. */
export interface EstadoFornecedor {
  /** Domínio resolvido pela cascata do Radar, quando houver. */
  dominio: string | null
  funcionarios: number | null
  faturamento_estimado: number | null
  municipio: string | null
  uf: string | null
  razao_social: string | null
  /** A melhor confiança entre os contatos JÁ descobertos. */
  melhor_confianca: Confianca | null
}

export interface OpcoesCascata {
  custos?: Partial<CustosDescoberta>
  /** §4.2: para na primeira fonte de confiança alta. Default true. */
  pararAoEncontrarAlta?: boolean
  /** Porte mínimo para o Apollo valer a pena (§4.2b). */
  apolloMinimoFuncionarios?: number
  apolloMinimoFaturamento?: number
}

export interface EtapaPlano {
  provedor: ProvedorCascata
  rodara: boolean
  custo: number
  /** Por que NÃO vai rodar. Sempre preenchido quando `rodara` é false. */
  motivo: string | null
}

export interface PlanoDescoberta {
  etapas: EtapaPlano[]
  /** O que a tela mostra no botão. Só soma o que de fato vai rodar. */
  custo_estimado: number
  /**
   * True quando a cascata pode parar antes do fim. O custo estimado é o TETO — se a
   * Nova Vida achar um celular de sócio, o Apollo e o Claude não rodam e a fatura é
   * menor. Prometer o teto e cobrar menos é a única direção aceitável do erro.
   */
  pode_custar_menos: boolean
}

/**
 * O plano do clique pago (camadas 2+4).
 *
 * Já-tem-alta é avaliado ANTES de tudo: se a camada automática já achou um telefone
 * do `emit` da NF-e, o clique inteiro é desnecessário e o botão precisa dizer isso em
 * vez de aceitar R$ 1,65 para confirmar o que está na tela.
 */
export function planejarDescobertaSobDemanda(
  estado: EstadoFornecedor,
  opcoes: OpcoesCascata = {},
): PlanoDescoberta {
  const custos = { ...CUSTOS_PADRAO, ...(opcoes.custos ?? {}) }
  const parar = opcoes.pararAoEncontrarAlta ?? true
  const minFunc = opcoes.apolloMinimoFuncionarios ?? 10
  const minFat = opcoes.apolloMinimoFaturamento ?? null

  const jaTemAlta = estado.melhor_confianca !== null && PESO_CONFIANCA[estado.melhor_confianca] >= PESO_CONFIANCA.alta

  const etapas: EtapaPlano[] = []

  const add = (provedor: ProvedorCascata, custo: number, motivo: string | null): void => {
    etapas.push({ provedor, rodara: motivo === null, custo: motivo === null ? custo : 0, motivo })
  }

  const bloqueioGlobal = parar && jaTemAlta ? 'Já existe contato de confiança alta.' : null

  add('novavida', custos.novavida, bloqueioGlobal)

  /*
   * Apollo, e só quando o porte sugere que existe alguém com LinkedIn.
   *
   * Duas condições, ambas necessárias: domínio resolvido (o Apollo consulta por
   * domínio, não por CNPJ — sem ele a chamada volta vazia e cobra o rate limit) e
   * porte. Uma serralheria de 4 pessoas em Sorocaba não tem página de empresa no
   * LinkedIn, e pagar R$ 1,20 para descobrir isso 688 vezes é a definição de gasto
   * sem retorno que o §4.2b manda evitar.
   */
  const porteOk =
    (estado.funcionarios !== null && estado.funcionarios >= minFunc) ||
    (minFat !== null && estado.faturamento_estimado !== null && estado.faturamento_estimado >= minFat)

  add(
    'apollo',
    custos.apollo,
    bloqueioGlobal ??
      (!estado.dominio
        ? 'Sem domínio resolvido — o Apollo consulta por domínio.'
        : !porteOk
          ? `Porte abaixo do mínimo (${minFunc} funcionários): PME sem LinkedIn é gasto sem retorno.`
          : null),
  )

  add('claude_busca', custos.claude_busca, bloqueioGlobal)

  const vaiRodar = etapas.filter((e) => e.rodara)
  return {
    etapas,
    custo_estimado: Math.round(vaiRodar.reduce((s, e) => s + e.custo, 0) * 100) / 100,
    pode_custar_menos: parar && vaiRodar.length > 1,
  }
}

/**
 * Depois de cada provedor: para aqui?
 *
 * A pergunta é feita entre etapas, com o que a etapa acabou de achar, porque é o
 * único lugar onde ela tem resposta. Um plano calculado inteiro no início não sabe
 * que a Nova Vida ia trazer o celular do sócio.
 */
export function deveParar(
  melhorConfiancaAtual: Confianca | null,
  pararAoEncontrarAlta = true,
): boolean {
  if (!pararAoEncontrarAlta) return false
  return melhorConfiancaAtual !== null && PESO_CONFIANCA[melhorConfiancaAtual] >= PESO_CONFIANCA.alta
}

// ─── Orçamento ──────────────────────────────────────────────────────────────

export interface EstadoOrcamentoDescoberta {
  gasto: number
  teto: number
  saldo: number
  /** O clique cabe? */
  cabe: boolean
  /** Passou do percentual de alerta com este clique. */
  alerta: boolean
}

/**
 * O teto é do ORIGINADOR e é mensal (§4.2).
 *
 * Ele existe para que o originador acione sozinho — o teto é a autorização, não o
 * gestor. Pedir aprovação para cada R$ 1,65 transformaria a descoberta num processo
 * com fila, e uma fila de aprovação de centavos é como um recurso pago vira um
 * recurso que ninguém usa.
 */
export function avaliarOrcamento(
  gasto: number,
  teto: number,
  custoDoClique: number,
  alertaPercentual = 0.8,
): EstadoOrcamentoDescoberta {
  const projetado = gasto + custoDoClique
  return {
    gasto,
    teto,
    saldo: Math.max(0, teto - gasto),
    cabe: projetado <= teto,
    alerta: teto > 0 && projetado >= teto * alertaPercentual,
  }
}
