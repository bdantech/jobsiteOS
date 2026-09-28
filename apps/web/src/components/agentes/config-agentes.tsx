'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, OctagonX, Phone, Power, ShieldCheck } from 'lucide-react'
import {
  FERRAMENTAS,
  METRICA_DISJUNTOR_LABELS,
  POLITICAS_IDENTIFICACAO,
  POLITICA_IDENTIFICACAO_LABELS,
  REGRAS_DURAS_IDENTIFICACAO,
  type ConfigAgentes,
  type MetricaDisjuntor,
  type PoliticaIdentificacao,
} from '@jobsiteos/core'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { salvarConfigAgentesAction } from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { brlCentavos, centavosDeTexto, dataHora, numeroBr, pct, textoDeCentavos } from './gestao-format'
import {
  buscarConfigAgentes,
  buscarOrcamentoMes,
  gestaoAgentesKeys,
  type OrcamentoMes,
  type VozStatus,
} from './queries-gestao'
import { PlaybooksMandato } from './playbooks-mandato'
import { RegrasMandato } from './regras-mandato'
import { SomenteGestores } from './somente-gestores'

/**
 * CONFIGURAÇÕES DOS AGENTES (Prompt 09 §12) — `webOnly`, só gestor.
 *
 * ─── O KILL SWITCH É ÚNICO E FICA NO TOPO ───────────────────────────────────
 * Hoje voz e agente de conversa têm switches separados (`antecipacao_config.voz` e
 * `comunicacao_config.agente`): desligar em emergência exigia lembrar dos dois. O de
 * `agentes_config.geral.kill_switch` é o único que a tela oferece, e a RPC o espelha nos
 * dois antigos durante a transição. Fica no topo, grande, com confirmação — é o botão
 * que se aperta quando algo está saindo errado AGORA, e não pode estar numa aba.
 *
 * ─── CADA SEÇÃO SALVA SÓ A SUA CHAVE ────────────────────────────────────────
 * `salvarConfigAgentes({chave, valor})` faz merge parcial no banco. Salvar a janela não
 * reescreve os preços com o que estava na tela há dez minutos — e o kill switch, salvo
 * por outra pessoa nesse meio-tempo, não é desfeito por quem só mudou o horizonte.
 */
export function ConfigAgentesTela() {
  return (
    <SomenteGestores titulo="As configurações dos agentes">
      <Configuracoes />
    </SomenteGestores>
  )
}

type Chave = 'geral' | 'janela' | 'precos' | 'disjuntor' | 'orcamento'

function useSalvar() {
  const qc = useQueryClient()
  return async (chave: Chave, valor: Record<string, unknown>, sucesso = 'Configuração salva.'): Promise<boolean> => {
    const r = await salvarConfigAgentesAction({ chave, valor })
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(sucesso)
    void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.config() })
    if (chave === 'orcamento') void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.orcamento() })
    return true
  }
}

function Configuracoes() {
  const cfg = useQuery({ queryKey: gestaoAgentesKeys.config(), queryFn: buscarConfigAgentes })
  const orc = useQuery({ queryKey: gestaoAgentesKeys.orcamento(), queryFn: buscarOrcamentoMes })
  // Controlada para o botão "Playbooks por tipo de mandato" da aba de regras trazer aqui.
  const [aba, setAba] = React.useState('operacao')

  if (cfg.isPending) return <Skeleton className="h-96 w-full" />
  if (cfg.isError) {
    return (
      <div className={cn('rounded-lg border p-4 text-sm', STATUS_SUPERFICIE.critical)}>
        Não foi possível carregar as configurações: {cfg.error.message}
      </div>
    )
  }
  const c = cfg.data.config

  return (
    <div className="space-y-4">
      <KillSwitch ligado={c.geral.kill_switch} />
      <VersaoAna status={cfg.data.vozStatus} />

      <Tabs value={aba} onValueChange={setAba} className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="operacao">Operação</TabsTrigger>
          <TabsTrigger value="precos">Preços</TabsTrigger>
          <TabsTrigger value="disjuntor">Disjuntor padrão</TabsTrigger>
          <TabsTrigger value="regras">Regras de mandato</TabsTrigger>
          <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
        </TabsList>

        <TabsContent value="operacao" className="mt-0 space-y-4">
          <Orcamento config={c} mes={orc.data ?? null} carregando={orc.isPending} />
          <Identificacao valor={c.geral.identificacao} />
          <Ciclo config={c} />
          <Janela config={c} />
        </TabsContent>
        <TabsContent value="precos" className="mt-0">
          <Precos config={c} />
        </TabsContent>
        <TabsContent value="disjuntor" className="mt-0">
          <DisjuntorPadrao config={c} />
        </TabsContent>
        <TabsContent value="regras" className="mt-0">
          <RegrasMandato onAbrirPlaybooks={() => setAba('playbooks')} />
        </TabsContent>
        <TabsContent value="playbooks" className="mt-0">
          <PlaybooksMandato />
        </TabsContent>
      </Tabs>

      {cfg.data.atualizadoEm ? (
        <p className="text-xs text-muted-foreground">Última alteração: {dataHora(cfg.data.atualizadoEm)}.</p>
      ) : null}
    </div>
  )
}

