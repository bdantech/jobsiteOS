'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, FileText, ShieldCheck } from 'lucide-react'
import { CAMPOS_CRITICOS, criticosPendentes, type DadosExtraidos, type Tables } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { revisarExtracaoAction } from '@/actions/credito-analise'
import { analisePropriaKeys } from './queries'

/**
 * A revisão humana da extração (04j §3).
 *
 * ─── POR QUE ESTA TELA EXISTE ───────────────────────────────────────────────
 * Um limite de R$ 4 milhões construído sobre um EBITDA que o modelo leu numa linha
 * errada é, na tela, indistinguível de um limite correto. Nenhum número extraído por IA
 * entra no cálculo antes de um humano olhar para ele ao lado do trecho de onde saiu.
 *
 * ─── POR QUE O TRECHO DE ORIGEM FICA JUNTO DO CAMPO ─────────────────────────
 * Conferir um balanço abrindo o PDF em outra aba é o tipo de trabalho que ninguém faz
 * duas vezes. O trecho curto e a página vêm da extração exatamente para que a conferência
 * caiba num relance — e a que cabe num relance é a que acontece.
 *
 * Confirmar SEM alterar também é um ato, e fica gravado: "eu olhei e está certo" é
 * informação, e é diferente de "ninguém olhou".
 */

const LABELS: Record<string, string> = {
  receita_bruta: 'Receita bruta',
  receita_liquida: 'Receita líquida',
  ebitda: 'EBITDA',
  patrimonio_liquido: 'Patrimônio líquido',
  emprestimos_curto_prazo: 'Empréstimos (curto prazo)',
  emprestimos_longo_prazo: 'Empréstimos (longo prazo)',
  caixa: 'Caixa e equivalentes',
}

/**
 * O que dizer quando um crítico não veio dos documentos.
 *
 * O EBITDA tem texto próprio porque é o caso comum e o mais mal-entendido: o formulário
 * padrão da CAIXA não publica EBITDA nem depreciação, e a tentação de digitar ali o lucro
 * líquido é grande — são coisas diferentes, e trocá-las distorce justamente a alavancagem,
 * que é a que dispara knockout.
 */
const AJUDA_AUSENTE: Record<string, string> = {
  ebitda:
    'Não publicado no documento. O cálculo já deriva o EBIT (lucro bruto − despesas operacionais) ' +
    'e o usa como aproximação conservadora. Preencha só se você tiver o EBITDA de verdade — ' +
    'lucro líquido e resultado antes dos tributos NÃO servem no lugar dele.',
}

