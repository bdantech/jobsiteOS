'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Bookmark, Loader2 } from 'lucide-react'
import { criarSegmentoSchema, descrever, type Grupo } from '@jobsiteos/core'
import { criarSegmentoAction } from '@/actions/mercado'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { STATUS_SUPERFICIE, STATUS_TEXTO } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatNumero } from './format'
import { contarExato, mercadoKeys } from './queries'

/**
 * "Salvar como segmento": persiste a ÁRVORE, não a seleção.
 *
 * Um segmento é um filtro nomeado — as Cadências vão reavaliá-lo no futuro, e o
 * que ele devolver naquele dia é o que vale. Salvar uma lista de CNPJs seria uma
 * foto: a construtora que entrar no SOM amanhã ficaria de fora para sempre.
 *
 * Por isso a busca por texto (razão social) NÃO entra: `razao_social` não é uma
 * variável do catálogo, logo não é filtrável pelo engine, logo não existe em um
 * segmento. Quando há termo digitado, o diálogo diz isso em vez de salvar algo
 * diferente do que a pessoa está vendo.
 */
export function SalvarSegmentoDialog({
  arvore,
  termo,
  aberto,
  onOpenChange,
}: {
  arvore: Grupo
  termo: string
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [nome, setNome] = React.useState('')
  const [descricao, setDescricao] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  // A contagem do segmento é EXATA (full scan) e roda uma vez, ao abrir: é o
  // número que o time vai usar para dimensionar uma cadência.
  const contagem = useQuery({
    queryKey: mercadoKeys.contagem(arvore, ''),
    queryFn: () => contarExato('', arvore),
    enabled: aberto,
    staleTime: 60_000,
  })

  async function salvar() {
    setErro(null)

    const payload = { nome: nome.trim(), descricao: descricao.trim() || null, definicao: arvore }
    const parsed = criarSegmentoSchema.safeParse(payload)
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? 'Dados inválidos.')
      return
    }

    setSalvando(true)
    const resultado = await criarSegmentoAction(payload)
    setSalvando(false)

    if (!resultado.ok) {
      setErro(resultado.message)
      return
    }

    await queryClient.invalidateQueries({ queryKey: mercadoKeys.segmentos() })
    onOpenChange(false)
    setNome('')
    setDescricao('')

    toast.success('Segmento criado.', {
      description: resultado.data.nome,
      action: {
        label: 'Abrir',
        onClick: () => router.push(`/mercado/segmentos/${resultado.data.id}`),
      },
    })
  }

  function fechar(proximo: boolean) {
    if (salvando) return
    if (!proximo) setErro(null)
    onOpenChange(proximo)
  }

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Salvar como segmento</DialogTitle>
          <DialogDescription>
            Um segmento é um filtro vivo: sempre que for consultado, ele é reavaliado sobre o
            universo. As Cadências vão consumir isso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="segmento-nome">Nome</Label>
            <Input
              id="segmento-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Incorporadoras SOM em SP com obra ativa"
              maxLength={120}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="segmento-descricao">Descrição</Label>
            <Textarea
              id="segmento-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Opcional: por que este recorte existe."
              maxLength={500}
              rows={2}
            />
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Regra
            </p>
            <p className="text-sm leading-relaxed">{descrever(arvore)}</p>
            <p className="pt-1 text-sm">
              {contagem.isPending ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Contando empresas…
                </span>
              ) : contagem.isError ? (
                <span className="text-destructive">Não foi possível contar agora.</span>
              ) : (
                <span>
                  <strong className="tabular-nums">{formatNumero(contagem.data)}</strong>{' '}
                  {contagem.data === 1 ? 'empresa' : 'empresas'} hoje.
                </span>
              )}
            </p>
          </div>

          {termo.trim().length > 0 && (
            <div className={cn('flex gap-2 rounded-md border p-3 text-xs', STATUS_SUPERFICIE.warning)}>
              <AlertTriangle className={cn('h-4 w-4 shrink-0', STATUS_TEXTO.warning)} aria-hidden />
              <p>
                A busca por texto (<span className="font-medium">{termo.trim()}</span>) não entra no
                segmento — razão social não é uma variável do catálogo de filtros. O segmento salva
                apenas a regra acima.
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => fechar(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando || nome.trim().length === 0}>
            {salvando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Bookmark className="mr-2 h-4 w-4" />
            )}
            Criar segmento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
