import { parseOuFalhar, traduzirErro } from '../db/shared.js'
import type { Supabase } from '../registry/types.js'
import type { Json, Tables } from '../types/database.js'
import {
  configNovidadesSchema,
  diaNaoUtilSchema,
  lerConfigNovidades,
  lerResumoNovidades,
  montarCalendario,
  type CalendarioNovidades,
  type ConfigNovidades,
  type DiaNaoUtilInput,
  type ResumoNovidades,
} from './janela-novidades.js'

/**
 * As leituras e escritas da janela de novidades (04t), para web e mobile.
 *
 * Moram no core porque as duas telas precisam chegar à MESMA janela: o expediente e o
 * calendário lidos por um caminho no desktop e por outro no celular é como a segunda
 * de manhã passa a mostrar 23 itens numa tela e 31 na outra.
 */

export type DiaNaoUtil = Tables<'dias_nao_uteis'>

export interface ContextoNovidades {
  cfg: ConfigNovidades
  calendario: CalendarioNovidades
}

/** Quantos dias para trás o calendário é lido. O cálculo anda no máximo 60. */
const DIAS_DE_CALENDARIO = 70

/**
 * Expediente + dias não úteis recentes, em duas leituras pequenas.
 *
 * Falha de leitura NÃO vira erro: a janela cai para "só fim de semana" e a tela avisa.
 * Um filtro que some porque uma tabela de feriados não respondeu é pior que um filtro
 * que erra um feriado e diz que pode ter errado.
 */
export async function buscarContextoNovidades(supabase: Supabase): Promise<ContextoNovidades> {
  const desde = new Date(Date.now() - DIAS_DE_CALENDARIO * 86_400_000).toISOString().slice(0, 10)

  const [cfg, dias] = await Promise.all([
    supabase.from('antecipacao_config').select('valor').eq('chave', 'funil_novidades').maybeSingle(),
    supabase.from('dias_nao_uteis').select('data, origem').gte('data', desde),
  ])

  return {
    cfg: lerConfigNovidades(cfg.data?.valor),
    calendario: montarCalendario(dias.error ? [] : dias.data),
  }
}

/** Contagem e valor do que entrou na janela, por tipo e por carteira. A RLS recorta. */
export async function buscarResumoNovidades(
  supabase: Supabase,
  janela: { de: Date; ate?: Date | null },
  vendedorId?: string | null,
): Promise<ResumoNovidades> {
  const { data, error } = await supabase.rpc('funil_novidades_resumo', {
    p_desde: janela.de.toISOString(),
    p_ate: janela.ate ? janela.ate.toISOString() : null,
    p_vendedor_id: vendedorId ?? null,
  })
  if (error) throw traduzirErro(error)
  return lerResumoNovidades(data)
}

export interface VisitaAoFunil {
  visto_em: string | null
  /** Tudo que entrou depois disto leva o selo "novo". */
  visto_anterior: string | null
}

/**
 * Registra a abertura do funil e devolve o marcador ANTERIOR.
 *
 * `tudo` é o botão "Marcar tudo como visto": o anterior vira agora, e nenhum item
 * continua novo.
 */
export async function marcarVisitaAoFunil(supabase: Supabase, tudo = false): Promise<VisitaAoFunil> {
  const { data, error } = await supabase.rpc('app_funil_marcar_visita', { p_tudo: tudo })
  if (error) throw traduzirErro(error)
  const r = (data ?? {}) as Partial<VisitaAoFunil>
  return { visto_em: r.visto_em ?? null, visto_anterior: r.visto_anterior ?? null }
}

// ─── Settings (gestor) ──────────────────────────────────────────────────────

export async function buscarDiasNaoUteis(supabase: Supabase, desdeAno: number): Promise<DiaNaoUtil[]> {
  const { data, error } = await supabase
    .from('dias_nao_uteis')
    .select('*')
    .gte('data', `${desdeAno}-01-01`)
    .order('data', { ascending: true })
  if (error) throw traduzirErro(error)
  return data ?? []
}

