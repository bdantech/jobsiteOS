'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Download, FileText, Loader2, Settings2 } from 'lucide-react'
import {
  ETAPA_FUNIL_LABELS,
  brlCurto,
  direcaoDa,
  maiorVazamento,
  textoDaRegua,
  textoDoRetrato,
  variacaoTexto,
  type IndicadorReport,
  type ItemLista,
  type ReportSemanal,
} from '@jobsiteos/core'
import { gerarPreviaAction } from '@/actions/relatorios'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { LinkEmAba } from '@/components/shell/link-em-aba'
import { cn } from '@/lib/utils'
import {
  BarraCobertura, ConversaoPorFaixa, FunilEtapas, OciosoPorGestor, RankingTime,
} from './graficos-report'
import { ConfigEnvio } from './config-envio'
import {
  buscarExecucao, buscarExecucoes, buscarReport, nomeDoPdf, relatoriosKeys, urlDoPdf,
} from './queries'

/**
 * A aba Relatórios (04q §3).
 *
 * Os MESMOS números do PDF, vindos da mesma estrutura — nada é recalculado aqui. O que a
 * tela acrescenta é o que o papel não faz: a forma dos doze meses, as duas barras lado a
 * lado, e o CLIQUE.
 *
 * ─── A REGRA DE INTERAÇÃO É A DO MEU DIA ────────────────────────────────────
 * Clicar num indicador ou num segmento abre MODAL com a lista que o compõe. Nunca navega.
 * Quem está lendo o report está montando um raciocínio sobre a semana; trocar a página
 * embaixo dessa pessoa a obriga a reconstruir de onde veio. Do modal, o link para a ficha
 * abre numa aba do sistema — aí sim ela sai, porque decidiu sair.
 */

