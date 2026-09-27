'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Hand, MoreHorizontal, Pause, Play } from 'lucide-react'
import { ACAO_HUMANA_LABELS, ESTADOS_TERMINAIS, type AcaoHumanaMandato, type EstadoMandato } from '@jobsiteos/core'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { acaoNoMandatoAction } from '@/actions/agentes-mandatos'
import { centavosDoTexto, reais, textoDosCentavos } from './format'
import { agentesOpKeys, personaDoAgente, useAgentes, type MandatoCompleto } from './queries-operacao'

/**
 * As ações humanas sobre um mandato (§11.2).
 *
 *   pausar / retomar / assumir   gestor OU o closer do agente
 *   encerrar / reatribuir / ajustar orçamento   só gestor
 *
 * Quem abre o modal já é gestor ou closer — a RLS de `mandatos` não mostra o mandato a
 * mais ninguém —, então as três primeiras aparecem sempre; as de gestor somem para quem
 * não é (`app_agentes_gestor`). Esconder é só para não oferecer: quem recusa de verdade
 * é a RPC `app_agentes_mandato_acao`.
 *
 * Mandato terminado (concluído, encerrado, com um humano) não recebe ação: a RPC recusa,
 * e um botão que só sabe dar erro é pior que nenhum.
 */
export function AcoesHumanasDoMandato({ mandato, gestor }: { mandato: MandatoCompleto; gestor: boolean }) {
  const qc = useQueryClient()
  const [dialogo, setDialogo] = React.useState<AcaoHumanaMandato | null>(null)
  const [enviando, setEnviando] = React.useState(false)

  const terminado = ESTADOS_TERMINAIS.includes(mandato.estado as EstadoMandato)
  if (terminado) return null

  async function executar(acao: AcaoHumanaMandato, extra: Record<string, unknown> = {}) {
    setEnviando(true)
    const r = await acaoNoMandatoAction({ mandato_id: mandato.id, acao, ...extra })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.message)
      return false
    }
    toast.success(MENSAGEM_DE_SUCESSO[acao])
    void qc.invalidateQueries({ queryKey: agentesOpKeys.all })
    setDialogo(null)
    return true
  }

  const pausado = mandato.estado === 'pausado'

  return (
    <>
      {pausado ? (
        <Button size="sm" variant="outline" disabled={enviando} onClick={() => void executar('retomar')}>
          <Play aria-hidden />
          Retomar
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={enviando} onClick={() => void executar('pausar')}>
          <Pause aria-hidden />
          Pausar
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={enviando} onClick={() => setDialogo('assumir')}>
        <Hand aria-hidden />
        Assumir manualmente
      </Button>
      {gestor ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="Mais ações de gestão" disabled={enviando}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Gestão</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setDialogo('ajustar_orcamento')}>
              {ACAO_HUMANA_LABELS.ajustar_orcamento}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialogo('reatribuir')}>{ACAO_HUMANA_LABELS.reatribuir}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={() => setDialogo('encerrar')}>
              {ACAO_HUMANA_LABELS.encerrar}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {dialogo === 'assumir' ? (
        <DialogoAssumir enviando={enviando} onFechar={() => setDialogo(null)} onConfirmar={() => void executar('assumir')} />
      ) : null}
      {dialogo === 'encerrar' ? (
        <DialogoEncerrar
          enviando={enviando}
          onFechar={() => setDialogo(null)}
          onConfirmar={(resultado) => void executar('encerrar', { resultado: resultado || null })}
        />
      ) : null}
      {dialogo === 'reatribuir' ? (
        <DialogoReatribuir
          agenteAtual={mandato.agente_id}
          enviando={enviando}
          onFechar={() => setDialogo(null)}
          onConfirmar={(agenteId) => void executar('reatribuir', { agente_id: agenteId })}
        />
      ) : null}
      {dialogo === 'ajustar_orcamento' ? (
        <DialogoAjustarOrcamento
          mandato={mandato}
          enviando={enviando}
          onFechar={() => setDialogo(null)}
          onConfirmar={(extra) => void executar('ajustar_orcamento', extra)}
        />
      ) : null}
    </>
  )
}

const MENSAGEM_DE_SUCESSO: Record<AcaoHumanaMandato, string> = {
  pausar: 'Mandato pausado. O agente não age nele até alguém retomar.',
  retomar: 'Mandato retomado — entra no próximo ciclo do agente.',
  assumir: 'Mandato com você. As conversas passaram para atendimento humano.',
  encerrar: 'Mandato encerrado.',
  reatribuir: 'Mandato reatribuído. O novo agente continua do plano atual.',
  ajustar_orcamento: 'Limites do mandato ajustados.',
}

