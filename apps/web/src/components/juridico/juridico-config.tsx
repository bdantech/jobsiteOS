'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  BENCHMARK_FASES_PADRAO,
  FASES,
  INDICES,
  INDICE_LABELS,
  PARAMETROS_CALCULO_PADRAO,
  REGRAS_FASE_PADRAO,
  TIPOS_ADVOGADO,
  TIPO_ADVOGADO_LABELS,
  TIPO_SYNC_LABELS,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
  type BenchmarkFases,
  type ConfigMonitoramento,
  type Fase,
  type Indice,
  type NossoCnpj,
  type ParametrosCalculo,
  type RegraFase,
  type TipoAdvogado,
  type TipoSync,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  descobrirProcessosAction,
  reclassificarFasesAction,
  salvarAdvogadoAction,
  salvarIndicesAction,
  salvarJuridicoConfigAction,
  sincronizarAgoraAction,
  sincronizarMonitoramentosAction,
} from '@/actions/juridico'
import {
  buscarAdvogados,
  buscarGastoEscavador,
  buscarIndices,
  buscarJuridicoConfig,
  juridicoKeys,
} from './queries'
import { dataHora, faseLabel } from './format'

/**
 * Configurações do Jurídico (08 §8). Admin-only na action e no RPC; a tela é a camada
 * de mensagem, não a de segurança.
 *
 * Cada bloco aqui muda o comportamento de TODA a carteira, e dois deles mudam a
 * FATURA do Escavador. Por isso o custo aparece na tela antes de o interruptor ser
 * apertado, e o painel de gasto fica na primeira aba: quem vem mexer na agenda
 * precisa ver o que a agenda atual custou antes de aumentá-la.
 */

