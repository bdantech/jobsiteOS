'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Scale, ShieldAlert } from 'lucide-react'
import {
  DECISOES_FINAIS,
  DECISAO_FINAL_LABELS,
  DESFECHO_DA_DECISAO,
  ESTAGIO_ANALISE_LABELS,
  QUADRANTE_LABELS,
  QUADRANTE_LEITURA,
  motivoObrigatorio,
  podeConcluirPelaDecisao,
  type DecisaoFinal,
  type EstagioAnalise,
  type Quadrante,
} from '@jobsiteos/core'
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
import { concluirAnaliseAction } from '@/actions/credito'
import { registrarDecisaoAction } from '@/actions/credito-analise'
import { creditoKeys } from '../queries'
import { analisePropriaKeys } from './queries'
import { brl } from './resultado'

/**
 * O confronto com a seguradora e a decisão (04j §7).
 *
 * ─── POR QUE AS DUAS LEITURAS FICAM LADO A LADO ─────────────────────────────
 * Uma tela que mostrasse só o número final esconderia a única informação que importa:
 * QUEM discorda de quem. "Nós aprovamos e ela não" é a decisão que só um FIDC com dado
 * próprio consegue tomar; "ela aprovou e nós não" é alerta de complacência. São situações
 * opostas e produzem o mesmo número na tela se ninguém as separar.
 *
 * ─── O MOTIVO É OBRIGATÓRIO FORA DO CAMINHO TRIVIAL ─────────────────────────
 * `motivoObrigatorio()` do core é o mesmo predicado do CHECK da migração 0122. Aqui ele
 * serve para desabilitar o botão antes do clique; lá, para o banco recusar o que passar.
 * Os dois existem: um dá a mensagem, o outro dá a garantia.
 */

const CORES_QUADRANTE: Record<Quadrante, string> = {
  ambos_aprovam: 'border-emerald-500/40 bg-emerald-500/5',
  ambos_negam: 'border-muted bg-muted/30',
  so_nos: 'border-amber-500/50 bg-amber-500/5',
  so_seguradora: 'border-red-500/50 bg-red-500/5',
}

/** O caminho trivial de cada quadrante, pré-selecionado. Divergência não tem trivial. */
function decisaoSugerida(q: Quadrante | null): DecisaoFinal | '' {
  if (q === 'ambos_aprovam') return 'operar_com_cobertura'
  if (q === 'ambos_negam') return 'nao_operar'
  return ''
}

