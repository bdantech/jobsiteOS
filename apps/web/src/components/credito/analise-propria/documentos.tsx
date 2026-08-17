'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileUp, ScanLine } from 'lucide-react'
import type { Tables } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { registrarDocAction } from '@/actions/credito'
import { createClient } from '@/lib/supabase/client'
import { buscarCreditoConfig, creditoKeys } from '../queries'
import { analisePropriaKeys } from './queries'

/**
 * O checklist de documentos.
 *
 * Duas colunas de exigência, e elas não são a mesma: **obrigatório** é o que a SEGURADORA
 * cobra; **essencial** é o que a NOSSA análise precisa para sair de pé. Um contrato social
 * é obrigatório e não tem número nenhum a extrair; uma relação de faturamento não é
 * obrigatória e vale mais para o cálculo que metade do resto.
 *
 * A análise roda com o que houver, sinalizando lacunas. Travar por documento faltando
 * produziria zero análises numa base onde ninguém manda balanço de dois exercícios de
 * primeira.
 */

interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
  essencial?: boolean
  extraivel?: boolean
}

/** Fallback só para o caso de `credito_config` estar vazia — o catálogo real vive lá. */
const TIPOS_FALLBACK: TipoDoc[] = [
  { id: 'balanco_patrimonial', label: 'Balanço patrimonial', obrigatorio: true, essencial: true, extraivel: true },
  { id: 'dre', label: 'DRE', obrigatorio: true, essencial: true, extraivel: true },
  { id: 'contrato_social', label: 'Contrato social', obrigatorio: true, essencial: false, extraivel: false },
  { id: 'outros', label: 'Outros', obrigatorio: false, essencial: false, extraivel: false },
]

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

export function Documentos({
  analiseId,
  docs,
}: {
  analiseId: string
  docs: Tables<'analise_docs'>[]
}) {
  const qc = useQueryClient()
  const [enviando, setEnviando] = React.useState<string | null>(null)
  const config = useQuery({ queryKey: creditoKeys.config(), queryFn: buscarCreditoConfig })

  const doCatalogo = (config.data?.docs as { tipos?: TipoDoc[] } | undefined)?.tipos ?? []
  const tipos = doCatalogo.length > 0 ? doCatalogo : TIPOS_FALLBACK

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
      void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseId) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.')
    } finally {
      setEnviando(null)
    }
  }

  const enviados = new Set(docs.map((d) => d.tipo))
  const faltamObrigatorios = tipos.filter((t) => t.obrigatorio && !enviados.has(t.id))
  const faltamEssenciais = tipos.filter((t) => t.essencial && !enviados.has(t.id))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Documentos</CardTitle>
        <CardDescription>
          Os marcados com <ScanLine className="inline size-3" aria-hidden /> vão ao modelo na
          extração. Certidão e contrato social não vão — não têm número a extrair.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {faltamEssenciais.length > 0 && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            A <strong>nossa</strong> análise precisa de{' '}
            <strong>{faltamEssenciais.map((t) => t.label).join(', ')}</strong>. Ela roda sem eles,
            mas quase tudo vira lacuna.
          </p>
        )}
        {faltamObrigatorios.length > 0 && (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            A <strong>seguradora</strong> costuma pedir por{' '}
            <strong>{faltamObrigatorios.map((t) => t.label).join(', ')}</strong>.
          </p>
        )}

        <ul className="divide-y rounded-lg border">
          {tipos.map((t) => {
            const doTipo = docs.filter((d) => d.tipo === t.id)
            return (
              <li key={t.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="truncate">{t.label}</span>
                    {t.extraivel ? (
                      <ScanLine className="size-3 shrink-0 text-muted-foreground" aria-label="Vai ao modelo" />
                    ) : null}
                    {t.essencial ? (
                      <Badge variant="secondary" className="text-[10px]">
                        essencial
                      </Badge>
                    ) : null}
                    {t.obrigatorio ? <span className="text-destructive">*</span> : null}
                  </span>
                  <label className="shrink-0 cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
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
                    {d.nome_arquivo ?? d.arquivo_url} ·{' '}
                    {new Date(d.enviado_em).toLocaleDateString('pt-BR')}
                    {d.extraido_em ? ' · já lido pela extração' : ''}
                  </p>
                ))}
              </li>
            )
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> obrigatório para a seguradora.
        </p>
      </CardContent>
    </Card>
  )
}
