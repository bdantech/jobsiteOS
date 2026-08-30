'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Loader2, TriangleAlert } from 'lucide-react'
import {
  MAX_PASSOS,
  OBJETIVO_LABELS,
  OBJETIVOS,
  ORIGEM_PUBLICO_LABELS,
  ORIGENS_PUBLICO,
  PRESETS,
  TIPO_CAMPANHA_DESCRICOES,
  TIPO_CAMPANHA_LABELS,
  TIPOS_CAMPANHA,
  preset as acharPreset,
  type ObjetivoConversa,
  type OrigemPublico,
  type TipoCampanha,
  type Variante,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { simularCampanhaAction, aprovarCampanhaAction } from '@/actions/campanhas'
import { cn } from '@/lib/utils'
import {
  buscarCampanha,
  buscarContasDeCampanha,
  buscarSegmentos,
  buscarTemplates,
  campanhasKeys,
} from './queries'
import { PainelSimulacao } from './simulacao'

/**
 * O CONSTRUTOR EM 4 PASSOS (§8): público → conteúdo → execução → simulação.
 *
 * A ordem não é estética. Ela força a pergunta cara (para QUEM?) antes da barata
 * (que texto?), e põe a simulação no fim porque ela é o portão: sem dry-run não
 * há aprovação, e o dry-run precisa de todo o resto para existir.
 *
 * O passo 4 não é "revisar": é onde a campanha é de fato salva e simulada. Os
 * três primeiros são estado local — uma campanha meio preenchida não precisa
 * existir no banco, e um rascunho que ninguém terminou é lixo que alguém vai ter
 * de limpar depois.
 */

interface Passo {
  numero: number
  titulo: string
}

const PASSOS: Passo[] = [
  { numero: 1, titulo: 'Público' },
  { numero: 2, titulo: 'Conteúdo' },
  { numero: 3, titulo: 'Execução' },
  { numero: 4, titulo: 'Simulação' },
]

interface Rascunho {
  nome: string
  tipo: TipoCampanha
  objetivo: ObjetivoConversa | ''
  canal: 'whatsapp' | 'email'
  origem_publico: OrigemPublico
  segmento_id: string
  preset: string
  motivo_saida: string
  dias_parado: string
  potencial_minimo: string
  variantes: Variante[]
  ritmo_por_dia: string
  respeitar_janela: boolean
  excluir_contatados_dias: string
  excluir_conversa_aberta: boolean
  modo_agente_ao_responder: 'sugestao' | 'autonomo'
  contas_remetentes: string[]
}

function rascunhoInicial(presetId: string | null): Rascunho {
  const p = presetId ? acharPreset(presetId) : undefined
  return {
    nome: p ? p.label : '',
    tipo: p?.tipoSugerido ?? 'prospeccao',
    objetivo: p?.objetivoSugerido ?? '',
    canal: 'email',
    origem_publico: p ? 'preset' : 'segmento',
    segmento_id: '',
    preset: p?.id ?? '',
    motivo_saida: '',
    dias_parado: '7',
    potencial_minimo: '',
    variantes: [],
    ritmo_por_dia: '50',
    respeitar_janela: true,
    excluir_contatados_dias: '14',
    excluir_conversa_aberta: true,
    modo_agente_ao_responder: 'sugestao',
    contas_remetentes: [],
  }
}

export function ConstrutorDeCampanha() {
  const router = useRouter()
  const params = useSearchParams()
  const qc = useQueryClient()

  const [passo, setPasso] = React.useState(1)
  const [r, setR] = React.useState<Rascunho>(() => rascunhoInicial(params.get('preset')))
  const [campanhaId, setCampanhaId] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const segmentos = useQuery({ queryKey: campanhasKeys.segmentos(), queryFn: buscarSegmentos })
  const templates = useQuery({
    queryKey: campanhasKeys.templates(r.canal),
    queryFn: () => buscarTemplates(r.canal),
  })
  const contas = useQuery({
    queryKey: campanhasKeys.contas(),
    queryFn: buscarContasDeCampanha,
    enabled: r.canal === 'whatsapp',
  })

  // A campanha simulada, buscada em polling: a simulação roda no worker e pode
  // levar minutos num público grande.
  const campanha = useQuery({
    queryKey: campanhasKeys.uma(campanhaId ?? ''),
    queryFn: () => buscarCampanha(campanhaId!),
    enabled: campanhaId !== null,
    refetchInterval: (q) => (q.state.data?.simulada_em ? false : 3_000),
  })

  const def = acharPreset(r.preset)

  function set<K extends keyof Rascunho>(chave: K, valor: Rascunho[K]): void {
    setR((atual) => ({ ...atual, [chave]: valor }))
  }

  const publicoOk =
    (r.origem_publico === 'segmento' && r.segmento_id !== '') ||
    (r.origem_publico === 'preset' &&
      r.preset !== '' &&
      (def?.exigeParametro !== 'motivo_saida' || r.motivo_saida.trim() !== '')) ||
    r.origem_publico === 'filtro' ||
    r.origem_publico === 'lista_manual'

  const conteudoOk = r.nome.trim() !== '' && r.variantes.length > 0

  function payload() {
    return {
      ...(campanhaId ? { id: campanhaId } : {}),
      nome: r.nome.trim(),
      tipo: r.tipo,
      objetivo: r.objetivo === '' ? null : r.objetivo,
      canal: r.canal,
      origem_publico: r.origem_publico,
      segmento_id: r.origem_publico === 'segmento' ? r.segmento_id : null,
      preset: r.origem_publico === 'preset' ? r.preset : null,
      preset_params: {
        ...(r.motivo_saida.trim() ? { motivo_saida: r.motivo_saida.trim() } : {}),
        ...(r.preset === 'docs_pendentes' ? { dias_parado: Number(r.dias_parado) || 7 } : {}),
        ...(r.preset === 'fornecedores_a_cadastrar' && r.potencial_minimo
          ? { potencial_minimo: Number(r.potencial_minimo) || 0 }
          : {}),
      },
      empresas_manuais: [],
      variantes: r.variantes,
      contas_remetentes: r.contas_remetentes,
      ritmo_por_dia: Number(r.ritmo_por_dia) || 50,
      respeitar_janela: r.respeitar_janela,
      excluir_contatados_dias: Number(r.excluir_contatados_dias) || 0,
      excluir_conversa_aberta: r.excluir_conversa_aberta,
      modo_agente_ao_responder: r.modo_agente_ao_responder,
    }
  }

  async function salvarESimular() {
    setSalvando(true)
    const res = await simularCampanhaAction(payload())
    setSalvando(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    setCampanhaId(res.data.campanha.id)
    if (res.data.aviso) toast.warning(`Simulação enfileirada com aviso: ${res.data.aviso}`)
    else toast.success('Simulação em andamento…')
    void qc.invalidateQueries({ queryKey: campanhasKeys.todas })
  }

  async function aprovar() {
    if (!campanhaId) return
    setSalvando(true)
    const res = await aprovarCampanhaAction({ id: campanhaId })
    setSalvando(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success('Campanha aprovada. O executor começa na próxima passada.')
    router.push(`/comercial/campanhas/${campanhaId}`)
  }

  return (
    <div className="space-y-4">
      {/* ─── Trilha ────────────────────────────────────────────────────────── */}
      <nav aria-label="Passos" className="flex flex-wrap items-center gap-2">
        {PASSOS.map((p) => (
          <button
            key={p.numero}
            type="button"
            onClick={() => setPasso(p.numero)}
            disabled={p.numero > passo}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
              p.numero === passo
                ? 'border-primary bg-primary/10 font-medium text-foreground'
                : p.numero < passo
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'cursor-not-allowed text-muted-foreground/50',
            )}
          >
            {p.numero < passo ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <span className="tabular-nums">{p.numero}</span>
            )}
            {p.titulo}
          </button>
        ))}
      </nav>

      {/* ─── 1. Público ────────────────────────────────────────────────────── */}
      {passo === 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Para quem</CardTitle>
            <CardDescription>
              A pergunta cara vem primeiro. Escolher o texto antes do público é como se
              escreve uma mensagem que não serve para ninguém.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="origem">Origem do público</Label>
              <select
                id="origem"
                value={r.origem_publico}
                onChange={(e) => set('origem_publico', e.target.value as OrigemPublico)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ORIGENS_PUBLICO.map((o) => (
                  <option key={o} value={o}>
                    {ORIGEM_PUBLICO_LABELS[o]}
                  </option>
                ))}
              </select>
            </div>

            {r.origem_publico === 'segmento' && (
              <div className="space-y-2">
                <Label htmlFor="segmento">Segmento salvo</Label>
                {segmentos.isPending ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <select
                    id="segmento"
                    value={r.segmento_id}
                    onChange={(e) => set('segmento_id', e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {(segmentos.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                        {s.contagem_cache !== null ? ` (${s.contagem_cache})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-muted-foreground">
                  Os segmentos são os mesmos do Mercado — inclusive as variáveis de todos os
                  módulos.
                </p>
              </div>
            )}

            {r.origem_publico === 'preset' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="preset">Atalho</Label>
                  <select
                    id="preset"
                    value={r.preset}
                    onChange={(e) => {
                      const p = acharPreset(e.target.value)
                      setR((a) => ({
                        ...a,
                        preset: e.target.value,
                        tipo: p?.tipoSugerido ?? a.tipo,
                        objetivo: p?.objetivoSugerido ?? a.objetivo,
                        nome: a.nome === '' && p ? p.label : a.nome,
                      }))
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {def && <p className="text-xs text-muted-foreground">{def.descricao}</p>}
                </div>

                {def?.exigeParametro === 'motivo_saida' && (
                  <div className="space-y-2">
                    <Label htmlFor="motivo">Motivo da saída</Label>
                    <Input
                      id="motivo"
                      value={r.motivo_saida}
                      onChange={(e) => set('motivo_saida', e.target.value)}
                      placeholder="Ex.: Taxa alta"
                    />
                    <p
                      className={cn(
                        'flex items-start gap-1.5 rounded border p-2 text-xs',
                        STATUS_SUPERFICIE.warning,
                      )}
                    >
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      Obrigatório. Quem saiu por taxa alta precisa de proposta recalibrada; quem
                      saiu porque o caixa melhorou precisa de mensagem de disponibilidade.
                      Reativação genérica é spam com nostalgia.
                    </p>
                  </div>
                )}

                {r.preset === 'docs_pendentes' && (
                  <div className="space-y-2">
                    <Label htmlFor="dias">Parado há mais de (dias)</Label>
                    <Input
                      id="dias"
                      value={r.dias_parado}
                      onChange={(e) => set('dias_parado', e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                )}

                {r.preset === 'fornecedores_a_cadastrar' && (
                  <div className="space-y-2">
                    <Label htmlFor="potencial">Potencial mensal mínimo (R$)</Label>
                    <Input
                      id="potencial"
                      value={r.potencial_minimo}
                      onChange={(e) => set('potencial_minimo', e.target.value)}
                      inputMode="numeric"
                      placeholder="deixe vazio para não filtrar"
                    />
                  </div>
                )}
              </div>
            )}

            {(r.origem_publico === 'filtro' || r.origem_publico === 'lista_manual') && (
              <p
                className={cn(
                  'flex items-start gap-1.5 rounded border p-3 text-sm',
                  STATUS_SUPERFICIE.info,
                )}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Filtro montado na hora e lista manual são montados a partir do Explorador: salve
                o recorte como segmento e escolha-o aqui. É a mesma definição, com nome e
                histórico.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="canal">Canal</Label>
              <select
                id="canal"
                value={r.canal}
                onChange={(e) => set('canal', e.target.value as 'whatsapp' | 'email')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── 2. Conteúdo ───────────────────────────────────────────────────── */}
      {passo === 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">O que a pessoa vai ler</CardTitle>
            <CardDescription>
              Uma variante é um template com peso. Mais de uma no mesmo passo vira teste A/B;
              passos 2 e 3 viram a sequência leve — que para no primeiro sinal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome da campanha</Label>
              <Input id="nome" value={r.nome} onChange={(e) => set('nome', e.target.value)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tipo">Tipo</Label>
                <select
                  id="tipo"
                  value={r.tipo}
                  onChange={(e) => set('tipo', e.target.value as TipoCampanha)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TIPOS_CAMPANHA.map((t) => (
                    <option key={t} value={t}>
                      {TIPO_CAMPANHA_LABELS[t]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">{TIPO_CAMPANHA_DESCRICOES[r.tipo]}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="objetivo">Objetivo da conversa</Label>
                <select
                  id="objetivo"
                  value={r.objetivo}
                  onChange={(e) => set('objetivo', e.target.value as ObjetivoConversa | '')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Sem objetivo</option>
                  {OBJETIVOS.map((o) => (
                    <option key={o} value={o}>
                      {OBJETIVO_LABELS[o]}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Herdado pela conversa: é por ele que o Agente sabe o que fazer quando a pessoa
                  responder.
                </p>
              </div>
            </div>

            <EditorDeVariantes
              variantes={r.variantes}
              templates={templates.data ?? []}
              carregando={templates.isPending}
              onChange={(v) => set('variantes', v)}
            />
          </CardContent>
        </Card>
      )}

      {/* ─── 3. Execução ───────────────────────────────────────────────────── */}
      {passo === 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ritmo e guardrails</CardTitle>
            <CardDescription>
              O ritmo é o teto que a campanha PEDE. O teto de cada número é o que ela pode — e o
              menor dos dois é o que acontece.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ritmo">Mensagens por dia</Label>
                <Input
                  id="ritmo"
                  value={r.ritmo_por_dia}
                  onChange={(e) => set('ritmo_por_dia', e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contatados">Excluir contatados nos últimos (dias)</Label>
                <Input
                  id="contatados"
                  value={r.excluir_contatados_dias}
                  onChange={(e) => set('excluir_contatados_dias', e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            {r.canal === 'whatsapp' && (
              <div className="space-y-2">
                <Label>Números remetentes</Label>
                {contas.isPending ? (
                  <Skeleton className="h-9 w-full" />
                ) : (contas.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma conta ativa. Cadastre em Comunicação → Contas WhatsApp.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {(contas.data ?? []).map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={r.contas_remetentes.includes(c.id)}
                          onChange={(e) =>
                            set(
                              'contas_remetentes',
                              e.target.checked
                                ? [...r.contas_remetentes, c.id]
                                : r.contas_remetentes.filter((x) => x !== c.id),
                            )
                          }
                        />
                        {c.apelido}
                        <Badge variant="outline" className="text-[10px]">
                          {c.tipo}
                        </Badge>
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Sem escolher nenhum, a campanha usa todos os números do tipo certo.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <Label htmlFor="janela">Respeitar a janela de envio</Label>
                <p className="text-xs text-muted-foreground">
                  Desligar manda em qualquer hora. Quase nunca é o que se quer.
                </p>
              </div>
              <Switch
                id="janela"
                checked={r.respeitar_janela}
                onCheckedChange={(v) => set('respeitar_janela', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <Label htmlFor="conversa">Pular quem já tem conversa aberta</Label>
                <p className="text-xs text-muted-foreground">
                  Um disparo por cima de uma conversa em andamento é o pior erro possível.
                </p>
              </div>
              <Switch
                id="conversa"
                checked={r.excluir_conversa_aberta}
                onCheckedChange={(v) => set('excluir_conversa_aberta', v)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="modo">Quando a pessoa responder, o Agente…</Label>
              <select
                id="modo"
                value={r.modo_agente_ao_responder}
                onChange={(e) =>
                  set('modo_agente_ao_responder', e.target.value as 'sugestao' | 'autonomo')
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="sugestao">sugere o próximo passo (uma pessoa aprova)</option>
                <option value="autonomo">responde sozinho</option>
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── 4. Simulação ──────────────────────────────────────────────────── */}
      {passo === 4 && (
        <PainelSimulacao
          campanha={campanha.data ?? null}
          carregando={salvando || (campanhaId !== null && !campanha.data?.simulada_em)}
          onSimular={() => void salvarESimular()}
          onAprovar={() => void aprovar()}
        />
      )}

      {/* ─── Navegação ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setPasso((p) => Math.max(1, p - 1))} disabled={passo === 1}>
          <ChevronLeft className="mr-2 h-4 w-4" aria-hidden />
          Voltar
        </Button>
        {passo < 4 ? (
          <Button
            onClick={() => setPasso((p) => p + 1)}
            disabled={(passo === 1 && !publicoOk) || (passo === 2 && !conteudoOk)}
          >
            Continuar
            <ChevronRight className="ml-2 h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button onClick={() => void salvarESimular()} disabled={salvando} variant="outline">
            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {campanhaId ? 'Simular de novo' : 'Salvar e simular'}
          </Button>
        )}
      </div>
    </div>
  )
}

function EditorDeVariantes({
  variantes,
  templates,
  carregando,
  onChange,
}: {
  variantes: Variante[]
  templates: { id: string; nome: string }[]
  carregando: boolean
  onChange: (v: Variante[]) => void
}) {
  function adicionar(passo: number) {
    const letra = String.fromCharCode(97 + variantes.filter((v) => v.passo === passo).length)
    onChange([
      ...variantes,
      {
        id: `${passo}${letra}`,
        template_id: templates[0]?.id ?? '',
        peso: 1,
        passo,
        dias_apos: passo === 1 ? 3 : 3,
      },
    ])
  }

  if (carregando) return <Skeleton className="h-24 w-full" />
  if (templates.length === 0) {
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        Nenhum template ativo neste canal. Crie um em Comunicação → Templates.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: MAX_PASSOS }, (_, i) => i + 1).map((passo) => {
        const doPasso = variantes.filter((v) => v.passo === passo)
        return (
          <div key={passo} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">
                Toque {passo}
                {passo > 1 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    só sai se não houve resposta, opt-out, supressão nem ação do Agente
                  </span>
                )}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => adicionar(passo)}
                disabled={passo > 1 && !variantes.some((v) => v.passo === passo - 1)}
              >
                + variante
              </Button>
            </div>

            {doPasso.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {passo === 1 ? 'Obrigatório: a campanha precisa de um primeiro toque.' : 'Sem toque.'}
              </p>
            ) : (
              <div className="space-y-2">
                {doPasso.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[10rem] flex-1 space-y-1">
                      <Label className="text-xs">Template ({v.id})</Label>
                      <select
                        value={v.template_id}
                        onChange={(e) =>
                          onChange(
                            variantes.map((x) =>
                              x.id === v.id ? { ...x, template_id: e.target.value } : x,
                            ),
                          )
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-20 space-y-1">
                      <Label className="text-xs">Peso</Label>
                      <Input
                        value={String(v.peso)}
                        onChange={(e) =>
                          onChange(
                            variantes.map((x) =>
                              x.id === v.id ? { ...x, peso: Number(e.target.value) || 1 } : x,
                            ),
                          )
                        }
                        inputMode="numeric"
                      />
                    </div>
                    {passo > 1 && (
                      <div className="w-28 space-y-1">
                        <Label className="text-xs">Dias após</Label>
                        <Input
                          value={String(v.dias_apos)}
                          onChange={(e) =>
                            onChange(
                              variantes.map((x) =>
                                x.id === v.id ? { ...x, dias_apos: Number(e.target.value) || 3 } : x,
                              ),
                            )
                          }
                          inputMode="numeric"
                        />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onChange(variantes.filter((x) => x.id !== v.id))}
                    >
                      remover
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
