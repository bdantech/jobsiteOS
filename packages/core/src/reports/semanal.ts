/**
 * O Report Semanal Executivo (04q) — a estrutura única.
 *
 * A aba, o PDF e o corpo do e-mail consomem EXATAMENTE o que está aqui, e nenhum dos três
 * recalcula nada. Um número que aparece na tela e outro no anexo, os dois "corretos" por
 * réguas diferentes, é o jeito mais rápido de o report deixar de ser levado a sério — e
 * quem descobre a divergência é sempre a pessoa para quem ele foi feito.
 *
 * Os números vêm prontos de `app_report_semanal()` no banco. O que mora AQUI é o que se
 * deriva deles e precisa ser idêntico nas três superfícies: a direção de cada variação, o
 * maior vazamento do funil, o texto da régua, e o resumo numérico que vai para o modelo.
 */

// ─── A régua de três janelas (§1) ───────────────────────────────────────────

/*
 * `IndicadorReport`, e não `Indicador`: o módulo de Crédito já exporta um `Indicador` (os
 * indicadores do balanço), e `@jobsiteos/core` é um barril só. Dois tipos com o mesmo nome
 * ali dentro não é estilo — é erro de compilação, e o TS aponta no `index.ts`, longe de
 * quem o causou. Mesma razão para `DirecaoReport` (Comunicação tem `Direcao`) e
 * `FotoReport`.
 */
export interface IndicadorReport {
  metrica: string
  unidade: 'brl' | 'unidades' | 'dias' | 'pct'
  /** Verdadeiro nas métricas em que CRESCER é ruim: expirado, ocioso, no-show, travadas. */
  subir_e_pior: boolean
  semana: number
  mes: number
  doze_total: number
  doze_media_mensal: number | null
  doze_media_semanal: number | null
  /**
   * Quantos meses da janela têm dado. A média é sobre ELES, e não sobre doze.
   *
   * A operação começou em julho de 2026: dividir por doze diluiria tudo por nove meses em
   * que a empresa não existia, e toda semana apareceria como "180% acima da média" — o
   * indicador viraria um elogio automático, que é o oposto de uma régua.
   */
  meses_com_dado: number
  var_semana_pct: number | null
  var_mes_pct: number | null
}

/**
 * `FotoReport` é um ESTOQUE: um valor que existe a cada instante, não um fluxo que se soma
 * ao longo da janela. Limite ocioso é o caso — ele não tem "o da semana passada", ele tem
 * "o de tal dia".
 *
 * Por isso `em`: sem a data, o mesmo campo carregava o saldo do fim da semana no PDF e o
 * saldo de agora na tela, e nada na página dizia qual era qual. Os dois estão certos; o
 * que não pode é o leitor ter de adivinhar.
 */
export interface FotoReport {
  metrica: string
  unidade: 'brl' | 'unidades'
  subir_e_pior: boolean
  foto: number
  /** O dia em que o estoque foi lido: fim da janela no PDF, hoje na tela. */
  em: string
  sem_serie: true
}

export type DirecaoReport = 'melhor' | 'pior' | 'neutro' | 'sem_regua'

/**
 * O que a variação SIGNIFICA, que não é o mesmo que o sinal dela.
 *
 * Metade dos indicadores do report é ruim quando cresce. Sem isto a tela pintaria de verde
 * uma alta de 40% em valor que expirou sem ninguém tocar, e quem lê rápido — que é para
 * quem o report existe — leria exatamente o contrário do que aconteceu.
 */
export function direcaoDa(variacao: number | null, subirEPior: boolean): DirecaoReport {
  if (variacao === null || !Number.isFinite(variacao)) return 'sem_regua'
  if (Math.abs(variacao) < 1) return 'neutro'
  const subiu = variacao > 0
  return subiu === subirEPior ? 'pior' : 'melhor'
}

/** O texto da régua: "média de 3 meses" e não "média de 12 meses" quando são três. */
export function textoDaRegua(ind: Pick<IndicadorReport, 'meses_com_dado'>): string {
  if (ind.meses_com_dado <= 0) return 'sem base de comparação'
  if (ind.meses_com_dado === 1) return 'média de 1 mês'
  return `média de ${ind.meses_com_dado} meses`
}

/**
 * O mês corrente é PARCIAL, e comparar seis dias com a média de um mês inteiro sempre dá
 * negativo. O ritmo projeta o parcial para o mês fechado — é a única comparação honesta
 * entre um pedaço e um todo.
 */
