import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { FeedbackTela } from '@/components/qualidade/feedback-tela'

export const metadata: Metadata = { title: 'Feedback — Comercial' }

// O feedback é publicado sozinho, minutos depois de cada conversa: estático serviria o de ontem.
export const dynamic = 'force-dynamic'

/**
 * A aba Feedback (05C §7): a análise das conversas devolvida a quem as teve, sem passar
 * por ninguém.
 *
 * O `?vendedor=` não é autorização: quem decide se a análise daquela pessoa pode ser lida
 * é `app_qualidade_feedback`, pelos acessos de hoje (`app_pode_ver_vendedor`, 0285), e ela
 * devolve nulo para o resto. O `?analise=` é a porta das notificações — "sua reunião foi analisada" abre
 * direto o item a item.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string; analise?: string }>
}) {
  const { ehGestor, vendedor } = await contextoComercial()
  const { vendedor: escolhido, analise } = await searchParams

  // Sem ficha de vendedor e sem gestão não há de quem ler feedback.
  if (!ehGestor && !vendedor) redirect('/comercial')

  return (
    <FeedbackTela
      ehGestor={ehGestor}
      meuVendedorId={vendedor?.id ?? null}
      vendedorInicial={escolhido ?? null}
      analiseInicial={analise ?? null}
    />
  )
}
