'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react'
import {
  AMBIENTES_SEGURADORA,
  AMBIENTE_SEGURADORA_PADRAO,
  UID_TYPES_SEGURADORA,
  UID_TYPE_SEGURADORA_PADRAO,
  ehAmbienteSeguradora,
  ehUidTypeSeguradora,
  type AmbienteSeguradora,
  type UidTypeSeguradora,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { salvarCreditoConfigAction } from '@/actions/credito'
import { buscarCreditoConfig, buscarVersaoCredito, creditoKeys } from './queries'

/**
 * Configurações do módulo (04d §1).
 *
 * Tudo aqui muda com o negócio: taxa, TAC, prazo médio, tetos, corte de concessão. Nada
 * disso é constante de código justamente porque vai mudar, e no dia em que mudar ninguém
 * vai lembrar de procurar num arquivo.
 *
 * Os campos com `null` (giro e ratio) são OVERRIDES: em branco, valem os calibrados na
 * carteira. Preenchidos, vencem a calibração — e a tela diz qual está valendo, senão o
 * override vira uma explicação que ninguém encontra quando o número parece errado.
 */

interface CampoNum {
  chave: string
  campo: string
  label: string
  descricao?: string
  step?: string
}

const CAMPOS: Array<{ chave: string; titulo: string; descricao: string; campos: CampoNum[] }> = [
  {
    chave: 'economia',
    titulo: 'Economia da operação',
    descricao: 'O que transforma um limite em receita por mês.',
    campos: [
      { chave: 'economia', campo: 'taxa_padrao_am', label: 'Taxa padrão (% a.m.)', step: '0.01' },
      { chave: 'economia', campo: 'tac', label: 'TAC por operação (R$)', step: '0.01' },
      {
        chave: 'economia',
        campo: 'valor_medio_nf',
        label: 'Valor médio da NF (R$)',
        descricao: 'Converte volume em número de operações, que é o que multiplica a TAC.',
        step: '0.01',
      },
      {
        chave: 'economia',
        campo: 'prazo_medio_dias',
        label: 'Prazo médio (dias)',
        descricao:
          'Quantas vezes o limite gira no mês: 30 ÷ prazo. Com 45 dias, o limite gira 0,67 vez.',
      },
      {
        chave: 'economia',
        campo: 'utilizacao_media',
        label: 'Utilização média do limite (0–1)',
        descricao:
          'Quanto do limite a empresa de fato usa. Em branco = usa o medido na carteira. É a premissa mais forte da conta, e por isso ela tem um campo em vez de ficar diluída no giro.',
        step: '0.01',
      },
      {
        chave: 'economia',
        campo: 'giro_mensal',
        label: 'Giro mensal (legado)',
        descricao:
          'Só é lido quando a utilização acima está em branco e não há utilização calibrada — aí ela é derivada daqui (giro × prazo ÷ 30). Novas configurações devem usar o campo de utilização.',
        step: '0.001',
      },
    ],
  },
  {
    chave: 'limite',
    titulo: 'Limite',
    descricao: 'Os tetos que impedem uma estimativa de faturamento alta de virar um limite absurdo.',
    campos: [
      {
        chave: 'limite',
        campo: 'ratio_limite_manual',
        label: 'Ratio limite/faturamento (override)',
        descricao: 'Em branco = usa o calibrado nos clientes que declararam faturamento.',
        step: '0.001',
      },
      { chave: 'limite', campo: 'cap_absoluto', label: 'Teto absoluto (R$)', step: '1000' },
      {
        chave: 'limite',
        campo: 'cap_pct_faturamento',
        label: '% máximo do faturamento',
        descricao: '0,15 = o limite nunca passa de 15% do faturamento estimado.',
        step: '0.01',
      },
    ],
  },
  {
    chave: 'scorecard',
    titulo: 'Scorecard',
    descricao: 'Os cortes que decidem faixa, e a completude mínima para o score ser exibido.',
    campos: [
      { chave: 'scorecard', campo: 'corte_concessao', label: 'Corte de concessão (score)' },
      {
        chave: 'scorecard',
        campo: 'completude_minima',
        label: 'Completude mínima',
        descricao: '0,5 = abaixo de metade dos pesos avaliáveis, o score não é exibido.',
        step: '0.05',
      },
      { chave: 'scorecard', campo: 'recencia_protesto_dias', label: 'Protesto recente (dias)' },
      { chave: 'scorecard', campo: 'knockout_negada_meses', label: 'Knockout de negativa (meses)' },
      {
        chave: 'scorecard',
        campo: 'chance_sem_score',
        label: 'Chance sem score',
        descricao: 'Usada no valor esperado quando não há faixa. Fica marcada como presumida.',
        step: '0.05',
      },
    ],
  },
]

interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
}