export function ritmoDoMes(valorParcial: number, diasDecorridos: number, diasTotal: number): number | null {
  if (!(diasDecorridos > 0) || !(diasTotal > 0)) return null
  return (valorParcial / diasDecorridos) * diasTotal
}

// ─── O funil (§2) ───────────────────────────────────────────────────────────

export const ETAPAS_FUNIL = [
  'distribuidos', 'contatados', 'com_fit', 'agendados', 'realizados', 'ganhos',
] as const
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number]

export const ETAPA_FUNIL_LABELS: Record<EtapaFunil, string> = {
  distribuidos: 'Distribuídos',
  contatados: 'Contatados',
  com_fit: 'Com fit',
  agendados: 'Agendados',
  realizados: 'Realizados',
  ganhos: 'Ganhos',
}

export interface JanelaFunil {
  distribuidos: number
  contatados: number
  com_fit: number
  agendados: number
  realizados: number
  ganhos: number
  passagem: {
    contato_pct: number | null
    fit_pct: number | null
    agenda_pct: number | null
    realiza_pct: number | null
    ganho_pct: number | null
  }
}

export interface Vazamento {
  de: EtapaFunil
  para: EtapaFunil
  /** Taxa de passagem da semana, em %. */
  passagem_pct: number
  /** A mesma taxa nos 12 meses, para dizer se o vazamento é novo ou crônico. */
  passagem_12m_pct: number | null
  /** Quantos itens se perderam nesta passagem, na semana. */
  perdidos: number
}

const PASSOS: { de: EtapaFunil; para: EtapaFunil; chave: keyof JanelaFunil['passagem'] }[] = [
  { de: 'distribuidos', para: 'contatados', chave: 'contato_pct' },
  { de: 'contatados', para: 'com_fit', chave: 'fit_pct' },
  { de: 'com_fit', para: 'agendados', chave: 'agenda_pct' },
  { de: 'agendados', para: 'realizados', chave: 'realiza_pct' },
  { de: 'realizados', para: 'ganhos', chave: 'ganho_pct' },
]

/**
 * O MAIOR VAZAMENTO da semana: a passagem que mais perdeu gente em número absoluto.
 *
 * Em número, e não na menor taxa percentual: uma passagem de 0% sobre um item perdido é
 * matematicamente pior e operacionalmente irrelevante, enquanto 60% sobre cinquenta são
 * vinte pessoas que ninguém tocou. O report existe para dizer onde AGIR.
 *
 * Passagem sem denominador (ninguém chegou àquela etapa) é ignorada: não há vazamento onde
 * não passou água.
 */
export function maiorVazamento(semana: JanelaFunil, doze?: JanelaFunil): Vazamento | null {
  let pior: Vazamento | null = null
  for (const passo of PASSOS) {
    const entrou = semana[passo.de]
    const saiu = semana[passo.para]
    if (!(entrou > 0)) continue
    const perdidos = entrou - saiu
    if (perdidos <= 0) continue
    const cand: Vazamento = {
      de: passo.de,
      para: passo.para,
      passagem_pct: Math.round((saiu / entrou) * 1000) / 10,
      passagem_12m_pct: doze?.passagem[passo.chave] ?? null,
      perdidos,
    }
    if (!pior || cand.perdidos > pior.perdidos) pior = cand
  }
  return pior
}

// ─── A estrutura completa ───────────────────────────────────────────────────

export interface PeriodoReport {
  inicio: string
  fim: string
  semana_iso: number
  ano: number
  mes_inicio: string
  mes_dias_decorridos: number
  mes_dias_total: number
  base_12m_de: string
  base_12m_ate: string
  /**
   * O dia em que os ESTOQUES foram lidos — carteira, filas, travadas, cobertura.
   *
   * Os FLUXOS (VOP, volume, receita, operações, comissão, leads, decisões de crédito) são
   * sempre de `inicio`..`fim` e não dependem disto: a data do evento não muda conforme o
   * momento da pergunta. `retrato_em` é o que separa as duas leituras da MESMA janela — o
   * PDF congela em `fim`, a tela lê hoje.
   */
  retrato_em: string
  /** De que captura veio a carteira. Pode não ser `retrato_em` se o sync falhou no dia. */
  retrato_carteira_em: string
  /** `true` quando os estoques são de hoje e não do fim da janela. */
  ao_vivo: boolean
  gerado_em: string
}

export interface ItemLista {
  [chave: string]: unknown
}

