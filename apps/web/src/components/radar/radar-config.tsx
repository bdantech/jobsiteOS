'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { salvarConfigAction } from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarRadarConfig, radarKeys } from './queries'

const TITULOS: Record<string, string> = {
  custos: 'Custos unitários (R$)',
  ttl_dias: 'TTL por tipo de dado (dias)',
  orcamento: 'Orçamento',
  cargos_alvo: 'Cargos-alvo (Apollo)',
  apollo: 'Parâmetros Apollo',
  protestos: 'Parâmetros de protestos',
  onepay: 'Onepay (limiar de dormência)',
  // Os tetos do Simples e do presumido mudam por LEI. Estão em config exatamente
  // porque vão mudar, e no dia em que mudarem ninguém vai procurá-los no código.
  faturamento: 'Faturamento (tetos legais e limiares do estimador)',
  funcionarios: 'Funcionários (TTL e custo unitário)',
}

function ConfigItem({ chave, valorInicial }: { chave: string; valorInicial: unknown }) {
  const qc = useQueryClient()
  const [texto, setTexto] = React.useState(() => JSON.stringify(valorInicial, null, 2))
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    let valor: unknown
    try {
      valor = JSON.parse(texto)
    } catch {
      toast.error('JSON inválido.')
      return
    }
    setSalvando(true)
    const r = await salvarConfigAction({ chave, valor })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`"${chave}" salvo.`)
    void qc.invalidateQueries({ queryKey: radarKeys.config() })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{TITULOS[chave] ?? chave}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          spellCheck={false}
          className="min-h-40 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function RadarConfig() {
  const cfg = useQuery({ queryKey: radarKeys.config(), queryFn: buscarRadarConfig })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações do Radar</h1>
        <p className="text-muted-foreground">Custos, TTLs, orçamento, cargos-alvo e parâmetros. Só admins.</p>
      </div>
      {cfg.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(cfg.data ?? []).map((c) => (
            <ConfigItem key={c.chave} chave={c.chave} valorInicial={c.valor} />
          ))}
        </div>
      )}
    </div>
  )
}