export async function salvarConfigNovidades(
  supabase: Supabase,
  input: ConfigNovidades | unknown,
): Promise<ConfigNovidades> {
  const dados = parseOuFalhar(configNovidadesSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_funil_novidades_config', {
    p: dados as unknown as Json,
  })
  if (error) throw traduzirErro(error)
  return lerConfigNovidades(data)
}

export async function salvarDiaNaoUtil(
  supabase: Supabase,
  input: DiaNaoUtilInput | unknown,
): Promise<DiaNaoUtil> {
  const dados = parseOuFalhar(diaNaoUtilSchema, input)
  const { data, error } = await supabase.rpc('app_salvar_dia_nao_util', { p: dados as unknown as Json })
  if (error) throw traduzirErro(error)
  return data
}

export async function removerDiaNaoUtil(supabase: Supabase, data: string): Promise<void> {
  const { error } = await supabase.rpc('app_remover_dia_nao_util', { p_data: data })
  if (error) throw traduzirErro(error)
}

// ─── Feriados nacionais (BrasilAPI) ─────────────────────────────────────────

export const urlFeriadosBrasilApi = (ano: number) => `https://brasilapi.com.br/api/feriados/v1/${ano}`

export interface FeriadoNacional {
  data: string
  nome: string
}

/**
 * O que a BrasilAPI devolve, reduzido ao que se grava. Linha fora do ano pedido ou sem
 * data válida é descartada — a resposta é de terceiro, e um `date` torto não pode
 * derrubar a importação inteira.
 */
export function normalizarFeriados(bruto: unknown, ano: number): FeriadoNacional[] {
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const saida: FeriadoNacional[] = []
  for (const item of bruto) {
    const data = String((item as { date?: unknown })?.date ?? '').slice(0, 10)
    const nome = String((item as { name?: unknown })?.name ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !data.startsWith(`${ano}-`) || !nome) continue
    if (vistos.has(data)) continue
    vistos.add(data)
    saida.push({ data, nome })
  }
  return saida
}

export interface ResultadoImportacaoFeriados {
  anos: { ano: number; feriados: number; erro?: string }[]
  gravados: number
}

/**
 * Importa os feriados nacionais dos anos pedidos. O client é o de SERVIÇO.
 *
 * Um ano que falha não impede o outro, e nada aqui apaga o que já existe: o dia que o
 * gestor cadastrou à mão (`origem = 'manual'`) fica como ele deixou, mesmo que caia
 * num feriado nacional. Falha da API não quebra o filtro — a janela segue com o que o
 * banco já tem e a tela avisa quando o ano não está coberto.
 */
export async function importarFeriadosNacionais(
  supabase: Supabase,
  anos: readonly number[],
  buscar: (url: string) => Promise<unknown> = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`BrasilAPI respondeu ${r.status}`)
    return r.json()
  },
): Promise<ResultadoImportacaoFeriados> {
  const resultado: ResultadoImportacaoFeriados = { anos: [], gravados: 0 }

  for (const ano of anos) {
    try {
      const feriados = normalizarFeriados(await buscar(urlFeriadosBrasilApi(ano)), ano)
      if (feriados.length === 0) throw new Error('resposta sem feriados')

      // Todas as linhas no MESMO formato: lote de formatos misturados grava NULL no que falta.
      const linhas = feriados.map((f) => ({
        data: f.data,
        nome: f.nome,
        escopo: 'nacional',
        origem: 'brasilapi',
      }))
      const { error } = await supabase
        .from('dias_nao_uteis')
        .upsert(linhas, { onConflict: 'data', ignoreDuplicates: true })
      if (error) throw new Error(error.message)

      resultado.anos.push({ ano, feriados: feriados.length })
      resultado.gravados += feriados.length
    } catch (erro) {
      resultado.anos.push({ ano, feriados: 0, erro: erro instanceof Error ? erro.message : String(erro) })
    }
  }
  return resultado
}

/** O ano corrente e o seguinte, no fuso de Brasília — é o que o job anual popula. */
export function anosParaImportar(agora: Date = new Date()): number[] {
  const ano = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(agora),
  )
  return [ano, ano + 1]
}