export interface ReportSemanal {
  periodo: PeriodoReport
  operacao: {
    kpis: {
      volume_convertido: IndicadorReport
      vop_operado: IndicadorReport
      receita: IndicadorReport
      limite_ocioso: FotoReport
    }
    antecipacao: {
      volume: IndicadorReport
      vop: IndicadorReport
      receita: IndicadorReport
      operacoes_semana: number
      operacoes_mes: number
      cedentes_semana: number
      cedentes_mes: number
      ticket_medio_semana: number | null
      ticket_medio_mes: number | null
      prazo_medio_semana: number | null
      prazo_medio_mes: number | null
      prazo_medio_12m: number | null
      top_cedentes: ItemLista[]
    }
    nf: {
      capturadas: IndicadorReport
      valor_capturado: IndicadorReport
      valor_expirado: IndicadorReport
      por_faixa: {
        faixa: string
        entradas_semana: number
        valor_semana: number
        convertidas_semana: number
        conversao_semana_pct: number | null
        entradas_mes: number
        conversao_mes_pct: number | null
        entradas_12m: number
        conversao_12m_pct: number | null
      }[]
      travadas: { total: number; valor: number; itens: ItemLista[] }
    }
  }
  comercial: {
    funil: { semana?: JanelaFunil; doze?: JanelaFunil }
    comercial: {
      leads_semana: number
      leads_inbound: number
      leads_outbound: number
      fit_avaliados: number
      fit_pct: number | null
      reunioes_agendadas: IndicadorReport
      reunioes_realizadas: number
      no_shows_nao_remarcados: number
      mous: number
      ciclo_medio_dias: number | null
      ciclo_medio_base: number
    }
    credito: {
      solicitadas_semana: number
      aprovadas_semana: number
      negadas_semana: number
      limite_concedido: IndicadorReport
      aprovacao_pct: number | null
      esteira_dias: number | null
      /** Sobre quantas análises. Uma média de uma análise não é uma média. */
      esteira_base: number
      esteira_gargalo: string | null
      divergencias_seguradora: number
    }
    time: {
      vendedores: {
        vendedor_id: string
        nome: string
        tipo: string
        reunioes: number
        conversoes: number
        vop: number
        comissao: number
      }[]
      filas: { inbound_sem_contato: number; docs_parados: number; conversas_sem_resposta: number }
    }
  }
  carteira: {
    carteira: {
      clientes: number
      operaram_semana: number
      limite_total: number
      limite_ocioso: number
      utilizacao_pct: number | null
      inoperantes: number
      novos_semana: number
      sairam_semana: number
    }
    listas: { nao_performando: ItemLista[]; novos_clientes: ItemLista[]; sairam: ItemLista[] }
    certificados: {
      cnpjs: number
      cobertos: number
      vencendo_30d: number
      sem_certificado: number
      cobertura_pct: number | null
      matrizes: number
      matrizes_cobertas: number
      spes: number
      spes_cobertas: number
      invisivel: {
        /** A fração do faturamento estimado que vira NF visível. Medida, não arbitrada. */
        razao: number | null
        razao_base: number
        grupos_cegos: number | null
        /** O total DOS N MAIORES, e o nome do campo diz isso de propósito. */
        total_mes_do_topo: number | null
        topo?: number
        itens: ItemLista[]
      }
    }
    atencao: Record<string, number>
  }
}

// ─── O que vai para o modelo (§2, resumo de IA) ─────────────────────────────

/**
 * O briefing numérico do resumo de IA.
 *
 * Ele leva SÓ números já calculados. O modelo não recebe acesso a tabela nenhuma e não tem
 * como buscar mais nada — é a garantia estrutural de que ele não pode inventar um dado: se
 * o número não está aqui, ele não existe para o resumo.
 */
