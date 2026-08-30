import { ACAO_LABELS, primeiroNome, renderizarMensagem, type AcaoAgente, type BaseLegal } from '@jobsiteos/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bot, Check, Send, X } from 'lucide-react-native'
import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge, Button, Input, Skeleton, Text } from '@/components/ui'
import {
  aceitarSugestao,
  buscarContatos,
  buscarConversas,
  buscarTemplates,
  buscarThread,
  comunicacaoKeys,
  descartarSugestao,
  enviarMensagem,
  marcarLida,
  type MensagemThread,
} from '../api'
import { dataHora, intencaoLabel } from '../format'

/**
 * A conversa no celular: sugestão do agente no topo, thread no meio, compositor
 * embaixo.
 *
 * ── A SUGESTÃO FICA ACIMA DA THREAD ────────────────────────────────────────
 * Quem abre uma conversa no celular está entre uma coisa e outra e tem tempo para
 * uma ação. A sugestão pronta é essa ação; enterrá-la abaixo de vinte bolhas
 * significaria nunca ser vista num telefone.
 *
 * ── O COMPOSITOR NÃO É UM CAMPO DE CHAT ────────────────────────────────────
 * Ele tem template e escolha de contato, como na web, porque a mensagem que sai
 * daqui é a mesma que sai de lá — mesma fila, mesmo portão, mesmo ledger.
 */
