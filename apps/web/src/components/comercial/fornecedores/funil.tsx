'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LayoutGrid, RefreshCw, Table2, UserCog } from 'lucide-react'
import {
  ESTAGIOS_FORNECEDOR_ATIVOS,
  ESTAGIO_FORNECEDOR_DESCRICOES,
  ESTAGIO_FORNECEDOR_LABELS,
  type EstagioFornecedor,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { atualizarFunilAction, reatribuirFornecedorAction } from '@/actions/fornecedores'
import { buscarVendedoresVisiveis, comercialKeys } from '../queries'
import { FichaFornecedor } from './ficha'
import { buscarFunil, fornecedoresKeys, type FornecedorCard } from './queries'
import { brl, cnpjFormatado, dia, rotuloConfianca, varianteConfianca } from './formato'

/**
 * O funil (04l §5): kanban por estágio, tabela como alternativa.
 *
 * Mesma forma do funil de reuniões e da esteira de crédito, e é de propósito — a
 * pergunta é a mesma ("onde está cada coisa e o que falta nela"), e duas telas que
 * respondem à mesma pergunta com layouts diferentes obrigam a pessoa a reaprender a
 * ler a cada troca de módulo.
 *
 * ─── A ORDENAÇÃO É O POTENCIAL, E SÓ DO FORNECEDOR ───────────────────────────
 *
 * O limite do sacado NÃO entra (§3, explícito). Ele é o teto da operação, não do
 * lead: um fornecedor de R$ 900 mil/mês contra um sacado com limite estourado
 * continua sendo o melhor telefone da lista, porque limite se resolve com análise e
 * fornecedor grande não aparece por decreto.
 *
 * ─── SEM ARRASTAR E SOLTAR ───────────────────────────────────────────────────
 *
 * Mover é um clique dentro da ficha, junto com a munição que justifica mover. Um
 * kanban onde arrastar é a ação principal convida a arrumar a tela em vez de
 * trabalhar o lead — e as duas transições que importam aqui ("sem interesse" e
 * "cadastrado") não são arrastáveis de qualquer forma.
 */

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
  const [visao, setVisao] = React.useState<'kanban' | 'tabela'>('kanban')
  const [concluidos, setConcluidos] = React.useState(false)
  const [termo, setTermo] = React.useState('')
  const [debounce, setDebounce] = React.useState('')
  /*
   * O default do gestor é a fila SEM DONO, não "todos".
   *
   * Abrir em "todos" faria a primeira coisa que ele vê ser o trabalho de outra
   * pessoa. A fila sem dono é a única lista deste módulo em que o gestor tem uma
   * ação que ninguém mais pode fazer — atribuir —, e 576 dos 688 fornecedores
   * chegam sem titular porque a carteira de originação está pouco preenchida.
   */
  const [filtroDono, setFiltroDono] = React.useState<string>(
    ehGestor ? 'sem_dono' : (vendedorId ?? ''),
  )
  const [aberta, setAberta] = React.useState<string | null>(null)

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

  const vendedores = useQuery({
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

  // Memoizado porque ele é dependência do `useMemo` de baixo: `funil.data ?? []` cria
  // um array novo a cada render, e o agrupamento por estágio recalcularia sempre.
  const cards = React.useMemo(() => funil.data ?? [], [funil.data])
  const cardAberto = cards.find((c) => c.fornecedor_cnpj === aberta) ?? null

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Input
            placeholder="Buscar por nome ou CNPJ…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
        </div>

        {ehGestor ? (
          <Select value={filtroDono} onValueChange={setFiltroDono}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sem_dono">Fila sem dono</SelectItem>
              <SelectItem value="todos">Todos os originadores</SelectItem>
              {(vendedores.data ?? []).map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button
          variant={concluidos ? 'default' : 'outline'}
          size="sm"
          onClick={() => setConcluidos((c) => !c)}
        >
          Concluídos
        </Button>

        <Button
          variant="outline"
          size="icon"
          title={visao === 'kanban' ? 'Ver como tabela' : 'Ver como kanban'}
          onClick={() => setVisao((v) => (v === 'kanban' ? 'tabela' : 'kanban'))}
        >
          {visao === 'kanban' ? <Table2 className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>

        {ehGestor ? (
          <Button
            variant="outline"
            size="icon"
            title="Recalcular munição a partir das notas"
            disabled={recalcular.isPending}
            onClick={() => recalcular.mutate()}
          >
            <RefreshCw className={recalcular.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        ) : null}
      </div>

      {funil.isPending ? (
        <div className="grid gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : cards.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {filtroDono === 'sem_dono'
              ? 'Nenhum fornecedor sem dono. Troque o filtro para ver os atribuídos.'
              : 'Nada aqui. O funil é alimentado pelo sync de notas: fornecedores que faturam contra nossos sacados e passam do corte de volume entram sozinhos.'}
          </CardContent>
        </Card>
      ) : visao === 'kanban' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {colunas.map((estagio) => {
            const lista = porEstagio.get(estagio) ?? []
            return (
              <Card key={estagio} className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <Tooltip>
                      <TooltipTrigger className="text-left">
                        {ESTAGIO_FORNECEDOR_LABELS[estagio]}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-64">
                        {ESTAGIO_FORNECEDOR_DESCRICOES[estagio]}
                      </TooltipContent>
                    </Tooltip>
                    <Badge variant="secondary">{lista.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-2">
                  {lista.length === 0 ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : (
                    lista.map((c) => (
                      <button
                        key={c.fornecedor_cnpj}
                        type="button"
                        onClick={() => setAberta(c.fornecedor_cnpj)}
                        className="w-full rounded-md border border-border p-2 text-left transition-colors hover:bg-accent"
                      >
                        <p className="truncate text-sm font-medium">{c.fornecedor_nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {brl(c.potencial_mensal)}/mês · {c.qtd_nfs_90d ?? 0} NFs
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge variant={varianteConfianca(c.melhor_confianca)} className="text-[10px]">
                            {c.contatos_encontrados
                              ? `${c.contatos_encontrados} contato(s) · ${rotuloConfianca(c.melhor_confianca)}`
                              : 'sem contato'}
                          </Badge>
                          {c.originador_nome ? null : (
                            <Badge variant="outline" className="text-[10px]">sem dono</Badge>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
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
                  <TableRow
                    key={c.fornecedor_cnpj}
                    className="cursor-pointer"
                    onClick={() => setAberta(c.fornecedor_cnpj)}
                  >
                    <TableCell>
                      <p className="font-medium">{c.fornecedor_nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {cnpjFormatado(c.fornecedor_cnpj)}
                        {c.municipio ? ` · ${c.municipio}/${c.uf ?? ''}` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
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
                    <TableCell className="text-xs" onClick={(e) => e.stopPropagation()}>
                      {ehGestor ? (
                        <Select
                          value={c.originador_id ?? 'sem_dono'}
                          onValueChange={(v) =>
                            reatribuir.mutate({
                              cnpj: c.fornecedor_cnpj,
                              originadorId: v === 'sem_dono' ? null : v,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue placeholder="Sem dono" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sem_dono">Sem dono</SelectItem>
                            {(vendedores.data ?? []).map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="flex items-center gap-1">
                          <UserCog className="h-3 w-3 text-muted-foreground" />
                          {c.originador_nome ?? 'sem dono'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">{dia(c.ultima_nf_em)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {cardAberto ? (
        <FichaFornecedor
          card={cardAberto}
          ehGestor={ehGestor}
          aberta
          onFechar={() => setAberta(null)}
          originadorNome={cardAberto.originador_nome ?? nomeUsuario}
        />
      ) : null}
    </div>
  )
}
