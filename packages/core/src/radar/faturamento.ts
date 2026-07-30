/**
 * Estimador de faturamento (Prompt 04c §6) — modelos, combinação e restrições.
 *
 * Mora no core, e não no worker, porque três consumidores precisam da MESMA
 * resposta: o job mensal que grava o snapshot, a tela que explica de onde saiu o
 * número, e a tool de IA que responde "quanto essa empresa fatura?". Duas
 * implementações dariam um valor na tela e outro na explicação — e a explicação é
 * justamente o que faz alguém confiar numa estimativa.
 *
 * O AVISO HONESTO, que vale mais que qualquer coeficiente: fontes tipo Apollo contam
 * perfis indexados no LinkedIn e **subcontam mão de obra de canteiro** de forma
 * brutal. Uma construtora com 800 pessoas aparece com 40. A calibração absorve esse
 * viés — mas só porque clientes e prospects são medidos pela MESMA régua torta. No
 * dia em que o headcount de um cliente vier do eSocial e o do prospect vier do
 * Apollo, o ratio calibrado num vira estimativa errada no outro.
 */

// ─── Hierarquia de origem (§2) ──────────────────────────────────────────────

export const ORIGENS_METRICA = [
  'declarado_cliente',
  'apollo',
  'apollo_search',
  'lista',
  'modelo',
  'bracket_simples',
] as const
export type OrigemMetrica = (typeof ORIGENS_METRICA)[number]

export const ORIGEM_METRICA_LABELS: Record<OrigemMetrica, string> = {
  declarado_cliente: 'Declarado',
  apollo: 'Apollo',
  apollo_search: 'Apollo (busca)',
  lista: 'Lista importada',
  modelo: 'Estimado',
  bracket_simples: 'Faixa do Simples',
}

/** Menor é melhor. `declarado_cliente` vence tudo — estimativa nunca sobrescreve. */
const RANK_ORIGEM: Record<OrigemMetrica, number> = {
  declarado_cliente: 0,
  apollo: 1,
  apollo_search: 2,
  lista: 3,
  modelo: 4,
  bracket_simples: 5,
}

/**
 * O cache só é atualizado se a leitura nova tem origem melhor ou IGUAL à vigente.
 * Igual conta porque uma leitura mais recente da mesma fonte é a mesma fonte
 * falando de novo — a série guarda as duas de qualquer jeito.
 *
 * Sem esta regra, o job mensal de estimativa apagaria o faturamento que o cliente
 * declarou na reunião da semana passada, em silêncio, todo mês.
 */
export function origemVence(nova: string | null | undefined, vigente: string | null | undefined): boolean {
  if (!vigente) return true
  const r1 = RANK_ORIGEM[nova as OrigemMetrica]
  const r2 = RANK_ORIGEM[vigente as OrigemMetrica]
  if (r1 === undefined) return false
  if (r2 === undefined) return true
  return r1 <= r2
}

// ─── Os modelos ─────────────────────────────────────────────────────────────

export const MODELOS = ['funcionarios', 'mrr', 'usuarios_erp'] as const
export type ModeloId = (typeof MODELOS)[number]

export const MODELO_LABELS: Record<ModeloId, string> = {
  funcionarios: 'Funcionários × faturamento por pessoa',
  mrr: 'MRR do ERP ÷ % sobre faturamento',
  usuarios_erp: 'Usuários do ERP × faturamento por usuário',
}

export interface CoeficientesTipo {
  /** Mediana de faturamento_declarado / funcionarios. */
  ratio_fat_por_funcionario: number | null
  /** Mediana de (erp_mrr × 12) / faturamento_declarado. */
  pct_mrr_sobre_faturamento: number | null
  /** Mediana de faturamento_declarado / qtd_usuarios_erp. */
  fat_por_usuario_erp: number | null
  /** Peso de cada modelo = inverso do erro mediano em log. Modelo que erra mais pesa menos. */
  pesos: Record<ModeloId, number>
  /** Quantas amostras sustentam estes coeficientes. */
  n: number
}

export interface Coeficientes {
  global: CoeficientesTipo
  porTipo: Record<string, CoeficientesTipo>
}

export interface SinaisEmpresa {
  tipo?: string | null
  funcionarios?: number | null
  erp_mrr?: number | null
  qtd_usuarios_erp?: number | null
  opcao_simples?: boolean | null
  /** Data de saída do Simples. Conhecida ⇒ o teto do Simples vira PISO. */
  data_exclusao_simples?: string | null
  regime_tributario?: string | null
}

