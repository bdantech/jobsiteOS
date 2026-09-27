'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot } from 'lucide-react'
import {
  PADROES_MANDATO_MANUAL,
  TIPO_MANDATO_LABELS,
  tipoVendedorDoMandato,
  type TipoMandato,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { criarMandatoAction } from '@/actions/agentes-mandatos'
import { createClient } from '@/lib/supabase/client'
import { centavosDoTexto, textoDosCentavos } from './format'
import { agentesOpKeys, personaDoAgente, useAgentes, usePermissoesAgentes } from './queries-operacao'

/**
 * "Delegar ao agente" (§2.3, criação MANUAL de mandato) — o botão que mora nas telas de
 * empresa, de NF e do funil comercial.
 *
 * ─── SÓ PARA GESTOR COM O MÓDULO ────────────────────────────────────────────
 * Criar mandato é decisão de gestão (a RPC `app_agentes_criar_mandato` começa por
 * `app_agentes_exige_gestor`). As telas hospedeiras são de outros módulos e não sabem
 * quem é gestor de agentes, então o componente se esconde sozinho: pergunta uma vez por
 * sessão (`usePermissoesAgentes`) e não renderiza nada para quem não pode. Não é a
 * segurança — é não oferecer um botão que só sabe dar erro.
 *
 * ─── OS PADRÕES VÊM DO CONTEXTO ─────────────────────────────────────────────
 * Tipo, objetivo e agente chegam preenchidos pelo lugar de onde se clicou: da NF sai
 * originação com a chave da nota, do funil sai agendamento, da empresa sai conforme o
 * estágio. Orçamento, máximo de ações e prazo são os de `PADROES_MANDATO_MANUAL` — o
 * gestor ajusta na hora, mas não precisa pensar neles para o caso comum.
 *
 * Criar o mandato NÃO faz o agente agir: só o põe na fila do ciclo, que roda sob as
 * trancas, o orçamento e o disjuntor como qualquer outro.
 */

export interface ContextoDelegar {
  empresaId: string
  empresaNome?: string | null
  /** Os tipos que fazem sentido neste lugar. O primeiro é o padrão, salvo `tipoInicial`. */
  tipos: readonly TipoMandato[]
  tipoInicial?: TipoMandato
  /** Só originação de NF. */
  notaAccessKey?: string | null
  notaNumero?: string | null
  notaValor?: number | null
}

/** O gestor com o módulo Agentes. Enquanto a resposta não chega, é `false` (nada aparece). */
export function usePodeDelegar(): boolean {
  const permissoes = usePermissoesAgentes()
  return permissoes.data?.modulo === true && permissoes.data.gestor === true
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function objetivoPadrao(tipo: TipoMandato, c: ContextoDelegar): string {
  const empresa = c.empresaNome?.trim() || 'a empresa'
  switch (tipo) {
    case 'originacao_nf': {
      const nf = c.notaNumero ? `a NF ${c.notaNumero}` : 'a nota fiscal'
      const valor = c.notaValor ? ` (${BRL.format(c.notaValor)})` : ''
      return `Ofertar a antecipação d${nf}${valor} a ${empresa} e levar até a solicitação da operação.`
    }
    case 'agendamento_reuniao':
      return `Marcar uma reunião de ${empresa} com o closer, falando com quem decide sobre antecipação.`
    case 'reativacao':
      return `Reativar ${empresa}: entender por que parou de operar e marcar uma conversa com o closer.`
    case 'qualificacao':
      return `Qualificar ${empresa}: descobrir quem decide sobre antecipação de recebíveis e se há interesse.`
  }
}

/** O botão + diálogo, autogatilhado. Não renderiza nada para quem não é gestor com o módulo. */
export function DelegarAoAgente({
  contexto,
  bloqueio,
  tamanho = 'sm',
  variante = 'outline',
}: {
  contexto: ContextoDelegar
  /** Motivo para desabilitar (ex.: fornecedor sem ficha de empresa). Mostrado no title e abaixo. */
  bloqueio?: string | null
  tamanho?: 'sm' | 'default'
  variante?: 'outline' | 'default' | 'secondary' | 'ghost'
}) {
  const pode = usePodeDelegar()
  const [aberto, setAberto] = React.useState(false)
  if (!pode) return null

  return (
    <>
      <Button
        size={tamanho}
        variant={variante}
        onClick={() => setAberto(true)}
        disabled={Boolean(bloqueio)}
        title={bloqueio ?? 'Cria um mandato para um vendedor de IA perseguir este objetivo'}
      >
        <Bot aria-hidden />
        Delegar ao agente
      </Button>
      <DelegarAoAgenteDialog aberto={aberto} onOpenChange={setAberto} contexto={contexto} />
    </>
  )
}

export function DelegarAoAgenteDialog({
  aberto,
  onOpenChange,
  contexto: recebido,
}: {
  aberto: boolean
  onOpenChange: (v: boolean) => void
  contexto: ContextoDelegar
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const agentes = useAgentes(aberto)

  // O modal do funil comercial conhece a empresa só pelo id. O nome entra no objetivo
  // pré-preenchido ("Marcar uma reunião de Construtora X…"), então é buscado aqui — sob a
  // RLS de quem abriu, como qualquer leitura de `empresas`.
  const nome = useQuery({
    queryKey: [...agentesOpKeys.all, 'empresa-nome', recebido.empresaId],
    enabled: aberto && !recebido.empresaNome,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await createClient()
        .from('empresas')
        .select('razao_social, nome_fantasia')
        .eq('id', recebido.empresaId)
        .maybeSingle()
      return data ? data.nome_fantasia || data.razao_social : null
    },
  })
  const contexto: ContextoDelegar = { ...recebido, empresaNome: recebido.empresaNome ?? nome.data ?? null }

  const tipoPadrao = contexto.tipoInicial ?? contexto.tipos[0] ?? 'qualificacao'
  const [tipo, setTipo] = React.useState<TipoMandato>(tipoPadrao)
  const [objetivo, setObjetivo] = React.useState(() => objetivoPadrao(tipoPadrao, contexto))
  const [objetivoEditado, setObjetivoEditado] = React.useState(false)
  const [agenteId, setAgenteId] = React.useState<string | undefined>(undefined)
  const [orcamento, setOrcamento] = React.useState(textoDosCentavos(PADROES_MANDATO_MANUAL[tipoPadrao].orcamento_centavos))
  const [maxAcoes, setMaxAcoes] = React.useState(String(PADROES_MANDATO_MANUAL[tipoPadrao].max_acoes))
  const [prazoDias, setPrazoDias] = React.useState(String(PADROES_MANDATO_MANUAL[tipoPadrao].prazo_dias))
  const [prioridade, setPrioridade] = React.useState('50')
  const [salvando, setSalvando] = React.useState(false)

  // Reabrir (ou abrir para OUTRA empresa) recomeça do contexto: herdar o objetivo do
  // mandato anterior é o caminho mais curto para delegar a frase errada à empresa certa.
  const chaveContexto = `${contexto.empresaId}|${contexto.notaAccessKey ?? ''}`
  React.useEffect(() => {
    if (!aberto) return
    aplicarTipo(tipoPadrao, true)
    setPrioridade('50')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, chaveContexto])

  // O nome chegou depois de abrir: o objetivo pré-preenchido ganha o nome, se ninguém o editou.
  React.useEffect(() => {
    if (aberto && nome.data && !objetivoEditado) setObjetivo(objetivoPadrao(tipo, contexto))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome.data])

  function aplicarTipo(novo: TipoMandato, forcarObjetivo = false) {
    setTipo(novo)
    const p = PADROES_MANDATO_MANUAL[novo]
    setOrcamento(textoDosCentavos(p.orcamento_centavos))
    setMaxAcoes(String(p.max_acoes))
    setPrazoDias(String(p.prazo_dias))
    setAgenteId(undefined)
    if (forcarObjetivo || !objetivoEditado) {
      setObjetivo(objetivoPadrao(novo, contexto))
      setObjetivoEditado(false)
    }
  }

  // Originação fala como originador; o resto, como SDR (`tipoVendedorDoMandato`). Agente
  // inativo não recebe mandato — a RPC recusa.
  const tipoVendedor = tipoVendedorDoMandato(tipo)
  const opcoes = React.useMemo(
    () => (agentes.data ?? []).filter((a) => a.ativo && a.tipo === tipoVendedor),
    [agentes.data, tipoVendedor],
  )

  // Um agente só: já vem escolhido.
  React.useEffect(() => {
    if (!agenteId && opcoes.length === 1) setAgenteId(opcoes[0]!.id)
  }, [agenteId, opcoes])

  const centavos = centavosDoTexto(orcamento)
  const acoes = Number(maxAcoes)
  const dias = Number(prazoDias)
  const prio = Number(prioridade)
  const faltaNota = tipo === 'originacao_nf' && !contexto.notaAccessKey
  const valido =
    objetivo.trim().length >= 10 &&
    Boolean(agenteId) &&
    centavos !== null &&
    centavos <= 10_000_000 &&
    Number.isInteger(acoes) && acoes >= 1 && acoes <= 500 &&
    Number.isInteger(dias) && dias >= 1 && dias <= 180 &&
    Number.isInteger(prio) && prio >= 0 && prio <= 100 &&
    !faltaNota

  async function criar() {
    if (!valido || !agenteId || centavos === null) return
    setSalvando(true)
    const r = await criarMandatoAction({
      tipo,
      objetivo: objetivo.trim(),
      empresa_id: contexto.empresaId,
      nota_access_key: tipo === 'originacao_nf' ? (contexto.notaAccessKey ?? null) : null,
      agente_id: agenteId,
      orcamento_centavos: centavos,
      max_acoes: acoes,
      prazo_dias: dias,
      prioridade: prio,
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    void qc.invalidateQueries({ queryKey: agentesOpKeys.all })
    onOpenChange(false)
    toast.success(`Mandato ${r.data.codigo ?? ''} criado. O agente começa no próximo ciclo.`, {
      action: { label: 'Abrir', onClick: () => router.push(`/agentes/mandatos?m=${r.data.id}`) },
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delegar ao agente</DialogTitle>
          <DialogDescription>
            {contexto.empresaNome ? `${contexto.empresaNome}. ` : ''}O agente persegue o objetivo por quantos
            contatos, canais e dias forem necessários — dentro do orçamento, do máximo de ações e do prazo abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="delegar-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => aplicarTipo(v as TipoMandato)}>
                <SelectTrigger id="delegar-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contexto.tipos.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_MANDATO_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegar-agente">Agente</Label>
              <Select value={agenteId} onValueChange={setAgenteId} disabled={opcoes.length === 0}>
                <SelectTrigger id="delegar-agente">
                  <SelectValue
                    placeholder={
                      agentes.isPending ? 'Carregando…' : opcoes.length === 0 ? 'Nenhum agente disponível' : 'Escolha'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {opcoes.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {personaDoAgente(a).nome}
                      {!a.autonomo || a.pausado_em ? ' (pausado)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!agentes.isPending && opcoes.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Não há vendedor de IA {tipoVendedor === 'originador' ? 'originador' : 'SDR'} ativo — é ele quem fala
              em {TIPO_MANDATO_LABELS[tipo].toLowerCase()}.{' '}
              <Link href="/agentes/personas" className="underline underline-offset-2">
                Cadastre um em Personas
              </Link>
              .
            </p>
          ) : null}
          {faltaNota ? (
            <p className="text-xs text-destructive">Originação de NF precisa ser delegada a partir do card da nota.</p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="delegar-objetivo">Objetivo</Label>
            <Textarea
              id="delegar-objetivo"
              rows={3}
              maxLength={600}
              value={objetivo}
              onChange={(e) => {
                setObjetivo(e.target.value)
                setObjetivoEditado(true)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Em linguagem natural: é o que o agente lê a cada ciclo e o que aparece no Ao vivo.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="delegar-orcamento">Orçamento (R$)</Label>
              <Input id="delegar-orcamento" inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegar-acoes">Máx. ações</Label>
              <Input id="delegar-acoes" inputMode="numeric" value={maxAcoes} onChange={(e) => setMaxAcoes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegar-prazo">Prazo (dias)</Label>
              <Input id="delegar-prazo" inputMode="numeric" value={prazoDias} onChange={(e) => setPrazoDias(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegar-prioridade">Prioridade</Label>
              <Input
                id="delegar-prioridade"
                inputMode="numeric"
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value)}
                title="0 a 100. O ciclo pega primeiro os de prioridade maior."
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void criar()} disabled={salvando || !valido}>
            {salvando ? 'Criando…' : 'Criar mandato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
