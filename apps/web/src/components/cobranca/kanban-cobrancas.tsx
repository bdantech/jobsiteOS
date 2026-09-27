'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus } from 'lucide-react'
import {
  COBRANCA_ESTAGIO_LABELS,
  COBRANCA_ESTAGIOS,
  COBRANCA_ESTAGIOS_ENCERRADOS,
  type CobrancaEstagio,
} from '@jobsiteos/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CabecalhoDaColuna,
  CardDoFunil,
  ChipDoCard,
  ColunaVazia,
  DonoNoRodape,
  TiraDoCard,
} from '@/components/comercial/card-funil'
import { cn } from '@/lib/utils'
import { MoverEstagioMenu } from './cobranca-detalhe-comum'
import { brl, cnpj, corDoPrazo, MARCO_APOLICE_LABELS, prazoTexto } from './format'
import { buscarCards, cobrancaKeys, type CardCobranca } from './queries'

/**
 * Kanban de cobranças (§12). Mesmo shell de card dos funis do Comercial: quem trabalha
 * nos dois módulos lê a mesma hierarquia — de quem é, quanto vale, o que está correndo.
 *
 * Sem arrastar-e-soltar, pelo mesmo motivo da esteira de crédito: encerrar com perda
 * exige motivo, e `notificada`, `acordo_firmado` e `judicializada` são consequência de
 * um ATO (envio, acordo assinado, processo) — um gesto de arrastar ofereceria pular o
 * ato. O menu "Mover" só lista o que o RPC aceitaria.
 *
 * A tira do card é o prazo da apólice: é o número que faz uma cobrança perder dinheiro
 * em silêncio, e é o que o olho precisa achar primeiro numa coluna cheia.
 */

