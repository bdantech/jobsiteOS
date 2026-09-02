'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Star, UserPlus } from 'lucide-react'
import { BASE_LEGAL_LABELS, BASES_LEGAIS, CUSTOS_PADRAO, type BaseLegal } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buscarContatosAction,
  criarContatoManualFornecedorAction,
  promoverContatoAction,
} from '@/actions/fornecedores'
import {
  buscarConfigFornecedores,
  buscarContatosDescobertos,
  fornecedoresKeys,
} from './queries'
import { brlExato, exibirValor, linkDoContato, rotuloConfianca, rotuloFonte, rotuloTipo, varianteConfianca } from './formato'

/**
 * O AGENTE DE CONTATO NO CARD DA NOTA (04l §5 alcançado a partir do funil de NFs).
 *
 * A aba "Mensagens" de um card de NF era um beco: ela pede empresa, e 3.542 dos
 * 3.705 fornecedores com nota viva não têm ficha nenhuma. A tela explicava o
 * impasse ("sem empresa não há contato") e não oferecia saída — que é a definição
 * de uma aba sem uso.
 *
 * Este bloco é a saída, e ele não reimplementa nada: os contatos descobertos, a
 * busca paga e a promoção são as MESMAS queries e actions da ficha do funil de
 * fornecedores. Duas telas que descobrem contato de dois jeitos seriam dois
 * orçamentos contando a mesma fatura.
 *
 * ── POR QUE O CUSTO AQUI É O TETO, E NÃO O PLANO POR PROVEDOR ──────────────
 * A ficha mostra etapa por etapa porque tem o card do funil na mão — domínio,
 * porte, município. O fornecedor que chegou pela NOTA quase nunca tem esse card:
 * montar o mesmo plano a partir de nulos exibiria "Apollo pulado por porte" sobre
 * uma empresa cujo porte ninguém mediu. O teto é a promessa honesta que se pode
 * fazer sem esse dado, e o toast depois informa o custo REAL — que é o número que
 * importa para o teto do mês.
 */

