'use client'

import * as React from 'react'
import { Check, Eraser } from 'lucide-react'
import { descrever, type Grupo } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { grupoPadrao, problemasDaArvore } from '../piramide/arvore'
import { ConstrutorRegra } from '../piramide/construtor-regra'

/**
 * O construtor de regras da Pirâmide, em um diálogo, sobre um rascunho.
 *
 * O construtor é DELIBERADAMENTE o mesmo componente (`ConstrutorRegra`, §5.1):
 * regra de camada, filtro do Explorador e segmento são a MESMA árvore, com o
 * mesmo catálogo e a mesma validação. Duas UIs para o mesmo JSON divergiriam —
 * uma ofereceria um operador que a outra não, e o bug apareceria só no save.
 *
 * A árvore só chega na URL (e portanto na query) quando alguém clica em
 * "Aplicar": editar um filtro passa por estados intermediários inválidos
 * ("capital social > ⟨vazio⟩"), e disparar uma query por tecla contra uma view de
 * 2M linhas seria caro e inútil. `problemasDaArvore` roda o mesmo zod que o
 * servidor — o que passa daqui não falha depois.
 */
export function FiltroDialog({
  arvore,
  aberto,
  onOpenChange,
  onAplicar,
  onLimpar,
}: {
  arvore: Grupo | null
  aberto: boolean
  onOpenChange: (aberto: boolean) => void
  onAplicar: (arvore: Grupo) => void
  onLimpar: () => void
}) {
  const [rascunho, setRascunho] = React.useState<Grupo>(() => arvore ?? grupoPadrao())
  const [problemas, setProblemas] = React.useState<string[]>([])

  // Reabrir o diálogo sempre parte do filtro que está VALENDO, nunca do rascunho
  // abandonado da última vez.
  React.useEffect(() => {
    if (aberto) {
      setRascunho(arvore ?? grupoPadrao())
      setProblemas([])
    }
  }, [aberto, arvore])

  function aplicar() {
    const encontrados = problemasDaArvore(rascunho)
    if (encontrados.length > 0) {
      setProblemas(encontrados)
      return
    }
    setProblemas([])
    onAplicar(rascunho)
    onOpenChange(false)
  }

  const previa = React.useMemo(() => {
    try {
      return descrever(rascunho)
    } catch {
      return null
    }
  }, [rascunho])

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Filtros</DialogTitle>
          <DialogDescription>
            Combine condições em grupos E/OU. As variáveis são as do catálogo do Mercado — as mesmas
            que definem as camadas da pirâmide e os segmentos.
          </DialogDescription>
        </DialogHeader>

        <ConstrutorRegra arvore={rascunho} onChange={setRascunho} />

        {previa && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prévia
            </p>
            <p className="pt-1 text-sm leading-relaxed">{previa}</p>
          </div>
        )}

        {problemas.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive">
            {problemas.map((problema) => (
              <li key={problema}>{problema}</li>
            ))}
          </ul>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onLimpar()
              onOpenChange(false)
            }}
            disabled={!arvore}
          >
            <Eraser className="mr-2 h-4 w-4" />
            Limpar filtro
          </Button>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={aplicar}>
              <Check className="mr-2 h-4 w-4" />
              Aplicar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
