'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Gauge, Pencil, Plus, ScrollText } from 'lucide-react'
import {
  TIPOS_MANDATO,
  TIPO_MANDATO_LABELS,
  arvoreEfetiva,
  escopoSchema,
  lerLimitesAgente,
  populacaoDoTipo,
  tipoVendedorDoMandato,
  type Grupo,
  type ModoRodagem,
  type TipoMandato,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE, STATUS_TEXTO } from '@/components/ui/badge'
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
import { Textarea } from '@/components/ui/textarea'
import {
  ligarRegraMandatoAction,
  registrarPreviaRegraAction,
  salvarRegraMandatoAction,
  type PreviaRegra,
} from '@/actions/agentes-gestao'
import { cn } from '@/lib/utils'
import { brlCentavos, centavosDeTexto, dataHora, inteiro, textoDeCentavos } from './gestao-format'
import {
  buscarAgentesIa,
  contarAtivosDaRegra,
  contarAtivosDoAgente,
  buscarPlaybooksMandato,
  buscarRegras,
  contarPopulacao,
  gestaoAgentesKeys,
  type AgenteIa,
  type PlaybookMandato,
  type RegraMandato,
} from './queries-gestao'
import { FiltroComPrevia, ROTULO_POPULACAO, arvoreInicial, problemasDaArvore } from './regras-filtro'

/**
 * AS REGRAS QUE CRIAM MANDATOS (Prompt 09 §2.3) — o caminho principal pelo qual o agente
 * recebe trabalho.
 *
 * ─── A REGRA DIZ "O QUE", O ESCOPO DIZ "ONDE" ───────────────────────────────
 * O job diário avalia cada regra LIGADA em E com o escopo do agente (e o piloto por cima,
 * em modo piloto). Só nasce mandato para o que cai nos dois — então a contagem do editor
 * já é feita dentro do escopo do agente escolhido: a regra "todas as construtoras de SP"
 * de um agente em piloto com cinco empresas cria no máximo cinco mandatos, e a tela
 * precisa dizer cinco, não cinco mil.
 *
 * ─── NASCE DESLIGADA, E SÓ LIGA DEPOIS DA PRÉVIA ────────────────────────────
 * Mesmo padrão das regras versionadas do Prompt 02. A prévia de impacto responde três
 * perguntas antes de qualquer mandato existir: quantas empresas (ou notas) o filtro pega
 * hoje, quantos mandatos criaria — o menor entre isso, o teto da regra e a cota livre do
 * agente — e quanto custaria se todos gastassem o orçamento inteiro. Ela é GRAVADA na
 * regra (`registrarPreviaRegra`), e `app_agentes_ligar_regra` recusa ligar sem ela.
 * Salvar um filtro novo apaga a prévia e desliga a regra: impacto novo, que ninguém viu.
 */

const PLACEHOLDERS = ['{empresa}', '{nf_numero}', '{nf_valor}', '{sacado}'] as const
const SEM_PLAYBOOK = '__sem__'

interface PreviaLida extends Partial<PreviaRegra> {
  em?: string
}

function lerPrevia(bruto: unknown): PreviaLida | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  return bruto as PreviaLida
}

function arvoreDoAgente(agente: AgenteIa | undefined, populacao: 'empresas' | 'notas'): Grupo | null {
  if (!agente) return null
  const escopo = escopoSchema.safeParse(agente.escopo ?? {})
  try {
    return arvoreEfetiva(escopo.success ? escopo.data : null, agente.modo_rodagem as ModoRodagem, populacao)
  } catch {
    return null
  }
}

