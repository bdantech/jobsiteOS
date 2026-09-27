'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, CircleAlert, Lock, ShieldAlert } from 'lucide-react'
import { COBRANCA_ESTAGIOS_ENCERRADOS } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { atualizarCobrancaAction, criarSinistroAction } from '@/actions/cobranca'
import { cn } from '@/lib/utils'
import { AbaAcordo } from './aba-acordo'
import { AbaHistorico } from './aba-historico'
import { AbaNotificacoes } from './aba-notificacoes'
import { AbaProcesso } from './aba-processo'
import { AbaProtesto } from './aba-protesto'
import { AbaTitulos } from './aba-titulos'
import { Campo, MoverEstagioMenu } from './cobranca-detalhe-comum'
import {
  brl,
  cnpj,
  corDoPrazo,
  data,
  dataHora,
  estagioLabel,
  MARCO_APOLICE_LABELS,
  prazoTexto,
  sinistroEstagioLabel,
} from './format'
import {
  buscarCobranca,
  buscarSacadoBloqueado,
  buscarSinistrosDaCobranca,
  buscarUsuariosAtivos,
  cobrancaKeys,
} from './queries'

/**
 * O detalhe da cobrança (§3–§10).
 *
 * O cabeçalho fica FORA das abas, como na ficha do processo: estágio, valores, bloqueio
 * e o próximo prazo da apólice respondem "onde esta cobrança está", e sumir com eles ao
 * trocar de aba é o caminho mais curto para alguém enviar uma notificação sem ver que o
 * D+90 vence amanhã.
 */
