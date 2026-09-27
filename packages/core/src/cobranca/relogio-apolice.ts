import { diasEntreDatas, menorData, somarDiasCorridos, somarMeses } from './datas.js'

/**
 * O relógio da apólice Atradius (Prompt 07 §6). É a parte que não pode falhar.
 *
 * ── D É O VENCIMENTO ORIGINAL ───────────────────────────────────────────────
 * A cl. 16900.20 diz que a prorrogação não desloca a data usada para aplicar os termos
 * da apólice. Por isso a entrada é `vencimento_original` e nada mais — e um vencimento
 * num sábado continua contando do sábado: o relógio corre em dias corridos.
 *
 * ── OS NÚMEROS SÃO DA APÓLICE, NÃO DO CÓDIGO ────────────────────────────────
 * 60, 30, 180, 6 meses: tudo vem da linha de `apolices`. A renovação anual muda
 * parâmetro, e um título vencido sob a apólice de 2026 continua contado por ela mesmo
 * depois que a de 2027 entra em vigor — `escolherApolice` decide qual rege.
 *
 * ── A RÉGUA ─────────────────────────────────────────────────────────────────
 *   D+60   parada automática de cobertura (cl. 17700.20 a)       = D + prorrogação
 *   D+90   limite para notificar a seguradora (cl. 18500.01)     = D+60 + 30
 *   D+180  Data da Perda por mora prolongada (cl. 00500.00)      = D + período de espera
 *   D+360  limite para enviar o sinistro (cl. 22100.20 §1)       = Data da Perda + 6 meses
 * Insolvência (cl. 00300.00): a Data da Perda é a da decisão judicial, e os 6 meses
 * correm dela.
 */

export interface ApoliceRelogio {
  id: string
  vigencia_inicio: string
  vigencia_fim: string
  ativa: boolean
  periodo_espera_dias: number
  periodo_max_prorrogacao_dias: number
  prazo_notificacao_apos_prorrogacao_dias: number
  prazo_envio_sinistro_meses: number
}

export type CausaPrazo = 'mora_prolongada' | 'insolvencia'

export interface PrazosApolice {
  apolice_id: string
  causa: CausaPrazo
  vencimento_original: string
  data_parada_cobertura: string
  data_limite_notificacao: string
  data_perda: string
  data_limite_sinistro: string
}

/**
 * A apólice que rege o título é a vigente NO VENCIMENTO. Sem nenhuma que o cubra (o
 * título venceu antes do primeiro contrato cadastrado), a mais antiga ativa que começou
 * antes dele; sem nada, `null` — e o relógio não inventa prazo.
 */
export function escolherApolice<T extends ApoliceRelogio>(apolices: readonly T[], vencimento: string): T | null {
  const vigente = apolices
    .filter((a) => a.vigencia_inicio <= vencimento && vencimento <= a.vigencia_fim)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0]
  if (vigente) return vigente
  const anterior = apolices
    .filter((a) => a.ativa && a.vigencia_inicio <= vencimento)
    .sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0]
  return anterior ?? null
}

export interface EntradaPrazos {
  vencimento_original: string
  apolice: ApoliceRelogio
  /** Data da decisão de recuperação judicial/falência do sacado, se houver. */
  insolvencia_data_decisao?: string | null
}

export function calcularPrazosApolice(e: EntradaPrazos): PrazosApolice {
  const { apolice: a, vencimento_original: d } = e
  const parada = somarDiasCorridos(d, a.periodo_max_prorrogacao_dias)
  const limiteNotificacao = somarDiasCorridos(parada, a.prazo_notificacao_apos_prorrogacao_dias)
  const perdaMora = somarDiasCorridos(d, a.periodo_espera_dias)
  const limiteMora = somarMeses(perdaMora, a.prazo_envio_sinistro_meses)

  if (e.insolvencia_data_decisao) {
    const perda = e.insolvencia_data_decisao
    // O caminho da insolvência SUBSTITUI o D+360 — mas nunca para empurrá-lo: se a
    // mora prolongada já fecha antes, vale a data mais curta. Um prazo de apólice
    // calculado a mais é um prazo perdido.
    return {
      apolice_id: a.id,
      causa: 'insolvencia',
      vencimento_original: d,
      data_parada_cobertura: parada,
      data_limite_notificacao: limiteNotificacao,
      data_perda: perda,
      data_limite_sinistro: menorData(somarMeses(perda, a.prazo_envio_sinistro_meses), limiteMora),
    }
  }

  return {
    apolice_id: a.id,
    causa: 'mora_prolongada',
    vencimento_original: d,
    data_parada_cobertura: parada,
    data_limite_notificacao: limiteNotificacao,
    data_perda: perdaMora,
    data_limite_sinistro: limiteMora,
  }
}

