import {
  BENCHMARK_FASES_PADRAO,
  PARAMETROS_CALCULO_PADRAO,
  REGRAS_FASE_PADRAO,
  type BenchmarkFases,
  type ConfigMonitoramento,
  type NossoCnpj,
  type ParametrosCalculo,
  type RegraFase,
} from '../../../../packages/core/src/juridico/index.js'
import { supabaseAdmin } from '../db.js'

/**
 * Settings do módulo Jurídico, lidas de `juridico_config` (migração 0143).
 *
 * Cada leitura tem um padrão embutido: se a linha sumir, o job roda com o padrão da
 * spec em vez de quebrar. A exceção é `nossos_cnpjs` — sem ele a descoberta não tem
 * o que buscar, e o job PARA em vez de varrer a base do Escavador por um CNPJ
 * inventado. Uma varredura por engano custa crédito.
 */

async function ler<T>(chave: string, padrao: T): Promise<T> {
  const { data } = await supabaseAdmin.from('juridico_config').select('valor').eq('chave', chave).maybeSingle()
  const valor = data?.valor
  if (valor === null || valor === undefined) return padrao
  // Objeto: mescla sobre o padrão, para uma chave nova da spec não sair `undefined`
  // numa linha salva antes de ela existir. Array: substitui — mesclar duas listas
  // produziria uma terceira que ninguém configurou.
  if (Array.isArray(valor) || typeof valor !== 'object') return valor as T
  return { ...padrao, ...(valor as Partial<T>) } as T
}

export const MONITORAMENTO_PADRAO: ConfigMonitoramento = {
  dias_semana: [1, 2, 3, 4, 5],
  hora: 7,
  apenas_ativos: true,
  forcar_atualizacao_tribunal: false,
  dias_sem_movimentacao: 60,
  // Sexta. Ver a nota no schema: um dia, não todos, porque o resumo custa token
  // por processo e ele muda quando chega movimentação, não quando o relógio vira.
  dia_resumo_ia: 5,
}

export async function lerNossosCnpjs(): Promise<NossoCnpj[]> {
  const lista = await ler<NossoCnpj[]>('nossos_cnpjs', [])
  return (Array.isArray(lista) ? lista : []).filter((c) => c?.cnpj && c.ativo !== false)
}

export async function lerMonitoramento(): Promise<ConfigMonitoramento> {
  return ler<ConfigMonitoramento>('monitoramento', MONITORAMENTO_PADRAO)
}

export async function lerBenchmarkFases(): Promise<BenchmarkFases> {
  return ler<BenchmarkFases>('benchmark_fases', BENCHMARK_FASES_PADRAO)
}

export async function lerParametrosCalculo(): Promise<ParametrosCalculo> {
  return ler<ParametrosCalculo>('calculo', PARAMETROS_CALCULO_PADRAO)
}

/**
 * A régua do classificador.
 *
 * Lista VAZIA na config significa "use a de fábrica" — não "não classifique nada".
 * A distinção é a diferença entre um cronograma completo e uma base inteira de
 * processos aparentando estar parada, e a única pista seria uma linha de jsonb que
 * ninguém abre. Preenchida, a lista SUBSTITUI a régua inteira: complementar faria
 * uma regra removida na tela continuar valendo pelo padrão.
 */
export async function lerRegrasFase(): Promise<readonly RegraFase[]> {
  const cfg = await ler<{ regras: RegraFase[] }>('classificador', { regras: [] })
  const regras = Array.isArray(cfg?.regras) ? cfg.regras : []
  return regras.length > 0 ? regras : REGRAS_FASE_PADRAO
}

const DIAS_SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Hoje é dia de sincronizar? `dias_semana` usa a convenção de `Date#getDay` (0 = domingo).
 *
 * O dia é o de SÃO PAULO, e não o de UTC. O container roda em UTC; uma rodada marcada
 * para as 7h de segunda dispararia às 4h UTC — que ainda é DOMINGO no fuso de quem
 * configurou. O erro seria silencioso: o job simplesmente não rodaria nas segundas, e a
 * tela continuaria dizendo que roda.
 */
/**
 * Hoje é o dia de regerar os resumos de IA?
 *
 * Mesma leitura de fuso do `ehDiaDeSincronizar`, e pelo mesmo motivo: o
 * container roda em UTC, e "sexta" às 22h de São Paulo já é sábado lá.
 */
export function ehDiaDeResumoIa(cfg: ConfigMonitoramento, agora: Date = new Date()): boolean {
  if (cfg.dia_resumo_ia === null || cfg.dia_resumo_ia === undefined) return false
  const abrev = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }).format(agora)
  const dia = DIAS_SEMANA.indexOf(abrev as (typeof DIAS_SEMANA)[number])
  // Fuso desconhecido: NÃO roda. Rodar por engano gasta token; não rodar aparece
  // na tela como um resumo com a tarja de desatualizado.
  if (dia < 0) return false
  return dia === cfg.dia_resumo_ia
}

export function ehDiaDeSincronizar(cfg: ConfigMonitoramento, agora: Date = new Date()): boolean {
  const abrev = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }).format(agora)
  const dia = DIAS_SEMANA.indexOf(abrev as (typeof DIAS_SEMANA)[number])
  // Fuso desconhecido ou formatação inesperada: NÃO roda. Rodar por engano gasta
  // crédito; não rodar aparece na tela como "última sincronização" velha.
  if (dia < 0) return false
  return cfg.dias_semana.includes(dia)
}
