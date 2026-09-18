'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PhoneOutgoing, Headphones } from 'lucide-react'
import { toast } from 'sonner'
import { MOTIVO_NAO_LIGAR_LABELS, type MotivoNaoLigar } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { enfileirarLigacaoAction } from '@/actions/comunicacao'
import { formatarMoeda, formatarData } from '@/components/antecipacao/format'
import { buscarCandidatasDeVoz, buscarLigacoesDeVoz, type LigacaoDeVoz } from './queries'
import { dataHora, telefoneLegivel } from './format'

/**
 * A fila da Ana, feita à mão.
 *
 * ── POR QUE UMA TELA, SE EXISTE O CRON ─────────────────────────────────────
 * O cron decide por régua e roda de manhã. Esta tela é para quando alguém
 * DECIDE: "essa nota aqui, hoje, agora". Mesma fila, mesmo portão, mesma Ana —
 * muda só quem apertou o botão, e isso fica gravado.
 *
 * ── A METADE QUE PARECE INÚTIL É A MAIS IMPORTANTE ─────────────────────────
 * A lista de recusadas, com o motivo. Sem ela, "a Ana não ligou para ninguém"
 * vira caça a bug onde existe regra: vencimento estimado, contato sem base
 * legal, número no Procon. Com ela, o time vê a fila que NÃO existe e por quê.
 */

type VarianteBadge = 'success' | 'warning' | 'critical' | 'info' | 'neutral'

const STATUS_TOM: Record<string, VarianteBadge> = {
  a_enviar: 'info',
  enviada: 'info',
  concluida: 'success',
  nao_atendida: 'neutral',
  falhou: 'critical',
  cancelada: 'neutral',
  recusada: 'warning',
}

const STATUS_LABEL: Record<string, string> = {
  a_enviar: 'Na fila',
  enviada: 'Com a Ana',
  concluida: 'Conversou',
  nao_atendida: 'Não atendeu',
  falhou: 'Falhou',
  cancelada: 'Cancelada',
  recusada: 'Não vai ligar',
}

const DESFECHO_LABEL: Record<string, string> = {
  antecipacao_solicitada: 'Antecipação solicitada',
  cadastro_iniciado: 'Cadastro iniciado',
  proposta_enviada: 'Proposta enviada',
  interesse_futuro: 'Interesse futuro',
  retorno_agendado: 'Retorno agendado',
  agendado_com_decisor: 'Agendado com quem decide',
  quer_negociar: 'Quer negociar',
  transferido_humano: 'Transferido',
  pediu_para_nao_contatar: 'Pediu para não contatar',
  recusa: 'Recusou',
  objecao_taxa: 'Objeção à taxa',
  nao_tem_interesse: 'Sem interesse',
  pessoa_errada: 'Pessoa errada',
  caixa_postal: 'Caixa postal',
  nao_atendeu: 'Não atendeu',
  indefinido: 'Indefinido',
}