export function briefingParaIa(r: ReportSemanal): Record<string, unknown> {
  const f = r.comercial.funil
  const vaz = f.semana ? maiorVazamento(f.semana, f.doze) : null
  const ind = (i: IndicadorReport) => ({
    semana: i.semana,
    media_semanal_12m: i.doze_media_semanal,
    var_pct: i.var_semana_pct,
    direcao: direcaoDa(i.var_semana_pct, i.subir_e_pior),
    regua: textoDaRegua(i),
  })

  return {
    periodo: {
      de: r.periodo.inicio,
      ate: r.periodo.fim,
      semana: r.periodo.semana_iso,
      mes_parcial: `${r.periodo.mes_dias_decorridos} de ${r.periodo.mes_dias_total} dias`,
      estoques_em: r.periodo.retrato_em,
    },
    volume_convertido: ind(r.operacao.kpis.volume_convertido),
    vop_operado: ind(r.operacao.kpis.vop_operado),
    receita: ind(r.operacao.kpis.receita),
    // Com a data: sem ela o modelo escreveria "o ocioso caiu" comparando um estoque do fim
    // da janela com um fluxo da janela, que são grandezas de tempos diferentes.
    limite_ocioso: { valor: r.operacao.kpis.limite_ocioso.foto, em: r.operacao.kpis.limite_ocioso.em },
    antecipacao: {
      operacoes: r.operacao.antecipacao.operacoes_semana,
      cedentes: r.operacao.antecipacao.cedentes_semana,
      ticket_medio: r.operacao.antecipacao.ticket_medio_semana,
      prazo_medio_dias: r.operacao.antecipacao.prazo_medio_semana,
      prazo_medio_12m: r.operacao.antecipacao.prazo_medio_12m,
      maiores_cedentes: r.operacao.antecipacao.top_cedentes.slice(0, 5),
    },
    nf: {
      capturadas: r.operacao.nf.capturadas.semana,
      valor_expirado_semana: r.operacao.nf.valor_expirado.semana,
      expirado_direcao: direcaoDa(r.operacao.nf.valor_expirado.var_semana_pct, true),
      conversao_por_faixa: r.operacao.nf.por_faixa.map((x) => ({
        faixa: x.faixa,
        entradas: x.entradas_semana,
        conversao_pct: x.conversao_semana_pct,
        conversao_12m_pct: x.conversao_12m_pct,
      })),
      travadas: { total: r.operacao.nf.travadas.total, valor: r.operacao.nf.travadas.valor },
    },
    funil_semana: f.semana ?? null,
    maior_vazamento: vaz,
    comercial: r.comercial.comercial,
    credito: r.comercial.credito,
    carteira: r.carteira.carteira,
    nao_performando: r.carteira.listas.nao_performando.slice(0, 5),
    certificados: {
      cobertura_pct: r.carteira.certificados.cobertura_pct,
      grupos_cegos: r.carteira.certificados.invisivel.grupos_cegos,
      invisivel_mes_do_topo: r.carteira.certificados.invisivel.total_mes_do_topo,
      maiores: r.carteira.certificados.invisivel.itens.slice(0, 5),
    },
    time: r.comercial.time,
    atencao: r.carteira.atencao,
  }
}

/**
 * O assunto do e-mail. `{semana}`, `{periodo}` e `{ano}` são os únicos marcadores — e um
 * marcador desconhecido fica como está, em vez de virar `undefined` na caixa de entrada.
 */
export function assuntoDoEmail(template: string | null, p: PeriodoReport): string {
  const base = template?.trim() || 'Report semanal ONE OS — semana {semana}, {periodo}'
  const periodo = `${formatarDiaMes(p.inicio)} a ${formatarDiaMes(p.fim)}`
  return base
    .replace(/\{semana\}/g, String(p.semana_iso))
    .replace(/\{periodo\}/g, periodo)
    .replace(/\{ano\}/g, String(p.ano))
}

/** `report-semanal-oneos-2026-S36.pdf` (§4). */
export function nomeDoArquivo(p: PeriodoReport): string {
  return `report-semanal-oneos-${p.ano}-S${String(p.semana_iso).padStart(2, '0')}.pdf`
}

/**
 * De quando é cada metade do report, numa frase — a mesma nas três superfícies.
 *
 * Ela existe porque a tela e o PDF da MESMA semana mostram estoques diferentes de
 * propósito: no dia em que isto foi medido, o limite ocioso era R$ 62,6 mi no fim da semana
 * 35 e R$ 59,7 mi uma semana depois. Os dois números estão certos; quem lê só precisa saber
 * qual deles está olhando, e é isso que esta linha diz.
 */
export function textoDoRetrato(p: PeriodoReport): string {
  const janela = `${formatarDiaMes(p.inicio)} a ${formatarDiaMes(p.fim)}`
  if (!p.ao_vivo) {
    return `Retrato de ${formatarDiaMes(p.fim)} — carteira, filas e cobertura como estavam` +
      ` no fim da janela. Operação e comissão são de ${janela}.`
  }
  return `Carteira, filas e cobertura de AGORA (${formatarDiaMes(p.retrato_carteira_em)}).` +
    ` Operação e comissão são de ${janela}.`
}

function formatarDiaMes(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano?.slice(2) ?? ''}`
}

// ─── Formatação, idêntica nas três superfícies ──────────────────────────────

export function brlCurto(v: number | null | undefined): string {
  const n = Number(v)
  if (v === null || v === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `R$ ${(n / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1000) return `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export function variacaoTexto(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  const sinal = v > 0 ? '+' : ''
  return `${sinal}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
