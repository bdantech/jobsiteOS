'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileUp, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { ESTAGIOS_ANALISE, ESTAGIO_ANALISE_LABELS, type EstagioAnalise } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { EtapasDoFunil } from './etapas-funil'
import { pedirAnaliseDaVendaAction } from '@/actions/comercial'

/**
 * O crédito, visto de dentro do funil de vendas.
 *
 * ─── POR QUE O COMERCIAL VÊ ISTO ────────────────────────────────────────────
 * "Em análise de crédito" era uma coluna sem informação: o card entrava, parava, e a única
 * forma de saber o que estava acontecendo era perguntar para alguém do Crédito. A trilha
 * mostra a mesma esteira que o Crédito enxerga, em modo leitura — quem é dono do negócio
 * passa a responder sozinho "em que pé está".
 *
 * ─── E POR QUE ELE NÃO GANHOU O MÓDULO ──────────────────────────────────────
 * A visão vem de uma RLS estreita (migração 0129): a análise é visível porque está ligada a
 * uma venda que a pessoa é dona, e não porque ela virou usuária do Crédito. Esteira,
 * scorecard e configurações continuam fora — inclusive o interruptor da seguradora.
 *
 * ─── OS DOCUMENTOS VÃO DIRETO PARA A ANÁLISE ────────────────────────────────
 * O que se pede em "aguardando documentação" é exatamente o que o Crédito vai pedir:
 * balanço, DRE, contrato social. Subi-los aqui é subi-los LÁ — mesmo bucket, mesmo
 * checklist. Um repositório paralelo da venda faria os mesmos arquivos existirem em dois
 * lugares, e alguém teria de copiá-los adiante.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Só a trilha que o comercial precisa ler. Expirada e cancelada não são caminho. */
const TRILHA: readonly EstagioAnalise[] = ESTAGIOS_ANALISE.filter(
  (e) => e !== 'expirada' && e !== 'cancelada' && e !== 'rascunho',
) as EstagioAnalise[]

export interface AnaliseDaVenda {
  id: string
  estagio: string
  limite_solicitado: number | null
  limite_aprovado: number | null
  moeda: string | null
  motivo: string | null
  decidida_em: string | null
}

interface DocDaAnalise {
  id: string
  tipo: string
  nome_arquivo: string | null
  arquivo_url: string
  enviado_em: string
}

/** O catálogo real vive em `credito_config`, que o comercial não lê. Este é o essencial. */
const TIPOS = [
  { id: 'balanco_patrimonial', label: 'Balanço patrimonial' },
  { id: 'dre', label: 'DRE' },
  { id: 'faturamento_declarado', label: 'Faturamento declarado' },
  { id: 'contrato_social', label: 'Contrato social' },
  { id: 'outros', label: 'Outros' },
] as const

