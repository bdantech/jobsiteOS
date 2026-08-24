'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { AlertTriangle, Clock, PiggyBank, ShieldCheck, ShieldOff } from 'lucide-react'
import { formatCnpj } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { buscarCarteiraCredito, creditoKeys, type LinhaCarteira } from './queries'

/**
 * A carteira: limite concedido na plataforma × cobertura vigente na seguradora.
 *
 * ── POR QUE A PÁGINA É UM NÚMERO, E NÃO UMA LISTA ────────────────────────────
 * A lista responde "quais empresas"; o cabeçalho responde "quanto estamos arriscando sem
 * seguro". A segunda é a pergunta que faz alguém agir, e ela tem que estar visível antes
 * de qualquer rolagem. A lista é o detalhamento de como chegar nela.
 *
 * ── AS QUATRO SITUAÇÕES TÊM DONOS DIFERENTES ─────────────────────────────────
 * `descoberto` e `parcial` são risco, e são do Crédito. `ocioso` é prêmio pago sem uso, e é
 * do Comercial. `aguardando_plataforma` é trabalho em andamento — a esteira aprovou e o
 * limite ainda não apareceu do outro lado. Misturá-las numa lista só produziria uma tela
 * que ninguém sabe de quem é.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const SITUACOES = {
  descoberto: {
    label: 'Descoberto',
    descricao: 'Limite operando sem nenhuma cobertura.',
    Icon: ShieldOff,
    classe: 'border-destructive/40 bg-destructive/5',
    badge: 'destructive' as const,
  },
  parcial: {
    label: 'Parcialmente coberto',
    descricao: 'A cobertura não alcança o limite concedido.',
    Icon: AlertTriangle,
    classe: 'border-amber-500/40 bg-amber-500/5',
    badge: 'secondary' as const,
  },
  coberto: {
    label: 'Coberto',
    descricao: 'A cobertura ampara todo o limite.',
    Icon: ShieldCheck,
    classe: 'border-emerald-500/40 bg-emerald-500/5',
    badge: 'outline' as const,
  },
  ocioso: {
    label: 'Cobertura ociosa',
    descricao: 'Seguro vigente sem limite concedido na plataforma.',
    Icon: PiggyBank,
    classe: 'border-border',
    badge: 'outline' as const,
  },
  aguardando_plataforma: {
    label: 'Aguardando a plataforma',
    descricao: 'A esteira aprovou; o limite ainda não veio do outro lado.',
    Icon: Clock,
    classe: 'border-border',
    badge: 'outline' as const,
  },
} as const

type Situacao = keyof typeof SITUACOES

function ehSituacao(v: string | null): v is Situacao {
  return v !== null && v in SITUACOES
}

/** A ordem é de urgência, não alfabética: quem abre a tela tem que ver o risco primeiro. */
const ORDEM: Situacao[] = ['descoberto', 'parcial', 'aguardando_plataforma', 'ocioso', 'coberto']

function Tile({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string
  valor: string
  detalhe: string
  destaque?: boolean
}) {
  return (
    <div className={destaque ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-4' : 'rounded-lg border p-4'}>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={destaque ? 'text-2xl font-semibold tabular-nums text-destructive' : 'text-2xl font-semibold tabular-nums'}>
        {valor}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detalhe}</p>
    </div>
  )
}