export interface ParametrosFaturamento {
  teto_simples: number
  teto_presumido: number
  pct_teto_simples_default: number
}

export const PARAMETROS_FATURAMENTO_PADRAO: ParametrosFaturamento = {
  teto_simples: 4_800_000,
  teto_presumido: 78_000_000,
  pct_teto_simples_default: 0.5,
}

export type ConfiancaMetrica = 'alta' | 'media' | 'baixa'

export interface ModeloAplicado {
  id: ModeloId
  valor: number
  peso: number
}

export interface Estimativa {
  /** `null` quando não há sinal nenhum — e null não é zero. */
  valor: number | null
  origem: 'modelo' | 'bracket_simples' | null
  confianca: ConfiancaMetrica | null
  modelos: ModeloAplicado[]
  /** O que foi aplicado depois da combinação, na ordem. Alimenta a explicação na tela. */
  restricoes: string[]
}

/** Fator máximo entre o maior e o menor modelo para dizer que "concordam" (§6.2.4). */
const FATOR_CONCORDANCIA = 2

function coeficientesDe(coef: Coeficientes, tipo: string | null | undefined): CoeficientesTipo {
  const t = tipo ? coef.porTipo[tipo] : undefined
  // Sem amostras suficientes para o tipo, cai no global. É a mesma decisão do
  // `n_minimo_calibracao_por_tipo`, aplicada na hora de usar: um ratio calibrado em
  // duas empresas é ruído com cara de coeficiente.
  return t ?? coef.global
}

/**
 * Média geométrica ponderada. Faturamento é log-normal: a média aritmética de
 * "R$ 2M e R$ 200M" dá R$ 101M, um número que não descreve nenhuma das duas. A
 * geométrica dá R$ 20M, que ao menos fica entre elas em escala.
 */
export function mediaGeometricaPonderada(itens: ReadonlyArray<{ valor: number; peso: number }>): number | null {
  const validos = itens.filter((i) => Number.isFinite(i.valor) && i.valor > 0 && i.peso > 0)
  if (validos.length === 0) return null
  const somaPesos = validos.reduce((s, i) => s + i.peso, 0)
  if (somaPesos <= 0) return null
  const soma = validos.reduce((s, i) => s + i.peso * Math.log(i.valor), 0)
  return Math.exp(soma / somaPesos)
}

/** Os modelos que os sinais desta empresa permitem calcular. */
export function aplicarModelos(sinais: SinaisEmpresa, coef: Coeficientes): ModeloAplicado[] {
  const c = coeficientesDe(coef, sinais.tipo)
  const saida: ModeloAplicado[] = []

  const func = Number(sinais.funcionarios ?? 0)
  if (func > 0 && c.ratio_fat_por_funcionario && c.ratio_fat_por_funcionario > 0) {
    saida.push({ id: 'funcionarios', valor: func * c.ratio_fat_por_funcionario, peso: c.pesos.funcionarios })
  }

  const mrr = Number(sinais.erp_mrr ?? 0)
  if (mrr > 0 && c.pct_mrr_sobre_faturamento && c.pct_mrr_sobre_faturamento > 0) {
    saida.push({ id: 'mrr', valor: (mrr * 12) / c.pct_mrr_sobre_faturamento, peso: c.pesos.mrr })
  }

  const usuarios = Number(sinais.qtd_usuarios_erp ?? 0)
  if (usuarios > 0 && c.fat_por_usuario_erp && c.fat_por_usuario_erp > 0) {
    saida.push({ id: 'usuarios_erp', valor: usuarios * c.fat_por_usuario_erp, peso: c.pesos.usuarios_erp })
  }

  return saida.filter((m) => Number.isFinite(m.valor) && m.valor > 0)
}

function confiancaDe(modelos: ModeloAplicado[]): ConfiancaMetrica {
  if (modelos.length === 0) return 'baixa'
  if (modelos.length === 1) return 'media'
  const valores = modelos.map((m) => m.valor)
  const razao = Math.max(...valores) / Math.min(...valores)
  return razao <= FATOR_CONCORDANCIA ? 'alta' : 'media'
}

/**
 * A estimativa completa: modelos → média geométrica ponderada → restrições.
 *
 * As restrições vêm DEPOIS da combinação e nesta ordem de propósito. Aplicar o cap
 * do Simples antes faria dois modelos discordantes virarem dois valores idênticos no
 * teto, e a confiança sairia 'alta' — o sistema afirmando com convicção justamente
 * onde não sabe de nada.
 */
