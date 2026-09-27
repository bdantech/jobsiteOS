'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, Camera, Pencil, Plus } from 'lucide-react'
import {
  ESTADO_DISJUNTOR_LABELS,
  personaSchema,
  type EstadoDisjuntor,
} from '@jobsiteos/core'
import { Badge, STATUS_SUPERFICIE } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DisjuntorCard } from './disjuntor-card'
import { PersonaForm } from './personas-form'
import {
  buscarAgentesIa,
  buscarCaixas,
  buscarClosers,
  buscarConfigAgentes,
  buscarContasIa,
  buscarDisjuntores,
  gestaoAgentesKeys,
  urlAssinadaMaterial,
  type AgenteIa,
  type ContaIa,
  type Disjuntor,
} from './queries-gestao'
import { SomenteGestores } from './somente-gestores'

/**
 * PERSONAS (Prompt 09 §11.3) — a lista dos vendedores de IA e o cadastro de cada um.
 *
 * O cartão mostra o que decide se o agente está REALMENTE trabalhando, não só se está
 * cadastrado: autonomia, linha de WhatsApp, pausa e disjuntor. Um agente "ativo" sem
 * linha ou com o disjuntor aberto não fala com ninguém — e isso tem de saltar aos olhos
 * na lista, antes de alguém se perguntar por que o Ao vivo está parado.
 *
 * O editor abre NO LUGAR da lista, não num modal: são cinco seções e quatro construtores
 * de filtro, e um diálogo com rolagem dupla é como se salva um escopo sem ter visto a
 * contagem dele.
 */
export function PersonasTela() {
  return (
    <SomenteGestores titulo="O cadastro de personas">
      <Personas />
    </SomenteGestores>
  )
}

const TOM_DISJUNTOR: Record<EstadoDisjuntor, 'success' | 'warning' | 'critical'> = {
  ok: 'success',
  alerta: 'warning',
  aberto: 'critical',
}