export function Confronto({
  analiseId,
  analiseCreditoId,
  estagio,
  quadrante,
  nossaRecomendacao,
  nossoLimite,
  seguradoraStatus,
  seguradoraLimite,
  decisaoAtual,
  decisaoLimite,
  decisaoMotivo,
  decidaEm,
}: {
  analiseId: string
  analiseCreditoId: string
  estagio: EstagioAnalise
  quadrante: Quadrante | null
  nossaRecomendacao: string | null
  nossoLimite: number | null
  seguradoraStatus: string | null
  seguradoraLimite: number | null
  decisaoAtual: DecisaoFinal | null
  decisaoLimite: number | null
  decisaoMotivo: string | null
  decidaEm: string | null
}) {
  const qc = useQueryClient()
  const [decisao, setDecisao] = React.useState<DecisaoFinal | ''>(
    decisaoAtual ?? decisaoSugerida(quadrante),
  )
  // Quando ambos aprovam, o limite sugerido é o MENOR dos dois — a cobertura é o teto real.
  const sugerido =
    quadrante === 'ambos_aprovam' && nossoLimite !== null && seguradoraLimite !== null
      ? Math.min(nossoLimite, seguradoraLimite)
      : (nossoLimite ?? seguradoraLimite)
  const [limite, setLimite] = React.useState(
    String(decisaoLimite ?? (sugerido !== null ? Math.round(sugerido) : '')),
  )
  const [motivo, setMotivo] = React.useState(decisaoMotivo ?? '')
  const [salvando, setSalvando] = React.useState(false)

  const [concluindo, setConcluindo] = React.useState(false)
  /**
   * A decisão que o diálogo de conclusão está perguntando sobre.
   *
   * Guardada em estado próprio, e não lida do `decisao` do formulário: entre registrar e
   * responder ao diálogo, alguém pode mexer no select — e a pergunta tem de continuar
   * sendo sobre o que foi GRAVADO, não sobre o que está na tela.
   */
  const [perguntandoDesfecho, setPerguntandoDesfecho] = React.useState<DecisaoFinal | null>(null)

  const exigeMotivo = decisao !== '' && motivoObrigatorio(quadrante, decisao)
  const semMotivo = exigeMotivo && motivo.trim().length === 0
  const naoOpera = decisao === 'nao_operar'

  async function registrar() {
    if (decisao === '') return
    setSalvando(true)
    const r = await registrarDecisaoAction({
      id: analiseId,
      decisao_final: decisao,
      decisao_limite: naoOpera ? null : Number(limite.replace(/\D/g, '')) || null,
      decisao_motivo: motivo.trim() || null,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Decisão registrada. O limite operacional foi aplicado na esteira.')
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })

    /*
     * A pergunta que fecha a esteira.
     *
     * Registrar a decisão e concluir a análise eram duas coisas separadas, e a segunda
     * não tinha botão nenhum: metade das análises não vai à seguradora, e uma decidida
     * por nós ficava aberta para sempre numa coluna do kanban — bloqueando, de quebra, a
     * próxima análise do mesmo CNPJ.
     *
     * É PERGUNTA e não consequência automática porque o desfecho é irreversível: análise
     * decidida não volta para a esteira. Quem quiser decidir agora e concluir depois
     * (esperando a seguradora, por exemplo) responde "agora não" e o botão continua ali.
     */
    if (podeConcluirPelaDecisao(estagio)) setPerguntandoDesfecho(decisao)
  }

  async function concluir(escolhida: DecisaoFinal) {
    setConcluindo(true)
    const r = await concluirAnaliseAction({
      id: analiseCreditoId,
      estagio: DESFECHO_DA_DECISAO[escolhida],
      motivo: motivo.trim() || null,
    })
    setConcluindo(false)
    setPerguntandoDesfecho(null)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    const desfecho = ESTAGIO_ANALISE_LABELS[DESFECHO_DA_DECISAO[escolhida]].toLowerCase()
    if (r.data.aviso) toast.warning(r.data.aviso)
    else toast.success(`Análise concluída como ${desfecho}.`)
    void qc.invalidateQueries({ queryKey: analisePropriaKeys.painel(analiseCreditoId) })
    void qc.invalidateQueries({ queryKey: creditoKeys.esteira() })
  }

  return (
    <div className="space-y-4">
      <Card className={quadrante ? CORES_QUADRANTE[quadrante] : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" aria-hidden />
            {quadrante ? QUADRANTE_LABELS[quadrante] : 'Sem confronto ainda'}
          </CardTitle>
          <CardDescription>
            {quadrante
              ? QUADRANTE_LEITURA[quadrante]
              : 'O quadrante só existe quando as duas leituras estão prontas: a nossa análise concluída e uma resposta da seguradora.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Nossa análise</p>
              <p className="text-sm font-medium">
                {nossaRecomendacao === 'operar' ? 'OPERAR' : nossaRecomendacao ? 'NÃO OPERAR' : '—'}
              </p>
              <p className="text-lg font-semibold tabular-nums">{brl(nossoLimite)}</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Seguradora</p>
              <p className="text-sm font-medium">{seguradoraStatus ?? '—'}</p>
              <p className="text-lg font-semibold tabular-nums">{brl(seguradoraLimite)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Decisão</CardTitle>
            {decisaoAtual && (
              <Badge variant="outline">
                {DECISAO_FINAL_LABELS[decisaoAtual]}
                {decidaEm ? ` · ${new Date(decidaEm).toLocaleDateString('pt-BR')}` : ''}
              </Badge>
            )}
          </div>
          <CardDescription>
            Registrada por gente do perfil Crédito. Grava o <strong>limite operacional</strong> na
            esteira — o limite da seguradora não é tocado, porque são duas verdades diferentes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="decisao">O que fazemos</Label>
              <Select value={decisao} onValueChange={(v) => setDecisao(v as DecisaoFinal)}>
                <SelectTrigger id="decisao">
                  <SelectValue placeholder="Escolha…" />
                </SelectTrigger>
                <SelectContent>
                  {DECISOES_FINAIS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DECISAO_FINAL_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="limite">Limite operacional</Label>
              <Input
                id="limite"
                inputMode="numeric"
                value={naoOpera ? '' : limite}
                disabled={naoOpera}
                onChange={(e) => setLimite(e.target.value)}
                placeholder={naoOpera ? 'não se aplica' : 'em reais'}
                className="tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="motivo">
              Motivo{exigeMotivo ? <span className="ml-1 text-destructive">*</span> : ' (opcional)'}
            </Label>
            <Textarea
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder={
                exigeMotivo
                  ? 'Esta decisão diverge do caminho trivial do quadrante. Escreva por quê — é o que alguém vai ler daqui a seis meses.'
                  : 'Contexto adicional, se houver.'
              }
            />
            {semMotivo && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <ShieldAlert className="h-3 w-3" aria-hidden />
                Sem motivo, esta decisão não pode ser registrada.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void registrar()} disabled={decisao === '' || semMotivo || salvando}>
              {salvando ? 'Registrando…' : decisaoAtual ? 'Atualizar decisão' : 'Registrar decisão'}
            </Button>
            {/*
             * O caminho de volta para quem respondeu "agora não" — ou para quem registrou
             * a decisão antes de a esteira chegar em documentos recebidos. Sem ele, a
             * única forma de concluir seria registrar a mesma decisão de novo só para ver
             * o diálogo aparecer.
             */}
            {decisaoAtual && podeConcluirPelaDecisao(estagio) && (
              <Button
                variant="outline"
                onClick={() => setPerguntandoDesfecho(decisaoAtual)}
                disabled={salvando || concluindo}
              >
                Concluir a análise
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/*
       * A pergunta é sobre o DESFECHO, e o desfecho é consequência da decisão — por isso
       * ele aparece escrito, e não escolhido: oferecer um segundo seletor aqui criaria
       * duas verdades sobre a mesma análise, e o RPC recusaria a que discordasse.
       */}
      <Dialog
        open={perguntandoDesfecho !== null}
        onOpenChange={(v) => !v && setPerguntandoDesfecho(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {perguntandoDesfecho === 'nao_operar' ? 'Negar a análise?' : 'Aprovar a análise?'}
            </DialogTitle>
            <DialogDescription>
              A decisão foi registrada. Concluir move a análise para o desfecho abaixo e a tira
              da esteira — <strong>análise decidida não volta</strong>. Se preferir esperar a
              seguradora, responda “agora não”: o botão continua no card.
            </DialogDescription>
          </DialogHeader>

          {perguntandoDesfecho && (
            <dl className="space-y-1.5 rounded-md border p-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Decisão registrada</dt>
                <dd>{DECISAO_FINAL_LABELS[perguntandoDesfecho]}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Desfecho na esteira</dt>
                <dd className="font-medium">
                  {ESTAGIO_ANALISE_LABELS[DESFECHO_DA_DECISAO[perguntandoDesfecho]]}
                </dd>
              </div>
              {perguntandoDesfecho !== 'nao_operar' && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">Limite operacional</dt>
                  <dd className="tabular-nums">
                    {brl(Number(limite.replace(/\D/g, '')) || null)}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPerguntandoDesfecho(null)}>
              Agora não
            </Button>
            <Button
              variant={perguntandoDesfecho === 'nao_operar' ? 'destructive' : 'default'}
              onClick={() => perguntandoDesfecho && void concluir(perguntandoDesfecho)}
              disabled={concluindo}
            >
              {concluindo
                ? 'Concluindo…'
                : perguntandoDesfecho === 'nao_operar'
                  ? 'Negar'
                  : 'Aprovar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
