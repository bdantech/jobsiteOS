'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Coins, Inbox, Target, Users } from 'lucide-react'
import {
  ESTAGIO_SDR_LABELS,
  ESTAGIO_VENDA_LABELS,
  STATUS_LANCAMENTO_LABELS,
  TIPO_VENDEDOR_LABELS,
  type EstagioSdr,
  type EstagioVenda,
  type StatusLancamento,
  type TipoVendedorId,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarResumo, buscarVendedoresVisiveis, comercialKeys } from './queries'

/**
 * "Meu Painel" — a primeira tela de quem vende, montada pelo TIPO do vendedor.
 *
 * Um SDR não tem funil de vendas e um originador não tem funil de reuniões. Mostrar
 * cards zerados para as duas coisas transformaria o painel numa lista de trabalhos que
 * não são seus, e a pessoa aprenderia a ignorar o painel inteiro.
 */

const brl = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function Numero({
  icone: Icone,
  rotulo,
  valor,
  href,
  nota,
}: {
  icone: typeof Target
  rotulo: string
  valor: string
  href?: string
  nota?: string
}) {
  const corpo = (
    <Card className={href ? 'transition-colors hover:border-primary' : undefined}>
      <CardContent className="space-y-1 pt-6">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icone className="h-3.5 w-3.5" aria-hidden />
          {rotulo}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        {nota ? <p className="text-xs text-muted-foreground">{nota}</p> : null}
      </CardContent>
    </Card>
  )
  return href ? <Link href={href}>{corpo}</Link> : corpo
}

function Contagens({
  titulo,
  dados,
  labels,
  href,
}: {
  titulo: string
  dados: Record<string, number>
  labels: Record<string, string>
  href: string
}) {
  const linhas = Object.entries(dados).filter(([, n]) => n > 0)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <Link href={href} className="hover:underline">
            {titulo}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada no funil ainda.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {linhas.map(([estagio, n]) => (
              <li key={estagio} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{labels[estagio] ?? estagio}</span>
                <span className="font-medium tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function MeuPainel({ ehGestor }: { ehGestor: boolean }) {
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)

  // Quem eu posso ABRIR, não quem existe: para o gestor dá na mesma, mas um closer com
  // acesso cruzado passa a ter o seletor — que é o único lugar onde esse acesso aparece.
  const vendedores = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const { data, isPending } = useQuery({
    queryKey: comercialKeys.resumo(vendedorId),
    queryFn: () => buscarResumo(vendedorId),
  })

  if (isPending) return <Skeleton className="h-64 w-full" />
  if (!data?.tem_acesso) {
    return <p className="text-sm text-muted-foreground">Sem acesso ao módulo Comercial.</p>
  }

  const tipo = (data.vendedor?.tipo ?? null) as TipoVendedorId | null

  // O seletor aparece quando há painel de OUTRA pessoa ao alcance. Para o gestor isso é
  // sempre; para um vendedor, só se alguém lhe deu acesso cruzado — e é aí que esse
  // acesso vira visível na tela, em vez de ser uma linha de banco que ninguém percebe.
  const outros = (vendedores.data ?? []).filter((v) => v.id !== data.vendedor?.id)
  const seletor =
    outros.length > 0 ? (
      <Select value={vendedorId ?? 'eu'} onValueChange={(v) => setVendedorId(v === 'eu' ? null : v)}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Ver painel de…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="eu">Meu painel</SelectItem>
          {(vendedores.data ?? []).map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.nome} · {TIPO_VENDEDOR_LABELS[v.tipo as TipoVendedorId] ?? v.tipo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null

  // Gestor sem cadastro de vendedor é normal: ele administra, não vende. Dizer "sem
  // funil" é diferente de "sem acesso", e confundir os dois manda a pessoa pedir uma
  // permissão que ela já tem.
  if (data.sem_vendedor && !vendedorId) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Comercial</h1>
          {seletor}
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Seu usuário não está cadastrado como vendedor — você administra o módulo.
            {(vendedores.data ?? []).length > 0
              ? ' Use o seletor acima para abrir o painel de alguém.'
              : ' Cadastre o primeiro vendedor em Configurações.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{data.vendedor?.nome ?? 'Meu painel'}</h1>
          <p className="text-sm text-muted-foreground">
            {tipo ? (TIPO_VENDEDOR_LABELS[tipo] ?? tipo) : '—'}
            {data.vendedor?.is_ia ? ' · vendedor de IA' : ''}
          </p>
        </div>
        {seletor}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Numero
          icone={Coins}
          rotulo="Comissão do mês"
          valor={brl(data.comissao_mes.total)}
          href="/comercial/comissoes"
          nota={
            Object.entries(data.comissao_mes.por_status)
              .map(([s, v]) => `${STATUS_LANCAMENTO_LABELS[s as StatusLancamento] ?? s}: ${brl(v)}`)
              .join(' · ') || 'Nada apurado ainda'
          }
        />
        {tipo === 'originador' && (
          <Numero icone={Inbox} rotulo="NFs vivas na carteira" valor={String(data.nfs_vivas)} href="/antecipacao" />
        )}
        {tipo === 'vendedor' && (
          <Numero
            icone={Users}
            rotulo="Contas passivas geridas"
            valor={String(data.passivas_geridas)}
            nota="O volume delas entra na sua comissão"
          />
        )}
        <Numero
          icone={CalendarDays}
          rotulo="Próximas reuniões"
          valor={String(data.proximas_reunioes.length)}
          href="/comercial/calendario"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(tipo === 'sdr' || ehGestor) && (
          <Contagens
            titulo="Funil de reuniões"
            dados={data.leads_por_estagio}
            labels={ESTAGIO_SDR_LABELS as Record<EstagioSdr, string>}
            href="/comercial/sdr"
          />
        )}
        {(tipo === 'vendedor' || ehGestor) && (
          <Contagens
            titulo="Funil de vendas"
            dados={data.vendas_por_estagio}
            labels={ESTAGIO_VENDA_LABELS as Record<EstagioVenda, string>}
            href="/comercial/vendas"
          />
        )}
      </div>

      {data.proximas_reunioes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Agenda</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.proximas_reunioes.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span>{e.titulo}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px] tabular-nums">
                    {new Date(e.inicio_em).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
