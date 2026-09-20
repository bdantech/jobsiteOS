'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { formatCnpj, renderizarAbordagem } from '@jobsiteos/core'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { STATUS_SUPERFICIE } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  descartarSacadoAction,
  enriquecerSacadoAction,
  pedirApresentacaoSacadoAction,
  reatribuirSacadoAction,
  solicitarAnaliseSacadoAction,
} from '@/actions/prospeccao'
import { buscarVendedoresVisiveis, comercialKeys } from '@/components/comercial/queries'
import { formatarMoeda, formatarMoedaExata } from './format'
import {
  buscarCustoProtesto,
  prospeccaoKeys,
  type ConfigProspeccao,
  type QuebraFornecedor,
  type SacadoProspeccao,
} from './prospeccao-queries'

/**
 * Os diálogos das ações do card (04r §5).
 *
 * Cada um existe porque a ação correspondente NÃO cabe num clique: descartar exige
 * motivo, solicitar análise mostra o limite que vai ser pedido antes de pedi-lo,
 * enriquecer mostra quanto custa e quanto sobra do teto, e a ponte é uma mensagem que
 * alguém precisa ler antes de mandar.
 */

function useInvalidar() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: prospeccaoKeys.all })
}

// ─── Descartar ──────────────────────────────────────────────────────────────

