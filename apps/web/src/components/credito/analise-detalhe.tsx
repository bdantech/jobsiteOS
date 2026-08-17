'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, FileUp, Paperclip } from 'lucide-react'
import {
  ESTAGIOS_MANUAIS,
  ESTAGIO_ANALISE_LABELS,
  ehEstagioDecidido,
  formatCnpj,
  type EstagioAnalise,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { moverAnaliseAction, registrarDocAction } from '@/actions/credito'
import { createClient } from '@/lib/supabase/client'
import { VoltarContextual } from '@/components/shell/voltar-contextual'
import { PainelSacado } from './analise-propria/painel-sacado'
import { buscarAnalise, buscarCreditoConfig, buscarDocs, creditoKeys } from './queries'

/**
 * Detalhe de uma análise: dados da seguradora, checklist de documentos e o pouco que a
 * tela pode mover.
 *
 * O seletor de estágio só oferece os quatro estágios MANUAIS. Os outros seis pertencem à
 * seguradora e são escritos pelo worker — a migração 0073 recusa o resto no RPC, e
 * oferecê-los aqui seria desenhar um botão que o banco vai negar.
 */

const moeda = (v: number | null): string =>
  v === null || !Number.isFinite(Number(v))
    ? '—'
    : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
}

/** Upload direto no bucket privado; o RPC só registra o caminho. */
async function subirArquivo(analiseId: string, tipo: string, arquivo: File): Promise<string> {
  const supabase = createClient()
  // O caminho começa pelo id da análise: é o que amarra o objeto ao registro e o que a
  // policy de storage usa como âncora. Timestamp no nome para dois envios do mesmo
  // arquivo não se sobrescreverem em silêncio.
  const caminho = `${analiseId}/${tipo}-${Date.now()}-${arquivo.name.replace(/[^\w.\-]/g, '_')}`
  const { error } = await supabase.storage.from('analise-docs').upload(caminho, arquivo, { upsert: false })
  if (error) throw new Error(error.message)
  return caminho
}