function DialogoAssumir({
  enviando,
  onFechar,
  onConfirmar,
}: {
  enviando: boolean
  onFechar: () => void
  onConfirmar: () => void
}) {
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assumir manualmente</DialogTitle>
          <DialogDescription>
            É a saída para quando a conversa merece uma pessoa.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            O mandato vai para <strong>Com um humano</strong> (<code>escalado</code>) e sai das mãos do agente: ele
            não faz mais nenhuma ação aqui.
          </li>
          <li>
            As conversas do mandato passam para atendimento humano — o agente de conversa deixa de responder
            sozinho e só sugere.
          </li>
          <li>O histórico, o plano e o que já foi gasto ficam como estão.</li>
          <li>Não dá para devolver ao agente depois: se precisar, crie um mandato novo.</li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={enviando}>
            {enviando ? 'Assumindo…' : 'Assumir o mandato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoEncerrar({
  enviando,
  onFechar,
  onConfirmar,
}: {
  enviando: boolean
  onFechar: () => void
  onConfirmar: (resultado: string) => void
}) {
  const [resultado, setResultado] = React.useState('')
  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar o mandato</DialogTitle>
          <DialogDescription>
            Encerra sem sucesso, com o motivo &quot;Encerrado por uma pessoa&quot;. O agente para aqui e o
            mandato entra no desempenho como encerrado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="encerrar-resultado">O que foi conseguido (opcional)</Label>
          <Textarea
            id="encerrar-resultado"
            rows={3}
            maxLength={600}
            value={resultado}
            onChange={(e) => setResultado(e.target.value)}
            placeholder="Ex.: o cliente fechou direto com o closer; o agente não precisa mais seguir."
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => onConfirmar(resultado.trim())} disabled={enviando}>
            {enviando ? 'Encerrando…' : 'Encerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DialogoReatribuir({
  agenteAtual,
  enviando,
  onFechar,
  onConfirmar,
}: {
  agenteAtual: string
  enviando: boolean
  onFechar: () => void
  onConfirmar: (agenteId: string) => void
}) {
  const agentes = useAgentes()
  const [escolhido, setEscolhido] = React.useState<string | undefined>(undefined)
  const opcoes = (agentes.data ?? []).filter((a) => a.ativo && a.id !== agenteAtual)

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reatribuir agente</DialogTitle>
          <DialogDescription>
            O novo agente continua do plano atual. As ações antigas continuam no nome de quem as executou.
          </DialogDescription>
        </DialogHeader>
        {opcoes.length === 0 && !agentes.isPending ? (
          <p className="text-sm text-muted-foreground">Não há outro vendedor de IA ativo para receber o mandato.</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="reatribuir-agente">Novo agente</Label>
            <Select value={escolhido} onValueChange={setEscolhido}>
              <SelectTrigger id="reatribuir-agente">
                <SelectValue placeholder={agentes.isPending ? 'Carregando…' : 'Escolha o agente'} />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {personaDoAgente(a).nome} · {a.tipo === 'originador' ? 'originador' : 'SDR'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => escolhido && onConfirmar(escolhido)} disabled={enviando || !escolhido}>
            {enviando ? 'Reatribuindo…' : 'Reatribuir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Orçamento, máximo de ações e prazo. Mandato pausado por orçamento esgotado volta a andar
 * sozinho se o novo orçamento cobre o que já foi gasto (a RPC decide) — o texto avisa,
 * para ninguém ajustar e depois procurar o botão "Retomar".
 */
function DialogoAjustarOrcamento({
  mandato,
  enviando,
  onFechar,
  onConfirmar,
}: {
  mandato: MandatoCompleto
  enviando: boolean
  onFechar: () => void
  onConfirmar: (extra: { orcamento_centavos: number; max_acoes: number; expira_em: string | null }) => void
}) {
  const [orcamento, setOrcamento] = React.useState(textoDosCentavos(mandato.orcamento_centavos))
  const [maxAcoes, setMaxAcoes] = React.useState(String(mandato.max_acoes))
  const [prazo, setPrazo] = React.useState(
    new Date(mandato.expira_em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
  )

  const centavos = centavosDoTexto(orcamento)
  const acoes = Number(maxAcoes)
  const valido =
    centavos !== null && centavos <= 10_000_000 && Number.isInteger(acoes) && acoes >= 1 && acoes <= 500 && Boolean(prazo)
  const abaixoDoGasto = centavos !== null && centavos < mandato.gasto_centavos

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar orçamento</DialogTitle>
          <DialogDescription>
            Já gastou {reais(mandato.gasto_centavos)} e fez {mandato.acoes_executadas} ação(ões). Se estava pausado
            por orçamento esgotado e o novo valor cobre o gasto, volta a andar sozinho.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-orcamento">Orçamento (R$)</Label>
            <Input id="ajuste-orcamento" inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-acoes">Máximo de ações</Label>
            <Input id="ajuste-acoes" inputMode="numeric" value={maxAcoes} onChange={(e) => setMaxAcoes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-prazo">Expira em</Label>
            <Input id="ajuste-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
        </div>
        {abaixoDoGasto ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            O orçamento fica abaixo do que já foi gasto: o agente não terá saldo para nenhuma ação paga.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            disabled={enviando || !valido}
            onClick={() =>
              centavos !== null &&
              onConfirmar({
                orcamento_centavos: centavos,
                max_acoes: acoes,
                // Fim do dia escolhido em São Paulo: "expira em 30/09" quer dizer que o dia 30 ainda vale.
                expira_em: prazo ? `${prazo}T23:59:00-03:00` : null,
              })
            }
          >
            {enviando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
