'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, EyeOff, ExternalLink, TrendingDown } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import {
  definirExClienteMotivoAction,
  ocultarExClienteAction,
  reexibirExClienteAction,
} from '@/actions/radar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  buscarExClientes,
  buscarExClientesPorMotivo,
  buscarMotivosSaida,
  radarKeys,
  type ExCliente,
} from './queries'

/**
 * Os ex-clientes: quem foi cliente e não tem mais análise de crédito vigente (04h).
 *
 * A tela existe porque a saída de um cliente NÃO gera evento na plataforma — ele
 * simplesmente para de aparecer. O sinal fica na análise de crédito que venceu e
 * ninguém renovou, e sem uma lista que o leia a perda é invisível até alguém
 * perguntar "e a fulana, sumiu?".
 *
 * A ORDEM É POR DATA DE SAÍDA, não por limite. Quem saiu semana passada ainda lembra
 * do nosso nome e do motivo; o maior limite de 2023 é saudade, não lead.
 *
 * O MOTIVO É EDITÁVEL AQUI, inline. Obrigar a abrir a Company 360 para classificar é
 * o que faz ninguém classificar — e a distribuição de motivos no topo é o começo da
 * resposta a "por que perdemos clientes?", que é a única pergunta que esta lista
 * existe para responder.
 */

const brl = (n: number | null) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const brlOuTraco = (n: number | null) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : brl(n)

/**
 * A taxa já vem em PONTOS PERCENTUAIS, não em fração: a base guarda 2.450 para
 * 2,45% a.m. (conferido em `credito_snapshots`, onde 2.450 é o valor mais comum).
 * Multiplicar por 100 aqui imprimiria "245% a.m." — mesma convenção do card de nota.
 */
const taxaOuTraco = (n: number | null) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

