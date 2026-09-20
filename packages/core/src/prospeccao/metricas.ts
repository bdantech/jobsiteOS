/**
 * O agregador sacado × fornecedor do funil de Sacados por NF (04r §4).
 *
 * A conta mora aqui, e não só no SQL do job, porque os mesmos números aparecem em
 * quatro lugares: o job que grava, o card da web, o card do mobile e a tool de IA que
 * responde "quanto vale este sacado?". Quatro divisões por seis é como o card diz R$
 * 180 mil e a IA diz R$ 200 mil sobre o mesmo CNPJ.
 *
 * ─── AS DUAS MEDIDAS QUE FAZEM A FEATURE FUNCIONAR ──────────────────────────
 *
 * `volume_30d` é a EVIDÊNCIA: existe fluxo comercial entre este fornecedor nosso e
 * esta construtora, e nós o vimos, não o inferimos.
 *
 * `valor_operavel` é o que SOBRA depois da esteira. Medido na base em 20/09/2026: das
 * 1.425 notas da janela, a mediana tem 12 dias até o vencimento, e de R$ 60,1 milhões
 * emitidos em 30 dias apenas R$ 436 mil ainda teriam mais de 55 dias de vida. Sem os
 * dois números lado a lado, o originador trabalha um card de R$ 900 mil por duas
 * semanas e descobre no fim que não sobrou nota nenhuma para operar.
 *
 * É por isso também que a ORDENAÇÃO não é pelo volume de 30 dias: o que se compra ao
 * aprovar um limite é o fluxo FUTURO, e o snapshot de um mês premia o pico. A média
 * de seis meses vezes a chance de concessão é o que responde "quanto isto passa a
 * render por mês se destravar".
 */

/** A margem que a casa tira de cada real operado, em fração (0,0375 = 3,75%). */
export interface ParametrosMargem {
  /** `credito_config.economia.taxa_padrao_am`, em % ao mês. */
  taxa_padrao_am: number
  /** `credito_config.economia.prazo_medio_dias`. */
  prazo_medio_dias: number
  /** `credito_config.economia.tac`, em reais por nota. */
  tac: number
  /** `credito_config.economia.valor_medio_nf`, em reais. */
  valor_medio_nf: number
}

export interface NotaDoSacado {
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  valor: number
  /** YYYY-MM-DD. */
  emitida_em: string | null
  /** YYYY-MM-DD. */
  vencimento: string | null
  /**
   * Dias entre HOJE e o vencimento, como o endpoint da Onepay devolve. Quando ausente,
   * é derivado de `vencimento`. Ele é o número certo para a pergunta de operabilidade:
   * o que importa é quanto de vida a nota ainda tem, não quanto ela tinha quando foi
   * emitida.
   */
  dias_para_vencimento?: number | null
}

export interface MetricasFornecedor {
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  valor_30d: number
  valor_operavel: number
  qtd_nfs_30d: number
  meses_com_emissao_6m: number
  media_mensal_6m: number
  ultima_nf_em: string | null
  /**
   * Só vem preenchido quando o chamador informa a carteira — o job informa, a tool de
   * IA não. `undefined` é "não perguntei", e é diferente de `false`, que é "perguntei
   * e não está". A tela não pode pintar o selo de carteira a partir de um silêncio.
   */
  na_carteira_do_originador?: boolean
}

export interface MetricasSacado {
  volume_30d: number
  valor_operavel: number
  qtd_nfs_30d: number
  qtd_fornecedores: number
  meses_com_emissao_6m: number
  media_mensal_6m: number
  /** Média ponderada por valor de (vencimento − emissão) na janela de recorrência. */
  prazo_medio_dias: number | null
  ultima_nf_em: string | null
  fornecedores: MetricasFornecedor[]
}

