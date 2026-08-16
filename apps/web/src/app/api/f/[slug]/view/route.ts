import { NextResponse } from 'next/server'
import { normalizarUtm } from '@jobsiteos/core'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * Uma linha por render do formulário — o DENOMINADOR da taxa de conversão.
 *
 * Sem ele o dashboard sabe quantos enviaram e nunca quantos viram e desistiram, que é
 * a única métrica capaz de dizer se o problema está no formulário ou no tráfego.
 *
 * Responde 204 SEMPRE, inclusive quando falha. Um beacon de telemetria que devolve
 * erro é um erro no console da landing page do cliente por um dado que não é dele.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  try {
    const corpo = (await req.json()) as { pagina_url?: string; utm?: Record<string, unknown> }
    const utm = normalizarUtm(corpo.utm)
    const supabase = createAdminClient()

    const { data: form } = await supabase
      .from('formularios')
      .select('id')
      .eq('slug', slug)
      .eq('ativo', true)
      .maybeSingle()
    if (!form) return new NextResponse(null, { status: 204, headers: CORS })

    await supabase.from('formulario_visualizacoes').insert({
      formulario_id: form.id,
      utm_source: utm.utm_source ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      pagina_url: corpo.pagina_url?.slice(0, 2000) ?? null,
    })
  } catch {
    // Silêncio proposital: ver §acima.
  }
  return new NextResponse(null, { status: 204, headers: CORS })
}
