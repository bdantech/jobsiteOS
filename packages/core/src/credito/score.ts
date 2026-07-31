/**
 * Scorecard de chance de concessão (04d §3).
 *
 * A regra que governa tudo aqui: **fator sem dado sai da conta inteira** — do numerador
 * E do denominador. Um scorecard que trata ausência como zero pune quem nunca foi
 * consultado exatamente como pune quem foi consultado e tem protesto, e as duas coisas
 * não são a mesma. A renormalização é o que mantém o score comparável entre empresas com
 * coberturas de dado diferentes; a `completude` é o que impede que essa comparação seja
 * feita sem ninguém saber sobre quanta informação ela repousa.
 *
 * E é por isso que existe `dados_insuficientes`: abaixo do mínimo, o número não é exibido.
 * Um score de 72 calculado sobre 20% dos pesos parece um score de 72.
 *
 * A LÓGICA de cada fator mora aqui e é fixa por id. O que é editável (e versionado em
 * `scorecard_versoes.definicao`) são os pesos, os limiares e os pontos. Um jsonb que
 * carregasse a lógica seria uma linguagem de expressão dentro do banco, e nenhum teste
 * alcançaria as versões que alguém salvar depois.
 */

// ─── Vocabulário ────────────────────────────────────────────────────────────

export const FATORES_SCORE = [
  'protestos',
  'faturamento',
  'atividade_grupo',
  'idade',
  'regularidade',
  'historico_analises',
  'crescimento_headcount',
  'capital_social',
  'certificado_digital',
] as const
export type FatorScore = (typeof FATORES_SCORE)[number]

export const FATOR_SCORE_LABELS: Record<FatorScore, string> = {
  protestos: 'Protestos',
  faturamento: 'Faturamento / porte',
  atividade_grupo: 'Atividade do grupo',
  idade: 'Idade da empresa',
  regularidade: 'Regularidade cadastral',
  historico_analises: 'Histórico de análises',
  crescimento_headcount: 'Crescimento de equipe (12m)',
  capital_social: 'Capital social',
  certificado_digital: 'Certificado digital',
}

export const FAIXAS_SCORE = ['alta', 'media', 'improvavel', 'dados_insuficientes'] as const
export type FaixaScore = (typeof FAIXAS_SCORE)[number]

export const FAIXA_SCORE_LABELS: Record<FaixaScore, string> = {
  alta: 'Alta',
  media: 'Média',
  improvavel: 'Improvável',
  dados_insuficientes: 'Dados insuficientes',
}

export type Knockout = 'situacao_irregular' | 'negada_recente'

export const KNOCKOUT_LABELS: Record<Knockout, string> = {
  situacao_irregular: 'Situação cadastral irregular',
  negada_recente: 'Análise negada recentemente',
}

// ─── A definição versionada ─────────────────────────────────────────────────

/** Limite SUPERIOR inclusive. `ate: null` fecha o intervalo aberto à direita. */
export interface FaixaPontos {
  ate: number | null
  pontos: number
}

export interface FatorNumerico {
  peso: number
  faixas: FaixaPontos[]
  /** Só `protestos`: divide os pontos quando o protesto é recente. */
  recencia_divisor?: number
}

export interface FatorCategorico {
  peso: number
  casos: Record<string, number>
}

export type DefinicaoFator = FatorNumerico | FatorCategorico

export interface DefinicaoScorecard {
  fatores: Partial<Record<FatorScore, DefinicaoFator>>
}

function ehNumerico(f: DefinicaoFator): f is FatorNumerico {
  return Array.isArray((f as FatorNumerico).faixas)
}

/**
 * Os pontos da primeira faixa cujo limite superior alcança o valor. As faixas são
 * percorridas na ordem em que foram salvas — a UI as mantém ordenadas, e uma reordenação
 * silenciosa aqui esconderia uma definição mal salva em vez de deixá-la aparecer.
 */
export function pontosDaFaixa(valor: number, faixas: readonly FaixaPontos[]): number | null {
  for (const f of faixas) {
    if (f.ate === null || valor <= f.ate) return f.pontos
  }
  return null
}

// ─── Os sinais que entram ───────────────────────────────────────────────────

