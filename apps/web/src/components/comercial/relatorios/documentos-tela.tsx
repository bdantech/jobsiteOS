'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { MOTIVO_SEM_INTERESSE_LABELS, brlCurto, type MotivoSemInteresse } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LinkEmAba } from '@/components/shell/link-em-aba'
import { cn } from '@/lib/utils'
import {
  buscarReportDocumentos, documentosKeys,
  type LinhaConta, type LinhaContraparte, type LinhaMotivo, type LinhaOriginador, type LinhaStatus,
  type MotivoSemDono, type PorTipo, type ReportDocumentos, type StatusDocumento,
} from './documentos-queries'

/**
 * O report "Documentos sem dono e carteiras".
 *
 * Duas perguntas na mesma tela, porque uma é o complemento da outra: o que NINGUÉM está
 * trabalhando (e por quê), e onde foi parar o que cada originador tem em seu nome.
 *
 * ─── O RECORTE DE "SEM DONO" É O DO FUNIL ───────────────────────────────────
 * Estágio aberto, operável, exibido — o que o filtro "sem dono" do Kanban mostra. O
 * aviso `nf.sem_originador` conta também as notas expiradas, e por isso o número dele é
 * várias vezes maior. A legenda no topo diz isso para quem chegar pelo push.
 *
 * ─── O DETALHE MORA NO TOOLTIP ──────────────────────────────────────────────
 * A quebra por origem (NF, pré-autorização, título) e o motivo do "sem interesse" são
 * respostas a "de onde vem este número?" — pergunta que se faz olhando UM número. Uma
 * coluna para cada origem triplicaria a largura de todas as tabelas para um dado que é
 * 99% nota fiscal.
 */

const n = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR')

const MOTIVOS: Record<MotivoSemDono, { rotulo: string; explica: string }> = {
  fora_de_carteira: {
    rotulo: 'Sacado cadastrado, fora de qualquer carteira',
    explica: 'A empresa existe no cadastro, mas nenhum originador a escolheu. Entra em carteira e as notas ganham dono no ciclo seguinte.',
  },
  sacado_sem_cadastro: {
    rotulo: 'Sacado sem cadastro',
    explica: 'Só o cedente é conhecido. Sem a empresa do sacado cadastrada, não há carteira que alcance a nota.',
  },
  passivo: {
    rotulo: 'Conta passiva',
    explica: 'A holding do sacado está com gestão passiva: fica fora da originação por regra, não por falta de cadastro.',
  },
  em_carteira: {
    rotulo: 'Em carteira, aguardando roteamento',
    explica: 'A empresa já está na carteira de um originador. O próximo ciclo de roteamento atribui; se o número não zerar, o roteamento parou.',
  },
}

const STATUS: Record<StatusDocumento, { rotulo: string; explica: string; vivo: boolean }> = {
  no_funil: {
    rotulo: 'No funil',
    explica: 'Aparece no Kanban do originador ao abrir a tela.',
    vivo: true,
  },
  sem_interesse: {
    rotulo: 'Marcado sem interesse',
    explica: 'O fornecedor foi marcado como sem interesse. Sai do filtro padrão; volta com "incluir suprimidos".',
    vivo: true,
  },
  suprimido: {
    rotulo: 'Fornecedor suprimido',
    explica: 'Há supressão ativa para o fornecedor, sem marcação de sem interesse. Originador sem o módulo Radar não lê a supressão e continua vendo o card.',
    vivo: true,
  },
  substituido: {
    rotulo: 'Substituído por outro card',
    explica: 'A mesma operação aparece por outro documento: o título vira a pré-autorização quando a oferta é criada, e a pré-autorização vira a nota quando a nota existe.',
    vivo: true,
  },
  nao_operavel: {
    rotulo: 'Nota não operável',
    explica: 'Cancelada, abaixo do valor mínimo ou de natureza que não gera crédito (remessa, retorno). Não entra no Kanban para ninguém.',
    vivo: true,
  },
  convertida: { rotulo: 'Convertida', explica: 'Virou antecipação.', vivo: false },
  perdida: { rotulo: 'Perdida', explica: 'Encerrada como perdida.', vivo: false },
  expirada: { rotulo: 'Expirada', explica: 'O prazo passou sem operação.', vivo: false },
}
const ORDEM_STATUS = Object.keys(STATUS) as StatusDocumento[]

