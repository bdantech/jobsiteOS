'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Code2, Copy, Download, FileText, Printer } from 'lucide-react'
import { lerDocumentoFiscal } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { antecipacaoKeys, buscarXmlDaNota } from '../queries'
import { DocumentoFiscalView } from './documento-fiscal-view'

/**
 * A NF aberta como documento.
 *
 * O XML é buscado AQUI, quando o modal abre — nunca na consulta da lista. Um XML
 * de NFe tem dezenas a centenas de KB; trazê-lo junto dos 40 cards de uma coluna
 * do Kanban seria baixar megabytes para pintar cabeçalhos que nem o mostram.
 *
 * A aba "XML" existe porque o leitor não é perfeito: quando um campo não aparece
 * no documento desenhado, a pergunta seguinte é sempre "mas está no XML?". Ter a
 * resposta a um clique evita abrir o banco.
 */

export interface NotaModalProps {
  accessKey: string
  /** Cabeçalho enquanto o XML carrega — evita um modal em branco. */
  titulo: string
  subtitulo?: string
  aberto: boolean
  onOpenChange: (v: boolean) => void
}

function baixar(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

export function NotaModal({
  accessKey,
  titulo,
  subtitulo,
  aberto,
  onOpenChange,
  abasExtras = [],
  acoes,
  aba,
  onAbaChange,
}: NotaModalProps & {
  /**
   * Abas do funil (fornecedor, mensagens), NO MESMO NÍVEL de Documento e XML.
   *
   * Aninhar um segundo conjunto de abas dentro da aba "Documento" faria a pessoa
   * procurar em qual das duas barras está o que ela quer — e as quatro respondem
   * perguntas irmãs sobre a mesma nota.
   */
  abasExtras?: { id: string; label: string; conteudo: React.ReactNode }[]
  /** As ações da nota, que antes ficavam no card. */
  acoes?: React.ReactNode
  /**
   * A aba aberta, quando quem chamou precisa mandar nela.
   *
   * Ela era só `defaultValue`, e isso bastava enquanto ninguém navegava entre as
   * abas por dentro. Escolher o contato na aba "Fornecedor" e cair no compositor
   * com ele selecionado é exatamente isso: a decisão de qual aba mostrar passou a
   * ser do conteúdo, não só do clique na barra. Omitir os dois mantém o
   * comportamento não-controlado de antes.
   */
  aba?: string
  onAbaChange?: (aba: string) => void
}) {
  const [copiado, setCopiado] = React.useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: antecipacaoKeys.xml(accessKey),
    queryFn: () => buscarXmlDaNota(accessKey),
    enabled: aberto,
    // O XML de uma nota não muda depois de emitida. Refazer a busca ao reabrir o
    // modal seria baixar de novo o mesmo documento imutável.
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })

  const documento = React.useMemo(
    () => (data ? lerDocumentoFiscal(data.raw_xml) : null),
    [data],
  )

  async function copiar() {
    if (!data?.raw_xml) return
    await navigator.clipboard.writeText(data.raw_xml)
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0 print:max-h-none print:overflow-visible">
        <DialogHeader className="border-b px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{titulo}</span>
                {documento?.formato === 'nfe' ? <Badge variant="secondary">NFe</Badge> : null}
                {documento?.formato === 'nfse' ? <Badge variant="secondary">NFS-e</Badge> : null}
              </DialogTitle>
              {subtitulo ? (
                <p className="truncate text-xs text-muted-foreground">{subtitulo}</p>
              ) : null}
            </div>

            {data?.raw_xml ? (
              <div className="flex shrink-0 items-center gap-1 print:hidden">
                <Button variant="ghost" size="sm" onClick={() => void copiar()}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {copiado ? 'Copiado' : 'Copiar XML'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => baixar(`${accessKey}.xml`, data.raw_xml as string)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Baixar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Imprimir
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(92vh-5rem)] overflow-y-auto px-5 py-4">
          {isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Não foi possível carregar o XML.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : !documento ? null : (
            <Tabs value={aba} onValueChange={onAbaChange} defaultValue="documento">
              <TabsList className="mb-3 print:hidden">
                <TabsTrigger value="documento">
                  <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Documento
                </TabsTrigger>
                <TabsTrigger value="xml">
                  <Code2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  XML
                </TabsTrigger>
                {abasExtras.map((a) => (
                  <TabsTrigger key={a.id} value={a.id}>
                    {a.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="documento" className="mt-0">
                <DocumentoFiscalView doc={documento} />

                {data?.xml_parse_erro ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    O sync registrou um erro ao ler este XML: {data.xml_parse_erro}. O que está
                    desenhado acima pode estar incompleto — o XML bruto está na outra aba.
                  </p>
                ) : null}

                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  Representação para conferência interna. Não é o DANFE oficial nem substitui o
                  documento fiscal.
                </p>
              </TabsContent>

              <TabsContent value="xml" className="mt-0">
                <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed">
                  <code>{data?.raw_xml ?? '(sem XML)'}</code>
                </pre>
              </TabsContent>

              {abasExtras.map((a) => (
                <TabsContent key={a.id} value={a.id} className="mt-0">
                  {a.conteudo}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>

        {acoes ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3 print:hidden">
            {acoes}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
