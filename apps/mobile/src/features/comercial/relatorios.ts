import { useQuery } from '@tanstack/react-query'
import type { ReportSemanal } from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * O Report Semanal no celular (04q §7): o resumo e os KPIs, e o PDF para baixar.
 *
 * O que NÃO vem para cá: os dashboards completos e a configuração de envio. Os dois exigem
 * comparar tabela e decidir sobre a caixa de entrada de outras pessoas, e nenhuma das duas
 * coisas se faz com uma mão, em pé. O celular aqui responde "como foi a semana" — que é a
 * pergunta que alguém faz no táxi, a caminho da reunião de segunda.
 *
 * A MESMA RPC da web. Ela recusa quem não é gestor, e é ela quem decide — não a tela.
 */

export const relatoriosKeys = {
  semana: () => ['comercial', 'report-semanal'] as const,
  execucoes: () => ['comercial', 'report-execucoes'] as const,
}

export interface ExecucaoResumo {
  id: string
  periodo_inicio: string
  periodo_fim: string
  status: string
  pdf_url: string | null
  resumo_ia: string | null
}

export function useReportSemanal() {
  return useQuery({
    queryKey: relatoriosKeys.semana(),
    queryFn: async (): Promise<{ report: ReportSemanal | null; resumo: string | null; pdf: string | null }> => {
      /*
       * Duas leituras em paralelo: o snapshot ao vivo e a última execução — que é de onde
       * saem o RESUMO e o PDF. O resumo não é gerado ao abrir a tela: chamar o modelo a
       * cada abertura custaria dinheiro e daria três parágrafos diferentes para os mesmos
       * números toda vez.
       */
      const [reportRes, execRes] = await Promise.all([
        supabase.rpc('app_report_semanal' as never, { p_inicio: null, p_fim: null } as never),
        supabase
          .from('report_execucoes')
          .select('id, periodo_inicio, periodo_fim, status, pdf_url, resumo_ia')
          .eq('tipo', 'semanal_executivo')
          .order('periodo_inicio', { ascending: false })
          .limit(1),
      ])

      if (reportRes.error) throw new Error(reportRes.error.message)
      const ultima = (execRes.data ?? [])[0] as ExecucaoResumo | undefined

      return {
        report: (reportRes.data as unknown as ReportSemanal) ?? null,
        resumo: ultima?.resumo_ia ?? null,
        pdf: ultima?.pdf_url ?? null,
      }
    },
  })
}

/**
 * O link do PDF é assinado e vale cinco minutos.
 *
 * O bucket é privado porque o arquivo traz a carteira inteira e a comissão nominal de cada
 * vendedor — e o caminho (`{ano}/report-semanal-oneos-{ano}-S{semana}.pdf`) não é difícil
 * de adivinhar.
 */
export async function urlDoPdf(caminho: string): Promise<{ url: string } | { erro: string }> {
  const { data, error } = await supabase.storage
    .from('reports-semanais')
    .createSignedUrl(caminho, 300)
  // O erro volta como TEXTO: `null` transformava sessão expirada, arquivo apagado e recusa
  // de RLS na mesma tela muda, que é o que impede de descobrir por que o PDF não abriu.
  if (error || !data) return { erro: error?.message ?? 'O Storage não devolveu o link.' }
  return { url: data.signedUrl }
}
