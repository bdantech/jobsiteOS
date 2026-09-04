'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { aplicarDerivaAction, derivaComissaoAction } from '@/actions/comercial'
import { brl } from './format'

/**
 * "A régua mudou. E a folha?" — a metade AVISAR do avisar-e-oferecer.
 *
 * ─── POR QUE ESTE PAINEL PRECISA EXISTIR ────────────────────────────────────
 * Publicar um parâmetro nunca reescreve lançamento, e isso é deliberado: a vigência
 * abre para frente, o motor resolve a taxa NA DATA DA CESSÃO, e reprocessar não repaga.
 * As três coisas juntas impedem um mês de mudar sozinho.
 *
 * O preço disso é que a régua e a folha podem discordar dentro do mês ABERTO. A vigência
 * é por DIA, não por instante: uma cessão convertida hoje de manhã e lançada às 9h05 pela
 * taxa velha passa a ser regida, às 10h, pela taxa publicada hoje. Sem este painel,
 * ninguém descobre isso — nem quem publicou, nem quem confere a folha no dia 1º.
 *
 * ─── E POR QUE ELE NÃO APLICA SOZINHO ───────────────────────────────────────
 * Recalcular é a única operação do motor que APAGA lançamento. Fazer isso como efeito
 * colateral de "publiquei uma taxa" tiraria da pessoa a decisão mais consequente da tela.
 * Aqui ela vê o de/para por conta, escolhe quais recalcular, e o resto fica como está.
 *
 * A prévia roda o MESMO `lancamentosDaCessao` que grava — não é uma segunda conta.
 */

type Conta = {
  empresa_id: string
  conta_nome: string | null
  lancamentos: number
  total_atual: number
  total_novo: number
  delta: number
  tipos: string[]
}

type Deriva = {
  competencia: string
  fechada: boolean
  cessoes: number
  contas: Conta[]
  total_atual: number
  total_novo: number
  delta: number
}

const TIPO_LABEL: Record<string, string> = {
  alterado: 'valor mudou',
  novo: 'lançamento novo',
  removido: 'deixaria de existir',
}

const competenciaLabel = (c: string): string => {
  if (!c) return '—'
  const [ano, mes] = c.split('-')
  return `${mes}/${ano}`
}

/** O sinal importa mais que o número: quem confere folha procura o que subiu. */
function Delta({ valor }: { valor: number }) {
  if (valor === 0) return <span className="tabular-nums text-muted-foreground">—</span>
  const cor = valor > 0 ? 'text-amber-600 dark:text-amber-500' : 'text-sky-700 dark:text-sky-400'
  return (
    <span className={`tabular-nums font-medium ${cor}`}>
      {valor > 0 ? '+' : '−'}
      {brl(Math.abs(valor))}
    </span>
  )
}