/** "há 3 meses" / "há 1 mês" / "neste mês". O relativo é o que diz se ainda vale ligar. */
function haQuantoTempo(meses: number | null): string {
  if (meses === null || meses === undefined) return ''
  if (meses <= 0) return 'neste mês'
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`
}

function combina(c: { nome: string | null; cnpj: string | null }, termo: string): boolean {
  const t = termo.trim().toLowerCase()
  if (!t) return true
  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 3 && (c.cnpj ?? '').includes(digitos)) return true
  return (c.nome ?? '').toLowerCase().includes(t)
}

const JANELAS: readonly { valor: number; rotulo: string }[] = [
  { valor: 6, rotulo: '6 meses' },
  { valor: 12, rotulo: '12 meses' },
  { valor: 24, rotulo: '24 meses' },
]

/**
 * A distribuição de motivos, em barras horizontais de largura proporcional.
 *
 * Barra e não pizza: são até treze categorias com nomes longos, e a pizza precisaria
 * de uma legenda que dobra a área ocupada para dizer a mesma coisa pior. Ordenado por
 * contagem, porque a pergunta é "qual é o maior?".
 *
 * Conta as MESMAS linhas da tabela logo abaixo (`na_lista`, 0115). Contar aqui quem a
 * tabela não mostra é uma contradição a dois centímetros de distância.
 */
function DistribuicaoMotivos({ meses }: { meses: number }) {
  const { data, isPending } = useQuery({
    queryKey: radarKeys.exClientesMotivos(meses),
    queryFn: () => buscarExClientesPorMotivo(meses),
  })

  if (isPending) return <Skeleton className="h-24 w-full" />
  const linhas = data ?? []
  if (linhas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma saída nesta janela.
      </p>
    )
  }

  const maior = Math.max(...linhas.map((l) => l.total), 1)
  const total = linhas.reduce((s, l) => s + l.total, 0)

  return (
    <div className="space-y-1.5">
      {linhas.map((l) => (
        <div key={l.motivo} className="flex items-center gap-2 text-sm">
          <span className="w-56 shrink-0 truncate text-muted-foreground" title={l.motivo}>
            {l.motivo}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
            <div
              className={
                // "Não classificado" em cinza: é ausência de resposta, e pintá-lo da
                // mesma cor dos motivos reais o faria parecer uma causa de churn.
                l.motivo === 'Não classificado'
                  ? 'h-full rounded bg-muted-foreground/30'
                  : 'h-full rounded bg-destructive/60'
              }
              style={{ width: `${Math.max(2, (l.total / maior) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums">
            {l.total}
            <span className="ml-1 text-xs text-muted-foreground">
              {total > 0 ? `${Math.round((l.total / total) * 100)}%` : ''}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** O dropdown de motivo na própria linha. Salva no `onValueChange` — sem botão. */
function MotivoInline({ linha }: { linha: ExCliente }) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = React.useState(false)
  const [obs, setObs] = React.useState(linha.ex_cliente_motivo_obs ?? '')
  const [editandoObs, setEditandoObs] = React.useState(false)

  const { data: motivos } = useQuery({
    queryKey: radarKeys.motivosSaida(),
    queryFn: buscarMotivosSaida,
    staleTime: 60 * 60_000,
  })

  async function salvar(motivoId: string, observacao: string | null) {
    if (!linha.empresa_id) return
    setSalvando(true)
    const r = await definirExClienteMotivoAction({
      empresa_id: linha.empresa_id,
      motivo_id: motivoId,
      observacao,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Motivo registrado.')
    void qc.invalidateQueries({ queryKey: radarKeys.all })
  }

  /*
   * A sugestão só aparece enquanto ninguém classificou de verdade — e "Motivo
   * desconhecido" conta como ninguém: é o default que o detector grava, não uma
   * resposta que alguém deu. Depois da classificação humana, sumir é o certo:
   * insistir numa sugestão contra uma decisão tomada é discutir com o usuário.
   */
  const naoClassificado =
    !linha.ex_cliente_motivo || linha.ex_cliente_motivo_label === 'Motivo desconhecido'
  const sugestao = naoClassificado && linha.motivo_sugerido ? linha : null

  return (
    <div className="space-y-1">
      <Select
        value={linha.ex_cliente_motivo ?? undefined}
        disabled={salvando}
        onValueChange={(v) => void salvar(v, obs.trim() || null)}
      >
        <SelectTrigger className="h-8 w-56 text-xs" aria-label="Motivo da saída">
          <SelectValue placeholder="Classificar saída" />
        </SelectTrigger>
        <SelectContent>
          {(motivos ?? []).map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.motivo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/*
       * Pré-preenche, humano confirma (04h §2). O clique é a confirmação — a
       * sugestão nunca foi gravada, ela é calculada na view a partir de um FATO
       * externo (Receita, protesto, certificado), e a evidência viaja no title
       * para quem confirma poder discordar com base.
       */}
      {sugestao ? (
        <button
          type="button"
          disabled={salvando}
          title={sugestao.motivo_sugerido_evidencia ?? undefined}
          onClick={() => void salvar(sugestao.motivo_sugerido!, obs.trim() || null)}
          className="block w-56 truncate text-left text-xs text-amber-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-400"
        >
          Sugerido: {sugestao.motivo_sugerido_label} ✓
        </button>
      ) : null}

      {/*
       * A observação só aparece depois que há motivo: pedir detalhe antes da causa
       * inverte a ordem da conversa, e uma caixa de texto vazia em cada linha de uma
       * lista longa é ruído puro.
       */}
      {linha.ex_cliente_motivo ? (
        editandoObs ? (
          <Input
            autoFocus
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => {
              setEditandoObs(false)
              if ((linha.ex_cliente_motivo_obs ?? '') !== obs.trim() && linha.ex_cliente_motivo) {
                void salvar(linha.ex_cliente_motivo, obs.trim() || null)
              }
            }}
            placeholder="Detalhe (opcional)"
            className="h-7 w-56 text-xs"
            maxLength={500}
            aria-label="Observação sobre a saída"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditandoObs(true)}
            className="block w-56 truncate text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {obs || '+ observação'}
          </button>
        )
      ) : null}
    </div>
  )
}

export function ExClientesLista({ termo }: { termo: string }) {
  const qc = useQueryClient()
  const [janela, setJanela] = React.useState(12)
  /**
   * UMA gaveta, não duas.
   *
   * Havia dois filtros respondendo à mesma pergunta — "esta empresa conta como
   * cliente que perdemos?" — por caminhos diferentes: "só principais" (heurística de
   * filial/SPE) e "ocultos" (decisão humana, o escape de quando a heurística não
   * fecha). Dois botões, duas contagens, e a chance de discordarem entre si e dos
   * indicadores. São o mesmo conceito com dois nomes.
   *
   * Agora o recorte é `na_lista`, calculado na view (0115) e lido por todo mundo:
   * esta tabela, o gráfico acima dela e os indicadores da aba Análise. O que fica de
   * fora não some — fica atrás deste toggle, com a marca de POR QUE saiu, porque "as
   * cinco SPEs daquele grupo saíram no mesmo trimestre" é informação.
   */
  const [verFora, setVerFora] = React.useState(false)
  const [ocultando, setOcultando] = React.useState<string | null>(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: radarKeys.exClientes(),
    queryFn: buscarExClientes,
  })

  const linhas = React.useMemo(
    () =>
      (data ?? []).filter((c) => {
        if (!combina(c, termo)) return false
        // `=== true` e não `!== false`: um nulo vindo da view já reapareceu na lista
        // uma vez, quando `e_spe` saía NULO por lógica de três valores do SQL.
        return verFora ? c.na_lista !== true : c.na_lista === true
      }),
    [data, termo, verFora],
  )

  const fora = (data ?? []).filter((c) => c.na_lista !== true).length

  async function alternarOculto(c: ExCliente) {
    if (!c.cnpj) return
    const estaOculto = c.oculto === true
    setOcultando(c.cnpj)
    const r = estaOculto ? await reexibirExClienteAction(c.cnpj) : await ocultarExClienteAction(c.cnpj)
    setOcultando(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    /*
     * Reexibir uma filial/SPE desfaz o ocultar mas NÃO devolve a linha — ela continua
     * fora pela heurística. Prometer "de volta à lista" e a pessoa não achar a
     * empresa lá é o tipo de mentira pequena que faz duvidar do resto da tela.
     */
    toast.success(
      !estaOculto
        ? 'Fora da lista.'
        : c.e_principal === true
          ? 'De volta à lista.'
          : 'Ocultar desfeito — segue fora por ser filial/SPE.',
    )
    void qc.invalidateQueries({ queryKey: radarKeys.all })
  }

  if (isPending) return <Skeleton className="h-64 w-full" />

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro ao carregar os ex-clientes.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    )
  }

  if ((data ?? []).length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum ex-cliente detectado. A lista se enche quando o sync de análises encontrar um
          cliente cuja última análise aprovada venceu sem renovação.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-medium">Por que saíram</h3>
            </div>
            <div
              role="group"
              aria-label="Janela da distribuição de motivos"
              className="flex items-center rounded-md border border-border p-0.5"
            >
              {JANELAS.map((j) => (
                <button
                  key={j.valor}
                  type="button"
                  onClick={() => setJanela(j.valor)}
                  aria-pressed={janela === j.valor}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    janela === j.valor
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {j.rotulo}
                </button>
              ))}
            </div>
          </div>
          <DistribuicaoMotivos meses={janela} />
        </CardContent>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm text-muted-foreground">
            {verFora ? (
              <>
                <strong>Fora da lista</strong>: filiais, SPEs e o que alguém ocultou à mão. Nada
                foi apagado — a marca em cada linha diz por que ela está aqui.
              </>
            ) : (
              <>
                Mostrando <strong>clientes principais</strong> — é este recorte que os
                indicadores contam
                {fora > 0 ? <> · {fora} fora da lista</> : null}.
              </>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {(fora > 0 || verFora) && (
              <Button variant={verFora ? 'default' : 'outline'} size="sm" onClick={() => setVerFora((v) => !v)}>
                {verFora ? 'Voltar à lista' : `Fora da lista (${fora})`}
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Saiu em</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
                <th className="px-4 py-2 text-right font-medium">Último limite</th>
                <th className="px-4 py-2 text-right font-medium">Consumo histórico</th>
                <th className="px-4 py-2 text-right font-medium">Taxa</th>
                <th className="px-4 py-2 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {termo.trim()
                      ? `Nenhum ex-cliente para “${termo.trim()}”.`
                      : verFora
                        ? 'Nada fora da lista.'
                        : 'Nenhum ex-cliente na lista.'}
                  </td>
                </tr>
              )}
              {linhas.map((c) => (
                <tr key={c.empresa_id} className="align-top">
                  <td className="max-w-[18rem] px-4 py-3">
                    <p className="truncate font-medium">{c.nome ?? '—'}</p>
                    <p className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {c.cnpj ? formatCnpj(c.cnpj) : '—'}
                      {/*
                       * Na gaveta, a marca é o que responde "por que esta empresa está
                       * fora?" — e são três motivos diferentes que podem coexistir.
                       * Sem elas a lista mistura "a construtora saiu" com "uma obra
                       * dela terminou", e as duas linhas parecem a mesma perda.
                       */}
                      {c.e_filial ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-sans">Filial</span>
                      ) : null}
                      {c.e_spe ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-sans">SPE</span>
                      ) : null}
                      {c.oculto ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-sans">Oculta à mão</span>
                      ) : null}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {dataBr(c.ex_cliente_desde)}
                    <span className="block text-xs text-muted-foreground">
                      {haQuantoTempo(c.meses_desde)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <MotivoInline linha={c} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {brlOuTraco(c.ultimo_limite)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {brlOuTraco(c.consumo_historico)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {taxaOuTraco(c.ultima_taxa_d0)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {c.empresa_id ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/empresas/${c.empresa_id}`}>
                            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                            Company 360
                          </Link>
                        </Button>
                      ) : null}
                      {/*
                       * O escape da heurística. Sobram veículos de projeto que nenhum
                       * sinal estrutural separa de uma operacional — quem conhece a
                       * carteira resolve num clique, e o clique é reversível.
                       *
                       * Só aparece onde faz alguma coisa: numa filial/SPE que ninguém
                       * ocultou, a heurística já tirou a linha da lista, e um botão
                       * que grava um registro sem mudar nada na tela é um botão que
                       * ensina a pessoa a duvidar dos outros.
                       */}
                      {c.na_lista === true || c.oculto === true ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={ocultando === c.cnpj}
                          title={c.oculto ? 'Desfazer o ocultar' : 'Tirar da lista'}
                          aria-label={`${c.oculto ? 'Desfazer o ocultar' : 'Tirar da lista'}: ${c.nome ?? c.cnpj ?? ''}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => void alternarOculto(c)}
                        >
                          {c.oculto ? (
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
