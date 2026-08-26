import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ReportPagina } from '@/components/reports/report-pagina'

export const metadata: Metadata = { title: 'Report' }

// O status muda por ação de outra pessoa. Renderizar estaticamente mostraria o
// estado do build — e é justamente uma mudança de estado que traz alguém aqui.
export const dynamic = 'force-dynamic'

/**
 * O destino do deep link da notificação (04m §4): "Seu report #42 mudou para
 * Em correção" → esta página.
 *
 * Ela existe porque uma notificação precisa de uma ROTA. "Meus reports" vive
 * dentro do modal da barra de topo, e um modal não tem URL — o push abriria a
 * aplicação sem levar a lugar nenhum, que é como um deep link deixa de ser link.
 *
 * NÃO tem guard de módulo, e não pode ter: reportar é direito de qualquer usuário
 * ativo, inclusive de um perfil sem módulo nenhum. Quem decide o que se vê aqui é
 * a RLS — `reports_select` entrega a linha ao autor e ao admin, e a mais ninguém.
 * Um report de outra pessoa vira 404, que é a resposta certa: dizer "sem
 * permissão" confirmaria que o report existe.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { usuario } = await requireSessionContext()

  const supabase = await createClient()
  const { data } = await supabase
    .from('reports')
    .select(
      'id, numero, tipo, titulo, descricao, status, prioridade, contexto, anexo_url, criado_por, criado_em',
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  return <ReportPagina report={data} ehAutor={data.criado_por === usuario.id} />
}
