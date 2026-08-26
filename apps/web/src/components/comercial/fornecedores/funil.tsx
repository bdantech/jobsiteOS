'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LayoutGrid, RefreshCw, Search, Table2 } from 'lucide-react'
import {
  ESTAGIOS_FORNECEDOR_ATIVOS,
  ESTAGIO_FORNECEDOR_LABELS,
  type EstagioFornecedor,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { atualizarFunilAction, reatribuirFornecedorAction } from '@/actions/fornecedores'
import { cn } from '@/lib/utils'
import { DonoDoCard } from '../dono-do-card'
import { buscarVendedoresVisiveis, comercialKeys } from '../queries'
import { FichaFornecedor } from './ficha'
import { buscarFunil, fornecedoresKeys, type FornecedorCard } from './queries'
import { brl, cnpjFormatado, dia, rotuloConfianca, varianteConfianca } from './formato'

/**
 * O funil de cadastro (04l §5).
 *
 * A FORMA É A MESMA do funil de reuniões, do funil de vendas e da esteira de crédito —
 * um cartão só, kanban por estágio, tabela como alternativa —, e é de propósito: a
 * pergunta é a mesma ("onde está cada coisa, e o que falta nela"), e duas telas que
 * respondem à mesma pergunta com layouts diferentes obrigam a pessoa a reaprender a ler
 * a cada troca de módulo.
 *
 * Também não há arrastar-e-soltar aqui, pelo mesmo motivo dos outros: mover é um clique
 * dentro do modal, junto da munição que justifica mover. E as duas transições que
 * importam — "sem interesse" e "cadastrado" — não são arrastáveis de qualquer forma: a
 * primeira exige motivo e prazo, e a segunda é fato observado no sync.
 *
 * ─── A ORDENAÇÃO É O POTENCIAL, E SÓ DO FORNECEDOR ───────────────────────────
 *
 * O limite do sacado NÃO entra (§3, explícito). Ele é o teto da operação, não do lead:
 * um fornecedor de R$ 900 mil/mês contra um sacado com limite estourado continua sendo
 * o melhor telefone da lista, porque limite se resolve com análise e fornecedor grande
 * não aparece por decreto.
 *
 * (Isso é diferente de o sacado ter crédito APROVADO, que é o que qualifica o lead a
 * existir — quem decide isso é a mesma view da tela de fornecedores a prospectar.)
 */

/** O tom do card conta o julgamento antes de qualquer leitura — como nos outros funis. */
function classeDoCard(c: FornecedorCard): string {
  if (c.estagio === 'sem_interesse') return 'border-destructive/40 bg-destructive/5'
  if (c.estagio === 'cadastrado') return 'border-emerald-500/40 bg-emerald-500/5'
  if (c.estagio === 'sem_contato') return 'border-muted-foreground/30 bg-muted/40'
  if (c.melhor_confianca === 'alta') return 'border-emerald-500/30'
  return ''
}

export function FunilFornecedores({
  ehGestor,
  vendedorId,
  nomeUsuario,
}: {
  ehGestor: boolean
  vendedorId: string | null
  nomeUsuario: string | null
}) {
  const qc = useQueryClient()
  const [vista, setVista] = React.useState<'kanban' | 'tabela'>('kanban')
  const [concluidos, setConcluidos] = React.useState(false)
  const [termo, setTermo] = React.useState('')
  const [debounce, setDebounce] = React.useState('')
  /*
   * O default do gestor é a fila SEM DONO, não "todos".
   *
   * Abrir em "todos" faria a primeira coisa que ele vê ser o trabalho de outra pessoa.
   * A fila sem dono é a única lista deste módulo em que o gestor tem uma ação que
   * ninguém mais pode fazer — atribuir.
   */
  const [filtroDono, setFiltroDono] = React.useState<string>(
    ehGestor ? 'sem_dono' : (vendedorId ?? ''),
  )
  const [aberto, setAberto] = React.useState<string | null>(null)

  React.useEffect(() => {
    const t = setTimeout(() => setDebounce(termo), 300)
    return () => clearTimeout(t)
  }, [termo])

  const filtro = React.useMemo(
    () => ({
      originadorId: filtroDono === 'todos' ? null : filtroDono || null,
      concluidos,
      termo: debounce,
    }),
    [filtroDono, concluidos, debounce],
  )

  const funil = useQuery({
    queryKey: fornecedoresKeys.funil(JSON.stringify(filtro)),
    queryFn: () => buscarFunil(filtro),
  })

  // Quem eu posso ABRIR — não é a mesma lista de quem existe. O seletor sai daqui para
  // não oferecer um funil que a RLS devolveria vazio.
  const alcance = useQuery({
    queryKey: comercialKeys.visiveis(),
    queryFn: buscarVendedoresVisiveis,
    enabled: ehGestor,
  })

  const recalcular = useMutation({
    mutationFn: async () => {
      const r = await atualizarFunilAction()
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => toast.success('Recálculo disparado. A lista se atualiza em alguns minutos.'),
    onError: (e: Error) => toast.error(e.message),
  })

  const reatribuir = useMutation({
    mutationFn: async (v: { cnpj: string; originadorId: string | null }) => {
      const r = await reatribuirFornecedorAction({
        fornecedor_cnpj: v.cnpj,
        originador_id: v.originadorId,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Fornecedor reatribuído.')
      void qc.invalidateQueries({ queryKey: fornecedoresKeys.todos })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const cards = React.useMemo(() => funil.data ?? [], [funil.data])
  const cardAberto = cards.find((c) => c.fornecedor_cnpj === aberto) ?? null

  const porEstagio = React.useMemo(() => {
    const m = new Map<string, FornecedorCard[]>()
    for (const c of cards) {
      const lista = m.get(c.estagio ?? 'a_cadastrar') ?? []
      lista.push(c)
      m.set(c.estagio ?? 'a_cadastrar', lista)
    }
    return m
  }, [cards])

  const colunas = concluidos
    ? (['cadastrado', 'sem_interesse'] as EstagioFornecedor[])
    : ESTAGIOS_FORNECEDOR_ATIVOS

  const potencial = cards.reduce((s, c) => s + (Number(c.potencial_mensal) || 0), 0)
  const semDono = cards.filter((c) => !c.originador_id).length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Funil de Cadastro</CardTitle>
              <CardDescription>
                {cards.length} fornecedor(es), {brl(potencial)}/mês de potencial.{' '}
                <strong>
                  Quem qualifica é o sacado ter crédito aprovado
                </strong>{' '}
                — a mesma régua da lista de fornecedores a prospectar da Antecipação.
                {semDono > 0 ? ` ${semDono} sem dono.` : ''}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="Nome ou CNPJ…"
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  className="h-9 w-48 pl-7"
                />
              </div>

              {ehGestor && (
                <Select value={filtroDono} onValueChange={setFiltroDono}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem_dono">Fila sem dono</SelectItem>
                    <SelectItem value="todos">Todos os originadores</SelectItem>
                    {(alcance.data ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={concluidos}
                  onChange={(e) => setConcluidos(e.target.checked)}
                />
                Concluídos
              </label>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setVista(vista === 'kanban' ? 'tabela' : 'kanban')}
              >
                {vista === 'kanban' ? (
                  <>
                    <Table2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Tabela
                  </>
                ) : (
                  <>
                    <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Kanban
                  </>
                )}
              </Button>

              {ehGestor && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recalcular.isPending}
                  onClick={() => recalcular.mutate()}
                  title="Recalcula a munição a partir das notas que já chegaram"
                >
                  <RefreshCw
                    className={cn('mr-1 h-3.5 w-3.5', recalcular.isPending && 'animate-spin')}
                    aria-hidden
                  />
                  Recalcular
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {funil.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : cards.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {filtroDono === 'sem_dono' ? 'Nenhum fornecedor sem dono.' : 'Nada por aqui.'}
              </p>
              <p className="mt-1">
                {filtroDono === 'sem_dono'
                  ? 'Troque o filtro para ver os que já têm originador.'
                  : 'O funil é alimentado pelo sync de notas: quem emite contra sacado com crédito aprovado e passa do corte de volume entra sozinho.'}
              </p>
            </div>
          ) : vista === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {colunas.map((coluna) => {
                const itens = porEstagio.get(coluna) ?? []
                return (
                  <div key={coluna} className="w-64 shrink-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                      <p className="text-xs font-medium">{ESTAGIO_FORNECEDOR_LABELS[coluna]}</p>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {itens.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {itens.map((c) => (
                        <div
                          key={c.fornecedor_cnpj}
                          className={cn(
                            'relative space-y-1.5 rounded-md border p-2 text-sm transition-colors',
                            'hover:border-foreground/25 focus-within:ring-1 focus-within:ring-ring',
                            classeDoCard(c),
                          )}
                        >
                          {/* <button> esticado, não onClick no <div> — é o que mantém
                              teclado e leitor de tela funcionando, como nos outros funis. */}
                          <button
                            type="button"
                            aria-label={`Abrir ${c.fornecedor_nome ?? 'fornecedor'}`}
                            onClick={() => setAberto(c.fornecedor_cnpj)}
                            className="absolute inset-0 z-0 rounded-md focus:outline-none"
                          />
                          <p className="line-clamp-2 font-medium">{c.fornecedor_nome}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {c.uf ? (
                              <Badge variant="outline" className="text-[10px]">{c.uf}</Badge>
                            ) : null}
                            <Badge
                              variant={varianteConfianca(c.melhor_confianca)}
                              className="text-[10px]"
                            >
                              {c.contatos_encontrados
                                ? `${c.contatos_encontrados} contato(s) · ${rotuloConfianca(c.melhor_confianca)}`
                                : 'sem contato'}
                            </Badge>
                          </div>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {brl(c.potencial_mensal)}/mês · {c.qtd_nfs_90d ?? 0} NFs
                          </p>
                          {/*
                            O dono só aparece na lista NÃO filtrada: com o filtro ligado
                            ele repetiria em cada card o que o seletor no topo já diz, e
                            informação constante rouba espaço do que varia.
                          */}
                          {filtroDono === 'todos' && (
                            // `z-10`: interativo, tem de ficar acima da área que abre o card.
                            <div className="relative z-10">
                              <DonoDoCard
                                nome={c.originador_nome}
                                tipos={['originador']}
                                podeTrocar={ehGestor}
                                ocupado={reatribuir.isPending}
                                onTrocar={(id) =>
                                  reatribuir.mutate({ cnpj: c.fornecedor_cnpj, originadorId: id })
                                }
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {itens.length === 0 && (
                        <p className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                          vazio
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Potencial/mês</TableHead>
                    <TableHead className="text-right">Volume 90d</TableHead>
                    <TableHead className="text-right">NFs</TableHead>
                    <TableHead className="text-right">Prazo</TableHead>
                    <TableHead>Contatos</TableHead>
                    <TableHead>Estágio</TableHead>
                    <TableHead>Originador</TableHead>
                    <TableHead className="text-right">Última NF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cards.map((c) => (
                    <TableRow key={c.fornecedor_cnpj}>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setAberto(c.fornecedor_cnpj)}
                          className="text-left hover:underline"
                        >
                          <span className="font-medium">{c.fornecedor_nome}</span>
                          <span className="block text-xs text-muted-foreground">
                            {cnpjFormatado(c.fornecedor_cnpj)}
                            {c.municipio ? ` · ${c.municipio}/${c.uf ?? ''}` : ''}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {brl(c.potencial_mensal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(c.volume_90d)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.qtd_nfs_90d ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.prazo_medio_dias === null ? '—' : `${c.prazo_medio_dias}d`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={varianteConfianca(c.melhor_confianca)} className="text-[10px]">
                          {c.contatos_encontrados
                            ? `${c.contatos_encontrados} · ${rotuloConfianca(c.melhor_confianca)}`
                            : 'nenhum'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {ESTAGIO_FORNECEDOR_LABELS[c.estagio as EstagioFornecedor] ?? c.estagio}
                      </TableCell>
                      <TableCell>
                        <DonoDoCard
                          nome={c.originador_nome}
                          tipos={['originador']}
                          podeTrocar={ehGestor}
                          ocupado={reatribuir.isPending}
                          onTrocar={(id) =>
                            reatribuir.mutate({ cnpj: c.fornecedor_cnpj, originadorId: id })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs">{dia(c.ultima_nf_em)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {cardAberto ? (
        <FichaFornecedor
          card={cardAberto}
          ehGestor={ehGestor}
          aberta
          onFechar={() => setAberto(null)}
          originadorNome={cardAberto.originador_nome ?? nomeUsuario}
        />
      ) : null}
    </div>
  )
}
