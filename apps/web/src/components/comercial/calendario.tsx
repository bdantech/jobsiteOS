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
import { buscarAgendaJuridica, juridicoKeys } from '@/components/juridico/queries'

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

interface ItemCalendario {
  id: string
  titulo: string
  inicio_em: string
  origem: 'comercial' | 'juridico'
  href: string | null
  detalhe: string | null
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

  /*
   * A agenda JURÍDICA entra no mesmo calendário (08 §9).
   *
   * Duas consultas e não uma view unificada: prazo processual e reunião comercial são
   * entidades diferentes, com donos diferentes (advogado × vendedor) e RLS diferente.
   * Unir no banco obrigaria uma das duas policies a ceder; unir na tela deixa cada
   * fonte responder pelo que entrega — e quem não tem o módulo Jurídico simplesmente
   * recebe zero linhas, sem erro e sem buraco na tela.
   *
   * O filtro por vendedor NÃO se aplica aqui: prazo pende de advogado, e um seletor
   * de vendedor filtrando prazos de advogado esconderia audiências de quem as tem.
   */
  const agendaJuridica = useQuery({
    queryKey: juridicoKeys.agenda(),
    queryFn: buscarAgendaJuridica,
    // A RLS devolve vazio para quem não tem o módulo; um erro aqui não pode derrubar
    // o calendário comercial de quem nunca vai ver um prazo.
    retry: false,
  })

  async function gerarLink() {
    setGerando(true)
    const r = await gerarTokenIcsAction(vendedorId ?? undefined)
    setGerando(false)
    if (!r.ok) return toast.error(r.message)
    setLink(`${window.location.origin}/api/calendario/${r.data.token}`)
    toast.success('Link novo gerado. O anterior foi revogado.')
  }

  const itens: ItemCalendario[] = [
    ...(agenda.data ?? []).map((e) => ({
      id: e.id,
      titulo: e.titulo,
      inicio_em: e.inicio_em,
      origem: 'comercial' as const,
      href: e.empresas ? `/empresas/${e.empresas.id}` : null,
      detalhe: null,
    })),
    ...(agendaJuridica.data ?? [])
      .filter((p): p is typeof p & { id: string; inicio_em: string } => !!p.id && !!p.inicio_em)
      .map((p) => ({
        id: p.id,
        titulo:
          `${p.tipo === 'audiencia' ? 'Audiência' : p.tipo === 'pericia' ? 'Perícia' : 'Prazo'}: ` +
          `${p.titulo ?? ''}`,
        inicio_em: p.inicio_em,
        origem: 'juridico' as const,
        href: p.numero_cnj ? `/juridico/${p.numero_cnj}` : null,
        detalhe: p.devedor_nome,
      })),
  ].sort((a, b) => a.inicio_em.localeCompare(b.inicio_em))

  const porDia = new Map<string, ItemCalendario[]>()
  for (const e of itens) {
    const chave = e.inicio_em.slice(0, 10)
    porDia.set(chave, [...(porDia.get(chave) ?? []), e])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendário</h1>
          <p className="text-sm text-muted-foreground">
            Reuniões dos funis e prazos do Jurídico, da semana passada em diante.
          </p>
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
            <p className="text-sm text-muted-foreground">Nenhuma reunião nem prazo marcado.</p>
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
                  <li key={`${e.origem}-${e.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="flex items-baseline gap-2">
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        {new Date(e.inicio_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                      {e.href ? (
                        <Link href={e.href} className="hover:underline">{e.titulo}</Link>
                      ) : (
                        e.titulo
                      )}
                    </span>
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      {e.detalhe}
                      {/* A origem marcada: uma audiência e uma reunião no mesmo dia
                          exigem preparos opostos, e o título sozinho não distingue. */}
                      {e.origem === 'juridico' ? (
                        <Badge variant="secondary" className="text-[10px]">Jurídico</Badge>
                      ) : null}
                    </span>
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
