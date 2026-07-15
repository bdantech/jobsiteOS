import { View } from 'react-native'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { eventoLabel, formatDateTime } from '../format'
import type { EventoComAtor } from '../types'

function EventoItem({ evento, ultimo }: { evento: EventoComAtor; ultimo: boolean }) {
  // `ator_usuario_id` is null for system/cron-generated events (migration 0001).
  const ator = evento.ator_usuario_id ? (evento.ator_nome ?? 'Usuário removido') : 'Sistema'

  return (
    <View className="flex-row gap-3">
      {/* The rail: a dot per event, joined by a line that stops at the last one. */}
      <View className="items-center">
        <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
        {!ultimo ? <View className="w-px flex-1 bg-border" /> : null}
      </View>

      <View className={ultimo ? 'flex-1 gap-0.5' : 'flex-1 gap-0.5 pb-5'}>
        <Text variant="label">{eventoLabel(evento.tipo)}</Text>

        {evento.resumo ? (
          <Text variant="muted" className="text-sm">
            {evento.resumo}
          </Text>
        ) : null}

        <Text variant="muted" className="text-xs">
          {ator} · {formatDateTime(evento.criado_em)}
        </Text>
      </View>
    </View>
  )
}

/** The empresa_eventos feed: what happened, who did it, when. */
export function TimelineSection({ eventos }: { eventos: EventoComAtor[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linha do tempo</CardTitle>
      </CardHeader>

      <CardContent>
        {eventos.length === 0 ? (
          <Text variant="muted">Nenhum evento registrado.</Text>
        ) : (
          <View>
            {eventos.map((evento, index) => (
              <EventoItem
                key={evento.id}
                evento={evento}
                ultimo={index === eventos.length - 1}
              />
            ))}
          </View>
        )}
      </CardContent>
    </Card>
  )
}
