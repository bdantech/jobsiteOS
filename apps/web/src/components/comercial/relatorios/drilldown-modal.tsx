'use client'

import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import {
  DETALHES,
  LINHAS_POR_PAGINA,
  NATUREZA_LABELS,
  brlCurto,
  celulaDoDetalhe,
  colunasPresentes,
  csvDoDetalhe,
  detalheBate,
  medidaDoDetalhe,
  naturezaDoAlvo,
  nomeDoCsv,
  paginasDoDetalhe,
  type AlvoDetalhe,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { LinkEmAba } from '@/components/shell/link-em-aba'
import { cn } from '@/lib/utils'
import { MAX_LINHAS_PADRAO, buscarConfigReport, buscarDetalhe, relatoriosKeys } from './queries'

/**
 * O modal de drill-down — um só para o report inteiro (04u §4).
 *
 * Clicou num número, abre a lista dos registros que o formam. Nunca troca de página: quem
 * lê o report está montando um raciocínio sobre a semana, e trocar a tela embaixo dessa
 * pessoa a obriga a reconstruir de onde veio.
 *
 * ─── O CABEÇALHO REPETE A REGRA ─────────────────────────────────────────────
 * Coorte, janela ou estoque, e de qual período. Sem isso a lista não pode ser conferida
 * contra o total — a pessoa conta 32 linhas e não sabe se deviam ser 32 reuniões ou 32
 * mudanças de estágio.
 *
 * ─── O TOTAL TEM DE BATER ───────────────────────────────────────────────────
 * `esperado` é o número que foi clicado. Se a lista devolver outro, o modal DIZ — em vez de
 * mostrar a lista como se nada fosse. Num report ao vivo a causa quase sempre é o dado ter
 * mudado depois que a página abriu; num snapshot antigo, é a coorte que amadureceu.
 */

export interface AlvoAberto extends AlvoDetalhe {
  /** O número clicado. `null` quando o report aberto não tem como dizer. */
  esperado: number | null
}

export function DrilldownModal({
  alvo, janela, snapshot, onFechar,
}: {
  alvo: AlvoAberto | null
  janela: { inicio: string; fim: string; retrato: string }
  /** O report na tela é um snapshot antigo: a lista é de HOJE e pode ter amadurecido. */
  snapshot: boolean
  onFechar: () => void
}) {
  const [pagina, setPagina] = React.useState(0)
  const [exportando, setExportando] = React.useState(false)

  // Trocar de número volta para a primeira página.
  const assinatura = alvo ? `${alvo.chave}|${JSON.stringify(alvo.params ?? {})}|${alvo.inicio ?? ''}` : ''
  React.useEffect(() => setPagina(0), [assinatura])

  const config = useQuery({
    queryKey: relatoriosKeys.config(), queryFn: buscarConfigReport, enabled: alvo !== null,
    staleTime: 5 * 60_000,
  })
  const teto = config.data?.max_linhas_drilldown ?? MAX_LINHAS_PADRAO

  const inicio = alvo?.inicio ?? janela.inicio
  const fim = alvo?.fim ?? janela.fim

  const dados = useQuery({
    queryKey: alvo
      ? relatoriosKeys.detalhe(alvo, inicio, fim, janela.retrato, pagina)
      : ['relatorios', 'detalhe', 'fechado'],
    queryFn: () => buscarDetalhe(alvo!, janela, LINHAS_POR_PAGINA, pagina * LINHAS_POR_PAGINA),
    enabled: alvo !== null,
    placeholderData: keepPreviousData,
  })

  const def = alvo ? DETALHES[alvo.chave] : null
  const params = alvo?.params ?? {}
  const linhas = dados.data?.linhas ?? []
  const colunas = def ? colunasPresentes(def.colunas, linhas) : []
  const total = dados.data?.total ?? 0
  const { paginas, cortado } = paginasDoDetalhe(total, teto)
  const obtido = alvo && dados.data ? medidaDoDetalhe(alvo.chave, dados.data) : null
  const bate = obtido === null || !alvo ? true : detalheBate(alvo.esperado, obtido)
  const ehSoma = def?.medida === 'soma'

  /*
   * O CSV é do conjunto COMPLETO, não da página nem do teto — é a saída para quem precisa de
   * mais do que a tela navega. Vai buscando em lotes de mil sem travar o modal; "em
   * background" aqui é o navegador trabalhando enquanto a pessoa continua lendo.
   */
  async function exportar() {
    if (!alvo || !def) return
    setExportando(true)
    try {
      const todas: Record<string, unknown>[] = []
      let offset = 0
      let ate = Infinity
      while (offset < ate) {
        const lote = await buscarDetalhe(alvo, janela, 1000, offset)
        todas.push(...lote.linhas)
        ate = lote.total
        if (lote.linhas.length === 0) break
        offset += lote.linhas.length
      }
      const csv = csvDoDetalhe(colunasPresentes(def.colunas, todas), todas)
      // BOM: sem ele o Excel abre o arquivo como Latin-1 e "Reunião" vira "ReuniÃ£o".
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = nomeDoCsv(alvo, inicio)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
      toast.success(`${todas.length.toLocaleString('pt-BR')} linha(s) exportadas.`)
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível exportar.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {def?.titulo(params)}
            {alvo && (
              <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {NATUREZA_LABELS[naturezaDoAlvo(alvo)]}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {def?.regra({ inicio, fim, retrato: janela.retrato, params })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-muted-foreground">
            {dados.isPending ? (
              'Carregando…'
            ) : (
              <>
                <strong className="tabular-nums text-foreground">{total.toLocaleString('pt-BR')}</strong>{' '}
                {total === 1 ? 'registro' : 'registros'}
                {ehSoma && dados.data ? (
                  <>
                    {' '}· soma{' '}
                    <strong className="tabular-nums text-foreground">
                      {Number(dados.data.soma).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </strong>
                  </>
                ) : null}
              </>
            )}
          </p>
          <Button size="sm" variant="outline" onClick={() => void exportar()} disabled={exportando || total === 0}>
            {exportando
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Download className="mr-1 h-3.5 w-3.5" aria-hidden />}
            Exportar CSV
          </Button>
        </div>

        {!bate && alvo && obtido !== null && (
          <p className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/5 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            <span>
              O número clicado era{' '}
              <strong className="tabular-nums">{ehSoma ? brlCurto(alvo.esperado) : alvo.esperado}</strong> e a
              lista traz <strong className="tabular-nums">{ehSoma ? brlCurto(obtido) : obtido}</strong>.{' '}
              {snapshot
                ? 'O report na tela é um snapshot: a lista é a de hoje, e o grupo mudou desde então.'
                : 'Os dados mudaram depois que a página foi aberta — recarregue para ver o número atual.'}
            </span>
          </p>
        )}

        {dados.error ? (
          <p className="py-8 text-center text-sm text-destructive">
            {dados.error instanceof Error ? dados.error.message : 'Não foi possível carregar a lista.'}
          </p>
        ) : dados.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nada nesta lista.</p>
        ) : (
          <div className={cn('min-h-0 flex-1 overflow-auto rounded-md border', dados.isPlaceholderData && 'opacity-60')}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  {colunas.map((c) => (
                    <th
                      key={c.chave}
                      className={cn(
                        'whitespace-nowrap p-2 font-medium text-muted-foreground',
                        c.tipo === 'brl' || c.tipo === 'numero' ? 'text-right' : 'text-left',
                      )}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {colunas.map((c) => (
                      <td
                        key={c.chave}
                        className={cn(
                          'max-w-[18rem] truncate whitespace-nowrap p-2 tabular-nums',
                          (c.tipo === 'brl' || c.tipo === 'numero') && 'text-right',
                        )}
                      >
                        {c.tipo === 'link' && typeof l[c.chave] === 'string' ? (
                          /* Fora do sistema (Fireflies): aba do navegador, não aba nossa. */
                          <a
                            href={l[c.chave] as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            abrir
                          </a>
                        ) : (
                          celulaDoDetalhe(c, l[c.chave])
                        )}
                      </td>
                    ))}
                    <td className="p-2 text-right">
                      {typeof l.empresa_id === 'string' && (
                        <LinkEmAba
                          href={`/empresas/${l.empresa_id}`}
                          className="text-[11px] underline text-muted-foreground"
                        >
                          ficha
                        </LinkEmAba>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(paginas > 1 || cortado) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              {cortado
                ? `Navegável até ${teto.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} linhas — o CSV traz o conjunto completo.`
                : `${LINHAS_POR_PAGINA} por página`}
            </p>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="ghost" aria-label="Página anterior"
                onClick={() => setPagina((p) => Math.max(p - 1, 0))} disabled={pagina === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <span className="tabular-nums">{pagina + 1} de {paginas}</span>
              <Button
                size="sm" variant="ghost" aria-label="Próxima página"
                onClick={() => setPagina((p) => Math.min(p + 1, paginas - 1))} disabled={pagina >= paginas - 1}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
