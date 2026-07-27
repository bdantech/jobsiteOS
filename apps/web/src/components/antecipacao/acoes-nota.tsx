'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Ban, ExternalLink, Layers, MoreHorizontal } from 'lucide-react'
import {
  ESTAGIOS_ABERTOS,
  ESTAGIOS_ENCERRADOS,
  ESTAGIO_FUNIL_LABELS,
  type EstagioFunil,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { marcarSemInteresseAction, moverEstagioAction } from '@/actions/antecipacao'
import { antecipacaoKeys, type NotaFunil } from './queries'

/**
 * As ações do card (§5). Duas delas pedem TEXTO obrigatório, e isso não é
 * burocracia:
 *
 *   "perdida" sem motivo joga fora a única informação que torna a métrica por
 *   faixa acionável — sem ela, "a faixa boa converte 4%" não sugere o que mudar.
 *
 *   "sem interesse" sem motivo e sem prazo é uma decisão irreversível tomada por
 *   um clique. O diálogo obriga a escolher entre 90 dias e ETERNA porque as duas
 *   coisas são diferentes: uma é "não agora", a outra é LGPD.
 */

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
}

// ─── Mover estágio ──────────────────────────────────────────────────────────

export function MoverEstagioDialog({
  nota,
  destino,
  aberto,
  onOpenChange,
}: {
  nota: NotaFunil
  destino: EstagioFunil
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const pedeMotivo = destino === 'perdida'

  async function confirmar() {
    if (pedeMotivo && motivo.trim() === '') return
    setSalvando(true)
    const r = await moverEstagioAction({
      access_key: nota.access_key,
      estagio_funil: destino,
      perda_motivo: pedeMotivo ? motivo.trim() : undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Nota movida para ${ESTAGIO_FUNIL_LABELS[destino]}.`)
    setMotivo('')
    onOpenChange(false)
    invalidar(qc)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para {ESTAGIO_FUNIL_LABELS[destino]}</DialogTitle>
          <DialogDescription>
            Nota {nota.numero ?? nota.access_key} de{' '}
            {nota.fornecedor_nome ?? nota.fornecedor_cnpj}.
          </DialogDescription>
        </DialogHeader>

        {pedeMotivo && (
          <div className="space-y-2">
            <Label htmlFor="perda-motivo">Motivo da perda</Label>
            <Textarea
              id="perda-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: já antecipou com outro fundo; taxa fora do aceitável; sacado recusou cessão."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Obrigatório. É o que permite regular os critérios de faixa com dados em vez de
              impressão.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={salvando || (pedeMotivo && motivo.trim() === '')}>
            {salvando ? 'Movendo…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sem interesse ──────────────────────────────────────────────────────────

export function SemInteresseDialog({
  cnpj,
  nome,
  aberto,
  onOpenChange,
}: {
  cnpj: string
  nome: string | null
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [eterna, setEterna] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  async function confirmar() {
    if (motivo.trim() === '') return
    setSalvando(true)
    const r = await marcarSemInteresseAction({
      fornecedor_cnpj: cnpj,
      motivo: motivo.trim(),
      eterna,
      dias: 90,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(
      eterna
        ? 'Fornecedor suprimido permanentemente.'
        : 'Fornecedor suprimido por 90 dias — depois volta a ser elegível.',
    )
    setMotivo('')
    setEterna(false)
    onOpenChange(false)
    invalidar(qc)
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar sem interesse</DialogTitle>
          <DialogDescription>
            {nome ?? cnpj}. Todas as notas vivas dele saem das faixas na hora, e nenhum canal
            poderá tocá-lo enquanto a supressão valer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant={eterna ? 'outline' : 'default'}
              onClick={() => setEterna(false)}
              aria-pressed={!eterna}
              className="h-auto flex-col items-start gap-1 py-3 text-left"
            >
              <span className="font-medium">90 dias</span>
              <span className="text-xs font-normal opacity-80">
                &quot;Sem interesse agora&quot;. Expira e ele volta ao funil.
              </span>
            </Button>
            <Button
              type="button"
              variant={eterna ? 'default' : 'outline'}
              onClick={() => setEterna(true)}
              aria-pressed={eterna}
              className="h-auto flex-col items-start gap-1 py-3 text-left"
            >
              <span className="font-medium">Eterna</span>
              <span className="text-xs font-normal opacity-80">
                LGPD, ou quem nunca vai antecipar. Não expira.
              </span>
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sem-interesse-motivo">Motivo</Label>
            <Textarea
              id="sem-interesse-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: pediu para não ser contatado; política da matriz proíbe antecipação."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmar()}
            disabled={salvando || motivo.trim() === ''}
          >
            {salvando ? 'Suprimindo…' : eterna ? 'Suprimir para sempre' : 'Suprimir por 90 dias'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── O menu do card ─────────────────────────────────────────────────────────

export function MenuAcoesNota({ nota }: { nota: NotaFunil }) {
  const [destino, setDestino] = React.useState<EstagioFunil | null>(null)
  const [semInteresse, setSemInteresse] = React.useState(false)

  const estagios: readonly EstagioFunil[] = [...ESTAGIOS_ABERTOS, ...ESTAGIOS_ENCERRADOS].filter(
    (e) => e !== nota.estagio_funil && e !== 'expirada',
  )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Ações da nota">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Mover para</DropdownMenuLabel>
          {estagios.map((e) => (
            <DropdownMenuItem key={e} onSelect={() => setDestino(e)}>
              <ArrowRight className="mr-2 h-4 w-4" />
              {ESTAGIO_FUNIL_LABELS[e]}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <Link href={`/antecipacao/fornecedores/${nota.fornecedor_cnpj}`}>
              <Layers className="mr-2 h-4 w-4" />
              Ver notas do fornecedor
            </Link>
          </DropdownMenuItem>

          {nota.fornecedor_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${nota.fornecedor_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do fornecedor
              </Link>
            </DropdownMenuItem>
          )}
          {nota.sacado_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${nota.sacado_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do sacado
              </Link>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => setSemInteresse(true)} className="text-destructive">
            <Ban className="mr-2 h-4 w-4" />
            Fornecedor sem interesse
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {destino && (
        <MoverEstagioDialog
          nota={nota}
          destino={destino}
          aberto
          onOpenChange={(v) => !v && setDestino(null)}
        />
      )}
      {nota.fornecedor_cnpj && (
        <SemInteresseDialog
          cnpj={nota.fornecedor_cnpj}
          nome={nota.fornecedor_nome}
          aberto={semInteresse}
          onOpenChange={setSemInteresse}
        />
      )}
    </>
  )
}