export function estimarFaturamento(
  sinais: SinaisEmpresa,
  coef: Coeficientes,
  params: ParametrosFaturamento = PARAMETROS_FATURAMENTO_PADRAO,
): Estimativa {
  const modelos = aplicarModelos(sinais, coef)
  const restricoes: string[] = []
  let valor = mediaGeometricaPonderada(modelos)
  const confianca = confiancaDe(modelos)

  const optante = sinais.opcao_simples === true

  if (optante) {
    if (valor === null) {
      // Nenhum modelo, mas o Simples por si só já é informação: o CNPJ fatura no
      // máximo o teto. Metade do teto é um chute declarado como chute — melhor que
      // `null`, que a tela leria como "empresa sem dado" e o filtro descartaria.
      return {
        valor: params.teto_simples * params.pct_teto_simples_default,
        origem: 'bracket_simples',
        confianca: 'baixa',
        modelos: [],
        restricoes: ['bracket_simples'],
      }
    }
    if (valor > params.teto_simples) {
      valor = params.teto_simples
      restricoes.push('cap_simples')
    }
  } else if (sinais.data_exclusao_simples) {
    // Saiu do Simples em data conhecida: alguém que ESTOUROU o teto não fatura menos
    // que ele. Vira piso, não teto — a direção importa.
    if (valor === null) {
      return {
        valor: params.teto_simples,
        origem: 'bracket_simples',
        confianca: 'baixa',
        modelos: [],
        restricoes: ['piso_saiu_simples'],
      }
    }
    if (valor < params.teto_simples) {
      valor = params.teto_simples
      restricoes.push('piso_saiu_simples')
    }
  }

  // Presumido LIMITA, não informa: o regime diz que a empresa está abaixo do teto,
  // não onde. Inferir valor a partir do regime seria inventar precisão.
  if (sinais.regime_tributario === 'presumido' && valor !== null && valor > params.teto_presumido) {
    valor = params.teto_presumido
    restricoes.push('cap_presumido')
  }

  if (valor === null) {
    return { valor: null, origem: null, confianca: null, modelos: [], restricoes: [] }
  }

  return {
    valor: Math.round(valor * 100) / 100,
    origem: 'modelo',
    confianca,
    modelos,
    restricoes,
  }
}

// ─── Calibração (§6.1) ──────────────────────────────────────────────────────

export interface AmostraCalibracao {
  tipo?: string | null
  /** O que o cliente declarou. É a régua contra a qual todo modelo é medido. */
  faturamento_declarado: number
  funcionarios?: number | null
  erp_mrr?: number | null
  qtd_usuarios_erp?: number | null
}

export function mediana(valores: readonly number[]): number | null {
  const v = valores.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b)
  if (v.length === 0) return null
  const meio = Math.floor(v.length / 2)
  return v.length % 2 === 0 ? (v[meio - 1]! + v[meio]!) / 2 : v[meio]!
}

/** Erro em LOG: prever 2× e prever metade erram igual, e é isso que se quer. */
function erroLog(previsto: number, real: number): number {
  return Math.abs(Math.log(previsto / real))
}

/** Piso do erro para o peso não explodir quando um modelo acerta em cheio na amostra. */
const ERRO_MINIMO = 0.05

function calibrarGrupo(amostras: readonly AmostraCalibracao[]): CoeficientesTipo {
  const validas = amostras.filter((a) => Number.isFinite(a.faturamento_declarado) && a.faturamento_declarado > 0)

  const ratio = mediana(
    validas.filter((a) => (a.funcionarios ?? 0) > 0).map((a) => a.faturamento_declarado / a.funcionarios!),
  )
  const pctMrr = mediana(
    validas.filter((a) => (a.erp_mrr ?? 0) > 0).map((a) => (a.erp_mrr! * 12) / a.faturamento_declarado),
  )
  const fatPorUsuario = mediana(
    validas.filter((a) => (a.qtd_usuarios_erp ?? 0) > 0).map((a) => a.faturamento_declarado / a.qtd_usuarios_erp!),
  )

  // O peso sai do erro do modelo ao prever os PRÓPRIOS clientes declarados. É o que
  // faz o sistema descobrir sozinho qual sinal funciona para qual tipo, em vez de
  // alguém arbitrar que "funcionários é melhor que MRR".
  const erros: Record<ModeloId, number[]> = { funcionarios: [], mrr: [], usuarios_erp: [] }
  for (const a of validas) {
    if (ratio && (a.funcionarios ?? 0) > 0) {
      erros.funcionarios.push(erroLog(a.funcionarios! * ratio, a.faturamento_declarado))
    }
    if (pctMrr && (a.erp_mrr ?? 0) > 0) {
      erros.mrr.push(erroLog((a.erp_mrr! * 12) / pctMrr, a.faturamento_declarado))
    }
    if (fatPorUsuario && (a.qtd_usuarios_erp ?? 0) > 0) {
      erros.usuarios_erp.push(erroLog(a.qtd_usuarios_erp! * fatPorUsuario, a.faturamento_declarado))
    }
  }

  const pesos = {} as Record<ModeloId, number>
  for (const id of MODELOS) {
    const e = mediana(erros[id])
    // Sem amostra para medir o erro, o modelo entra com peso neutro em vez de zero:
    // zerar mataria o único modelo disponível de uma empresa e a estimativa sumiria.
    pesos[id] = e === null ? 1 : 1 / Math.max(e, ERRO_MINIMO)
  }

  return {
    ratio_fat_por_funcionario: ratio,
    pct_mrr_sobre_faturamento: pctMrr,
    fat_por_usuario_erp: fatPorUsuario,
    pesos,
    n: validas.length,
  }
}