const numeroBr = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export function RevisaoExtracao({
  analiseId,
  analiseCreditoId,
  dados,
  docs,
}: {
  analiseId: string
  analiseCreditoId: string
  dados: DadosExtraidos | null
  docs: Tables<'analise_docs'>[]
}) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = React.useState(false)
  // Valor editado por (exercício, campo). Ausente = mantém o que o modelo leu.
  const [edicoes, setEdicoes] = React.useState<Record<string, string>>({})

  const pendentes = criticosPendentes(dados)
  const nomeDoDoc = React.useCallback(
    (id: string) => docs.find((d) => d.id === id)?.nome_arquivo ?? 'documento',
    [docs],
  )

  if (!dados || dados.exercicios.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          A extração não encontrou nenhum exercício contábil nos documentos anexados.
        </CardContent>
      </Card>
    )
  }

  async function confirmar() {
    setSalvando(true)
    // Manda TODOS os críticos com valor, editados ou não: confirmar é o ato que a tela
    // registra, e um payload só com os alterados não distinguiria "conferi e está certo"
    // de "não olhei".
    const correcoes = (dados?.exercicios ?? []).flatMap((bloco) =>
      CAMPOS_CRITICOS.flatMap((campo) => {
        const c = bloco.campos?.[campo]
        const chave = `${bloco.exercicio}:${campo}`
        const bruto = edicoes[chave]
        const digitado = bruto !== undefined && bruto.trim() !== ''
        const extraido = c?.valor ?? null

        // Ausente e não preenchido: continua sendo LACUNA. Mandá-lo como null aqui o
        // transformaria em "conferido e inexistente", que é uma afirmação que ninguém fez.
        if (extraido === null && !digitado) return []

        const valor = digitado ? Number((bruto as string).replace(/\./g, '').replace(',', '.')) : extraido
        if (valor === null || !Number.isFinite(valor)) return []
        return [{ exercicio: bloco.exercicio, campo, valor }]
      }),
    )

    if (correcoes.length === 0) {
      toast.error('Não há campo crítico a confirmar nesta extração.')
      setSalvando(false)
      return
    }

    const r = await revisarExtracaoAction({ id: analiseId, correcoes })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      r.data.worker_acordado
        ? 'Confirmado. O cálculo e o parecer estão sendo gerados.'
        : 'Confirmado. O worker não respondeu agora — a rotina diária retoma o cálculo.',
    )
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <p>
          <strong>{pendentes.length} campo(s) crítico(s)</strong> esperam confirmação. Nada é
          calculado antes disso: o cálculo é determinístico, mas a entrada dele foi lida por um
          modelo.
        </p>
      </div>

      {dados.exercicios
        .slice()
        .sort((a, b) => b.exercicio - a.exercicio)
        .map((bloco) => (
          <Card key={bloco.exercicio}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                Exercício {bloco.exercicio}
                <Badge variant="outline" className="text-[10px]">
                  {bloco.moeda}
                </Badge>
              </CardTitle>
              <CardDescription>
                Só os campos críticos exigem confirmação. Os demais entram no cálculo como foram
                lidos e aparecem no detalhe de cada indicador.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y rounded-lg border">
                {/*
                  * TODO campo crítico aparece, inclusive o que a extração NÃO achou.
                  *
                  * Antes a lista só mostrava os que tinham valor — a regra de "não pedir
                  * confirmação de linha em branco", que continua certa para a CONFIRMAÇÃO.
                  * Só que ela também escondia o campo, e com ele a única forma de alguém
                  * informar um número que o documento não publica. O EBITDA do formulário
                  * padrão da CAIXA caía exatamente aí: a pessoa tinha o número e não tinha
                  * onde pôr.
                  *
                  * Deixar em branco segue sendo lacuna. Preencher é ato humano, e fica
                  * gravado como tal.
                  */}
                {CAMPOS_CRITICOS.map((campo) => {
                  const c = bloco.campos?.[campo]
                  const ausente = !c || c.valor === null || c.valor === undefined
                  const chave = `${bloco.exercicio}:${campo}`
                  return (
                    <li key={campo} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {LABELS[campo] ?? campo}
                          {ausente && (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              não localizado
                            </Badge>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          {c?.revisado && (
                            <Badge variant="secondary" className="text-[10px]">
                              revisado
                            </Badge>
                          )}
                          <Input
                            inputMode="decimal"
                            className="h-8 w-44 text-right tabular-nums"
                            defaultValue={ausente ? '' : numeroBr(c!.valor as number)}
                            placeholder={ausente ? 'opcional' : undefined}
                            onChange={(e) =>
                              setEdicoes((s) => ({ ...s, [chave]: e.target.value }))
                            }
                            aria-label={`${LABELS[campo] ?? campo} em ${bloco.exercicio}`}
                          />
                        </div>
                      </div>
                      {ausente ? (
                        <p className="text-xs text-muted-foreground">
                          {AJUDA_AUSENTE[campo] ??
                            'Não localizado nos documentos. Deixe em branco para seguir como lacuna, ou informe o valor se você o tiver.'}
                        </p>
                      ) : c!.origem ? (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <FileText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          <span>
                            {nomeDoDoc(c!.origem!.documento_id)}
                            {c!.origem!.pagina !== null ? `, p. ${c!.origem!.pagina}` : ''} —{' '}
                            <em>&ldquo;{c!.origem!.trecho_curto}&rdquo;</em>
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sem trecho de origem: confira no documento antes de confirmar.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        ))}

      {dados.conflitos.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              Conflitos entre documentos
            </CardTitle>
            <CardDescription>
              O mesmo campo com valores diferentes em documentos diferentes. A extração não
              escolheu um — quem confirma escolhe, e a escolha fica gravada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {dados.conflitos.map((cf, i) => (
                <li key={`${cf.campo}-${i}`} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {LABELS[cf.campo] ?? cf.campo}
                    {cf.exercicio ? ` · ${cf.exercicio}` : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {cf.valores.map((v, j) => (
                      <li key={j} className="text-xs text-muted-foreground">
                        <span className="tabular-nums text-foreground">{numeroBr(v.valor)}</span>
                        {v.origem
                          ? ` — ${nomeDoDoc(v.origem.documento_id)}${v.origem.pagina !== null ? `, p. ${v.origem.pagina}` : ''}: “${v.origem.trecho_curto}”`
                          : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {dados.lacunas.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lacunas da extração</CardTitle>
            <CardDescription>
              O que não estava nos documentos. A análise roda assim mesmo — cada lacuna vira um
              indicador ou um teto não avaliável, com o motivo à vista.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {dados.lacunas.map((l) => (
                <li key={l} className="text-xs text-muted-foreground">
                  · {l}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Button onClick={() => void confirmar()} disabled={salvando} className="w-full sm:w-auto">
        {salvando ? 'Confirmando…' : 'Confirmar extração e calcular'}
      </Button>
    </div>
  )
}
