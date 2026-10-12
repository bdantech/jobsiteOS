'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info } from 'lucide-react'
import {
  CAMPO_DO_FATO,
  FITS_AQUISICAO,
  FIT_AQUISICAO_LABELS,
  NATUREZA_EXPLICA,
  ORIGEM_AQUISICAO_LABELS,
  RECORTE_DA_SERIE,
  agregadoDeAquisicao,
  aquisicaoPorMes,
  carimboDaAquisicao,
  diaEmSaoPaulo,
  matrizDoBloco,
  mesDaSemana,
  semanaDe,
  serieDeAquisicao,
  somarDias,
  temSemOrigem,
  totalDoBloco,
  valorDaCelula,
  type AlvoDetalhe,
  type BlocoAquisicao,
  type CampoAquisicao,
  type FatoReuniao,
  type FitAquisicao,
  type OrigemAquisicao,
  type ReportSemanal,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { SerieAquisicaoChart } from './graficos-report'
import { buscarAquisicao, buscarHistoricoAquisicao, relatoriosKeys } from './queries'

/**
 * Aquisição da semana (04u §2) e o seu histórico (§3).
 *
 * O card responde a pergunta que vem antes do funil: de onde veio o que entrou, e quanto
 * disso presta. Toda célula e toda contagem abre a lista nominal.
 */

type Abrir = (alvo: AlvoDetalhe, esperado: number | null) => void

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** O alvo de uma célula. Só carrega a semana quando ela NÃO é a do report aberto. */
function alvoDe(
  bloco: BlocoAquisicao, doReport: boolean,
  chave: 'aq_leads' | 'aq_reunioes', params: Record<string, string>,
): AlvoDetalhe {
  return { chave, params, ...(doReport ? {} : { inicio: bloco.inicio, fim: bloco.fim }) }
}

/** Um número que abre a sua lista. Zero não é clicável: lista vazia não responde nada. */
function Numero({
  n, onClick, className, titulo,
}: {
  n: number
  onClick: () => void
  className?: string
  titulo?: string
}) {
  if (n === 0) return <span className={cn('tabular-nums text-muted-foreground', className)}>0</span>
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn(
        'tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {n.toLocaleString('pt-BR')}
    </button>
  )
}

export function CardAquisicao({
  r, aoVivo, onAbrir,
}: {
  r: ReportSemanal
  /** `false` quando a tela mostra o snapshot de uma execução antiga. */
  aoVivo: boolean
  onAbrir: Abrir
}) {
  const [verAberta, setVerAberta] = React.useState(false)
  const [historico, setHistorico] = React.useState(false)

  const semanaAberta = { inicio: somarDias(r.periodo.fim, 1), fim: somarDias(r.periodo.fim, 7) }
  /* Só há "semana em aberto" para oferecer quando o report é o da semana fechada mais
     recente — num report de agosto, a semana seguinte fechou há meses. */
  const haAberta = aoVivo && semanaAberta.fim >= diaEmSaoPaulo(new Date())

  const aberta = useQuery({
    queryKey: relatoriosKeys.aquisicao(semanaAberta.inicio, semanaAberta.fim),
    queryFn: () => buscarAquisicao(semanaAberta.inicio, semanaAberta.fim),
    enabled: haAberta && verAberta,
  })

  const mostrandoAberta = haAberta && verAberta
  const bloco = mostrandoAberta ? aberta.data : r.aquisicao

  if (!r.aquisicao) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          Este report foi gerado antes de o bloco de Aquisição existir. Abra a semana fechada
          mais recente para vê-lo.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Aquisição da semana</CardTitle>
            <CardDescription className="text-[11px]">
              {bloco ? `${dm(bloco.inicio)} a ${dm(bloco.fim)} · ` : ''}
              {/* 04u §2.3: na tela recalcula a cada abertura; no snapshot é o do envio. */}
              {bloco ? carimboDaAquisicao(bloco, aoVivo) : 'carregando…'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {haAberta && (
              <div className="flex rounded-md border p-0.5 text-[11px]" role="group" aria-label="Semana">
                {[
                  { aberta: false, rotulo: 'Semana fechada' },
                  { aberta: true, rotulo: 'Em aberto' },
                ].map((o) => (
                  <button
                    key={o.rotulo}
                    type="button"
                    aria-pressed={verAberta === o.aberta}
                    onClick={() => setVerAberta(o.aberta)}
                    className={cn(
                      'rounded px-2 py-1 transition-colors',
                      verAberta === o.aberta ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {o.rotulo}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setHistorico(true)}>
              Mais detalhes
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!bloco ? (
          aberta.error ? (
            <p className="text-xs text-destructive">
              {aberta.error instanceof Error ? aberta.error.message : 'Não foi possível carregar.'}
            </p>
          ) : (
            <Skeleton className="h-40 w-full" />
          )
        ) : (
          <Conteudo bloco={bloco} doReport={!mostrandoAberta} onAbrir={onAbrir} />
        )}
      </CardContent>
      <HistoricoAquisicao aberto={historico} onFechar={() => setHistorico(false)} onAbrir={onAbrir} />
    </Card>
  )
}

function Conteudo({
  bloco, doReport, onAbrir,
}: {
  bloco: BlocoAquisicao
  doReport: boolean
  onAbrir: Abrir
}) {
  const matriz = matrizDoBloco(bloco)
  const total = totalDoBloco(bloco)

  const abrirLeads = (origem: string, fit: string, n: number) =>
    onAbrir(alvoDe(bloco, doReport, 'aq_leads', { origem, fit }), n)
  const abrirReunioes = (fato: FatoReuniao, origem: string, n: number) =>
    onAbrir(alvoDe(bloco, doReport, 'aq_reunioes', { fato, origem }), n)

  return (
    <>
      {/* ── §2.1 A matriz ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">
          <strong className="font-medium text-foreground">Coorte</strong> — os leads distribuídos nesta
          semana, com o fit que têm hoje. Quem for avaliado depois continua contando aqui.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="p-1.5 text-left font-medium" />
                {FITS_AQUISICAO.map((f) => (
                  <th key={f} className="p-1.5 text-right font-medium">{FIT_AQUISICAO_LABELS[f]}</th>
                ))}
                <th className="p-1.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {matriz.map((l) => (
                <tr
                  key={l.origem}
                  className={cn('border-b last:border-0', l.origem === 'total' && 'font-medium')}
                >
                  <th className="p-1.5 text-left font-medium">
                    {ORIGEM_AQUISICAO_LABELS[l.origem]}
                    {l.origem === 'sem_origem' && (
                      <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-600" aria-label="problema de cadastro" />
                    )}
                  </th>
                  {FITS_AQUISICAO.map((f) => (
                    <td key={f} className="p-1.5 text-right">
                      <Numero n={l[f]} onClick={() => abrirLeads(l.origem, f, l[f])} />
                      <span className="ml-1 inline-block w-11 text-left text-[10px] text-muted-foreground tabular-nums">
                        {l.pct[f] === null ? '' : `${l.pct[f]!.toLocaleString('pt-BR')}%`}
                      </span>
                    </td>
                  ))}
                  <td className="p-1.5 text-right">
                    <Numero n={l.total} onClick={() => abrirLeads(l.origem, 'total', l.total)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {temSemOrigem(bloco) && (
          <p className="text-[11px] text-amber-700 dark:text-amber-500">
            Há registro sem origem — é problema de cadastro, e não foi distribuído entre inbound e
            outbound por chute.
          </p>
        )}
        {bloco.em_aberto && (
          <p className="text-[11px] text-muted-foreground">
            Semana em aberto: “ainda não avaliado” é grande porque os leads acabaram de entrar. É o
            esperado, e não quer dizer que a qualidade caiu.
          </p>
        )}
        {total.expirados_sem_avaliar > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Dos {total.nao_avaliado} não avaliados, {total.expirados_sem_avaliar} expiraram sem contato:
            voltaram ao pool e não serão avaliados neste ciclo.
          </p>
        )}
      </div>

      {/* ── §2.2 Reuniões ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5 border-t pt-3">
        <p className="text-[11px] text-muted-foreground">
          <strong className="font-medium text-foreground">Janela</strong> —{' '}
          {NATUREZA_EXPLICA.janela.toLowerCase()}.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            { fato: 'agendada', rotulo: 'Agendadas na semana', explica: 'marcadas nestes dias, aconteçam quando acontecerem' },
            { fato: 'realizada', rotulo: 'Realizadas na semana', explica: 'aconteceram nestes dias, marcadas quando tenham sido' },
          ] as const).map((m) => {
            const campo = CAMPO_DO_FATO[m.fato]
            return (
              <div key={m.fato} className="rounded-md border p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.rotulo}</p>
                <p className="mt-0.5 text-xl font-semibold">
                  <Numero n={total[campo]} onClick={() => abrirReunioes(m.fato, 'total', total[campo])} className="no-underline hover:underline" />
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {bloco.origens.map((o, i) => (
                    <React.Fragment key={o.origem}>
                      {i > 0 ? ' · ' : ''}
                      <Numero n={o[campo]} onClick={() => abrirReunioes(m.fato, o.origem, o[campo])} />{' '}
                      {ORIGEM_AQUISICAO_LABELS[o.origem].toLowerCase()}
                    </React.Fragment>
                  ))}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">{m.explica}</p>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {([
            { fato: 'cancelada', rotulo: 'canceladas' },
            { fato: 'remarcada', rotulo: 'remarcadas' },
            { fato: 'no_show', rotulo: 'no-shows' },
          ] as const).map((m, i) => (
            <React.Fragment key={m.fato}>
              {i > 0 ? ' · ' : ''}
              <Numero
                n={total[CAMPO_DO_FATO[m.fato]]}
                onClick={() => abrirReunioes(m.fato, 'total', total[CAMPO_DO_FATO[m.fato]])}
                className="font-medium text-foreground"
              />{' '}
              {m.rotulo}
            </React.Fragment>
          ))}
        </p>
        {/* Higiene de dado, discreta de propósito: não é acusação, e vale ver crescer. */}
        {(total.sem_captura > 0 || total.sem_desfecho > 0) && (
          <p className="text-[11px] text-muted-foreground">
            {total.sem_captura > 0 && (
              <>
                realizadas sem captura —{' '}
                <Numero n={total.sem_captura} onClick={() => abrirReunioes('sem_captura', 'total', total.sem_captura)} />
              </>
            )}
            {total.sem_captura > 0 && total.sem_desfecho > 0 ? ' · ' : ''}
            {total.sem_desfecho > 0 && (
              <>
                hora passou e ninguém registrou o desfecho —{' '}
                <Numero n={total.sem_desfecho} onClick={() => abrirReunioes('sem_desfecho', 'total', total.sem_desfecho)} />
              </>
            )}
          </p>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Agendadas e realizadas são conjuntos diferentes — quem marcou na sexta realiza na semana
          seguinte. Uma não é taxa da outra.
        </p>
      </div>
    </>
  )
}

// ─── §3 Mais detalhes ───────────────────────────────────────────────────────

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesExtenso = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym}/${ym.slice(2, 4)}`

const COLUNAS_SERIE: { origem: OrigemAquisicao; fit: FitAquisicao; rotulo: string }[] = [
  { origem: 'inbound', fit: 'com_fit', rotulo: 'In · fit' },
  { origem: 'inbound', fit: 'sem_fit', rotulo: 'In · sem fit' },
  { origem: 'inbound', fit: 'nao_avaliado', rotulo: 'In · não aval.' },
  { origem: 'outbound', fit: 'com_fit', rotulo: 'Out · fit' },
  { origem: 'outbound', fit: 'sem_fit', rotulo: 'Out · sem fit' },
  { origem: 'outbound', fit: 'nao_avaliado', rotulo: 'Out · não aval.' },
]

function HistoricoAquisicao({
  aberto, onFechar, onAbrir,
}: {
  aberto: boolean
  onFechar: () => void
  onAbrir: Abrir
}) {
  const q = useQuery({
    queryKey: relatoriosKeys.aquisicaoHistorico(),
    queryFn: buscarHistoricoAquisicao,
    enabled: aberto,
  })
  const semanas = React.useMemo(() => q.data?.semanas ?? [], [q.data])
  const mesCorrente = diaEmSaoPaulo(new Date()).slice(0, 7)

  /* A do topo é sempre a em aberto, mesmo que ela vá fechar em outro mês: é a semana que
     está acontecendo, e sumir com ela na virada do mês seria esconder o presente. */
  const doMes = semanas.filter((s) => s.em_aberto || mesDaSemana(s) === mesCorrente)

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aquisição — histórico</DialogTitle>
          <DialogDescription>
            Semana é de segunda a domingo; fechada é a que o último dia já passou. A semana em aberto
            aparece, mas nunca entra em média nem em total.
          </DialogDescription>
        </DialogHeader>

        {q.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : q.error ? (
          <p className="py-8 text-center text-sm text-destructive">
            {q.error instanceof Error ? q.error.message : 'Não foi possível carregar o histórico.'}
          </p>
        ) : (
          <Tabs defaultValue="mes">
            <TabsList className="h-8">
              <TabsTrigger value="mes" className="text-xs">Mês corrente</TabsTrigger>
              <TabsTrigger value="tres" className="text-xs">Últimos três meses</TabsTrigger>
            </TabsList>

            <TabsContent value="mes" className="space-y-2">
              <TabelaSemanas semanas={doMes} onAbrir={onAbrir} />
              {doMes.filter((s) => !s.em_aberto).length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Nenhuma semana de {mesExtenso(mesCorrente)} fechou ainda.
                </p>
              )}
            </TabsContent>

            <TabsContent value="tres" className="space-y-4">
              <SerieAquisicaoChart
                pontos={serieDeAquisicao(semanas)}
                onPonto={(p, serie) => {
                  const rec = RECORTE_DA_SERIE[serie]
                  onAbrir(
                    { chave: 'aq_leads', params: { origem: rec.origem, fit: rec.fit }, inicio: p.inicio, fim: p.fim },
                    p[serie],
                  )
                }}
              />
              <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
                <TabelaSemanas semanas={semanas} onAbrir={onAbrir} />
                <TabelaMeses semanas={semanas} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Uma linha por semana, com a mesma matriz do card e as duas contagens de reunião. */
function TabelaSemanas({ semanas, onAbrir }: { semanas: BlocoAquisicao[]; onAbrir: Abrir }) {
  const media = (campo: CampoAquisicao) => agregadoDeAquisicao(semanas, campo)
  const fechadas = media('total_leads').semanas
  /* O total por célula passa pela MESMA porta do agregado: uma lista só com fechadas. */
  const somaCelula = (origem: OrigemAquisicao, fit: FitAquisicao) =>
    semanas.filter((s) => !s.em_aberto).reduce((t, s) => t + valorDaCelula(s, origem, fit), 0)

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="whitespace-nowrap p-2 text-left font-medium">Semana</th>
            {COLUNAS_SERIE.map((c) => (
              <th key={c.rotulo} className="whitespace-nowrap p-2 text-right font-medium">{c.rotulo}</th>
            ))}
            <th className="whitespace-nowrap p-2 text-right font-medium">Agendadas</th>
            <th className="whitespace-nowrap p-2 text-right font-medium">Realizadas</th>
          </tr>
        </thead>
        <tbody>
          {semanas.map((s) => {
            const t = totalDoBloco(s)
            const alvo = (chave: 'aq_leads' | 'aq_reunioes', params: Record<string, string>): AlvoDetalhe =>
              ({ chave, params, inicio: s.inicio, fim: s.fim })
            return (
              <tr
                key={s.inicio}
                className={cn(
                  'border-b last:border-0',
                  /* Visualmente distinta: tracejada, itálica e com o selo. Quem bate o olho
                     na coluna não pode somar esta linha às de baixo sem perceber. */
                  s.em_aberto && 'border-dashed bg-muted/40 italic',
                )}
              >
                <th className="whitespace-nowrap p-2 text-left font-medium">
                  {dm(s.inicio)} a {dm(s.fim)}
                  {s.em_aberto && (
                    <span className="ml-1.5 rounded border border-amber-600/50 px-1 py-px text-[10px] not-italic text-amber-700 dark:text-amber-500">
                      em aberto
                    </span>
                  )}
                </th>
                {COLUNAS_SERIE.map((c) => {
                  const v = valorDaCelula(s, c.origem, c.fit)
                  return (
                    <td key={c.rotulo} className="p-2 text-right">
                      <Numero n={v} onClick={() => onAbrir(alvo('aq_leads', { origem: c.origem, fit: c.fit }), v)} />
                    </td>
                  )
                })}
                <td className="p-2 text-right">
                  <Numero n={t.agendadas} onClick={() => onAbrir(alvo('aq_reunioes', { fato: 'agendada', origem: 'total' }), t.agendadas)} />
                </td>
                <td className="p-2 text-right">
                  <Numero n={t.realizadas} onClick={() => onAbrir(alvo('aq_reunioes', { fato: 'realizada', origem: 'total' }), t.realizadas)} />
                </td>
              </tr>
            )
          })}
        </tbody>
        {fechadas > 0 && (
          <tfoot className="border-t bg-muted/30 font-medium">
            <tr>
              <th className="whitespace-nowrap p-2 text-left font-medium">
                Total · {fechadas} {fechadas === 1 ? 'semana fechada' : 'semanas fechadas'}
              </th>
              {COLUNAS_SERIE.map((c) => (
                <td key={c.rotulo} className="p-2 text-right tabular-nums">
                  {somaCelula(c.origem, c.fit).toLocaleString('pt-BR')}
                </td>
              ))}
              <td className="p-2 text-right tabular-nums">{media('agendadas').total.toLocaleString('pt-BR')}</td>
              <td className="p-2 text-right tabular-nums">{media('realizadas').total.toLocaleString('pt-BR')}</td>
            </tr>
            <tr className="text-muted-foreground">
              <th className="whitespace-nowrap p-2 text-left font-normal">Média por semana fechada</th>
              {COLUNAS_SERIE.map((c) => (
                <td key={c.rotulo} className="p-2 text-right tabular-nums">
                  {(somaCelula(c.origem, c.fit) / fechadas).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                </td>
              ))}
              {(['agendadas', 'realizadas'] as const).map((k) => (
                <td key={k} className="p-2 text-right tabular-nums">
                  {(media(k).media ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** O agregado mensal: só semanas fechadas, cada uma no mês em que fecha. */
function TabelaMeses({ semanas }: { semanas: BlocoAquisicao[] }) {
  const meses = aquisicaoPorMes(semanas)
  if (meses.length === 0) return null
  return (
    <div className="h-fit overflow-x-auto rounded-md border">
      <table className="text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="p-2 text-left font-medium">Mês</th>
            <th className="p-2 text-right font-medium">Leads</th>
            <th className="p-2 text-right font-medium">Com fit</th>
            <th className="p-2 text-right font-medium">Sem fit</th>
            <th className="p-2 text-right font-medium">Agend.</th>
            <th className="p-2 text-right font-medium">Realiz.</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m) => (
            <tr key={m.mes} className="border-b last:border-0">
              <th className="whitespace-nowrap p-2 text-left font-medium">
                {mesExtenso(m.mes)}
                <span className="ml-1 font-normal text-muted-foreground">· {m.semanas} sem.</span>
              </th>
              {([m.total_leads, m.com_fit, m.sem_fit, m.agendadas, m.realizadas]).map((v, i) => (
                <td key={i} className="p-2 text-right tabular-nums">{v.toLocaleString('pt-BR')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t p-2 text-[10px] text-muted-foreground">
        A semana conta no mês em que fecha. A em aberto ({dm(semanaDe(diaEmSaoPaulo(new Date())).inicio)}…)
        fica fora.
      </p>
    </div>
  )
}
