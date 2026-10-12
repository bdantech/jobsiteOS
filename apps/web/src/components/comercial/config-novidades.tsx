'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CloudDownload, Trash2 } from 'lucide-react'
import {
  CONFIG_NOVIDADES_PADRAO,
  ESCOPOS_DIA_NAO_UTIL,
  ESCOPO_DIA_NAO_UTIL_LABELS,
  buscarDiasNaoUteis,
  descreverJanela,
  lerConfigNovidades,
  montarCalendario,
  resolverJanelaNovidades,
  type ConfigNovidades as Config,
  type EscopoDiaNaoUtil,
} from '@jobsiteos/core'
import {
  importarFeriadosAction,
  removerDiaNaoUtilAction,
  salvarConfigNovidadesAction,
  salvarDiaNaoUtilAction,
} from '@/actions/funil-novidades'
import { novidadesKeys } from '@/components/antecipacao/use-novidades'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'

/**
 * Funil de NFs → Novidades (04t §8): o expediente, o marcador de visita e o calendário
 * de dias não úteis.
 *
 * São as três coisas que decidem o que a janela "desde meu último expediente" mostra.
 * Os feriados NACIONAIS vêm da BrasilAPI; os estaduais, os municipais e a emenda que a
 * empresa decidiu tirar são cadastro daqui — a BrasilAPI não traz 9 de julho nem
 * aniversário de cidade, e é exatamente isso que gera a segunda-feira errada.
 *
 * A LIMITAÇÃO, que a tela diz por extenso: a janela segue o calendário da EMPRESA, não
 * a presença de cada pessoa. Quem volta de férias usa o intervalo personalizado.
 */

const chave = ['comercial', 'funil-novidades'] as const