export function RelatoriosTela({ podeGerar }: { podeGerar: boolean }) {
  const qc = useQueryClient()
  const [execucaoId, setExecucaoId] = React.useState<string | null>(null)
  const [modal, setModal] = React.useState<{ titulo: string; nota?: string; itens: ItemLista[] } | null>(null)
  const [configAberta, setConfigAberta] = React.useState(false)
  const [gerando, setGerando] = React.useState(false)

  const execucoes = useQuery({ queryKey: relatoriosKeys.execucoes(), queryFn: buscarExecucoes })

  /*
   * Duas fontes, e a escolha é do usuário: o AO VIVO (números de agora) ou o SNAPSHOT de
   * uma execução (números da época). Um report de três meses atrás aberto com os números
   * de hoje mostraria um passado que nunca existiu — a nota mudou de estágio, o cliente
   * saiu da carteira.
   */
  const aoVivo = useQuery({
    queryKey: relatoriosKeys.periodo(null, null),
    queryFn: () => buscarReport(),
    enabled: execucaoId === null,
  })
  const historico = useQuery({
    queryKey: ['relatorios', 'execucao', execucaoId],
    queryFn: () => buscarExecucao(execucaoId!),
    enabled: execucaoId !== null,
  })

  const r = execucaoId === null ? aoVivo.data : historico.data
  const carregando = execucaoId === null ? aoVivo.isPending : historico.isPending
  const erro = execucaoId === null ? aoVivo.error : historico.error

  async function gerarPdf() {
    setGerando(true)
    const res = await gerarPreviaAction()
    setGerando(false)
    if (!res.ok) return toast.error(res.message)
    toast.success('PDF gerado. Ele está no histórico, abaixo.')
    void qc.invalidateQueries({ queryKey: relatoriosKeys.execucoes() })
  }

  /*
   * Baixar com uma ÂNCORA, não com `window.open`.
   *
   * O link assinado só existe depois de uma ida ao Storage, e `window.open` chamado depois
   * do `await` já perdeu o gesto do usuário: o navegador o classifica como pop-up e bloqueia
   * — sem erro, sem aba, o clique simplesmente não faz nada. Foi esse o sintoma de "o PDF
   * foi gerado, só não consegui baixá-lo". O clique numa âncora `download` não passa por
   * esse bloqueio, e como o link já vem com `Content-Disposition: attachment` o arquivo
   * baixa sem tirar ninguém da página.
   */
  async function baixar(caminho: string) {
    const r = await urlDoPdf(caminho)
    if ('erro' in r) return toast.error(`Não foi possível abrir o arquivo: ${r.erro}`)
    const a = document.createElement('a')
    a.href = r.url
    a.download = nomeDoPdf(caminho)
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Relatórios</h1>
          <p className="text-xs text-muted-foreground">
            {r
              ? `Semana ${r.periodo.semana_iso} · ${dm(r.periodo.inicio)} a ${dm(r.periodo.fim)}` +
                ` · mês corrente parcial (${r.periodo.mes_dias_decorridos} de ${r.periodo.mes_dias_total} dias)`
              : 'Report semanal executivo'}
          </p>
          {/* De quando é cada metade da página. Metade dos números é FLUXO da janela e
              metade é ESTOQUE do momento da leitura; sem esta linha as duas se leem como se
              fossem a mesma coisa, e é aí que a tela e o anexo "não batem". */}
          {r ? (
            <p className="text-[11px] text-muted-foreground">{textoDoRetrato(r.periodo)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Período"
            value={execucaoId ?? ''}
            onChange={(e) => setExecucaoId(e.target.value || null)}
            className="h-8 w-64 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Semana fechada mais recente (ao vivo)</option>
            {(execucoes.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {dm(e.periodo_inicio)} a {dm(e.periodo_fim)} · {ROTULO_STATUS[e.status] ?? e.status}
              </option>
            ))}
          </select>
          {podeGerar && (
            <Button size="sm" variant="outline" onClick={() => void gerarPdf()} disabled={gerando}>
              {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1 h-3.5 w-3.5" />}
              Gerar PDF agora
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setConfigAberta(true)}>
            <Settings2 className="mr-1 h-3.5 w-3.5" aria-hidden />
            Configurar envio
          </Button>
        </div>
      </div>

      {carregando && <Skeleton className="h-96 w-full rounded-lg" />}

      {erro && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {erro instanceof Error ? erro.message : 'Não foi possível carregar o report.'}
            </p>
          </CardContent>
        </Card>
      )}

      {r && (
        <>
          {r.periodo && execucaoId !== null && (
            <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
              Você está vendo o SNAPSHOT desta execução — os números como estavam quando ela
              rodou, e não os de agora.
            </p>
          )}

          <Resumo r={r} execucaoId={execucaoId} execucoes={execucoes.data ?? []} />

          <FaixaKpis r={r} onAbrir={setModal} />

          <div className="grid gap-4 xl:grid-cols-2">
            <BlocoFunil r={r} onAbrir={setModal} />
            <BlocoNf r={r} onAbrir={setModal} />
            <BlocoCarteira r={r} onAbrir={setModal} />
            <BlocoCertificados r={r} onAbrir={setModal} />
            <BlocoTime r={r} onAbrir={setModal} />
            <BlocoAtencao r={r} />
          </div>

          <Historico
            execucoes={execucoes.data ?? []}
            onAbrir={setExecucaoId}
            onBaixar={(c) => void baixar(c)}
          />
        </>
      )}

      <ModalLista aberto={modal} onFechar={() => setModal(null)} />
      <ConfigEnvio aberta={configAberta} onFechar={() => setConfigAberta(false)} />
    </div>
  )
}

const ROTULO_STATUS: Record<string, string> = {
  gerando: 'gerando', gerado: 'gerado', enviado: 'enviado', falhou: 'falhou',
}

const dm = (iso: string) => {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a?.slice(2) ?? ''}`
}

// ─── Resumo de IA ───────────────────────────────────────────────────────────

function Resumo({
  r, execucaoId, execucoes,
}: {
  r: ReportSemanal
  execucaoId: string | null
  execucoes: { id: string; resumo_ia: string | null }[]
}) {
  /*
   * O resumo vem da EXECUÇÃO, e não é gerado ao abrir a aba.
   *
   * Chamar o modelo a cada carregamento custaria dinheiro toda vez que alguém trocasse de
   * período — e, pior, daria três parágrafos diferentes para os mesmos números a cada
   * abertura. O texto do report é o que foi escrito quando ele rodou.
   */
  const resumo = execucaoId
    ? execucoes.find((e) => e.id === execucaoId)?.resumo_ia
    : execucoes.find((e) => e.resumo_ia)?.resumo_ia

  if (!resumo) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          O resumo da semana é escrito quando o report é gerado. Clique em{' '}
          <strong className="text-foreground">Gerar PDF agora</strong> para produzir um para
          esta semana.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-l-[3px] border-l-emerald-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Resumo da semana
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed">
        {resumo.split('\n\n').map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── KPIs ───────────────────────────────────────────────────────────────────

type AbrirModal = (m: { titulo: string; nota?: string; itens: ItemLista[] }) => void

function FaixaKpis({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const k = r.operacao.kpis
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi
        ind={k.volume_convertido}
        rotulo="Volume convertido"
        onClick={() =>
          onAbrir({
            titulo: 'Cedentes que operaram na semana',
            nota: `${r.operacao.antecipacao.operacoes_semana} operações de ${r.operacao.antecipacao.cedentes_semana} cedentes.`,
            itens: r.operacao.antecipacao.top_cedentes,
          })
        }
      />
      <Kpi ind={k.vop_operado} rotulo="VOP operado" nota="a base de comissão" />
      <Kpi ind={k.receita} rotulo="Receita gerada" />
      <Card>
        <CardContent className="p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Limite ocioso</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{brlCurto(k.limite_ocioso.foto)}</p>
          {/* Sem variação, e o rótulo diz por quê: a plataforma sobrescreve o estado a cada
              sincronização, e inventar uma série que não existe é pior que não ter. A DATA
              está aqui porque o mesmo campo carrega o saldo de agora na tela e o do fim da
              janela no PDF — os dois certos, e nada além disto dizendo qual é qual. */}
          <p className="text-[11px] text-muted-foreground">
            saldo em {dm(k.limite_ocioso.em)}, sem série
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({
  ind, rotulo, nota, onClick,
}: {
  ind: IndicadorReport
  rotulo: string
  nota?: string
  onClick?: () => void
}) {
  const dir = direcaoDa(ind.var_semana_pct, ind.subir_e_pior)
  const corpo = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{brlCurto(ind.semana)}</p>
      <p className="text-[11px] text-muted-foreground">
        <span
          className={cn(
            'font-medium',
            dir === 'melhor' && 'text-emerald-700 dark:text-emerald-400',
            dir === 'pior' && 'text-destructive',
          )}
        >
          {variacaoTexto(ind.var_semana_pct)}
        </span>{' '}
        vs {textoDaRegua(ind)}
        {nota ? ` · ${nota}` : ''}
      </p>
    </>
  )
  return (
    <Card className={onClick ? 'transition-colors hover:border-primary/50' : undefined}>
      <CardContent className="p-3">
        {onClick ? (
          <button type="button" onClick={onClick} className="w-full text-left focus-visible:outline-none">
            {corpo}
          </button>
        ) : (
          corpo
        )}
      </CardContent>
    </Card>
  )
}

// ─── Blocos ─────────────────────────────────────────────────────────────────

function BlocoFunil({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const f = r.comercial.funil.semana
  const c = r.comercial.comercial
  const vaz = f ? maiorVazamento(f, r.comercial.funil.doze) : null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Funil comercial da semana</CardTitle>
        <CardDescription className="text-[11px]">
          Coorte da janela: dos leads distribuídos na semana, quantos avançaram
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {f ? (
          <FunilEtapas
            etapas={[
              { id: 'distribuidos', label: ETAPA_FUNIL_LABELS.distribuidos, valor: f.distribuidos, passagem: null },
              { id: 'contatados', label: ETAPA_FUNIL_LABELS.contatados, valor: f.contatados, passagem: f.passagem.contato_pct },
              { id: 'com_fit', label: ETAPA_FUNIL_LABELS.com_fit, valor: f.com_fit, passagem: f.passagem.fit_pct },
              { id: 'agendados', label: ETAPA_FUNIL_LABELS.agendados, valor: f.agendados, passagem: f.passagem.agenda_pct },
              { id: 'realizados', label: ETAPA_FUNIL_LABELS.realizados, valor: f.realizados, passagem: f.passagem.realiza_pct },
              { id: 'ganhos', label: ETAPA_FUNIL_LABELS.ganhos, valor: f.ganhos, passagem: f.passagem.ganho_pct },
            ]}
          />
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum lead distribuído nesta semana.</p>
        )}

        {vaz && (
          <p className="rounded-md border-l-2 border-amber-600 bg-amber-500/5 px-3 py-2 text-xs">
            <strong>Maior vazamento:</strong> {ETAPA_FUNIL_LABELS[vaz.de]} → {ETAPA_FUNIL_LABELS[vaz.para]}.{' '}
            {vaz.perdidos} não passaram ({vaz.passagem_pct}% de passagem
            {vaz.passagem_12m_pct !== null ? `, contra ${vaz.passagem_12m_pct}% em 12 meses` : ''}).
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Linha rotulo="Leads" valor={`${c.leads_semana} (${c.leads_inbound} in · ${c.leads_outbound} out)`} />
          <Linha rotulo="Taxa de fit" valor={c.fit_pct === null ? '—' : `${c.fit_pct}%`} />
          <Linha rotulo="Reuniões realizadas" valor={String(c.reunioes_realizadas)} />
          <Linha rotulo="No-shows não remarcados" valor={String(c.no_shows_nao_remarcados)} />
          <Linha rotulo="MOUs" valor={String(c.mous)} />
          <Linha
            rotulo="Ciclo 1º contato → 1ª operação"
            valor={c.ciclo_medio_dias === null
              ? 'ninguém completou ainda'
              : `${c.ciclo_medio_dias} d (base ${c.ciclo_medio_base})`}
          />
        </dl>
        <button
          type="button"
          className="text-[11px] underline text-muted-foreground"
          onClick={() =>
            onAbrir({
              titulo: 'Crédito na semana',
              nota: `Esteira: ${r.comercial.credito.esteira_dias ?? '—'} dias sobre ${r.comercial.credito.esteira_base} análise(s). Gargalo: ${r.comercial.credito.esteira_gargalo ?? '—'}.`,
              itens: [
                { indicador: 'Solicitadas', valor: r.comercial.credito.solicitadas_semana },
                { indicador: 'Aprovadas', valor: r.comercial.credito.aprovadas_semana },
                { indicador: 'Negadas', valor: r.comercial.credito.negadas_semana },
                { indicador: 'Limite concedido', valor: brlCurto(r.comercial.credito.limite_concedido.semana) },
                { indicador: 'Divergências com a seguradora', valor: r.comercial.credito.divergencias_seguradora },
              ],
            })
          }
        >
          ver o bloco de crédito
        </button>
      </CardContent>
    </Card>
  )
}

function BlocoNf({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const nf = r.operacao.nf
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Funil de notas fiscais</CardTitle>
        <CardDescription className="text-[11px]">
          Conversão da semana contra a de 12 meses, por faixa
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ConversaoPorFaixa
          faixas={nf.por_faixa.map((f) => ({
            faixa: f.faixa,
            semana: f.conversao_semana_pct,
            doze: f.conversao_12m_pct,
            entradas: f.entradas_semana,
          }))}
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Linha rotulo="Capturadas" valor={`${nf.capturadas.semana} (${variacaoTexto(nf.capturadas.var_semana_pct)})`} />
          <Linha
            rotulo="Expirou sem trabalho"
            valor={`${brlCurto(nf.valor_expirado.semana)} (${variacaoTexto(nf.valor_expirado.var_semana_pct)})`}
            /* Subir aqui é PIOR — a cor segue o significado, não o sinal. */
            ruim={direcaoDa(nf.valor_expirado.var_semana_pct, true) === 'pior'}
          />
        </div>
        <button
          type="button"
          className="text-[11px] underline text-muted-foreground"
          onClick={() =>
            onAbrir({
              titulo: 'Antecipações travadas',
              nota: `${nf.travadas.total} paradas, somando ${brlCurto(nf.travadas.valor)}. O cedente abriu e não concluiu.`,
              itens: nf.travadas.itens,
            })
          }
        >
          ver as {nf.travadas.total} antecipações travadas
        </button>
      </CardContent>
    </Card>
  )
}

function BlocoCarteira({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const ca = r.carteira.carteira
  const lista = r.carteira.listas.nao_performando as {
    cliente?: string; gestor?: string | null; ocioso?: number
  }[]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Carteira</CardTitle>
        <CardDescription className="text-[11px]">
          {ca.clientes} clientes · {ca.operaram_semana} operaram na semana · {ca.utilizacao_pct ?? '—'}% de utilização
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <OciosoPorGestor clientes={lista.map((c) => ({ gestor: c.gestor ?? null, ocioso: Number(c.ocioso ?? 0) }))} />
        <button
          type="button"
          className="text-[11px] underline text-muted-foreground"
          onClick={() =>
            onAbrir({
              titulo: 'Carteiras que não estão performando',
              nota: 'Limite ocioso acima de R$ 50 mil, com 30 dias sem operar ou apontamento do temperature report.',
              itens: r.carteira.listas.nao_performando,
            })
          }
        >
          ver as {lista.length} contas paradas
        </button>
      </CardContent>
    </Card>
  )
}

function BlocoCertificados({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const ce = r.carteira.certificados
  const inv = ce.invisivel
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Certificados digitais</CardTitle>
        <CardDescription className="text-[11px]">
          Cobertura de {ce.cobertura_pct ?? 0}% · matrizes {ce.matrizes_cobertas}/{ce.matrizes} ·
          SPEs {ce.spes_cobertas}/{ce.spes}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <BarraCobertura
          cobertos={ce.cobertos}
          vencendo={ce.vencendo_30d}
          sem={ce.sem_certificado}
          total={ce.cnpjs}
        />
        {inv.razao !== null && (
          <div className="space-y-1">
            <p className="text-xs">
              <strong>{inv.grupos_cegos} contas</strong> sem nenhum certificado. As {inv.topo ?? 15}{' '}
              maiores escondem <strong>{brlCurto(inv.total_mes_do_topo)}</strong> de NF por mês.
            </p>
            {/* A régua viaja com o número: é 10% de uma ESTIMATIVA, e quem lê precisa saber
                sobre quantos clientes ela foi medida para descontar sozinho. */}
            <p className="text-[11px] text-muted-foreground">
              Estimativa: {(inv.razao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do
              faturamento estimado vira NF visível — razão medida em {inv.razao_base} clientes que
              têm certificado.
            </p>
            <button
              type="button"
              className="text-[11px] underline text-muted-foreground"
              onClick={() =>
                onAbrir({
                  titulo: 'Contas sem certificado, pelo que escondem',
                  nota: 'O valor é estimado a partir do faturamento, com a razão medida nos clientes que já têm certificado.',
                  itens: inv.itens,
                })
              }
            >
              ver a lista nominal
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BlocoTime({ r, onAbrir }: { r: ReportSemanal; onAbrir: AbrirModal }) {
  const t = r.comercial.time
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Time</CardTitle>
        <CardDescription className="text-[11px]">Por VOP atribuído na semana</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RankingTime vendedores={t.vendedores} />
        <button
          type="button"
          className="text-[11px] underline text-muted-foreground"
          onClick={() =>
            onAbrir({
              titulo: 'Filas acumulando',
              nota: 'O que está esperando uma pessoa, hoje — não é da semana, é do estado atual.',
              itens: [
                { fila: 'Inbound sem contato', total: t.filas.inbound_sem_contato },
                { fila: 'Documentos parados há mais de 5 dias', total: t.filas.docs_parados },
                { fila: 'Conversas sem resposta há mais de 24h', total: t.filas.conversas_sem_resposta },
              ],
            })
          }
        >
          ver as filas acumulando
        </button>
      </CardContent>
    </Card>
  )
}

const ROTULO_ATENCAO: Record<string, string> = {
  limites_reduzidos: 'Limites reduzidos pela seguradora',
  protestos_novos: 'Protestos novos em clientes',
  certificados_vencendo_30d: 'Certificados vencendo em 30 dias',
  processos_com_movimento: 'Processos com movimentação relevante',
  lotes_aguardando: 'Lotes de enriquecimento aguardando aprovação',
  sugestoes_perfil_pendentes: 'Sugestões do Perfil pendentes',
  ex_clientes_sem_motivo: 'Ex-clientes sem motivo registrado',
  fornecedores_sem_contato: 'Fornecedores sem contato',
  antecipacoes_travadas: 'Antecipações travadas',
}

function BlocoAtencao({ r }: { r: ReportSemanal }) {
  /* Só o que é MAIOR QUE ZERO. Nove linhas com sete zeros treinam o leitor a pular a
     seção — e é justamente a seção que existe para ser lida. */
  const itens = Object.entries(ROTULO_ATENCAO)
    .map(([k, rot]) => ({ rot, n: Number(r.carteira.atencao[k] ?? 0) }))
    .filter((i) => i.n > 0)
    .sort((a, b) => b.n - a.n)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Exige atenção</CardTitle>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nada exigindo atenção nesta semana.</p>
        ) : (
          <ul className="divide-y">
            {itens.map((i) => (
              <li key={i.rot} className="flex items-baseline gap-2 py-1.5">
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', i.n > 20 ? 'bg-destructive' : 'bg-amber-500')}
                  aria-hidden
                />
                <span className="w-8 shrink-0 text-xs font-semibold tabular-nums">{i.n}</span>
                <span className="text-xs">{i.rot}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Linha({ rotulo, valor, ruim = false }: { rotulo: string; valor: string; ruim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{rotulo}</dt>
      <dd className={cn('shrink-0 font-medium tabular-nums', ruim && 'text-destructive')}>{valor}</dd>
    </div>
  )
}

// ─── Histórico ──────────────────────────────────────────────────────────────

function Historico({
  execucoes, onAbrir, onBaixar,
}: {
  execucoes: {
    id: string; periodo_inicio: string; periodo_fim: string; status: string
    pdf_url: string | null; destinatarios_enviados: string[] | null; erro: string | null
    criado_em: string
  }[]
  onAbrir: (id: string) => void
  onBaixar: (caminho: string) => void
}) {
  if (execucoes.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Reports gerados</CardTitle>
        <CardDescription className="text-[11px]">
          Cada linha abre com os números da época, e não com os de hoje
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {execucoes.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <button
                type="button"
                onClick={() => onAbrir(e.id)}
                className="min-w-0 flex-1 text-left hover:underline"
              >
                <p className="truncate text-xs font-medium">
                  {dm(e.periodo_inicio)} a {dm(e.periodo_fim)}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {ROTULO_STATUS[e.status] ?? e.status}
                  {e.destinatarios_enviados?.length
                    ? ` · ${e.destinatarios_enviados.length} destinatário(s)`
                    : ''}
                  {e.erro ? ` · ${e.erro.slice(0, 80)}` : ''}
                </p>
              </button>
              {e.pdf_url && (
                <Button size="sm" variant="ghost" onClick={() => onBaixar(e.pdf_url!)}>
                  <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
                  PDF
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

/**
 * A lista que compõe um número. Ela NUNCA navega: quem está lendo o report está montando
 * um raciocínio sobre a semana, e trocar a página embaixo dessa pessoa a obriga a
 * reconstruir de onde veio.
 */
function ModalLista({
  aberto, onFechar,
}: {
  aberto: { titulo: string; nota?: string; itens: ItemLista[] } | null
  onFechar: () => void
}) {
  /* `?? []` cria um array novo a cada render, e o useMemo abaixo dependeria de uma
     referência que nunca é a mesma — memo que não memoriza nada. */
  const itens = React.useMemo(() => aberto?.itens ?? [], [aberto])
  const colunas = React.useMemo(() => {
    const chaves = new Set<string>()
    for (const i of itens.slice(0, 10)) {
      for (const k of Object.keys(i)) if (!OCULTAS.has(k)) chaves.add(k)
    }
    return [...chaves]
  }, [itens])

  return (
    <Dialog open={Boolean(aberto)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{aberto?.titulo}</DialogTitle>
          <DialogDescription>
            {aberto?.nota ?? `${itens.length} item(ns).`}
          </DialogDescription>
        </DialogHeader>
        {itens.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nada nesta lista.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {colunas.map((c) => (
                    <th key={c} className="whitespace-nowrap p-2 text-left font-medium text-muted-foreground">
                      {ROTULO_COLUNA[c] ?? c.replace(/_/g, ' ')}
                    </th>
                  ))}
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {itens.map((i, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    {colunas.map((c) => (
                      <td key={c} className="whitespace-nowrap p-2 tabular-nums">
                        {formatar(c, i[c])}
                      </td>
                    ))}
                    <td className="p-2 text-right">
                      {typeof i.empresa_id === 'string' && (
                        <LinkEmAba
                          href={`/empresas/${i.empresa_id}`}
                          className="text-[11px] underline text-muted-foreground"
                        >
                          ficha
                        </LinkEmAba>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Ids internos não vão para a tela: eles não respondem a pergunta nenhuma de quem lê. */
const OCULTAS = new Set(['empresa_id', 'vendedor_id', 'id_externo', 'raiz_cnpj'])

const ROTULO_COLUNA: Record<string, string> = {
  cedente: 'Cedente', volume: 'Volume', receita: 'Receita', operacoes: 'Operações',
  cliente: 'Cliente', gestor: 'Gestor', ocioso: 'Ocioso', limite: 'Limite',
  dias_sem_operar: 'Dias sem operar', status: 'Status', grupo: 'Conta',
  cnpjs_no_grupo: 'CNPJs', faturamento_estimado: 'Faturamento estimado',
  invisivel_mes: 'Invisível por mês', faturamento_origem: 'Origem do faturamento',
  valor: 'Valor', dias_parada: 'Dias parada', indicador: 'Indicador', fila: 'Fila', total: 'Total',
  cnpjs_sem_certificado: 'Sem certificado',
}

const MONETARIAS = new Set([
  'volume', 'receita', 'ocioso', 'limite', 'valor', 'faturamento_estimado', 'invisivel_mes',
])

function formatar(coluna: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (MONETARIAS.has(coluna) && typeof v === 'number') return brlCurto(v)
  if (typeof v === 'number') return v.toLocaleString('pt-BR')
  return String(v)
}
