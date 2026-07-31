'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTabsHydrated, useTabsStore } from '@/components/shell/tabs-store-provider'

/**
 * O "voltar" de uma ficha: volta para a tela que trouxe a pessoa até aqui.
 *
 * Uma empresa é alcançada de muitos lugares — a lista de Empresas, "Sacados a
 * prospectar", o funil da Antecipação, um lote do Radar, o Explorador. Um voltar fixo
 * em `/empresas` mandava todo mundo para a lista, inclusive quem nunca esteve nela: era
 * um botão que dizia "voltar" e fazia outra coisa.
 *
 * A rota anterior vem da aba do app (stores/tabs), não do histórico do navegador nem de
 * `document.referrer`. `router.back()` sai do app quando a pessoa chegou por link direto,
 * e `document.referrer` não acompanha navegação client-side do Next — ele congela no
 * primeiro carregamento e passaria a mentir da segunda navegação em diante.
 */
export function VoltarContextual({
  padrao,
}: {
  /** Para onde ir quando não há de onde voltar — link direto, aba nova, primeira tela. */
  padrao: { href: string; label: string }
}) {
  const pathname = usePathname()
  const hidratado = useTabsHydrated()
  const anterior = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.anterior)

  // Antes da hidratação o store está vazio: renderizar o padrão e trocar depois faria o
  // rótulo piscar. O destino é sempre válido, só o texto espera meio quadro.
  const destino =
    hidratado && anterior && anterior.route !== pathname
      ? { href: anterior.route, label: anterior.title }
      : padrao

  return (
    <Button variant="ghost" size="sm" asChild className="-ml-3 text-muted-foreground">
      <Link href={destino.href}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {destino.label}
      </Link>
    </Button>
  )
}
