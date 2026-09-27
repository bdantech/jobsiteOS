'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Inbox, X } from 'lucide-react'
import { PADROES_MANDATO_MANUAL, tipoVendedorDoMandato, type TipoMandato } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { decidirPropostaAction } from '@/actions/agentes-mandatos'
import { cn } from '@/lib/utils'
import { centavosDoTexto, dataHora, textoDosCentavos, tipoLabel } from './format'
import {
  agentesOpKeys,
  buscarPropostasPendentes,
  nomeDaEmpresa,
  personaDoAgente,
  useAgentes,
  type PropostaPendente,
} from './queries-operacao'

/**
 * Propostas de mandato aguardando aprovação (§2.3, "por escalonamento").
 *
 * Um mandato de qualificação que descobre interesse PROPÕE um de agendamento — mas o
 * agente não cria mandato sozinho: a proposta espera uma pessoa. É o ponto em que a
 * autonomia devolve a decisão de gastar mais dinheiro com aquela empresa.
 *
 * Só o gestor decide (`app_agentes_decidir_proposta` exige gestor); o closer vê a fila
 * dos agentes que acompanha, sem os botões. Aprovar abre um diálogo para ajustar agente,
 * orçamento, máximo de ações e prazo — os padrões são os do mandato manual daquele tipo.
 */
