'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { ESTAGIOS, ESTAGIO_LABELS, type Tables } from '@jobsiteos/core'
import { atualizarEmpresaAction } from '@/actions/empresas'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { labelEstagio } from './estagio-badge'
import { empresasKeys } from './queries'

/**
 * The single control that moves a company through the funnel. It goes through
 * atualizarEmpresaAction -> atualizarEmpresa() -> app_atualizar_empresa, which
 * is what emits the `estagio.alterado` event (and the audit_log row) in the same
 * transaction as the update. Writing `estagio` any other way would produce a
 * company whose timeline lies about how it got where it is.
 *
 * É SÓ o controle. O cabeçalho que existia em volta dele virou a ficha
 * (components/ficha), compartilhada com o universo — este arquivo guarda apenas a
 * ação, que é a única coisa aqui que não é layout.
 */
export function EmpresaAcaoEstagio({ empresa }: { empresa: Tables<'empresas'> }) {
  const [salvando, setSalvando] = React.useState(false)
  const queryClient = useQueryClient()

  async function alterarEstagio(valor: string) {
    if (valor === empresa.estagio) return

    setSalvando(true)
    const resultado = await atualizarEmpresaAction({ id: empresa.id, estagio: valor })
    setSalvando(false)

    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }

    queryClient.setQueryData(empresasKeys.detalhe(empresa.id), resultado.data)
    // The timeline gained an `estagio.alterado` row, and the list shows the badge.
    await queryClient.invalidateQueries({ queryKey: empresasKeys.all })

    toast.success(`Estágio alterado: ${labelEstagio(empresa.estagio)} → ${labelEstagio(valor)}`)
  }

  return (
    <div className="flex items-center gap-2">
      {salvando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      <Select value={empresa.estagio} onValueChange={alterarEstagio} disabled={salvando}>
        <SelectTrigger className="w-44" aria-label="Alterar estágio">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ESTAGIOS.map((estagio) => (
            <SelectItem key={estagio} value={estagio}>
              {ESTAGIO_LABELS[estagio]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
