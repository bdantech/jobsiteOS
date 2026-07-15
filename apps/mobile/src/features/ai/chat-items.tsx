import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Check,
  PlusCircle,
  Search,
  ShieldQuestion,
} from 'lucide-react-native'
import { ActivityIndicator, Pressable, View } from 'react-native'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge, Button, Skeleton, Text } from '@/components/ui'

import type { ChatItem } from './reducer'

/**
 * The tool `label` the server sends is the tool's NAME ("Buscar empresas") — an
 * infinitive, which reads wrong in a progress line. These are the pt-BR gerunds
 * for the tools we ship; anything unregistered falls back to the server's label,
 * so a new module renders sensibly on day one without touching this file.
 */
const RUNNING_LABELS: Record<string, string> = {
  'empresas.search': 'Buscando empresas',
  'empresas.create': 'Criando empresa',
}

function runningLabel(tool: string, label: string): string {
  return RUNNING_LABELS[tool] ?? label
}

function UserBubble({ text }: { text: string }) {
  return (
    <View className="items-end">
      <View className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5">
        <Text className="text-primary-foreground">{text}</Text>
      </View>
    </View>
  )
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <View className="items-start">
      <View className="max-w-[92%] rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5">
        <Text className="text-secondary-foreground">{text}</Text>
      </View>
    </View>
  )
}

/** The gap between "sent" and the first token — the chat's loading state. */
export function ThinkingBubble() {
  return (
    <View className="items-start" accessibilityLabel="A IA está pensando">
      <View className="w-48 gap-2 rounded-2xl rounded-bl-sm bg-secondary px-4 py-3">
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-2/3 rounded-full" />
      </View>
    </View>
  )
}

interface LinkChipsProps {
  links: readonly { route: string; label: string }[]
  onOpenRoute: (route: string) => void
}

/** empresas.search returns a `route` per row; this is how the model "navigates". */
function LinkChips({ links, onOpenRoute }: LinkChipsProps) {
  const { colors } = useTheme()
  if (links.length === 0) return null

  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {links.map((link) => (
        <Pressable
          key={link.route}
          accessibilityRole="link"
          accessibilityLabel={`Abrir ${link.label}`}
          onPress={() => onOpenRoute(link.route)}
          className="flex-row items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 active:bg-secondary"
        >
          <Text className="text-sm font-medium text-foreground">{link.label}</Text>
          <ArrowUpRight size={14} color={colors.mutedForeground} />
        </Pressable>
      ))}
    </View>
  )
}

interface ToolRowProps {
  item: Extract<ChatItem, { kind: 'tool' }>
  onOpenRoute: (route: string) => void
}

function ToolRow({ item, onOpenRoute }: ToolRowProps) {
  const { colors } = useTheme()

  const Icon = item.mutates ? PlusCircle : Search
  const iconColor =
    item.state === 'error'
      ? colors.destructive
      : item.state === 'ok'
        ? colors.primary
        : colors.mutedForeground

  const text =
    item.state === 'running'
      ? `${runningLabel(item.tool, item.label)}…`
      : item.state === 'awaiting'
        ? `${item.label} — aguardando sua confirmação`
        : item.summary || item.label

  return (
    <View className="items-start">
      <View className="max-w-[92%] rounded-lg border border-border bg-muted/50 px-3 py-2">
        <View className="flex-row items-center gap-2">
          {item.state === 'running' ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Icon size={15} color={iconColor} />
          )}
          <Text
            className={
              item.state === 'error'
                ? 'flex-shrink text-sm text-destructive'
                : 'flex-shrink text-sm text-muted-foreground'
            }
          >
            {text}
          </Text>
        </View>

        {item.state === 'ok' ? <LinkChips links={item.links} onOpenRoute={onOpenRoute} /> : null}
      </View>
    </View>
  )
}

interface ConfirmCardProps {
  item: Extract<ChatItem, { kind: 'confirm' }>
  /** False while the resume request is in flight — the buttons must not double-fire. */
  disabled: boolean
  onDecide: (id: string, approved: boolean) => void
}

