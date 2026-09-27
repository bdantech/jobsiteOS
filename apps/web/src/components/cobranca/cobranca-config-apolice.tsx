'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Pencil, Plus } from 'lucide-react'
import type { SalvarApoliceInput, Tables } from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { salvarApoliceAction } from '@/actions/cobranca-gestao'
import { buscarApolices, gestaoKeys } from './gestao-queries'
import { brl, cnpj, data } from './format'

/**
 * CRUD de apólices (§6, §13). Todo número do relógio sai daqui — nada é hardcoded —
 * porque a renovação ANUAL muda parâmetro. O aviso no topo não é decoração: uma
 * apólice renovada com os prazos da anterior conta D+90 errado para a carteira toda.
 */

type Form = {
  id?: string
  seguradora: string
  numero: string
  segurado_cnpj: string
  vigencia_inicio: string
  vigencia_fim: string
  percentagem_pct: string
  periodo_espera_dias: string
  prazo_maximo_credito_dias: string
  periodo_max_prorrogacao_dias: string
  prazo_notificacao_apos_prorrogacao_dias: string
  prazo_envio_sinistro_meses: string
  prazo_documentos_complementares_dias: string
  franquia: string
  responsabilidade_maxima: string
  ativa: boolean
}

const NOVA: Form = {
  seguradora: 'Atradius Crédito y Caución',
  numero: '',
  segurado_cnpj: '',
  vigencia_inicio: '',
  vigencia_fim: '',
  percentagem_pct: '90',
  periodo_espera_dias: '180',
  prazo_maximo_credito_dias: '180',
  periodo_max_prorrogacao_dias: '60',
  prazo_notificacao_apos_prorrogacao_dias: '30',
  prazo_envio_sinistro_meses: '6',
  prazo_documentos_complementares_dias: '30',
  franquia: '20000',
  responsabilidade_maxima: '',
  ativa: true,
}

function formDe(a: Tables<'apolices'>): Form {
  return {
    id: a.id,
    seguradora: a.seguradora,
    numero: a.numero,
    segurado_cnpj: a.segurado_cnpj,
    vigencia_inicio: a.vigencia_inicio,
    vigencia_fim: a.vigencia_fim,
    percentagem_pct: String(Math.round(Number(a.percentagem_segurada) * 10000) / 100),
    periodo_espera_dias: String(a.periodo_espera_dias),
    prazo_maximo_credito_dias: String(a.prazo_maximo_credito_dias),
    periodo_max_prorrogacao_dias: String(a.periodo_max_prorrogacao_dias),
    prazo_notificacao_apos_prorrogacao_dias: String(a.prazo_notificacao_apos_prorrogacao_dias),
    prazo_envio_sinistro_meses: String(a.prazo_envio_sinistro_meses),
    prazo_documentos_complementares_dias: String(a.prazo_documentos_complementares_dias),
    franquia: String(a.franquia),
    responsabilidade_maxima: a.responsabilidade_maxima === null ? '' : String(a.responsabilidade_maxima),
    ativa: a.ativa,
  }
}

const CAMPOS_INTEIROS: { k: keyof Form; rotulo: string; nota: string }[] = [
  { k: 'periodo_max_prorrogacao_dias', rotulo: 'Período máximo de prorrogação (dias)', nota: 'D+60 — parada automática de cobertura (cl. 17700.20 a)' },
  { k: 'prazo_notificacao_apos_prorrogacao_dias', rotulo: 'Prazo para notificar após a prorrogação (dias)', nota: 'D+90 — notificar a seguradora (cl. 18500.01)' },
  { k: 'periodo_espera_dias', rotulo: 'Período de espera (dias)', nota: 'D+180 — Data da Perda por mora prolongada (cl. 00500.00)' },
  { k: 'prazo_envio_sinistro_meses', rotulo: 'Prazo de envio do sinistro (meses)', nota: 'contados da Data da Perda (cl. 22100.20 §1)' },
  { k: 'prazo_documentos_complementares_dias', rotulo: 'Documentos complementares (dias)', nota: 'da solicitação da seguradora' },
  { k: 'prazo_maximo_credito_dias', rotulo: 'Prazo máximo de crédito (dias)', nota: 'prazo de venda coberto' },
]

