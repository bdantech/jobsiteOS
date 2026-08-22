import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { cssDoFormulario, htmlDoFormulario, type FormularioPublico } from '@/lib/leads/render'
import { scriptDoFormulario } from '@/lib/leads/comportamento'

export const dynamic = 'force-dynamic'

/**
 * A página standalone: `/f/{slug}`.
 *
 * Existe para bio de rede social, QR code em evento e assinatura de e-mail — os
 * lugares onde não há landing page em que embutir. É o MESMO HTML e o MESMO
 * comportamento do embed (`lib/leads/`), montado sem shadow DOM porque aqui a página
 * é nossa e não há CSS de terceiro do que se defender.
 *
 * Fora do grupo `(app)`: sem sessão, sem menu, sem middleware de autenticação. Quem
 * chega aqui não tem conta e não deveria precisar de uma.
 */

async function carregar(slug: string): Promise<FormularioPublico | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.rpc('formulario_publico', { p_slug: slug })
  return (data as unknown as FormularioPublico) ?? null
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await props.params
  const f = await carregar(slug)
  return {
    title: f?.titulo ?? 'Formulário',
    description: f?.subtitulo ?? undefined,
    // Uma página de captação não deve competir com a landing page do cliente na
    // busca — nem aparecer no Google como se fosse o site dele.
    robots: { index: false, follow: false },
  }
}

export default async function Pagina(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const f = await carregar(slug)
  if (!f) notFound()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-10">
      {/*
       * A fonte também aqui, e não só pelo `garantirFonte()` do comportamento: nesta
       * página o HTML é nosso, e o link no markup começa a baixar a Poppins junto do
       * documento em vez de esperar o JS. O helper continua rodando e é idempotente pelo
       * id — dois links iguais seriam dois downloads.
       */}
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        id="jos-fonte"
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
      />
      <style dangerouslySetInnerHTML={{ __html: cssDoFormulario() }} />
      <div dangerouslySetInnerHTML={{ __html: htmlDoFormulario(f) }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `${scriptDoFormulario(process.env.NEXT_PUBLIC_APP_URL ?? '')}
;(function () {
  function montar() { window.__josMontar(document, ${JSON.stringify(slug)}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();`,
        }}
      />
    </main>
  )
}
