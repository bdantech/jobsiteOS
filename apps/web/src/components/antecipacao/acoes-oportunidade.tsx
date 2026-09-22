'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, Building2, ExternalLink, Layers, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import {
  ESTAGIOS_ABERTOS,
  ESTAGIOS_ENCERRADOS,
  ESTAGIO_FUNIL_LABELS,
  TIPO_OPORTUNIDADE_LABELS,
  type EstagioFunil,
  type TipoOportunidade,
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
import {
  moverEstagioAction,
  moverOportunidadeAction,
  promoverFornecedorAction,
} from '@/actions/antecipacao'
import { SemInteresseDialog } from './acoes-nota'
import { antecipacaoKeys, type Oportunidade } from './queries'

/**
 * As ações do card unificado — e são AS MESMAS de sempre (§11).
 *
 * Nenhum estágio novo, nenhuma ação nova. O que este componente faz é rotear a
 * mesma ação para a RPC certa: a NF continua sendo movida por
 * `app_mover_estagio_nf`, as fontes novas por `app_mover_oportunidade`. São duas
 * RPCs porque a primeira devolve `notas_fiscais`, um tipo que uma parcela do ERP
 * não tem e não deveria fingir ter — mas a REGRA é uma só, e ela mora no banco.
 *
 * ── O QUE NÃO APARECE AQUI, E POR QUÊ ───────────────────────────────────────
 * "Em prospecção" não é opção em lugar nenhum: a oportunidade entra lá sozinha
 * quando a primeira mensagem sai para o fornecedor. É FATO, e quem sabe dele é o
 * ledger de comunicação. Deixar o botão faria o funil medir intenção em vez de
 * contato — e o banco recusaria o clique de qualquer forma.
 *
 * "Fornecedor sem interesse" some para CREDOR PESSOA FÍSICA: a supressão é por
 * CNPJ, e ele não tem um. O item continua no funil, apenas sem essa porta.
 */

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: antecipacaoKeys.all })
}

function MoverOportunidadeDialog({
  item,
  destino,
  aberto,
  onOpenChange,
}: {
  item: Oportunidade
  destino: EstagioFunil
  aberto: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const pedeMotivo = destino === 'perdida'
  const tipo = (item.tipo ?? 'nf') as TipoOportunidade

  async function confirmar() {
    if (pedeMotivo && motivo.trim() === '') return
    setSalvando(true)

    // A NF pela função dela; as outras duas pela função delas. Um único caminho
    // que aceitasse os três tipos seria um segundo jeito de mover uma nota — e
    // dois jeitos divergem.
    const r =
      tipo === 'nf'
        ? await moverEstagioAction({
            access_key: item.access_key,
            estagio_funil: destino,
            perda_motivo: pedeMotivo ? motivo.trim() : undefined,
          })
        : await moverOportunidadeAction({
            tipo,
            id: item.id,
            estagio_funil: destino,
            perda_motivo: pedeMotivo ? motivo.trim() : undefined,
          })

    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`${TIPO_OPORTUNIDADE_LABELS[tipo]} movida para ${ESTAGIO_FUNIL_LABELS[destino]}.`)
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
            {TIPO_OPORTUNIDADE_LABELS[tipo]} {item.numero_exibicao ?? item.id} de{' '}
            {item.fornecedor_nome ?? item.fornecedor_cnpj}.
          </DialogDescription>
        </DialogHeader>

        {pedeMotivo && (
          <div className="space-y-2">
            <Label htmlFor="perda-motivo-op">Motivo da perda</Label>
            <Textarea
              id="perda-motivo-op"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: já antecipou com outro fundo; a construtora pagou no ERP; taxa fora do aceitável."
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
          <Button
            onClick={() => void confirmar()}
            disabled={salvando || (pedeMotivo && motivo.trim() === '')}
          >
            {salvando ? 'Movendo…' : 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MenuAcoesOportunidade({ item }: { item: Oportunidade }) {
  const qc = useQueryClient()
  const [destino, setDestino] = React.useState<EstagioFunil | null>(null)
  const [semInteresse, setSemInteresse] = React.useState(false)
  const [criandoFicha, setCriandoFicha] = React.useState(false)
  const tipo = (item.tipo ?? 'nf') as TipoOportunidade

  /*
   * Criar a ficha do fornecedor SEM abrir o card.
   *
   * A maioria das ofertas de aquisição chega assim, e quem varre a coluna já sabe
   * o que fazer com elas — obrigar a abrir cada uma para um clique que não pede
   * decisão nenhuma é atrito sem proteção. Mesma razão pela qual mover estágio
   * está aqui.
   *
   * Credor pessoa física fica de fora: `empresas` é por CNPJ e ele não tem um.
   */
  const podeCriarFicha =
    !item.fornecedor_empresa_id &&
    Boolean(item.fornecedor_cnpj) &&
    item.credor_pessoa_fisica !== true

  async function criarFicha() {
    if (!item.fornecedor_cnpj) return
    setCriandoFicha(true)
    const r = await promoverFornecedorAction(item.fornecedor_cnpj)
    setCriandoFicha(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Ficha de ${r.data.razao_social ?? item.fornecedor_cnpj} criada.`)
    invalidar(qc)
  }

  const estagios: readonly EstagioFunil[] = [...ESTAGIOS_ABERTOS, ...ESTAGIOS_ENCERRADOS].filter(
    (e) =>
      e !== item.estagio_funil &&
      e !== 'expirada' &&
      !(item.estagio_funil === 'a_prospectar' && e === 'em_prospeccao'),
  )

  const podeSuprimir = Boolean(item.fornecedor_cnpj) && item.credor_pessoa_fisica !== true

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Ações da ${TIPO_OPORTUNIDADE_LABELS[tipo].toLowerCase()}`}
          >
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

          {/*
            Primeiro item depois de "mover" porque, num card de aquisição, é a ação
            mais provável: o fornecedor não tem ficha, e sem ficha não há timeline,
            contato nem para onde a mensagem ir.
          */}
          {podeCriarFicha && (
            <DropdownMenuItem disabled={criandoFicha} onSelect={() => void criarFicha()}>
              <Building2 className="mr-2 h-4 w-4" />
              {criandoFicha ? 'Criando ficha…' : 'Criar ficha do fornecedor'}
            </DropdownMenuItem>
          )}

          {podeSuprimir && (
            <DropdownMenuItem asChild>
              <Link href={`/antecipacao/fornecedores/${item.fornecedor_cnpj}`}>
                <Layers className="mr-2 h-4 w-4" />
                Ver tudo do fornecedor
              </Link>
            </DropdownMenuItem>
          )}

          {item.fornecedor_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${item.fornecedor_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do fornecedor
              </Link>
            </DropdownMenuItem>
          )}
          {item.sacado_empresa_id && (
            <DropdownMenuItem asChild>
              <Link href={`/empresas/${item.sacado_empresa_id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Company 360 do sacado
              </Link>
            </DropdownMenuItem>
          )}

          {podeSuprimir && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSemInteresse(true)} className="text-destructive">
                <Ban className="mr-2 h-4 w-4" />
                Fornecedor sem interesse
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {destino && (
        <MoverOportunidadeDialog
          item={item}
          destino={destino}
          aberto
          onOpenChange={(v) => !v && setDestino(null)}
        />
      )}
      {podeSuprimir && item.fornecedor_cnpj && (
        <SemInteresseDialog
          cnpj={item.fornecedor_cnpj}
          nome={item.fornecedor_nome}
          aberto={semInteresse}
          onOpenChange={setSemInteresse}
        />
      )}
    </>
  )
}
