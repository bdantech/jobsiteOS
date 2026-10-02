'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Eye, FileUp, ScanLine, Send } from 'lucide-react'
import { DOCS_SUBSTITUEM, docsCobertos, type Tables, type TipoDocContabil } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { registrarDocAction } from '@/actions/credito'
import { createClient } from '@/lib/supabase/client'
import { buscarCreditoConfig, creditoKeys } from '../queries'
import { DocumentoPrevia, type DocParaVer } from './documento-previa'
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
 *
 * O OBRIGATÓRIO FICA EM DESTAQUE, com a alternativa escrita: as demonstrações
 * financeiras (DF) OU balanço + DRE (0282). Quem substitui o quê vem do catálogo
 * (`substitui`), com `DOCS_SUBSTITUEM` do core como reserva. O resto vem abaixo, sem
 * destaque — ajuda, mas não segura a análise.
 */

interface TipoDoc {
  id: string
  label: string
  obrigatorio: boolean
  essencial?: boolean
  extraivel?: boolean
  /** Tipos que este documento cobre sozinho — a DF cobre balanço e DRE. */
  substitui?: string[]
}

function substituidos(t: TipoDoc): readonly string[] {
  return t.substitui ?? DOCS_SUBSTITUEM[t.id as TipoDocContabil] ?? []
}

/** Fallback só para o caso de `credito_config` estar vazia — o catálogo real vive lá. */
const TIPOS_FALLBACK: TipoDoc[] = [
  { id: 'demonstracoes_financeiras', label: 'Demonstrações financeiras (DF)', obrigatorio: false, essencial: false, extraivel: true },
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

  // O que os anexos cobrem: o próprio tipo e o que ele substitui (a DF vale pelo par).
  const cobertos = docsCobertos(docs.map((d) => d.tipo))
  for (const t of tipos) {
    if (cobertos.has(t.id)) for (const x of substituidos(t)) cobertos.add(x)
  }

  const obrigatorios = tipos.filter((t) => t.obrigatorio)
  const idsObrigatorios = new Set(obrigatorios.map((t) => t.id))
  // Só conta como alternativa o que cobre o obrigatório INTEIRO, não metade dele.
  const alternativas = tipos.filter((t) => {
    const s = substituidos(t)
    return !t.obrigatorio && s.length > 0 && obrigatorios.every((o) => s.includes(o.id))
  })
  const noDestaque = new Set([...idsObrigatorios, ...alternativas.map((t) => t.id)])
  const opcionais = tipos.filter((t) => !noDestaque.has(t.id))

  const faltamObrigatorios = obrigatorios.filter((t) => !cobertos.has(t.id))
  const faltamEssenciais = tipos.filter((t) => t.essencial && !cobertos.has(t.id))
  const obrigatorioCompleto = obrigatorios.length > 0 && faltamObrigatorios.length === 0

  /*
   * Clicar no documento EXIBE, não baixa. A URL é assinada quando o modal abre, e não
   * no render: assinar a lista inteira ao abrir a aba geraria uma URL válida por
   * documento que ninguém pediu. Baixar virou botão do modal.
   */
  const [vendo, setVendo] = React.useState<DocParaVer | null>(null)

  const linhaTipo = (t: TipoDoc) => {
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
          <div key={d.id} className="space-y-0.5">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                onClick={() =>
                  setVendo({ id: d.id, arquivo_url: d.arquivo_url, nome_arquivo: d.nome_arquivo, rotulo: t.label })
                }
              >
                {d.nome_arquivo ?? d.arquivo_url} ·{' '}
                {new Date(d.enviado_em).toLocaleDateString('pt-BR')}
                {d.extraido_em ? ' · já lido pela extração' : ''}
              </button>
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  setVendo({ id: d.id, arquivo_url: d.arquivo_url, nome_arquivo: d.nome_arquivo, rotulo: t.label })
                }
              >
                <Eye className="mr-1 inline size-3" aria-hidden />
                Ver
              </button>
            </div>
            {/*
             * O que foi À SEGURADORA, por documento.
             *
             * A escolha acontece no diálogo de envio e some com ele; sem esta
             * linha, "quais documentos ela recebeu?" só teria resposta no log do
             * worker — e é a primeira pergunta de quem abre um chamado.
             */}
            {d.enviado_seguradora_em ? (
              <p className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-500">
                <Send className="size-3" aria-hidden />
                enviado à seguradora em{' '}
                {new Date(d.enviado_seguradora_em).toLocaleDateString('pt-BR')}
              </p>
            ) : d.envio_seguradora_erro ? (
              <p className="flex items-start gap-1 text-[11px] text-destructive">
                <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                a seguradora não recebeu: {d.envio_seguradora_erro}
              </p>
            ) : null}
          </div>
        ))}
      </li>
    )
  }

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
        {obrigatorios.length > 0 ? (
          <div
            className={
              obrigatorioCompleto
                ? 'space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3'
                : 'space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3'
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Obrigatório{alternativas.length > 0 ? ' — envie um dos dois' : ''}
              </p>
              {obrigatorioCompleto ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Completo
                </span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">Pendente</span>
              )}
            </div>
            {alternativas.length > 0 ? (
              <>
                <ul className="divide-y rounded-lg border bg-background">{alternativas.map(linhaTipo)}</ul>
                <p className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  ou
                </p>
              </>
            ) : null}
            <ul className="divide-y rounded-lg border bg-background">{obrigatorios.map(linhaTipo)}</ul>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Outros documentos (opcionais)</p>
          <ul className="divide-y rounded-lg border">{opcionais.map(linhaTipo)}</ul>
        </div>

        <DocumentoPrevia doc={vendo} onFechar={() => setVendo(null)} />
      </CardContent>
    </Card>
  )
}