export function Conversa({ conversaId }: { conversaId: string }) {
  const qc = useQueryClient()
  const { colors } = useTheme()

  const thread = useQuery({
    queryKey: comunicacaoKeys.thread(conversaId),
    queryFn: () => buscarThread(conversaId),
  })
  const conversas = useQuery({
    queryKey: comunicacaoKeys.inbox('todas'),
    queryFn: () => buscarConversas('todas'),
  })
  const conversa = (conversas.data ?? []).find((c) => c.id === conversaId) ?? null

  // Abrir é ler.
  React.useEffect(() => {
    if (!conversa || (conversa.nao_lidas ?? 0) === 0) return
    void marcarLida(conversaId).then(() => qc.invalidateQueries({ queryKey: comunicacaoKeys.all }))
  }, [conversa, conversaId, qc])

  const aceitar = useMutation({
    mutationFn: (id: string) => aceitarSugestao(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: comunicacaoKeys.all }),
  })
  const descartar = useMutation({
    mutationFn: (id: string) => descartarSugestao(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: comunicacaoKeys.all }),
  })

  if (thread.isPending) {
    return (
      <View className="gap-3 p-4">
        <Skeleton className="h-16 w-3/4 rounded-xl" />
        <Skeleton className="h-16 w-2/3 self-end rounded-xl" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerClassName="p-4 gap-3">
        {conversa?.sugestao_id ? (
          <View className="gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <View className="flex-row items-center gap-2">
              <Bot size={16} color={colors.primary} />
              <Text className="font-medium">Próximo passo sugerido</Text>
              <Badge variant="outline">
                {ACAO_LABELS[(conversa.sugestao_acao ?? '') as AcaoAgente] ?? conversa.sugestao_acao}
              </Badge>
            </View>
            {conversa.sugestao_justificativa ? (
              <Text variant="muted" className="text-xs">
                {conversa.sugestao_justificativa}
              </Text>
            ) : null}
            {conversa.sugestao_conteudo ? (
              <View className="rounded-lg border border-border bg-background p-2">
                <Text className="text-sm">{conversa.sugestao_conteudo}</Text>
              </View>
            ) : null}
            <View className="flex-row gap-2">
              <Button
                size="sm"
                onPress={() => aceitar.mutate(conversa.sugestao_id!)}
                disabled={aceitar.isPending}
              >
                <Check size={14} color="#fff" />
                <Text>Enviar</Text>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => descartar.mutate(conversa.sugestao_id!)}
                disabled={descartar.isPending}
              >
                <X size={14} color={colors.mutedForeground} />
                <Text>Descartar</Text>
              </Button>
            </View>
          </View>
        ) : null}

        {(thread.data ?? []).map((m) => (
          <Bolha key={m.id} m={m} />
        ))}
      </ScrollView>

      {conversa?.empresa_id ? (
        <Compositor
          empresaId={conversa.empresa_id}
          contatoIdInicial={conversa.contato_id}
          canalInicial={(conversa.canal as 'whatsapp' | 'email') ?? 'whatsapp'}
        />
      ) : (
        <View className="border-t border-border p-4">
          <Text variant="muted" className="text-center text-sm">
            Esta conversa ainda não está vinculada a uma empresa.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  )
}

function Bolha({ m }: { m: MensagemThread }) {
  const entrada = m.direcao === 'entrada'
  const intencao = intencaoLabel(m.triagem)
  const quem = entrada
    ? (m.contato_nome ?? 'Contato')
    : m.por_ia
      ? `${m.vendedor_nome ?? 'IA'} (IA)`
      : (m.vendedor_nome ?? m.usuario_nome ?? 'Equipe')

  return (
    <View
      className={`max-w-[85%] rounded-xl border p-3 ${
        entrada ? 'self-start bg-muted/40' : 'self-end bg-primary/5'
      } ${m.status_envio === 'falhou' ? 'border-destructive' : 'border-border'}`}
    >
      <View className="mb-1 flex-row flex-wrap items-center gap-1.5">
        <Text variant="muted" className="text-[11px]">
          {quem} · {dataHora(m.criado_em)}
        </Text>
        {intencao ? <Badge variant="outline">{intencao}</Badge> : null}
      </View>
      {m.assunto ? <Text className="mb-1 font-medium text-sm">{m.assunto}</Text> : null}
      <Text className="text-sm">{m.corpo ?? m.preview ?? '(sem texto)'}</Text>
      {m.origem === 'app_toque' ? (
        <Text variant="muted" className="mt-1 text-[11px] italic">
          Registro de que o app foi aberto — não sabemos se a mensagem saiu.
        </Text>
      ) : null}
      {m.erro ? (
        <Text className="mt-1 text-[11px] text-destructive">{m.erro}</Text>
      ) : null}
    </View>
  )
}

function Compositor({
  empresaId,
  contatoIdInicial,
  canalInicial,
}: {
  empresaId: string
  contatoIdInicial: string | null
  canalInicial: 'whatsapp' | 'email'
}) {
  const qc = useQueryClient()
  const { colors } = useTheme()
  const [canal] = React.useState<'whatsapp' | 'email'>(canalInicial)
  const [corpo, setCorpo] = React.useState('')
  const [erro, setErro] = React.useState<string | null>(null)

  const contatos = useQuery({
    queryKey: comunicacaoKeys.contatos(empresaId),
    queryFn: () => buscarContatos(empresaId),
  })
  const templates = useQuery({
    queryKey: comunicacaoKeys.templates(canal),
    queryFn: () => buscarTemplates(canal),
  })

  const contato =
    (contatos.data ?? []).find((c) => c.id === contatoIdInicial) ?? (contatos.data ?? [])[0] ?? null

  const enviar = useMutation({
    mutationFn: async () => {
      if (!contato) throw new Error('Nenhum contato nesta empresa.')
      await enviarMensagem({ canal, contato_id: contato.id, corpo })
    },
    onSuccess: async () => {
      setCorpo('')
      setErro(null)
      await qc.invalidateQueries({ queryKey: comunicacaoKeys.all })
    },
    onError: (e: Error) => setErro(e.message),
  })

  return (
    <View className="gap-2 border-t border-border p-3">
      {(templates.data ?? []).length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {(templates.data ?? []).map((t) => (
            <Pressable
              key={t.id}
              onPress={() =>
                setCorpo(
                  renderizarMensagem(
                    t.corpo,
                    { contato_nome: primeiroNome(contato?.nome) },
                    { canal, baseLegal: (contato?.base_legal ?? null) as BaseLegal | null },
                  ),
                )
              }
            >
              <Badge variant="outline">{t.nome}</Badge>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {erro ? (
        <View className="flex-row items-center gap-1.5">
          <AlertTriangle size={14} color={colors.destructive} />
          <Text className="flex-1 text-xs text-destructive">{erro}</Text>
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
        <Input
          value={corpo}
          onChangeText={setCorpo}
          placeholder={contato ? `Escrever para ${contato.nome ?? 'contato'}` : 'Sem contato'}
          multiline
          className="h-auto min-h-12 flex-1 py-3"
        />
        <Button
          size="sm"
          onPress={() => enviar.mutate()}
          disabled={!corpo.trim() || !contato || enviar.isPending}
        >
          <Send size={16} color="#fff" />
        </Button>
      </View>
      <Text variant="muted" className="text-[11px]">
        A mensagem entra na fila e sai na próxima janela de envio.
      </Text>
    </View>
  )
}
