import { useState } from 'react'
import { Keyboard, View } from 'react-native'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Text } from '@/components/ui/text'
import { notaErrorMessage, useCriarNota } from '../queries'
import { formatDateTime } from '../format'
import type { NotaComAutor } from '../types'

/** Mirrors criarNotaSchema.conteudo — max(5000). Enforced here so the user sees the ceiling. */
const MAX_CONTEUDO = 5000

function NotaItem({ nota }: { nota: NotaComAutor }) {
  // The author's `usuarios` row can be gone (deleted user), or simply not visible.
  const autor = nota.autor_nome ?? 'Usuário removido'

  return (
    <View className="flex-row gap-3">
      <Avatar nome={autor} size="sm" />
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="label" className="flex-1" numberOfLines={1}>
            {autor}
          </Text>
          <Text variant="muted" className="text-xs">
            {formatDateTime(nota.criado_em)}
          </Text>
        </View>
        <Text>{nota.conteudo}</Text>
      </View>
    </View>
  )
}

function NotaComposer({ empresaId }: { empresaId: string }) {
  const [conteudo, setConteudo] = useState('')
  const criar = useCriarNota(empresaId)

  const vazio = conteudo.trim().length === 0

  function handleChange(texto: string): void {
    setConteudo(texto)
    // The previous failure is about text the user has now changed — stop showing it.
    if (criar.isError) criar.reset()
  }

  function handleSubmit(): void {
    if (vazio || criar.isPending) return

    criar.mutate(conteudo.trim(), {
      onSuccess: () => {
        // Only clear on success — a failed note must not lose the user's typing.
        setConteudo('')
        criar.reset()
        Keyboard.dismiss()
      },
    })
  }

  return (
    <View className="gap-2">
      <Input
        value={conteudo}
        onChangeText={handleChange}
        placeholder="Escreva uma nota sobre esta empresa"
        accessibilityLabel="Nova nota"
        multiline
        maxLength={MAX_CONTEUDO}
        editable={!criar.isPending}
        // h-12 is the single-line default; twMerge lets h-24 win.
        className="h-24 py-3"
        style={{ textAlignVertical: 'top' }}
        error={criar.isError ? notaErrorMessage(criar.error) : undefined}
      />

      <View className="flex-row items-center justify-between gap-3">
        <Text variant="muted" className="text-xs">
          {conteudo.length > MAX_CONTEUDO - 500
            ? `${conteudo.length} / ${MAX_CONTEUDO}`
            : 'Visível para toda a equipe.'}
        </Text>

        <Button size="sm" onPress={handleSubmit} disabled={vazio} loading={criar.isPending}>
          <Text>Adicionar nota</Text>
        </Button>
      </View>
    </View>
  )
}

export interface NotasSectionProps {
  empresaId: string
  notas: NotaComAutor[]
}

export function NotasSection({ empresaId, notas }: NotasSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notas</CardTitle>
      </CardHeader>

      <CardContent className="gap-4">
        <NotaComposer empresaId={empresaId} />

        <Separator />

        {notas.length === 0 ? (
          <Text variant="muted">Nenhuma nota ainda. Seja o primeiro a registrar uma.</Text>
        ) : (
          <View className="gap-4">
            {notas.map((nota, index) => (
              <View key={nota.id} className="gap-4">
                {index > 0 ? <Separator /> : null}
                <NotaItem nota={nota} />
              </View>
            ))}
          </View>
        )}
      </CardContent>
    </Card>
  )
}
