'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Clock, Mail, MessageCircle, Send } from 'lucide-react'
import {
  BASE_LEGAL_LABELS,
  exigeDescadastro,
  renderizarMensagem,
  variaveisPendentes,
  type BaseLegal,
  type CanalThread,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { enviarMensagemAction, valoresVariaveisAction } from '@/actions/comunicacao'
import { buscarContatos, buscarTemplates, type ContatoDaEmpresa } from './queries'

/**
 * O COMPOSITOR (§5). O mesmo componente na Company 360, na aba "Mensagens" do
 * card e no inbox.
 *
 * ── O PREVIEW É RENDERIZADO, NÃO O TEMPLATE ────────────────────────────────
 * A caixa mostra o texto JÁ com as variáveis substituídas — e é esse texto que é
 * enviado. Mostrar `{contato_nome}` e substituir no servidor faria a pessoa
 * apertar enviar sem ter lido o que a outra vai ler, que é a única coisa que o
 * compositor precisa garantir.
 *
 * Os valores vêm todos de `valoresVariaveisAction`, e o template só é aplicado
 * depois que eles chegam. Antes, o compositor preenchia três chaves de dezessete
 * com o que tinha à mão e mandava o resto literal — "Aqui é {remetente_nome}, da
 * ONE OS" saiu assim para um fornecedor. O que sobrar de `{chave}` no texto
 * bloqueia o botão: sair literal é pior que não sair.
 *
 * ── O QUE ELE RECUSA ANTES DE CHAMAR O SERVIDOR ────────────────────────────
 * Contato sem o canal escolhido e contato sem base legal. As duas seriam recusas
 * do portão, e recusar aqui é o que transforma um erro em explicação — a RPC
 * continua sendo quem decide, e ela recusa de novo se algo mudar no meio.
 */

export function Compositor({
  empresaId,
  contatoIdInicial,
  funil,
  funilCardId,
  onEnviado,
}: {
  empresaId: string
  contatoIdInicial?: string | null
  funil?: 'nfs' | 'fornecedores' | 'sdr' | 'vendas' | 'certificados' | null
  funilCardId?: string | null
  onEnviado?: () => void
}) {
  const qc = useQueryClient()
  const [canal, setCanal] = React.useState<CanalThread>('whatsapp')
  const [contatoId, setContatoId] = React.useState<string>(contatoIdInicial ?? '')
  const [templateId, setTemplateId] = React.useState<string>('')
  const [assunto, setAssunto] = React.useState('')
  const [corpo, setCorpo] = React.useState('')
  const [forcarJanela, setForcarJanela] = React.useState(false)
  const [enviando, setEnviando] = React.useState(false)

  const contatos = useQuery({
    queryKey: ['comunicacao', 'contatos', empresaId],
    queryFn: () => buscarContatos(empresaId),
  })
  const templates = useQuery({
    queryKey: ['comunicacao', 'templates', canal, funil ?? null],
    queryFn: () => buscarTemplates(canal, funil ?? null),
  })

  const lista = React.useMemo(() => contatos.data ?? [], [contatos.data])

  // O ponto focal já vem escolhido: é a hierarquia de todo o sistema, e poupa um
  // clique em 90% dos envios.
  React.useEffect(() => {
    if (contatoId || lista.length === 0) return
    setContatoId(contatoIdInicial ?? lista[0]!.id)
  }, [lista, contatoId, contatoIdInicial])

  const contato = lista.find((c) => c.id === contatoId) ?? null
  const destino = contato ? (canal === 'email' ? contato.email : (contato.whatsapp ?? contato.telefone)) : null

  // Tudo que o catálogo sabe preencher para ESTA empresa e ESTE contato. Uma
  // consulta só: as chaves atravessam quatro módulos, e quinze idas ao banco
  // pelo cliente seriam quinze chances de o texto sair pela metade.
  const valores = useQuery({
    queryKey: ['comunicacao', 'valores-variaveis', empresaId, contatoId],
    queryFn: async () => {
      const r = await valoresVariaveisAction(empresaId, contatoId || null)
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    enabled: Boolean(empresaId),
  })

  /*
   * O template é aplicado por EFEITO, não no clique.
   *
   * No clique, os valores podiam ainda estar viajando — e era exatamente isso que
   * mandava `{empresa_nome}` para o WhatsApp de quem escolheu o template rápido
   * demais. Aqui a aplicação acontece quando (template, contato, valores) estão
   * todos de pé, na ordem em que chegarem. A assinatura evita que um refetch
   * apague o que a pessoa editou à mão depois.
   */
  const aplicado = React.useRef('')
  React.useEffect(() => {
    if (!templateId || !valores.data) return
    const assinatura = `${templateId}|${contatoId}`
    if (aplicado.current === assinatura) return
    const t = (templates.data ?? []).find((x) => x.id === templateId)
    if (!t) return
    aplicado.current = assinatura
    const base = (contato?.base_legal ?? null) as BaseLegal | null
    setCorpo(renderizarMensagem(t.corpo, valores.data, { canal, baseLegal: base }))
    if (t.assunto) setAssunto(renderizarMensagem(t.assunto, valores.data, { canal, baseLegal: null }))
  }, [templateId, contatoId, valores.data, templates.data, canal, contato?.base_legal])

  /*
   * O que sobrou de `{chave}` no texto. O worker recusa a linha por isto também,
   * mas descobrir no envio é tarde: a pessoa já foi embora da tela e a mensagem
   * vira uma notificação de falha. Aqui ela vê antes, com as chaves pelo nome.
   */
  const pendentes = variaveisPendentes(`${canal === 'email' ? assunto : ''}\n${corpo}`)

  const motivoBloqueio = ((): string | null => {
    if (!contato) return 'Escolha um contato.'
    if (!destino) return `Este contato não tem ${canal === 'email' ? 'e-mail' : 'WhatsApp'} cadastrado.`
    if (!contato.base_legal) return 'Contato sem base legal — não é possível abordá-lo.'
    if (!corpo.trim()) return 'Escreva a mensagem.'
    if (pendentes.length > 0) {
      return `Sem valor para ${pendentes.map((v) => `{${v}}`).join(', ')} — sairia assim, literal. Escreva à mão ou escolha outro template.`
    }
    return null
  })()

  async function enviar() {
    if (motivoBloqueio) return
    setEnviando(true)
    try {
      const r = await enviarMensagemAction({
        canal,
        contato_id: contatoId,
        assunto: canal === 'email' ? assunto || null : null,
        corpo,
        template_id: templateId || null,
        funil: funil ?? null,
        funil_card_id: funilCardId ?? null,
        forcar_janela: forcarJanela,
      })
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success('Mensagem na fila. Sai na próxima janela de envio.')
      setCorpo('')
      setAssunto('')
      setTemplateId('')
      aplicado.current = ''
      setForcarJanela(false)
      await qc.invalidateQueries({ queryKey: ['comunicacao'] })
      onEnviado?.()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Canal</Label>
          <Select value={canal} onValueChange={(v) => setCanal(v as CanalThread)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">
                <span className="flex items-center gap-2">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </span>
              </SelectItem>
              <SelectItem value="email">
                <span className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" /> E-mail
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Contato</Label>
          <Select value={contatoId} onValueChange={setContatoId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Escolha um contato" />
            </SelectTrigger>
            <SelectContent>
              {lista.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {rotuloContato(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {contato ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{destino ?? 'sem canal'}</span>
          {contato.base_legal ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              {BASE_LEGAL_LABELS[contato.base_legal as BaseLegal] ?? contato.base_legal}
            </Badge>
          ) : (
            <Badge variant="destructive" className="h-5 text-[10px]">
              sem base legal
            </Badge>
          )}
          {contato.nao_e_o_decisor ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              não é quem decide
            </Badge>
          ) : null}
          {exigeDescadastro(canal, (contato.base_legal ?? null) as BaseLegal | null) ? (
            <span className="italic">o link de descadastro é anexado no envio</span>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs">Template</Label>
        <Select value={templateId} onValueChange={setTemplateId} disabled={valores.isPending}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={valores.isPending ? 'Carregando os dados…' : 'Escrever do zero'} />
          </SelectTrigger>
          <SelectContent>
            {(templates.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canal === 'email' ? (
        <div className="space-y-1">
          <Label className="text-xs">Assunto</Label>
          <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} className="h-9" />
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-xs">Mensagem</Label>
        <Textarea
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          rows={6}
          placeholder="O que você quer dizer?"
        />
        {pendentes.length > 0 ? (
          <p className="flex items-start gap-1.5 text-[11px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>
              Sem valor para {pendentes.map((v) => `{${v}}`).join(', ')} nesta empresa. Do jeito que
              está, é isso que a pessoa leria.
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            É este texto que a pessoa vai ler — as variáveis já foram substituídas.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={forcarJanela}
          onChange={(e) => setForcarJanela(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <Clock className="mr-1 inline h-3 w-3" aria-hidden />
          Enviar mesmo fora da janela (seg–sex, 9h–18h). Supressão e cooldown continuam valendo.
        </span>
      </label>

      {motivoBloqueio ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {motivoBloqueio}
        </p>
      ) : null}

      <Button onClick={enviar} disabled={Boolean(motivoBloqueio) || enviando} className="w-full sm:w-auto">
        <Send className="mr-2 h-4 w-4" aria-hidden />
        {enviando ? 'Enfileirando…' : 'Enviar'}
      </Button>
    </div>
  )
}

function rotuloContato(c: ContatoDaEmpresa): string {
  const partes = [c.nome ?? 'Sem nome']
  if (c.cargo) partes.push(`— ${c.cargo}`)
  if (c.ponto_focal) partes.push('· ponto focal')
  return partes.join(' ')
}
