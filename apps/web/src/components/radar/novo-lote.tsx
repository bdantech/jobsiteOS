'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Grupo } from '@jobsiteos/core'
import { criarLoteAction } from '@/actions/radar'
import { ConstrutorRegra } from '@/components/mercado/piramide/construtor-regra'
import { grupoPadrao, problemasDaArvore } from '@/components/mercado/piramide/arvore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { buscarCustos, estimarItens, radarKeys, type CustosConfig } from './queries'

type Tipo = 'dominio' | 'contatos' | 'protestos' | 'funcionarios'
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

interface Params {
  incluir_claude?: boolean
  revelar_telefone?: boolean
  forcar_ttl?: boolean
}

function custoEstimado(tipo: Tipo, total: number, params: Params, custos: CustosConfig): number {
  if (tipo === 'dominio') return total * (params.incluir_claude ? custos.dominio_claude : 0)
  if (tipo === 'contatos') return total * custos.contato_apollo * 4 // pessimista: até 4 contatos/empresa
  // `organizations/enrich` não consome crédito de revelação. Zero é o custo REAL, e
  // mostrar zero é o ponto: este lote não precisa da mesma cerimônia dos pagos.
  if (tipo === 'funcionarios') return 0
  // Protesto tem um preço só desde 01/09/2026: a DirectD desativou o endpoint de
  // SP ao consolidar tudo no IEPTB, e com ele foi embora a opção barata. O que
  // era "R$ 0,36 em SP, R$ 3,50 fora" virou R$ 3,50 para todo mundo — e é essa
  // conta que a pessoa precisa ver ANTES de aprovar o lote.
  return total * custos.protesto_nacional
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  )
}

export function NovoLote() {
  const router = useRouter()
  const [tipo, setTipo] = React.useState<Tipo>('dominio')
  const [nome, setNome] = React.useState('')
  const [arvore, setArvore] = React.useState<Grupo>(grupoPadrao())
  const [params, setParams] = React.useState<Params>({})
  const [total, setTotal] = React.useState<number | null>(null)
  const [estimando, setEstimando] = React.useState(false)
  const [criando, setCriando] = React.useState(false)

  const custos = useQuery({ queryKey: [...radarKeys.config(), 'custos'], queryFn: buscarCustos })
  const problemas = problemasDaArvore(arvore)

  async function estimar() {
    if (problemas.length > 0) {
      toast.error(problemas[0])
      return
    }
    setEstimando(true)
    try {
      setTotal(await estimarItens(arvore))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao estimar.')
    } finally {
      setEstimando(false)
    }
  }

  const custo = total !== null && custos.data ? custoEstimado(tipo, total, params, custos.data) : null

  async function criar() {
    if (problemas.length > 0) {
      toast.error(problemas[0])
      return
    }
    setCriando(true)
    const r = await criarLoteAction({
      tipo,
      nome: nome.trim() || undefined,
      definicao_filtro: arvore,
      parametros: params,
      total_itens: total ?? undefined,
      custo_estimado_min: 0,
      custo_estimado_esperado: custo ?? undefined,
      status: 'aguardando_aprovacao',
    })
    setCriando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success('Lote criado — aguardando aprovação.')
    router.push(`/radar/lotes/${r.data.id}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Novo lote de enriquecimento</h1>
        <p className="text-muted-foreground">Seleção → estimativa → aprovação. Nada é cobrado antes de aprovar.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">O que enriquecer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Tipo</p>
              <Select value={tipo} onValueChange={(v) => { setTipo(v as Tipo); setTotal(null); setParams({}) }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dominio">Domínio</SelectItem>
                  <SelectItem value="contatos">Contatos (Apollo)</SelectItem>
                  <SelectItem value="protestos">Protestos (DirectD)</SelectItem>
                  <SelectItem value="funcionarios">Funcionários (Apollo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Nome (opcional)</p>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: SAM sem domínio" />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {tipo === 'dominio' && (
              <Check
                label="Incluir busca com Claude (etapa 5, paga) para o resíduo"
                checked={!!params.incluir_claude}
                onChange={(v) => setParams((p) => ({ ...p, incluir_claude: v }))}
              />
            )}
            {tipo === 'contatos' && (
              <Check
                label="Revelar telefone (assíncrono, via webhook)"
                checked={!!params.revelar_telefone}
                onChange={(v) => setParams((p) => ({ ...p, revelar_telefone: v }))}
              />
            )}
            {tipo === 'protestos' && (
              <p className="text-sm text-muted-foreground">
                Consulta <strong>nacional</strong>, via IEPTB, para todas as empresas do lote.
                Não há mais a opção só-SP: a DirectD a desativou em 01/09/2026. O custo por
                item subiu de R$ 0,36 para o preço nacional, e a estimativa acima já reflete
                isso.
              </p>
            )}
            {tipo === 'funcionarios' && (
              <p className="text-sm text-muted-foreground">
                Exige <strong>domínio resolvido</strong> — sem ele o item falha com{' '}
                <code>sem_dominio</code>. Não consome crédito de revelação, mas respeita o TTL
                de 180 dias: reconsultar cedo só enche a série de pontos iguais e estraga a
                leitura de crescimento.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Seleção</CardTitle>
        </CardHeader>
        <CardContent>
          <ConstrutorRegra arvore={arvore} onChange={(a) => { setArvore(a); setTotal(null) }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Estimativa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" variant="secondary" onClick={estimar} disabled={estimando}>
            {estimando ? 'Estimando…' : 'Estimar'}
          </Button>
          {total !== null && (
            <div className="text-sm">
              <p>
                <span className="font-medium">{total.toLocaleString('pt-BR')}</span> empresas na seleção.
              </p>
              {custo !== null && (
                <p className="text-muted-foreground">
                  Custo estimado (pessimista): <span className="font-medium text-foreground">{brl(custo)}</span>
                  {tipo === 'dominio' && !params.incluir_claude && ' — só as etapas gratuitas'}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                A estimativa não desconta itens já enriquecidos dentro do TTL — o worker os pula na execução.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.push('/radar/lotes')}>
          Cancelar
        </Button>
        <Button type="button" onClick={criar} disabled={criando || problemas.length > 0}>
          {criando ? 'Criando…' : 'Criar lote (aguardando aprovação)'}
        </Button>
      </div>
    </div>
  )
}
