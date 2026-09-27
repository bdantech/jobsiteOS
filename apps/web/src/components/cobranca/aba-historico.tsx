'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  TIPO_INTERACAO_COBRANCA_LABELS,
  TIPOS_INTERACAO_COBRANCA,
  type TipoInteracaoCobranca,
} from '@jobsiteos/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { registrarInteracaoAction } from '@/actions/cobranca'
import { dataHora } from './format'
import {
  buscarEventosDaCobranca,
  buscarInteracoes,
  buscarNotificacoes,
  cobrancaKeys,
  type CardCobranca,
} from './queries'

/**
 * A cronologia da cobrança: os eventos que o banco grava a cada ato (na timeline das
 * empresas envolvidas) e os contatos registrados à mão, numa lista só. É esta ordem de
 * fatos que o sumário do dossiê de sinistro renderiza — o que não estiver aqui não
 * aconteceu para a seguradora.
 */

interface ItemLinha {
  id: string
  quando: string
  origem: 'evento' | 'contato'
  rotulo: string
  titulo: string
  resumo: string | null
  autor: string | null
}

function agoraLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function AbaHistorico({ cobranca }: { cobranca: CardCobranca }) {
  const id = cobranca.id!
  const qc = useQueryClient()
  const notificacoes = useQuery({ queryKey: cobrancaKeys.notificacoes(id), queryFn: () => buscarNotificacoes(id) })
  const empresaIds = React.useMemo(() => {
    const s = new Set<string>()
    if (cobranca.sacado_empresa_id) s.add(cobranca.sacado_empresa_id)
    for (const n of notificacoes.data ?? []) if (n.destinatario_empresa_id) s.add(n.destinatario_empresa_id)
    return [...s].sort()
  }, [cobranca.sacado_empresa_id, notificacoes.data])

  const eventos = useQuery({
    queryKey: [...cobrancaKeys.eventos(id), empresaIds.join(',')],
    queryFn: () => buscarEventosDaCobranca(id, empresaIds),
    enabled: !notificacoes.isPending,
  })
  const interacoes = useQuery({ queryKey: cobrancaKeys.interacoes(id), queryFn: () => buscarInteracoes(id) })

  const [tipo, setTipo] = React.useState<TipoInteracaoCobranca>('ligacao')
  const [resumo, setResumo] = React.useState('')
  const [quando, setQuando] = React.useState(agoraLocal())
  const [salvando, setSalvando] = React.useState(false)

  async function registrar() {
    setSalvando(true)
    const r = await registrarInteracaoAction({
      cobranca_id: id,
      tipo,
      resumo: resumo.trim(),
      // `datetime-local` não carrega fuso; o navegador resolve para o de quem registra.
      ocorrida_em: new Date(quando).toISOString(),
    })
    setSalvando(false)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    setResumo('')
    setQuando(agoraLocal())
    toast.success('Contato registrado.')
    void qc.invalidateQueries({ queryKey: cobrancaKeys.interacoes(id) })
    void qc.invalidateQueries({ queryKey: cobrancaKeys.eventos(id) })
  }

  const itens: ItemLinha[] = [
    // O contato registrado também vira evento (cobranca.contato_registrado); a linha
    // da interação é a que tem o texto inteiro e o autor, então o evento-eco sai.
    ...(eventos.data ?? [])
      .filter((e) => e.tipo !== 'cobranca.contato_registrado')
      .map((e) => {
        const p = (e.payload ?? {}) as { titulo?: string; resumo?: string }
        return {
          id: `e-${e.id}`,
          quando: e.criado_em,
          origem: 'evento' as const,
          rotulo: e.tipo.split('.')[0] ?? 'evento',
          titulo: p.titulo ?? e.tipo,
          resumo: p.resumo ?? null,
          autor: null,
        }
      }),
    ...(interacoes.data ?? []).map((i) => ({
      id: `i-${i.id}`,
      quando: i.ocorrida_em,
      origem: 'contato' as const,
      rotulo: TIPO_INTERACAO_COBRANCA_LABELS[i.tipo as TipoInteracaoCobranca] ?? i.tipo,
      titulo: 'Contato registrado',
      resumo: i.resumo,
      autor: i.usuarios?.nome ?? null,
    })),
  ].sort((a, b) => b.quando.localeCompare(a.quando))

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Cronologia</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {eventos.isPending || interacoes.isPending ? (
            <div className="p-6">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : itens.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nada registrado ainda.</p>
          ) : (
            itens.map((i) => (
              <div key={i.id} className="px-6 py-3">
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold tabular-nums">{dataHora(i.quando)}</span>
                  <Badge variant={i.origem === 'contato' ? 'info' : 'outline'} className="text-[10px]">
                    {i.rotulo}
                  </Badge>
                  <span className="text-sm">{i.titulo}</span>
                  {i.autor ? <span className="text-xs text-muted-foreground">por {i.autor}</span> : null}
                </div>
                {i.resumo ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{i.resumo}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Registrar contato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoInteracaoCobranca)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INTERACAO_COBRANCA.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_INTERACAO_COBRANCA_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="quando">Quando</Label>
            <Input id="quando" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="resumo">O que foi conversado</Label>
            <Textarea
              id="resumo"
              rows={5}
              placeholder="Com quem falou, o que foi prometido, próximo passo."
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
            />
          </div>
          <Button size="sm" className="w-full" disabled={salvando || resumo.trim().length < 2 || !quando} onClick={registrar}>
            {salvando ? 'Registrando…' : 'Registrar'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