// ─── Restabelecimento da cobertura (§6.3 item 2, §6.4) ──────────────────────

export interface Restabelecimento {
  /** A cobertura de novos recebíveis chegou a parar? */
  interrompida: boolean
  /** Volta com efeito retroativo (sem lacuna)? `null` quando nem chegou a parar. */
  retroativo: boolean | null
  /** A partir de quando cessões novas voltam a ser cobertas. `null` = nunca parou. */
  cobertura_volta_em: string | null
  explicacao: string
}

/**
 * Duas causas de Interrupção Automática de Cobertura, e elas voltam diferente:
 *   (a) D+60 sem pagamento (cl. 17700.20 a): pago até 30 dias depois, volta com efeito
 *       RETROATIVO; depois disso, só para o que for cedido após o pagamento.
 *   (b) valores do sacado postos em cobrança (cl. 17700.20 b): volta só para o que for
 *       cedido a partir do pagamento — o aviso do §6.4 diz isso a quem aperta o botão.
 * Com as duas presentes, vale a (b): ela não tem retroatividade a oferecer.
 */
export function restabelecimentoCobertura(e: {
  pago_em: string
  data_parada_cobertura: string
  /** Quando o sacado foi posto em cobrança (primeiro envio), se foi. */
  em_cobranca_desde?: string | null
  janela_retroativa_dias?: number
}): Restabelecimento {
  const janela = e.janela_retroativa_dias ?? 30
  const cobranca = e.em_cobranca_desde && e.em_cobranca_desde <= e.pago_em ? e.em_cobranca_desde : null

  if (cobranca) {
    return {
      interrompida: true,
      retroativo: false,
      cobertura_volta_em: e.pago_em,
      explicacao:
        'O sacado foi posto em cobrança (cl. 17700.20 b): a cobertura volta só para recebíveis cedidos a partir do pagamento.',
    }
  }
  if (e.pago_em <= e.data_parada_cobertura) {
    return {
      interrompida: false,
      retroativo: null,
      cobertura_volta_em: null,
      explicacao: 'Pago antes da parada automática de cobertura: a cobertura não chegou a ser interrompida.',
    }
  }
  if (diasEntreDatas(e.data_parada_cobertura, e.pago_em) <= janela) {
    return {
      interrompida: true,
      retroativo: true,
      cobertura_volta_em: e.data_parada_cobertura,
      explicacao: `Pago em até ${janela} dias depois da parada: a cobertura se restabelece com efeito retroativo (cl. 17700.20 a).`,
    }
  }
  return {
    interrompida: true,
    retroativo: false,
    cobertura_volta_em: e.pago_em,
    explicacao: `Pago mais de ${janela} dias depois da parada: a cobertura volta só para recebíveis cedidos após o pagamento.`,
  }
}

// ─── Alertas escalonados (§6.3 item 3) ──────────────────────────────────────

export type MarcoAlerta =
  | 'parada_cobertura'
  | 'notificacao_seguradora'
  | 'notificacao_critica'
  | 'data_perda'
  | 'envio_sinistro'

export interface ConfigAlertasApolice {
  /** Dias depois do vencimento, na régua de mora de 60/90/180/360 (os defaults do §6.3). */
  parada_cobertura: number
  notificacao_seguradora: number
  notificacao_critica: number
  data_perda: number
  envio_sinistro: readonly number[]
}

export interface EstadoPrazo extends PrazosApolice {
  notificado_seguradora_em: string | null
  sinistro_enviado: boolean
  /** Marcos já avisados: `marco` → data do último aviso. */
  alertas_emitidos: Readonly<Record<string, string>>
}

export interface AlertaApolice {
  /** Chave estável: `parada_cobertura`, `envio_sinistro:60`, `notificacao_critica`… */
  chave: string
  marco: MarcoAlerta
  nivel: 'aviso' | 'alto' | 'critico'
  data_marco: string
  dias_restantes: number
  mensagem: string
}

export interface PrazoPerdido {
  marco: 'notificacao_seguradora' | 'envio_sinistro'
  data_marco: string
  mensagem: string
}

/**
 * A régua de alertas é dada em "D+N" porque é como a apólice e o time falam dela, mas o
 * alerta é disparado por ANTECEDÊNCIA do marco: D+45 é "15 dias antes da parada" numa
 * apólice de 60 dias de prorrogação. Isso mantém os avisos certos quando a renovação muda
 * a régua (prorrogação de 90 dias) e no caminho da insolvência, em que o prazo do
 * sinistro não é D+360.
 */
