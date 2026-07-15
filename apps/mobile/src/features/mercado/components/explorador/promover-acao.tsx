import { formatCnpj } from '@jobsiteos/core'
import { useRouter } from 'expo-router'
import { ArrowUpRight, Building2 } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { promoverErrorMessage, usePromoverEmpresa } from './queries'
import type { UniversoRegistro } from './types'

export interface PromoverAcaoProps {
  universo: UniversoRegistro
}

/**
 * The one write the mobile Explorador performs.
 *
 * Promotion is a CLASSIFICATION event, not a relationship one: the company lands
 * in `empresas` with estagio 'mercado' — nobody has talked to them yet. The copy
 * has to say what the user gets (timeline, notas, eventos), not imply a deal.
 */
export function PromoverAcao({ universo }: PromoverAcaoProps) {
  const router = useRouter()
  const { colors } = useTheme()
  const [confirmando, setConfirmando] = useState(false)

  const promover = usePromoverEmpresa(universo.cnpj)

  // Already promoted: the sheet is a dead end, so send the user where the company
  // actually lives.
  if (universo.empresa_id) {
    return (
      <Button
        variant="outline"
        onPress={() => router.replace(`/empresas/${universo.empresa_id}`)}
        accessibilityLabel="Abrir esta empresa na base de Empresas"
      >
        <ArrowUpRight size={18} color={colors.foreground} />
        <Text>Ver na base de Empresas</Text>
      </Button>
    )
  }

  const nome = universo.razao_social ?? formatCnpj(universo.cnpj)

  return (
    <View className="gap-2">
      <Button
        onPress={() => setConfirmando(true)}
        loading={promover.isPending}
        accessibilityLabel="Promover esta empresa para a base de Empresas"
      >
        <Building2 size={18} color={colors.primaryForeground} />
        <Text>Promover para Empresas</Text>
      </Button>

      {promover.isError ? (
        <Text variant="destructive">{promoverErrorMessage(promover.error)}</Text>
      ) : null}

      <ConfirmDialog
        open={confirmando}
        onOpenChange={(open) => {
          setConfirmando(open)
          // The previous failure was about a dialog the user has now dismissed.
          if (!open && promover.isError) promover.reset()
        }}
        title="Promover para Empresas"
        description={`${nome} passa a existir na base de Empresas, com timeline, notas e eventos. A camada atual (${universo.camada}) é preservada; o estágio começa em "Mercado".`}
        confirmLabel="Promover"
        loading={promover.isPending}
        onConfirm={() => {
          promover.mutate(undefined, {
            onSuccess: (empresa) => {
              setConfirmando(false)
              // replace, not push: going "back" to the staging sheet of a company
              // that is now promoted would show the wrong screen for the row.
              router.replace(`/empresas/${empresa.id}`)
            },
            onError: () => setConfirmando(false),
          })
        }}
      />
    </View>
  )
}
