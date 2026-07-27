'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { desmonitorarProtestoAction, monitorarProtestoAction } from '@/actions/radar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { buscarSpesMonitoramento, radarKeys, type SpeMonitoramento } from '@/components/radar/queries'

const anoDe = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null)

/**
 * Curadoria das SPEs "afiançadas" que entram no monitoramento MENSAL de protesto
 * (rotina do dia 5). Mostrada na aba Grupo econômico. É dado do Radar: se o usuário
 * não tem o módulo, o RPC devolve tem_acesso:false e a seção some (não polui a aba,
 * que é do módulo Empresas/Mercado).
 */
export function MonitoramentoProtesto({ grupoId }: { grupoId: string }) {
  const qc = useQueryClient()
  const [termo, setTermo] = React.useState('')
  const [pendente, setPendente] = React.useState<Set<string>>(new Set())

  const { data, isPending } = useQuery({
    queryKey: radarKeys.spesMonitoramento(grupoId),
    queryFn: () => buscarSpesMonitoramento(grupoId),
  })

  if (isPending) return <Skeleton className="h-40 w-full" />
  if (!data || !data.tem_acesso) return null // sem Radar: seção não aparece.

  const spes = data.spes
  const monitoradas = spes.filter((s) => s.monitorada).length
  const filtro = termo.trim().toLowerCase()
  const digitos = filtro.replace(/\D/g, '')
  const visiveis = spes.filter((s) => {
    if (!filtro) return true
    const nome = (s.razao_social ?? '').toLowerCase()
    return nome.includes(filtro) || (digitos.length >= 2 && s.cnpj.includes(digitos))
  })

  async function alternar(spe: SpeMonitoramento, ligar: boolean) {
    setPendente((p) => new Set(p).add(spe.cnpj))
    const r = ligar
      ? await monitorarProtestoAction(spe.cnpj)
      : await desmonitorarProtestoAction(spe.cnpj)
    setPendente((p) => {
      const n = new Set(p)
      n.delete(spe.cnpj)
      return n
    })
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(ligar ? 'SPE adicionada ao monitoramento.' : 'SPE removida do monitoramento.')
    void qc.invalidateQueries({ queryKey: radarKeys.spesMonitoramento(grupoId) })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wide">Monitoramento de protesto</span>
        </div>
        <CardTitle className="text-base">SPEs afiançadas ({monitoradas} monitorada(s))</CardTitle>
        <CardDescription>
          As SPEs marcadas entram na rotina mensal de protesto (DirectD nacional, dia 5), junto
          dos clientes Onepay. Marque só as que você garante.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {spes.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Este grupo não tem SPEs identificadas.
          </p>
        ) : (
          <>
            {spes.length > 8 ? (
              <Input
                placeholder="Filtrar por nome ou CNPJ…"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                autoComplete="off"
              />
            ) : null}
            <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {visiveis.map((s) => {
                const ano = anoDe(s.data_inicio_atividade)
                const meta = [s.situacao_cadastral, ano ? `desde ${ano}` : null].filter(Boolean).join(' · ')
                return (
                  <li key={s.cnpj} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.razao_social ?? formatCnpj(s.cnpj)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatCnpj(s.cnpj)}
                        {meta ? ` · ${meta}` : ''}
                      </p>
                    </div>
                    <Switch
                      checked={s.monitorada}
                      disabled={pendente.has(s.cnpj)}
                      onCheckedChange={(v) => void alternar(s, v)}
                      aria-label={`Monitorar ${s.razao_social ?? s.cnpj}`}
                    />
                  </li>
                )
              })}
              {visiveis.length === 0 ? (
                <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                  Nenhuma SPE encontrada.
                </li>
              ) : null}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