function Linha({ l }: { l: LinhaCarteira }) {
  const s = ehSituacao(l.situacao) ? SITUACOES[l.situacao] : null
  const nome = l.razao_social ?? l.company_name ?? '—'
  const concedido = Number(l.limite_concedido ?? 0)
  const segurado = Number(l.limite_segurado ?? 0)
  const descoberto = Number(l.descoberto ?? 0)
  const consumido = l.consumed_limit === null ? null : Number(l.consumed_limit)
  // Sem limite concedido não há o que cobrir, e uma barra de 0% mentiria sobre a situação:
  // cobertura ociosa não é uma falha de cobertura, é falta de uso.
  const pct = concedido > 0 ? Math.min(100, Math.round((segurado / concedido) * 100)) : null

  return (
    <div className="grid grid-cols-12 items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
      <div className="col-span-12 min-w-0 sm:col-span-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {l.empresa_id ? (
            <Link href={`/empresas/${l.empresa_id}`} className="truncate font-medium hover:underline">
              {nome}
            </Link>
          ) : (
            <span className="truncate font-medium">{nome}</span>
          )}
          {s && (
            <Badge variant={s.badge} className="shrink-0 text-[10px]">
              {s.label}
            </Badge>
          )}
          {/* A divergência que só esta tela enxerga: a plataforma acha que tem seguro e a
              seguradora não confirma. É bug de dado de alguém, e hoje ninguém olha. */}
          {l.plataforma_diz_ter_seguro && segurado === 0 && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              plataforma diz ter
            </Badge>
          )}
        </div>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {l.cnpj ? formatCnpj(l.cnpj) : '—'}
        </p>
      </div>

      <div className="col-span-3 text-right tabular-nums sm:col-span-2">
        {concedido > 0 ? BRL.format(concedido) : <span className="text-muted-foreground">—</span>}
      </div>
      <div className="col-span-3 text-right tabular-nums sm:col-span-2">
        {consumido !== null && consumido > 0 ? (
          <>
            <span>{BRL.format(consumido)}</span>
            {/* O consumo é o que está EM RISCO agora, e por isso ele ganha o percentual:
                um limite de 5 milhões com 90% usado e sem seguro não é o mesmo problema
                que um limite de 5 milhões parado. */}
            {concedido > 0 && (
              <span className="ml-1 text-[11px] text-muted-foreground">
                {Math.round((consumido / concedido) * 100)}%
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div className="col-span-3 text-right tabular-nums sm:col-span-2">
        {segurado > 0 ? BRL.format(segurado) : <span className="text-muted-foreground">—</span>}
      </div>
      <div className="col-span-3 text-right tabular-nums sm:col-span-2">
        {descoberto > 0 ? (
          <span className="font-medium text-destructive">{BRL.format(descoberto)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {pct !== null && (
          <span className="ml-1 text-[11px] text-muted-foreground">{pct}% seg.</span>
        )}
      </div>
    </div>
  )
}

export function CarteiraCredito() {
  const [busca, setBusca] = React.useState('')
  const [filtro, setFiltro] = React.useState<Situacao | null>(null)

  const carteira = useQuery({ queryKey: creditoKeys.carteira(), queryFn: buscarCarteiraCredito })

  // `?? []` cria um array novo a cada render, e os dois useMemo abaixo dependem dele —
  // sem estabilizar, eles recalculariam a carteira inteira em toda digitação da busca.
  const linhas = React.useMemo(() => carteira.data ?? [], [carteira.data])

  const totais = React.useMemo(() => {
    const t = {
      concedido: 0,
      consumido: 0,
      segurado: 0,
      descoberto: 0,
      ocioso: 0,
      descobertoConsumido: 0,
      porSituacao: {} as Record<string, { qtd: number; descoberto: number }>,
    }
    for (const l of linhas) {
      t.concedido += Number(l.limite_concedido ?? 0)
      t.consumido += Number(l.consumed_limit ?? 0)
      t.segurado += Number(l.limite_segurado ?? 0)
      t.descoberto += Number(l.descoberto ?? 0)
      // Consumo sob descoberto: dinheiro que JÁ SAIU e não tem seguro atrás. É o
      // subconjunto da exposição que não depende de ninguém sacar mais nada.
      if (l.situacao === 'descoberto') t.descobertoConsumido += Number(l.consumed_limit ?? 0)
      if (l.situacao === 'ocioso') t.ocioso += Number(l.limite_segurado ?? 0)
      const chave = l.situacao ?? 'desconhecido'
      const atual = t.porSituacao[chave] ?? { qtd: 0, descoberto: 0 }
      atual.qtd++
      atual.descoberto += Number(l.descoberto ?? 0)
      t.porSituacao[chave] = atual
    }
    return t
  }, [linhas])

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (filtro && l.situacao !== filtro) return false
      if (!termo) return true
      const alvo = `${l.razao_social ?? ''} ${l.company_name ?? ''} ${l.cnpj ?? ''}`.toLowerCase()
      return alvo.includes(termo)
    })
  }, [linhas, busca, filtro])

  if (carteira.isPending) return <Skeleton className="h-96 w-full rounded-lg" />

  if (carteira.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Não foi possível carregar a carteira</CardTitle>
          <CardDescription>{(carteira.error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const cobertura = totais.concedido > 0 ? Math.round((totais.segurado / totais.concedido) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          titulo="Exposição descoberta"
          valor={BRL.format(totais.descoberto)}
          detalhe={`${BRL.format(totais.descobertoConsumido)} já consumidos`}
          destaque={totais.descoberto > 0}
        />
        <Tile
          titulo="Limite concedido"
          valor={BRL.format(totais.concedido)}
          detalhe={`${BRL.format(totais.consumido)} consumidos`}
        />
        <Tile
          titulo="Cobertura vigente"
          valor={BRL.format(totais.segurado)}
          detalhe={`${cobertura}% do limite concedido`}
        />
        <Tile
          titulo="Cobertura ociosa"
          valor={BRL.format(totais.ocioso)}
          detalhe="seguro sem limite do outro lado"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Carteira</CardTitle>
          <CardDescription>
            Cada CNPJ com limite concedido na plataforma, cobertura vigente na seguradora, ou
            os dois. <strong>Blocked não entra</strong>: tem limite registrado mas não opera, e
            contá-lo inflaria o descoberto com risco que não existe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou CNPJ"
              className="h-9 max-w-xs"
            />
            <Button
              variant={filtro === null ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFiltro(null)}
            >
              Todas ({linhas.length})
            </Button>
            {ORDEM.map((chave) => {
              const info = totais.porSituacao[chave]
              if (!info) return null
              const { label, Icon } = SITUACOES[chave]
              return (
                <Button
                  key={chave}
                  variant={filtro === chave ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setFiltro(filtro === chave ? null : chave)}
                >
                  <Icon className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {label} ({info.qtd})
                </Button>
              )
            })}
          </div>

          <div className="rounded-lg border">
            <div className="hidden grid-cols-12 gap-2 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground sm:grid">
              <div className="col-span-4">Empresa</div>
              <div className="col-span-2 text-right">Limite concedido</div>
              <div className="col-span-2 text-right">Consumido</div>
              <div className="col-span-2 text-right">Segurado</div>
              <div className="col-span-2 text-right">Descoberto</div>
            </div>
            {visiveis.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nenhuma linha com esse recorte.
              </p>
            ) : (
              visiveis.map((l) => <Linha key={l.cnpj ?? Math.random()} l={l} />)
            )}
          </div>

          <p className="text-[0.8rem] text-muted-foreground">
            A cobertura sai das análises com limite aprovado e vigente, independentemente de
            terem nascido na esteira ou vindo do backfill da apólice. O recorte é por{' '}
            <strong>valor</strong> e não por estágio: uma recusa de aumento mantém a cobertura
            anterior de pé, e filtrar por estágio esconderia seguro que existe.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
