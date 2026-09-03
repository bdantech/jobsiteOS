'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CopyPlus, ExternalLink, Eye, Pencil, Plus, ShieldAlert } from 'lucide-react'
import { duplicarFormulario, formatCnpj, INTENCAO_LABELS, type Intencao } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Construtor } from './construtor'
import {
  buscarFormulario,
  buscarFormularios,
  buscarSubmissoes,
  leadsKeys,
  type FormularioCompleto,
  type FormularioLinha,
} from './queries'

/**
 * Leads (04i): a lista de formulários e as submissões cruas.
 *
 * A taxa de conversão é o número que decide se o problema está no formulário ou no
 * tráfego — e ela só existe porque o script registra a VISUALIZAÇÃO. Sem denominador,
 * "12 submissões" não diz nada: pode ser 12 de 20 ou 12 de 4.000.
 */

function pct(n: number, d: number): string {
  if (d <= 0) return '—'
  return `${((n / d) * 100).toFixed(1).replace('.', ',')}%`
}

function dataBr(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

const STATUS_LABELS: Record<string, string> = {
  recebida: 'Recebida',
  processada: 'Processada',
  revisao: 'Em revisão',
  descartada_spam: 'Spam',
  erro: 'Erro',
}

const STATUS_CLASSE: Record<string, string> = {
  processada: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200',
  revisao: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  erro: 'bg-destructive/10 text-destructive',
  descartada_spam: 'bg-muted text-muted-foreground',
}

export function LeadsTela({ ehGestor }: { ehGestor: boolean }) {
  const [aba, setAba] = React.useState<'formularios' | 'submissoes'>('formularios')
  const [editando, setEditando] = React.useState<FormularioCompleto | null | undefined>(undefined)

  const lista = useQuery({ queryKey: leadsKeys.formularios(), queryFn: buscarFormularios })

  async function abrirEdicao(id: string) {
    const f = await buscarFormulario(id)
    if (f) setEditando(f)
  }

  /**
   * DUPLICAR abre o construtor com a cópia pronta — e não grava nada ainda.
   *
   * A tentação é criar a linha no clique e mandar a pessoa editar depois. Mas o
   * slug é único, vira a URL pública e vira o nome do script colado na landing
   * page do cliente: gravar antes de alguém olhar cria um endereço que ninguém
   * escolheu, e trocá-lo em seguida é a operação que o próprio construtor avisa
   * que quebra o que já está colado.
   *
   * Então a cópia nasce na tela, com slug e nome derivados e sem colidir com os
   * existentes, e passa a existir no banco quando a pessoa salvar. `ativo: false`
   * vem de `duplicarFormulario`: publicar é expor uma URL ao público, e isso não
   * pode ser efeito colateral de um clique em "Duplicar".
   */
  async function abrirDuplicata(id: string) {
    const f = await buscarFormulario(id)
    if (!f) {
      toast.error('Não foi possível ler este formulário.')
      return
    }
    setEditando(duplicarFormulario(f, lista.data ?? []))
    toast.success('Cópia pronta — revise o endereço e salve.', {
      description: 'Ela nasce inativa: nada vai ao ar antes de você publicar.',
    })
  }

  if (editando !== undefined) {
    return <Construtor inicial={editando} onFechar={() => setEditando(undefined)} />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Seções de Leads"
          className="flex items-center rounded-md border border-border p-0.5"
        >
          {(['formularios', 'submissoes'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              aria-pressed={aba === a}
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                aba === a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {a === 'formularios' ? 'Formulários' : 'Submissões'}
            </button>
          ))}
        </div>
        {ehGestor && aba === 'formularios' && (
          <Button size="sm" onClick={() => setEditando(null)}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Novo formulário
          </Button>
        )}
      </div>

      {aba === 'formularios' ? (
        lista.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (lista.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum formulário ainda.</p>
              <p className="mt-1">
                Um formulário vira uma linha de script para colar na landing page. O lead que
                chega por ele já entra com empresa, contato e dossiê.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ListaFormularios
            linhas={lista.data ?? []}
            ehGestor={ehGestor}
            onEditar={(id) => void abrirEdicao(id)}
            onDuplicar={(id) => void abrirDuplicata(id)}
          />
        )
      ) : (
        <Submissoes />
      )}
    </div>
  )
}

function ListaFormularios({
  linhas,
  ehGestor,
  onEditar,
  onDuplicar,
}: {
  linhas: FormularioLinha[]
  ehGestor: boolean
  onEditar: (id: string) => void
  onDuplicar: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      {linhas.map((f) => (
        <Card key={f.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{f.nome}</CardTitle>
                  {/*
                    Destaque, e não uma badge de contorno igual às outras: "inativo"
                    aqui não é um atributo a mais da linha, é a resposta de "por que
                    esta LP não aparece no site?" — a pergunta que traz alguém a esta
                    tela. Cópias nascem inativas, e essa era a linha que ninguém via.
                  */}
                  {!f.ativo && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-700 dark:text-amber-400"
                      title={`Desativado: o script na landing page não renderiza nada e /f/${f.slug} devolve 404.`}
                    >
                      inativo — fora do ar
                    </Badge>
                  )}
                  {f.enriquecimento_pago && (
                    <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                      enriquecimento pago
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/f/{f.slug}</code>
                  {f.vendedor_destino_nome ? <> · destino {f.vendedor_destino_nome}</> : null}
                </CardDescription>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/f/${f.slug}`} target="_blank">
                    <Eye className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Abrir
                    <ExternalLink className="ml-1 h-3 w-3" aria-hidden />
                  </Link>
                </Button>
                {ehGestor && (
                  <>
                    {/*
                      Duplicar é gestor-only pela mesma razão que Editar: quem salva o
                      formulário é `app_salvar_formulario`, e ele exige
                      `app_gestor_comercial()`. Oferecer o botão a quem levaria um 42501
                      no fim ensina que o sistema erra.
                    */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDuplicar(f.id)}
                      title="Criar uma nova LP com a mesma estrutura"
                    >
                      <CopyPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Duplicar
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onEditar(f.id)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Editar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Metrica rotulo="Visualizações" valor={f.visualizacoes} />
              <Metrica rotulo="Submissões" valor={f.submissoes} />
              <Metrica
                rotulo="Conversão"
                texto={pct(f.submissoes, f.visualizacoes)}
                ajuda="submissões ÷ visualizações"
              />
              <Metrica rotulo="Reuniões" valor={f.reunioes} />
              <Metrica
                rotulo="Em revisão"
                valor={f.em_revisao}
                alerta={f.em_revisao > 0}
                ajuda={f.spam > 0 ? `${f.spam} spam descartado` : undefined}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Metrica({
  rotulo,
  valor,
  texto,
  ajuda,
  alerta,
}: {
  rotulo: string
  valor?: number
  texto?: string
  ajuda?: string
  alerta?: boolean
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn('text-xl font-semibold tabular-nums', alerta && 'text-amber-700 dark:text-amber-400')}>
        {texto ?? valor ?? 0}
      </p>
      {ajuda ? <p className="mt-0.5 text-[11px] text-muted-foreground">{ajuda}</p> : null}
    </div>
  )
}

function Submissoes() {
  const q = useQuery({ queryKey: leadsKeys.submissoes(null), queryFn: () => buscarSubmissoes(null) })

  if (q.isPending) return <Skeleton className="h-64 w-full" />
  const linhas = q.data ?? []

  if (linhas.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nenhuma submissão ainda.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Submissões</CardTitle>
        <CardDescription>
          Tudo que chegou, inclusive spam e erro. A pergunta que esta lista responde é &ldquo;o
          lead do fulano chegou?&rdquo; — e esconder o que deu errado responderia
          &ldquo;não&rdquo; para os dois casos em que chegou e foi barrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Quando</th>
                <th className="px-4 py-2 font-medium">Empresa</th>
                <th className="px-4 py-2 font-medium">Intenção</th>
                <th className="px-4 py-2 font-medium">Origem</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {linhas.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                    {dataBr(s.criada_em)}
                  </td>
                  <td className="px-4 py-2">
                    {s.empresa_id ? (
                      <Link href={`/empresas/${s.empresa_id}`} className="font-medium hover:underline">
                        {String(s.dados.razao_social ?? '—')}
                      </Link>
                    ) : (
                      <span className="font-medium">{String(s.dados.razao_social ?? '—')}</span>
                    )}
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">
                      {s.cnpj ? formatCnpj(s.cnpj) : '—'}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {s.intencao ? INTENCAO_LABELS[s.intencao as Intencao] : '—'}
                    {/*
                     * A bandeira de divergência é o insumo mais útil desta tela: ela
                     * NÃO significa lead ruim. Costuma ser lead confuso ou lead muito
                     * interessante — o subempreiteiro grande que também subcontrata é
                     * os dois papéis ao mesmo tempo.
                     */}
                    {s.divergencia_papel && (
                      <span className="mt-1 flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        papel divergente do CNAE
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {s.utm_source ?? '—'}
                    {s.utm_campaign ? <span className="block">{s.utm_campaign}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant="outline" className={cn('text-xs', STATUS_CLASSE[s.status])}>
                      {STATUS_LABELS[s.status] ?? s.status}
                    </Badge>
                    {s.motivo_revisao ? (
                      <p className="mt-1 flex max-w-64 items-start gap-1 text-[11px] text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        {s.motivo_revisao}
                      </p>
                    ) : null}
                    {s.erro ? (
                      <p className="mt-1 max-w-64 text-[11px] text-destructive">{s.erro}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
