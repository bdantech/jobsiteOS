'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
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

/** Domingo a sábado, como o Google Calendar em pt-BR. */
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const chaveDoDia = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * As 6 semanas que a grade do mês mostra, começando no domingo anterior ao dia 1.
 *
 * Seis e não "as que couberem": uma grade que muda de altura conforme o mês faz o
 * conteúdo abaixo dançar a cada navegação. O Google faz o mesmo.
 */
function gradeDoMes(mes: Date): Date[] {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const inicio = new Date(primeiro)
  inicio.setDate(1 - primeiro.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio)
    d.setDate(inicio.getDate() + i)
    return d
  })
}

export function Calendario({ ehGestor }: { ehGestor: boolean }) {
  const [vendedorId, setVendedorId] = React.useState<string | null>(null)
  const [link, setLink] = React.useState<string | null>(null)
  const [gerando, setGerando] = React.useState(false)
  const [vista, setVista] = React.useState<'mes' | 'lista'>('mes')
  /** O primeiro dia do mês exibido. Só a vista de mês navega. */
  const [mes, setMes] = React.useState(() => {
    const h = new Date()
    return new Date(h.getFullYear(), h.getMonth(), 1)
  })

  /*
   * A JANELA DA CONSULTA ACOMPANHA A GRADE, e não o mês.
   *
   * A grade mostra os dias vizinhos das pontas — 30 de abril aparece na primeira
   * linha de maio. Buscar só o mês deixaria esses dias sempre vazios, o que parece
   * um bug e é pior que não mostrá-los.
   *
   * Na vista de lista não há janela: ela continua sendo "da semana passada em
   * diante", que é o que uma fila de trabalho precisa ser.
   */
  const janela = React.useMemo(() => {
    if (vista !== 'mes') return undefined
    const dias = gradeDoMes(mes)
    const fim = new Date(dias[41]!)
    fim.setHours(23, 59, 59, 999)
    return { desde: dias[0]!.toISOString(), ate: fim.toISOString() }
  }, [vista, mes])

  // Quem eu posso ABRIR, não quem existe: um nome no seletor cuja agenda a RLS devolve
  // vazia ensina que a tela está quebrada.
  const vendedores = useQuery({ queryKey: comercialKeys.visiveis(), queryFn: buscarVendedoresVisiveis })
  const agenda = useQuery({
    queryKey: comercialKeys.agenda(vendedorId, janela?.desde),
    queryFn: () => buscarAgenda(vendedorId, janela),
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
    queryKey: juridicoKeys.agenda(janela?.desde),
    queryFn: () => buscarAgendaJuridica(janela),
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
        <div className="flex flex-wrap items-center gap-2">
          {/* A vista de MÊS é a padrão porque a pergunta mais comum de uma agenda é
              "como está minha semana que vem", e ela se responde olhando, não
              rolando. A lista continua para quem quer a fila em ordem. */}
          <div className="flex rounded-md border p-0.5">
            <Button
              size="sm"
              variant={vista === 'mes' ? 'secondary' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setVista('mes')}
            >
              <LayoutGrid className="mr-1 h-3.5 w-3.5" aria-hidden />
              Mês
            </Button>
            <Button
              size="sm"
              variant={vista === 'lista' ? 'secondary' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setVista('lista')}
            >
              <List className="mr-1 h-3.5 w-3.5" aria-hidden />
              Lista
            </Button>
          </div>
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

      {vista === 'mes' ? (
        <GradeDoMes
          mes={mes}
          porDia={porDia}
          carregando={agenda.isPending}
          onMes={(delta) => setMes(new Date(mes.getFullYear(), mes.getMonth() + delta, 1))}
          onHoje={() => {
            const h = new Date()
            setMes(new Date(h.getFullYear(), h.getMonth(), 1))
          }}
        />
      ) : agenda.isPending ? (
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

/**
 * A grade do mês, no formato que todo mundo já sabe ler.
 *
 * A lista por dia responde "o que vem primeiro"; ela não responde "como está a
 * semana que vem", que é a pergunta que se faz olhando para um mês inteiro — e
 * era a única vista que existia aqui.
 *
 * ── O QUE CABE NUMA CÉLULA ─────────────────────────────────────────────────
 * Três eventos e um "+N". Uma célula que cresce com o conteúdo faz a linha inteira
 * crescer junto, e um dia cheio empurraria a semana seguinte para fora da tela. O
 * "+N" leva à lista, que é onde tudo cabe — em vez de um popover que seria uma
 * terceira forma de mostrar a mesma agenda.
 */
function GradeDoMes({
  mes,
  porDia,
  carregando,
  onMes,
  onHoje,
}: {
  mes: Date
  porDia: Map<string, ItemCalendario[]>
  carregando: boolean
  onMes: (delta: number) => void
  onHoje: () => void
}) {
  const dias = gradeDoMes(mes)
  const hoje = chaveDoDia(new Date())

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base capitalize">
          {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onMes(-1)} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onHoje}>
            Hoje
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onMes(1)} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {carregando ? (
          <Skeleton className="m-3 h-[28rem]" />
        ) : (
          <div className="grid grid-cols-7 border-t">
            {DIAS_SEMANA.map((d) => (
              <div
                key={d}
                className="border-b border-r px-2 py-1.5 text-center text-[11px] font-medium uppercase text-muted-foreground last:border-r-0"
              >
                {d}
              </div>
            ))}
            {dias.map((d) => {
              const chave = chaveDoDia(d)
              const eventos = porDia.get(chave) ?? []
              const doMes = d.getMonth() === mes.getMonth()
              return (
                <div
                  key={chave}
                  className={cn(
                    'min-h-24 border-b border-r p-1 last-of-type:border-r-0 [&:nth-child(7n+7)]:border-r-0',
                    !doMes && 'bg-muted/30',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums',
                      !doMes && 'text-muted-foreground',
                      chave === hoje && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <ul className="mt-0.5 space-y-0.5">
                    {eventos.slice(0, 3).map((e) => {
                      const hora = new Date(e.inicio_em).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                      const conteudo = (
                        <span
                          className={cn(
                            'block truncate rounded px-1 py-0.5 text-[11px] leading-tight',
                            e.origem === 'juridico'
                              ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                              : 'bg-primary/10 text-foreground',
                          )}
                          title={`${hora} · ${e.titulo}`}
                        >
                          <span className="tabular-nums opacity-70">{hora}</span> {e.titulo}
                        </span>
                      )
                      return (
                        <li key={`${e.origem}-${e.id}`}>
                          {e.href ? (
                            <Link href={e.href} className="block hover:opacity-80">
                              {conteudo}
                            </Link>
                          ) : (
                            conteudo
                          )}
                        </li>
                      )
                    })}
                    {eventos.length > 3 ? (
                      <li className="px-1 text-[11px] text-muted-foreground">
                        +{eventos.length - 3} — veja na lista
                      </li>
                    ) : null}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
