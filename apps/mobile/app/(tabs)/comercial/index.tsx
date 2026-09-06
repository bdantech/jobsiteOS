import { useMemo, useState } from 'react'
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, useWindowDimensions, View,
} from 'react-native'
import { useRouter } from 'expo-router'
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, LayoutDashboard, Wallet,
} from 'lucide-react-native'
import {
  STATUS_CORES,
  STATUS_ROTULOS,
  STATUS_SEM_DADO,
  blocoCatalogado,
  composicaoPorChave,
  corPorEspera,
  itensUrgentes,
  ordenarItens,
  totalDeItens,
  valorEmJogo,
  type BlocoMeuDia,
  type ItemMeuDia,
  type MeuDia,
} from '@jobsiteos/core'

import { useTheme } from '@/components/color-scheme-provider'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/states'
import { Text } from '@/components/ui/text'
import { useConcluirTarefa, useMeuDia, useOcultarItem } from '@/features/comercial/meu-dia'
import { ItemMeuDiaCard, destinoDoItem } from '@/features/comercial/components/item-meu-dia'
import {
  BarrasMobile, BolhasMobile, PizzaMobile, TreemapCarteira, Widget,
  type BolhaMobile,
} from '@/features/comercial/components/graficos'
import { cn } from '@/lib/utils'

const brl = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 1000
      ? `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`
      : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/**
 * Meu Dia (04p) — e é no celular que esta tela mais importa: é a primeira coisa aberta no
 * café, antes do computador.
 *
 * ─── GRADE DE WIDGETS, NÃO PILHA DE CARDS ───────────────────────────────────
 * A primeira versão listava tudo, e o resultado foi o que uma lista longa sempre é:
 * confusa, sem foco, e fechada em vez de trabalhada. Cada bloco declara no catálogo a
 * FORMA que responde a pergunta dele (`visual`), e é essa declaração que a tela lê — o
 * mesmo campo que a web lê, então um bloco novo nasce com o widget certo nas duas
 * plataformas por dizer qual é.
 *
 * ─── O FILTRO DE GRUPO SAIU ─────────────────────────────────────────────────
 * Ele era um botão que ESCONDIA widget: o vendedor abria o dia, via nove painéis, tocava
 * em "carteira" e passava a ver três — sem nada lhe dizer que os outros seis continuavam
 * existindo. Num telefone isso é pior ainda, porque o que sumiu sai da tela inteira. Todos
 * aparecem de uma vez, e a rolagem é resposta melhor do que um filtro que apaga contexto.
 *
 * ─── O QUE CONTINUA DIFERENTE DA WEB, DE PROPÓSITO ──────────────────────────
 * A TIMELINE abre a tela: quem pega o telefone de manhã está perguntando "o que eu tenho
 * hoje", e não "quanto vale o meu dia". E o menu de três pontos da web aqui é SWIPE — a
 * mão que segura o telefone é a mesma que trabalha o item.
 */