export interface SinaisScore {
  /** Consulta de protesto JÁ FEITA. `false` → o fator não é avaliável (não é "sem protesto"). */
  protesto_consultado?: boolean
  protesto_valor_total?: number | null
  protesto_mais_recente_em?: string | null
  faturamento_estimado?: number | null
  capital_social?: number | null
  /** Fallback do denominador do ratio de protesto quando não há faturamento. */
  data_inicio_atividade?: string | null
  situacao_cadastral?: string | null
  /** Já esteve suspensa/inapta alguma vez. */
  teve_irregularidade?: boolean | null
  grupo_spes_24m?: number | null
  obras_ativas?: number | null
  m2_em_execucao?: number | null
  /** Se os dois vierem null, o fator de atividade não é avaliável. */
  grupo_conhecido?: boolean
  funcionarios_crescimento_12m?: number | null
  /** Estado da análise mais recente, quando existe. */
  analise_estagio?: string | null
  analise_vigente?: boolean
  analise_negada_em?: string | null
  certificado?: 'ativo' | 'vencido' | 'nunca' | null
}

export interface ParametrosScore {
  corte_concessao: number
  completude_minima: number
  recencia_protesto_dias: number
  knockout_negada_meses: number
}

export interface FatorAvaliado {
  fator: FatorScore
  label: string
  /** null quando o fator não é avaliável — e é isso que o tira da conta. */
  pontos: number | null
  peso: number
  /** O que foi observado, em texto legível. É o que a Company 360 mostra. */
  observado: string
  /** Marcado quando o ratio de protesto caiu no fallback (capital) ou em faixa absoluta. */
  ressalva?: string
}

export interface ResultadoScore {
  score: number | null
  completude: number
  faixa: FaixaScore
  knockout: Knockout | null
  breakdown: FatorAvaliado[]
}

// ─── Avaliadores, um por fator ──────────────────────────────────────────────

const DIA_MS = 86_400_000

function anosDesde(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (agora.getTime() - t) / (365.25 * DIA_MS)
}

function diasDesde(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (agora.getTime() - t) / DIA_MS
}

/**
 * Protesto RELATIVIZADO: R$ 80 mil de protesto numa empresa que fatura R$ 2 milhões e
 * numa que fatura R$ 500 milhões são fatos diferentes, e o valor absoluto não distingue
 * os dois. O denominador preferido é o faturamento; sem ele, o capital social — que é
 * pior e por isso vai marcado no breakdown, para ninguém comparar dois scores como se
 * tivessem sido medidos com a mesma régua.
 */
function avaliarProtestos(
  s: SinaisScore,
  def: FatorNumerico,
  p: ParametrosScore,
  agora: Date,
): { pontos: number | null; observado: string; ressalva?: string } {
  if (!s.protesto_consultado) {
    return { pontos: null, observado: 'Protesto nunca consultado' }
  }

  const valor = Number(s.protesto_valor_total ?? 0)
  if (!(valor > 0)) {
    return { pontos: pontosDaFaixa(0, def.faixas), observado: 'Sem protestos' }
  }

  const faturamento = Number(s.faturamento_estimado ?? 0)
  const capital = Number(s.capital_social ?? 0)
  const base = faturamento > 0 ? faturamento : capital
  const denominador = faturamento > 0 ? 'faturamento' : capital > 0 ? 'capital social' : null

  if (denominador === null) {
    // Sem base para relativizar, o valor absoluto ainda diz alguma coisa — mas diz
    // menos, e o breakdown precisa carregar isso junto com o número.
    const pontos = valor > 100_000 ? 0 : valor > 10_000 ? 5 : 15
    return {
      pontos,
      observado: `R$ ${Math.round(valor).toLocaleString('pt-BR')} em protestos`,
      ressalva: 'Sem faturamento nem capital para relativizar — faixa absoluta',
    }
  }

  const ratio = valor / base
  let pontos = pontosDaFaixa(ratio, def.faixas) ?? 0

  const dias = diasDesde(s.protesto_mais_recente_em, agora)
  const recente = dias !== null && dias < p.recencia_protesto_dias
  if (recente && def.recencia_divisor && def.recencia_divisor > 0) {
    pontos = pontos / def.recencia_divisor
  }

  return {
    pontos,
    observado:
      `R$ ${Math.round(valor).toLocaleString('pt-BR')} (${(ratio * 100).toFixed(2)}% do ${denominador})` +
      (recente ? ` · protesto recente, pontos ÷ ${def.recencia_divisor}` : ''),
    ressalva: faturamento > 0 ? undefined : 'Relativizado pelo capital social, não pelo faturamento',
  }
}

