import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native'
import {
  STATUS_REPORT_DESCRICOES,
  STATUS_REPORT_LABELS,
  linhasDoContexto,
  type StatusReport,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { EmptyState } from '@/components/ui/states'
import { BannerBeta } from '@/features/reports'
import { useComentarReport, useComentarios, useReport } from '@/features/reports'

/**
 * O destino do deep link da notificação (04m §4).
 *
 * `notificacoes.url` guarda uma rota WEB (`/reports/<uuid>`), e o arquivo mora
 * aqui justamente para que a mesma string resolva nas duas plataformas —
 * `resolveNotificationHref` não a bloqueia porque ela não pertence a módulo
 * nenhum, e reportar não é privilégio de módulo.
 *
 * Quem decide o que aparece é a RLS: o report de outra pessoa simplesmente não
 * vem, e a tela mostra "não encontrado". Dizer "sem permissão" confirmaria que
 * ele existe.
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()
  const report = useReport(id ?? null)
  const comentarios = useComentarios(id ?? null)

  if (report.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }

  if (!report.data) {
    return (
      <EmptyState
        title="Report não encontrado"
        description="Ele pode ter sido removido, ou pertence a outra pessoa."
      />
    )
  }

  const r = report.data

  return (
    <>
      <BannerBeta />

      <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-4 pb-12">
        <Card>
          <CardHeader>
            <View className="flex-row items-center gap-2">
              <Text variant="muted" className="font-mono text-xs">
                #{r.numero}
              </Text>
              <Badge variant="outline">
                <Text className="text-[10px]">
                  {STATUS_REPORT_LABELS[r.status as StatusReport] ?? r.status}
                </Text>
              </Badge>
            </View>
            <CardTitle>{r.titulo}</CardTitle>
          </CardHeader>

          <CardContent className="gap-3">
            {/* O que o status QUER DIZER, e não só o rótulo. "Não procede" sem
                explicação lê-se como desprezo; com a frase, lê-se como resposta. */}
            <Text variant="muted" className="text-xs">
              {STATUS_REPORT_DESCRICOES[r.status as StatusReport] ?? ''}
            </Text>

            <Text className="text-sm">{r.descricao}</Text>

            <View className="gap-1 rounded-lg border border-dashed border-input p-2">
              {linhasDoContexto(r.contexto as never).map((l) => (
                <View key={l.rotulo} className="flex-row gap-2">
                  <Text variant="muted" className="w-20 text-xs">
                    {l.rotulo}
                  </Text>
                  <Text className="flex-1 text-xs">{l.valor}</Text>
                </View>
              ))}
            </View>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comentários</CardTitle>
          </CardHeader>
          <CardContent className="gap-3">
            {comentarios.isPending ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (comentarios.data ?? []).length === 0 ? (
              <Text variant="muted" className="text-sm">
                Ainda sem comentários.
              </Text>
            ) : (
              (comentarios.data ?? []).map((c) => (
                <View key={c.id} className="gap-0.5 rounded-lg bg-muted/50 p-2">
                  <Text variant="muted" className="text-xs">
                    {c.autor_nome ?? 'Equipe'} ·{' '}
                    {new Date(c.criado_em).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </Text>
                  <Text className="text-sm">{c.texto}</Text>
                </View>
              ))
            )}

            <Responder reportId={r.id} />
          </CardContent>
        </Card>
      </ScrollView>
    </>
  )
}

function Responder({ reportId }: { reportId: string }) {
  const [texto, setTexto] = useState('')
  const comentar = useComentarReport(reportId)

  return (
    <View className="gap-2">
      <Input
        value={texto}
        placeholder="Responder…"
        maxLength={5000}
        onChangeText={setTexto}
        multiline
        className="h-20 py-3"
        textAlignVertical="top"
      />
      <Button
        size="sm"
        disabled={texto.trim().length === 0}
        loading={comentar.isPending}
        onPress={() =>
          comentar.mutate(texto, {
            onSuccess: () => setTexto(''),
            onError: (e) =>
              Alert.alert(
                'Não foi possível comentar',
                e instanceof Error ? e.message : 'Falha ao enviar.',
              ),
          })
        }
      >
        <Text>Enviar</Text>
      </Button>
    </View>
  )
}
