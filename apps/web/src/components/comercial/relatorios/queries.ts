'use client'

import { createClient } from '@/lib/supabase/client'
import type { ReportSemanal } from '@jobsiteos/core'

/**
 * A aba consome a MESMA estrutura que o PDF e o e-mail (04q §6).
 *
 * `app_report_semanal` é a porta autorizada — ela recusa quem não é gestor. Não há um
 * segundo caminho de cálculo aqui: se a aba recalculasse qualquer coisa, o número da tela
 * e o do anexo poderiam divergir, e quem descobre a divergência é sempre a pessoa para
 * quem o report foi feito.
 */

export const relatoriosKeys = {
  periodo: (inicio: string | null, fim: string | null) =>
    ['relatorios', 'periodo', inicio ?? 'auto', fim ?? 'auto'] as const,
  execucoes: () => ['relatorios', 'execucoes'] as const,
  config: () => ['relatorios', 'config'] as const,
}

/**
 * A TELA é ao vivo; o PDF é o retrato do fim da janela.
 *
 * Os FLUXOS (VOP, volume, receita, operações, comissão) são idênticos nos dois: a data do
 * evento não muda conforme o momento da pergunta. O que difere são os ESTOQUES — carteira,
 * filas, cobertura de certificados —, e a diferença é real: no fim da semana 35 o limite
 * ocioso era R$ 62,6 mi e uma semana depois, R$ 59,7 mi.
 *
 * `aoVivo: false` reproduz na tela exatamente os números do anexo, para quando alguém
 * perguntar por que a tela e o PDF divergem.
 */
export async function buscarReport(
  inicio?: string | null,
  fim?: string | null,
  aoVivo = true,
): Promise<ReportSemanal> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_report_semanal' as never, {
    p_inicio: inicio ?? null,
    p_fim: fim ?? null,
    p_ao_vivo: aoVivo,
  } as never)
  if (error) throw new Error(error.message)
  return data as unknown as ReportSemanal
}

export interface ExecucaoReport {
  id: string
  periodo_inicio: string
  periodo_fim: string
  status: string
  pdf_url: string | null
  resumo_ia: string | null
  destinatarios_enviados: string[] | null
  erro: string | null
  criado_em: string
  enviado_em: string | null
}

/**
 * O histórico NÃO traz `dados`.
 *
 * O snapshot de cada execução tem uns 30 kB, e uma lista de cinquenta semanas ficaria com
 * 1,5 MB para mostrar cinco colunas. Quem abre um report antigo pede o snapshot daquele
 * ali, e é o que `buscarExecucao` faz.
 */
export async function buscarExecucoes(): Promise<ExecucaoReport[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_execucoes')
    .select(
      'id, periodo_inicio, periodo_fim, status, pdf_url, resumo_ia, destinatarios_enviados, erro, criado_em, enviado_em',
    )
    .eq('tipo', 'semanal_executivo')
    .order('periodo_inicio', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []).map((e) => ({
    ...e,
    destinatarios_enviados: Array.isArray(e.destinatarios_enviados)
      ? (e.destinatarios_enviados as string[])
      : null,
  }))
}

/** O snapshot de UMA execução: os números da época, e não os de hoje. */
export async function buscarExecucao(id: string): Promise<ReportSemanal | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_execucoes')
    .select('dados')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const d = data?.dados as unknown
  return d && typeof d === 'object' && 'periodo' in d ? (d as ReportSemanal) : null
}

/** O nome do arquivo salvo, tirado do caminho no bucket. */
export function nomeDoPdf(caminho: string): string {
  return caminho.split('/').pop() || 'report-semanal.pdf'
}

/**
 * O link do PDF é ASSINADO e curto.
 *
 * O bucket é privado porque o arquivo traz a carteira inteira e a comissão nominal de cada
 * vendedor. Uma URL pública seria um vazamento para quem adivinhasse o caminho — e o
 * caminho é `{ano}/report-semanal-oneos-{ano}-S{semana}.pdf`, que não é difícil de adivinhar.
 *
 * `download` faz o Storage responder com `Content-Disposition: attachment`. Sem ele o link
 * ABRE o PDF no visualizador do navegador em vez de baixar — que é outra coisa do que o
 * botão promete, e some se a aba for fechada.
 *
 * E o erro volta como TEXTO. Devolver `null` reduzia sessão expirada, arquivo apagado e
 * recusa de RLS à mesma frase genérica na tela — justamente a informação que faltaria para
 * descobrir por que o download não veio.
 */
export async function urlDoPdf(caminho: string): Promise<{ url: string } | { erro: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from('reports-semanais')
    .createSignedUrl(caminho, 300, { download: nomeDoPdf(caminho) })
  if (error || !data) return { erro: error?.message ?? 'O Storage não devolveu o link.' }
  return { url: data.signedUrl }
}

export interface DestinatarioReport {
  email: string
  nome?: string
  usuario_id?: string
}

export interface ConfigReport {
  id: string
  destinatarios: DestinatarioReport[]
  dias_semana: number[]
  horario: string
  ativo: boolean
  assunto_template: string | null
}

export async function buscarConfigReport(): Promise<ConfigReport | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('report_config')
    .select('id, destinatarios, dias_semana, horario, ativo, assunto_template')
    .eq('tipo', 'semanal_executivo')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    ...data,
    destinatarios: Array.isArray(data.destinatarios)
      ? (data.destinatarios as unknown as DestinatarioReport[])
      : [],
  }
}