export interface ResultadoCalibracao {
  coeficientes: Coeficientes
  nPorTipo: Record<string, number>
  /** Erro mediano em log por modelo, global. É o que a página do Estimador mostra. */
  erroPorModelo: Record<ModeloId, number | null>
}

/**
 * Calibra nos clientes com faturamento declarado.
 *
 * Por TIPO, com piso de amostras: abaixo de `nMinimoPorTipo` o tipo simplesmente não
 * entra em `porTipo` e a estimativa cai no global. Um ratio calibrado em duas
 * empresas não é um ratio — é o acaso das duas, com aparência de coeficiente.
 */
export function calibrarEstimador(
  amostras: readonly AmostraCalibracao[],
  opts: { nMinimoPorTipo: number },
): ResultadoCalibracao {
  const global = calibrarGrupo(amostras)

  const grupos = new Map<string, AmostraCalibracao[]>()
  for (const a of amostras) {
    const t = a.tipo ?? 'sem_tipo'
    const lista = grupos.get(t)
    if (lista) lista.push(a)
    else grupos.set(t, [a])
  }

  const porTipo: Record<string, CoeficientesTipo> = {}
  const nPorTipo: Record<string, number> = {}
  for (const [tipo, lista] of grupos) {
    nPorTipo[tipo] = lista.length
    if (lista.length >= opts.nMinimoPorTipo) porTipo[tipo] = calibrarGrupo(lista)
  }

  // O erro global por modelo é reportado, não usado no cálculo: serve para alguém
  // olhar a página do Estimador e ver que "MRR erra 3× mais que funcionários".
  const erroPorModelo = {} as Record<ModeloId, number | null>
  for (const id of MODELOS) {
    const peso = global.pesos[id]
    erroPorModelo[id] = peso > 0 ? 1 / peso : null
  }

  return { coeficientes: { global, porTipo }, nPorTipo, erroPorModelo }
}

// ─── Crescimento e variação ─────────────────────────────────────────────────

export interface PontoSerie {
  valor: number
  capturado_em: string
}

/**
 * Variação entre o snapshot mais recente e o mais próximo de 12 meses atrás.
 * `null` com menos de dois pontos — e null NÃO é zero: "não sabemos se cresceu" e
 * "não cresceu" levam a conversas comerciais opostas.
 */
export function crescimento12m(serie: readonly PontoSerie[]): number | null {
  const pontos = serie
    .filter((p) => Number.isFinite(p.valor) && p.valor > 0 && !Number.isNaN(Date.parse(p.capturado_em)))
    .slice()
    .sort((a, b) => Date.parse(b.capturado_em) - Date.parse(a.capturado_em))
  if (pontos.length < 2) return null

  const recente = pontos[0]!
  const alvo = Date.parse(recente.capturado_em) - 365 * 86_400_000
  let melhor = pontos[1]!
  let menorDistancia = Math.abs(Date.parse(melhor.capturado_em) - alvo)
  for (const p of pontos.slice(1)) {
    const d = Math.abs(Date.parse(p.capturado_em) - alvo)
    if (d < menorDistancia) {
      melhor = p
      menorDistancia = d
    }
  }

  if (melhor.valor <= 0) return null
  return (recente.valor - melhor.valor) / melhor.valor
}

/** Só grava snapshot de modelo se mudou o suficiente (§6.2.5). */
export function variouOSuficiente(novo: number, anterior: number | null, minimo: number): boolean {
  if (anterior === null || anterior <= 0) return true
  return Math.abs(novo - anterior) / anterior > minimo
}