export function RegrasMandato({ onAbrirPlaybooks }: { onAbrirPlaybooks: () => void }) {
  const qc = useQueryClient()
  const regras = useQuery({ queryKey: gestaoAgentesKeys.regras(), queryFn: buscarRegras })
  const agentes = useQuery({ queryKey: gestaoAgentesKeys.personas(), queryFn: buscarAgentesIa })
  const playbooks = useQuery({ queryKey: gestaoAgentesKeys.playbooks(), queryFn: buscarPlaybooksMandato })
  const [editando, setEditando] = React.useState<RegraMandato | 'nova' | null>(null)
  const [previa, setPrevia] = React.useState<{ regra: RegraMandato; previa: PreviaRegra } | null>(null)
  const [calculando, setCalculando] = React.useState<string | null>(null)
  const [ligando, setLigando] = React.useState<string | null>(null)

  const agentesPorId = React.useMemo(() => new Map((agentes.data ?? []).map((a) => [a.id, a])), [agentes.data])
  const invalidar = () => void qc.invalidateQueries({ queryKey: gestaoAgentesKeys.regras() })

  async function calcularPrevia(regra: RegraMandato) {
    const agente = regra.agente_id ? agentesPorId.get(regra.agente_id) : undefined
    if (!agente) return void toast.error('A regra está sem agente. Edite e escolha um agente de IA.')
    const populacao = populacaoDoTipo(regra.tipo_mandato)
    let arvore: Grupo | null
    try {
      const escopo = escopoSchema.safeParse(agente.escopo ?? {})
      arvore = arvoreEfetiva(
        escopo.success ? escopo.data : null,
        agente.modo_rodagem as ModoRodagem,
        populacao,
        regra.filtro,
      )
    } catch (e) {
      return void toast.error(
        `O filtro da regra ou o escopo do agente não vale no catálogo atual: ${e instanceof Error ? e.message : 'árvore inválida'}.`,
      )
    }
    if (!arvore) {
      return void toast.error(
        'Nem a regra nem o escopo do agente têm filtro: o job recusa regra sem filtro efetivo e não cria nada. Monte um filtro antes.',
      )
    }

    setCalculando(regra.id)
    try {
      const [casam, ativos, daRegra] = await Promise.all([
        contarPopulacao(populacao, arvore),
        contarAtivosDoAgente(agente.id),
        contarAtivosDaRegra(regra.id),
      ])
      const vagas = Math.max(0, lerLimitesAgente(agente.limites).mandatos_ativos - ativos)
      // O teto da regra conta os mandatos que ELA já tem vivos — é a conta do job diário.
      const teto = regra.teto_mandatos_ativos === null ? null : Math.max(0, regra.teto_mandatos_ativos - daRegra)
      const criaria = Math.max(0, Math.min(casam, teto ?? Number.POSITIVE_INFINITY, vagas))
      const p: PreviaRegra = {
        populacao,
        casam_hoje: casam,
        mandatos_criaria: criaria,
        teto_regra: teto,
        vagas_agente: vagas,
        custo_estimado_centavos: criaria * regra.orcamento_centavos,
      }
      const r = await registrarPreviaRegraAction(regra.id, p)
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      setPrevia({ regra, previa: p })
      invalidar()
    } catch (e) {
      toast.error(e instanceof Error ? `Não foi possível calcular a prévia: ${e.message}` : 'Não foi possível calcular a prévia.')
    } finally {
      setCalculando(null)
    }
  }

  async function ligar(regra: Pick<RegraMandato, 'id' | 'nome'>, ativa: boolean) {
    setLigando(regra.id)
    const r = await ligarRegraMandatoAction({ id: regra.id, ativa })
    setLigando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(ativa ? `“${regra.nome}” ligada. O próximo job diário cria os mandatos.` : `“${regra.nome}” desligada.`)
    setPrevia(null)
    invalidar()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="h-4 w-4" aria-hidden /> Regras de mandato
            </CardTitle>
            <CardDescription className="max-w-2xl">
              Um job diário avalia as regras ligadas e cria mandatos para o que entrou no filtro — dentro do
              escopo do agente e até o teto dele. Toda regra nasce desligada e só liga depois da prévia
              de impacto.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onAbrirPlaybooks}>
              Playbooks por tipo de mandato <ArrowRight className="ml-2 h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              size="sm"
              onClick={() => setEditando('nova')}
              disabled={(agentes.data ?? []).length === 0}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden /> Nova regra
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {regras.isPending || agentes.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : regras.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar as regras: {regras.error.message}</p>
        ) : (agentes.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum agente de IA cadastrado. Uma regra precisa de um agente para entregar os mandatos — crie
            um em Personas primeiro.
          </p>
        ) : (regras.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhuma regra ainda. Sem regra, mandato só nasce pelo “Delegar ao agente” manual — os agentes
            ficam parados esperando alguém lembrar deles.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(regras.data ?? []).map((regra) => {
              const agente = regra.agente_id ? agentesPorId.get(regra.agente_id) : undefined
              const p = lerPrevia(regra.ultima_previa)
              const nomes = ROTULO_POPULACAO[populacaoDoTipo(regra.tipo_mandato)]
              return (
                <li key={regra.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{regra.nome}</p>
                      <Badge variant="neutral">{TIPO_MANDATO_LABELS[regra.tipo_mandato as TipoMandato] ?? regra.tipo_mandato}</Badge>
                      {regra.ativa ? <Badge variant="success">Ligada</Badge> : <Badge variant="outline">Desligada</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Agente: {agente?.nome ?? 'nenhum (a regra não cria nada)'} · {brlCentavos(regra.orcamento_centavos)} por
                      mandato · {regra.max_acoes} ações · {regra.prazo_dias} dias úteis · prioridade {regra.prioridade}
                      {regra.teto_mandatos_ativos ? ` · teto ${regra.teto_mandatos_ativos} ativos` : ''}
                    </p>
                    {p ? (
                      <p className="text-xs">
                        Prévia de {dataHora(p.em ?? null)}: {inteiro(p.casam_hoje ?? null)} {nomes.varios} no filtro ·{' '}
                        {inteiro(p.mandatos_criaria ?? null)} mandatos · até {brlCentavos(p.custo_estimado_centavos ?? null)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sem prévia de impacto — não pode ser ligada ainda.</p>
                    )}
                    {regra.ultima_avaliacao_em ? (
                      <p className="text-xs text-muted-foreground">Última avaliação do job: {dataHora(regra.ultima_avaliacao_em)}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={calculando === regra.id}
                      onClick={() => void calcularPrevia(regra)}
                    >
                      <Gauge className="mr-2 h-4 w-4" aria-hidden />
                      {calculando === regra.id ? 'Calculando…' : 'Prévia de impacto'}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9"
                      onClick={() => setEditando(regra)}
                      aria-label="Editar regra"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <label
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                      title={p ? undefined : 'Veja a prévia de impacto antes de ligar.'}
                    >
                      <Switch
                        checked={regra.ativa}
                        disabled={ligando === regra.id || (!regra.ativa && !p)}
                        onCheckedChange={(v) => void ligar(regra, v)}
                      />
                      {regra.ativa ? 'Ligada' : 'Ligar'}
                    </label>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      {editando !== null ? (
        <RegraEditor
          regra={editando === 'nova' ? null : editando}
          agentes={agentes.data ?? []}
          playbooks={playbooks.data ?? []}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            invalidar()
          }}
        />
      ) : null}

      <Dialog open={previa !== null} onOpenChange={(v) => (!v ? setPrevia(null) : null)}>
        <DialogContent>
          {previa ? (
            <>
              <DialogHeader>
                <DialogTitle>Prévia de impacto — {previa.regra.nome}</DialogTitle>
                <DialogDescription>
                  Calculada agora, com o filtro da regra em E com o escopo do agente. Ficou registrada na regra.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">
                    {ROTULO_POPULACAO[previa.previa.populacao].varios} no filtro hoje
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums">{inteiro(previa.previa.casam_hoje)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">Mandatos que criaria</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{inteiro(previa.previa.mandatos_criaria)}</dd>
                </div>
                <div className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">Custo se todos gastarem o orçamento</dt>
                  <dd className="text-xl font-semibold tabular-nums">{brlCentavos(previa.previa.custo_estimado_centavos)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Mandatos = o menor entre o que o filtro pega ({inteiro(previa.previa.casam_hoje)}), o teto livre da regra (
                {previa.previa.teto_regra ?? 'sem teto'}) e a cota livre do agente ({inteiro(previa.previa.vagas_agente)}).
                O job ainda pula empresas que já têm mandato ativo do mesmo tipo e cria no máximo 200 por
                rodada — o número real pode ser menor, nunca maior.
              </p>
              {previa.previa.mandatos_criaria === 0 ? (
                <p className={cn('flex items-start gap-2 rounded-lg border p-2 text-sm', STATUS_SUPERFICIE.warning)}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Ligada assim, a regra não criaria nenhum mandato hoje.
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPrevia(null)}>
                  Fechar
                </Button>
                {!previa.regra.ativa ? (
                  <Button
                    disabled={ligando === previa.regra.id}
                    onClick={() => void ligar(previa.regra, true)}
                  >
                    {ligando === previa.regra.id ? 'Ligando…' : 'Ligar a regra'}
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ─── Editor ─────────────────────────────────────────────────────────────────

interface Rascunho {
  nome: string
  tipo_mandato: TipoMandato
  agente_id: string
  playbook_id: string | null
  filtro: Grupo | null
  objetivo_template: string
  orcamento: string
  max_acoes: string
  prazo_dias: string
  teto: string
  prioridade: string
}

function RegraEditor({
  regra,
  agentes,
  playbooks,
  onFechar,
  onSalvo,
}: {
  regra: RegraMandato | null
  agentes: AgenteIa[]
  playbooks: PlaybookMandato[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const tipoInicial = (regra?.tipo_mandato as TipoMandato) ?? 'agendamento_reuniao'
  const filtroInicial = React.useMemo(
    () => arvoreInicial(populacaoDoTipo(tipoInicial), regra?.filtro ?? null),
    [regra, tipoInicial],
  )
  const [r, setR] = React.useState<Rascunho>(() => ({
    nome: regra?.nome ?? '',
    tipo_mandato: tipoInicial,
    agente_id: regra?.agente_id ?? agentes.find((a) => a.ativo)?.id ?? '',
    playbook_id: regra?.playbook_id ?? null,
    filtro: filtroInicial.arvore,
    objetivo_template: regra?.objetivo_template ?? '',
    orcamento: textoDeCentavos(regra?.orcamento_centavos ?? 4000),
    max_acoes: String(regra?.max_acoes ?? 15),
    prazo_dias: String(regra?.prazo_dias ?? 14),
    teto: regra?.teto_mandatos_ativos ? String(regra.teto_mandatos_ativos) : '',
    prioridade: String(regra?.prioridade ?? 50),
  }))
  const [salvando, setSalvando] = React.useState(false)
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((a) => ({ ...a, [k]: v }))

  const populacao = populacaoDoTipo(r.tipo_mandato)
  const agente = agentes.find((a) => a.id === r.agente_id)
  const escopoAgente = arvoreDoAgente(agente, populacao)
  const playbooksDoTipo = playbooks.filter((p) => p.tipo_mandato === r.tipo_mandato)
  const tipoEsperado = tipoVendedorDoMandato(r.tipo_mandato)
  const tipoErrado = agente && agente.tipo !== tipoEsperado

  function trocarTipo(tipo: TipoMandato) {
    setR((a) => ({
      ...a,
      tipo_mandato: tipo,
      // A árvore de empresas não vale no catálogo de notas (e vice-versa): trocar de
      // população recomeça o filtro em vez de guardar uma árvore que o worker recusaria.
      filtro: populacaoDoTipo(tipo) === populacaoDoTipo(a.tipo_mandato) ? a.filtro : null,
      playbook_id: null,
    }))
  }

  async function salvar() {
    if (r.nome.trim().length < 3) return void toast.error('Dê um nome à regra (3 letras ou mais).')
    if (!r.agente_id) return void toast.error('Escolha o agente que recebe os mandatos.')
    if (r.objetivo_template.trim().length < 10) return void toast.error('Escreva o objetivo (10 letras ou mais).')
    const probs = problemasDaArvore(populacao, r.filtro)
    if (probs.length > 0) return void toast.error(`Filtro incompleto: ${probs[0]}`)
    const orcamento = centavosDeTexto(r.orcamento)
    if (orcamento === null) return void toast.error('Orçamento por mandato inválido. Use reais, ex.: 20,00.')
    const maxAcoes = Number(r.max_acoes)
    const prazo = Number(r.prazo_dias)
    const prioridade = Number(r.prioridade)
    const teto = r.teto.trim() === '' ? null : Number(r.teto)
    if (!Number.isInteger(maxAcoes) || maxAcoes < 1 || maxAcoes > 500) return void toast.error('Máximo de ações: 1 a 500.')
    if (!Number.isInteger(prazo) || prazo < 1 || prazo > 180) return void toast.error('Prazo: 1 a 180 dias úteis.')
    if (!Number.isInteger(prioridade) || prioridade < 0 || prioridade > 100) return void toast.error('Prioridade: 0 a 100.')
    if (teto !== null && (!Number.isInteger(teto) || teto < 1)) return void toast.error('Teto de mandatos ativos: inteiro positivo, ou vazio.')

    setSalvando(true)
    const res = await salvarRegraMandatoAction({
      id: regra?.id,
      nome: r.nome.trim(),
      tipo_mandato: r.tipo_mandato,
      agente_id: r.agente_id,
      playbook_id: r.playbook_id,
      // "Sem filtro" grava `{}`: o worker lê como ausência de árvore e vale só o escopo.
      filtro: r.filtro ?? {},
      objetivo_template: r.objetivo_template.trim(),
      orcamento_centavos: orcamento,
      max_acoes: maxAcoes,
      prazo_dias: prazo,
      teto_mandatos_ativos: teto,
      prioridade,
    })
    setSalvando(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    const filtroMudou = regra && JSON.stringify(regra.filtro ?? {}) !== JSON.stringify(r.filtro ?? {})
    toast.success(
      !regra
        ? 'Regra criada, desligada. Rode a prévia de impacto para poder ligar.'
        : filtroMudou
          ? 'Regra salva. O filtro mudou: ela foi desligada e precisa de uma prévia nova.'
          : 'Regra salva.',
    )
    onSalvo()
  }

  return (
    <Dialog open onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{regra ? 'Editar regra de mandato' : 'Nova regra de mandato'}</DialogTitle>
          <DialogDescription>
            Nasce desligada. Mudar o filtro de uma regra ligada desliga e apaga a prévia dela.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="r-nome">Nome</Label>
              <Input
                id="r-nome"
                value={r.nome}
                maxLength={120}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Construtoras médias de SP sem conversa há 60 dias"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo de mandato</Label>
              <Select value={r.tipo_mandato} onValueChange={(v) => trocarTipo(v as TipoMandato)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_MANDATO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_MANDATO_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Agente</Label>
              <Select value={r.agente_id || undefined} onValueChange={(v) => set('agente_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o agente" />
                </SelectTrigger>
                <SelectContent>
                  {agentes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome} · {a.tipo === 'originador' ? 'Originador' : 'SDR'}
                      {!a.ativo ? ' (inativo)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tipoErrado ? (
                <p className={cn('text-xs', STATUS_TEXTO.warning)}>
                  {TIPO_MANDATO_LABELS[r.tipo_mandato]} é trabalho de {tipoEsperado === 'sdr' ? 'SDR' : 'originador'}, e{' '}
                  {agente?.nome} é {agente?.tipo === 'originador' ? 'originador' : 'SDR'}.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Playbook (opcional)</Label>
              <Select
                value={r.playbook_id ?? SEM_PLAYBOOK}
                onValueChange={(v) => set('playbook_id', v === SEM_PLAYBOOK ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_PLAYBOOK}>Padrão do tipo</SelectItem>
                  {playbooksDoTipo.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.ativo}>
                      {p.nome} (v{p.versao}){!p.ativo ? ' — inativo' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {playbooksDoTipo.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum playbook para este tipo na aba Playbooks.</p>
              ) : null}
            </div>
          </div>

          <FiltroComPrevia
            key={populacao}
            populacao={populacao}
            titulo={`Filtro da regra (${ROTULO_POPULACAO[populacao].varios})`}
            descricao={
              agente
                ? `A contagem já é dentro do escopo de ${agente.nome}${agente.modo_rodagem === 'piloto' ? ', com o piloto por cima' : ''}.`
                : 'Escolha o agente para a contagem considerar o escopo dele.'
            }
            arvore={r.filtro}
            onChange={(a) => set('filtro', a)}
            base={escopoAgente}
            invalidaGravada={filtroInicial.invalida && r.tipo_mandato === tipoInicial}
            semFiltro={
              escopoAgente
                ? 'Sem filtro próprio, a regra pega tudo o que está no escopo do agente.'
                : 'Sem filtro aqui e sem escopo no agente, o job recusa a regra e não cria nada.'
            }
          />

          <div className="space-y-1">
            <Label htmlFor="r-objetivo">Objetivo do mandato</Label>
            <Textarea
              id="r-objetivo"
              rows={2}
              maxLength={600}
              value={r.objetivo_template}
              onChange={(e) => set('objetivo_template', e.target.value)}
              placeholder={
                populacao === 'notas'
                  ? 'Originar a antecipação da NF {nf_numero} ({nf_valor}) de {empresa} contra {sacado}'
                  : 'Marcar uma reunião com quem decide antecipação na {empresa}'
              }
            />
            <p className="text-xs text-muted-foreground">
              Frase legível por humano, preenchida por mandato. Use {PLACEHOLDERS.join(' ')}
              {populacao === 'empresas' ? ' (os de nota só são preenchidos em originação)' : ''}. Placeholder sem valor
              fica visível como está, em vez de inventado.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="r-orc" className="text-xs">Orçamento por mandato (R$)</Label>
              <Input
                id="r-orc"
                inputMode="decimal"
                value={r.orcamento}
                onChange={(e) => set('orcamento', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-acoes" className="text-xs">Máximo de ações</Label>
              <Input
                id="r-acoes"
                inputMode="numeric"
                value={r.max_acoes}
                onChange={(e) => set('max_acoes', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-prazo" className="text-xs">Prazo (dias úteis)</Label>
              <Input
                id="r-prazo"
                inputMode="numeric"
                value={r.prazo_dias}
                onChange={(e) => set('prazo_dias', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-teto" className="text-xs">Teto de ativos da regra</Label>
              <Input
                id="r-teto"
                inputMode="numeric"
                value={r.teto}
                onChange={(e) => set('teto', e.target.value)}
                placeholder="sem teto"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="r-prio" className="text-xs">Prioridade (0–100)</Label>
              <Input
                id="r-prio"
                inputMode="numeric"
                value={r.prioridade}
                onChange={(e) => set('prioridade', e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O orçamento é o teto de gasto de CADA mandato: impede que um mandato em laço drene o teto
            mensal no dia 4. A cota de mandatos ativos do agente ({agente ? lerLimitesAgente(agente.limites).mandatos_ativos : '—'})
            vale por cima do teto da regra.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar regra'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