function Docs({ analiseId }: { analiseId: string }) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState<string | null>(null)

  const docs = useQuery({ queryKey: creditoKeys.docs(analiseId), queryFn: () => buscarDocs(analiseId) })
  const config = useQuery({ queryKey: creditoKeys.config(), queryFn: buscarCreditoConfig })

  const tipos: TipoDoc[] =
    ((config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []).length > 0
      ? ((config.data?.docs as { tipos: TipoDoc[] }).tipos)
      : [
          { id: 'balanco', label: 'Balanço patrimonial', obrigatorio: true },
          { id: 'dre', label: 'DRE', obrigatorio: true },
          { id: 'contrato_social', label: 'Contrato social', obrigatorio: true },
          { id: 'outros', label: 'Outros', obrigatorio: false },
        ]

  async function enviar(tipo: string, arquivo: File) {
    setEnviando(tipo)
    try {
      const caminho = await subirArquivo(analiseId, tipo, arquivo)
      const r = await registrarDocAction({
        analise_id: analiseId,
        tipo,
        arquivo_url: caminho,
        nome_arquivo: arquivo.name,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Documento anexado.')
      void qc.invalidateQueries({ queryKey: creditoKeys.docs(analiseId) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.')
    } finally {
      setEnviando(null)
    }
  }

  const enviados = new Set((docs.data ?? []).map((d) => d.tipo))
  const faltando = tipos.filter((t) => t.obrigatorio && !enviados.has(t.id))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" aria-hidden />
          Documentos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {faltando.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            Faltam obrigatórios: <strong>{faltando.map((t) => t.label).join(', ')}</strong>. A
            seguradora costuma pedir por eles; sem isso a análise volta.
          </p>
        )}

        <ul className="divide-y rounded-lg border">
          {tipos.map((t) => {
            const doTipo = (docs.data ?? []).filter((d) => d.tipo === t.id)
            return (
              <li key={t.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    {t.label}
                    {t.obrigatorio && <span className="ml-1 text-destructive">*</span>}
                  </span>
                  <label className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    <FileUp className="mr-1 inline h-3 w-3" aria-hidden />
                    {enviando === t.id ? 'Enviando…' : 'Anexar'}
                    <input
                      type="file"
                      className="hidden"
                      disabled={enviando !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void enviar(t.id, f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>
                {doTipo.map((d) => (
                  <p key={d.id} className="truncate text-xs text-muted-foreground">
                    {d.nome_arquivo ?? d.arquivo_url} · {new Date(d.enviado_em).toLocaleDateString('pt-BR')}
                  </p>
                ))}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export function AnaliseDetalhe({ id }: { id: string }) {
  const qc = useQueryClient()
  const [movendo, setMovendo] = React.useState(false)

  const { data, isPending, isError, error } = useQuery({
    queryKey: creditoKeys.analise(id),
    queryFn: () => buscarAnalise(id),
    // Análise no ar espera decisão da seguradora: o poll do worker a atualiza em
    // segundo plano, e sem refetch a tela ficaria mostrando "em análise" para sempre.
    refetchInterval: (q) =>
      ['enviada_seguradora', 'em_analise'].includes(q.state.data?.estagio ?? '') ? 30_000 : false,
  })

  async function mover(estagio: string) {
    setMovendo(true)
    const r = await moverAnaliseAction({ id, estagio })
    setMovendo(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Análise movida.')
    void qc.invalidateQueries({ queryKey: creditoKeys.analise(id) })
    void qc.invalidateQueries({ queryKey: creditoKeys.esteira() })
  }

  if (isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {isError && error instanceof Error ? error.message : 'Análise não encontrada.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const decidida = ehEstagioDecidido(data.estagio)
  const nome = data.razao_social ?? data.nome_fantasia ?? formatCnpj(data.cnpj)

  return (
    <div className="space-y-4">
      <VoltarContextual padrao={{ href: '/credito', label: 'Esteira' }} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{nome}</h1>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">{formatCnpj(data.cnpj)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{ESTAGIO_ANALISE_LABELS[data.estagio as EstagioAnalise] ?? data.estagio}</Badge>
          {!decidida && (
            <Select value="" onValueChange={(v) => void mover(v)} disabled={movendo}>
              <SelectTrigger className="w-44" aria-label="Mover análise">
                <SelectValue placeholder="Mover para…" />
              </SelectTrigger>
              <SelectContent>
                {ESTAGIOS_MANUAIS.filter((e) => e !== data.estagio).map((e) => (
                  <SelectItem key={e} value={e}>
                    {ESTAGIO_ANALISE_LABELS[e]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dados da análise</CardTitle>
            <CardDescription>O que a SEGURADORA disse. A nossa leitura fica abaixo.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Limite solicitado</dt>
                <dd className="text-sm tabular-nums">{moeda(data.limite_solicitado)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Limite aprovado (seguradora)</dt>
                <dd className="text-sm font-medium tabular-nums">{moeda(data.limite_aprovado)}</dd>
              </div>
              {/*
               * O limite OPERACIONAL fica ao lado do da seguradora, e não no lugar dele:
               * em "só nós aprovamos" existe operacional sem aprovado, e em "só a
               * seguradora" existe aprovado sem operacional. São duas verdades.
               */}
              <div>
                <dt className="text-xs text-muted-foreground">Limite operacional (nossa decisão)</dt>
                <dd className="text-sm font-medium tabular-nums">{moeda(data.limite_operacional)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Validade</dt>
                <dd className="text-sm">{data.expira_em ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Caso na seguradora</dt>
                <dd className="font-mono text-xs">{data.atradius_case_id ?? '—'}</dd>
              </div>
              {data.motivo && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Motivo</dt>
                  <dd className="text-sm">{data.motivo}</dd>
                </div>
              )}
              {data.empresa_id && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Empresa</dt>
                  <dd className="text-sm">
                    <Link href={`/empresas/${data.empresa_id}`} className="hover:underline">
                      Abrir a Company 360
                    </Link>
                  </dd>
                </div>
              )}
            </dl>

            {data.origem === 'atradius_backfill' && (
              <p className="mt-4 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                Esta análise veio do <strong>backfill da apólice</strong>: ela já existia na
                seguradora e não foi pedida por aqui. Fica marcada para o funil da esteira não
                levar crédito por uma decisão que ela não tomou.
              </p>
            )}
          </CardContent>
        </Card>

        <Docs analiseId={id} />
      </div>

      <PainelSacado analiseCreditoId={id} />
    </div>
  )
}
