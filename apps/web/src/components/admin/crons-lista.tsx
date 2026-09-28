import { AlertTriangle, ArrowRight, Clock } from 'lucide-react'
import {
  CRONS,
  LIMITE_SEM_RETORNO_HORAS,
  getModule,
  saudeDaRotina,
  saudeGeral,
  type CorSaude,
  type CronDaPlataforma,
  type ExecucaoCron,
} from '@jobsiteos/core'
import { CronsSaude, type LinhaSaude } from '@/components/admin/crons-saude'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * A agenda da plataforma inteira numa tela.
 *
 * Tudo é formatado NO SERVIDOR, em America/Sao_Paulo: se a data fosse montada no
 * cliente, o servidor (UTC) e o navegador renderizariam strings diferentes e o
 * React acusaria hydration mismatch — além de a tela mudar de horário conforme o
 * relógio de quem abre, que é exatamente a confusão que ela existe para acabar.
 */

const CADENCIA_LABEL: Record<string, string> = {
  diaria: 'Diário',
  semanal: 'Semanal',
  mensal: 'Mensal',
  outra: 'Outra',
}

const relativo = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

function daquiA(alvo: Date, agora: Date): string {
  const minutos = Math.round((alvo.getTime() - agora.getTime()) / 60000)
  if (Math.abs(minutos) < 60) return relativo.format(minutos, 'minute')
  const horas = Math.round(minutos / 60)
  if (Math.abs(horas) < 48) return relativo.format(horas, 'hour')
  return relativo.format(Math.round(horas / 24), 'day')
}

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const ORDEM_COR: Record<CorSaude, number> = { vermelha: 0, amarela: 1, verde: 2 }

const limitePorPath = new Map(CRONS.map((c) => [c.path, c.limiteSemRetornoHoras ?? LIMITE_SEM_RETORNO_HORAS]))

/** A linha de cada rotina AGENDADA — a que não está no vercel.json não tem o que rodar. */
function linhasDeSaude(crons: CronDaPlataforma[], ultimas: ExecucaoCron[], agora: Date): LinhaSaude[] {
  const porPath = new Map(ultimas.map((u) => [u.path, u]))

  return crons
    .filter((c) => !c.naoAgendado)
    .map((c) => {
      const ultima = porPath.get(c.path) ?? null
      const { cor, rotulo } = saudeDaRotina(ultima, agora, limitePorPath.get(c.path))
      // A falta é datada pelo horário que a agenda previa, não por quando o monitor a viu.
      const momento = ultima ? new Date(ultima.esperado_em ?? ultima.iniciado_em) : null
      return {
        path: c.path,
        nome: c.nome,
        cor,
        rotulo,
        quando: momento ? dataHora.format(momento) : null,
        relativo: momento ? daquiA(momento, agora) : null,
        erro: ultima && cor !== 'verde' ? ultima.erro : null,
      }
    })
    .sort((a, b) => ORDEM_COR[a.cor] - ORDEM_COR[b.cor] || a.nome.localeCompare(b.nome, 'pt-BR'))
}

function resumoDaSaude(linhas: LinhaSaude[]): string {
  const vermelhas = linhas.filter((l) => l.cor === 'vermelha').length
  const amarelas = linhas.filter((l) => l.cor === 'amarela').length
  if (!vermelhas && !amarelas) return `Todas as ${linhas.length} rotinas rodaram na última vez.`
  const partes = [
    vermelhas && `${vermelhas} com falha`,
    amarelas && `${amarelas} sem confirmação`,
  ].filter(Boolean)
  return `${linhas.length} rotinas: ${partes.join(', ')}.`
}

export function CronsLista({
  crons,
  ultimas,
  agora,
}: {
  crons: CronDaPlataforma[]
  ultimas: ExecucaoCron[]
  agora: Date
}) {
  const problemas = crons.filter((c) => c.naoAgendado || c.semCatalogo || c.erro)
  const saude = linhasDeSaude(crons, ultimas, agora)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Rotinas agendadas</h2>
        <p className="text-sm text-muted-foreground">
          {crons.length} rotinas. Os horários são de Brasília; a Vercel dispara em UTC, e a expressão
          ao lado é a que está valendo em <code className="text-xs">apps/web/vercel.json</code>.
        </p>
      </div>

      <CronsSaude
        rotinas={saude}
        geral={saudeGeral(saude.map((l) => l.cor))}
        resumo={resumoDaSaude(saude)}
      />

      {problemas.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <CardTitle className="text-base">Divergência entre o catálogo e a agenda</CardTitle>
              <CardDescription>
                {/* Um job que nunca roda não gera erro nenhum — só um número que não muda. */}
                Uma rotina catalogada sem agenda não roda, e ninguém é avisado disso: nada falha, os
                dados apenas param de chegar. Uma agendada sem catálogo roda sem que ninguém aqui
                saiba o que ela faz.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="ml-8 list-disc space-y-1 text-sm">
              {problemas.map((c) => (
                <li key={c.path}>
                  <span className="font-medium">{c.nome}</span>{' '}
                  {c.naoAgendado
                    ? '— catalogada, mas sem cron na Vercel.'
                    : c.semCatalogo
                      ? '— agendada, mas sem entrada no catálogo.'
                      : `— expressão não entendida: ${c.erro}`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rotina</TableHead>
                <TableHead>Módulo</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead>Próxima</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crons.map((cron) => {
                const modulo = cron.moduloId ? getModule(cron.moduloId) : undefined
                const agenda = cron.descricaoAgenda

                return (
                  <TableRow key={cron.path} className={cn(cron.naoAgendado && 'opacity-60')}>
                    <TableCell className="max-w-md align-top">
                      <p className="font-medium">{cron.nome}</p>
                      {cron.descricao && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {cron.descricao}
                        </p>
                      )}
                      {cron.destino && (
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {cron.path} → {cron.destino}
                        </p>
                      )}
                      {cron.encadeia?.map((e) => (
                        <p
                          key={e}
                          className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"
                        >
                          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                          {e}
                        </p>
                      ))}
                    </TableCell>

                    <TableCell className="align-top">
                      {modulo ? (
                        <Badge variant="secondary" className="whitespace-nowrap">
                          {modulo.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      {agenda ? (
                        <div className="space-y-1">
                          <Badge variant="outline" className="whitespace-nowrap">
                            {CADENCIA_LABEL[agenda.cadencia] ?? agenda.cadencia}
                          </Badge>
                          <p className="text-sm">
                            {agenda.periodicidade}, às {agenda.horariosBrasilia.join(', ')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {agenda.horariosUtc.join(', ')} UTC
                            {/* 01:30 UTC é 22:30 do dia anterior aqui. Sem isto, a linha
                                pareceria dizer que o job roda de madrugada e de noite. */}
                            {agenda.viraDia && ' · o primeiro horário cai na véspera em Brasília'}
                          </p>
                          <code className="text-[11px] text-muted-foreground">{cron.schedule}</code>
                        </div>
                      ) : (
                        <Badge variant="destructive">Não agendada</Badge>
                      )}
                    </TableCell>

                    <TableCell className="align-top whitespace-nowrap">
                      {cron.proxima ? (
                        <div className="space-y-0.5">
                          <p className="flex items-center gap-1.5 text-sm">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                            {dataHora.format(cron.proxima)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {daquiA(cron.proxima, agora)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