function avaliarAtividadeGrupo(
  s: SinaisScore,
  def: FatorCategorico,
): { pontos: number | null; observado: string } {
  const spes = s.grupo_spes_24m ?? null
  const obras = s.obras_ativas ?? null
  const m2 = s.m2_em_execucao ?? null

  // Sem NENHUM dos três conhecidos, o fator não é avaliável. Zero obras numa base que
  // nunca ingeriu CNO é ausência de dado, não ausência de obra.
  if (!s.grupo_conhecido && spes === null && obras === null && m2 === null) {
    return { pontos: null, observado: 'Grupo e obras desconhecidos' }
  }

  const forte = (spes ?? 0) >= 2 || (obras ?? 0) >= 2 || (m2 ?? 0) >= 10_000
  const fraca = (spes ?? 0) >= 1 || (obras ?? 0) >= 1 || (m2 ?? 0) > 0

  const caso = forte ? 'forte' : fraca ? 'fraca' : 'zerada'
  return {
    pontos: def.casos[caso] ?? null,
    observado: `${spes ?? 0} SPE(s) em 24m · ${obras ?? 0} obra(s) ativa(s) · ${Math.round(m2 ?? 0).toLocaleString('pt-BR')} m²`,
  }
}

function avaliarHistorico(
  s: SinaisScore,
  def: FatorCategorico,
): { pontos: number | null; observado: string } {
  const estagio = s.analise_estagio ?? null
  if (!estagio) return { pontos: def.casos.nunca ?? null, observado: 'Nunca analisada' }
  if (estagio === 'aprovada_parcial') {
    return { pontos: def.casos.aprovada_parcial ?? null, observado: 'Aprovada parcial' }
  }
  if (estagio === 'aprovada') {
    return s.analise_vigente
      ? { pontos: def.casos.aprovada_vigente ?? null, observado: 'Aprovada e vigente' }
      : { pontos: def.casos.aprovada_expirada ?? null, observado: 'Aprovada, já expirada' }
  }
  // `negada` vira knockout, não pontuação. Estágios em andamento ainda não são
  // histórico: uma análise em curso não diz nada sobre o resultado dela.
  return { pontos: def.casos.nunca ?? null, observado: 'Sem decisão anterior' }
}

// ─── O cálculo ──────────────────────────────────────────────────────────────

/**
 * `agora` é injetado para o teste poder fixar o tempo: recência de protesto e janela de
 * knockout são as duas coisas que mudariam de resposta amanhã sem ninguém tocar no código.
 */
