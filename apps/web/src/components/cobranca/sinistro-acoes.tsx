'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hojeSaoPaulo } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { moverSinistroAction, type MoverSinistroInput } from '@/actions/cobranca-gestao'
import { gestaoKeys, type SinistroDetalhe } from './gestao-queries'
import { numeroBr } from './sinistro-arquivos'
import { sinistroEstagioLabel } from './format'

/**
 * Os atos do sinistro. Notificar (o D+90, cl. 18500.01) e enviar (o D+360) têm DOIS
 * caminhos no mesmo lugar:
 *
 *   • pelo sistema — e-mail formal ao contato da apólice (ou a API, quando houver
 *     entitlement). O estágio só muda depois de o transporte confirmar;
 *   • "já fiz por fora" — só registra, com o protocolo colado à mão.
 *
 * O segundo existe porque o prazo nunca depende da API nem do nosso e-mail (§7.4): se
 * um dos dois cair às 17h do último dia, a pessoa manda de onde puder e registra aqui.
 */

type Destino = MoverSinistroInput['estagio']

interface Acao {
  destino: Destino
  rotulo: string
  variante?: 'default' | 'outline' | 'destructive'
}

function acoesDo(estagio: string): Acao[] {
  switch (estagio) {
    case 'preparacao':
      return [
        { destino: 'notificado', rotulo: 'Notificar a seguradora' },
        { destino: 'enviado', rotulo: 'Enviar sinistro', variante: 'outline' },
      ]
    case 'notificado':
      return [{ destino: 'enviado', rotulo: 'Enviar sinistro' }]
    case 'enviado':
    case 'docs_pendentes':
      return [
        { destino: 'em_analise', rotulo: 'Em análise', variante: 'outline' },
        { destino: 'aceito', rotulo: 'Aceito', variante: 'outline' },
        { destino: 'recusado', rotulo: 'Recusado', variante: 'outline' },
      ]
    case 'em_analise':
      return [
        { destino: 'aceito', rotulo: 'Aceito' },
        { destino: 'recusado', rotulo: 'Recusado', variante: 'outline' },
      ]
    case 'aceito':
      return [{ destino: 'indenizado', rotulo: 'Registrar indenização' }]
    default:
      return []
  }
}