export function ApolicesCrud({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: gestaoKeys.apolices(), queryFn: buscarApolices })
  const [form, setForm] = React.useState<Form | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  async function salvar() {
    if (!form) return
    const inteiro = (s: string) => Number.parseInt(s, 10)
    const input: SalvarApoliceInput = {
      id: form.id,
      seguradora: form.seguradora.trim() || undefined,
      numero: form.numero.trim(),
      segurado_cnpj: form.segurado_cnpj.replace(/\D/g, ''),
      vigencia_inicio: form.vigencia_inicio,
      vigencia_fim: form.vigencia_fim,
      percentagem_segurada: Number(form.percentagem_pct.replace(',', '.')) / 100,
      periodo_espera_dias: inteiro(form.periodo_espera_dias),
      prazo_maximo_credito_dias: inteiro(form.prazo_maximo_credito_dias),
      periodo_max_prorrogacao_dias: inteiro(form.periodo_max_prorrogacao_dias),
      prazo_notificacao_apos_prorrogacao_dias: inteiro(form.prazo_notificacao_apos_prorrogacao_dias),
      prazo_envio_sinistro_meses: inteiro(form.prazo_envio_sinistro_meses),
      prazo_documentos_complementares_dias: inteiro(form.prazo_documentos_complementares_dias),
      franquia: Number(form.franquia.replace(',', '.')),
      responsabilidade_maxima: form.responsabilidade_maxima.trim() ? Number(form.responsabilidade_maxima.replace(',', '.')) : null,
      ativa: form.ativa,
    }
    setSalvando(true)
    const r = await salvarApoliceAction(input)
    setSalvando(false)
    if (!r.ok) {
      const campos = r.fieldErrors ? Object.keys(r.fieldErrors).join(', ') : ''
      toast.error(campos ? `${r.message} Confira: ${campos}.` : r.message)
      return
    }
    toast.success('Apólice salva. O relógio usa os novos parâmetros na próxima execução.')
    setForm(null)
    void qc.invalidateQueries({ queryKey: gestaoKeys.apolices() })
  }

  const campo = (k: keyof Form, rotulo: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, nota?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`ap-${k}`} className="text-xs">
        {rotulo}
      </Label>
      <Input
        id={`ap-${k}`}
        value={String(form?.[k] ?? '')}
        onChange={(e) => form && setForm({ ...form, [k]: e.target.value })}
        disabled={!podeEditar}
        {...props}
      />
      {nota ? <p className="text-[11px] text-muted-foreground">{nota}</p> : null}
    </div>
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Apólices</CardTitle>
          {podeEditar && !form ? (
            <Button size="sm" variant="outline" onClick={() => setForm(NOVA)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Nova apólice (renovação)
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>Os parâmetros da apólice são anuais.</strong> Revise TODOS a cada renovação — prazos, percentagem
            segurada, franquia e responsabilidade máxima. O relógio da apólice (D+60, D+90, D+180, envio do sinistro)
            conta com estes números; um prazo copiado da vigência anterior é um prazo perdido.
          </p>
        </div>

        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {(q.data ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="font-medium">
                  {a.numero} <span className="text-xs text-muted-foreground">{a.seguradora}</span>{' '}
                  {a.ativa ? <Badge variant="success">ativa</Badge> : <Badge variant="neutral">inativa</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  vigência {data(a.vigencia_inicio)} – {data(a.vigencia_fim)} · segurado {cnpj(a.segurado_cnpj)} ·{' '}
                  {(Number(a.percentagem_segurada) * 100).toLocaleString('pt-BR')}% · franquia {brl(a.franquia)} · D+
                  {a.periodo_max_prorrogacao_dias}/D+{a.periodo_max_prorrogacao_dias + a.prazo_notificacao_apos_prorrogacao_dias}/D+
                  {a.periodo_espera_dias} · envio {a.prazo_envio_sinistro_meses} meses
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setForm(formDe(a))}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {podeEditar ? 'Editar' : 'Ver'}
              </Button>
            </li>
          ))}
          {(q.data ?? []).length === 0 ? (
            <li className="px-3 py-6 text-center text-muted-foreground">
              Nenhuma apólice cadastrada — sem ela o relógio não calcula prazo nenhum.
            </li>
          ) : null}
        </ul>

        {form ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{form.id ? `Apólice ${form.numero}` : 'Nova apólice'}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {campo('numero', 'Número da apólice')}
              {campo('seguradora', 'Seguradora')}
              {campo('segurado_cnpj', 'CNPJ do segurado')}
              {campo('vigencia_inicio', 'Início da vigência', { type: 'date' })}
              {campo('vigencia_fim', 'Fim da vigência', { type: 'date' })}
              {campo('percentagem_pct', 'Percentagem segurada (%)', { inputMode: 'decimal' })}
              {campo('franquia', 'Franquia por comprador (R$)', { inputMode: 'decimal' }, 'perda ≤ franquia não é indenizável (cl. 26100.00)')}
              {campo('responsabilidade_maxima', 'Responsabilidade máxima (R$)', { inputMode: 'decimal' })}
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  id="ap-ativa"
                  checked={form.ativa}
                  onCheckedChange={(v) => setForm({ ...form, ativa: v })}
                  disabled={!podeEditar}
                />
                <Label htmlFor="ap-ativa" className="font-normal">
                  Ativa
                </Label>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {CAMPOS_INTEIROS.map((c) => (
                <React.Fragment key={c.k}>{campo(c.k, c.rotulo, { inputMode: 'numeric' }, c.nota)}</React.Fragment>
              ))}
            </div>
            <div className="flex gap-2">
              {podeEditar ? (
                <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar apólice'}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setForm(null)} disabled={salvando}>
                {podeEditar ? 'Cancelar' : 'Fechar'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
