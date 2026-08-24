'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AnaliseFunil, type FunilId } from './analise-funil'
import { buscarVendedoresVisiveis, comercialKeys } from './queries'

/**
 * A tela de análise, com os dois funis.
 *
 * O seletor de vendedor usa `buscarVendedoresVisiveis` — a MESMA fonte do filtro dos
 * funis. Uma lista própria aqui divergiria da outra no dia em que a régua de quem-vê-quem
 * mudasse, e a análise passaria a oferecer recortes que o funil não abre.
 */
export function AnaliseDoFunilTela() {
  const [funil, setFunil] = React.useState<FunilId>('vendedor')
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)

  const alcance = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  // O tipo do vendedor decide em qual funil ele aparece: um SDR não tem negócios, e um
  // closer não tem leads. Oferecer o nome errado produziria uma análise vazia sem dizer
  // por quê — que é pior que não oferecer.
  const doTipo = (alcance.data ?? []).filter((v) => v.tipo === (funil === 'sdr' ? 'sdr' : 'vendedor'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(['vendedor', 'sdr'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={funil === f ? 'secondary' : 'ghost'}
              onClick={() => {
                setFunil(f)
                // O vendedor selecionado pode não existir no outro funil — um SDR não tem
                // negócios. Manter a seleção mostraria uma análise vazia sem explicar por quê.
                setVendedorId(null)
              }}
            >
              {f === 'vendedor' ? 'Funil de vendas' : 'Funil de SDR'}
            </Button>
          ))}
        </div>

        <Select
          value={vendedorId ?? 'todos'}
          onValueChange={(v) => setVendedorId(v === 'todos' ? null : v)}
        >
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {doTipo.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AnaliseFunil funil={funil} vendedorId={vendedorId} />
    </div>
  )
}