function antecedencias(cfg: ConfigAlertasApolice) {
  return {
    parada: 60 - cfg.parada_cobertura,
    notificacao: 90 - cfg.notificacao_seguradora,
    critica: 90 - cfg.notificacao_critica,
    perda: 180 - cfg.data_perda,
    sinistro: cfg.envio_sinistro.map((d) => 360 - d).filter((n) => n > 0),
  }
}

/**
 * O que avisar HOJE. Cada marco avisa uma vez (a primeira execução em que a
 * antecedência foi alcançada — um dia sem job não engole o aviso); o crítico de D+85
 * repete TODO dia até a seguradora ser notificada ou o prazo passar.
 */
export function alertasDoDia(p: EstadoPrazo, hoje: string, cfg: ConfigAlertasApolice): AlertaApolice[] {
  const ant = antecedencias(cfg)
  const out: AlertaApolice[] = []
  const faltam = (data: string) => diasEntreDatas(hoje, data)
  const jaAvisado = (chave: string) => chave in p.alertas_emitidos

  const avisar = (a: Omit<AlertaApolice, 'dias_restantes'>, antecedencia: number) => {
    const d = faltam(a.data_marco)
    if (d < 0 || d > antecedencia) return
    if (a.nivel !== 'critico' && jaAvisado(a.chave)) return
    if (a.nivel === 'critico' && p.alertas_emitidos[a.chave] === hoje) return
    out.push({ ...a, dias_restantes: d })
  }

  avisar(
    {
      chave: 'parada_cobertura',
      marco: 'parada_cobertura',
      nivel: 'aviso',
      data_marco: p.data_parada_cobertura,
      mensagem: `Faltam ${faltam(p.data_parada_cobertura)} dias para a parada automática de cobertura deste sacado.`,
    },
    ant.parada,
  )

  if (!p.notificado_seguradora_em) {
    const d = faltam(p.data_limite_notificacao)
    if (d <= ant.critica) {
      avisar(
        {
          chave: 'notificacao_critica',
          marco: 'notificacao_critica',
          nivel: 'critico',
          data_marco: p.data_limite_notificacao,
          mensagem: `${d} dia(s) para perder o direito à indenização: notifique a seguradora do inadimplemento (cl. 18500.01).`,
        },
        ant.critica,
      )
    } else {
      avisar(
        {
          chave: 'notificacao_seguradora',
          marco: 'notificacao_seguradora',
          nivel: 'alto',
          data_marco: p.data_limite_notificacao,
          mensagem: `Faltam ${d} dias para o prazo de notificação à seguradora.`,
        },
        ant.notificacao,
      )
    }
  }

  avisar(
    {
      chave: 'data_perda',
      marco: 'data_perda',
      nivel: 'aviso',
      data_marco: p.data_perda,
      mensagem: `Data da Perda em ${faltam(p.data_perda)} dias; prepare o dossiê de sinistro.`,
    },
    ant.perda,
  )

  if (!p.sinistro_enviado) {
    // do maior para o menor: com o job parado uma semana, avisa a antecedência mais curta alcançada
    const alcancadas = [...ant.sinistro].sort((a, b) => b - a).filter((n) => faltam(p.data_limite_sinistro) <= n)
    const n = alcancadas[alcancadas.length - 1]
    if (n !== undefined) {
      avisar(
        {
          chave: `envio_sinistro:${n}`,
          marco: 'envio_sinistro',
          nivel: n <= 15 ? 'critico' : 'alto',
          data_marco: p.data_limite_sinistro,
          mensagem: `Faltam ${faltam(p.data_limite_sinistro)} dias para o prazo final de envio do sinistro completo (cl. 22100.20).`,
        },
        n,
      )
    }
  }

  return out
}

/** Prazos que passaram sem o ato. Isso é `apolice.prazo_perdido` e `status = 'perdido'`. */
export function prazosPerdidos(p: EstadoPrazo, hoje: string): PrazoPerdido[] {
  const out: PrazoPerdido[] = []
  if (!p.notificado_seguradora_em && hoje > p.data_limite_notificacao) {
    out.push({
      marco: 'notificacao_seguradora',
      data_marco: p.data_limite_notificacao,
      mensagem: 'O prazo para notificar a seguradora passou sem notificação: risco de perda do direito à indenização (cl. 28509.01 iv).',
    })
  }
  if (!p.sinistro_enviado && hoje > p.data_limite_sinistro) {
    out.push({
      marco: 'envio_sinistro',
      data_marco: p.data_limite_sinistro,
      mensagem: 'O prazo final de envio do sinistro passou: o sinistro se torna inadmissível (cl. 22100.20 §1).',
    })
  }
  return out
}