/** `Balanço patrimonial` → `balanco_patrimonial`: id estável, sem acento e sem espaço. */
function idDoLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/**
 * O checklist de documentos da esteira (04d §4.2).
 *
 * O `id` de um tipo já enviado NÃO muda quando o rótulo muda: os documentos em
 * `analise_docs` guardam o id, e reescrevê-lo desligaria da análise todo arquivo já
 * anexado — que continuaria no bucket, invisível. Por isso o id é gerado uma vez, na
 * criação, e depois só o rótulo é editável.
 *
 * Remover um tipo também não apaga nada: some do checklist, e os arquivos daquele tipo
 * continuam listados no detalhe da análise.
 */
function TiposDeDocumento({
  tipos,
  onSalvar,
  salvando,
}: {
  tipos: TipoDoc[]
  onSalvar: (tipos: TipoDoc[]) => Promise<void>
  salvando: boolean
}) {
  const [rascunho, setRascunho] = React.useState<TipoDoc[] | null>(null)
  const atual = rascunho ?? tipos
  const sujo = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(tipos)

  function mexer(fn: (lista: TipoDoc[]) => TipoDoc[]) {
    setRascunho((r) => fn(structuredClone(r ?? tipos)))
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Documentos da análise</CardTitle>
            <CardDescription>
              O checklist que aparece no detalhe da análise. Enquanto faltar um obrigatório, a
              tela avisa — a seguradora costuma pedir por eles, e sem isso a análise volta.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" disabled={!sujo} onClick={() => setRascunho(null)}>
              Descartar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!sujo || salvando}
              onClick={async () => {
                await onSalvar(atual.filter((t) => t.label.trim() !== ''))
                setRascunho(null)
              }}
            >
              <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
              Salvar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {atual.map((t, i) => (
          <div key={t.id || i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Input
              value={t.label}
              onChange={(e) =>
                mexer((l) => {
                  const item = l[i]
                  if (item) item.label = e.target.value
                  return l
                })
              }
              className="h-8 min-w-40 flex-1"
              placeholder="Nome do documento"
            />
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {t.id}
            </code>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              obrigatório
              <Switch
                checked={t.obrigatorio}
                onCheckedChange={(v) =>
                  mexer((l) => {
                    const item = l[i]
                    if (item) item.obrigatorio = v
                    return l
                  })
                }
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2"
              aria-label={`Remover ${t.label}`}
              onClick={() => mexer((l) => l.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            mexer((l) => [...l, { id: `tipo_${l.length + 1}`, label: '', obrigatorio: false }])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          Adicionar tipo
        </Button>

        <p className="text-[0.8rem] text-muted-foreground">
          O identificador entre parênteses é o que os arquivos já enviados guardam. Ele é
          gerado na criação e não muda quando você renomeia o documento — mudá-lo desligaria
          da análise todo arquivo já anexado.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * O ambiente da seguradora (sandbox ou produção).
 *
 * ── POR QUE ISTO É UMA TELA, E NÃO UMA VARIÁVEL DE AMBIENTE ─────────────────
 * Quem alterna é quem está homologando a integração, e por env cada ida e volta custaria
 * um redeploy do worker. Na prática, isso significa que ninguém alterna — e o teste acaba
 * rodando contra produção "só desta vez".
 *
 * ── O QUE NÃO ESTÁ AQUI ─────────────────────────────────────────────────────
 * Client id, secret, application key e apólice. Eles ficam em variáveis do worker, um
 * conjunto por ambiente, porque esta tabela é legível por qualquer usuário com o módulo
 * Crédito — e um secret numa tabela lida pela tela é um secret vazado. O que este seletor
 * decide é QUAL conjunto o worker usa.
 *
 * A confirmação de produção não é cerimônia: é o único ponto do sistema em que um clique
 * transforma toda a esteira em pedidos de cobertura de verdade, com chamada cobrada.
 */
function AmbienteDaSeguradora({
  atual,
  onSalvar,
  salvando,
}: {
  atual: AmbienteSeguradora
  onSalvar: (a: AmbienteSeguradora) => Promise<void>
  salvando: boolean
}) {
  const [rascunho, setRascunho] = React.useState<AmbienteSeguradora | null>(null)
  const escolhido = rascunho ?? atual
  const sujo = rascunho !== null && rascunho !== atual
  const info = AMBIENTES_SEGURADORA[escolhido]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Ambiente da seguradora</CardTitle>
            <CardDescription>
              Contra qual Atradius o worker bate: homologação ou produção. Vale para envio,
              poll, sync e backfill — não há como um rodar num ambiente e outro no outro.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" disabled={!sujo} onClick={() => setRascunho(null)}>
              Descartar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!sujo || salvando}
              onClick={async () => {
                await onSalvar(escolhido)
                setRascunho(null)
              }}
            >
              <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="ambiente-seguradora" className="shrink-0">
            Ambiente
          </Label>
          <Select
            value={escolhido}
            onValueChange={(v) => ehAmbienteSeguradora(v) && setRascunho(v)}
          >
            <SelectTrigger id="ambiente-seguradora" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AMBIENTES_SEGURADORA) as AmbienteSeguradora[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {AMBIENTES_SEGURADORA[a].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {info.base_url}
          </code>
        </div>

        <p className="text-[0.8rem] text-muted-foreground">{info.descricao}</p>

        {escolhido === 'producao' && (
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <p className="text-[0.8rem] text-muted-foreground">
              Em produção, cada envio da esteira é um pedido de cobertura de verdade e a busca
              de buyer <strong>pode ser cobrada</strong> pela Atradius. Confira antes que as
              credenciais de produção estejam no worker: sem elas, nada é enviado — a esteira
              trava em &ldquo;não configurada&rdquo; em vez de cair nas de homologação.
            </p>
          </div>
        )}

        <p className="text-[0.8rem] text-muted-foreground">
          As credenciais de cada ambiente ficam nas variáveis do worker
          (<code className="text-[11px]">ATRADIUS_PROD_*</code> e{' '}
          <code className="text-[11px]">ATRADIUS_SANDBOX_*</code>), nunca aqui — esta tela é
          legível por todo o time de Crédito. A troca leva até um minuto para o worker
          enxergar.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Como nos identificamos para a Atradius, e como o CNPJ se apresenta a ela.
 *
 * O `uidType` está numa tela de negócio porque o modo de falha dele é de negócio: errado,
 * ele não devolve erro de rota — devolve "buyer não encontrado", e a análise vai para
 * revisão manual como se a empresa não existisse na seguradora. Descobrir qual dos sete
 * vale para o CNPJ é tentar na sandbox, e tentar precisa ser um clique.
 */
function IdentificacaoNaSeguradora({
  organizacaoId,
  uidType,
  onSalvar,
  salvando,
}: {
  organizacaoId: string
  uidType: UidTypeSeguradora
  onSalvar: (v: { organizacao_id: string; uid_type: UidTypeSeguradora }) => Promise<void>
  salvando: boolean
}) {
  const [org, setOrg] = React.useState<string | null>(null)
  const [tipo, setTipo] = React.useState<UidTypeSeguradora | null>(null)
  const orgAtual = org ?? organizacaoId
  const tipoAtual = tipo ?? uidType
  const sujo = orgAtual !== organizacaoId || tipoAtual !== uidType

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Identificação na seguradora</CardTitle>
            <CardDescription>
              Quem somos para a Atradius, e como o CNPJ é apresentado na busca de buyer.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!sujo}
              onClick={() => {
                setOrg(null)
                setTipo(null)
              }}
            >
              Descartar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!sujo || salvando}
              onClick={async () => {
                await onSalvar({ organizacao_id: orgAtual.trim(), uid_type: tipoAtual })
                setOrg(null)
                setTipo(null)
              }}
            >
              <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="organizacao-id">Organization ID</Label>
          <Input
            id="organizacao-id"
            value={orgAtual}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="—"
          />
          <p className="text-[0.8rem] text-muted-foreground">
            O nosso <em>customer id</em> na Atradius. Identifica, não autentica — por isso mora
            aqui e não nas variáveis do worker.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uid-type">Tipo de identificador do buyer</Label>
          <Select
            value={tipoAtual}
            onValueChange={(v) => ehUidTypeSeguradora(v) && setTipo(v)}
          >
            <SelectTrigger id="uid-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UID_TYPES_SEGURADORA.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[0.8rem] text-muted-foreground">
            Como o CNPJ é enviado na busca (<code className="text-[11px]">uidType</code>). O enum
            é fechado e <strong>não tem CNPJ</strong>; NRN e CR são os candidatos para um
            registro nacional. Errado, a busca devolve &ldquo;buyer não encontrado&rdquo; em vez
            de erro — teste na homologação antes de valer em produção.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export interface CronDoCredito {
  path: string
  schedule: string
}

/**
 * O que cada cron do Crédito faz. A CHAVE é o caminho, e a lista de horários vem do
 * `vercel.json` — aqui mora só a explicação, que o arquivo de configuração não tem onde
 * guardar.
 */
const OQUE_FAZ: Record<string, { titulo: string; detalhe: string }> = {
  '/api/cron/credito-sync': {
    titulo: 'Atualizações da seguradora',
    detalhe:
      'Lê as decisões da apólice, consulta as análises abertas e expira as aprovações vencidas. É este que traz o retorno da Atradius.',
  },
  '/api/cron/credito-mensal': {
    titulo: 'Calibração mensal',
    detalhe: 'Recalibra os coeficientes, repontua o scorecard e reestima o limite potencial da base.',
  },
  '/api/cron/credito-reanalises': {
    titulo: 'Reanálises e fila própria',
    detalhe: 'Sugere quem merece nova análise e destrava as análises proprietárias paradas.',
  },
}

/** `0 9 * * *` → "todo dia às 09:00". Só as formas que a gente usa; o resto sai cru. */
function lerCron(expr: string): string {
  const [min, hora, dia, , semana] = expr.split(' ')
  if (min === undefined || hora === undefined) return expr
  const hhmm = `${hora.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (dia && dia !== '*') return `todo dia ${dia} do mês, às ${hhmm}`
  if (semana && semana !== '*') return `semanalmente, às ${hhmm}`
  return `todo dia, às ${hhmm}`
}

/**
 * Os horários automáticos do módulo.
 *
 * Existe porque "o crédito atualiza sozinho?" era uma pergunta cuja resposta morava num
 * arquivo de configuração do deploy — visível para quem lê o repositório e para mais
 * ninguém. Quem opera a esteira precisa saber que a decisão da seguradora chega de manhã
 * sem ninguém clicar, e a que horas, para não sair procurando o botão.
 *
 * Os horários são UTC porque é assim que o agendador os executa. Converter para o fuso de
 * Brasília na tela pareceria gentileza e seria armadilha: quem for conferir o agendamento
 * lá encontraria outro número e não saberia qual dos dois está certo. O horário local vai
 * ao lado, rotulado, sem substituir o original.
 */
function Automacoes({ crons }: { crons: CronDoCredito[] }) {
  if (crons.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Rotinas automáticas</CardTitle>
        <CardDescription>
          O que roda sozinho neste módulo, e quando. Todos podem ser disparados à mão no
          Painel — o horário é só o piso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {crons.map((c) => {
          const info = OQUE_FAZ[c.path]
          const [min, hora] = c.schedule.split(' ')
          const horaBrt =
            hora && min && /^\d+$/.test(hora)
              ? `${String((Number(hora) + 24 - 3) % 24).padStart(2, '0')}:${min.padStart(2, '0')}`
              : null
          return (
            <div key={c.path} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{info?.titulo ?? c.path}</p>
                {info ? (
                  <p className="text-[0.8rem] text-muted-foreground">{info.detalhe}</p>
                ) : null}
                <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {c.path}
                </code>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums">{lerCron(c.schedule)} UTC</p>
                {horaBrt && (
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {horaBrt} em Brasília
                  </p>
                )}
              </div>
            </div>
          )
        })}
        <p className="text-[0.8rem] text-muted-foreground">
          A expiração de aprovações vencidas roda <strong>mesmo sem seguradora
          configurada</strong>: a data de validade é nossa, e uma aprovação vencida contando
          como vigente valeria pontos no scorecard que ela não tem mais.
        </p>
      </CardContent>
    </Card>
  )
}

export function CreditoConfig({ crons = [] }: { crons?: CronDoCredito[] }) {
  const qc = useQueryClient()
  const [rascunho, setRascunho] = React.useState<Record<string, Record<string, string>>>({})
  const [salvando, setSalvando] = React.useState<string | null>(null)

  const config = useQuery({ queryKey: creditoKeys.config(), queryFn: buscarCreditoConfig })
  const versao = useQuery({ queryKey: creditoKeys.versao(), queryFn: buscarVersaoCredito })

  function valorDe(chave: string, campo: string): string {
    const doRascunho = rascunho[chave]?.[campo]
    if (doRascunho !== undefined) return doRascunho
    const bloco = (config.data?.[chave] ?? {}) as Record<string, unknown>
    const v = bloco[campo]
    return v === null || v === undefined ? '' : String(v)
  }

  function ajustar(chave: string, campo: string, valor: string) {
    setRascunho((r) => ({ ...r, [chave]: { ...(r[chave] ?? {}), [campo]: valor } }))
  }

  async function salvar(chave: string) {
    setSalvando(chave)
    const bloco = { ...((config.data?.[chave] ?? {}) as Record<string, unknown>) }
    for (const [campo, texto] of Object.entries(rascunho[chave] ?? {})) {
      // '' vira NULL, não 0: para giro e ratio, essa é literalmente a diferença entre
      // "usa o calibrado" e "trava em zero, e nenhuma empresa tem limite".
      bloco[campo] = texto.trim() === '' ? null : Number(texto)
    }
    const r = await salvarCreditoConfigAction({ chave, valor: bloco })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Configuração salva. Rode "Só potencial" no painel para reaplicar.')
    setRascunho((s) => ({ ...s, [chave]: {} }))
    void qc.invalidateQueries({ queryKey: creditoKeys.config() })
  }

  async function salvarAmbiente(ambiente: AmbienteSeguradora) {
    setSalvando('ambiente')
    // Merge sobre o bloco inteiro: `poll_intervalo_horas` e `validade_padrao_meses` moram
    // na mesma linha, e salvar só o ambiente apagaria os dois.
    const bloco = { ...((config.data?.atradius ?? {}) as Record<string, unknown>), ambiente }
    const r = await salvarCreditoConfigAction({ chave: 'atradius', valor: bloco })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      ambiente === 'producao'
        ? 'Seguradora em PRODUÇÃO. Os próximos envios valem de verdade.'
        : 'Seguradora em homologação. Nada enviado daqui vira cobertura.',
    )
    void qc.invalidateQueries({ queryKey: creditoKeys.config() })
  }

  async function salvarIdentificacao(v: { organizacao_id: string; uid_type: UidTypeSeguradora }) {
    setSalvando('identificacao')
    const bloco = { ...((config.data?.atradius ?? {}) as Record<string, unknown>), ...v }
    const r = await salvarCreditoConfigAction({ chave: 'atradius', valor: bloco })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Identificação salva. O worker leva até um minuto para enxergar.')
    void qc.invalidateQueries({ queryKey: creditoKeys.config() })
  }

  async function salvarTipos(tipos: TipoDoc[]) {
    setSalvando('docs')
    // Id gerado só para os NOVOS (os que ainda estão com o placeholder). Regerar o id de
    // um tipo existente porque o rótulo mudou órfãos os arquivos já anexados.
    const existentes = new Set(
      (((config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []).map((t) => t.id)),
    )
    const normalizados = tipos.map((t) =>
      existentes.has(t.id) ? t : { ...t, id: idDoLabel(t.label) || t.id },
    )
    const r = await salvarCreditoConfigAction({ chave: 'docs', valor: { tipos: normalizados } })
    setSalvando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Checklist de documentos salvo.')
    void qc.invalidateQueries({ queryKey: creditoKeys.config() })
  }

  if (config.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  // Mesmo default do worker: valor ausente ou desconhecido é homologação, nunca produção.
  const ambienteBruto = (config.data?.atradius as { ambiente?: unknown } | undefined)?.ambiente
  const ambienteAtual = ehAmbienteSeguradora(ambienteBruto)
    ? ambienteBruto
    : AMBIENTE_SEGURADORA_PADRAO

  const atradius = (config.data?.atradius ?? {}) as { organizacao_id?: unknown; uid_type?: unknown }
  const organizacaoId = typeof atradius.organizacao_id === 'string' ? atradius.organizacao_id : ''
  const uidType = ehUidTypeSeguradora(atradius.uid_type)
    ? atradius.uid_type
    : UID_TYPE_SEGURADORA_PADRAO

  const coef = (versao.data?.coeficientes ?? null) as
    | { ratio_limite?: { global?: number | null }; giro_mensal?: number | null }
    | null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Calibração vigente</CardTitle>
          <CardDescription>
            O que a carteira real disse na última calibração. Os overrides abaixo vencem estes
            valores — e é aqui que se confere qual está valendo.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Ratio limite/faturamento</p>
            <p className="text-lg font-semibold tabular-nums">
              {coef?.ratio_limite?.global ?? '—'}
            </p>
            {!coef?.ratio_limite?.global && (
              <p className="text-[11px] text-muted-foreground">
                Sem clientes com faturamento declarado.
              </p>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Giro mensal</p>
            <p className="text-lg font-semibold tabular-nums">
              {coef?.giro_mensal ? `${(coef.giro_mensal * 100).toFixed(1)}%` : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground">do limite, por mês</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Versão</p>
            <p className="text-lg font-semibold tabular-nums">{versao.data?.versao ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      <AmbienteDaSeguradora
        atual={ambienteAtual}
        onSalvar={salvarAmbiente}
        salvando={salvando === 'ambiente'}
      />

      <Automacoes crons={crons} />

      <IdentificacaoNaSeguradora
        organizacaoId={organizacaoId}
        uidType={uidType}
        onSalvar={salvarIdentificacao}
        salvando={salvando === 'identificacao'}
      />

      <TiposDeDocumento
        tipos={((config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []) as TipoDoc[]}
        onSalvar={salvarTipos}
        salvando={salvando !== null}
      />

      {CAMPOS.map((grupo) => {
        const sujo = Object.keys(rascunho[grupo.chave] ?? {}).length > 0
        return (
          <Card key={grupo.chave}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">{grupo.titulo}</CardTitle>
                  <CardDescription>{grupo.descricao}</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={!sujo || salvando !== null}
                  onClick={() => void salvar(grupo.chave)}
                >
                  <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {salvando === grupo.chave ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {grupo.campos.map((c) => (
                <div key={c.campo} className="space-y-1.5">
                  <Label htmlFor={`${c.chave}.${c.campo}`}>{c.label}</Label>
                  <Input
                    id={`${c.chave}.${c.campo}`}
                    type="number"
                    step={c.step ?? '1'}
                    value={valorDe(c.chave, c.campo)}
                    onChange={(e) => ajustar(c.chave, c.campo, e.target.value)}
                    placeholder="—"
                  />
                  {c.descricao && <p className="text-[0.8rem] text-muted-foreground">{c.descricao}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