const ROTULO_GESTAO: Record<string, string> = {
  passivo: 'Passivo',
  prospeccao_ativa: 'Prospecção ativa',
}
const ROTULO_ESTAGIO: Record<string, string> = {
  cliente: 'Cliente',
  ex_cliente: 'Ex-cliente',
  mercado: 'Mercado',
  lead: 'Lead',
}
const ROTULO_CREDITO: Record<string, string> = {
  APPROVED: 'Aprovado',
  BLOCKED: 'Bloqueado',
  TO_APPROVE: 'A aprovar',
}

export function DocumentosTela() {
  const q = useQuery({
    queryKey: documentosKeys.report(),
    queryFn: buscarReportDocumentos,
    staleTime: 5 * 60_000,
  })
  const r = q.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted-foreground">
            <Link href="/comercial/relatorios">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden />
              Relatórios
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Documentos sem dono e carteiras</h1>
          <p className="text-xs text-muted-foreground">
            Notas fiscais, títulos Sienge e pré-autorizações em estágio aberto, operáveis e exibidos no funil.
            {r ? ` Retrato de ${new Date(r.gerado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}
          </p>
          <p className="text-[11px] text-muted-foreground">
            O aviso &quot;NFs sem originador&quot; conta também as notas já expiradas; por isso o número dele é maior que o daqui.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', q.isFetching && 'animate-spin')} aria-hidden />
          Atualizar
        </Button>
      </div>

      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : q.error || !r ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden />
            <p className="text-sm">Não foi possível montar o relatório.</p>
            <p className="text-xs text-muted-foreground">{q.error instanceof Error ? q.error.message : null}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Totais r={r} />
          <TabelaContrapartes
            titulo="Maiores sacados sem dono"
            descricao="Agrupado pela raiz do CNPJ. Os 30 maiores por valor de face."
            linhas={r.sacados}
            lado="sacado"
          />
          <PorQue motivos={r.motivos} total={r.totais.valor} />
          <TabelaContrapartes
            titulo="Maiores cedentes sem dono"
            descricao="Agrupado pela raiz do CNPJ do fornecedor (credor, no título Sienge)."
            linhas={r.cedentes}
            lado="cedente"
          />
          <Contas contas={r.contas} />
          <Originadores originadores={r.originadores} />
        </>
      )}
    </div>
  )
}

// ─── Peças de tooltip ───────────────────────────────────────────────────────

/** O gatilho é um botão: precisa receber foco para o teclado abrir o tooltip. */
function Dica({ children, conteudo, className }: { children: React.ReactNode; conteudo: React.ReactNode; className?: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'cursor-help rounded-sm text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1.5 text-xs">{conteudo}</TooltipContent>
    </Tooltip>
  )
}

function QuebraPorTipo({ d, mostrar }: { d: PorTipo; mostrar: 'docs' | 'valor' | 'ambos' }) {
  const linhas: [string, number, number | undefined][] = [
    ['Nota fiscal', d.docs_nf, d.valor_nf],
    ['Pré-autorização', d.docs_pa, d.valor_pa],
    ['Título Sienge', d.docs_ti, d.valor_ti],
  ]
  return (
    <table className="w-full tabular-nums">
      <tbody>
        {linhas.map(([rotulo, docs, valor]) => (
          <tr key={rotulo}>
            <td className="pr-4">{rotulo}</td>
            {mostrar !== 'valor' ? <td className="pr-3 text-right">{n(docs)}</td> : null}
            {mostrar !== 'docs' && valor !== undefined ? <td className="text-right">{brlCurto(valor)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── 1. Totais ──────────────────────────────────────────────────────────────

function Totais({ r }: { r: ReportDocumentos }) {
  const t = r.totais
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Numero rotulo="Documentos sem dono">
        <Dica conteudo={<QuebraPorTipo d={t} mostrar="docs" />} className="text-2xl font-semibold tabular-nums">
          {n(t.docs)}
        </Dica>
      </Numero>
      <Numero rotulo="Valor de face sem dono">
        <Dica conteudo={<QuebraPorTipo d={t} mostrar="valor" />} className="text-2xl font-semibold tabular-nums">
          {brlCurto(t.valor)}
        </Dica>
      </Numero>
      <Numero rotulo="Receita esperada parada">
        <span className="text-2xl font-semibold tabular-nums">{brlCurto(t.receita)}</span>
      </Numero>
      <Numero rotulo="Sacados · cedentes distintos">
        <span className="text-2xl font-semibold tabular-nums">
          {n(t.sacados)} · {n(t.cedentes)}
        </span>
      </Numero>
    </div>
  )
}

function Numero({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
        {children}
      </CardContent>
    </Card>
  )
}

// ─── 3. Por que está sem dono ───────────────────────────────────────────────

function PorQue({ motivos, total }: { motivos: LinhaMotivo[]; total: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Por que cada documento está sem dono</CardTitle>
        <CardDescription className="text-[11px]">
          A mesma régua do roteamento. Barras em proporção do valor de face.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {motivos.map((m) => {
          const info = MOTIVOS[m.motivo] ?? { rotulo: m.motivo, explica: '' }
          const pct = total > 0 ? (m.valor / total) * 100 : 0
          return (
            <div key={m.motivo} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs">
                <Dica
                  conteudo={
                    <>
                      <p>{info.explica}</p>
                      <QuebraPorTipo d={m} mostrar="ambos" />
                      <p className="text-muted-foreground">
                        {n(m.sacados)} sacados · {n(m.cedentes)} cedentes
                      </p>
                    </>
                  }
                  className="font-medium"
                >
                  {info.rotulo}
                </Dica>
                <span className="tabular-nums text-muted-foreground">
                  {brlCurto(m.valor)} · {n(m.docs)} docs · {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
              </div>
              <div className="h-2 rounded-sm bg-muted">
                <div
                  className={cn('h-2 rounded-sm', m.motivo === 'em_carteira' ? 'bg-amber-500' : 'bg-primary/70')}
                  style={{ width: `${Math.max(pct, m.docs > 0 ? 0.5 : 0)}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── 2 e 4. Maiores sacados / cedentes ──────────────────────────────────────

function TabelaContrapartes({
  titulo, descricao, linhas, lado,
}: {
  titulo: string
  descricao: string
  linhas: LinhaContraparte[]
  lado: 'sacado' | 'cedente'
}) {
  const [todos, setTodos] = React.useState(false)
  const visiveis = todos ? linhas : linhas.slice(0, 10)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{titulo}</CardTitle>
        <CardDescription className="text-[11px]">{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>{lado === 'sacado' ? 'Sacado' : 'Cedente'}</TableHead>
                <TableHead className="text-right">Docs</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">% do total</TableHead>
                <TableHead className="text-right">{lado === 'sacado' ? 'Cedentes' : 'Sacados'}</TableHead>
                <TableHead className="text-right">Vence em 30 d</TableHead>
                <TableHead>Situação</TableHead>
                {lado === 'cedente' ? <TableHead>Maior sacado</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((l, i) => (
                <TableRow key={l.raiz}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <NomeEmpresa nome={l.nome} empresaId={l.empresa_id} />
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {l.raiz}
                      {l.cnpjs > 1 ? ` · ${l.cnpjs} CNPJs` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Dica conteudo={<QuebraPorTipo d={l} mostrar="docs" />}>{n(l.docs)}</Dica>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brlCurto(l.valor)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.pct === null ? '—' : `${Number(l.pct).toLocaleString('pt-BR')}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(l.contrapartes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brlCurto(l.vence_30d)}</TableCell>
                  <TableCell>
                    <Situacao l={l} lado={lado} />
                  </TableCell>
                  {lado === 'cedente' ? (
                    <TableCell className="max-w-[220px]">
                      <p className="truncate" title={l.maior_sacado ?? undefined}>{l.maior_sacado ?? '—'}</p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        {brlCurto(l.maior_sacado_valor)}
                      </p>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {linhas.length > 10 ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTodos((v) => !v)}>
            {todos ? 'Mostrar só os 10 maiores' : `Mostrar os ${linhas.length}`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function NomeEmpresa({ nome, empresaId }: { nome: string | null; empresaId: string | null }) {
  const texto = nome ?? 'Sem nome'
  if (!empresaId) return <p className="font-medium">{texto}</p>
  return (
    <LinkEmAba href={`/empresas/${empresaId}`} tituloDaAba={texto} className="font-medium hover:underline">
      {texto}
    </LinkEmAba>
  )
}

function Situacao({ l, lado }: { l: LinhaContraparte; lado: 'sacado' | 'cedente' }) {
  return (
    <div className="flex flex-wrap gap-1">
      {!l.cadastrado ? (
        <Badge variant="warning">Sem cadastro</Badge>
      ) : (
        <Badge variant="neutral">{ROTULO_ESTAGIO[l.estagio ?? ''] ?? l.estagio ?? 'Cadastrado'}</Badge>
      )}
      {lado === 'sacado' && l.gestao ? (
        <Badge variant={l.gestao === 'passivo' ? 'warning' : 'info'}>{ROTULO_GESTAO[l.gestao] ?? l.gestao}</Badge>
      ) : null}
      {lado === 'sacado' && l.credito ? (
        <Badge variant={l.credito === 'APPROVED' ? 'success' : l.credito === 'BLOCKED' ? 'critical' : 'neutral'}>
          Crédito {(ROTULO_CREDITO[l.credito] ?? l.credito).toLowerCase()}
        </Badge>
      ) : null}
      {l.alta_boa > 0 ? <Badge variant="outline">{n(l.alta_boa)} em faixa alta/boa</Badge> : null}
      {lado === 'cedente' && l.sem_interesse ? <Badge variant="critical">Sem interesse</Badge> : null}
      {lado === 'cedente' && l.cliente_onepay ? <Badge variant="success">Cliente Onepay</Badge> : null}
      {lado === 'cedente' && l.protesto ? <Badge variant="critical">Protesto</Badge> : null}
    </div>
  )
}

// ─── 5. Contas que dá para atribuir ─────────────────────────────────────────

function Contas({ contas }: { contas: LinhaConta[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Contas que dá para atribuir</CardTitle>
        <CardDescription className="text-[11px]">
          Sacados sem dono cuja holding já é cliente, ex-cliente, tem gestão definida ou crédito aprovado. Conta com
          gestão não definida sai da fila definindo a gestão e o originador; conta passiva está sem dono por regra.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {contas.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma conta conhecida com documento sem dono.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta (holding)</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Gestão</TableHead>
                  <TableHead className="text-right">Docs</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Cedentes</TableHead>
                  <TableHead className="text-right">Alta/boa</TableHead>
                  <TableHead>Crédito</TableHead>
                  <TableHead>Na carteira de</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contas.map((c) => (
                  <TableRow key={c.empresa_id}>
                    <TableCell>
                      <NomeEmpresa nome={c.nome} empresaId={c.empresa_id} />
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        {c.cnpj}
                        {c.cnpjs > 1 ? ` · ${c.cnpjs} CNPJs sacados` : ''}
                      </p>
                    </TableCell>
                    <TableCell>{ROTULO_ESTAGIO[c.estagio ?? ''] ?? c.estagio ?? '—'}</TableCell>
                    <TableCell>
                      {c.gestao ? (
                        <Badge variant={c.gestao === 'passivo' ? 'warning' : 'info'}>
                          {ROTULO_GESTAO[c.gestao] ?? c.gestao}
                        </Badge>
                      ) : (
                        <Badge variant="critical">Não definida</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Dica conteudo={<QuebraPorTipo d={c} mostrar="docs" />}>{n(c.docs)}</Dica>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{brlCurto(c.valor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(c.cedentes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(c.alta_boa)}</TableCell>
                    <TableCell>{c.credito ? (ROTULO_CREDITO[c.credito] ?? c.credito) : 'Sem análise'}</TableCell>
                    <TableCell>{c.carteira ?? 'Ninguém'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 6. Onde estão os documentos de cada originador ─────────────────────────

function Originadores({ originadores }: { originadores: LinhaOriginador[] }) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Onde estão os documentos de cada originador</h2>
        <p className="text-[11px] text-muted-foreground">
          Tudo que está em nome de cada pessoa, por situação. Passe o mouse na situação para ver o que ela significa e
          a quebra por origem.
        </p>
      </div>
      {originadores.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-xs text-muted-foreground">
            Nenhum documento atribuído a originador.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {originadores.map((o) => (
            <CardOriginador key={o.vendedor_id} o={o} />
          ))}
        </div>
      )}
    </div>
  )
}

function CardOriginador({ o }: { o: LinhaOriginador }) {
  const porStatus = new Map(o.status.map((s) => [s.status, s]))
  const vivos = ORDEM_STATUS.filter((s) => STATUS[s].vivo && porStatus.has(s)).map((s) => porStatus.get(s)!)
  const encerrados = ORDEM_STATUS.filter((s) => !STATUS[s].vivo && porStatus.has(s)).map((s) => porStatus.get(s)!)
  const totalVivos = vivos.reduce((a, s) => a + s.docs, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {o.nome}
          {o.tipo ? <Badge variant="neutral">{o.tipo}</Badge> : null}
          {!o.ativo ? <Badge variant="warning">Inativo</Badge> : null}
        </CardTitle>
        <CardDescription className="text-[11px]">
          {n(totalVivos)} documentos vivos · {n(encerrados.reduce((a, s) => a + s.docs, 0))} encerrados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <GrupoStatus titulo="Vivos" linhas={vivos} base={totalVivos} o={o} />
        <GrupoStatus titulo="Encerrados" linhas={encerrados} base={0} o={o} />
      </CardContent>
    </Card>
  )
}

function GrupoStatus({
  titulo, linhas, base, o,
}: {
  titulo: string
  linhas: LinhaStatus[]
  /** Total que serve de 100% para a barra; 0 = sem barra. */
  base: number
  o: LinhaOriginador
}) {
  if (linhas.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{titulo}</p>
      {linhas.map((s) => {
        const info = STATUS[s.status]
        const pct = base > 0 ? (s.docs / base) * 100 : 0
        return (
          <div key={s.status} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <Dica
                conteudo={
                  <>
                    <p>{info.explica}</p>
                    {s.status === 'sem_interesse' && o.sem_interesse_motivos.length > 0 ? (
                      <table className="w-full tabular-nums">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pr-3 font-normal">Motivo</th>
                            <th className="pr-3 text-right font-normal">Forn.</th>
                            <th className="pr-3 text-right font-normal">Docs</th>
                            <th className="text-right font-normal">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.sem_interesse_motivos.map((m) => (
                            <tr key={m.motivo}>
                              <td className="pr-3">
                                {MOTIVO_SEM_INTERESSE_LABELS[m.motivo as MotivoSemInteresse] ?? m.motivo}
                              </td>
                              <td className="pr-3 text-right">{n(m.fornecedores)}</td>
                              <td className="pr-3 text-right">{n(m.docs)}</td>
                              <td className="text-right">{brlCurto(m.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    <p className="text-muted-foreground">Por origem</p>
                    <QuebraPorTipo d={s} mostrar="ambos" />
                  </>
                }
                className={s.status === 'no_funil' ? 'font-medium' : undefined}
              >
                {info.rotulo}
              </Dica>
              <span className="tabular-nums text-muted-foreground">
                {n(s.docs)} docs · {brlCurto(s.valor)}
              </span>
            </div>
            {base > 0 ? (
              <div className="h-1.5 rounded-sm bg-muted">
                <div
                  className={cn('h-1.5 rounded-sm', s.status === 'no_funil' ? 'bg-primary' : 'bg-primary/40')}
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
