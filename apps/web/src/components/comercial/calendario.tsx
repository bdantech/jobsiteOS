'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { gerarTokenIcsAction } from '@/actions/comercial'
import { buscarAgenda, buscarVendedoresVisiveis, comercialKeys } from './queries'

/**
 * Calendário interno (v1): a agenda que sai dos funis, por dia.
 *
 * O feed .ics é a integração honesta desta fase: o Google e o Outlook assinam uma URL,
 * e o vendedor vê as reuniões no calendário que ele já usa, sem OAuth (fase 2). O feed
 * carrega só título e horário — um link de assinatura vaza com facilidade (fica no
 * celular pessoal, é reencaminhado), e o que vaza junto tem que ser inócuo.
 *
 * Gerar um link novo REVOGA o anterior. É assim que se tira o acesso de um celular
 * perdido sem ter que pedir para ninguém.
 */

function diaLegivel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

export function Calendario({ ehGestor }: { ehGestor: boolean }) {
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [link, setLink] = React.useState<string | null>(null)
  const [gerando, setGerando] = React.useState(false)

  // Quem eu posso ABRIR, não quem existe: um nome no seletor cuja agenda a RLS devolve
  // vazia ensina que a tela está quebrada.
  const vendedores = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const agenda = useQuery({
    queryKey: comercialKeys.agenda(vendedorId),
    queryFn: () => buscarAgenda(vendedorId),
  })

  async function gerarLink() {
    setGerando(true)
    const r = await gerarTokenIcsAction(vendedorId ?? undefined)
    setGerando(false)
    if (!r.ok) return toast.error(r.message)
    setLink(`${window.location.origin}/api/calendario/${r.data.token}`)
    toast.success('Link novo gerado. O anterior foi revogado.')
  }

  const porDia = new Map<string, typeof agenda.data extends undefined ? never : NonNullable<typeof agenda.data>>()
  for (const e of agenda.data ?? []) {
    const chave = e.inicio_em.slice(0, 10)
    porDia.set(chave, [...(porDia.get(chave) ?? []), e])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendário</h1>
          <p className="text-sm text-muted-foreground">Reuniões dos funis, da semana passada em diante.</p>
        </div>
        <div className="flex items-center gap-2">
          {(ehGestor || (vendedores.data ?? []).length > 1) && (
            <Select value={vendedorId ?? 'eu'} onValueChange={(v) => setVendedorId(v === 'eu' ? null : v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Minha agenda" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eu">Minha agenda</SelectItem>
                {(vendedores.data ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" onClick={() => void gerarLink()} disabled={gerando}>
            <Link2 className="mr-1 h-4 w-4" aria-hidden />
            {gerando ? 'Gerando…' : 'Link .ics'}
          </Button>
        </div>
      </div>

      {link && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Assine no Google ou Outlook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              Cole em &quot;Adicionar por URL&quot;. Este link é uma credencial: quem o tiver vê seus
              horários (só título e hora, nunca o conteúdo da negociação). Gerar outro revoga este.
            </p>
          </CardContent>
        </Card>
      )}

      {agenda.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : porDia.size === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarDays className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Nenhuma reunião marcada.</p>
          </CardContent>
        </Card>
      ) : (
        [...porDia.entries()].map(([dia, eventos]) => (
          <Card key={dia}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm capitalize">{diaLegivel(`${dia}T12:00:00Z`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {eventos.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="flex items-baseline gap-2">
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        {new Date(e.inicio_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                      {e.empresas ? (
                        <Link href={`/empresas/${e.empresas.id}`} className="hover:underline">{e.titulo}</Link>
                      ) : (
                        e.titulo
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{e.duracao_min} min</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
