import * as ImagePicker from 'expo-image-picker'
import { usePathname, useRouter } from 'expo-router'
import { Bug, Camera, ChevronRight, Image as ImageIcon, Lightbulb, X } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  DESCRICAO_PLACEHOLDER,
  STATUS_REPORT_DESCRICOES,
  STATUS_REPORT_LABELS,
  TITULO_PLACEHOLDER,
  linhasDoContexto,
  type StatusReport,
  type TipoReport,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import { contextoDoApp, useCriarReport, useMeusReports } from './queries'

/** Altura do painel como fração da tela. */
const PANEL_RATIO = 0.88
/**
 * A cromagem do próprio <Sheet> acima dos nossos filhos: o bloco da alça (pt-2 +
 * h-1 + pb-1) mais o pt-1 do container de conteúdo. Subtraída porque o sheet
 * dimensiona a caixa de conteúdo pelo filho — e o filho precisa de altura
 * DEFINIDA, ou a lista rola empurrando o botão de enviar para fora do painel.
 */
const SHEET_CHROME = 24
/** O <Sheet> já reserva isto no fim do container de conteúdo. */
const SHEET_BOTTOM_PAD = 16

/**
 * O sheet de reportar no celular (04m §2/§6).
 *
 * Duas abas, como na web: escrever e acompanhar. A diferença que importa é o
 * anexo — aqui ele vem da CÂMERA, e é o caso de uso mais forte da ferramenta
 * inteira: quem está na obra fotografa a tela travada em dois toques, enquanto
 * na web a mesma pessoa teria de saber tirar um print e achar o arquivo.
 *
 * O título é desenhado AQUI, e não pelas props do <Sheet>: o cabeçalho precisa
 * estar dentro da caixa de altura definida para o cálculo fechar. É o mesmo
 * desenho do sheet do chat de IA, pela mesma razão.
 */
export function ReportSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [aba, setAba] = useState<'novo' | 'meus'>('novo')
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  const contentHeight = Math.max(
    height * PANEL_RATIO - SHEET_CHROME - SHEET_BOTTOM_PAD - insets.bottom,
    320,
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        // Reabre sempre no formulário: quem toca no ícone quer reportar. O
        // RASCUNHO fica — <Formulario> não é desmontado —, porque perder três
        // parágrafos por um toque fora do painel é como alguém desiste de reportar.
        if (!v) setAba('novo')
      }}
      className="h-[88%]"
    >
      <View style={{ height: contentHeight }} className="flex-col">
        <View className="gap-1 pb-3">
          <Text variant="heading">Reportar</Text>
          <Text variant="muted">
            Um problema que você viu ou uma ideia que facilitaria o seu trabalho.
          </Text>
        </View>

        <View className="flex-row gap-2 pb-2">
          <Aba ativa={aba === 'novo'} onPress={() => setAba('novo')} rotulo="Novo report" />
          <Aba ativa={aba === 'meus'} onPress={() => setAba('meus')} rotulo="Meus reports" />
        </View>

        <View className="flex-1">
          {aba === 'novo' ? (
            <Formulario onEnviado={() => setAba('meus')} />
          ) : (
            <MeusReports onFechar={() => onOpenChange(false)} />
          )}
        </View>
      </View>
    </Sheet>
  )
}

function Aba({ ativa, onPress, rotulo }: { ativa: boolean; onPress: () => void; rotulo: string }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: ativa }}
      onPress={onPress}
      className={cn(
        'flex-1 items-center rounded-lg py-2',
        ativa ? 'bg-secondary' : 'bg-transparent',
      )}
    >
      <Text className={ativa ? 'font-semibold' : 'text-muted-foreground'}>{rotulo}</Text>
    </Pressable>
  )
}

// ─── Formulário ─────────────────────────────────────────────────────────────

