'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { BellRing, ChevronRight, Mail, Moon, Search, Smartphone } from 'lucide-react'
import { MODULOS_NOTIFICACAO, PAPEIS_NOTIFICACAO, type PapelNotificacao } from '@jobsiteos/core'
import { alternarTipoAction, salvarSilencioAction } from '@/actions/notificacoes-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface LinhaCatalogo {
  tipo: string
  modulo: string
  nome: string
  descricao: string | null
  critico: boolean
  ativo: boolean
  personalizado: boolean
  destinos: { rotulo: string; papel: string | null; resumo: boolean }[]
  canais: string[]
  enviados: number
  lidos: number
  resumidos: number
}

const HORAS = Array.from({ length: 24 }, (_, h) => h)
const TODOS = '__todos__'

/**
 * O catálogo: a lista que torna o ruído VISÍVEL.
 *
 * Ordenado por volume dos últimos 30 dias, com a taxa de leitura ao lado — é a
 * coluna que mostra qual aviso ninguém abre. Os tipos sem regra (a maioria dos
 * ~170 eventos da plataforma) ficam escondidos por padrão: eles existem para a
 * timeline, e são o lugar onde se cria um aviso novo sem código.
 */
export function CatalogoAvisos({
  linhas,
  silencio,
}: {
  linhas: LinhaCatalogo[]
  silencio: { inicio: number; fim: number }
}) {
  const [busca, setBusca] = React.useState('')
  const [modulo, setModulo] = React.useState(TODOS)
  const [soComRegra, setSoComRegra] = React.useState(true)

  const termo = busca.trim().toLowerCase()
  const visiveis = linhas
    .filter((l) => !soComRegra || l.destinos.length > 0)
    .filter((l) => modulo === TODOS || l.modulo === modulo)
    .filter((l) => !termo || l.nome.toLowerCase().includes(termo) || l.tipo.includes(termo))
    .sort((a, b) => b.enviados + b.resumidos - (a.enviados + a.resumidos) || a.nome.localeCompare(b.nome))

  const total = linhas.reduce((s, l) => s + l.enviados, 0)
  const lidos = linhas.reduce((s, l) => s + l.lidos, 0)
  const comRegra = linhas.filter((l) => l.destinos.length > 0).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Notificações</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Todo aviso que a plataforma manda, quem recebe e por onde. Mudar o texto, os destinatários ou o
          canal aqui vale no próximo aviso — sem deploy. Criar um aviso novo é dar regra a um tipo que ainda
          não tem.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.4fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avisos nos últimos 30 dias</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{total.toLocaleString('pt-BR')}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {total ? `${Math.round((lidos / total) * 100)}% lidos` : 'Nenhum ainda'} · {comRegra} tipos com regra
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Maior volume</CardDescription>
            <CardTitle className="truncate text-base">
              {[...linhas].sort((a, b) => b.enviados - a.enviados)[0]?.nome ?? '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            O tipo que mais toca o sino. Se ninguém lê, ele é candidato ao resumo diário.
          </CardContent>
        </Card>
        <HorarioDeSilencio inicial={silencio} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar aviso"
            className="pl-8"
            aria-label="Buscar aviso"
          />
        </div>
        <Select value={modulo} onValueChange={setModulo}>
          <SelectTrigger className="w-44" aria-label="Módulo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os módulos</SelectItem>
            {Object.entries(MODULOS_NOTIFICACAO).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={soComRegra} onCheckedChange={setSoComRegra} />
          Só os que têm regra
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aviso</TableHead>
              <TableHead>Quem recebe</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead className="text-right">30 dias</TableHead>
              <TableHead className="text-right">Lidos</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((l) => (
              <LinhaDoCatalogo key={l.tipo} linha={l} />
            ))}
            {visiveis.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum aviso com esse filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function LinhaDoCatalogo({ linha: l }: { linha: LinhaCatalogo }) {
  const [ativo, setAtivo] = React.useState(l.ativo)
  const [pendente, iniciar] = React.useTransition()
  const href = `/admin/notificacoes/${encodeURIComponent(l.tipo)}`
  const taxa = l.enviados ? Math.round((l.lidos / l.enviados) * 100) : null

  return (
    <TableRow className={cn(!ativo && 'opacity-60')}>
      <TableCell className="min-w-64">
        <Link href={href} className="font-medium hover:underline">
          {l.nome}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <code className="text-[11px] text-muted-foreground">{l.tipo}</code>
          {l.critico && <Badge variant="destructive" className="text-[10px]">Crítico</Badge>}
          {l.personalizado && <Badge variant="secondary" className="text-[10px]">Texto próprio</Badge>}
        </div>
      </TableCell>
      <TableCell className="min-w-56">
        {l.destinos.length === 0 ? (
          <span className="text-xs text-muted-foreground">Ninguém — só aparece na timeline</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {l.destinos.map((d, i) => (
              <Badge key={i} variant="outline" className="gap-1 text-[11px] font-normal">
                {d.papel ? (PAPEIS_NOTIFICACAO[d.papel as PapelNotificacao]?.rotulo ?? d.papel) : d.rotulo}
                {d.resumo && <span className="text-muted-foreground">· resumo</span>}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {l.canais.includes('sino') && <BellRing className="h-4 w-4" aria-label="Sino" />}
          {l.canais.includes('push') && <Smartphone className="h-4 w-4" aria-label="Push" />}
          {l.canais.includes('email') && <Mail className="h-4 w-4" aria-label="E-mail" />}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {l.enviados.toLocaleString('pt-BR')}
        {l.resumidos > 0 && (
          <div className="text-[11px] text-muted-foreground">+{l.resumidos.toLocaleString('pt-BR')} no resumo</div>
        )}
      </TableCell>
      <TableCell className={cn('text-right tabular-nums', taxa !== null && taxa < 20 && 'text-destructive')}>
        {taxa === null ? '—' : `${taxa}%`}
      </TableCell>
      <TableCell>
        <Switch
          checked={ativo}
          disabled={pendente}
          aria-label={ativo ? `Pausar ${l.nome}` : `Retomar ${l.nome}`}
          onCheckedChange={(v) => {
            setAtivo(v)
            iniciar(async () => {
              const r = await alternarTipoAction({ tipo: l.tipo, ativo: v })
              if (!r.ok) {
                setAtivo(!v)
                toast.error(r.message)
              } else toast.success(v ? `${l.nome}: retomado.` : `${l.nome}: pausado. Nenhuma regra dele entrega.`)
            })
          }}
        />
      </TableCell>
      <TableCell>
        <Button asChild variant="ghost" size="icon" aria-label={`Editar ${l.nome}`}>
          <Link href={href}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

/**
 * O horário de silêncio: push e e-mail que caem dentro dele esperam o fim. O sino
 * grava na hora — quem abrir o sistema de madrugada vê. Avisos críticos furam.
 */
function HorarioDeSilencio({ inicial }: { inicial: { inicio: number; fim: number } }) {
  const [inicio, setInicio] = React.useState(inicial.inicio)
  const [fim, setFim] = React.useState(inicial.fim)
  const [pendente, iniciar] = React.useTransition()
  const mudou = inicio !== inicial.inicio || fim !== inicial.fim

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <Moon className="h-3.5 w-3.5" aria-hidden /> Horário de silêncio (Brasília)
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Das</Label>
            <HoraSelect valor={inicio} onChange={setInicio} rotulo="Início do silêncio" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">até as</Label>
            <HoraSelect valor={fim} onChange={setFim} rotulo="Fim do silêncio" />
          </div>
          <Button
            size="sm"
            disabled={!mudou || pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await salvarSilencioAction({ silencio_inicio: inicio, silencio_fim: fim })
                if (r.ok) toast.success('Horário de silêncio salvo.')
                else toast.error(r.message)
              })
            }
          >
            Salvar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Push e e-mail esperam o fim do silêncio; o sino grava na hora. Avisos críticos furam.
          {inicio === fim && ' Início igual ao fim desliga o silêncio.'}
        </p>
      </CardContent>
    </Card>
  )
}

function HoraSelect({ valor, onChange, rotulo }: { valor: number; onChange: (h: number) => void; rotulo: string }) {
  return (
    <Select value={String(valor)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-24" aria-label={rotulo}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HORAS.map((h) => (
          <SelectItem key={h} value={String(h)}>
            {String(h).padStart(2, '0')}h
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