function Personas() {
  const [editando, setEditando] = React.useState<string | 'novo' | null>(null)

  const agentes = useQuery({ queryKey: gestaoAgentesKeys.personas(), queryFn: buscarAgentesIa })
  const disjuntores = useQuery({ queryKey: gestaoAgentesKeys.disjuntores(), queryFn: buscarDisjuntores })
  const contas = useQuery({ queryKey: gestaoAgentesKeys.contasIa(), queryFn: buscarContasIa })
  const caixas = useQuery({ queryKey: gestaoAgentesKeys.caixas(), queryFn: buscarCaixas })
  const closers = useQuery({ queryKey: gestaoAgentesKeys.closers(), queryFn: buscarClosers })
  const config = useQuery({ queryKey: gestaoAgentesKeys.config(), queryFn: buscarConfigAgentes })

  const carregando =
    agentes.isPending || disjuntores.isPending || contas.isPending || caixas.isPending || closers.isPending || config.isPending
  if (carregando) return <Skeleton className="h-96 w-full" />

  const erro = [agentes, disjuntores, contas, caixas, closers, config].find((q) => q.isError)?.error
  if (erro || !agentes.data || !config.data) {
    return (
      <div className={cn('rounded-lg border p-4 text-sm', STATUS_SUPERFICIE.critical)}>
        Não foi possível carregar as personas: {erro instanceof Error ? erro.message : 'erro desconhecido'}.
      </div>
    )
  }

  const lista = agentes.data
  const porDisjuntor = new Map((disjuntores.data ?? []).map((d) => [d.agente_id, d]))
  const contasIa = contas.data ?? []

  if (editando !== null) {
    const agente = editando === 'novo' ? null : (lista.find((a) => a.id === editando) ?? null)
    return (
      <div className="space-y-4">
        <PersonaForm
          key={agente?.id ?? 'novo'}
          agente={agente}
          agentes={lista}
          contasIa={contasIa}
          caixas={caixas.data ?? []}
          closers={closers.data ?? []}
          config={config.data.config}
          onFechar={() => setEditando(null)}
          onSalvo={(id) => setEditando(id)}
        />
        {agente ? <DisjuntorCard agente={agente} disjuntor={porDisjuntor.get(agente.id)} /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-lg font-semibold">Personas</h2>
          <p className="text-sm text-muted-foreground">
            Cada agente de IA é um vendedor completo: persona, linha de WhatsApp própria, caixa de
            e-mail, conta de voz, closer designado, escopo, cotas e disjuntor.
          </p>
        </div>
        <Button onClick={() => setEditando('novo')}>
          <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo agente
        </Button>
      </div>

      {contasIa.length === 0 ? (
        <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', STATUS_SUPERFICIE.warning)}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Hoje existem <strong>0 contas de WhatsApp do tipo IA</strong>. Dá para cadastrar agentes,
            mas nenhum pode ficar autônomo sem linha própria. Cadastre as linhas em{' '}
            <Link href="/comunicacao/config" className="font-medium underline underline-offset-2">
              Comunicação › Contas de WhatsApp
            </Link>
            .
          </p>
        </div>
      ) : null}

      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <div className="rounded-full bg-muted p-3">
            <Bot className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Nenhum agente cadastrado</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Sem agente, nenhuma regra de mandato tem a quem entregar e o Ao vivo fica vazio. Crie o
              primeiro — ele nasce desligado (sem autonomia) até você escolher a linha e o escopo.
            </p>
          </div>
          <Button onClick={() => setEditando('novo')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Novo agente
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((a) => (
            <CartaoPersona
              key={a.id}
              agente={a}
              disjuntor={porDisjuntor.get(a.id)}
              conta={contasIa.find((c) => c.id === a.whatsapp_conta_id) ?? null}
              onEditar={() => setEditando(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CartaoPersona({
  agente,
  disjuntor,
  conta,
  onEditar,
}: {
  agente: AgenteIa
  disjuntor: Disjuntor | undefined
  conta: ContaIa | null
  onEditar: () => void
}) {
  const persona = personaSchema.partial().safeParse(agente.persona ?? {})
  const p = persona.success ? persona.data : {}
  const foto = useQuery({
    queryKey: [...gestaoAgentesKeys.all, 'foto', p.foto_path ?? null],
    queryFn: () => urlAssinadaMaterial(p.foto_path as string),
    enabled: Boolean(p.foto_path),
    staleTime: 5 * 60_000,
  })
  const estado = (disjuntor?.estado ?? 'ok') as EstadoDisjuntor

  // O que impede o agente de trabalhar, na ordem em que o gestor precisa resolver.
  const impedimentos: string[] = []
  if (!agente.ativo) impedimentos.push('Inativo')
  else {
    if (!agente.autonomo) impedimentos.push('Autonomia desligada')
    if (!conta) impedimentos.push('Sem linha de WhatsApp')
    else if (!conta.ativo) impedimentos.push('Linha de WhatsApp inativa')
    if (agente.pausado_em) impedimentos.push(`Pausado${agente.pausado_motivo ? `: ${agente.pausado_motivo}` : ''}`)
    if (estado === 'aberto') impedimentos.push('Disjuntor aberto')
  }

  return (
    <Card className={cn(!agente.ativo && 'opacity-70')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
            {foto.data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto.data} alt="" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-5 w-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{agente.nome}</p>
            <p className="truncate text-xs text-muted-foreground">
              {p.nome_exibicao ? `Apresenta-se como ${p.nome_exibicao} · ` : ''}
              {agente.tipo === 'originador' ? 'Originador (NFs)' : 'SDR (reuniões)'}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onEditar} aria-label={`Editar ${agente.nome}`}>
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {impedimentos.length === 0 ? <Badge variant="success">Trabalhando</Badge> : null}
          <Badge variant={agente.modo_rodagem === 'pleno' ? 'info' : 'neutral'}>
            {agente.modo_rodagem === 'pleno' ? 'Pleno' : 'Piloto'}
          </Badge>
          <Badge variant={TOM_DISJUNTOR[estado]}>{ESTADO_DISJUNTOR_LABELS[estado] ?? estado}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Linha: {conta ? `${conta.apelido} · ${conta.numero}` : 'nenhuma'}
        </p>

        {impedimentos.length > 0 ? (
          <ul className={cn('space-y-0.5 rounded-md border p-2 text-xs', STATUS_SUPERFICIE.warning)}>
            {impedimentos.map((i) => (
              <li key={i}>• {i}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
