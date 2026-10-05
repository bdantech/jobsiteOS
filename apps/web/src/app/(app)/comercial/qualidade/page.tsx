import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { contextoComercial } from '@/lib/comercial'
import { QualidadeTela } from '@/components/qualidade/gestao/qualidade-tela'

export const metadata: Metadata = { title: 'Qualidade' }

// Fila de contestações e rotulagem são o estado AGORA; estático serviria a fila de ontem.
export const dynamic = 'force-dynamic'

/**
 * Comercial → Qualidade (05C §8–§13): a tela do gestor da Inteligência de Conversas.
 * Só web — não há versão no celular, e a navegação a marca `webOnly`.
 *
 * Guarda na PÁGINA, não só na navegação: o mesmo padrão de /painel e /admin. Todas as
 * RPCs por trás recusam quem não é gestor, mas recusar aba por aba é pior que não deixar
 * entrar.
 *
 * O `?aba=` existe porque as notificações apontam para cá (contestação aberta →
 * `?aba=contestacoes`, rubrica versionada → `?aba=rubricas`, recalibração →
 * `?aba=calibracao`). Valor desconhecido cai na visão geral, na tela.
 */
export default async function Pagina({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { ehGestor } = await contextoComercial()
  if (!ehGestor) redirect('/comercial')

  const { aba } = await searchParams

  /*
   * A URL do webhook que se cadastra no Fireflies é a URL PÚBLICA do worker — que só o
   * servidor conhece (WORKER_URL não é NEXT_PUBLIC_, de propósito). Ela não é segredo: o
   * Fireflies precisa dela, e quem assina a entrega é o segredo do webhook, que nunca
   * sai do Vault. Por isso só a URL montada desce para a tela, e só para gestor.
   */
  const base = process.env.WORKER_URL
  let urlWebhookFireflies: string | null = null
  if (base) {
    try {
      urlWebhookFireflies = new URL('/webhooks/fireflies', base).toString()
    } catch {
      urlWebhookFireflies = null
    }
  }

  return <QualidadeTela abaInicial={aba ?? null} urlWebhookFireflies={urlWebhookFireflies} />
}