function Formulario({ onEnviado }: { onEnviado: () => void }) {
  const pathname = usePathname()
  const { colors } = useTheme()
  const [tipo, setTipo] = useState<TipoReport>('bug')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [anexo, setAnexo] = useState<{ uri: string; tipo: string | null } | null>(null)
  const [verContexto, setVerContexto] = useState(false)

  // Montado no render, com a rota em que a pessoa estava quando abriu o sheet.
  const contexto = useMemo(() => contextoDoApp(pathname), [pathname])
  const criar = useCriarReport()

  const podeEnviar = titulo.trim().length >= 3 && descricao.trim().length >= 5

  async function escolherImagem(origem: 'camera' | 'galeria') {
    const permissao =
      origem === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permissao.granted) {
      Alert.alert(
        'Sem acesso',
        origem === 'camera'
          ? 'Autorize a câmera nas configurações para fotografar a tela.'
          : 'Autorize as fotos nas configurações para anexar um print.',
      )
      return
    }
    const r =
      origem === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] })
    if (r.canceled || !r.assets[0]) return
    setAnexo({ uri: r.assets[0].uri, tipo: r.assets[0].mimeType ?? null })
  }

  function enviar() {
    criar.mutate(
      { tipo, titulo, descricao, contexto, anexoUri: anexo?.uri, anexoTipo: anexo?.tipo },
      {
        onSuccess: (d) => {
          setTitulo('')
          setDescricao('')
          setAnexo(null)
          Alert.alert(
            `Report #${d.numero} enviado`,
            'Você acompanha o andamento em "Meus reports".',
          )
          onEnviado()
        },
        onError: (e) =>
          Alert.alert('Não foi possível enviar', e instanceof Error ? e.message : 'Falha no envio.'),
      },
    )
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 pb-6" keyboardShouldPersistTaps="handled">
      {/* Dois botões grandes, não um seletor: a escolha muda o resto do formulário. */}
      <View className="flex-row gap-2">
        <BotaoTipo
          ativo={tipo === 'bug'}
          onPress={() => setTipo('bug')}
          icone={<Bug size={20} color={tipo === 'bug' ? colors.primary : colors.mutedForeground} />}
          titulo="Bug"
          descricao="Algo não funciona"
        />
        <BotaoTipo
          ativo={tipo === 'melhoria'}
          onPress={() => setTipo('melhoria')}
          icone={
            <Lightbulb size={20} color={tipo === 'melhoria' ? colors.primary : colors.mutedForeground} />
          }
          titulo="Melhoria"
          descricao="Poderia ser melhor"
        />
      </View>

      <Input
        label="Título"
        value={titulo}
        maxLength={140}
        placeholder={TITULO_PLACEHOLDER[tipo]}
        onChangeText={setTitulo}
      />

      <Input
        label="Descrição"
        value={descricao}
        maxLength={5000}
        placeholder={DESCRICAO_PLACEHOLDER[tipo]}
        onChangeText={setDescricao}
        multiline
        numberOfLines={5}
        // `h-12` do Input é altura de campo de uma linha; um textarea precisa de
        // altura própria e do texto começando em cima.
        className="h-28 py-3"
        textAlignVertical="top"
      />

      <View className="gap-1.5">
        <Text variant="label">Anexo (opcional)</Text>
        {anexo ? (
          <View className="flex-row items-center gap-2 rounded-lg border border-input px-3 py-2">
            <ImageIcon size={16} color={colors.mutedForeground} />
            <Text className="flex-1 text-sm">Imagem anexada</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remover anexo"
              hitSlop={8}
              onPress={() => setAnexo(null)}
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => void escolherImagem('camera')}>
              <View className="flex-row items-center gap-2">
                <Camera size={16} color={colors.foreground} />
                <Text>Câmera</Text>
              </View>
            </Button>
            <Button variant="outline" className="flex-1" onPress={() => void escolherImagem('galeria')}>
              <View className="flex-row items-center gap-2">
                <ImageIcon size={16} color={colors.foreground} />
                <Text>Galeria</Text>
              </View>
            </Button>
          </View>
        )}
      </View>

      {/*
        Colapsado, e não escondido: o usuário tem direito de ver exatamente o que
        viaja junto com o texto dele. Um campo invisível anexado ao report é a
        diferença entre capturar contexto e coletar dado sem avisar.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: verContexto }}
        onPress={() => setVerContexto((v) => !v)}
        className="rounded-lg border border-dashed border-input px-3 py-2"
      >
        <View className="flex-row items-center gap-1.5">
          <ChevronRight
            size={14}
            color={colors.mutedForeground}
            style={{ transform: [{ rotate: verContexto ? '90deg' : '0deg' }] }}
          />
          <Text variant="muted" className="text-xs">
            Detalhes técnicos incluídos automaticamente
          </Text>
        </View>
        {verContexto ? (
          <View className="gap-1 pt-2">
            {linhasDoContexto(contexto).map((l) => (
              <View key={l.rotulo} className="flex-row gap-2">
                <Text variant="muted" className="w-20 text-xs">
                  {l.rotulo}
                </Text>
                <Text className="flex-1 text-xs">{l.valor}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>

      <Button disabled={!podeEnviar} loading={criar.isPending} onPress={enviar}>
        <Text>Enviar</Text>
      </Button>
    </ScrollView>
  )
}

function BotaoTipo({
  ativo,
  onPress,
  icone,
  titulo,
  descricao,
}: {
  ativo: boolean
  onPress: () => void
  icone: React.ReactNode
  titulo: string
  descricao: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      onPress={onPress}
      className={cn(
        'flex-1 gap-1 rounded-lg border p-3',
        ativo ? 'border-primary bg-primary/5' : 'border-input',
      )}
    >
      {icone}
      <Text className={cn('font-semibold', ativo && 'text-primary')}>{titulo}</Text>
      <Text variant="muted" className="text-xs">
        {descricao}
      </Text>
    </Pressable>
  )
}

// ─── Meus reports ───────────────────────────────────────────────────────────

function MeusReports({ onFechar }: { onFechar: () => void }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { data, isPending, isError } = useMeusReports()

  if (isPending) {
    return (
      <View className="items-center py-10">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) {
    return (
      <Text variant="muted" className="py-10 text-center">
        Não foi possível carregar.
      </Text>
    )
  }
  if (data.length === 0) {
    return (
      <Text variant="muted" className="py-10 text-center">
        Você ainda não reportou nada. O que você mandar aparece aqui com o status atual.
      </Text>
    )
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-2 pb-6">
      {data.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => {
            // Fecha o sheet ANTES de navegar: um sheet montado sobre uma rota que
            // mudou fica preso sobre a tela nova, sem gesto que o dispense.
            onFechar()
            router.push(`/reports/${r.id}`)
          }}
          className="gap-1.5 rounded-lg border border-input p-3 active:bg-secondary"
        >
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
          <Text className="text-sm">{r.titulo}</Text>
          <Text variant="muted" className="text-xs">
            {STATUS_REPORT_DESCRICOES[r.status as StatusReport] ?? ''}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}