export function PropostasPendentes({
  gestor,
  destacada,
  onAbrirMandato,
}: {
  gestor: boolean
  destacada: string | null
  onAbrirMandato: (id: string) => void
}) {
  const propostas = useQuery({ queryKey: agentesOpKeys.propostas(), queryFn: buscarPropostasPendentes, refetchInterval: 60_000 })
  const agentes = useAgentes()
  const [aprovando, setAprovando] = React.useState<PropostaPendente | null>(null)
  const [recusando, setRecusando] = React.useState<PropostaPendente | null>(null)
  const refDestacada = React.useRef<HTMLLIElement | null>(null)

  const lista = propostas.data ?? []
  const achouDestacada = destacada ? lista.some((p) => p.id === destacada) : false

  React.useEffect(() => {
    if (achouDestacada) refDestacada.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [achouDestacada])

  if (propostas.isPending) return null
  if (propostas.isError) {
    return (
      <p className="text-sm text-destructive">
        {propostas.error instanceof Error ? propostas.error.message : 'Erro ao carregar as propostas.'}
      </p>
    )
  }
  if (lista.length === 0) {
    // A fila vazia não ocupa a tela — mas o link de uma notificação para uma proposta que
    // alguém já decidiu merece uma frase, e não um silêncio.
    return destacada ? (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Essa proposta já foi decidida (ou é de um agente que você não acompanha). Nenhuma proposta aguardando agora.
      </p>
    ) : null
  }

  const nomePor = new Map((agentes.data ?? []).map((a) => [a.id, personaDoAgente(a).nome]))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" aria-hidden />
          Propostas aguardando aprovação
          <Badge variant="warning">{lista.length}</Badge>
        </CardTitle>
        <CardDescription>
          Mandatos que um agente propôs a partir de outro. Nada acontece até alguém aprovar.
          {!gestor ? ' Quem aprova é a gestão comercial.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {destacada && !achouDestacada ? (
          <p className="mb-2 text-xs text-muted-foreground">A proposta do link já foi decidida.</p>
        ) : null}
        <ul className="grid gap-2 md:grid-cols-2">
          {lista.map((p) => (
            <li
              key={p.id}
              ref={p.id === destacada ? refDestacada : undefined}
              className={cn('space-y-2 rounded-lg border p-3 text-sm', p.id === destacada && 'ring-2 ring-primary')}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{tipoLabel(p.tipo)}</Badge>
                <span className="font-medium">{nomeDaEmpresa(p.empresas)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{dataHora(p.criado_em)}</span>
              </div>
              <p>{p.objetivo}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{nomePor.get(p.agente_id) ?? 'Agente'}</span> propôs porque:{' '}
                {p.justificativa}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => onAbrirMandato(p.mandato_origem_id)}
                >
                  Veio do mandato {p.origem?.codigo ?? ''}
                </button>
                {gestor ? (
                  <span className="ml-auto flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setRecusando(p)}>
                      <X aria-hidden />
                      Recusar
                    </Button>
                    <Button size="sm" onClick={() => setAprovando(p)}>
                      <Check aria-hidden />
                      Aprovar
                    </Button>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>

      {aprovando ? (
        <DialogoAprovar proposta={aprovando} onFechar={() => setAprovando(null)} onAbrirMandato={onAbrirMandato} />
      ) : null}
      {recusando ? <DialogoRecusar proposta={recusando} onFechar={() => setRecusando(null)} /> : null}
    </Card>
  )
}

function DialogoAprovar({
  proposta,
  onFechar,
  onAbrirMandato,
}: {
  proposta: PropostaPendente
  onFechar: () => void
  onAbrirMandato: (id: string) => void
}) {
  const qc = useQueryClient()
  const agentes = useAgentes()
  const tipo = proposta.tipo as TipoMandato
  const padrao = PADROES_MANDATO_MANUAL[tipo] ?? PADROES_MANDATO_MANUAL.agendamento_reuniao
  const [agenteId, setAgenteId] = React.useState(proposta.agente_id)
  const [orcamento, setOrcamento] = React.useState(textoDosCentavos(padrao.orcamento_centavos))
  const [maxAcoes, setMaxAcoes] = React.useState(String(padrao.max_acoes))
  const [prazo, setPrazo] = React.useState(String(padrao.prazo_dias))
  const [enviando, setEnviando] = React.useState(false)

  const tipoVendedor = PADROES_MANDATO_MANUAL[tipo] ? tipoVendedorDoMandato(tipo) : 'sdr'
  const opcoes = (agentes.data ?? []).filter((a) => a.ativo && (a.tipo === tipoVendedor || a.id === proposta.agente_id))

  const centavos = centavosDoTexto(orcamento)
  const acoes = Number(maxAcoes)
  const dias = Number(prazo)
  const valido =
    Boolean(agenteId) &&
    centavos !== null &&
    Number.isInteger(acoes) && acoes >= 1 && acoes <= 500 &&
    Number.isInteger(dias) && dias >= 1 && dias <= 180

  async function aprovar() {
    if (!valido || centavos === null) return
    setEnviando(true)
    const r = await decidirPropostaAction({
      id: proposta.id,
      aprovar: true,
      agente_id: agenteId,
      orcamento_centavos: centavos,
      max_acoes: acoes,
      prazo_dias: dias,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: agentesOpKeys.all })
    onFechar()
    const criado = r.data.mandatoCriadoId
    toast.success('Proposta aprovada — o mandato entra no próximo ciclo.', {
      action: criado ? { label: 'Abrir', onClick: () => onAbrirMandato(criado) } : undefined,
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aprovar proposta</DialogTitle>
          <DialogDescription>
            {tipoLabel(proposta.tipo)} para {nomeDaEmpresa(proposta.empresas)}. Ajuste o que precisar antes de criar o
            mandato.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="aprovar-agente">Agente</Label>
            <Select value={agenteId} onValueChange={setAgenteId}>
              <SelectTrigger id="aprovar-agente">
                <SelectValue placeholder="Escolha o agente" />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {personaDoAgente(a).nome}
                    {a.id === proposta.agente_id ? ' (quem propôs)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="aprovar-orcamento">Orçamento (R$)</Label>
              <Input id="aprovar-orcamento" inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aprovar-acoes">Máx. ações</Label>
              <Input id="aprovar-acoes" inputMode="numeric" value={maxAcoes} onChange={(e) => setMaxAcoes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aprovar-prazo">Prazo (dias)</Label>
              <Input id="aprovar-prazo" inputMode="numeric" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void aprovar()} disabled={enviando || !valido}>
            {enviando ? 'Aprovando…' : 'Aprovar e criar mandato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoRecusar({ proposta, onFechar }: { proposta: PropostaPendente; onFechar: () => void }) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  async function recusar() {
    setEnviando(true)
    const r = await decidirPropostaAction({ id: proposta.id, aprovar: false, motivo: motivo.trim() || null })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: agentesOpKeys.all })
    toast.success('Proposta recusada.')
    onFechar()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recusar proposta</DialogTitle>
          <DialogDescription>
            {tipoLabel(proposta.tipo)} para {nomeDaEmpresa(proposta.empresas)}. O mandato de origem segue como está.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="recusar-motivo">Por quê (opcional)</Label>
          <Textarea
            id="recusar-motivo"
            rows={3}
            maxLength={600}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: o closer já está falando com eles; a empresa não tem porte para reunião."
          />
          <p className="text-xs text-muted-foreground">
            O motivo fica registrado — é o que mostra, depois, se o agente propõe demais ou propõe errado.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void recusar()} disabled={enviando}>
            {enviando ? 'Recusando…' : 'Recusar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