export function ContatosDoFornecedor({
  cnpj,
  nomeFornecedor,
  onMudou,
}: {
  cnpj: string
  nomeFornecedor: string
  /** Chamado quando a empresa/contato passa a existir — a aba recarrega e o compositor aparece. */
  onMudou?: () => void
}) {
  const qc = useQueryClient()
  const [confirmandoBusca, setConfirmandoBusca] = React.useState(false)
  const [formAberto, setFormAberto] = React.useState(false)

  const contatos = useQuery({
    queryKey: fornecedoresKeys.contatos(cnpj),
    queryFn: () => buscarContatosDescobertos(cnpj),
  })
  const config = useQuery({ queryKey: fornecedoresKeys.config(), queryFn: buscarConfigFornecedores })

  const custos = { ...CUSTOS_PADRAO, ...((config.data?.custos as Record<string, number>) ?? {}) }
  const teto = custos.google_places + custos.novavida + custos.apollo + custos.claude_busca

  const invalidar = (): void => {
    void qc.invalidateQueries({ queryKey: fornecedoresKeys.todos })
    void qc.invalidateQueries({ queryKey: ['comunicacao'] })
    onMudou?.()
  }

  const buscar = useMutation({
    mutationFn: async () => {
      const r = await buscarContatosAction({ cnpj })
      if (!r.ok) throw new Error(r.message)
      return r.data
    },
    onSuccess: (d) => {
      setConfirmandoBusca(false)
      if (!d.ok) {
        toast.warning(d.motivo ?? 'A busca não rodou.')
        return
      }
      toast.success(
        d.contatosNovos > 0
          ? `${d.contatosNovos} contato(s) novo(s). Custou ${brlExato(d.custo)}.`
          : `Nenhum contato novo. Custou ${brlExato(d.custo)}.`,
      )
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const promover = useMutation({
    mutationFn: async (id: string) => {
      const r = await promoverContatoAction({ contato_descoberto_id: id, ponto_focal: true })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Contato oficial criado — já dá para mandar mensagem.')
      invalidar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const lista = contatos.data ?? []

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Com quem falar na {nomeFornecedor}</p>
          <p className="text-xs text-muted-foreground">
            Este fornecedor ainda não tem contato oficial. Promova um descoberto ou escreva o
            que você já sabe — a ficha da empresa é criada junto.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setFormAberto(true)}>
            <UserPlus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Adicionar à mão
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={buscar.isPending}
            onClick={() => setConfirmandoBusca(true)}
          >
            <Search className="mr-1 h-3.5 w-3.5" aria-hidden />
            {buscar.isPending ? 'Buscando…' : 'Buscar contatos'}
          </Button>
        </div>
      </div>

      {contatos.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : lista.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nada descoberto ainda. A varredura automática (XML das notas, Receita, site) roda de
          madrugada; o botão acima aciona as fontes pagas.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lista.map((c) => {
            const link = linkDoContato(c.tipo, c.valor)
            const promovivel = ['telefone', 'email', 'whatsapp'].includes(c.tipo)
            return (
              <li key={c.id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {exibirValor(c.tipo, c.valor)}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-medium">
                        {exibirValor(c.tipo, c.valor)}
                      </span>
                    )}
                    {c.nome_pessoa ? (
                      <span className="truncate text-xs text-muted-foreground">
                        · {c.nome_pessoa}
                        {c.cargo ? ` (${c.cargo})` : ''}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={varianteConfianca(c.confianca)} className="text-[10px]">
                      {rotuloConfianca(c.confianca)}
                    </Badge>
                    {c.promovido_contato_id ? (
                      <Badge variant="secondary" className="text-[10px]">na ficha</Badge>
                    ) : promovivel ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={promover.isPending}
                        onClick={() => promover.mutate(c.id)}
                        title="Promover a contato oficial e marcar como ponto focal"
                      >
                        <Star className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {/* Fonte e evidência ficam à vista aqui pelo mesmo motivo da ficha:
                    um telefone do campo estruturado da NF-e e um achado numa página
                    web pedem primeiras frases diferentes. */}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {rotuloTipo(c.tipo)} · {rotuloFonte(c.fonte)}
                  {c.evidencia ? ` · ${c.evidencia}` : ''}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={confirmandoBusca} onOpenChange={(o) => !o && setConfirmandoBusca(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buscar contatos — {nomeFornecedor}</DialogTitle>
            <DialogDescription>
              As fontes gratuitas (XML das notas, Receita, site) já rodaram de madrugada. Isto
              aciona as pagas, e sai do seu teto do mês.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-baseline justify-between border-t pt-3 text-sm font-medium">
            <span>Custo máximo</span>
            <span className="tabular-nums">{brlExato(teto)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Pode custar menos: a cascata para na primeira fonte que trouxer um contato de
            confiança alta.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmandoBusca(false)}>
              Cancelar
            </Button>
            <Button disabled={buscar.isPending} onClick={() => buscar.mutate()}>
              {buscar.isPending ? 'Buscando…' : 'Buscar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormularioContatoManual
        cnpj={cnpj}
        nomeFornecedor={nomeFornecedor}
        aberto={formAberto}
        onFechar={() => setFormAberto(false)}
        onCriado={() => {
          setFormAberto(false)
          invalidar()
        }}
      />
    </div>
  )
}

/**
 * O que o originador anotou no papel depois de ligar para a obra.
 *
 * A BASE LEGAL É CAMPO DO FORMULÁRIO, e não um default escondido: `contatos`
 * criado sem ela nasce mudo — o compositor recusa com "contato sem base legal" —
 * e um contato cadastrado que não pode receber mensagem é pior que nenhum,
 * porque parece que funcionou. O default é `dado_publico_nfe`, que é a verdade
 * de como se chegou a um fornecedor que veio de uma nota.
 */
function FormularioContatoManual({
  cnpj,
  nomeFornecedor,
  aberto,
  onFechar,
  onCriado,
}: {
  cnpj: string
  nomeFornecedor: string
  aberto: boolean
  onFechar: () => void
  onCriado: () => void
}) {
  const [nome, setNome] = React.useState('')
  const [cargo, setCargo] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  const [ehWhatsapp, setEhWhatsapp] = React.useState(true)
  const [email, setEmail] = React.useState('')
  const [baseLegal, setBaseLegal] = React.useState<BaseLegal>('dado_publico_nfe')

  const criar = useMutation({
    mutationFn: async () => {
      const r = await criarContatoManualFornecedorAction({
        fornecedor_cnpj: cnpj,
        nome: nome || null,
        cargo: cargo || null,
        telefone: telefone || null,
        telefone_e_whatsapp: ehWhatsapp,
        email: email || null,
        base_legal: baseLegal,
        ponto_focal: true,
      })
      if (!r.ok) throw new Error(r.message)
    },
    onSuccess: () => {
      toast.success('Contato cadastrado — já dá para mandar mensagem.')
      setNome('')
      setCargo('')
      setTelefone('')
      setEmail('')
      onCriado()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const semCanal = !telefone.trim() && !email.trim()

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar contato — {nomeFornecedor}</DialogTitle>
          <DialogDescription>
            A ficha da empresa é criada junto, e o contato entra como ponto focal.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cargo</Label>
            <Input value={cargo} onChange={(e) => setCargo(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Telefone / WhatsApp</Label>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="h-9"
              placeholder="(11) 99999-9999"
            />
            <label className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={ehWhatsapp}
                onChange={(e) => setEhWhatsapp(e.target.checked)}
              />
              Este número tem WhatsApp
            </label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">E-mail</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9"
              placeholder="financeiro@empresa.com.br"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Base legal</Label>
          <Select value={baseLegal} onValueChange={(v) => setBaseLegal(v as BaseLegal)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASES_LEGAIS.map((b) => (
                <SelectItem key={b} value={b}>
                  {BASE_LEGAL_LABELS[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            É ela que autoriza a abordagem — sem base legal o compositor recusa o envio.
            &ldquo;Dado público (NF-e)&rdquo; é a verdade quando o fornecedor veio de uma nota.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={semCanal || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? 'Salvando…' : 'Salvar contato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