function LinhaDaFila({ l }: { l: LigacaoDeVoz }) {
  const painel = l.resultado?.links?.painel ?? null
  return (
    <TableRow>
      <TableCell className="font-medium">
        {l.fornecedor_cnpj}
        {l.tentativa > 1 ? (
          <span className="ml-2 text-xs text-muted-foreground">{l.tentativa}ª tentativa</span>
        ) : null}
        {l.resumo ? <p className="text-xs text-muted-foreground">{l.resumo}</p> : null}
      </TableCell>
      <TableCell className="whitespace-nowrap">{telefoneLegivel(l.telefone ?? '')}</TableCell>
      <TableCell>
        <Badge variant={STATUS_TOM[l.status] ?? 'neutral'}>{STATUS_LABEL[l.status] ?? l.status}</Badge>
        {l.motivo_recusa ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {MOTIVO_NAO_LIGAR_LABELS[l.motivo_recusa as MotivoNaoLigar] ?? l.motivo_recusa}
          </p>
        ) : null}
        {l.erro ? <p className="mt-1 text-xs text-muted-foreground">{l.erro}</p> : null}
      </TableCell>
      <TableCell>{l.outcome ? (DESFECHO_LABEL[l.outcome] ?? l.outcome) : '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {l.origem === 'manual' ? 'manual' : 'régua'}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {dataHora(l.criada_em)}
      </TableCell>
      <TableCell className="text-right">
        {painel ? (
          <Button asChild size="sm" variant="ghost">
            <a href={painel} target="_blank" rel="noreferrer">
              <Headphones className="h-4 w-4" aria-hidden /> Ouvir
            </a>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

export function VozLigacoes() {
  const qc = useQueryClient()
  const fila = useQuery({ queryKey: ['comunicacao', 'voz', 'fila'], queryFn: buscarLigacoesDeVoz })
  const candidatas = useQuery({
    queryKey: ['comunicacao', 'voz', 'candidatas'],
    queryFn: buscarCandidatasDeVoz,
  })

  const enfileirar = useMutation({
    mutationFn: async (v: { accessKey: string; contatoId: string | null }) =>
      enfileirarLigacaoAction({ accessKey: v.accessKey, contatoId: v.contatoId }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.message)
        return
      }
      toast.success(
        r.data.tentativa > 1
          ? `Na fila — ${r.data.tentativa}ª tentativa desta nota.`
          : 'Na fila. A Ana liga quando for a vez dela.',
      )
      void qc.invalidateQueries({ queryKey: ['comunicacao', 'voz'] })
    },
  })

  if (fila.isLoading || candidatas.isLoading) return <Skeleton className="h-64" />

  const linhas = fila.data ?? []
  const naFila = linhas.filter((l) => l.status === 'a_enviar' || l.status === 'enviada')
  const encerradas = linhas.filter((l) => l.status !== 'a_enviar' && l.status !== 'enviada')
  const podem = (candidatas.data ?? []).filter((c) => c.veredicto.pode)
  const naoPodem = (candidatas.data ?? []).filter((c) => !c.veredicto.pode)

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Prontas para ligar <span className="text-muted-foreground">({podem.length})</span>
        </h2>
        {podem.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Nenhuma nota passa no portão agora. A lista abaixo diz o que está faltando em cada uma.
          </p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Quem atende</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Ligar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {podem.map((c) => (
                  <TableRow key={c.nota.access_key}>
                    <TableCell className="font-medium">{c.nota.fornecedor_nome ?? '—'}</TableCell>
                    <TableCell>
                      {c.contato?.nome ?? '—'}
                      <p className="text-xs text-muted-foreground">
                        {telefoneLegivel(c.contato?.telefone_e164 ?? '')}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{c.nota.numero ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {formatarMoeda(
                        Number(c.nota.valor ?? 0) - Number(c.nota.receita_esperada ?? 0),
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatarData(c.nota.vencimento)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={enfileirar.isPending}
                        onClick={() =>
                          enfileirar.mutate({
                            accessKey: c.nota.access_key,
                            contatoId: c.contatoId,
                          })
                        }
                      >
                        <PhoneOutgoing className="h-4 w-4" aria-hidden /> Colocar na fila
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {naoPodem.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            Não vão ser ligadas <span className="text-muted-foreground">({naoPodem.length})</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            A Ana fala o líquido, a taxa e o vencimento em voz alta, numa ligação gravada. Dado
            duvidoso não vira ligação com ressalva — vira ligação que não acontece.
          </p>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Por quê</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {naoPodem.map((c) => (
                  <TableRow key={c.nota.access_key}>
                    <TableCell className="font-medium">{c.nota.fornecedor_nome ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.nota.numero ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="warning">
                        {c.veredicto.pode
                          ? ''
                          : MOTIVO_NAO_LIGAR_LABELS[c.veredicto.motivo as MotivoNaoLigar]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          Na fila <span className="text-muted-foreground">({naFila.length})</span>
        </h2>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Desfecho</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {naFila.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Nada esperando. A Ana liga uma por vez, em horário comercial.
                  </TableCell>
                </TableRow>
              ) : (
                naFila.map((l) => <LinhaDaFila key={l.id_externo} l={l} />)
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Encerradas</h2>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Desfecho</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {encerradas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    Nenhuma ligação encerrada ainda.
                  </TableCell>
                </TableRow>
              ) : (
                encerradas.slice(0, 50).map((l) => <LinhaDaFila key={l.id_externo} l={l} />)
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
