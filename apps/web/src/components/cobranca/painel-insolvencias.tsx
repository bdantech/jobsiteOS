'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Gavel } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { registrarInsolvenciaAction } from '@/actions/cobranca-gestao'
import { buscarInsolvencias, gestaoKeys, type Insolvencia } from './gestao-queries'
import { cnpj, data } from './format'

/**
 * Insolvências (§6.1, cl. 00300.00). Na insolvência a Data da Perda é a da DECISÃO
 * judicial, e o prazo de envio do sinistro passa a ser de 6 meses a partir dela —
 * quase sempre mais curto que o caminho de mora.
 *
 * A detecção automática (fonte = juridico) grava a data de DISTRIBUIÇÃO do processo,
 * que é anterior à decisão: erra para o lado seguro, mas encurta o prazo. Por isso ela
 * aparece marcada "confirme a data da decisão" até alguém gravar a data certa.
 */

const TIPOS = [
  { id: 'recuperacao_judicial', rotulo: 'Recuperação judicial' },
  { id: 'falencia', rotulo: 'Falência' },
  { id: 'outro', rotulo: 'Outro evento equivalente' },
] as const
type TipoInsolvencia = (typeof TIPOS)[number]['id']

const rotuloTipo = (t: string) => TIPOS.find((x) => x.id === t)?.rotulo ?? t

interface Form {
  sacado_matriz_cnpj: string
  tipo: TipoInsolvencia
  data_decisao: string
  numero_cnj: string
  observacao: string
}

const VAZIO: Form = { sacado_matriz_cnpj: '', tipo: 'recuperacao_judicial', data_decisao: '', numero_cnj: '', observacao: '' }

export function InsolvenciasCard() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: gestaoKeys.insolvencias(), queryFn: buscarInsolvencias })
  const [form, setForm] = React.useState<Form | null>(null)
  const [enviando, setEnviando] = React.useState(false)

  function confirmar(i: Insolvencia) {
    setForm({
      sacado_matriz_cnpj: i.sacado_matriz_cnpj,
      tipo: (TIPOS.some((t) => t.id === i.tipo) ? i.tipo : 'outro') as TipoInsolvencia,
      data_decisao: i.data_decisao,
      numero_cnj: i.numero_cnj ?? '',
      observacao: i.observacao ?? '',
    })
  }

  async function salvar() {
    if (!form) return
    setEnviando(true)
    const r = await registrarInsolvenciaAction({
      sacado_matriz_cnpj: form.sacado_matriz_cnpj.replace(/\D/g, ''),
      tipo: form.tipo,
      data_decisao: form.data_decisao,
      numero_cnj: form.numero_cnj.trim() || undefined,
      observacao: form.observacao.trim() || undefined,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.fieldErrors ? `${r.message} Confira CNPJ (14 dígitos), data e número CNJ.` : r.message)
      return
    }
    toast.success('Insolvência registrada. O relógio da apólice recalcula na próxima execução.')
    setForm(null)
    void qc.invalidateQueries({ queryKey: gestaoKeys.all })
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4" aria-hidden />
            Insolvências
          </CardTitle>
          {form ? null : (
            <Button size="sm" variant="outline" onClick={() => setForm(VAZIO)}>
              Registrar insolvência
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {form ? (
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ins-cnpj">CNPJ da matriz (cabeça do grupo)</Label>
              <Input
                id="ins-cnpj"
                value={form.sacado_matriz_cnpj}
                onChange={(e) => setForm({ ...form, sacado_matriz_cnpj: e.target.value })}
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoInsolvencia })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ins-data">Data da decisão judicial</Label>
              <Input
                id="ins-data"
                type="date"
                value={form.data_decisao}
                onChange={(e) => setForm({ ...form, data_decisao: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                É a Data da Perda: o prazo de envio do sinistro passa a ser de 6 meses a partir dela.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ins-cnj">Número CNJ (opcional)</Label>
              <Input
                id="ins-cnj"
                value={form.numero_cnj}
                onChange={(e) => setForm({ ...form, numero_cnj: e.target.value })}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ins-obs">Observação</Label>
              <Input id="ins-obs" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button
                size="sm"
                disabled={enviando || form.sacado_matriz_cnpj.replace(/\D/g, '').length !== 14 || !form.data_decisao}
                onClick={() => void salvar()}
              >
                {enviando ? 'Salvando…' : 'Salvar'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setForm(null)} disabled={enviando}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}

        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !q.data?.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma insolvência registrada.</p>
        ) : (
          <ul className="divide-y divide-border">
            {q.data.map((i) => {
              const aConfirmar = i.fonte === 'juridico' && !i.confirmada
              return (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {i.razao_social ?? cnpj(i.sacado_matriz_cnpj)}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{cnpj(i.sacado_matriz_cnpj)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {rotuloTipo(i.tipo)} · decisão em {data(i.data_decisao)}
                      {i.numero_cnj ? (
                        <>
                          {' · '}
                          <Link href={`/juridico/${i.numero_cnj}`} className="hover:underline">
                            {i.numero_cnj}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {aConfirmar ? (
                      <Badge variant="warning">detectada pelo Jurídico — confirme a data da decisão</Badge>
                    ) : (
                      <Badge variant="neutral">{i.fonte === 'juridico' ? 'confirmada' : 'manual'}</Badge>
                    )}
                    <Button size="sm" variant={aConfirmar ? 'default' : 'ghost'} onClick={() => confirmar(i)}>
                      {aConfirmar ? 'Confirmar' : 'Editar'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
