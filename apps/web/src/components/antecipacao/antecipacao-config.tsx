'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Database, Play, Save } from 'lucide-react'
import {
  ANTECIPACAO_CONFIG_CHAVES,
  CONFIG_DISPARO_PADRAO,
  CONFIG_ECONOMIA_PADRAO,
  CONFIG_FUNIL_PADRAO,
  CONFIG_LOOKUP_PADRAO,
  CONFIG_SUPRESSAO_PADRAO,
  CONFIG_SYNC_PADRAO,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  reclassificarFunilAction,
  rodarDiarioAction,
  rodarContatosNfAction,
  rodarLookupAction,
  salvarConfigAction,
  sincronizarNfsAction,
} from '@/actions/antecipacao'
import { formatarInteiro } from './format'
import { antecipacaoKeys, buscarConfig, buscarFilaLookup } from './queries'

/**
 * Settings do módulo (§9) + os disparos manuais dos jobs.
 *
 * Cada campo é um número que muda o comportamento de um job, e todos têm um
 * default no core — a linha da tabela pode faltar sem quebrar nada. O que ESTA
 * tela adiciona é a explicação: um campo chamado "mínimo operável" sem a frase
 * "abaixo disto a nota sai das faixas" é um número que ninguém ousa mexer.
 */

interface CampoNum {
  chave: keyof typeof ANTECIPACAO_CONFIG_CHAVES
  grupo: string
  campo: string
  label: string
  descricao: string
  min?: number
  max?: number
  step?: number
}

const CAMPOS: readonly CampoNum[] = [
  {
    chave: 'FUNIL',
    grupo: 'funil',
    campo: 'minimo_operavel_dias',
    label: 'Mínimo operável (dias)',
    descricao:
      'Abaixo disto a nota sai das faixas com motivo "expirada" — e, se estava em prospecção ativa, sai do funil. É este número que impede o Kanban de encher de nota que não dá mais para operar.',
    min: 0,
    max: 90,
  },
  {
    chave: 'FUNIL',
    grupo: 'funil',
    campo: 'janela_vencimento_min_dias',
    label: 'Janela de vencimento — mínimo (dias)',
    descricao:
      'Referência usada pelas regras seed. Mudar aqui NÃO muda as regras já salvas: elas guardam o número que você escolheu quando as criou. Edite a regra em "Regras de faixa".',
    min: 0,
    max: 365,
  },
  {
    chave: 'FUNIL',
    grupo: 'funil',
    campo: 'janela_vencimento_max_dias',
    label: 'Janela de vencimento — máximo (dias)',
    descricao: 'Mesma observação: é referência, não valor efetivo das regras já salvas.',
    min: 1,
    max: 720,
  },
  {
    chave: 'ECONOMIA',
    grupo: 'economia',
    campo: 'taxa_mensal_padrao',
    label: 'Taxa mensal padrão (%)',
    descricao:
      'Usada no cálculo da receita esperada quando o sacado não tem snapshot de crédito com taxa. A taxa efetivamente usada é gravada em cada nota, para que a receita de ontem continue auditável depois que a taxa mudar.',
    min: 0,
    max: 20,
    step: 0.01,
  },
  {
    chave: 'DISPARO',
    grupo: 'disparo',
    campo: 'cooldown_dias_padrao',
    label: 'Cooldown padrão (dias)',
    descricao:
      'Fallback quando a faixa não define o seu. O cooldown por faixa vive em "Disparos".',
    min: 0,
    max: 365,
  },
  {
    chave: 'SUPRESSAO',
    grupo: 'supressao',
    campo: 'soft_dias_padrao',
    label: 'Supressão soft (dias)',
    descricao:
      'Duração de um "sem interesse agora". Passado o prazo, o job diário remove a supressão e o fornecedor volta ao funil. Supressão ETERNA nunca expira.',
    min: 1,
    max: 3650,
  },
  {
    chave: 'SYNC',
    grupo: 'sync',
    campo: 'sync_horas_max',
    label: 'Teto de sync_hours (horas)',
    descricao:
      'LIMITE DO ENDPOINT, não preferência: o filtro `sync_hours` aceita 1 a 4. Subir daqui não amplia a janela — faz a API responder 400. O job pede o gap desde a última corrida, arredondado para cima, dentro deste teto.',
    min: 1,
    max: 4,
  },
  {
    chave: 'SYNC',
    grupo: 'sync',
    campo: 'intervalo_max_dias',
    label: 'Teto do intervalo por emissão (dias)',
    descricao:
      'LIMITE DO ENDPOINT: `start_date`/`end_date` aceitam no máximo 10 dias por requisição. A recuperação e a varredura fatiam a janela em blocos deste tamanho.',
    min: 1,
    max: 10,
  },
  {
    chave: 'SYNC',
    grupo: 'sync',
    campo: 'varredura_dias',
    label: 'Varredura diária por emissão (dias)',
    descricao:
      'A rede de segurança. `sync_hours` só enxerga 4h para trás e o cron roda de 4 em 4: uma corrida que falhe abre um buraco que nenhum incremental posterior alcança. O job diário revarre esta janela de emissão e o fecha em até 24h — de graça, porque o upsert é idempotente por chave de acesso.',
    min: 0,
    max: 365,
  },
  {
    chave: 'SYNC',
    grupo: 'sync',
    campo: 'page_size',
    label: 'Tamanho da página do sync',
    descricao: 'Quantas notas por requisição ao endpoint. O default da API é 50; não há máximo.',
    min: 10,
    max: 1000,
  },
  {
    chave: 'SYNC',
    grupo: 'sync',
    campo: 'janela_inicial_dias',
    label: 'Janela da primeira execução (dias)',
    descricao:
      'Sem histórico de sync, quantos dias de EMISSÃO trazer — fatiados no teto acima. "Desde sempre" traria anos de nota e estouraria a primeira corrida.',
    min: 1,
    max: 730,
  },
  {
    chave: 'LOOKUP',
    grupo: 'lookup_cadastral',
    campo: 'max_tentativas',
    label: 'Lookup — máximo de tentativas',
    descricao:
      'Depois disto o CNPJ é marcado como não encontrado e um evento pede revisão manual.',
    min: 1,
    max: 50,
  },
  {
    chave: 'LOOKUP',
    grupo: 'lookup_cadastral',
    campo: 'max_por_execucao',
    label: 'Lookup — CNPJs por execução',
    descricao:
      'Teto por corrida. Precisa ser MAIOR que a chegada diária de CNPJs novos, senão a fila cresce em vez de drenar — foi o que aconteceu com 300.',
    min: 10,
    max: 5000,
  },
  {
    chave: 'LOOKUP',
    grupo: 'lookup_cadastral',
    campo: 'orcamento_ms',
    label: 'Lookup — orçamento de tempo (ms)',
    descricao:
      'Teto de duração da corrida. O teto por quantidade não basta: se a primeira fonte cair, a cascata desce para a ReceitaWS a 21s por CNPJ. A fila é persistente — o que sobra entra na próxima.',
    min: 30_000,
    max: 3_600_000,
    step: 30_000,
  },
  {
    chave: 'LOOKUP',
    grupo: 'lookup_cadastral',
    campo: 'receitaws_intervalo_ms',
    label: 'ReceitaWS — intervalo entre chamadas (ms)',
    descricao:
      'O plano gratuito aceita 3 requisições por minuto. É o último recurso da cascata, e leva throttle rígido: 21000 ms mantém a folga.',
    min: 1000,
    max: 120_000,
    step: 1000,
  },
]