export function DialogoDescartar({
  sacado,
  config,
  onFechar,
}: {
  sacado: SacadoProspeccao | null
  config: ConfigProspeccao
  onFechar: () => void
}) {
  const invalidar = useInvalidar()
  const [estagio, setEstagio] = React.useState<'descartado' | 'sem_interesse'>('descartado')
  const [motivo, setMotivo] = React.useState('')
  const [observacao, setObservacao] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (sacado) {
      setEstagio('descartado')
      setMotivo('')
      setObservacao('')
    }
  }, [sacado])

  async function salvar() {
    if (!sacado) return
    setSalvando(true)
    const r = await descartarSacadoAction({
      cnpj_sacado: sacado.cnpj_sacado,
      estagio,
      motivo,
      observacao: observacao || undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Sacado retirado do funil ativo.')
    invalidar()
    onFechar()
  }

  const exigeObs = motivo === 'outro'

  return (
    <Dialog open={sacado !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Descartar {sacado?.sacado_nome ?? ''}</DialogTitle>
          <DialogDescription>
            O motivo é obrigatório — é a única saída útil de um card descartado. &ldquo;Quantos
            perdemos porque a ponte não andou?&rdquo; só tem resposta se todo mundo responder com
            o mesmo vocabulário.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prospeccao-descarte-tipo">O que aconteceu</Label>
            <Select value={estagio} onValueChange={(v) => setEstagio(v as typeof estagio)}>
              <SelectTrigger id="prospeccao-descarte-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Duas saídas diferentes, e a diferença é de quem foi a decisão. */}
                <SelectItem value="descartado">Nós descartamos</SelectItem>
                <SelectItem value="sem_interesse">Eles não têm interesse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prospeccao-descarte-motivo">Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger id="prospeccao-descarte-motivo">
                <SelectValue placeholder="Escolha um motivo" />
              </SelectTrigger>
              <SelectContent>
                {config.motivos_descarte.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prospeccao-descarte-obs">
              Observação {exigeObs ? '(obrigatória)' : '(opcional)'}
            </Label>
            <Textarea
              id="prospeccao-descarte-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={salvando || !motivo || (exigeObs && observacao.trim().length < 3)}
            onClick={() => void salvar()}
          >
            {salvando ? 'Descartando…' : 'Descartar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Solicitar análise ──────────────────────────────────────────────────────

export function DialogoSolicitarAnalise({
  sacado,
  onFechar,
}: {
  sacado: SacadoProspeccao | null
  onFechar: () => void
}) {
  const invalidar = useInvalidar()
  const [limite, setLimite] = React.useState('')
  const [observacoes, setObservacoes] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!sacado) return
    setObservacoes('')
    /*
     * O limite vem PRÉ-PREENCHIDO do `limite_potencial` (04c) e arredondado para
     * milhares — a mesma régua do resto da esteira. Um limite sugerido com centavos
     * denuncia que ninguém decidiu o número, e quem lê o pedido do outro lado percebe.
     */
    const potencial = Number(sacado.limite_potencial ?? 0)
    setLimite(potencial > 0 ? String(Math.round(potencial / 1000) * 1000) : '')
  }, [sacado])

  async function salvar() {
    if (!sacado) return
    setSalvando(true)
    const r = await solicitarAnaliseSacadoAction({
      cnpj_sacado: sacado.cnpj_sacado,
      limite_solicitado: limite ? Number(limite) : undefined,
      observacoes: observacoes || undefined,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Análise aberta na esteira. A decisão move o card sozinha.')
    invalidar()
    onFechar()
  }

  return (
    <Dialog open={sacado !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar análise — {sacado?.sacado_nome ?? ''}</DialogTitle>
          <DialogDescription>
            A análise entra na esteira do Crédito com origem <strong>prospeccao_fluxo</strong>. A
            decisão dela move este card sozinha: aprovada, o sacado entra na sua carteira e as
            notas dele passam a cair no funil de NFs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="prospeccao-limite">Limite a solicitar (R$)</Label>
            <Input
              id="prospeccao-limite"
              type="number"
              min={0}
              step={1000}
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Sugerido a partir do limite potencial ({formatarMoeda(sacado?.limite_potencial)}),
              calculado sobre o faturamento estimado de{' '}
              {formatarMoeda(sacado?.faturamento_estimado)}. Deixe em branco para usar o
              calculado.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="prospeccao-obs-analise">Contexto para quem vai analisar</Label>
            <Textarea
              id="prospeccao-obs-analise"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={
                sacado
                  ? `Fluxo observado: ${formatarMoeda(sacado.volume_30d)} em 30 dias de ${sacado.qtd_fornecedores} cedente(s), ${sacado.meses_com_emissao_6m} dos últimos 6 meses.`
                  : ''
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Abrindo…' : 'Abrir análise'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Enriquecer (PAGO) ──────────────────────────────────────────────────────

export function DialogoEnriquecer({
  sacado,
  onFechar,
}: {
  sacado: SacadoProspeccao | null
  onFechar: () => void
}) {
  const invalidar = useInvalidar()
  const [disparando, setDisparando] = React.useState(false)

  const { data: custo } = useQuery({
    queryKey: prospeccaoKeys.custoProtesto(),
    queryFn: buscarCustoProtesto,
    enabled: sacado !== null,
  })

  async function confirmar() {
    if (!sacado?.cnpj_sacado) return
    setDisparando(true)
    const r = await enriquecerSacadoAction({ cnpj: sacado.cnpj_sacado })
    setDisparando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    if (!r.data.ok) {
      const t = r.data.teto
      toast.error(
        r.data.motivo === 'teto_estourado' && t
          ? `Teto do mês estourado: ${formatarMoedaExata(t.gasto)} de ${formatarMoedaExata(t.teto)}. Peça a um gestor.`
          : 'Não foi possível consultar agora.',
      )
      return
    }
    toast.success(`Consulta feita por ${formatarMoedaExata(r.data.custo ?? 0)}.`)
    invalidar()
    onFechar()
  }

  return (
    <Dialog open={sacado !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enriquecer {sacado?.sacado_nome ?? ''}</DialogTitle>
          <DialogDescription>
            Consulta <strong>paga</strong> de protesto na base nacional, para este CNPJ.
          </DialogDescription>
        </DialogHeader>

        {/*
          O custo ANTES do clique, e o argumento da economia junto. Pagar protesto para as
          dezenas que já mostraram fluxo recorrente é barato; pagar para os milhares da
          lista é a fatura que ninguém aprovou.
        */}
        <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.info)}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              Custo estimado: {custo === undefined ? '…' : formatarMoedaExata(custo)}
            </p>
            <p>
              Sai do seu teto mensal de enriquecimento. Este sacado já mostrou{' '}
              {formatarMoeda(sacado?.volume_30d)} em fluxo e{' '}
              {sacado?.meses_com_emissao_6m ?? 0} meses com emissão — é o tipo de CNPJ em que a
              consulta paga se justifica.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={disparando} onClick={() => void confirmar()}>
            {disparando ? 'Consultando…' : 'Consultar e pagar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Pedir apresentação (a ponte) ───────────────────────────────────────────

export function DialogoPedirPonte({
  alvo,
  config,
  onFechar,
}: {
  alvo: { sacado: SacadoProspeccao; fornecedor: QuebraFornecedor } | null
  config: ConfigProspeccao
  onFechar: () => void
}) {
  const invalidar = useInvalidar()
  const [mensagem, setMensagem] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!alvo) return
    setMensagem(
      renderizarAbordagem(config.templates.pedido_ponte, {
        sacado_nome: alvo.sacado.sacado_nome ?? formatCnpj(alvo.sacado.cnpj_sacado ?? ''),
        valor_total: formatarMoedaExata(alvo.fornecedor.valor_30d),
        fornecedor_nome: alvo.fornecedor.fornecedor_nome,
      }),
    )
  }, [alvo, config.templates.pedido_ponte])

  async function salvar() {
    if (!alvo) return
    setSalvando(true)
    const r = await pedirApresentacaoSacadoAction({
      cnpj_sacado: alvo.sacado.cnpj_sacado,
      fornecedor_cnpj: alvo.fornecedor.fornecedor_cnpj,
      mensagem,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Pedido registrado. Envie pelo compositor na ficha do cedente.')
    invalidar()
    onFechar()
  }

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pedir apresentação a {alvo?.fornecedor.fornecedor_nome ?? ''}</DialogTitle>
          <DialogDescription>
            A abordagem sai <strong>pelo cedente</strong>, nunca direto na construtora. O texto
            abaixo vai para ele — são as notas dele, e é o certificado dele que nos deixa vê-las.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="prospeccao-ponte">Mensagem</Label>
          <Textarea
            id="prospeccao-ponte"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            rows={6}
            maxLength={4000}
          />
          <p className="text-xs text-muted-foreground">
            {'{remetente_nome}'} e {'{contato_nome}'} são preenchidos pelo compositor na hora do
            envio.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando || mensagem.trim().length < 10} onClick={() => void salvar()}>
            {salvando ? 'Registrando…' : 'Registrar pedido'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reatribuir (gestor) ────────────────────────────────────────────────────

export function DialogoReatribuir({
  sacado,
  onFechar,
}: {
  sacado: SacadoProspeccao | null
  onFechar: () => void
}) {
  const invalidar = useInvalidar()
  const [vendedorId, setVendedorId] = React.useState<string>('')
  const [salvando, setSalvando] = React.useState(false)

  const { data: vendedores = [] } = useQuery({
    queryKey: comercialKeys.visiveis(),
    queryFn: buscarVendedoresVisiveis,
    enabled: sacado !== null,
  })

  React.useEffect(() => {
    if (sacado) setVendedorId(sacado.originador_id ?? '__sem_dono__')
  }, [sacado])

  async function salvar() {
    if (!sacado) return
    setSalvando(true)
    const r = await reatribuirSacadoAction({
      cnpj_sacado: sacado.cnpj_sacado,
      originador_id: vendedorId === '__sem_dono__' ? null : vendedorId,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Originador atualizado.')
    invalidar()
    onFechar()
  }

  return (
    <Dialog open={sacado !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reatribuir {sacado?.sacado_nome ?? ''}</DialogTitle>
          <DialogDescription>
            Reatribuir é decidir de quem é o trabalho — e, por tabela, de qual teto de
            enriquecimento o próximo clique sai. A escolha manual não é desfeita pelo job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="prospeccao-originador">Originador</Label>
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger id="prospeccao-originador">
              <SelectValue placeholder="Escolha" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__sem_dono__">Sem dono (volta para a fila)</SelectItem>
              {vendedores.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