/**
 * The gate in front of every `mutates: true` tool. Nothing has run when this
 * renders: the server staged the tool and ended its turn. The write only happens
 * on the follow-up request that carries this verdict.
 */
function ConfirmCard({ item, disabled, onDecide }: ConfirmCardProps) {
  const { colors } = useTheme()

  return (
    <View className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <View className="flex-row items-center gap-2">
        <ShieldQuestion size={16} color={colors.primary} />
        <Text variant="label" className="flex-shrink">
          {item.question}
        </Text>
      </View>

      {item.fields.length > 0 ? (
        <View className="mt-3 gap-1.5 rounded-lg border border-border bg-background p-3">
          {item.fields.map((field) => (
            <View key={field.label} className="flex-row justify-between gap-3">
              <Text variant="muted" className="flex-shrink-0">
                {field.label}
              </Text>
              <Text className="flex-1 text-right text-sm text-foreground">{field.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {item.decision === undefined ? (
        <View className="mt-3 flex-row justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onPress={() => onDecide(item.id, false)}
          >
            <Text>Cancelar</Text>
          </Button>
          <Button size="sm" disabled={disabled} onPress={() => onDecide(item.id, true)}>
            <Text>Confirmar</Text>
          </Button>
        </View>
      ) : (
        <View className="mt-3 flex-row justify-end">
          <Badge variant={item.decision ? 'success' : 'secondary'}>
            <View className="flex-row items-center gap-1">
              {item.decision ? (
                <Check size={12} color={colors.primary} />
              ) : (
                <Ban size={12} color={colors.mutedForeground} />
              )}
              <Text className="text-xs">{item.decision ? 'Confirmado' : 'Cancelado'}</Text>
            </View>
          </Badge>
        </View>
      )}
    </View>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <View className="items-center px-4">
      <Text variant="muted" className="text-center text-xs">
        {text}
      </Text>
    </View>
  )
}

interface ErrorRowProps {
  item: Extract<ChatItem, { kind: 'error' }>
  onRetry: () => void
  onRecover: () => void
}

function ErrorRow({ item, onRetry, onRecover }: ErrorRowProps) {
  const { colors } = useTheme()

  return (
    <View className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
      <View className="flex-row items-start gap-2">
        <AlertTriangle size={16} color={colors.destructive} />
        <Text className="flex-1 text-sm text-destructive">{item.text}</Text>
      </View>

      {item.recovery === 'retry' ? (
        <View className="mt-3 flex-row justify-end">
          <Button variant="outline" size="sm" onPress={onRetry}>
            <Text>Tentar novamente</Text>
          </Button>
        </View>
      ) : null}

      {/* A turn that carried a confirmed mutation is never re-sent automatically:
          the write may already have landed. The user acknowledges and moves on. */}
      {item.recovery === 'continue' ? (
        <View className="mt-3 gap-2">
          <Text variant="muted" className="text-xs">
            A ação pode ou não ter sido concluída. Verifique antes de pedir de novo.
          </Text>
          <View className="flex-row justify-end">
            <Button variant="outline" size="sm" onPress={onRecover}>
              <Text>Continuar conversa</Text>
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export interface ChatItemViewProps {
  item: ChatItem
  /** True while a resume request is in flight. */
  busy: boolean
  onOpenRoute: (route: string) => void
  onDecide: (id: string, approved: boolean) => void
  onRetry: () => void
  onRecover: () => void
}

export function ChatItemView({
  item,
  busy,
  onOpenRoute,
  onDecide,
  onRetry,
  onRecover,
}: ChatItemViewProps) {
  switch (item.kind) {
    case 'user':
      return <UserBubble text={item.text} />
    case 'assistant':
      return <AssistantBubble text={item.text} />
    case 'tool':
      return <ToolRow item={item} onOpenRoute={onOpenRoute} />
    case 'confirm':
      return <ConfirmCard item={item} disabled={busy} onDecide={onDecide} />
    case 'notice':
      return <Notice text={item.text} />
    case 'error':
      return <ErrorRow item={item} onRetry={onRetry} onRecover={onRecover} />
  }
}
