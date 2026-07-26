'use client'

import * as React from 'react'
import { Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ClientesOnepay } from '@/components/radar/clientes-onepay'
import { EmpresasLista } from './empresas-lista'
import { OnepayAnalyticsTab } from './onepay-analytics'

/**
 * As três abas do menu Empresas: a lista de sempre, os clientes Onepay (movidos do
 * Radar) e a análise deles em gráficos. Clientes e Análise leem dados do Radar (RLS),
 * então quem não tem o módulo vê um estado amigável em vez de tabela/gráficos vazios.
 *
 * A aba ativa vive na query `?tab=` para o link vindo do Radar (/radar/clientes →
 * /empresas?tab=clientes) cair na aba certa. A troca atualiza a URL sem recarregar.
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

export function EmpresasTabs({ temRadar, abaInicial }: { temRadar: boolean; abaInicial?: string }) {
  const [aba, setAba] = React.useState<Aba>(ehAba(abaInicial) ? abaInicial : 'todas')

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
      <TabsList>
        <TabsTrigger value="todas">Empresas</TabsTrigger>
        <TabsTrigger value="clientes">Clientes Onepay</TabsTrigger>
        <TabsTrigger value="analise">Análise</TabsTrigger>
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
