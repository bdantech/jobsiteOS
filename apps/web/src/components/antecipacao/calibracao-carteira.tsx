'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, RefreshCw, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { aplicarCalibracaoAction, calibrarEconomiaAction } from '@/actions/antecipacao'
import { formatarDataHora, formatarMoedaExata } from './format'
import { antecipacaoKeys, buscarCalibracao, type CalibracaoCarteiraSalva } from './queries'

/**
 * Calibração com a carteira real (04e §5).
 *
 * Três constantes digitadas — taxa, prazo e ticket — multiplicam a receita
 * esperada de todo o funil e o valor esperado de todo o Crédito. Esta tela põe
 * ao lado de cada uma o que as antecipações CONCLUÍDAS dizem que ela é.
 *
 * O botão aplica; o job nunca. Trocar sozinha a constante que precifica a base
 * inteira, em cima de um mês atípico, é o tipo de automação que ninguém pede e
 * todo mundo descobre tarde demais — quando a receita esperada já foi
 * reapresentada em três reuniões.
 *
 * Uma linha sem amostra suficiente mostra "—" e NÃO entra no "aplicar". Zerar um
 * denominador é como uma calibração honesta vira uma base de números impossíveis.
 */

interface Linha {
  rotulo: string
  configurado: string
  calibrado: string
  n: number
  desvio: number | null
  /** A taxa aparece duas vezes na casa: funil e crédito, cada uma com sua config. */
  nota?: string
}

export function CalibracaoCarteira() {
  const qc = useQueryClient()
  const [rodando, setRodando] = React.useState(false)
  const [aplicando, setAplicando] = React.useState(false)

  const { data, isPending } = useQuery({
    queryKey: antecipacaoKeys.calibracao(),
    queryFn: buscarCalibracao,
  })

  async function recalcular() {
    setRodando(true)
    const r = await calibrarEconomiaAction()
    setRodando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.enfileirado
        ? 'Calibração enfileirada. Recarregue em instantes para ver os novos números.'
        : (r.data.aviso ?? 'O worker não aceitou o job.'),
    )
  }

  async function aplicar() {
    if (!data) return
    setAplicando(true)
    const r = await aplicarCalibracaoAction({
      taxa_am: data.calibracao.taxa_am.valor,
      prazo_dias: data.calibracao.prazo_dias.valor,
      valor_medio_nf: data.calibracao.valor_medio_nf.valor,
    })
    setAplicando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (r.data.aplicados.length === 0) {
      toast.warning('Nada foi aplicado — nenhuma métrica tem amostra suficiente.')
    } else {
      toast.success(`Aplicado: ${r.data.aplicados.join(', ')}.`)
    }
    if (r.data.ignorados.length > 0) {
      toast.info(`Ficou de fora: ${r.data.ignorados.join('; ')}.`)
    }
    void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
  }

  if (isPending) return <Skeleton className="h-64 w-full rounded-lg" />

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" aria-hidden />
            Calibração com a carteira
          </CardTitle>
          <CardDescription>
            Compara a taxa, o prazo e o ticket configurados com as medianas das antecipações
            concluídas. Roda todo dia 5; ainda não rodou nenhuma vez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void recalcular()} disabled={rodando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${rodando ? 'animate-spin' : ''}`} aria-hidden />
            Calcular agora
          </Button>
        </CardContent>
      </Card>
    )
  }

  const linhas = montarLinhas(data)
  const temAlgoAAplicar =
    data.calibracao.taxa_am.valor !== null ||
    data.calibracao.prazo_dias.valor !== null ||
    data.calibracao.valor_medio_nf.valor !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4" aria-hidden />
          Calibração com a carteira
        </CardTitle>
        <CardDescription>
          Medianas das {data.amostras} antecipações concluídas nos últimos {data.janela_dias} dias.
          Mediana, e não média: uma operação de milhões não deve reescrever o ticket de ninguém.
          {data.calculado_em ? ` Calculado em ${formatarDataHora(data.calculado_em)}.` : ''}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Parâmetro</th>
                <th className="pb-2 text-right font-medium">Configurado</th>
                <th className="pb-2 text-right font-medium">Na carteira</th>
                <th className="pb-2 text-right font-medium">Desvio</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.rotulo} className="border-b last:border-0">
                  <td className="py-2">
                    <span>{l.rotulo}</span>
                    {l.nota && <p className="text-xs text-muted-foreground">{l.nota}</p>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{l.configurado}</td>
                  <td className="py-2 text-right tabular-nums">
                    {l.calibrado}
                    {l.n > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">n={l.n}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Desvio pct={l.desvio} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void aplicar()} disabled={aplicando || !temAlgoAAplicar}>
            <Check className="mr-2 h-4 w-4" aria-hidden />
            Aplicar valores da carteira
          </Button>
          <Button variant="outline" onClick={() => void recalcular()} disabled={rodando}>
            <RefreshCw className={`mr-2 h-4 w-4 ${rodando ? 'animate-spin' : ''}`} aria-hidden />
            Recalcular
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Aplicar grava a taxa nos DOIS lugares em que ela vive: a do funil, que precifica a
          receita esperada de cada nota, e a do Crédito, que precifica o potencial do sacado.
          Aplicar só uma corrigiria metade da casa em silêncio.
        </p>
      </CardContent>
    </Card>
  )
}

function Desvio({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>
  const abs = Math.abs(pct)
  // 10% é o limiar em que a diferença deixa de ser ruído de amostra e passa a
  // mudar a conversa: a receita esperada de um mês inteiro anda junto com ela.
  const variante = abs < 10 ? 'em linha' : abs < 25 ? 'revisar' : 'muito fora'
  const cor =
    abs < 10
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200'
      : abs < 25
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
        : 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200'
  return (
    <Badge className={cor}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(0)}% · {variante}
    </Badge>
  )
}

function num(v: number | null, sufixo = ''): string {
  if (typeof v !== 'number') return '—'
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${sufixo}`
}

function montarLinhas(d: CalibracaoCarteiraSalva): Linha[] {
  return [
    {
      rotulo: 'Taxa do funil (% a.m.)',
      nota: 'antecipacao.economia — precifica a receita esperada de cada NF.',
      configurado: num(d.configurado.taxa_mensal_padrao, '%'),
      calibrado: num(d.calibracao.taxa_am.valor, '%'),
      n: d.calibracao.taxa_am.n,
      desvio: d.desvios.taxa_funil_pct,
    },
    {
      rotulo: 'Taxa do Crédito (% a.m.)',
      nota: 'credito.economia — precifica o potencial do sacado.',
      configurado: num(d.configurado.taxa_padrao_am, '%'),
      calibrado: num(d.calibracao.taxa_am.valor, '%'),
      n: d.calibracao.taxa_am.n,
      desvio: d.desvios.taxa_credito_pct,
    },
    {
      rotulo: 'Prazo médio (dias)',
      configurado: num(d.configurado.prazo_medio_dias),
      calibrado: num(d.calibracao.prazo_dias.valor),
      n: d.calibracao.prazo_dias.n,
      desvio: d.desvios.prazo_pct,
    },
    {
      rotulo: 'Ticket médio da NF',
      configurado: formatarMoedaExata(d.configurado.valor_medio_nf),
      calibrado:
        d.calibracao.valor_medio_nf.valor === null
          ? '—'
          : formatarMoedaExata(d.calibracao.valor_medio_nf.valor),
      n: d.calibracao.valor_medio_nf.n,
      desvio: d.desvios.valor_medio_nf_pct,
    },
  ]
}