export function CobrancaDetalhe({ cobrancaId }: { cobrancaId: string }) {
  const [aba, setAba] = React.useState('notificacoes')

  const cobranca = useQuery({ queryKey: cobrancaKeys.cobranca(cobrancaId), queryFn: () => buscarCobranca(cobrancaId) })
  const c = cobranca.data

  const bloqueio = useQuery({
    queryKey: cobrancaKeys.bloqueio(c?.sacado_matriz_cnpj ?? ''),
    queryFn: () => buscarSacadoBloqueado(c!.sacado_matriz_cnpj!),
    enabled: Boolean(c?.sacado_matriz_cnpj),
  })
  const sinistros = useQuery({
    queryKey: cobrancaKeys.sinistros(cobrancaId),
    queryFn: () => buscarSinistrosDaCobranca(cobrancaId),
  })

  if (cobranca.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!c || !c.id) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CircleAlert className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {cobranca.error instanceof Error ? cobranca.error.message : 'Cobrança não encontrada.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/cobranca/cobrancas">Voltar</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const encerrada = (COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(c.estagio ?? '')
  const dias = c.dias_restantes

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cobranca/cobrancas">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Cobranças
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {!encerrada && c.estagio !== 'rascunho' ? <AbrirSinistro cobrancaId={c.id} /> : null}
          {c.estagio ? <MoverEstagioMenu cobrancaId={c.id} estagio={c.estagio} qtdAtivos={c.qtd_ativos ?? 0} /> : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span className="font-mono">{c.codigo ?? '—'}</span>
                <Badge variant={encerrada ? 'neutral' : 'secondary'}>{estagioLabel(c.estagio)}</Badge>
              </CardTitle>
              <p className="mt-1 text-sm">
                {c.sacado_empresa_id ? (
                  <Link href={`/empresas/${c.sacado_empresa_id}`} className="font-medium underline-offset-2 hover:underline">
                    {c.sacado_razao_social ?? cnpj(c.sacado_matriz_cnpj)}
                  </Link>
                ) : (
                  <span className="font-medium">{c.sacado_razao_social ?? cnpj(c.sacado_matriz_cnpj)}</span>
                )}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  matriz {cnpj(c.sacado_matriz_cnpj)}
                  {(c.qtd_spes ?? 0) > 0 ? ` · ${c.qtd_spes} SPE/filial` : ''}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {bloqueio.data ? (
                <Badge variant="critical" className="gap-1" title="Novas análises, operações e campanhas do grupo estão suspensas.">
                  <Lock className="h-3 w-3" aria-hidden />
                  Grupo bloqueado por cobrança
                </Badge>
              ) : null}
              {c.aceite_apolice_em ? (
                <Badge variant="neutral" title={`Aceito em ${dataHora(c.aceite_apolice_em)}`}>
                  Aviso da apólice aceito
                </Badge>
              ) : !encerrada ? (
                <Badge variant="warning" className="gap-1">
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                  Aviso da apólice pendente
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Valor de face">
            {brl(c.valor_face)}
            <span className="block text-xs text-muted-foreground">{c.qtd_titulos ?? 0} título(s)</span>
          </Campo>
          <Campo rotulo="Em aberto">
            {brl(c.valor_em_aberto)}
            <span className="block text-xs text-muted-foreground">{c.qtd_ativos ?? 0} título(s) ativos</span>
          </Campo>
          <Campo rotulo="Valor atualizado">
            {c.valor_atualizado === null ? (
              <span className="text-xs text-muted-foreground">sem cálculo gravado</span>
            ) : (
              <>
                {brl(c.valor_atualizado)}
                <span className="block text-xs text-muted-foreground">em {dataHora(c.valor_atualizado_em)}</span>
              </>
            )}
          </Campo>
          <Campo rotulo="Próximo prazo da apólice">
            {c.proximo_marco ? (
              <>
                {MARCO_APOLICE_LABELS[c.proximo_marco] ?? c.proximo_marco}
                <span className={cn('block text-xs tabular-nums', corDoPrazo(dias))}>
                  {data(c.proximo_marco_em)} · {prazoTexto(dias)}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">sem prazo ativo</span>
            )}
          </Campo>
          <Campo rotulo="Notificada em">
            {c.notificada_em ? dataHora(c.notificada_em) : <span className="text-xs text-muted-foreground">ainda não enviada</span>}
            {c.dias_desde_notificacao !== null ? (
              <span className="block text-xs text-muted-foreground">há {c.dias_desde_notificacao} dia(s)</span>
            ) : null}
          </Campo>
          <Campo rotulo="Processo">
            {c.processo_cnj ? (
              <Link href={`/juridico/${c.processo_cnj}`} className="font-mono text-xs underline-offset-2 hover:underline">
                {c.processo_cnj}
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">não judicializada</span>
            )}
          </Campo>
          <Campo rotulo="Sinistro">
            {(sinistros.data ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">nenhum</span>
            ) : (
              (sinistros.data ?? []).map((s) => (
                <Link key={s.id} href={`/cobranca/sinistros/${s.id}`} className="block text-xs underline-offset-2 hover:underline">
                  {s.codigo ?? s.id.slice(0, 8)} · {sinistroEstagioLabel(s.estagio)}
                </Link>
              ))
            )}
          </Campo>
          <Responsavel cobrancaId={c.id} responsavelId={c.responsavel_id} />
          {encerrada && c.motivo_encerramento ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <Campo rotulo="Encerramento">
                {dataHora(c.encerrada_em)} — {c.motivo_encerramento}
              </Campo>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={aba} onValueChange={setAba} className="space-y-3">
        <TabsList className="flex-wrap">
          <TabsTrigger value="titulos">Títulos</TabsTrigger>
          <TabsTrigger value="notificacoes">Notificações</TabsTrigger>
          <TabsTrigger value="acordo">Acordo</TabsTrigger>
          <TabsTrigger value="protesto">Protesto</TabsTrigger>
          <TabsTrigger value="processo">Processo</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="titulos" className="mt-0">
          <AbaTitulos cobranca={c} />
        </TabsContent>
        <TabsContent value="notificacoes" className="mt-0">
          <AbaNotificacoes cobranca={c} />
        </TabsContent>
        <TabsContent value="acordo" className="mt-0">
          <AbaAcordo cobranca={c} />
        </TabsContent>
        <TabsContent value="protesto" className="mt-0">
          <AbaProtesto cobranca={c} />
        </TabsContent>
        <TabsContent value="processo" className="mt-0">
          <AbaProcesso cobranca={c} />
        </TabsContent>
        <TabsContent value="historico" className="mt-0">
          <AbaHistorico cobranca={c} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Responsavel({ cobrancaId, responsavelId }: { cobrancaId: string; responsavelId: string | null }) {
  const qc = useQueryClient()
  const usuarios = useQuery({ queryKey: cobrancaKeys.usuarios(), queryFn: buscarUsuariosAtivos })
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Responsável</div>
      <Select
        value={responsavelId ?? 'nenhum'}
        onValueChange={async (v) => {
          const r = await atualizarCobrancaAction({ id: cobrancaId, responsavel_id: v === 'nenhum' ? null : v })
          if (!r.ok) {
            toast.error(r.message)
            return
          }
          void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
          toast.success('Responsável atualizado.')
        }}
      >
        <SelectTrigger className="mt-0.5 h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="nenhum">Sem responsável</SelectItem>
          {(usuarios.data ?? []).map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * "Abrir sinistro" a partir da cobrança (§7). O RPC leva os títulos ainda devidos,
 * resolve a apólice e a Data da Perda pelo relógio e semeia o checklist do dossiê; a
 * gestão do sinistro continua na tela dele.
 */
function AbrirSinistro({ cobrancaId }: { cobrancaId: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [aberto, setAberto] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  async function criar() {
    setCriando(true)
    const r = await criarSinistroAction({ cobranca_id: cobrancaId })
    setCriando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success(`Sinistro ${r.data.codigo ?? ''} aberto.`)
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
    router.push(`/cobranca/sinistros/${r.data.id}`)
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <ShieldAlert className="mr-1 h-4 w-4" aria-hidden />
        Abrir sinistro
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir sinistro</DialogTitle>
            <DialogDescription>
              Entram os títulos ainda devidos desta cobrança (em cobrança, em acordo ou protestados), que
              passam a “sinistrado”. A apólice, a causa e a Data da Perda vêm do relógio da apólice, e o
              checklist do dossiê (cl. 22208.00) é semeado já com o que o sistema tem. Nada é enviado à
              seguradora agora.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button disabled={criando} onClick={criar}>
              {criando ? 'Abrindo…' : 'Abrir sinistro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