export function calcularScore(
  sinais: SinaisScore,
  definicao: DefinicaoScorecard,
  params: ParametrosScore,
  agora: Date = new Date(),
): ResultadoScore {
  const breakdown: FatorAvaliado[] = []

  const push = (
    fator: FatorScore,
    peso: number,
    r: { pontos: number | null; observado: string; ressalva?: string },
  ) => {
    breakdown.push({
      fator,
      label: FATOR_SCORE_LABELS[fator],
      pontos: r.pontos,
      peso,
      observado: r.observado,
      ...(r.ressalva ? { ressalva: r.ressalva } : {}),
    })
  }

  const f = definicao.fatores

  if (f.protestos && ehNumerico(f.protestos)) {
    push('protestos', f.protestos.peso, avaliarProtestos(sinais, f.protestos, params, agora))
  }

  if (f.faturamento && ehNumerico(f.faturamento)) {
    const v = sinais.faturamento_estimado ?? null
    push('faturamento', f.faturamento.peso, {
      pontos: v === null ? null : pontosDaFaixa(v, f.faturamento.faixas),
      observado: v === null ? 'Sem estimativa de faturamento' : `R$ ${Math.round(v).toLocaleString('pt-BR')}`,
    })
  }

  if (f.atividade_grupo && !ehNumerico(f.atividade_grupo)) {
    push('atividade_grupo', f.atividade_grupo.peso, avaliarAtividadeGrupo(sinais, f.atividade_grupo))
  }

  if (f.idade && ehNumerico(f.idade)) {
    const anos = anosDesde(sinais.data_inicio_atividade, agora)
    push('idade', f.idade.peso, {
      pontos: anos === null ? null : pontosDaFaixa(anos, f.idade.faixas),
      observado: anos === null ? 'Data de abertura desconhecida' : `${Math.floor(anos)} ano(s)`,
    })
  }

  if (f.regularidade && !ehNumerico(f.regularidade)) {
    const sit = sinais.situacao_cadastral ?? null
    push('regularidade', f.regularidade.peso, {
      pontos:
        sit === null
          ? null
          : sinais.teve_irregularidade
            ? (f.regularidade.casos.com_historico ?? null)
            : (f.regularidade.casos.limpa ?? null),
      observado:
        sit === null
          ? 'Situação cadastral desconhecida'
          : sinais.teve_irregularidade
            ? `${sit} (com histórico de irregularidade)`
            : String(sit),
    })
  }

  if (f.historico_analises && !ehNumerico(f.historico_analises)) {
    push('historico_analises', f.historico_analises.peso, avaliarHistorico(sinais, f.historico_analises))
  }

  if (f.crescimento_headcount && ehNumerico(f.crescimento_headcount)) {
    const c = sinais.funcionarios_crescimento_12m ?? null
    push('crescimento_headcount', f.crescimento_headcount.peso, {
      pontos: c === null ? null : pontosDaFaixa(c, f.crescimento_headcount.faixas),
      observado: c === null ? 'Sem série de headcount' : `${(c * 100).toFixed(0)}% em 12 meses`,
    })
  }

  if (f.capital_social && ehNumerico(f.capital_social)) {
    const cap = sinais.capital_social ?? null
    push('capital_social', f.capital_social.peso, {
      pontos: cap === null ? null : pontosDaFaixa(cap, f.capital_social.faixas),
      observado: cap === null ? 'Capital social desconhecido' : `R$ ${Math.round(cap).toLocaleString('pt-BR')}`,
    })
  }

  if (f.certificado_digital && !ehNumerico(f.certificado_digital)) {
    const c = sinais.certificado ?? null
    push('certificado_digital', f.certificado_digital.peso, {
      pontos: c === null ? null : (f.certificado_digital.casos[c] ?? null),
      observado: c === null ? 'Sem informação de certificado' : c,
    })
  }

  // ── Renormalização ──
  const avaliaveis = breakdown.filter((b) => b.pontos !== null)
  const pesoTotal = breakdown.reduce((s, b) => s + b.peso, 0)
  const pesoAvaliavel = avaliaveis.reduce((s, b) => s + b.peso, 0)
  const completude = pesoTotal > 0 ? pesoAvaliavel / pesoTotal : 0

  // ── Knockouts ──
  // Vêm ANTES do corte de completude: uma empresa baixada na Receita é improvável mesmo
  // que não se saiba mais nada sobre ela. "Não sei" não apaga o que se sabe.
  const situacao = (sinais.situacao_cadastral ?? '').toLowerCase()
  if (situacao && situacao !== 'ativa') {
    return {
      score: 0,
      completude,
      faixa: 'improvavel',
      knockout: 'situacao_irregular',
      breakdown,
    }
  }

  if (completude < params.completude_minima) {
    return { score: null, completude, faixa: 'dados_insuficientes', knockout: null, breakdown }
  }

  const obtidos = avaliaveis.reduce((s, b) => s + (b.pontos as number), 0)
  let score = pesoAvaliavel > 0 ? (obtidos / pesoAvaliavel) * 100 : 0

  // Negada recente não zera: trava abaixo do corte. A diferença importa — uma empresa
  // negada há cinco meses que melhorou em tudo o mais volta a subir assim que a janela
  // passa, e zerá-la apagaria a informação que a faria voltar.
  let knockout: Knockout | null = null
  const diasNegada = diasDesde(sinais.analise_negada_em, agora)
  if (diasNegada !== null && diasNegada <= params.knockout_negada_meses * 30.44) {
    knockout = 'negada_recente'
    score = Math.min(score, params.corte_concessao - 10)
  }

  const faixa: FaixaScore = score >= 65 ? 'alta' : score >= params.corte_concessao ? 'media' : 'improvavel'

  return { score: Math.round(score * 100) / 100, completude, faixa, knockout, breakdown }
}

/** FaixaPontos → probabilidade. É o que transforma um score numa multiplicação de reais. */
export function chanceDaFaixa(
  faixa: FaixaScore,
  chancePorFaixa: Record<string, number>,
  chanceSemScore: number,
): { chance: number; presumida: boolean } {
  if (faixa === 'dados_insuficientes') return { chance: chanceSemScore, presumida: true }
  const c = chancePorFaixa[faixa]
  return typeof c === 'number' ? { chance: c, presumida: false } : { chance: chanceSemScore, presumida: true }
}
