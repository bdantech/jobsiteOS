'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, FileText, ShieldAlert } from 'lucide-react'
import {
  AVISO_APOLICE_COBRANCA,
  COBRANCA_ESTAGIO_LABELS,
  COBRANCA_ESTAGIOS_ENCERRADOS,
  COBRANCA_ESTAGIOS_MOVIVEIS,
  type CobrancaEstagio,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { aceitarAvisoApoliceAction, moverCobrancaAction } from '@/actions/cobranca'
import { abrirArquivoCobranca, buscarConfigCobranca, cobrancaKeys } from './queries'

/**
 * Peças que o kanban e o detalhe da cobrança dividem: o menu de estágio, o aviso da
 * apólice, o link de arquivo assinado e o campo rotulado do cabeçalho.
 */

export function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

/** Abre o arquivo do bucket privado com URL assinada de 5 minutos, no clique. */
export function ArquivoLink({ caminho, children }: { caminho: string | null | undefined; children: React.ReactNode }) {
  if (!caminho) return null
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto p-0 text-xs"
      onClick={() => {
        abrirArquivoCobranca(caminho).catch((e: Error) => toast.error(e.message))
      }}
    >
      <FileText className="mr-1 h-3.5 w-3.5" aria-hidden />
      {children}
    </Button>
  )
}

/** Máscara CNJ enquanto se digita: 0000000-00.0000.0.00.0000. */
export function mascaraCnj(entrada: string): string {
  const d = entrada.replace(/\D/g, '').slice(0, 20)
  const partes: [number, number, string][] = [
    [0, 7, ''],
    [7, 9, '-'],
    [9, 13, '.'],
    [13, 14, '.'],
    [14, 16, '.'],
    [16, 20, '.'],
  ]
  let out = ''
  for (const [ini, fim, sep] of partes) {
    if (d.length <= ini) break
    out += sep + d.slice(ini, fim)
  }
  return out
}

// ─── Mover estágio ──────────────────────────────────────────────────────────

/**
 * Para onde esta cobrança pode ir AGORA. A lista do core é o teto (os estágios que são
 * consequência de um ato não se movem à mão); aqui ela é estreitada pelas mesmas regras
 * que o RPC aplica, para não oferecer um botão que só serviria para receber uma recusa.
 */