async function buscarDocs(analiseId: string): Promise<DocDaAnalise[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('analise_docs')
    .select('id, tipo, nome_arquivo, arquivo_url, enviado_em')
    .eq('analise_id', analiseId)
    .order('enviado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as DocDaAnalise[]
}

export function AbaCredito({
  vendaId,
  analise,
  onMudou,
}: {
  vendaId: string
  analise: AnaliseDaVenda | null
  onMudou: () => void
}) {
  const qc = useQueryClient()
  const [pedindo, setPedindo] = React.useState(false)

  if (!analise) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Nenhuma análise ligada a este negócio.</p>
          <p className="mt-1">
            Pedir a análise cria a ficha no Crédito, avisa o time e abre o espaço para os
            documentos — que ficam guardados na própria análise.
          </p>
        </div>
        <Button
          size="sm"
          disabled={pedindo}
          onClick={async () => {
            setPedindo(true)
            const r = await pedirAnaliseDaVendaAction({ venda_id: vendaId })
            setPedindo(false)
            if (!r.ok) {
              toast.error(r.message)
              return
            }
            toast.success('Análise pedida. O time de Crédito foi avisado.')
            onMudou()
          }}
        >
          {pedindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          Pedir análise de crédito
        </Button>
      </div>
    )
  }

  const negada = analise.estagio === 'negada'
  const aprovada = analise.estagio === 'aprovada' || analise.estagio === 'aprovada_parcial'

  return (
    <div className="space-y-4">
      <EtapasDoFunil
        etapas={TRILHA.map((e) => ({ id: e, label: ESTAGIO_ANALISE_LABELS[e] }))}
        atual={analise.estagio}
        somenteLeitura
      />

      {aprovada && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">
              {analise.limite_aprovado !== null
                ? `${BRL.format(Number(analise.limite_aprovado))} aprovados`
                : 'Aprovado'}
              {analise.estagio === 'aprovada_parcial' && (
                <Badge variant="secondary" className="ml-2 text-[10px]">parcial</Badge>
              )}
            </p>
            {analise.limite_solicitado !== null && (
              <p className="text-[0.8rem] text-muted-foreground">
                Pedido: {BRL.format(Number(analise.limite_solicitado))}
              </p>
            )}
          </div>
        </div>
      )}

      {negada && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Crédito negado pela seguradora.</p>
            <p className="text-[0.8rem] text-muted-foreground">
              O negócio não avança daqui — a única saída é marcar como perdido.
            </p>
          </div>
        </div>
      )}

      {analise.motivo && (
        <div className="rounded-lg border p-3">
          <p className="text-[11px] font-medium text-muted-foreground">O que a seguradora disse</p>
          <p className="mt-1 whitespace-pre-line text-[0.8rem] leading-snug">{analise.motivo}</p>
        </div>
      )}

      <Documentos analiseId={analise.id} onMudou={() => void qc.invalidateQueries()} />
    </div>
  )
}

function Documentos({ analiseId, onMudou }: { analiseId: string; onMudou: () => void }) {
  const docs = useQuery({
    queryKey: ['venda-analise-docs', analiseId],
    queryFn: () => buscarDocs(analiseId),
  })
  const [enviando, setEnviando] = React.useState<string | null>(null)

  const subir = useMutation({
    mutationFn: async ({ tipo, arquivo }: { tipo: string; arquivo: File }) => {
      const supabase = createClient()
      // O caminho começa pelo id da análise: é o que a policy de storage usa como âncora,
      // tanto a do Crédito quanto a nova, do comercial dono da venda.
      const caminho = `${analiseId}/${tipo}-${Date.now()}-${arquivo.name.replace(/[^\w.\-]/g, '_')}`
      const up = await supabase.storage.from('analise-docs').upload(caminho, arquivo)
      if (up.error) throw new Error(up.error.message)
      const { error } = await supabase.rpc('app_registrar_doc_analise', {
        p: { analise_id: analiseId, tipo, arquivo_url: caminho, nome_arquivo: arquivo.name },
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      toast.success('Documento enviado.')
      void docs.refetch()
      onMudou()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const porTipo = new Map<string, DocDaAnalise[]>()
  for (const d of docs.data ?? []) {
    const l = porTipo.get(d.tipo) ?? []
    l.push(d)
    porTipo.set(d.tipo, l)
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-muted-foreground">
        Documentos — vão direto para a análise do Crédito
      </p>
      {docs.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : (
        <div className="space-y-1.5">
          {TIPOS.map((t) => {
            const enviados = porTipo.get(t.id) ?? []
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <span className="min-w-32 flex-1 text-sm">{t.label}</span>
                {enviados.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {enviados.length} enviado{enviados.length > 1 ? 's' : ''}
                  </Badge>
                )}
                <label className="shrink-0">
                  <input
                    type="file"
                    className="hidden"
                    disabled={enviando !== null}
                    onChange={async (e) => {
                      const arquivo = e.target.files?.[0]
                      if (!arquivo) return
                      setEnviando(t.id)
                      await subir.mutateAsync({ tipo: t.id, arquivo }).catch(() => undefined)
                      setEnviando(null)
                      e.target.value = ''
                    }}
                  />
                  <span className="inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs transition-colors hover:bg-accent">
                    {enviando === t.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <FileUp className="mr-1 h-3.5 w-3.5" aria-hidden />
                    )}
                    Enviar
                  </span>
                </label>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[0.8rem] text-muted-foreground">
        Enviado é enviado: apagar documento é do Crédito, porque é prova de decisão. Se subiu
        errado, mande o certo e avise no card.
      </p>
    </div>
  )
}