export interface OpcoesAgregacao {
  hoje?: Date
  /** `prospeccao_config.janela_emissao_dias`. Default 30. */
  janelaEmissaoDias?: number
  /** `prospeccao_config.janela_recorrencia_meses`. Default 6. */
  janelaRecorrenciaMeses?: number
  /**
   * `tempo_medio_esteira + margem_prazo_dias`. Uma nota só é operável se ainda tiver
   * MAIS que isto de vida — no dia em que o limite sair, ela precisa existir.
   */
  prazoMinimoOperavel: number
  /** CNPJs de fornecedores que já estão na carteira de originação de quem vê o card. */
  carteiraDoOriginador?: ReadonlySet<string>
}

const DIA = 86_400_000

function dias(de: string, ate: string): number | null {
  const a = Date.parse(`${de}T00:00:00Z`)
  const b = Date.parse(`${ate}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / DIA)
}

function centavos(v: number): number {
  return Math.round(v * 100) / 100
}

/** `YYYY-MM-DD` → `YYYY-MM`. A competência da recorrência é o MÊS CIVIL da emissão. */
function competencia(dia: string): string {
  return dia.slice(0, 7)
}

/**
 * Quantos meses da janela ainda contam, dado `hoje`.
 *
 * Seis meses civis ATRÁS do mês corrente, mais o corrente. A alternativa — 180 dias
 * corridos — partiria meses ao meio e faria "5 dos últimos 6 meses" significar coisas
 * diferentes conforme o dia em que a tela fosse aberta.
 */
function corteRecorrencia(hoje: Date, meses: number): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - (meses - 1), 1))
  return d.toISOString().slice(0, 7)
}

interface Acumulador {
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  valor_30d: number
  valor_operavel: number
  qtd_nfs_30d: number
  volume_6m: number
  meses: Set<string>
  ultima_nf_em: string | null
}

function novoAcumulador(cnpj: string, nome: string | null): Acumulador {
  return {
    fornecedor_cnpj: cnpj,
    fornecedor_nome: nome,
    valor_30d: 0,
    valor_operavel: 0,
    qtd_nfs_30d: 0,
    volume_6m: 0,
    meses: new Set<string>(),
    ultima_nf_em: null,
  }
}

/**
 * Agrega as notas de UM sacado — o total e a quebra por fornecedor, numa passada só.
 *
 * As notas que chegam já vêm filtradas por "fornecedor seguido pelo originador" (§2):
 * o agregador não conhece essa regra, e não deve. Um fornecedor que deixa de ser
 * seguido some da lista de entrada e, na rodada seguinte, some da quebra e do total —
 * é a mesma passada que produz os dois, então eles não têm como discordar.
 */
export function agregarSacado(
  notas: readonly NotaDoSacado[],
  opcoes: OpcoesAgregacao,
): MetricasSacado {
  const hoje = opcoes.hoje ?? new Date()
  const janelaDias = opcoes.janelaEmissaoDias ?? 30
  const janelaMeses = opcoes.janelaRecorrenciaMeses ?? 6
  const corte30 = new Date(hoje.getTime() - janelaDias * DIA).toISOString().slice(0, 10)
  const corteMes = corteRecorrencia(hoje, janelaMeses)

  const porFornecedor = new Map<string, Acumulador>()
  let somaPrazoPonderada = 0
  let pesoPrazo = 0
  let ultimaGeral: string | null = null

  for (const n of notas) {
    const dia = n.emitida_em?.slice(0, 10) ?? null
    if (!dia) continue

    const acc = porFornecedor.get(n.fornecedor_cnpj) ?? novoAcumulador(n.fornecedor_cnpj, n.fornecedor_nome)
    if (!acc.fornecedor_nome && n.fornecedor_nome) acc.fornecedor_nome = n.fornecedor_nome
    porFornecedor.set(n.fornecedor_cnpj, acc)

    // `ultima_nf_em` olha a janela INTEIRA que chegou, não os 30 dias: ela é o sinal
    // de vida do relacionamento, e um card que esfriou precisa mostrar quando esfriou.
    if (!acc.ultima_nf_em || dia > acc.ultima_nf_em) acc.ultima_nf_em = dia
    if (!ultimaGeral || dia > ultimaGeral) ultimaGeral = dia

    const valor = Number(n.valor) || 0

    if (competencia(dia) >= corteMes) {
      acc.volume_6m += valor
      acc.meses.add(competencia(dia))

      if (n.vencimento) {
        const d = dias(dia, n.vencimento.slice(0, 10))
        // Prazo negativo é nota vencida antes de emitida — dado corrompido, não um
        // prazo de zero dia. Entra no volume e fica fora da média.
        if (d !== null && d >= 0 && d <= 365) {
          somaPrazoPonderada += d * valor
          pesoPrazo += valor
        }
      }
    }

    if (dia < corte30) continue

    acc.valor_30d += valor
    acc.qtd_nfs_30d += 1

    /*
     * A OPERABILIDADE É MEDIDA CONTRA HOJE, não contra a emissão.
     *
     * Uma nota de 90 dias emitida há 80 tem dez de vida: ela não sobrevive à análise de
     * um sacado novo. Usar o prazo original faria o card prometer um valor que já
     * evaporou — e é exatamente esse o engano que a coluna existe para impedir.
     */
    const restam =
      n.dias_para_vencimento ?? (n.vencimento ? dias(hoje.toISOString().slice(0, 10), n.vencimento.slice(0, 10)) : null)
    // Nota sem vencimento não é nota operável: "não sabemos" não pode contar como sim
    // numa coluna que existe para evitar promessa.
    if (restam !== null && restam > opcoes.prazoMinimoOperavel) acc.valor_operavel += valor
  }

  const carteira = opcoes.carteiraDoOriginador
  const fornecedores: MetricasFornecedor[] = [...porFornecedor.values()]
    .map((a) => ({
      fornecedor_cnpj: a.fornecedor_cnpj,
      fornecedor_nome: a.fornecedor_nome,
      valor_30d: centavos(a.valor_30d),
      valor_operavel: centavos(a.valor_operavel),
      qtd_nfs_30d: a.qtd_nfs_30d,
      meses_com_emissao_6m: a.meses.size,
      // Dividido pela JANELA, não pelos meses em que houve emissão. Dividir pelos meses
      // com nota transformaria um pico único em "R$ 900 mil por mês", que é o número
      // que faria o originador trabalhar a lista na ordem errada.
      media_mensal_6m: centavos(a.volume_6m / janelaMeses),
      ultima_nf_em: a.ultima_nf_em,
      ...(carteira ? { na_carteira_do_originador: carteira.has(a.fornecedor_cnpj) } : {}),
    }))
    .sort((a, b) => b.valor_30d - a.valor_30d || b.media_mensal_6m - a.media_mensal_6m)

  const volume30 = fornecedores.reduce((s, f) => s + f.valor_30d, 0)
  const operavel = fornecedores.reduce((s, f) => s + f.valor_operavel, 0)
  const qtd30 = fornecedores.reduce((s, f) => s + f.qtd_nfs_30d, 0)
  const volume6m = [...porFornecedor.values()].reduce((s, a) => s + a.volume_6m, 0)
  const mesesSacado = new Set<string>()
  for (const a of porFornecedor.values()) for (const m of a.meses) mesesSacado.add(m)

  return {
    volume_30d: centavos(volume30),
    valor_operavel: centavos(operavel),
    qtd_nfs_30d: qtd30,
    // Só conta como fornecedor do card quem emitiu NA JANELA DE 30 DIAS: a quebra
    // mostra o histórico, mas "3 fornecedores" precisa querer dizer "três estão
    // faturando agora", que é o que sustenta a abordagem.
    qtd_fornecedores: fornecedores.filter((f) => f.qtd_nfs_30d > 0).length,
    meses_com_emissao_6m: mesesSacado.size,
    media_mensal_6m: centavos(volume6m / janelaMeses),
    prazo_medio_dias: pesoPrazo > 0 ? Math.round(somaPrazoPonderada / pesoPrazo) : null,
    ultima_nf_em: ultimaGeral,
    fornecedores,
  }
}

/**
 * A margem por real operado, derivada dos MESMOS parâmetros que precificam o potencial
 * do sacado em 04c/04o.
 *
 * `taxa/100 × prazo/30` é a receita financeira de uma operação que fica de pé pelo
 * prazo médio; o segundo termo é a TAC diluída pelo ticket médio. Uma constante
 * chutada aqui faria a ordenação deste funil discordar da do Crédito sobre qual
 * sacado vale mais — e as duas telas estão a dois cliques uma da outra.
 */
export function margemEstimada(p: ParametrosMargem): number {
  const taxa = Number(p.taxa_padrao_am) || 0
  const prazo = Number(p.prazo_medio_dias) || 0
  const tac = Number(p.tac) || 0
  const ticket = Number(p.valor_medio_nf) || 0
  const financeira = (taxa / 100) * (prazo / 30)
  const porTac = ticket > 0 ? tac / ticket : 0
  return financeira + porTac
}

/**
 * `valor_esperado_mensal = média mensal (6m) × chance de concessão × margem` (§4).
 *
 * É o número da ORDENAÇÃO DEFAULT, e cada fator responde a uma pergunta diferente:
 * quanto fluxo existe de verdade, qual a probabilidade de a esteira destravá-lo, e
 * quanto disso é nosso. Ordenar pelo volume de 30 dias responderia só à primeira, e
 * premiaria o pico de uma obra que acabou.
 *
 * Sem chance calculada a conta usa o default do scorecard (`chance_sem_score`, hoje
 * 0,5) — passado pelo chamador. Devolver `null` aqui jogaria para o fim da fila
 * justamente os CNPJs de que menos se sabe, que não é o mesmo que os que menos valem.
 */
export function valorEsperadoMensal(
  mediaMensal6m: number | null | undefined,
  chanceConcessao: number | null | undefined,
  margem: number,
): number {
  const media = Number(mediaMensal6m) || 0
  const chance = Number(chanceConcessao)
  const c = Number.isFinite(chance) && chance > 0 ? chance : 0
  return centavos(media * c * margem)
}

/**
 * Entra no funil? (§4)
 *
 * Duas condições, e as duas são de ENTRADA — não de permanência. Um sacado que entrou
 * e esfriou não é removido: `ultima_nf_em` já diz que ele esfriou, e um card apagado
 * levaria junto o estágio, o dono e a análise que alguém já pediu.
 *
 * Medido em 20/09/2026: sem corte são 886 sacados; com o corte de R$ 30 mil, 243. A
 * diferença não é conveniência — 643 construtoras que receberam uma nota de R$ 4 mil
 * não são um funil de aquisição, são a lista de destinatários.
 */
export function entraNaProspeccao(
  m: Pick<MetricasSacado, 'volume_30d' | 'qtd_nfs_30d'>,
  corteVolume: number,
): boolean {
  return m.qtd_nfs_30d > 0 && m.volume_30d >= corteVolume
}

/**
 * O prazo mínimo para uma nota ser considerada operável: o tempo que a esteira leva,
 * mais a margem de segurança.
 *
 * O tempo de esteira é MEDIDO (04d), mas só quando há amostra: com 7 análises
 * decididas em 20/09/2026, a mediana medida é de horas — e um mínimo de "horas"
 * marcaria como operável toda nota que vence amanhã. Abaixo da base mínima a conta cai
 * no default de configuração, e a tela diz qual dos dois entrou.
 */
export function prazoMinimoOperavel(
  medido: { dias: number | null; base: number },
  config: { tempo_esteira_dias: number; margem_prazo_dias: number; esteira_base_minima: number },
): { dias: number; origem: 'medido' | 'configurado' } {
  const usaMedido =
    medido.dias !== null && Number.isFinite(medido.dias) && medido.base >= config.esteira_base_minima
  const esteira = usaMedido ? Math.round(medido.dias as number) : config.tempo_esteira_dias
  return { dias: esteira + config.margem_prazo_dias, origem: usaMedido ? 'medido' : 'configurado' }
}
