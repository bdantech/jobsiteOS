'use client'

import * as React from 'react'
import { Building2, ChartPie, Lock, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClientesOnepay } from '@/components/radar/clientes-onepay'
import { useTabsHydrated, useTabsStoreApi } from '@/components/shell/tabs-store-provider'
import { EmpresasLista } from './empresas-lista'
import { OnepayAnalyticsTab } from './onepay-analytics'

/**
 * As três abas do menu Empresas: a lista de sempre, os clientes Onepay (movidos do
 * Radar) e a análise deles em gráficos. Clientes e Análise leem dados do Radar (RLS),
 * então quem não tem o módulo vê um estado amigável em vez de tabela/gráficos vazios.
 *
 * A aba ativa vive na query `?tab=` para o link vindo do Radar (/radar/clientes →
 * /empresas?tab=clientes) cair na aba certa. A troca atualiza a URL sem recarregar.
 *
 * E ANUNCIA a URL completa para a aba do app. Sem isso, quem abria um cliente daqui e
 * clicava em "voltar" caía na aba Empresas: o store guarda pathnames (regra do topo de
 * stores/tabs.ts), e `/empresas` sem a query é literalmente outra tela. Cada aba interna
 * é um lugar diferente para quem navegou, e voltar tem de devolver ao lugar de onde saiu.
 */
const ABAS = ['todas', 'clientes', 'analise'] as const
type Aba = (typeof ABAS)[number]

function ehAba(v: string | undefined): v is Aba {
  return (ABAS as readonly string[]).includes(v ?? '')
}

function RequerRadar() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <p className="text-sm font-medium">Requer o módulo Radar</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Os clientes Onepay são dados do Radar. Peça acesso ao módulo para vê-los aqui.
        </p>
      </CardContent>
    </Card>
  )
}

/** O lugar que cada aba representa — é isto que "voltar" promete devolver. */
const LUGAR_DA_ABA: Record<Aba, { href: string; titulo: string }> = {
  todas: { href: '/empresas', titulo: 'Empresas' },
  clientes: { href: '/empresas?tab=clientes', titulo: 'Clientes Onepay' },
  analise: { href: '/empresas?tab=analise', titulo: 'Análise Onepay' },
}

export function EmpresasTabs({ temRadar, abaInicial }: { temRadar: boolean; abaInicial?: string }) {
  const [aba, setAba] = React.useState<Aba>(ehAba(abaInicial) ? abaInicial : 'todas')
  const store = useTabsStoreApi()
  const hidratado = useTabsHydrated()

  // Antes da hidratação não há aba ativa para marcar; depois dela, toda troca reanuncia.
  React.useEffect(() => {
    if (!hidratado) return
    const lugar = LUGAR_DA_ABA[aba]
    store.getState().marcarRotaCompleta(lugar.href, lugar.titulo)
  }, [aba, hidratado, store])

  function trocar(v: string) {
    if (!ehAba(v)) return
    setAba(v)
    const url = new URL(window.location.href)
    if (v === 'todas') url.searchParams.delete('tab')
    else url.searchParams.set('tab', v)
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <Tabs value={aba} onValueChange={trocar} className="space-y-4">
      {/* Mesmo formato das navs dos outros módulos (Radar/Mercado): underline, não pill. */}
      <TabsList className="mb-2 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 pb-px">
        {(
          [
            ['todas', 'Empresas', Building2],
            ['clientes', 'Clientes Onepay', Wallet],
            ['analise', 'Análise', ChartPie],
          ] as const
        ).map(([valor, rotulo, Icone]) => (
          <TabsTrigger
            key={valor}
            value={valor}
            className="shrink-0 gap-2 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 font-medium shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <Icone className="size-4" aria-hidden />
            {rotulo}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="todas" className="mt-0">
        <EmpresasLista />
      </TabsContent>

      <TabsContent value="clientes" className="mt-0">
        {temRadar ? <ClientesOnepay /> : <RequerRadar />}
      </TabsContent>

      <TabsContent value="analise" className="mt-0">
        <OnepayAnalyticsTab temRadar={temRadar} />
      </TabsContent>
    </Tabs>
  )
}