export default function MeuDiaScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const { data, isPending, isError, refetch, isRefetching } = useMeuDia()
  const ocultar = useOcultarItem()
  const concluir = useConcluirTarefa()

  /** A largura útil de um gráfico dentro do cartão: tela − padding da lista − padding do cartão. */
  const larguraGrafico = Math.max(width - 32 - 32, 220)

  const compromissos = useMemo(() => {
    if (!data) return []
    return data.blocos
      .flatMap((b) => b.itens)
      .filter((i) => i.quando)
      .sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? ''))
      .slice(0, 6)
  }, [data])

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    )
  }
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  if (!data.tem_acesso) {
    return (
      <EmptyState
        title="Sem acesso"
        description="O módulo Comercial não está liberado para o seu perfil."
      />
    )
  }
  if (!data.vendedor_id) {
    return (
      <EmptyState
        title="Você não é vendedor"
        description="Seu usuário administra o módulo. O Meu Dia de cada pessoa fica na web."
      />
    )
  }

  const total = totalDeItens(data)
  const urgentes = itensUrgentes(data)
  const emJogo = valorEmJogo(data)
  const blocos = data.blocos.filter((b) => b.itens.length > 0)

  function adiar(bloco: string, item: ItemMeuDia, dias: number) {
    const ate = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)
    ocultar.mutate({
      tipoItem: bloco,
      referenciaId: item.referencia_id,
      acao: 'adiado',
      adiadoAte: ate,
      empresaId: item.empresa_id,
      rotulo: blocoCatalogado(bloco)?.rotulo,
    })
  }

  function descartar(bloco: string, item: ItemMeuDia) {
    ocultar.mutate({
      tipoItem: bloco,
      referenciaId: item.referencia_id,
      acao: 'irrelevante',
      motivo: 'Marcado como irrelevante no celular',
      empresaId: item.empresa_id,
      rotulo: blocoCatalogado(bloco)?.rotulo,
    })
  }

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-0.5">
        <Text className="text-xl font-semibold">
          {data.espelhado ? `Carteira de ${data.vendedor_nome ?? '—'}` : 'Meu Dia'}
        </Text>
        <Text variant="muted" className="text-xs">
          {total === 0
            ? 'Nada esperando por você agora.'
            : `${total} ${total === 1 ? 'item' : 'itens'}${
                urgentes.length > 0 ? `, ${urgentes.length} com relógio correndo` : ''
              }`}
        </Text>
      </View>

      {/* A agenda ABRE a tela no celular — é a primeira pergunta de quem acorda. */}
      {compromissos.length > 0 ? (
        <Card className="gap-2 p-4">
          <View className="flex-row items-center gap-2">
            <CalendarClock size={14} color={colors.mutedForeground} />
            <Text variant="muted" className="text-xs uppercase tracking-wide">
              A agenda de hoje
            </Text>
          </View>
          {compromissos.map((i) => (
            <View key={`${i.referencia_id}-${i.quando}`} className="flex-row items-baseline gap-2">
              <Text className="w-24 text-xs" variant="muted">
                {i.quando
                  ? new Date(i.quando).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </Text>
              <Text numberOfLines={1} className="flex-1 text-sm">
                {i.titulo}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {/* Indicadores em carrossel: o número grande sem ocupar a tela inteira. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 pr-4"
        className="-mx-4 px-4"
      >
        <IndicadorMobile
          Icone={Wallet}
          rotulo="Em jogo hoje"
          valor={brl(emJogo)}
          detalhe={`${total} ${total === 1 ? 'item' : 'itens'}`}
        />
        <IndicadorMobile
          Icone={AlertTriangle}
          rotulo="Urgentes"
          valor={String(urgentes.length)}
          detalhe={urgentes.length > 0 ? 'com relógio correndo' : 'nada vencendo'}
          alerta={urgentes.length > 0}
        />
        {data.tipo === 'sdr' ? (
          <IndicadorMobile
            Icone={Clock}
            rotulo="Inbound sem resposta"
            valor={String(data.blocos.find((b) => b.tipo === 'inbound_nao_contatado')?.total ?? 0)}
            detalhe="minutos importam"
          />
        ) : (
          <IndicadorMobile
            Icone={Wallet}
            rotulo={data.tipo === 'originador' ? 'NF alta parada' : 'Limite ocioso'}
            valor={brl(
              data.blocos.find((b) =>
                b.tipo === (data.tipo === 'originador' ? 'nfs_alta_nao_prospectadas' : 'carteira_ociosa'),
              )?.valor_total ?? 0,
            )}
            detalhe="esperando trabalho"
          />
        )}
      </ScrollView>

      {/*
        O mapa da carteira ABRE os widgets, e não os fecha. Para o closer ele é o retrato de
        onde está o dinheiro pelo qual ele responde — o contexto de tudo o que vem depois.
      */}
      {data.mapa_carteira.length > 0 ? (
        <Widget
          titulo="Minha carteira passiva"
          descricao="Área pelo limite, cor pelo temperature report"
          contexto={String(data.mapa_carteira.length)}
        >
          <TreemapCarteira
            clientes={data.mapa_carteira}
            largura={larguraGrafico}
            onCliente={(c) => c.empresa_id && router.push(`/empresas/${c.empresa_id}`)}
          />
        </Widget>
      ) : null}

      {blocos.length === 0 ? (
        <Card className="items-center gap-2 p-8">
          <CheckCircle2 size={32} color={colors.primary} />
          <Text className="text-base font-medium">Tudo em dia por aqui</Text>
          <Text variant="muted" className="text-center text-sm">
            Nenhum item pedindo ação agora.
          </Text>
        </Card>
      ) : (
        blocos.map((bloco) => (
          <WidgetDoBloco
            key={bloco.tipo}
            bloco={bloco}
            largura={larguraGrafico}
            onAdiar={(item, dias) => adiar(bloco.tipo, item, dias)}
            onDescartar={(item) => descartar(bloco.tipo, item)}
            onConcluir={(item) => concluir.mutate(String(item.meta.tarefa_id))}
          />
        ))
      )}

      {data.funil_semana.length > 0 ? <FunilSemana etapas={data.funil_semana} /> : null}
      {data.evolucao.length > 0 ? <Evolucao serie={data.evolucao} /> : null}

      {/*
        O painel do mês fica no rodapé, e não no topo: ele responde "como está o meu mês",
        que é consulta. O que abre a tela é o trabalho de hoje.
      */}
      <Pressable onPress={() => router.push('/comercial/painel')}>
        <Card className="flex-row items-center justify-between p-4">
          <View className="flex-row items-center gap-2">
            <LayoutDashboard size={16} color={colors.mutedForeground} />
            <Text className="font-medium">Meu painel do mês</Text>
          </View>
          <Text variant="muted" className="text-xs">comissão, funis e agenda</Text>
        </Card>
      </Pressable>
    </ScrollView>
  )
}

// ─── O widget de um bloco, escolhido pelo catálogo ──────────────────────────

/** A natureza da conta na carteira do closer. As duas pedem ligação, mas não a mesma. */
type Natureza = 'todas' | 'passivo' | 'prospeccao_ativa'

const NATUREZA_ROTULO: Record<Natureza, string> = {
  todas: 'Ambas',
  passivo: 'Passiva',
  prospeccao_ativa: 'Ativa',
}

function WidgetDoBloco({
  bloco, largura, onAdiar, onDescartar, onConcluir,
}: {
  bloco: BlocoMeuDia
  largura: number
  onAdiar: (item: ItemMeuDia, dias: number) => void
  onDescartar: (item: ItemMeuDia) => void
  onConcluir: (item: ItemMeuDia) => void
}) {
  const router = useRouter()
  const [fatia, setFatia] = useState<string | null>(null)
  const [natureza, setNatureza] = useState<Natureza>('todas')

  const cat = blocoCatalogado(bloco.tipo)
  const rotulo = cat?.rotulo ?? bloco.tipo
  const contexto = bloco.valor_total > 0 ? brl(bloco.valor_total) : String(bloco.total)
  const restantes = bloco.total - bloco.itens.length

  const abrir = (item: ItemMeuDia) => {
    const rota = destinoDoItem(bloco.tipo, item)
    if (rota) router.push(rota)
  }

  // ── Pizza: de quem é o volume parado ──────────────────────────────────────
  if (cat?.visual === 'pizza') {
    const daFatia = fatia
      ? bloco.itens.filter((i) => String(i.meta.cedente_nome ?? i.titulo) === fatia)
      : []
    return (
      <Widget
        titulo={rotulo}
        descricao="Por cedente — doze notas do mesmo fornecedor são uma conversa, não doze"
        contexto={contexto}
      >
        <PizzaMobile
          fatias={composicaoPorChave(bloco.itens, 'cedente_nome')}
          fatiaAtiva={fatia}
          onFatia={setFatia}
        />
        {fatia && daFatia.length > 0 ? (
          <View className="gap-1 border-t border-border pt-2">
            <Text variant="muted" className="text-[11px]">
              {daFatia.length} nota(s) de {fatia}
            </Text>
            {ordenarItens(daFatia).slice(0, 5).map((i) => (
              <Pressable
                key={i.referencia_id}
                onPress={() => abrir(i)}
                className="flex-row items-baseline justify-between gap-2 py-0.5 active:opacity-60"
              >
                <Text numberOfLines={1} className="flex-1 text-xs">{i.subtitulo ?? i.titulo}</Text>
                <Text className="text-xs font-medium">{brl(i.valor ?? 0)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Widget>
    )
  }

  // ── Bolhas: certificados ──────────────────────────────────────────────────
  if (cat?.visual === 'bolhas' && bloco.tipo === 'certificados_a_prospectar') {
    const bolhas: BolhaMobile[] = bloco.itens.map((i) => {
      const status = String(i.meta.operation_status ?? '')
      return {
        id: i.referencia_id,
        nome: i.titulo,
        x: Number(i.meta.faltantes ?? 0),
        y: Number(i.meta.limite_ocioso ?? 0),
        tamanho: Number(i.meta.limite_ocioso ?? 0),
        cor: STATUS_CORES[status] ?? STATUS_SEM_DADO,
        detalhe: `${i.meta.faltantes} CNPJ(s) cegos · ${brl(Number(i.meta.limite_ocioso ?? 0))}${
          STATUS_ROTULOS[status] ? ` · ${STATUS_ROTULOS[status]}` : ''
        }`,
      }
    })
    return (
      <Widget
        titulo={rotulo}
        descricao="Quanto está parado × quantos CNPJs estão cegos"
        contexto={contexto}
      >
        <BolhasMobile
          bolhas={bolhas}
          rotuloX="CNPJs sem certificado"
          rotuloY="Limite ocioso"
          largura={largura}
          onBolha={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) abrir(item)
          }}
        />
      </Widget>
    )
  }

  // ── Bolhas: inbound do SDR ────────────────────────────────────────────────
  if (cat?.visual === 'bolhas' && bloco.tipo === 'inbound_nao_contatado') {
    const bolhas: BolhaMobile[] = bloco.itens.map((i) => ({
      id: i.referencia_id,
      nome: i.titulo,
      x: Number(i.meta.horas ?? i.dias ?? 0),
      y: i.valor ?? 0,
      tamanho: i.valor ?? 1,
      cor: corPorEspera(Number(i.meta.horas ?? 0)),
      detalhe: `${i.meta.horas}h sem contato · ${brl(i.valor ?? 0)}/mês`,
    }))
    return (
      <Widget
        titulo={rotulo}
        descricao="Tamanho pelo faturamento, cor pela espera — azul agora, vermelho às 96h"
        contexto={String(bloco.total)}
      >
        <BolhasMobile
          bolhas={bolhas}
          rotuloX="horas sem contato"
          rotuloY="Potencial mensal"
          dominioX={[0, 96]}
          formatarX={(n) => `${Math.round(n)}h`}
          largura={largura}
          onBolha={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) abrir(item)
          }}
        />
      </Widget>
    )
  }

  // ── Barras: ranking por uma grandeza ──────────────────────────────────────
  if (cat?.visual === 'barras') {
    const ehEspera = bloco.tipo === 'conversas_aguardando_resposta'
    const ehCarteira = bloco.tipo === 'carteira_ociosa'

    const naNatureza = (i: ItemMeuDia, n: Natureza) =>
      n === 'todas' || String(i.meta.gestao_operacao ?? '') === n
    const doFiltro = ehCarteira ? bloco.itens.filter((i) => naNatureza(i, natureza)) : bloco.itens

    /* A barra mais longa continua sendo a maior do BLOCO, e não a do recorte: trocar a
       referência a cada filtro faria a segunda maior conta virar 100%. */
    const teto = Math.max(
      ...bloco.itens.map((i) => (ehEspera ? Number(i.meta.horas ?? 0) : (i.valor ?? 0))),
      1,
    )
    const itens = ordenarItens(doFiltro).slice(0, 6).map((i) => ({
      id: i.referencia_id,
      nome: i.titulo,
      valor: ehEspera ? Number(i.meta.horas ?? 0) : (i.valor ?? 0),
      cor: ehEspera
        ? corPorEspera(Number(i.meta.horas ?? 0))
        : STATUS_CORES[String(i.meta.operation_status ?? '')],
    }))
    const sobrando = doFiltro.length - itens.length

    return (
      <Widget
        titulo={rotulo}
        descricao={
          ehEspera
            ? 'Do que espera há mais tempo para o mais recente'
            : ehCarteira
              ? 'Do maior limite parado para o menor, com a cor do report'
              : cat.descricao
        }
        contexto={ehCarteira ? brl(doFiltro.reduce((s, i) => s + (i.valor ?? 0), 0)) : contexto}
        rodape={
          doFiltro.length === 0 ? (
            <Text variant="muted" className="text-[11px]">
              Nenhuma conta desta natureza está com limite parado.
            </Text>
          ) : sobrando > 0 ? (
            <Text variant="muted" className="text-[11px]">e mais {sobrando}</Text>
          ) : null
        }
      >
        {ehCarteira ? (
          <View className="flex-row rounded-lg border border-border p-0.5">
            {(['todas', 'passivo', 'prospeccao_ativa'] as const).map((v) => (
              <Pressable
                key={v}
                onPress={() => setNatureza(v)}
                accessibilityRole="button"
                accessibilityState={{ selected: natureza === v }}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5',
                  natureza === v ? 'bg-primary' : 'active:opacity-60',
                )}
              >
                <Text
                  className={cn(
                    'text-center text-[11px]',
                    natureza === v ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {NATUREZA_ROTULO[v]} {bloco.itens.filter((i) => naNatureza(i, v)).length}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <BarrasMobile
          itens={itens}
          maximo={teto}
          formatar={ehEspera ? (n) => `${n}h` : brl}
          onItem={(id) => {
            const item = bloco.itens.find((i) => i.referencia_id === id)
            if (item) abrir(item)
          }}
        />
      </Widget>
    )
  }

  // ── Rolagem: a lista longa que cabe num cartão ────────────────────────────
  if (cat?.visual === 'rolagem') {
    /* Rolagem DENTRO de rolagem é briga de gesto no celular: a lista interna rouba o
       arrasto da página. Os seis primeiros, ordenados pelo que emitem, e o resto na web. */
    const topo = ordenarItens(bloco.itens).slice(0, 6)
    return (
      <Widget
        titulo={rotulo}
        descricao={`${bloco.total} no total, do que mais emite para o que menos`}
        contexto={contexto}
        rodape={
          bloco.total > topo.length ? (
            <Text variant="muted" className="text-[11px]">
              e mais {bloco.total - topo.length} — a lista completa está na web
            </Text>
          ) : null
        }
      >
        <View className="gap-2">
          {topo.map((i) => (
            <Pressable
              key={i.referencia_id}
              onPress={() => abrir(i)}
              accessibilityRole="button"
              className="flex-row items-baseline justify-between gap-2 active:opacity-60"
            >
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-xs font-medium">{i.titulo}</Text>
                {i.subtitulo ? (
                  <Text numberOfLines={1} variant="muted" className="text-[11px]">{i.subtitulo}</Text>
                ) : null}
              </View>
              {i.valor ? <Text className="text-xs font-medium">{brl(i.valor)}</Text> : null}
            </Pressable>
          ))}
        </View>
      </Widget>
    )
  }

  // ── Lista: o padrão, e o único lugar onde o SWIPE trabalha ────────────────
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="font-semibold">{rotulo}</Text>
        {bloco.valor_total > 0 ? (
          <Text variant="muted" className="text-xs">{brl(bloco.valor_total)}</Text>
        ) : null}
      </View>
      {ordenarItens(bloco.itens).map((item) => (
        <ItemMeuDiaCard
          key={item.referencia_id}
          item={item}
          bloco={bloco.tipo}
          onAdiar={(dias) => onAdiar(item, dias)}
          onDescartar={() => onDescartar(item)}
          onConcluir={() => onConcluir(item)}
        />
      ))}
      {restantes > 0 ? (
        <Text variant="muted" className="text-xs">
          e mais {restantes} — a lista completa está na web
        </Text>
      ) : null}
    </View>
  )
}

// ─── Rodapé ─────────────────────────────────────────────────────────────────

function FunilSemana({ etapas }: { etapas: MeuDia['funil_semana'] }) {
  return (
    <Widget titulo="A sua semana" descricao="Contatados → com fit → agendados → realizados">
      <View className="flex-row gap-2">
        {etapas.map((e, i) => {
          const anterior = etapas[i - 1]?.total ?? null
          const taxa = anterior && anterior > 0 ? Math.round((e.total / anterior) * 100) : null
          return (
            <View key={e.etapa} className="flex-1 rounded-lg border border-border p-2">
              <Text numberOfLines={1} variant="muted" className="text-[10px]">{e.etapa}</Text>
              <Text className="text-lg font-semibold">{e.total}</Text>
              {taxa !== null ? (
                <Text variant="muted" className="text-[10px]">{taxa}%</Text>
              ) : null}
            </View>
          )
        })}
      </View>
    </Widget>
  )
}

function Evolucao({ serie }: { serie: MeuDia['evolucao'] }) {
  const maior = Math.max(...serie.map((s) => s.total), 1)
  return (
    <Widget titulo="Conversões do mês" descricao="Contra a média dos três meses anteriores">
      <View className="gap-2">
        {serie.map((s) => (
          <View key={s.competencia} className="gap-1">
            <View className="flex-row justify-between">
              <Text variant="muted" className="text-[11px]">
                {new Date(s.competencia).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}
              </Text>
              <Text className="text-[11px]">
                {brl(s.total)}
                {s.media_3m ? (
                  <Text className={s.total >= s.media_3m ? 'text-emerald-600' : 'text-amber-600'}>
                    {'  '}{s.total >= s.media_3m ? '↑' : '↓'} {brl(s.media_3m)}
                  </Text>
                ) : null}
              </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-muted">
              <View
                className="h-full rounded-full bg-primary"
                style={{ width: `${(s.total / maior) * 100}%` }}
              />
            </View>
          </View>
        ))}
      </View>
    </Widget>
  )
}

function IndicadorMobile({
  Icone, rotulo, valor, detalhe, alerta = false,
}: {
  Icone: typeof Wallet
  rotulo: string
  valor: string
  detalhe: string
  alerta?: boolean
}) {
  const { colors } = useTheme()
  return (
    <Card className={cn('w-44 gap-1 p-3', alerta && 'border-red-500/40')}>
      <View className="flex-row items-center gap-1.5">
        <Icone size={12} color={alerta ? colors.destructive : colors.mutedForeground} />
        <Text variant="muted" className="text-[10px] uppercase tracking-wide">
          {rotulo}
        </Text>
      </View>
      <Text className="text-xl font-semibold">{valor}</Text>
      <Text variant="muted" className="text-[11px]">{detalhe}</Text>
    </Card>
  )
}