// ─── Kill switch ────────────────────────────────────────────────────────────

function KillSwitch({ ligado }: { ligado: boolean }) {
  const salvar = useSalvar()
  const [confirmando, setConfirmando] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)

  async function alternar() {
    setEnviando(true)
    const ok = await salvar(
      'geral',
      { kill_switch: !ligado },
      !ligado
        ? 'Tudo que é automático foi desligado: agentes, agente de conversa e ligações.'
        : 'Automação religada. Os agentes voltam no próximo ciclo.',
    )
    setEnviando(false)
    if (ok) setConfirmando(false)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border-2 p-5 sm:flex-row sm:items-center sm:justify-between',
        ligado ? STATUS_SUPERFICIE.critical : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        {ligado ? (
          <OctagonX className="mt-0.5 h-8 w-8 shrink-0" aria-hidden />
        ) : (
          <Power className="mt-0.5 h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="space-y-1">
          <p className="text-lg font-semibold">
            {ligado ? 'Toda a automação está DESLIGADA' : 'Kill switch — automação ligada'}
          </p>
          <p className="max-w-2xl text-sm opacity-90">
            Um botão só para tudo que é automático: agentes de mandato, agente de conversa da
            Comunicação e ligações da Ana. Ele também grava nos dois switches antigos
            (Comunicação e Voz), para ninguém precisar lembrar de três lugares numa emergência.
          </p>
        </div>
      </div>
      <Button
        size="lg"
        variant={ligado ? 'default' : 'destructive'}
        className="shrink-0"
        onClick={() => setConfirmando(true)}
      >
        {ligado ? 'Religar a automação' : 'Desligar tudo agora'}
      </Button>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ligado ? 'Religar a automação?' : 'Desligar toda a automação?'}</DialogTitle>
            <DialogDescription>
              {ligado
                ? 'Agentes, agente de conversa e ligações voltam a agir no próximo ciclo, sob as cotas, o orçamento e o disjuntor de sempre.'
                : 'Nenhum agente age a partir do próximo ciclo, o agente de conversa para de responder e nenhuma ligação nova sai. Mandatos ficam onde estão — nada é encerrado.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmando(false)}>
              Cancelar
            </Button>
            <Button
              variant={ligado ? 'default' : 'destructive'}
              disabled={enviando}
              onClick={() => void alternar()}
            >
              {enviando ? 'Salvando…' : ligado ? 'Religar' : 'Desligar tudo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Versão da Ana (§15.4) ──────────────────────────────────────────────────

/**
 * Se a API da Ana não responde v2, os agentes operam em v1 degradado — e isso precisa
 * estar VISÍVEL, para ninguém achar que a capacidade existe. Versão ainda não detectada
 * conta como degradada: prometer o que não se verificou é o erro que este aviso evita.
 */
function VersaoAna({ status }: { status: VozStatus | null }) {
  const v2 = status?.versao === 'v2'
  return (
    <div className={cn('flex items-start gap-3 rounded-lg border p-4', v2 ? STATUS_SUPERFICIE.success : STATUS_SUPERFICIE.warning)}>
      {v2 ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      ) : (
        <Phone className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      )}
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          Voz (Ana): {status?.versao ? `API ${status.versao}` : 'versão ainda não detectada'}
          {status?.detectada_em ? ` · detectada em ${dataHora(status.detectada_em)}` : ''}
        </p>
        {v2 ? (
          <p>Todos os objetivos de ligação estão disponíveis: oferta de antecipação, reunião, qualificação e reativação.</p>
        ) : (
          <p>
            <strong>Operando em v1 degradado:</strong> por telefone só a oferta de antecipação de NF; os
            demais objetivos são recusados.
            {!status?.versao ? ' A versão é detectada na primeira ligação ou ciclo do worker.' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Blocos de formulário ───────────────────────────────────────────────────

/** Estado local da seção, reiniciado quando o banco devolve outro valor. */
function useRascunho<T>(valor: T): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [r, setR] = React.useState(valor)
  const chave = JSON.stringify(valor)
  React.useEffect(() => setR(JSON.parse(chave) as T), [chave])
  return [r, setR, JSON.stringify(r) !== chave]
}

function BotaoSalvar({ alterado, onSalvar }: { alterado: boolean; onSalvar: () => Promise<unknown> }) {
  const [salvando, setSalvando] = React.useState(false)
  return (
    <Button
      size="sm"
      disabled={!alterado || salvando}
      onClick={async () => {
        setSalvando(true)
        await onSalvar()
        setSalvando(false)
      }}
    >
      {salvando ? 'Salvando…' : 'Salvar'}
    </Button>
  )
}

function Campo({
  id,
  rotulo,
  valor,
  onChange,
  nota,
  inputMode = 'numeric',
}: {
  id: string
  rotulo: string
  valor: string
  onChange: (v: string) => void
  nota?: string
  inputMode?: 'numeric' | 'decimal'
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {rotulo}
      </Label>
      <Input id={id} inputMode={inputMode} value={valor} onChange={(e) => onChange(e.target.value)} />
      {nota ? <p className="text-[11px] leading-snug text-muted-foreground">{nota}</p> : null}
    </div>
  )
}

/** Inteiros de um rascunho de texto, validados contra [min, max]. Null + toast no primeiro inválido. */
function lerInteiros(
  campos: readonly { chave: string; rotulo: string; min: number; max: number }[],
  valores: Record<string, string>,
): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const c of campos) {
    const n = Number(valores[c.chave])
    if (!Number.isInteger(n) || n < c.min || n > c.max) {
      toast.error(`“${c.rotulo}” precisa ser um inteiro entre ${c.min} e ${c.max}.`)
      return null
    }
    out[c.chave] = n
  }
  return out
}

// ─── Orçamento (§8) ─────────────────────────────────────────────────────────

function Orcamento({ config, mes, carregando }: { config: ConfigAgentes; mes: OrcamentoMes | null; carregando: boolean }) {
  const salvar = useSalvar()
  const [r, setR, alterado] = useRascunho({
    teto: textoDeCentavos(config.orcamento.teto_mensal_centavos),
    alertas: config.orcamento.alertas_pct.join(', '),
  })

  const teto = mes?.teto_centavos ?? config.orcamento.teto_mensal_centavos
  const consumido = mes?.consumido_centavos ?? 0
  const reservado = mes?.reservado_centavos ?? 0
  const fracCons = teto > 0 ? Math.min(1, consumido / teto) : 0
  const fracRes = teto > 0 ? Math.min(1 - fracCons, reservado / teto) : 0
  const usado = teto > 0 ? (consumido + reservado) / teto : null

  async function gravar() {
    const tetoC = centavosDeTexto(r.teto)
    if (tetoC === null) return void toast.error('Teto mensal inválido. Use reais, ex.: 1.500,00.')
    const alertas = r.alertas
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
    if (alertas.length === 0 || alertas.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) {
      return void toast.error('Alertas: porcentagens inteiras entre 1 e 99, separadas por vírgula.')
    }
    await salvar('orcamento', {
      teto_mensal_centavos: tetoC,
      alertas_pct: [...new Set(alertas)].sort((a, b) => a - b),
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Orçamento mensal</CardTitle>
        <CardDescription>
          O teto global é a trava dura: em 100%, toda ferramenta paga para e os mandatos ficam pausados
          (nada é encerrado) até o mês seguinte ou até o teto subir. Tokens do modelo contam também.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Este mês</span>
            {carregando ? (
              <span className="text-muted-foreground">carregando…</span>
            ) : (
              <span className="tabular-nums">
                {brlCentavos(consumido)} consumido · {brlCentavos(reservado)} reservado · teto {brlCentavos(teto)}
                {usado !== null ? ` (${pct(usado, 0)})` : ''}
              </span>
            )}
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-3 bg-primary" style={{ width: `${fracCons * 100}%` }} />
            <div className="h-3 bg-chart-3" style={{ width: `${fracRes * 100}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Reservado = custo estimado de ferramentas pagas em execução agora; volta ao saldo quando o
            custo real é menor.
          </p>
          {teto === 0 ? (
            <p className={cn('flex items-start gap-2 rounded-md border p-2 text-xs', STATUS_SUPERFICIE.warning)}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Teto zero: nenhuma ferramenta paga roda (ligar, buscar no Apollo, enriquecer telefone,
              mandar mensagem). É o padrão de fábrica, de propósito — defina o teto para ligar a operação.
            </p>
          ) : null}
          {!mes && !carregando && teto > 0 ? (
            <p className="text-xs text-muted-foreground">
              A linha deste mês ainda não existe; ela nasce com o teto acima no primeiro gasto.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            id="o-teto"
            rotulo="Teto mensal (R$)"
            valor={r.teto}
            inputMode="decimal"
            onChange={(v) => setR((a) => ({ ...a, teto: v }))}
            nota="Salvar também ajusta o teto do mês corrente."
          />
          <div className="space-y-1">
            <Label htmlFor="o-alertas" className="text-xs">
              Alertas aos gestores (% do teto)
            </Label>
            <Input
              id="o-alertas"
              value={r.alertas}
              onChange={(e) => setR((a) => ({ ...a, alertas: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">Ex.: 50, 80, 95 — um aviso por marca, por mês.</p>
          </div>
        </div>
        <BotaoSalvar alterado={alterado} onSalvar={gravar} />
      </CardContent>
    </Card>
  )
}

// ─── Identificação (§10) ────────────────────────────────────────────────────

function Identificacao({ valor }: { valor: PoliticaIdentificacao }) {
  const salvar = useSalvar()
  const [r, setR, alterado] = useRascunho(valor)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Identificação da IA
        </CardTitle>
        <CardDescription>
          Configuração, não texto fixo: é o tipo de política que muda com um parecer jurídico, e mudá-la
          não pode exigir deploy. Vale em todos os canais, inclusive voz.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={r} onValueChange={(v) => setR(v as PoliticaIdentificacao)}>
          <SelectTrigger className="max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLITICAS_IDENTIFICACAO.map((p) => (
              <SelectItem key={p} value={p}>
                {POLITICA_IDENTIFICACAO_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className={cn('space-y-1 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
          <p className="font-medium">O piso não é configurável — vale em qualquer política:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {REGRAS_DURAS_IDENTIFICACAO.map((regra) => (
              <li key={regra}>{regra}</li>
            ))}
          </ul>
          <p className="text-xs">
            A diferença entre as políticas é só anunciar por iniciativa própria e o tom da confirmação.
            Nenhuma permite negar ser IA quando a pessoa pergunta.
          </p>
        </div>
        <BotaoSalvar alterado={alterado} onSalvar={() => salvar('geral', { identificacao: r })} />
      </CardContent>
    </Card>
  )
}

// ─── Ciclo, agenda e voz ────────────────────────────────────────────────────

const CAMPOS_CICLO = [
  {
    chave: 'max_passos_por_ciclo',
    rotulo: 'Passos por ciclo',
    min: 1,
    max: 20,
    nota: 'Chamadas de ferramenta que o agente encadeia num mesmo ciclo de um mandato.',
  },
  {
    chave: 'intervalo_ciclo_min',
    rotulo: 'Intervalo do ciclo (min)',
    min: 1,
    max: 60,
    nota: 'Granularidade de hora não serve: combinou ligar às 15h30, liga às 15h30.',
  },
  {
    chave: 'mandatos_por_ciclo',
    rotulo: 'Mandatos por ciclo',
    min: 1,
    max: 200,
    nota: 'Quantos mandatos um ciclo pega da fila, por prioridade.',
  },
  {
    chave: 'tempo_limite_ciclo_s',
    rotulo: 'Tempo limite do ciclo (s)',
    min: 10,
    max: 600,
    nota: 'Passou disso, o ciclo para e o mandato volta na próxima rodada.',
  },
  {
    chave: 'intervalo_sem_mandato_horas',
    rotulo: 'Reavaliar conversa sem mandato (h)',
    min: 1,
    max: 720,
    nota: 'Conversa sem mandato nem playbook não é reavaliada a cada ciclo.',
  },
] as const

const CAMPOS_AGENDA = [
  {
    chave: 'horizonte_agendamento_dias_uteis',
    rotulo: 'Horizonte de agendamento (dias úteis)',
    min: 1,
    max: 60,
    nota: 'Sem janela do closer até aqui, o agente usa o substituto.',
  },
  { chave: 'reuniao_duracao_min', rotulo: 'Duração da reunião (min)', min: 15, max: 240 },
  { chave: 'reuniao_buffer_min', rotulo: 'Intervalo entre reuniões (min)', min: 0, max: 120 },
  {
    chave: 'reserva_janela_min',
    rotulo: 'Reserva de janela oferecida (min)',
    min: 5,
    max: 240,
    nota: 'Horário oferecido a um cliente fica preso por este tempo: duas conversas não recebem o mesmo.',
  },
  {
    chave: 'voz_timeout_minutos',
    rotulo: 'Timeout de ligação (min)',
    min: 5,
    max: 600,
    nota: 'Ligação sem resultado depois disso é tratada como órfã e o mandato segue.',
  },
  {
    chave: 'digest_hora',
    rotulo: 'Hora do resumo diário',
    min: 0,
    max: 23,
    nota: 'Horário de São Paulo do digest por agente.',
  },
] as const

type ChaveNumericaGeral = (typeof CAMPOS_CICLO)[number]['chave'] | (typeof CAMPOS_AGENDA)[number]['chave']

function Ciclo({ config }: { config: ConfigAgentes }) {
  const salvar = useSalvar()
  const inicial = React.useMemo(() => {
    const v: Record<string, string> = {}
    for (const c of [...CAMPOS_CICLO, ...CAMPOS_AGENDA]) v[c.chave] = String(config.geral[c.chave as ChaveNumericaGeral])
    return { numeros: v, carteira: config.geral.modo_carteira_habilitado }
  }, [config])
  const [r, setR, alterado] = useRascunho(inicial)

  async function gravar() {
    const numeros = lerInteiros([...CAMPOS_CICLO, ...CAMPOS_AGENDA], r.numeros)
    if (!numeros) return
    await salvar('geral', { ...numeros, modo_carteira_habilitado: r.carteira })
  }

  const grade = (campos: readonly { chave: string; rotulo: string; nota?: string }[]) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {campos.map((c) => (
        <Campo
          key={c.chave}
          id={`g-${c.chave}`}
          rotulo={c.rotulo}
          valor={r.numeros[c.chave] ?? ''}
          nota={c.nota}
          onChange={(v) => setR((a) => ({ ...a, numeros: { ...a.numeros, [c.chave]: v } }))}
        />
      ))}
    </div>
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ciclo, agenda e voz</CardTitle>
        <CardDescription>Como o loop roda e como as reuniões são marcadas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Loop do agente</p>
          {grade(CAMPOS_CICLO)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agenda e voz</p>
          {grade(CAMPOS_AGENDA)}
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <Switch checked={r.carteira} onCheckedChange={(v) => setR((a) => ({ ...a, carteira: v }))} />
          <span className="text-sm">
            <span className="font-medium">Modo carteira</span>
            <span className="block text-xs text-muted-foreground">
              Deixa um agente entrar no rodízio de distribuição como um humano, com carteira. Está
              implementado e desligado por decisão: fora de escopo agora. Ligar só libera a opção na
              persona — nenhum agente muda de modo sozinho.
            </span>
          </span>
        </label>
        <BotaoSalvar alterado={alterado} onSalvar={gravar} />
      </CardContent>
    </Card>
  )
}

// ─── Janela de envio ────────────────────────────────────────────────────────

const DIAS = [
  { n: 1, rotulo: 'Seg' },
  { n: 2, rotulo: 'Ter' },
  { n: 3, rotulo: 'Qua' },
  { n: 4, rotulo: 'Qui' },
  { n: 5, rotulo: 'Sex' },
  { n: 6, rotulo: 'Sáb' },
  { n: 7, rotulo: 'Dom' },
] as const

function Janela({ config }: { config: ConfigAgentes }) {
  const salvar = useSalvar()
  const [r, setR, alterado] = useRascunho({
    inicio: String(config.janela.hora_inicio),
    fim: String(config.janela.hora_fim),
    dias: [...config.janela.dias_semana].sort(),
  })

  async function gravar() {
    const inicio = Number(r.inicio)
    const fim = Number(r.fim)
    if (!Number.isInteger(inicio) || inicio < 0 || inicio > 23) return void toast.error('Hora de início: 0 a 23.')
    if (!Number.isInteger(fim) || fim < 1 || fim > 24) return void toast.error('Hora de fim: 1 a 24.')
    if (fim <= inicio) return void toast.error('A hora de fim precisa ser depois da de início.')
    if (r.dias.length === 0) return void toast.error('Escolha ao menos um dia da semana.')
    await salvar('janela', { hora_inicio: inicio, hora_fim: fim, dias_semana: r.dias })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Janela de envio</CardTitle>
        <CardDescription>
          Fora dela nenhum agente manda mensagem nem liga — a ação é reagendada para a próxima abertura,
          não descartada. Horário de {config.janela.timezone.replace('_', ' ')}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-w-sm gap-3 sm:grid-cols-2">
          <Campo
            id="j-inicio"
            rotulo="Das (hora)"
            valor={r.inicio}
            onChange={(v) => setR((a) => ({ ...a, inicio: v }))}
          />
          <Campo
            id="j-fim"
            rotulo="Até (hora)"
            valor={r.fim}
            onChange={(v) => setR((a) => ({ ...a, fim: v }))}
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Dias da semana">
          {DIAS.map((d) => {
            const ativo = r.dias.includes(d.n)
            return (
              <Button
                key={d.n}
                type="button"
                size="sm"
                variant={ativo ? 'default' : 'outline'}
                aria-pressed={ativo}
                onClick={() =>
                  setR((a) => ({
                    ...a,
                    dias: ativo ? a.dias.filter((x) => x !== d.n) : [...a.dias, d.n].sort(),
                  }))
                }
              >
                {d.rotulo}
              </Button>
            )
          })}
        </div>
        <BotaoSalvar alterado={alterado} onSalvar={gravar} />
      </CardContent>
    </Card>
  )
}

// ─── Preços ─────────────────────────────────────────────────────────────────

const ROTULOS_FERRAMENTA = FERRAMENTAS as Record<string, { rotulo: string; requerOrcamento: boolean } | undefined>

function Precos({ config }: { config: ConfigAgentes }) {
  const salvar = useSalvar()
  // As pagas do catálogo + qualquer chave que já esteja na tabela (preço de uma
  // ferramenta que saiu do catálogo continua visível, em vez de sumir sem explicação).
  const ids = React.useMemo(() => {
    const pagas = Object.values(FERRAMENTAS)
      .filter((f) => f.requerOrcamento)
      .map((f) => f.id as string)
    return [...new Set([...pagas, ...Object.keys(config.precos.ferramentas_centavos)])]
  }, [config])

  const [r, setR, alterado] = useRascunho({
    cambio: String(config.precos.cambio_usd_brl).replace('.', ','),
    entrada: String(config.precos.modelo_entrada_usd_mtok).replace('.', ','),
    saida: String(config.precos.modelo_saida_usd_mtok).replace('.', ','),
    ferramentas: Object.fromEntries(ids.map((id) => [id, textoDeCentavos(config.precos.ferramentas_centavos[id] ?? 0)])),
  })

  async function gravar() {
    const cambio = numeroBr(r.cambio)
    const entrada = numeroBr(r.entrada)
    const saida = numeroBr(r.saida)
    if (cambio === null || cambio <= 0) return void toast.error('Câmbio inválido.')
    if (entrada === null || entrada < 0 || saida === null || saida < 0) return void toast.error('Preço do modelo inválido.')
    const ferramentas: Record<string, number> = {}
    for (const id of ids) {
      const c = centavosDeTexto(r.ferramentas[id] ?? '')
      if (c === null) return void toast.error(`Custo de “${ROTULOS_FERRAMENTA[id]?.rotulo ?? id}” inválido.`)
      ferramentas[id] = c
    }
    await salvar('precos', {
      cambio_usd_brl: cambio,
      modelo_entrada_usd_mtok: entrada,
      modelo_saida_usd_mtok: saida,
      ferramentas_centavos: ferramentas,
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Tabela de preços</CardTitle>
        <CardDescription>
          O custo de cada ferramenta paga é o valor RESERVADO antes da chamada; depois dela o custo real é
          consumido e a diferença volta ao saldo. Tokens do modelo são convertidos pelo câmbio abaixo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo
            id="p-cambio"
            rotulo="Câmbio (R$ por US$)"
            valor={r.cambio}
            inputMode="decimal"
            onChange={(v) => setR((a) => ({ ...a, cambio: v }))}
          />
          <Campo
            id="p-entrada"
            rotulo="Modelo — entrada (US$/milhão de tokens)"
            valor={r.entrada}
            inputMode="decimal"
            onChange={(v) => setR((a) => ({ ...a, entrada: v }))}
          />
          <Campo
            id="p-saida"
            rotulo="Modelo — saída (US$/milhão de tokens)"
            valor={r.saida}
            inputMode="decimal"
            onChange={(v) => setR((a) => ({ ...a, saida: v }))}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Custo por ferramenta (R$)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ids.map((id) => (
              <Campo
                key={id}
                id={`f-${id}`}
                rotulo={ROTULOS_FERRAMENTA[id]?.rotulo ?? id}
                valor={r.ferramentas[id] ?? ''}
                inputMode="decimal"
                nota={ROTULOS_FERRAMENTA[id] ? undefined : 'Fora do catálogo atual.'}
                onChange={(v) => setR((a) => ({ ...a, ferramentas: { ...a.ferramentas, [id]: v } }))}
              />
            ))}
          </div>
        </div>
        <BotaoSalvar alterado={alterado} onSalvar={gravar} />
      </CardContent>
    </Card>
  )
}

// ─── Disjuntor padrão ───────────────────────────────────────────────────────

const METRICAS: readonly MetricaDisjuntor[] = ['supressao', 'sem_interesse', 'escalacao', 'falha_tecnica']

function DisjuntorPadrao({ config }: { config: ConfigAgentes }) {
  const salvar = useSalvar()
  const txt = (f: number) => String(Math.round(f * 1000) / 10).replace('.', ',')
  const [r, setR, alterado] = useRascunho({
    janela: String(config.disjuntor.janela_acoes),
    supressao: txt(config.disjuntor.limiar_supressao),
    sem_interesse: txt(config.disjuntor.limiar_sem_interesse),
    escalacao: txt(config.disjuntor.limiar_escalacao),
    falha_tecnica: txt(config.disjuntor.limiar_falha_tecnica),
  })

  async function gravar() {
    const janela = Number(r.janela)
    if (!Number.isInteger(janela) || janela < 5 || janela > 500) return void toast.error('Janela: inteiro entre 5 e 500 ações.')
    const valores: Record<string, number> = { janela_acoes: janela }
    for (const m of METRICAS) {
      const n = numeroBr(r[m])
      if (n === null || n < 0 || n > 100) return void toast.error(`Limiar de ${METRICA_DISJUNTOR_LABELS[m]}: 0 a 100%.`)
      valores[`limiar_${m}`] = Math.round(n * 10) / 1000
    }
    await salvar('disjuntor', valores)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Limiares padrão do disjuntor</CardTitle>
        <CardDescription>
          Valem para agente NOVO: cada agente copia estes números ao nascer e tem os seus, editáveis em
          Personas. Mudar aqui não altera os agentes que já existem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <Campo
            id="d-janela"
            rotulo="Janela (ações)"
            valor={r.janela}
            onChange={(v) => setR((a) => ({ ...a, janela: v }))}
          />
          {METRICAS.map((m) => (
            <Campo
              key={m}
              id={`d-${m}`}
              rotulo={`${METRICA_DISJUNTOR_LABELS[m].replace(/^./, (c) => c.toUpperCase())} (%)`}
              valor={r[m]}
              inputMode="decimal"
              onChange={(v) => setR((a) => ({ ...a, [m]: v }))}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Janela móvel por CONTAGEM de ações, não por tempo. Ultrapassou qualquer limiar, o agente para, os
          mandatos pausam e os gestores recebem push com as ações que motivaram. Reabertura só manual.
        </p>
        <BotaoSalvar alterado={alterado} onSalvar={gravar} />
      </CardContent>
    </Card>
  )
}