export function DerivaComissao() {
  const qc = useQueryClient()
  const [deriva, setDeriva] = React.useState<Deriva | null>(null)
  const [conferindo, setConferindo] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)
  const [escolhidas, setEscolhidas] = React.useState<Set<string>>(new Set())

  /*
   * A conferência é sob demanda, não automática ao abrir a tela: ela varre todas as
   * cessões do mês e leva segundos. Rodá-la a cada visita gastaria o tempo de quem só
   * veio ler a tabela de parâmetros.
   */
  async function conferir() {
    setConferindo(true)
    const r = await derivaComissaoAction()
    setConferindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setDeriva(r.data)
    // Nada vem marcado. Marcar tudo por padrão faria "Aplicar" ser um clique só, e o
    // clique que apaga folha não deve ser o mais fácil da tela.
    setEscolhidas(new Set())
    if (r.data.contas.length === 0 && !r.data.fechada) {
      toast.success('A folha do mês está igual à régua de hoje.')
    }
  }

  async function aplicar() {
    const ids = [...escolhidas]
    if (ids.length === 0) return
    setAplicando(true)
    const r = await aplicarDerivaAction(ids)
    setAplicando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.data.falhas.length > 0) {
      toast.warning(
        `${r.data.contas} conta(s) recalculada(s). ${r.data.falhas.length} falhou/falharam: ${r.data.falhas
          .map((f) => f.erro)
          .join(' · ')}`,
      )
    } else {
      toast.success(
        `${r.data.contas} conta(s) recalculada(s), ${r.data.lancamentos} lançamento(s). Novo total: ${brl(r.data.total)}.`,
      )
    }
    void qc.invalidateQueries({ queryKey: ['comercial'] })
    // Reconfere: o que sobrou de deriva depois de aplicar é a resposta honesta, e ela
    // pode não ser vazia (uma conta que falhou continua divergindo).
    await conferir()
  }

  const contas = deriva?.contas ?? []
  const totalEscolhido = contas
    .filter((c) => escolhidas.has(c.empresa_id))
    .reduce((s, c) => s + c.delta, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" aria-hidden />A régua mudou. E a folha?
            </CardTitle>
            <CardDescription>
              Publicar um parâmetro <strong>não</strong> reprecifica o que já foi lançado — nem
              no mês corrente. Isto compara os lançamentos provisionados do mês aberto com o
              que a régua de hoje diria, e deixa você escolher o que recalcular.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void conferir()} disabled={conferindo}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${conferindo ? 'animate-spin' : ''}`} aria-hidden />
            {conferindo ? 'Conferindo…' : 'Conferir o mês'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {conferindo && !deriva ? <Skeleton className="h-24 w-full rounded-lg" /> : null}

        {deriva?.fechada ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              A competência de <strong>{competenciaLabel(deriva.competencia)}</strong> já foi
              fechada. Mês fechado é imutável: uma correção descoberta agora entra como ajuste
              manual no mês corrente, nunca como reescrita do passado.
            </p>
          </div>
        ) : null}

        {deriva && !deriva.fechada && contas.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <p>
              Nada a fazer: as {deriva.cessoes} cessão(ões) de{' '}
              {competenciaLabel(deriva.competencia)} já estão lançadas com a régua de hoje.
            </p>
          </div>
        ) : null}

        {deriva && !deriva.fechada && contas.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                <strong>{contas.length} conta(s)</strong> em{' '}
                {competenciaLabel(deriva.competencia)} têm lançamento provisionado com valor
                diferente do que a régua de hoje daria. A folha seria de{' '}
                <strong>{brl(deriva.total_atual)}</strong> para{' '}
                <strong>{brl(deriva.total_novo)}</strong> (<Delta valor={deriva.delta} />
                ).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEscolhidas(new Set(contas.map((c) => c.empresa_id)))}
              >
                Marcar todas
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEscolhidas(new Set())}
              >
                Limpar
              </Button>
              <span className="text-muted-foreground">
                {escolhidas.size} de {contas.length} selecionada(s)
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-8 px-3 py-2" />
                    <th scope="col" className="px-3 py-2 font-normal">Conta</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Lanç.</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Hoje</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Ficaria</th>
                    <th scope="col" className="px-3 py-2 text-right font-normal">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contas.map((c) => (
                    <tr key={c.empresa_id} className={escolhidas.has(c.empresa_id) ? 'bg-muted/30' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          aria-label={`Recalcular ${c.conta_nome ?? c.empresa_id}`}
                          checked={escolhidas.has(c.empresa_id)}
                          onChange={(e) =>
                            setEscolhidas((atual) => {
                              const proximo = new Set(atual)
                              if (e.target.checked) proximo.add(c.empresa_id)
                              else proximo.delete(c.empresa_id)
                              return proximo
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{c.conta_nome ?? '—'}</p>
                        <p className="flex flex-wrap gap-1 pt-0.5">
                          {c.tipos.map((t) => (
                            <Badge
                              key={t}
                              variant={t === 'removido' ? 'destructive' : 'secondary'}
                              className="text-[10px]"
                            >
                              {TIPO_LABEL[t] ?? t}
                            </Badge>
                          ))}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {c.lancamentos}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(c.total_atual)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(c.total_novo)}</td>
                      <td className="px-3 py-2 text-right">
                        <Delta valor={c.delta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Recalcular apaga e refaz <strong>só</strong> os lançamentos provisionados de
                cessão do mês aberto, nas contas marcadas. Aprovado, pago, ajuste manual e
                evento de SDR não são tocados.
              </p>
              <div className="flex items-center gap-3">
                {escolhidas.size > 0 ? (
                  <span className="text-sm">
                    Selecionado: <Delta valor={totalEscolhido} />
                  </span>
                ) : null}
                <Button
                  size="sm"
                  disabled={escolhidas.size === 0 || aplicando}
                  onClick={() => void aplicar()}
                >
                  {aplicando
                    ? 'Recalculando…'
                    : `Recalcular ${escolhidas.size || ''} conta(s)`.trim()}
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {!deriva && !conferindo ? (
          <p className="text-sm text-muted-foreground">
            A conferência varre todas as cessões do mês e leva alguns segundos — por isso ela
            é sob demanda. Rode depois de publicar uma taxa, ou sempre que quiser conferir a
            folha antes do fechamento.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