const PADROES: Record<string, Record<string, number | boolean>> = {
  funil: { ...CONFIG_FUNIL_PADRAO },
  economia: { ...CONFIG_ECONOMIA_PADRAO },
  disparo: { ...CONFIG_DISPARO_PADRAO },
  supressao: { ...CONFIG_SUPRESSAO_PADRAO },
  sync: { ...CONFIG_SYNC_PADRAO },
  lookup_cadastral: { ...CONFIG_LOOKUP_PADRAO },
}

export function AntecipacaoConfig() {
  const qc = useQueryClient()
  const [rascunho, setRascunho] = React.useState<Record<string, Record<string, number>>>({})
  const [salvando, setSalvando] = React.useState(false)
  const [rodando, setRodando] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.config(),
    queryFn: buscarConfig,
  })

  const { data: fila } = useQuery({
    queryKey: antecipacaoKeys.filaLookup(),
    queryFn: buscarFilaLookup,
  })

  function valorDe(grupo: string, campo: string): number {
    const local = rascunho[grupo]?.[campo]
    if (typeof local === 'number') return local
    const salvo = (data?.[grupo] as Record<string, unknown> | undefined)?.[campo]
    if (typeof salvo === 'number') return salvo
    return Number(PADROES[grupo]?.[campo] ?? 0)
  }

  function alterar(grupo: string, campo: string, valor: number) {
    setRascunho((r) => ({ ...r, [grupo]: { ...(r[grupo] ?? {}), [campo]: valor } }))
  }

  async function salvar() {
    setSalvando(true)
    // Um RPC por GRUPO (a chave é o grupo), não por campo: `antecipacao_config`
    // guarda um jsonb por chave, e salvar campo a campo sobrescreveria os irmãos.
    for (const grupo of Object.keys(rascunho)) {
      const atual = (data?.[grupo] as Record<string, unknown> | undefined) ?? PADROES[grupo] ?? {}
      const r = await salvarConfigAction({
        chave: grupo,
        valor: { ...atual, ...rascunho[grupo] },
      })
      if (!r.ok) {
        setSalvando(false)
        toast.error(r.message)
        return
      }
    }
    setSalvando(false)
    setRascunho({})
    toast.success('Configurações salvas.')
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.config() })
  }

  async function rodar(nome: string, acao: () => Promise<{ ok: boolean; data?: { enfileirado: boolean; aviso?: string }; message?: string }>) {
    setRodando(nome)
    const r = await acao()
    setRodando(null)
    if (!r.ok) {
      toast.error(r.message ?? 'Não foi possível enfileirar o job.')
      return
    }
    if (r.data?.enfileirado) toast.success(`${nome} enfileirado no worker.`)
    else toast.warning(`O worker não aceitou o job: ${r.data?.aviso ?? 'motivo desconhecido'}.`)
  }

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar as configurações.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  const alterado = Object.keys(rascunho).length > 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parâmetros do módulo</CardTitle>
          <CardDescription>
            Cada valor tem um default no código — a linha pode faltar no banco sem quebrar nenhum
            job.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {CAMPOS.map((c) => (
            <div key={`${c.grupo}.${c.campo}`} className="grid gap-2 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-start">
              <div className="space-y-1.5">
                <Label htmlFor={`${c.grupo}-${c.campo}`}>{c.label}</Label>
                <Input
                  id={`${c.grupo}-${c.campo}`}
                  type="number"
                  min={c.min}
                  max={c.max}
                  step={c.step ?? 1}
                  value={valorDe(c.grupo, c.campo)}
                  onChange={(e) => alterar(c.grupo, c.campo, Number(e.target.value))}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground sm:pt-7">{c.descricao}</p>
            </div>
          ))}

          <Button onClick={() => void salvar()} disabled={!alterado || salvando}>
            <Save className="mr-2 h-4 w-4" aria-hidden />
            {salvando ? 'Salvando…' : 'Salvar configurações'}
          </Button>
        </CardContent>
      </Card>

      {/* ─── Fila de lookup cadastral ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base">Fila de enriquecimento cadastral</CardTitle>
          </div>
          <CardDescription>
            Fornecedores de NF quase nunca têm CNAE de construção, então não existem no universo da
            Receita que importamos. Esta fila os resolve por APIs públicas gratuitas
            (minhareceita → BrasilAPI → ReceitaWS) e os grava no universo marcados como fora do
            recorte — existem para o funil, sem poluir a pirâmide comercial.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="tabular-nums">
            {formatarInteiro(fila?.pendente ?? 0)} pendentes
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            {formatarInteiro(fila?.resolvido_api ?? 0)} resolvidos
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            {formatarInteiro(fila?.nao_encontrado ?? 0)} não encontrados
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            {formatarInteiro(fila?.erro ?? 0)} com erro
          </Badge>
        </CardContent>
      </Card>

      {/* ─── Jobs ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rodar agora</CardTitle>
          <CardDescription>
            Os mesmos jobs dos crons, sob demanda. Todos assíncronos: o botão enfileira e volta.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={rodando !== null}
            onClick={() => void rodar('Sync de NFs', sincronizarNfsAction)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Sync de NFs
          </Button>
          <Button
            variant="outline"
            disabled={rodando !== null}
            onClick={() => void rodar('Job diário', rodarDiarioAction)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Job diário completo
          </Button>
          <Button
            variant="outline"
            disabled={rodando !== null}
            onClick={() => void rodar('Reclassificação', reclassificarFunilAction)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Reclassificar funil
          </Button>
          <Button
            variant="outline"
            disabled={rodando !== null}
            onClick={() => void rodar('Lookup cadastral', rodarLookupAction)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Lookup cadastral
          </Button>
          {/*
           * Retroativo por natureza: o sync é incremental e nunca rebusca nota
           * antiga, então o contato que chegou antes desta rotina existir só sai
           * do jsonb por aqui. Depois disso o diário mantém em dia sozinho.
           */}
          <Button
            variant="outline"
            disabled={rodando !== null}
            onClick={() => void rodar('Contatos das NFs', rodarContatosNfAction)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Contatos das NFs
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
