import { View } from 'react-native'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { formatCnpj, formatInteiro } from '../../format'
import type { GrupoEconomico, MembroGrupo } from '../../types'
import { MembroCard } from './membro-card'

export interface GrupoHeaderProps {
  grupo: GrupoEconomico
  /** The controlling company, when it is among the members we loaded. */
  cabeca: MembroGrupo | null
  empresasTotal: number
  onPressCabeca: (membro: MembroGrupo) => void
}

/**
 * The group's identity, then its head.
 *
 * The head is the company that controls the others — the reason the group exists
 * as an object at all. A big incorporadora is not one CNPJ: it is a holding plus
 * dozens or hundreds of SPEs, and reading only the holding underdimensions it by
 * an order of magnitude. That is the entire point of this screen.
 */
export function GrupoHeader({ grupo, cabeca, empresasTotal, onPressCabeca }: GrupoHeaderProps) {
  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text variant="title">{grupo.nome ?? 'Grupo econômico'}</Text>
        <Text variant="muted">
          Grupo econômico · {formatInteiro(empresasTotal)}{' '}
          {empresasTotal === 1 ? 'empresa' : 'empresas'}
        </Text>
      </View>

      <Card>
        <CardHeader>
          <CardTitle>Cabeça do grupo</CardTitle>
        </CardHeader>
        <CardContent>
          {cabeca ? (
            <MembroCard membro={cabeca} onPress={onPressCabeca} />
          ) : (
            <View className="gap-1">
              <Text variant="muted">
                {grupo.cnpj_cabeca
                  ? // The head CNPJ is recorded, but its row is not among the
                    // members loaded here — it sits outside the page, outside the
                    // construction cut, or behind RLS.
                    'A empresa cabeça não está entre as empresas carregadas nesta tela.'
                  : 'A cabeça deste grupo ainda não foi identificada pela última ingestão.'}
              </Text>
              {grupo.cnpj_cabeca ? (
                <Text variant="muted" className="text-xs" selectable>
                  {formatCnpj(grupo.cnpj_cabeca)}
                </Text>
              ) : null}
            </View>
          )}
        </CardContent>
      </Card>
    </View>
  )
}
