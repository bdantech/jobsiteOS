import {
  AMBIENTE_SEGURADORA_PADRAO,
  UID_TYPE_SEGURADORA_PADRAO,
  ehAmbienteSeguradora,
  ehUidTypeSeguradora,
  type AmbienteSeguradora,
  type UidTypeSeguradora,
} from '../../../../packages/core/src/credito/seguradora.js'
import { supabaseAdmin } from '../db.js'

/**
 * Settings do módulo Crédito, lidas de `credito_config` (migração 0073).
 *
 * Cada campo tem um default embutido: se a linha sumir, o job roda com o padrão da spec
 * em vez de quebrar. O que NÃO tem default é a calibração — essa, faltando, para o job,
 * porque um coeficiente inventado é pior que nenhum.
 */

export interface ConfigCredito {
  // economia
  taxa_padrao_am: number
  tac: number
  valor_medio_nf: number
  prazo_medio_dias: number
  utilizacao_media: number | null
  giro_mensal: number | null
  // limite
  ratio_limite_manual: number | null
  cap_absoluto: number
  cap_pct_faturamento: number
  // scorecard
  corte_concessao: number
  completude_minima: number
  recencia_protesto_dias: number
  knockout_negada_meses: number
  chance_por_faixa: Record<string, number>
  chance_sem_score: number
  // gerais
  n_minimo_calibracao_por_tipo: number
  variacao_minima_snapshot: number
  poll_intervalo_horas: number
  validade_padrao_meses: number
}

export interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
}

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin.from('credito_config').select('valor').eq('chave', chave).maybeSingle()
  return { ...padrao, ...((data?.valor as Partial<T> | undefined) ?? {}) }
}

export async function lerConfigCredito(): Promise<ConfigCredito> {
  const [economia, limite, scorecard, atradius] = await Promise.all([
    ler('economia', {
      taxa_padrao_am: 1.9,
      tac: 150,
      valor_medio_nf: 25_000,
      prazo_medio_dias: 45,
      utilizacao_media: null as number | null,
      giro_mensal: null as number | null,
    }),
    ler('limite', {
      ratio_limite_manual: null as number | null,
      cap_absoluto: 5_000_000,
      cap_pct_faturamento: 0.15,
    }),
    ler('scorecard', {
      corte_concessao: 40,
      completude_minima: 0.5,
      recencia_protesto_dias: 90,
      knockout_negada_meses: 6,
      chance_por_faixa: { alta: 0.8, media: 0.5, improvavel: 0.1 } as Record<string, number>,
      chance_sem_score: 0.5,
    }),
    ler('atradius', { poll_intervalo_horas: 6, validade_padrao_meses: 12 }),
  ])

  return {
    ...economia,
    ...limite,
    ...scorecard,
    ...atradius,
    // Reaproveitados do 04c de propósito: a régua de "quantas amostras bastam" e a de
    // "quanto precisa variar para virar snapshot" não podem divergir entre os dois
    // estimadores. Duas cópias divergiriam no dia em que alguém ajustasse uma.
    n_minimo_calibracao_por_tipo: 5,
    variacao_minima_snapshot: 0.1,
  }
}

/**
 * Os parâmetros de integração com a seguradora, lidos de `credito_config.atradius`.
 *
 * Vivem aqui, e não em `atradius.ts`, porque `credito_config` tem UM leitor: dois lugares
 * lendo a mesma linha divergem no dia em que uma chave mudar de nome.
 *
 * ── O cache, e por que ele é curto ───────────────────────────────────────────
 * A pergunta é feita em toda chamada à seguradora — num backfill, centenas de vezes — e a
 * resposta muda quando alguém clica na tela. Sessenta segundos é o teto de quanto tempo o
 * worker segue com o valor antigo depois do clique: curto o bastante para quem está
 * homologando não achar que o botão não funcionou, longo o bastante para uma paginação
 * inteira não virar uma consulta por página.
 *
 * Cada campo tem um default seguro para valor ausente ou desconhecido. No ambiente, seguro
 * é `sandbox`: um erro de digitação na configuração não pode ter como consequência pedir
 * cobertura de verdade.
 */
export interface IntegracaoSeguradora {
  ambiente: AmbienteSeguradora
  /** O customer id da ONE OS na Atradius. Vazio quando não configurado. */
  organizacao_id: string | null
  /** Como o CNPJ se apresenta na busca de buyer. Ver o comentário do enum no core. */
  uid_type: UidTypeSeguradora
}

const INTEGRACAO_TTL_MS = 60_000
let integracaoCache: { valor: IntegracaoSeguradora; lidaEm: number } | null = null

export async function lerIntegracaoSeguradora(): Promise<IntegracaoSeguradora> {
  if (integracaoCache && Date.now() - integracaoCache.lidaEm < INTEGRACAO_TTL_MS) {
    return integracaoCache.valor
  }
  const { data } = await supabaseAdmin
    .from('credito_config')
    .select('valor')
    .eq('chave', 'atradius')
    .maybeSingle()
  const bruto = (data?.valor ?? {}) as {
    ambiente?: unknown
    organizacao_id?: unknown
    uid_type?: unknown
  }
  const org = typeof bruto.organizacao_id === 'string' ? bruto.organizacao_id.trim() : ''
  const valor: IntegracaoSeguradora = {
    ambiente: ehAmbienteSeguradora(bruto.ambiente) ? bruto.ambiente : AMBIENTE_SEGURADORA_PADRAO,
    organizacao_id: org === '' ? null : org,
    uid_type: ehUidTypeSeguradora(bruto.uid_type) ? bruto.uid_type : UID_TYPE_SEGURADORA_PADRAO,
  }
  integracaoCache = { valor, lidaEm: Date.now() }
  return valor
}

export async function lerTiposDoc(): Promise<TipoDoc[]> {
  const { data } = await supabaseAdmin.from('credito_config').select('valor').eq('chave', 'docs').maybeSingle()
  const valor = data?.valor as { tipos?: TipoDoc[] } | undefined
  return (
    valor?.tipos ?? [
      { id: 'balanco', label: 'Balanço patrimonial', obrigatorio: true },
      { id: 'dre', label: 'DRE', obrigatorio: true },
      { id: 'contrato_social', label: 'Contrato social', obrigatorio: true },
      { id: 'outros', label: 'Outros', obrigatorio: false },
    ]
  )
}
