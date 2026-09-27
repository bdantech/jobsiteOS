'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Gavel, Search } from 'lucide-react'
import { CNJ_REGEX, formatCnpj } from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { criarProcessoAction, vincularProcessoAction } from '@/actions/cobranca'
import { Campo, mascaraCnj } from './cobranca-detalhe-comum'
import { brl, data } from './format'
import { buscarProcessos, buscarProcessoVinculado, cobrancaKeys, type CardCobranca } from './queries'

/**
 * Conversão em processo (§10). Vincular a um processo que o Jurídico já conhece, ou
 * criar a capa mínima (partes e valor da causa) para a sincronização com o tribunal
 * completar depois. Nas duas rotas o RPC move a cobrança para "judicializada" e leva
 * os títulos ativos para as operações cobradas do processo.
 *
 * A cobrança NÃO fecha ao virar processo: o prazo da apólice continua correndo, e o
 * ajuizamento é prova de "ação para minimizar perdas" no dossiê.
 */
export function AbaProcesso({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const cnj = cobranca.processo_cnj

  const vinculado = useQuery({
    queryKey: cobrancaKeys.processo(cnj ?? ''),
    queryFn: () => buscarProcessoVinculado(cnj!),
    enabled: Boolean(cnj),
  })

  if (cnj) {
    const p = vinculado.data
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gavel className="h-4 w-4" aria-hidden />
            Processo vinculado
          </CardTitle>
          <CardDescription>
            Convertida em {data(cobranca.convertida_em_processo_em)}. Os títulos da cobrança são as operações cobradas
            do processo; a cobrança continua aberta para o relógio da apólice e o dossiê.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {vinculado.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Número CNJ">
                <span className="font-mono">{cnj}</span>
              </Campo>
              <Campo rotulo="Devedor">
                {p?.devedor_nome ?? '—'}
                {p?.cnpj_devedor ? (
                  <span className="block font-mono text-xs text-muted-foreground">{formatCnpj(p.cnpj_devedor)}</span>
                ) : null}
              </Campo>
              <Campo rotulo="Foro">{[p?.comarca, p?.uf].filter(Boolean).join(' · ') || '—'}</Campo>
              <Campo rotulo="Valor da causa">{brl(p?.valor_causa)}</Campo>
            </div>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/juridico/${cnj}`}>
              <ExternalLink className="mr-1 h-4 w-4" aria-hidden />
              Abrir no Jurídico
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (cobranca.estagio === 'rascunho' || cobranca.estagio === 'cancelada') {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Só uma cobrança já notificada vira processo. Envie a notificação extrajudicial primeiro.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Vincular cobrancaId={id} />
      <Criar cobrancaId={id} valorSugerido={cobranca.valor_atualizado ?? cobranca.valor_em_aberto ?? null} />
    </div>
  )
}

function Vincular({ cobrancaId }: { cobrancaId: string }) {
  const qc = useQueryClient()
  const [texto, setTexto] = React.useState('')
  const [termo, setTermo] = React.useState('')
  const [manual, setManual] = React.useState('')
  const [vinculando, setVinculando] = React.useState(false)

  React.useEffect(() => {
    const t = setTimeout(() => setTermo(texto.trim()), 350)
    return () => clearTimeout(t)
  }, [texto])

  const resultados = useQuery({
    queryKey: cobrancaKeys.processos(termo),
    queryFn: () => buscarProcessos(termo),
    enabled: termo.length >= 3,
  })

  async function vincular(numero: string) {
    setVinculando(true)
    const r = await vincularProcessoAction({ cobranca_id: cobrancaId, numero_cnj: numero })
    setVinculando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Cobrança convertida em processo. Os títulos ativos viraram as operações cobradas dele.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Vincular a processo existente</CardTitle>
        <CardDescription>Busque no Jurídico pelo número CNJ ou pela parte (nome ou CNPJ).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="CNJ, devedor ou CNPJ" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        {termo.length >= 3 ? (
          resultados.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (resultados.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum processo encontrado — ou o seu perfil não enxerga a carteira do Jurídico. Se você tem o
              número, digite-o abaixo.
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {(resultados.data ?? []).map((p) => (
                <div key={p.numero_cnj} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{p.numero_cnj}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.devedor_nome, p.classe, [p.comarca, p.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={vinculando || !p.numero_cnj} onClick={() => void vincular(p.numero_cnj!)}>
                    Vincular
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : null}
        <div className="flex gap-2 border-t pt-3">
          <Input
            className="font-mono"
            placeholder="0000000-00.0000.0.00.0000"
            value={manual}
            onChange={(e) => setManual(mascaraCnj(e.target.value))}
          />
          <Button size="sm" disabled={vinculando || !CNJ_REGEX.test(manual)} onClick={() => void vincular(manual)}>
            Vincular
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Criar({ cobrancaId, valorSugerido }: { cobrancaId: string; valorSugerido: number | null }) {
  const qc = useQueryClient()
  const [cnj, setCnj] = React.useState('')
  const [valor, setValor] = React.useState(valorSugerido ? String(valorSugerido) : '')
  const [comarca, setComarca] = React.useState('')
  const [uf, setUf] = React.useState('')
  const [distribuicao, setDistribuicao] = React.useState('')
  const [observacoes, setObservacoes] = React.useState('')
  const [criando, setCriando] = React.useState(false)

  async function criar() {
    setCriando(true)
    const v = Number(valor.replace(',', '.'))
    const r = await criarProcessoAction({
      cobranca_id: cobrancaId,
      numero_cnj: cnj,
      ...(valor.trim() && Number.isFinite(v) && v > 0 ? { valor_causa: v } : {}),
      ...(comarca.trim() ? { comarca: comarca.trim() } : {}),
      ...(uf.trim() ? { uf: uf.trim().toUpperCase() } : {}),
      ...(distribuicao ? { data_distribuicao: distribuicao } : {}),
      ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
    })
    setCriando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Processo cadastrado e vinculado. A sincronização com o tribunal completa a capa.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.all })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Criar processo</CardTitle>
        <CardDescription>
          Capa mínima no Jurídico: devedor, nosso polo ativo e valor da causa (o total atualizado, por padrão).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="novo-cnj">Número CNJ</Label>
          <Input
            id="novo-cnj"
            className="font-mono"
            placeholder="0000000-00.0000.0.00.0000"
            value={cnj}
            onChange={(e) => setCnj(mascaraCnj(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-valor">Valor da causa (R$)</Label>
          <Input id="novo-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-dist">Distribuído em</Label>
          <Input id="novo-dist" type="date" value={distribuicao} onChange={(e) => setDistribuicao(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-comarca">Comarca</Label>
          <Input id="novo-comarca" value={comarca} onChange={(e) => setComarca(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="novo-uf">UF</Label>
          <Input id="novo-uf" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="novo-obs">Observações</Label>
          <Textarea id="novo-obs" rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <Button size="sm" disabled={criando || !CNJ_REGEX.test(cnj)} onClick={criar}>
            {criando ? 'Criando…' : 'Criar e vincular'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