const DIAS = [
  { valor: 0, rotulo: 'Dom' },
  { valor: 1, rotulo: 'Seg' },
  { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' },
  { valor: 4, rotulo: 'Qui' },
  { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
]

export function JuridicoConfig() {
  const qc = useQueryClient()
  const config = useQuery({ queryKey: juridicoKeys.config(), queryFn: buscarJuridicoConfig })
  const advogados = useQuery({ queryKey: juridicoKeys.advogados(), queryFn: buscarAdvogados })
  const gasto = useQuery({ queryKey: juridicoKeys.syncLog(), queryFn: buscarGastoEscavador })

  async function salvar(chave: string, valor: unknown) {
    const r = await salvarJuridicoConfigAction(chave, valor)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    void qc.invalidateQueries({ queryKey: juridicoKeys.config() })
    toast.success('Configuração salva.')
    return true
  }

  return (
    <Tabs defaultValue="entidades" className="space-y-4">
      <TabsList className="flex-wrap">
        <TabsTrigger value="entidades">Nossos CNPJs</TabsTrigger>
        <TabsTrigger value="monitoramento">Monitoramento</TabsTrigger>
        <TabsTrigger value="advogados">Advogados</TabsTrigger>
        <TabsTrigger value="benchmarks">Benchmarks de fase</TabsTrigger>
        <TabsTrigger value="calculo">Cálculo e índices</TabsTrigger>
        <TabsTrigger value="classificador">Classificador</TabsTrigger>
      </TabsList>

      <TabsContent value="entidades" className="mt-0 space-y-4">
        <NossosCnpjs
          lista={(config.data?.nossos_cnpjs as NossoCnpj[] | undefined) ?? []}
          onSalvar={(l) => salvar('nossos_cnpjs', l)}
        />
        <GastoEscavador gasto={gasto.data} />
      </TabsContent>

      <TabsContent value="monitoramento" className="mt-0">
        <Monitoramento
          cfg={(config.data?.monitoramento as ConfigMonitoramento | undefined) ?? MONITORAMENTO_PADRAO}
          onSalvar={(c) => salvar('monitoramento', c)}
        />
      </TabsContent>

      <TabsContent value="advogados" className="mt-0">
        <Advogados lista={advogados.data ?? []} />
      </TabsContent>

      <TabsContent value="benchmarks" className="mt-0">
        <Benchmarks
          valores={(config.data?.benchmark_fases as BenchmarkFases | undefined) ?? BENCHMARK_FASES_PADRAO}
          onSalvar={(b) => salvar('benchmark_fases', b)}
        />
      </TabsContent>

      <TabsContent value="calculo" className="mt-0 space-y-4">
        <ParametrosCalculoCard
          valores={(config.data?.calculo as ParametrosCalculo | undefined) ?? PARAMETROS_CALCULO_PADRAO}
          onSalvar={(p) => salvar('calculo', p)}
        />
        <TabelaIndicesCard />
      </TabsContent>

      <TabsContent value="classificador" className="mt-0">
        <Classificador
          regras={(config.data?.classificador as { regras?: RegraFase[] } | undefined)?.regras ?? []}
          onSalvar={(regras) => salvar('classificador', { regras })}
        />
      </TabsContent>
    </Tabs>
  )
}

// ─── Nossos CNPJs ───────────────────────────────────────────────────────────

const MONITORAMENTO_PADRAO: ConfigMonitoramento = {
  dias_semana: [1, 2, 3, 4, 5],
  hora: 7,
  apenas_ativos: true,
  forcar_atualizacao_tribunal: false,
  dias_sem_movimentacao: 60,
  dia_resumo_ia: 5,
}

function NossosCnpjs({
  lista,
  onSalvar,
}: {
  lista: NossoCnpj[]
  onSalvar: (l: NossoCnpj[]) => Promise<boolean>
}) {
  const [cnpj, setCnpj] = React.useState('')
  const [apelido, setApelido] = React.useState('')
  const [rodando, setRodando] = React.useState(false)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Entidades nossas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A descoberta de processos roda por estes CNPJs — matriz, FIDC, securitizadora. É por eles que o
          Escavador acha as ações em que somos parte, e cada varredura custa crédito: um CNPJ errado aqui é
          uma varredura paga por uma empresa que não é nossa.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Apelido</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead className="w-24">Ativo</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((e) => (
              <TableRow key={e.cnpj}>
                <TableCell>{e.apelido}</TableCell>
                <TableCell className="font-mono text-xs">{formatCnpj(e.cnpj)}</TableCell>
                <TableCell>
                  <Switch
                    checked={e.ativo !== false}
                    onCheckedChange={(v) =>
                      void onSalvar(lista.map((x) => (x.cnpj === e.cnpj ? { ...x, ativo: v } : x)))
                    }
                    aria-label={`Ativar ${e.apelido}`}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remover"
                    onClick={() => void onSalvar(lista.filter((x) => x.cnpj !== e.cnpj))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {lista.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum CNPJ cadastrado. Enquanto esta lista estiver vazia, a descoberta não tem o que
                  buscar e nenhum processo entra na base.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
          <Input placeholder="Apelido (ex.: FIDC)" value={apelido} onChange={(e) => setApelido(e.target.value)} />
          <Input placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          <Button
            size="sm"
            disabled={!apelido || !isValidCnpj(cnpj)}
            onClick={async () => {
              const normalizado = normalizeCnpj(cnpj)
              if (lista.some((x) => x.cnpj === normalizado)) {
                toast.error('Este CNPJ já está na lista.')
                return
              }
              const ok = await onSalvar([...lista, { cnpj: normalizado, apelido, ativo: true }])
              if (ok) {
                setCnpj('')
                setApelido('')
              }
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={rodando || lista.length === 0}
            onClick={async () => {
              setRodando(true)
              const r = await descobrirProcessosAction({})
              setRodando(false)
              toast[r.ok ? 'success' : 'error'](
                r.ok
                  ? 'Descoberta iniciada. Ela roda em segundo plano e traz a capa dos processos ativos.'
                  : r.message,
              )
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            Descobrir processos agora
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rodando || lista.length === 0}
            onClick={async () => {
              const r = await sincronizarMonitoramentosAction()
              toast[r.ok ? 'success' : 'error'](
                r.ok ? 'Monitoramentos sincronizados no Escavador.' : r.message,
              )
            }}
          >
            Cadastrar monitoramentos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const r = await sincronizarAgoraAction()
              toast[r.ok ? 'success' : 'error'](r.ok ? 'Sincronização iniciada.' : r.message)
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Sincronizar agora
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function GastoEscavador({
  gasto,
}: {
  gasto: { creditos_30d: number; chamadas_30d: number; erros_30d: number; ultima_execucao: string | null; por_tipo: { tipo: string; chamadas: number; creditos: number }[] } | undefined
}) {
  if (!gasto) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Gasto no Escavador (30 dias)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Créditos</div>
            <div className="text-lg font-semibold tabular-nums">
              {gasto.creditos_30d.toLocaleString('pt-BR')}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Chamadas</div>
            <div className="text-lg font-semibold tabular-nums">
              {gasto.chamadas_30d.toLocaleString('pt-BR')}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Erros</div>
            <div className="text-lg font-semibold tabular-nums">{gasto.erros_30d}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Última chamada</div>
            <div className="text-sm">{dataHora(gasto.ultima_execucao)}</div>
          </div>
        </div>
        <div className="space-y-1 border-t border-border pt-2">
          {gasto.por_tipo.map((t) => (
            <div key={t.tipo} className="flex justify-between text-xs">
              <span>{TIPO_SYNC_LABELS[t.tipo as TipoSync] ?? t.tipo}</span>
              <span className="tabular-nums text-muted-foreground">
                {t.chamadas} chamada(s) · {t.creditos} crédito(s)
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Monitoramento ──────────────────────────────────────────────────────────

function Monitoramento({
  cfg,
  onSalvar,
}: {
  cfg: ConfigMonitoramento
  onSalvar: (c: ConfigMonitoramento) => Promise<boolean>
}) {
  const [c, setC] = React.useState(cfg)
  React.useEffect(() => setC(cfg), [cfg])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Agenda de monitoramento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Dias da semana</Label>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((d) => {
              const marcado = c.dias_semana.includes(d.valor)
              return (
                <Button
                  key={d.valor}
                  type="button"
                  size="sm"
                  variant={marcado ? 'secondary' : 'outline'}
                  onClick={() =>
                    setC({
                      ...c,
                      dias_semana: marcado
                        ? c.dias_semana.filter((x) => x !== d.valor)
                        : [...c.dias_semana, d.valor].sort(),
                    })
                  }
                  aria-pressed={marcado}
                >
                  {d.rotulo}
                </Button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Vale para todos os processos. O horário é o de São Paulo.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="hora">Horário</Label>
            <Input
              id="hora"
              type="number"
              min={0}
              max={23}
              value={c.hora}
              onChange={(e) => setC({ ...c, hora: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="parado">Considerar parado após (dias)</Label>
            <Input
              id="parado"
              type="number"
              min={7}
              max={365}
              value={c.dias_sem_movimentacao}
              onChange={(e) => setC({ ...c, dias_sem_movimentacao: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="apenas-ativos">Só processos ativos</Label>
            <p className="text-xs text-muted-foreground">
              Em andamento, suspenso e acordo. Desligar varre também os encerrados.
            </p>
          </div>
          <Switch
            id="apenas-ativos"
            checked={c.apenas_ativos}
            onCheckedChange={(v) => setC({ ...c, apenas_ativos: v })}
          />
        </div>

        {/*
         * O interruptor caro, com o custo escrito ANTES de ser apertado. Ligar isto
         * multiplica a fatura pelo número de processos × dias da semana — e é a única
         * setting deste módulo cujo efeito colateral é financeiro.
         */}
        <div className="flex items-center justify-between rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <div>
            <Label htmlFor="forcar">Forçar atualização no tribunal</Label>
            <p className="text-xs text-muted-foreground">
              O robô do Escavador vai ao site do tribunal, em vez de só ler a base dele.{' '}
              <strong>Custa crédito por processo, por rodada.</strong> Com {c.dias_semana.length} dia(s) por
              semana, cada processo gera {c.dias_semana.length} chamada(s) paga(s) por semana.
            </p>
          </div>
          <Switch
            id="forcar"
            checked={c.forcar_atualizacao_tribunal}
            onCheckedChange={(v) => setC({ ...c, forcar_atualizacao_tribunal: v })}
          />
        </div>

        {/*
         * O resumo de IA num dia só, e não em todos: ele custa token POR PROCESSO
         * e muda quando chega movimentação, não quando o relógio vira. Rodá-lo nas
         * cinco sincronizações da semana pagaria cinco vezes pelo mesmo texto.
         */}
        <div className="space-y-1 rounded-md border border-border p-3">
          <Label htmlFor="dia-resumo">Regerar os resumos de IA</Label>
          <p className="text-xs text-muted-foreground">
            No sync deste dia, os resumos que ficaram velhos são reescritos. O botão de cada
            processo continua funcionando em qualquer dia.
          </p>
          <select
            id="dia-resumo"
            value={c.dia_resumo_ia === null ? 'nunca' : String(c.dia_resumo_ia)}
            onChange={(e) =>
              setC({
                ...c,
                dia_resumo_ia: e.target.value === 'nunca' ? null : Number(e.target.value),
              })
            }
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="nunca">Nunca (só sob demanda)</option>
            {DIAS.map((d) => (
              <option key={d.valor} value={d.valor}>
                {d.rotulo}
              </option>
            ))}
          </select>
          {c.dia_resumo_ia !== null && !c.dias_semana.includes(c.dia_resumo_ia) ? (
            <p className="pt-1 text-xs text-amber-600">
              O sync não roda em {DIAS.find((d) => d.valor === c.dia_resumo_ia)?.rotulo} — os
              resumos nunca seriam regerados
              automaticamente. Escolha um dia que esteja na agenda acima.
            </p>
          ) : null}
        </div>

        <Button size="sm" onClick={() => void onSalvar(c)}>
          Salvar agenda
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Advogados ──────────────────────────────────────────────────────────────

function Advogados({
  lista,
}: {
  lista: { id: string; nome: string; tipo: string; escritorio: string | null; oab_numero: string | null; oab_uf: string | null; email: string | null; ativo: boolean; usuario_id: string | null }[]
}) {
  const qc = useQueryClient()
  const [novo, setNovo] = React.useState({ nome: '', tipo: 'interno', escritorio: '', oab_numero: '', oab_uf: '', email: '' })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Advogados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>OAB</TableHead>
              <TableHead>Escritório</TableHead>
              <TableHead className="w-24">Ativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  {a.nome}
                  {/*
                   * Sem usuário na plataforma, os avisos de movimentação e de prazo
                   * caem para o perfil Jurídico — a tela precisa dizer isso, senão o
                   * silêncio parece configuração certa.
                   */}
                  {!a.usuario_id ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      sem usuário — avisos vão para o time
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{TIPO_ADVOGADO_LABELS[a.tipo as TipoAdvogado] ?? a.tipo}</TableCell>
                <TableCell className="text-xs">
                  {a.oab_numero ? `${a.oab_numero}${a.oab_uf ? `/${a.oab_uf}` : ''}` : '—'}
                </TableCell>
                <TableCell className="text-xs">{a.escritorio ?? '—'}</TableCell>
                <TableCell>
                  <Switch
                    checked={a.ativo}
                    aria-label={`Ativar ${a.nome}`}
                    onCheckedChange={async (v) => {
                      const r = await salvarAdvogadoAction({ ...a, ativo: v })
                      if (!r.ok) {
                        toast.error(r.message)
                        return
                      }
                      void qc.invalidateQueries({ queryKey: juridicoKeys.advogados() })
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
            {lista.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum advogado cadastrado.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-6">
          <Input placeholder="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          <Select value={novo.tipo} onValueChange={(v) => setNovo({ ...novo, tipo: v })}>
            <SelectTrigger aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_ADVOGADO.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIPO_ADVOGADO_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Escritório" value={novo.escritorio} onChange={(e) => setNovo({ ...novo, escritorio: e.target.value })} />
          <Input placeholder="OAB" value={novo.oab_numero} onChange={(e) => setNovo({ ...novo, oab_numero: e.target.value })} />
          <Input placeholder="UF" maxLength={2} value={novo.oab_uf} onChange={(e) => setNovo({ ...novo, oab_uf: e.target.value.toUpperCase() })} />
          <Button
            size="sm"
            disabled={novo.nome.trim().length < 2}
            onClick={async () => {
              const r = await salvarAdvogadoAction({
                nome: novo.nome,
                tipo: novo.tipo,
                escritorio: novo.escritorio || null,
                oab_numero: novo.oab_numero || null,
                oab_uf: novo.oab_uf || null,
                email: novo.email || null,
                ativo: true,
              })
              if (!r.ok) {
                toast.error(r.message)
                return
              }
              setNovo({ nome: '', tipo: 'interno', escritorio: '', oab_numero: '', oab_uf: '', email: '' })
              void qc.invalidateQueries({ queryKey: juridicoKeys.advogados() })
              toast.success('Advogado cadastrado.')
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Benchmarks ─────────────────────────────────────────────────────────────

function Benchmarks({
  valores,
  onSalvar,
}: {
  valores: BenchmarkFases
  onSalvar: (b: BenchmarkFases) => Promise<boolean>
}) {
  const [b, setB] = React.useState(valores)
  React.useEffect(() => setB(valores), [valores])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Dias esperados por fase</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Quando a fase atual passa deste número, o processo ganha badge vermelho e o advogado responsável é
          notificado. Os valores de fábrica são referências razoáveis, não estatística da casa — ajuste
          conforme a realidade dos foros em que você opera.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FASES.map((f) => (
            <div key={f} className="space-y-1">
              <Label htmlFor={`bench-${f}`}>{faseLabel(f)}</Label>
              <Input
                id={`bench-${f}`}
                type="number"
                min={1}
                max={3650}
                value={b[f as Fase] ?? BENCHMARK_FASES_PADRAO[f as Fase] ?? 90}
                onChange={(e) => setB({ ...b, [f]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <Button size="sm" onClick={() => void onSalvar(b)}>
          Salvar benchmarks
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── Cálculo e índices ──────────────────────────────────────────────────────

function ParametrosCalculoCard({
  valores,
  onSalvar,
}: {
  valores: ParametrosCalculo
  onSalvar: (p: ParametrosCalculo) => Promise<boolean>
}) {
  const [p, setP] = React.useState(valores)
  React.useEffect(() => setP(valores), [valores])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Parâmetros padrão do cálculo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          São os valores que a tela do processo pré-preenche. Cada cálculo GRAVA a cópia dos parâmetros que
          usou — mudar aqui não reescreve nenhuma memória já gerada.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="cfg-indice">Índice</Label>
            <Select value={p.indice} onValueChange={(v) => setP({ ...p, indice: v as Indice })}>
              <SelectTrigger id="cfg-indice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICES.map((i) => (
                  <SelectItem key={i} value={i}>
                    {INDICE_LABELS[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-juros">Juros de mora (% a.m.)</Label>
            <Input id="cfg-juros" type="number" step="0.01" value={p.juros_am} onChange={(e) => setP({ ...p, juros_am: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-multa">Multa (%)</Label>
            <Input id="cfg-multa" type="number" step="0.01" value={p.multa_pct} onChange={(e) => setP({ ...p, multa_pct: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cfg-hon">Honorários (%)</Label>
            <Input id="cfg-hon" type="number" step="0.01" value={p.honorarios_pct} onChange={(e) => setP({ ...p, honorarios_pct: Number(e.target.value) })} />
          </div>
          <div className="flex items-center justify-between gap-3 pt-5">
            <Label htmlFor="cfg-compostos" className="font-normal">
              Juros compostos
            </Label>
            <Switch id="cfg-compostos" checked={p.juros_compostos} onCheckedChange={(v) => setP({ ...p, juros_compostos: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 pt-5">
            <Label htmlFor="cfg-custas" className="font-normal">
              Somar custas
            </Label>
            <Switch id="cfg-custas" checked={p.incluir_custas} onCheckedChange={(v) => setP({ ...p, incluir_custas: v })} />
          </div>
        </div>
        <Button size="sm" onClick={() => void onSalvar(p)}>
          Salvar parâmetros
        </Button>
      </CardContent>
    </Card>
  )
}

function TabelaIndicesCard() {
  const qc = useQueryClient()
  const [indice, setIndice] = React.useState<Indice>('ipca')
  const [colar, setColar] = React.useState('')
  const indices = useQuery({ queryKey: juridicoKeys.indices(indice), queryFn: () => buscarIndices(indice) })

  /**
   * A importação aceita `AAAA-MM;valor` por linha — é o formato em que os índices saem
   * de qualquer planilha, e digitar 120 competências à mão não é uma opção real.
   * Vírgula decimal aceita, porque é como o Excel em pt-BR escreve.
   */
  function parsear(texto: string): { competencia: string; valor: number }[] {
    return texto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [c, v] = l.split(/[;\t,](?=[^,]*$)|;|\t/)
        return { competencia: (c ?? '').trim(), valor: Number((v ?? '').trim().replace(',', '.')) }
      })
      .filter((l) => /^\d{4}-(0[1-9]|1[0-2])$/.test(l.competencia) && Number.isFinite(l.valor))
  }

  const prontas = parsear(colar)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Tabela de índices mensais</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Variação <strong>do mês</strong>, em percentual (0,45 = 0,45%). O cálculo não busca índice em API:
          uma memória juntada aos autos precisa ser reproduzível daqui a dois anos, e um índice revisado na
          fonte mudaria um número já protocolado. Mês sem valor não corrige — e o cálculo avisa quais.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="tab-indice">Índice</Label>
            <Select value={indice} onValueChange={(v) => setIndice(v as Indice)}>
              <SelectTrigger id="tab-indice" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICES.map((i) => (
                  <SelectItem key={i} value={i}>
                    {INDICE_LABELS[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-xs text-muted-foreground">
            {(indices.data ?? []).length} competência(s) cadastrada(s)
          </span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="colar">Colar da planilha (AAAA-MM;valor por linha)</Label>
          <Textarea
            id="colar"
            rows={6}
            className="font-mono text-xs"
            placeholder={'2026-01;0,42\n2026-02;0,83\n2026-03;0,16'}
            value={colar}
            onChange={(e) => setColar(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={prontas.length === 0}
              onClick={async () => {
                const r = await salvarIndicesAction({ indice, linhas: prontas })
                if (!r.ok) {
                  toast.error(r.message)
                  return
                }
                setColar('')
                void qc.invalidateQueries({ queryKey: juridicoKeys.indices(indice) })
                toast.success(`${r.data.gravadas} competência(s) gravada(s).`)
              }}
            >
              Importar {prontas.length > 0 ? `${prontas.length} linha(s)` : ''}
            </Button>
            {colar && prontas.length === 0 ? (
              <span className="text-xs text-destructive">
                Nenhuma linha reconhecida. O formato é AAAA-MM seguido do valor.
              </span>
            ) : null}
          </div>
        </div>

        {(indices.data ?? []).length > 0 ? (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead className="text-right">Variação (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(indices.data ?? []).map((i) => (
                  <TableRow key={i.competencia}>
                    <TableCell className="font-mono text-xs">{i.competencia}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {i.valor.toFixed(4).replace('.', ',')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ─── Classificador ──────────────────────────────────────────────────────────

function Classificador({
  regras,
  onSalvar,
}: {
  regras: RegraFase[]
  onSalvar: (r: RegraFase[]) => Promise<boolean>
}) {
  const usandoPadrao = regras.length === 0
  const exibidas = React.useMemo(
    () => (usandoPadrao ? REGRAS_FASE_PADRAO : regras),
    [usandoPadrao, regras],
  )
  const [texto, setTexto] = React.useState(() => JSON.stringify(exibidas, null, 2))
  const [reclassificando, setReclassificando] = React.useState(false)

  // Recarrega o editor quando a config chega do servidor. Se a pessoa já estiver
  // digitando, o efeito só dispara quando `exibidas` muda de identidade — o que
  // acontece na resposta da query, não a cada tecla.
  React.useEffect(() => setTexto(JSON.stringify(exibidas, null, 2)), [exibidas])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Regras do classificador de fases</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          O classificador é determinístico: procura expressões no texto da movimentação (sem acento, em
          minúsculas) e atribui a fase. Quando duas regras casam no mesmo texto, vence a fase MAIS
          AVANÇADA. `excecoes` anulam o casamento — é como &ldquo;citação negativa&rdquo; deixa de marcar
          citação.
        </p>

        {usandoPadrao ? (
          <Badge variant="outline">
            Usando a régua de fábrica ({REGRAS_FASE_PADRAO.length} regras). Salvar aqui a substitui inteira.
          </Badge>
        ) : (
          <Badge variant="secondary">Régua customizada ({regras.length} regras).</Badge>
        )}

        <Textarea rows={20} className="font-mono text-xs" value={texto} onChange={(e) => setTexto(e.target.value)} />

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={async () => {
              let parsed: RegraFase[]
              try {
                parsed = JSON.parse(texto) as RegraFase[]
              } catch {
                toast.error('JSON inválido.')
                return
              }
              if (!Array.isArray(parsed) || parsed.some((r) => !r.fase || !Array.isArray(r.termos))) {
                toast.error('Cada regra precisa de `fase` e de uma lista `termos`.')
                return
              }
              await onSalvar(parsed)
            }}
          >
            Salvar regras
          </Button>
          <Button size="sm" variant="outline" onClick={() => void onSalvar([])}>
            Voltar à régua de fábrica
          </Button>
          {/*
           * Reclassificar é um botão SEPARADO, e não um efeito de salvar. A varredura
           * pode mover a fase de centenas de processos — e mover a fase dispara alerta
           * de lentidão e notificação. Quem corrige uma palavra-chave decide quando
           * aplicar isso ao passado.
           */}
          <Button
            size="sm"
            variant="outline"
            disabled={reclassificando}
            onClick={async () => {
              setReclassificando(true)
              const r = await reclassificarFasesAction()
              setReclassificando(false)
              toast[r.ok ? 'success' : 'error'](
                r.ok
                  ? 'Reclassificação iniciada. Ela reprocessa as movimentações já gravadas e não gasta crédito.'
                  : r.message,
              )
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Reclassificar a base inteira
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