export function destinosPossiveis(estagio: string, qtdAtivos: number): CobrancaEstagio[] {
  if ((COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(estagio)) return []
  return COBRANCA_ESTAGIOS_MOVIVEIS.filter((d) => {
    if (d === estagio) return false
    if (d === 'em_negociacao') return estagio !== 'rascunho'
    if (d === 'acordo_em_cumprimento') return estagio === 'acordo_firmado'
    if (d === 'quitada') return qtdAtivos === 0
    if (d === 'cancelada') return estagio === 'rascunho'
    if (d === 'encerrada_perda') return estagio !== 'rascunho'
    return true
  })
}

export function MoverEstagioMenu({
  cobrancaId,
  estagio,
  qtdAtivos,
  tamanho = 'sm',
  onMovido,
}: {
  cobrancaId: string
  estagio: string
  qtdAtivos: number
  tamanho?: 'sm' | 'xs'
  onMovido?: () => void
}) {
  const qc = useQueryClient()
  const [agindo, setAgindo] = React.useState(false)
  const [perdendo, setPerdendo] = React.useState(false)
  const destinos = destinosPossiveis(estagio, qtdAtivos)

  async function mover(para: CobrancaEstagio, motivo?: string) {
    setAgindo(true)
    const r = await moverCobrancaAction({ cobranca_id: cobrancaId, estagio: para, motivo })
    setAgindo(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(`Movida para ${COBRANCA_ESTAGIO_LABELS[para]}.`)
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
    onMovido?.()
    return true
  }

  if (destinos.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={agindo}
            className={tamanho === 'xs' ? 'h-7 px-2 text-xs' : undefined}
          >
            Mover
            <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Mover para</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {destinos.map((d) => (
            <DropdownMenuItem
              key={d}
              onSelect={() => {
                if (d === 'encerrada_perda') setPerdendo(true)
                else void mover(d)
              }}
            >
              {COBRANCA_ESTAGIO_LABELS[d]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <EncerrarComPerdaDialog
        aberto={perdendo}
        onOpenChange={setPerdendo}
        ocupado={agindo}
        onConfirmar={async (motivo) => {
          if (await mover('encerrada_perda', motivo)) setPerdendo(false)
        }}
      />
    </>
  )
}

function EncerrarComPerdaDialog({
  aberto,
  onOpenChange,
  ocupado,
  onConfirmar,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  ocupado: boolean
  onConfirmar: (motivo: string) => void
}) {
  const config = useQuery({ queryKey: cobrancaKeys.config(), queryFn: buscarConfigCobranca, enabled: aberto })
  const motivos = config.data?.cobranca.motivos_encerramento ?? []
  const [escolhido, setEscolhido] = React.useState('')
  const [livre, setLivre] = React.useState('')
  const outro = escolhido === '__outro' || motivos.length === 0
  const motivo = (outro ? livre : escolhido).trim()

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar com perda</DialogTitle>
          <DialogDescription>
            O motivo vai para o histórico da cobrança e para o dossiê. Encerrar não regulariza o
            sacado nem fecha o relógio da apólice.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {motivos.length > 0 ? (
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Select value={escolhido} onValueChange={setEscolhido}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {motivos.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                  <SelectItem value="__outro">Outro (descrever)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {outro ? (
            <div className="space-y-1">
              <Label htmlFor="motivo-livre">Descreva o motivo</Label>
              <Input id="motivo-livre" value={livre} onChange={(e) => setLivre(e.target.value)} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button variant="destructive" disabled={!motivo || ocupado} onClick={() => onConfirmar(motivo)}>
            Encerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── §6.4 O aviso da apólice ────────────────────────────────────────────────

/**
 * O texto do §6.4, com aceite explícito. Aparece antes do PRIMEIRO envio (o RPC de
 * envio recusa sem o aceite gravado) e pode ser aceito já na confirmação da cobrança.
 * O texto vem do core — é o mesmo que vai para o audit_log junto de quem aceitou.
 */
export function TextoAvisoApolice() {
  const [titulo, ...resto] = AVISO_APOLICE_COBRANCA.split('. ')
  return (
    <div className="rounded-md border border-amber-600/30 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <ShieldAlert className="h-4 w-4" aria-hidden />
        {titulo}.
      </p>
      <p className="leading-relaxed">{resto.join('. ')}</p>
    </div>
  )
}

export function AvisoApoliceDialog({
  cobrancaId,
  aberto,
  onOpenChange,
  onAceito,
}: {
  cobrancaId: string
  aberto: boolean
  onOpenChange: (v: boolean) => void
  onAceito: () => void
}) {
  const qc = useQueryClient()
  const [marcado, setMarcado] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) setMarcado(false)
  }, [aberto])

  async function aceitar() {
    setSalvando(true)
    const r = await aceitarAvisoApoliceAction(cobrancaId)
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: cobrancaKeys.cobranca(cobrancaId) })
    onOpenChange(false)
    onAceito()
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Antes do primeiro envio</DialogTitle>
          <DialogDescription>
            Este aceite fica registrado com o seu nome, a data e o texto abaixo.
          </DialogDescription>
        </DialogHeader>
        <TextoAvisoApolice />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={marcado}
            onChange={(e) => setMarcado(e.target.checked)}
          />
          Li e entendi: a partir deste envio, novos recebíveis cedidos contra este sacado não estarão
          cobertos até o pagamento dos valores em aberto.
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!marcado || salvando} onClick={aceitar}>
            {salvando ? 'Registrando…' : 'Aceitar e continuar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
