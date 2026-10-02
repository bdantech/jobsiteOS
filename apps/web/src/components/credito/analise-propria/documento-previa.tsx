'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, ExternalLink, FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { baixarDocAnalise, previaDocAnalise } from '../queries'

export interface DocParaVer {
  id: string
  arquivo_url: string
  nome_arquivo: string | null
  rotulo: string
}

const IMAGEM = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const PDF = /\.pdf$/i

/**
 * O documento aberto DENTRO da plataforma.
 *
 * Antes cada clique baixava o arquivo: para conferir um balanço o analista enchia a pasta
 * de downloads com PDFs de nome interno e abria um por um fora daqui. Agora o clique
 * exibe; baixar é escolha, no rodapé.
 *
 * O formato vem da extensão do nome. PDF abre no leitor do próprio navegador (iframe) e
 * imagem em <img>; planilha e Word não têm leitor no navegador, e para eles o modal diz
 * isso e oferece o download em vez de mostrar uma moldura vazia.
 *
 * Documento que chegou pela API e o worker ainda não trouxe para o bucket tem URL
 * externa no lugar do caminho — não há o que assinar, e o modal diz isso.
 */
export function DocumentoPrevia({ doc, onFechar }: { doc: DocParaVer | null; onFechar: () => void }) {
  const caminho = doc?.arquivo_url ?? null
  const externo = caminho ? /^https?:\/\//i.test(caminho) : false
  const nome = doc?.nome_arquivo ?? caminho?.split('/').pop() ?? ''
  const ref = nome || caminho || ''
  const tipo = PDF.test(ref) ? 'pdf' : IMAGEM.test(ref) ? 'imagem' : 'outro'

  const url = useQuery({
    queryKey: ['credito', 'doc-previa', caminho],
    queryFn: () => previaDocAnalise(caminho as string),
    enabled: Boolean(caminho) && !externo,
    // A assinatura dura 5 min; reaproveitar por 4 evita um iframe com link vencido.
    staleTime: 4 * 60_000,
    gcTime: 4 * 60_000,
  })

  const [baixando, setBaixando] = React.useState(false)
  async function baixar() {
    if (!doc) return
    setBaixando(true)
    try {
      const link = await baixarDocAnalise(doc.arquivo_url, doc.nome_arquivo)
      window.open(link, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível baixar o documento.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <Dialog open={doc !== null} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="flex max-h-[95vh] max-w-5xl flex-col">
        {doc ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{nome || doc.rotulo}</DialogTitle>
              <DialogDescription>{doc.rotulo}</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1">
              {externo ? (
                <Aviso>
                  Este arquivo chegou pela API e ainda está sendo trazido da origem. Ele aparece
                  aqui assim que o download terminar.
                </Aviso>
              ) : url.isPending ? (
                <Skeleton className="h-[70vh] w-full" />
              ) : url.isError || !url.data ? (
                <Aviso>Não foi possível gerar o link do arquivo. Confira se ele ainda existe.</Aviso>
              ) : tipo === 'pdf' ? (
                <iframe src={url.data} title={nome} className="h-[70vh] w-full rounded-md border" />
              ) : tipo === 'imagem' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url.data}
                  alt={nome}
                  className="max-h-[70vh] w-full rounded-md border object-contain"
                />
              ) : (
                <Aviso>
                  Este formato não abre no navegador. Baixe o arquivo para ver o conteúdo.
                </Aviso>
              )}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {url.data && !externo ? (
                <Button asChild variant="ghost" size="sm">
                  <a href={url.data} target="_blank" rel="noopener noreferrer">
                    Abrir em outra aba <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
                  </a>
                </Button>
              ) : (
                <span />
              )}
              <Button size="sm" onClick={() => void baixar()} disabled={baixando || externo}>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                {baixando ? 'Preparando…' : 'Baixar'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      <FileQuestion className="h-6 w-6" aria-hidden />
      <p className="max-w-md">{children}</p>
    </div>
  )
}