export function SinistroAcoes({ d }: { d: SinistroDetalhe }) {
  const s = d.sinistro
  const [destino, setDestino] = React.useState<Destino | null>(null)
  const finais = s.estagio === 'indenizado' || s.estagio === 'encerrado'
  const acoes = acoesDo(s.estagio)

  if (finais) return null

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <span className="mr-2 text-sm text-muted-foreground">Próximo ato:</span>
        {acoes.map((a) => (
          <Button key={a.destino} size="sm" variant={a.variante ?? 'default'} onClick={() => setDestino(a.destino)}>
            {a.rotulo}
          </Button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDestino('encerrado')}>
          Encerrar sinistro
        </Button>
      </CardContent>
      <DialogMover d={d} destino={destino} onFechar={() => setDestino(null)} />
    </Card>
  )
}

function DialogMover({
  d,
  destino,
  onFechar,
}: {
  d: SinistroDetalhe
  destino: Destino | null
  onFechar: () => void
}) {
  const qc = useQueryClient()
  const s = d.sinistro
  const [porFora, setPorFora] = React.useState(false)
  const [dataAto, setDataAto] = React.useState(hojeSaoPaulo())
  const [protocolo, setProtocolo] = React.useState('')
  const [motivo, setMotivo] = React.useState('')
  const [indenizacao, setIndenizacao] = React.useState('')
  const [justificativa, setJustificativa] = React.useState(s.justificativa_prova_entrega ?? '')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    if (destino) {
      setPorFora(false)
      setDataAto(hojeSaoPaulo())
      setProtocolo('')
      setMotivo('')
      setIndenizacao('')
      setJustificativa(s.justificativa_prova_entrega ?? '')
    }
  }, [destino, s.justificativa_prova_entrega])

  const pelaSeguradora = destino === 'notificado' || destino === 'enviado'
  const semProva = d.notificacoes.filter((n) => n.status !== 'falhou' && !n.tem_prova)
  const pendentesChecklist = d.documentos.filter((x) => x.obrigatorio && x.status === 'pendente')

  const bloqueado =
    enviando ||
    (destino === 'recusado' && !motivo.trim()) ||
    (destino === 'indenizado' && (numeroBr(indenizacao) ?? -1) < 0) ||
    (destino === 'enviado' && pendentesChecklist.length > 0) ||
    (destino === 'enviado' && semProva.length > 0 && justificativa.trim().length < 10) ||
    (pelaSeguradora && porFora && !protocolo.trim())

  async function confirmar() {
    if (!destino) return
    setEnviando(true)
    const r = await moverSinistroAction({
      sinistro_id: s.id,
      estagio: destino,
      data: pelaSeguradora && !porFora ? undefined : dataAto,
      protocolo_externo: protocolo.trim() || undefined,
      motivo_recusa: motivo.trim() || undefined,
      indenizacao_recebida: destino === 'indenizado' ? (numeroBr(indenizacao) ?? undefined) : undefined,
      justificativa_prova_entrega: destino === 'enviado' && semProva.length ? justificativa.trim() : undefined,
      por_fora: pelaSeguradora ? porFora : undefined,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message, { duration: 12_000 })
      return
    }
    toast.success(
      r.data.mensagem ??
        `Sinistro em "${sinistroEstagioLabel(r.data.sinistro.estagio)}"${r.data.sinistro.protocolo_externo ? ` · protocolo ${r.data.sinistro.protocolo_externo}` : ''}.`,
    )
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
    onFechar()
  }

  const titulo =
    destino === 'notificado'
      ? 'Notificar a seguradora do inadimplemento'
      : destino === 'enviado'
        ? 'Enviar o sinistro'
        : destino
          ? `Mover para "${sinistroEstagioLabel(destino)}"`
          : ''

  return (
    <Dialog open={destino !== null} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {destino === 'notificado'
              ? 'Cumpre o prazo de notificação (D+90, cl. 18500.01) para todos os títulos deste sinistro.'
              : destino === 'enviado'
                ? 'Envia o dossiê completo. A resposta da seguradora fica prevista para 120 dias depois.'
                : destino === 'encerrado'
                  ? 'Encerra o sinistro e os prazos de apólice ligados a ele.'
                  : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {pelaSeguradora ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="flex items-start gap-2">
                <input type="radio" name="via" checked={!porFora} onChange={() => setPorFora(false)} className="mt-1" />
                <span>
                  <span className="font-medium">Pelo sistema</span>
                  <span className="block text-xs text-muted-foreground">
                    Modo {s.modo_envio === 'api' ? 'API (Non-Payments)' : 'manual: e-mail formal ao contato da apólice'}.
                    O estágio só muda depois de o envio ser confirmado.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="via" checked={porFora} onChange={() => setPorFora(true)} className="mt-1" />
                <span>
                  <span className="font-medium">Já {destino === 'notificado' ? 'notifiquei' : 'enviei'} por fora</span>
                  <span className="block text-xs text-muted-foreground">
                    Só registra a data e o protocolo. Use se o envio do sistema falhar — o prazo não depende dele.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {destino === 'enviado' && pendentesChecklist.length > 0 ? (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-100">
              <p className="font-medium">Checklist incompleto — anexe ou justifique antes de enviar:</p>
              <ul className="list-disc pl-5">
                {pendentesChecklist.map((p) => (
                  <li key={p.id}>
                    {p.item}) {p.descricao}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {destino === 'enviado' && semProva.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-destructive">
                Sem prova de entrega: {semProva.map((n) => `${n.destinatario_razao_social} (rodada ${n.rodada})`).join('; ')}.
              </p>
              <Label htmlFor="just-prova">Justificativa da ausência (vai no corpo do envio)</Label>
              <Textarea id="just-prova" rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            </div>
          ) : null}

          {!pelaSeguradora || porFora ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ato-data">Data</Label>
                <Input id="ato-data" type="date" value={dataAto} onChange={(e) => setDataAto(e.target.value)} />
              </div>
              {pelaSeguradora || destino === 'aceito' || destino === 'em_analise' ? (
                <div className="space-y-1">
                  <Label htmlFor="ato-protocolo">Protocolo{pelaSeguradora ? ' (obrigatório)' : ''}</Label>
                  <Input id="ato-protocolo" value={protocolo} onChange={(e) => setProtocolo(e.target.value)} />
                </div>
              ) : null}
            </div>
          ) : null}

          {destino === 'recusado' ? (
            <div className="space-y-1">
              <Label htmlFor="ato-motivo">Motivo da recusa</Label>
              <Textarea id="ato-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          ) : null}

          {destino === 'indenizado' ? (
            <div className="space-y-1">
              <Label htmlFor="ato-ind">Indenização recebida (R$)</Label>
              <Input id="ato-ind" inputMode="decimal" value={indenizacao} onChange={(e) => setIndenizacao(e.target.value)} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={bloqueado} variant={destino === 'encerrado' ? 'destructive' : 'default'}>
            {enviando
              ? 'Aguarde…'
              : pelaSeguradora && !porFora
                ? destino === 'notificado'
                  ? 'Notificar agora'
                  : 'Enviar agora'
                : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
