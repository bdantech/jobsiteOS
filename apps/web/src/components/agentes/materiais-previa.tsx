'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { TIPO_MATERIAL_LABELS, type TipoMaterial } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { gestaoAgentesKeys, urlAssinadaMaterial, type Material } from './queries-gestao'

/**
 * A PRÉ-VISUALIZAÇÃO de um material — exatamente o que o cliente vai receber. Arquivo do
 * bucket privado abre por URL assinada de 10 minutos (nunca por link público: o bucket é
 * privado de propósito, e o worker gera a URL dele na hora de mandar). Texto aparece
 * inteiro, com as quebras de linha que vão na mensagem.
 */
export function MaterialPrevia({ material, onFechar }: { material: Material | null; onFechar: () => void }) {
  const caminho = material?.arquivo_path ?? null
  const url = useQuery({
    queryKey: [...gestaoAgentesKeys.all, 'material-url', caminho],
    queryFn: () => urlAssinadaMaterial(caminho as string),
    enabled: Boolean(caminho),
    staleTime: 5 * 60_000,
  })
  const alvo = caminho ? url.data : material?.url

  return (
    <Dialog open={material !== null} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {material ? (
          <>
            <DialogHeader>
              <DialogTitle>{material.nome}</DialogTitle>
              <DialogDescription>
                {TIPO_MATERIAL_LABELS[material.tipo as TipoMaterial] ?? material.tipo} · {material.descricao}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quando usar</p>
              <p className="mt-1">{material.quando_usar}</p>
            </div>

            {material.tipo === 'texto' ? (
              <div className="whitespace-pre-wrap rounded-md border p-3 text-sm">{material.corpo}</div>
            ) : caminho && url.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : !alvo ? (
              <p className="text-sm text-destructive">
                Não foi possível gerar o link do arquivo. Confira se ele ainda existe no bucket.
              </p>
            ) : material.tipo === 'imagem' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={alvo}
                alt={material.nome}
                className="max-h-[60vh] w-full rounded-md border object-contain"
              />
            ) : material.tipo === 'video' ? (
              <video src={alvo} controls className="max-h-[60vh] w-full rounded-md border" />
            ) : material.tipo === 'pdf' ? (
              <iframe src={alvo} title={material.nome} className="h-[60vh] w-full rounded-md border" />
            ) : null}

            {alvo && material.tipo !== 'texto' ? (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <a href={alvo} target="_blank" rel="noopener noreferrer">
                  Abrir em outra aba <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
                </a>
              </Button>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
