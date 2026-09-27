import type { Supabase } from '../registry/types.js'
import { cnpjMatrizDe, normalizeCnpj } from '../schemas/cnpj.js'

/**
 * O bloqueio de grupo visto de FORA da Cobrança (07 §11).
 *
 * O funil, os sacados por NF, o composer e a Company 360 precisam saber "este sacado
 * está em cobrança?" sem ter o módulo — e sem ver o motivo, a cobrança ou os títulos,
 * que continuam atrás da RLS da Cobrança. `app_cnpjs_em_cobranca()` devolve só a lista
 * de CNPJs bloqueados (matriz + toda SPE/filial que a cobrança conhecia), e ela é
 * curta: poucas dezenas de grupos. Uma leitura por tela, casada em memória, em vez de
 * uma pergunta por card.
 *
 * O banco continua sendo quem recusa (triggers da 0269f): isto só evita OFERECER a
 * ação que o banco vai negar.
 */

/** A lista de CNPJs em cobrança. Qualquer autenticado pode ler. */
export async function buscarCnpjsEmCobranca(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase.rpc('app_cnpjs_em_cobranca')
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? (data as string[]) : []
}

/**
 * Casa um sacado contra a lista. Três chaves, nesta ordem: o próprio CNPJ, a matriz que
 * a tela já conhece (o funil resolve a holding na view), e a matriz da mesma raiz — que
 * pega a FILIAL que ainda não tinha aparecido quando o bloqueio foi gravado. SPE nova de
 * outra raiz só entra quando a projeção de títulos a vê; até lá, o trigger do banco
 * (que resolve a holding na hora) é quem segura.
 */
export function sacadoEmCobranca(
  bloqueados: ReadonlySet<string>,
  sacadoCnpj: string | null | undefined,
  matrizCnpj?: string | null,
): boolean {
  if (bloqueados.size === 0) return false
  for (const bruto of [sacadoCnpj, matrizCnpj]) {
    if (!bruto) continue
    const cnpj = normalizeCnpj(bruto)
    if (bloqueados.has(cnpj)) return true
    const matriz = cnpjMatrizDe(cnpj)
    if (matriz && bloqueados.has(matriz)) return true
  }
  return false
}

export interface LinkDaNota {
  /** O link como veio, ou null — sem link ativo OU sacado em cobrança. */
  link: string | null
  /** true quando havia link e ele foi retido porque o grupo do sacado está em cobrança. */
  emCobranca: boolean
}

/**
 * O link de antecipação de UMA nota, retido quando o sacado está em cobrança.
 *
 * O link é a solicitação de operação em forma de URL: mandá-lo ao fornecedor de um
 * sacado bloqueado é pedir uma operação que o banco vai recusar. A web (aba do
 * fornecedor), o mobile (folha da nota) e o compositor (`{link_antecipacao}`) passam
 * por aqui ou pela mesma função do banco, que resolve a holding na hora.
 */
export async function buscarLinkDaNota(supabase: Supabase, accessKey: string): Promise<LinkDaNota> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('link_antecipacao, sacado_cnpj')
    .eq('access_key', accessKey)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const link = data?.link_antecipacao ?? null
  if (!link || !data?.sacado_cnpj) return { link, emCobranca: false }
  const bloqueio = await supabase.rpc('app_cobranca_sacado_bloqueado', { p_cnpj: data.sacado_cnpj })
  if (bloqueio.data === true) return { link: null, emCobranca: true }
  return { link, emCobranca: false }
}