const COLUNAS_ATIVAS = COBRANCA_ESTAGIOS.filter(
  (e) => !(COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(e),
) as CobrancaEstagio[]

const FAIXAS_ATRASO = [
  { id: '15-30', rotulo: '15–30 dias', de: 0, ate: 30 },
  { id: '31-60', rotulo: '31–60 dias', de: 31, ate: 60 },
  { id: '61-90', rotulo: '61–90 dias', de: 61, ate: 90 },
  { id: '91-180', rotulo: '91–180 dias', de: 91, ate: 180 },
  { id: '180+', rotulo: 'mais de 180 dias', de: 181, ate: Number.POSITIVE_INFINITY },
] as const

const BRL0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export function KanbanCobrancas() {
  const [encerradas, setEncerradas] = React.useState(false)
  const [responsavel, setResponsavel] = React.useState('todos')
  const [sacado, setSacado] = React.useState('')
  const [faixa, setFaixa] = React.useState('todas')
  const [valorMin, setValorMin] = React.useState('')
  const [risco, setRisco] = React.useState('todos')

  const cards = useQuery({ queryKey: cobrancaKeys.cards(encerradas), queryFn: () => buscarCards(encerradas) })

  const todas = React.useMemo(() => cards.data ?? [], [cards.data])
  const responsaveis = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const c of todas) if (c.responsavel_id) m.set(c.responsavel_id, c.responsavel_nome ?? 'Sem nome')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [todas])

  const termo = sacado.trim().toLowerCase()
  const termoDigitos = termo.replace(/\D/g, '')
  const minimo = Number(valorMin.replace(/\./g, '').replace(',', '.'))
  const faixaSel = FAIXAS_ATRASO.find((f) => f.id === faixa)

  const visiveis = todas.filter((c) => {
    if (responsavel === 'sem' && c.responsavel_id) return false
    if (responsavel !== 'todos' && responsavel !== 'sem' && c.responsavel_id !== responsavel) return false
    if (termo) {
      const nome = (c.sacado_razao_social ?? '').toLowerCase()
      const porCnpj = termoDigitos.length >= 3 && (c.sacado_matriz_cnpj ?? '').includes(termoDigitos)
      const porCodigo = (c.codigo ?? '').toLowerCase().includes(termo)
      if (!nome.includes(termo) && !porCnpj && !porCodigo) return false
    }
    if (faixaSel) {
      const d = c.max_dias_atraso ?? 0
      if (d < faixaSel.de || d > faixaSel.ate) return false
    }
    if (valorMin && Number.isFinite(minimo) && Number(c.valor_em_aberto ?? 0) < minimo) return false
    if (risco !== 'todos') {
      const lim = Number(risco)
      if (c.dias_restantes === null || c.dias_restantes > lim) return false
    }
    return true
  })

  const porEstagio = new Map<string, CardCobranca[]>()
  for (const c of visiveis) porEstagio.set(c.estagio ?? '', [...(porEstagio.get(c.estagio ?? '') ?? []), c])
  // Dentro da coluna, o prazo de apólice mais curto primeiro: é a ordem da urgência.
  for (const lista of porEstagio.values()) {
    lista.sort((a, b) => (a.dias_restantes ?? 1e9) - (b.dias_restantes ?? 1e9))
  }

  const colunas: CobrancaEstagio[] = encerradas ? [...COBRANCA_ESTAGIOS] : COLUNAS_ATIVAS

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Cobranças</CardTitle>
              <CardDescription>
                {visiveis.length} de {todas.length} cobrança(s). O card mostra o próximo prazo da apólice
                de qualquer título dela — perder o D+90 é perder a indenização.
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <input type="checkbox" checked={encerradas} onChange={(e) => setEncerradas(e.target.checked)} />
                Mostrar encerradas
              </label>
              <Button size="sm" asChild>
                <Link href="/cobranca/nova">
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  Nova cobrança
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              placeholder="Sacado, CNPJ ou código"
              value={sacado}
              onChange={(e) => setSacado(e.target.value)}
              aria-label="Filtrar por sacado"
            />
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger aria-label="Responsável">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {responsaveis.map(([id, nome]) => (
                  <SelectItem key={id} value={id}>
                    {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={faixa} onValueChange={setFaixa}>
              <SelectTrigger aria-label="Faixa de atraso">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Qualquer atraso</SelectItem>
                {FAIXAS_ATRASO.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              inputMode="decimal"
              placeholder="Valor mínimo em aberto (R$)"
              value={valorMin}
              onChange={(e) => setValorMin(e.target.value)}
              aria-label="Valor mínimo"
            />
            <Select value={risco} onValueChange={setRisco}>
              <SelectTrigger aria-label="Risco de prazo da apólice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Qualquer prazo de apólice</SelectItem>
                <SelectItem value="5">Prazo em até 5 dias</SelectItem>
                <SelectItem value="15">Prazo em até 15 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent>
          {cards.isPending ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : cards.isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {cards.error instanceof Error ? cards.error.message : 'Erro ao carregar as cobranças.'}
              </p>
            </div>
          ) : todas.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhuma cobrança {encerradas ? '' : 'em andamento'}.</p>
              <p className="mt-1">
                A cobrança extrajudicial começa em D+15. Antes disso, o atraso é tratado na plataforma de
                produção.
              </p>
            </div>
          ) : (
            <div className="flex gap-5 overflow-x-auto pb-3">
              {colunas.map((coluna) => {
                const itens = porEstagio.get(coluna) ?? []
                return (
                  <div key={coluna} className="w-[290px] shrink-0 space-y-3">
                    <CabecalhoDaColuna titulo={COBRANCA_ESTAGIO_LABELS[coluna]} total={itens.length} />
                    <div className="space-y-3">
                      {itens.map((c) => (
                        <CardDaCobranca key={c.id} c={c} />
                      ))}
                      {itens.length === 0 && <ColunaVazia>Nenhuma cobrança</ColunaVazia>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CardDaCobranca({ c }: { c: CardCobranca }) {
  const encerrada = (COBRANCA_ESTAGIOS_ENCERRADOS as readonly string[]).includes(c.estagio ?? '')
  const spes = c.qtd_spes ?? 0
  const dias = c.dias_restantes

  return (
    <CardDoFunil
      rotuloAbrir={`Abrir cobrança ${c.codigo ?? ''} de ${c.sacado_razao_social ?? 'sacado'}`}
      href={`/cobranca/cobrancas/${c.id}`}
      esmaecido={encerrada}
      titulo={c.sacado_razao_social ?? cnpj(c.sacado_matriz_cnpj)}
      valor={
        <span className="flex flex-col gap-0.5">
          <span>
            {BRL0.format(Number(c.valor_em_aberto ?? c.valor_face ?? 0))}
            <span className="font-normal text-muted-foreground"> em aberto</span>
          </span>
          <span className="text-[11.5px] font-normal text-muted-foreground">
            Face {brl(c.valor_face, 0)} · Atualizado {c.valor_atualizado ? brl(c.valor_atualizado, 0) : '—'}
          </span>
        </span>
      }
      chips={
        <>
          <ChipDoCard forte>{c.codigo ?? '—'}</ChipDoCard>
          <ChipDoCard>
            {c.qtd_titulos ?? 0} título(s)
            {spes > 0 ? ` · ${spes} SPE${spes > 1 ? 's' : ''}` : ''}
          </ChipDoCard>
          {c.tem_protesto ? <ChipDoCard tom="alerta">Protesto</ChipDoCard> : null}
          {c.tem_sinistro ? <ChipDoCard tom="ruim">Sinistro</ChipDoCard> : null}
          {c.tem_processo ? <ChipDoCard tom="info">Processo</ChipDoCard> : null}
          {c.tem_acordo ? <ChipDoCard tom="destaque">Acordo</ChipDoCard> : null}
        </>
      }
      rodapeEsquerda={
        <span className="relative z-10 flex items-center gap-2">
          <DonoNoRodape nome={c.responsavel_nome ?? null} />
        </span>
      }
      rodapeDireita={
        <span className="relative z-10 inline-flex items-center gap-2">
          {c.dias_desde_notificacao !== null ? (
            <span title="Dias desde a primeira notificação">notif. há {c.dias_desde_notificacao} d</span>
          ) : (
            <span>sem envio</span>
          )}
          {c.id && c.estagio ? (
            <MoverEstagioMenu cobrancaId={c.id} estagio={c.estagio} qtdAtivos={c.qtd_ativos ?? 0} tamanho="xs" />
          ) : null}
        </span>
      }
      tira={
        c.proximo_marco ? (
          <TiraDoCard tom={dias !== null && dias <= 5 ? 'ruim' : dias !== null && dias <= 15 ? 'alerta' : 'neutro'}>
            {MARCO_APOLICE_LABELS[c.proximo_marco] ?? c.proximo_marco}{' '}
            <span className={cn('tabular-nums', corDoPrazo(dias))}>{prazoTexto(dias)}</span>
          </TiraDoCard>
        ) : undefined
      }
    />
  )
}