async function buscar() {
  const supabase = createClient()
  const ano = new Date().getFullYear()
  const [cfg, dias] = await Promise.all([
    supabase.from('antecipacao_config').select('valor').eq('chave', 'funil_novidades').maybeSingle(),
    buscarDiasNaoUteis(supabase, ano - 1),
  ])
  return { cfg: lerConfigNovidades(cfg.data?.valor), dias }
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function ConfigNovidades() {
  const qc = useQueryClient()
  const dados = useQuery({ queryKey: chave, queryFn: buscar })
  const [ocupado, setOcupado] = React.useState(false)
  const [novo, setNovo] = React.useState<{ data: string; nome: string; escopo: EscopoDiaNaoUtil }>({
    data: '',
    nome: '',
    escopo: 'empresa',
  })

  function recarregar() {
    void qc.invalidateQueries({ queryKey: chave })
    // A janela de todas as telas lê este contexto: sem isto o funil continuaria com o
    // expediente antigo por até meia hora.
    void qc.invalidateQueries({ queryKey: novidadesKeys.contexto() })
  }

  async function executar(acao: () => Promise<{ ok: boolean; message?: string }>, sucesso: string) {
    setOcupado(true)
    const r = await acao()
    setOcupado(false)
    if (!r.ok) return toast.error(r.message ?? 'Não foi possível salvar.')
    toast.success(sucesso)
    recarregar()
  }

  if (dados.isPending) return <Skeleton className="h-72 w-full" />

  const cfg = dados.data?.cfg ?? CONFIG_NOVIDADES_PADRAO
  const dias = dados.data?.dias ?? []
  const anoAtual = new Date().getFullYear()
  const anosImportados = [...new Set(dias.filter((d) => d.origem === 'brasilapi').map((d) => d.data.slice(0, 4)))]
  const semCalendario = !anosImportados.includes(String(anoAtual))

  // A prévia é a mesma conta da tela do funil, com o que está salvo agora.
  const agora = new Date()
  const previa = resolverJanelaNovidades('expediente', agora, montarCalendario(dias), cfg)

  const salvarCfg = (parte: Partial<Config>) =>
    executar(() => salvarConfigNovidadesAction({ ...cfg, ...parte }), 'Expediente salvo.')

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Funil de NFs — novidades</CardTitle>
        <CardDescription>
          O filtro <strong>Novidades</strong> do funil mostra o que entrou desde o fim do último
          expediente útil: segunda de manhã traz desde sexta, e depois de feriado emendado volta
          até o último dia trabalhado. A janela segue o calendário da empresa, não a presença de
          cada pessoa — quem volta de férias ou folga usa o intervalo personalizado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="space-y-1.5 text-sm">
          <CampoHora
            rotulo="Início do expediente"
            valor={cfg.expediente_inicio}
            disabled={ocupado}
            onSalvar={(v) => void salvarCfg({ expediente_inicio: v })}
          />
          <CampoHora
            rotulo="Fim do expediente"
            valor={cfg.expediente_fim}
            disabled={ocupado}
            onSalvar={(v) => void salvarCfg({ expediente_fim: v })}
          />
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">
              Selo “Novo”: minutos longe do funil para contar visita nova
              <span className="block text-xs">
                O selo marca o que entrou depois da visita anterior. Voltar ao funil antes disso
                não apaga os selos.
              </span>
            </dt>
            <dd>
              <CampoMinutos
                valor={cfg.minutos_para_avancar_marcador}
                disabled={ocupado}
                onSalvar={(n) => void salvarCfg({ minutos_para_avancar_marcador: n })}
              />
            </dd>
          </div>
        </dl>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Horário de Brasília. Com o que está salvo, a janela de agora seria:{' '}
          <strong className="text-foreground">
            {previa ? descreverJanela(previa, agora).replace('Mostrando o que entrou ', '') : '—'}
          </strong>
          .
        </p>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Dias sem expediente</p>
              <p className="max-w-xl text-xs text-muted-foreground">
                Além de sábado e domingo. Os nacionais vêm da BrasilAPI uma vez por ano (ano
                corrente e o seguinte); feriados estaduais, municipais e pontos facultativos da
                empresa são cadastrados aqui. O que foi cadastrado à mão não é sobrescrito pela
                importação.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ocupado}
              onClick={() =>
                void executar(async () => {
                  const r = await importarFeriadosAction()
                  if (r.ok) {
                    const falhos = r.data.anos.filter((a) => a.erro).map((a) => a.ano)
                    if (falhos.length) toast.warning(`Sem resposta para ${falhos.join(' e ')}. Tente de novo mais tarde.`)
                  }
                  return r
                }, 'Feriados nacionais importados.')
              }
            >
              <CloudDownload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Importar feriados nacionais
            </Button>
          </div>

          {semCalendario ? (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Os feriados nacionais de {anoAtual} ainda não foram importados. Até lá a janela
              considera só fins de semana e os dias cadastrados abaixo, e o funil avisa isso a quem
              filtra.
            </p>
          ) : null}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!novo.data || novo.nome.trim().length < 2) {
                toast.error('Informe a data e o nome do dia.')
                return
              }
              void executar(() => salvarDiaNaoUtilAction(novo), 'Dia cadastrado.').then(() =>
                setNovo({ data: '', nome: '', escopo: novo.escopo }),
              )
            }}
          >
            <label className="space-y-1 text-xs text-muted-foreground">
              Data
              <Input
                type="date"
                value={novo.data}
                onChange={(e) => setNovo({ ...novo, data: e.target.value })}
                className="h-8 w-40"
              />
            </label>
            <label className="min-w-[14rem] flex-1 space-y-1 text-xs text-muted-foreground">
              Nome
              <Input
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                placeholder="Revolução Constitucionalista, emenda de Corpus Christi…"
                className="h-8"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Tipo
              <select
                value={novo.escopo}
                onChange={(e) => setNovo({ ...novo, escopo: e.target.value as EscopoDiaNaoUtil })}
                className="block h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                {ESCOPOS_DIA_NAO_UTIL.filter((e) => e !== 'nacional').map((e) => (
                  <option key={e} value={e}>
                    {ESCOPO_DIA_NAO_UTIL_LABELS[e]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" disabled={ocupado}>
              Adicionar
            </Button>
          </form>

          {dias.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum dia cadastrado.</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border text-sm">
              {dias
                .filter((d) => d.data >= `${anoAtual}-01-01`)
                .map((d) => (
                  <li key={d.data} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-24 shrink-0 tabular-nums">{dataBr(d.data)}</span>
                    <span className="min-w-0 flex-1 truncate">{d.nome}</span>
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {ESCOPO_DIA_NAO_UTIL_LABELS[d.escopo as EscopoDiaNaoUtil] ?? d.escopo}
                    </Badge>
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {d.origem === 'brasilapi' ? 'BrasilAPI' : 'manual'}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={ocupado}
                      aria-label={`Remover ${d.nome}, ${dataBr(d.data)}`}
                      title="Remover — o dia volta a ter expediente"
                      onClick={() => void executar(() => removerDiaNaoUtilAction(d.data), 'Dia removido.')}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Salva no BLUR, e só quando mudou — mesma regra dos outros campos desta tela. */
function CampoHora({
  rotulo, valor, onSalvar, disabled,
}: {
  rotulo: string
  valor: string
  onSalvar: (v: string) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(valor)
  React.useEffect(() => setTexto(valor), [valor])
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd>
        <Input
          aria-label={rotulo}
          type="time"
          value={texto}
          disabled={disabled}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => {
            if (!/^\d{2}:\d{2}$/.test(texto)) return setTexto(valor)
            if (texto !== valor) onSalvar(texto)
          }}
          className="h-8 w-28 text-right tabular-nums"
        />
      </dd>
    </div>
  )
}

function CampoMinutos({
  valor, onSalvar, disabled,
}: {
  valor: number
  onSalvar: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = React.useState(String(valor))
  React.useEffect(() => setTexto(String(valor)), [valor])
  return (
    <Input
      aria-label="Minutos para avançar o marcador de visita"
      type="number"
      min={1}
      max={720}
      value={texto}
      disabled={disabled}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(texto))
        if (!Number.isFinite(n) || n < 1 || n > 720) return setTexto(String(valor))
        if (n !== valor) onSalvar(n)
      }}
      className="h-8 w-24 text-right tabular-nums"
    />
  )
}
