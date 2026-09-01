import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { Tables } from '../../../../packages/core/src/types/database.js'
import { sessaoDedicada, supabaseAdmin } from '../db.js'
import { logger } from '../logger.js'
import {
  abrirIngestao,
  anotarMeta,
  concluirIngestao,
  falharIngestao,
  type Contadores,
} from '../ingestoes.js'
import { detectarSpes } from '../derivadas/spe.js'
import { montarGrupos } from '../derivadas/grupos.js'
import { atualizarMetricas } from '../derivadas/metricas.js'
import { reclassificar } from '../derivadas/reclassificar.js'
import { promoverElegiveis } from '../derivadas/promover.js'
import { ingerirReceita, type OpcoesReceita } from './receita.js'
import { ingerirCno, type OpcoesCno } from './cno.js'
import { sincronizarOnepay } from './radar/onepay.js'
import { sincronizarCertificados } from './radar/certificados.js'
import { executarLote } from './radar/lote.js'
import { criarProcessadorDominio, dominioEmpresa } from './radar/dominios.js'
import { contatosEmpresa, criarProcessadorContatos } from './radar/contatos.js'
import { apurarComissoesJob, aplicarDecisaoCreditoEmVendas } from './comercial/comissoes.js'
import {
  alertaReclassificacaoJob,
  comissoesDiarioJob,
  fecharCompetenciaJob,
  processarAceitesSdrJob,
  titularidadesJob,
} from './comercial/comissoes-v2.js'
import { distribuirSdrJob, slaLeadsJob } from './comercial/distribuir.js'
import {
  atualizarFunilFornecedores,
  descobertaAprofundada,
  descobertaAutomaticaJob,
  descobertaSobDemanda,
  validarContatosJob,
} from './fornecedores/index.js'
import { sugerirPassivosJob } from './comercial/passivos.js'
import {
  detectarPrimeiraOperacaoJob,
  rotearNotasJob,
  vendedoresSemAtividadeJob,
} from './comercial/roteamento.js'
import {
  avisarCustoProtestos,
  criarProcessadorProtestos,
  protestoFornecedor,
  protestosClientesMensal,
  protestosEmpresa,
} from './radar/protestos.js'
import {
  backfillFuncionarios,
  criarProcessadorFuncionarios,
  funcionariosEmpresa,
} from './radar/funcionarios.js'
import { calibrarEstimadorJob, estimarFaturamentoJob } from './radar/estimador.js'
import {
  calibrarCreditoJob,
  estimarPotencialJob,
  recalcularScoresJob,
} from './credito/potencial.js'
import {
  backfillAtradius,
  enviarAnalises,
  expirarAnalises,
  pollDecisoes,
  syncAtradius,
} from './credito/esteira.js'
import { sincronizarAnalisesPlataforma } from './credito/sync-analises-plataforma.js'
import {
  drenarAnalisesProprias,
  processarAnalisePropria,
  sugerirReanalises,
} from './credito/analise-propria.js'
import { sincronizarNotasFiscais } from './antecipacao/sync-nfs.js'
import { rematchPendentes, sincronizarAntecipacoes } from './antecipacao/sync-antecipacoes.js'
import { calibrarEconomiaCarteira } from './antecipacao/calibrar-economia.js'
import { reclassificarFunil } from './antecipacao/reclassificar.js'
import { gerarOutbox } from './antecipacao/outbox.js'
import { lookupCadastral } from './antecipacao/lookup-cadastral.js'
import { backfillContatosNf } from './antecipacao/contatos-nf.js'
import { limparSupressoesExpiradas } from './antecipacao/supressoes.js'
import { recalcularPerfil } from './perfil/recalcular.js'
import { enriquecerLeads } from './leads/enriquecer.js'
import { enriquecerEmpresa } from './radar/enriquecer-empresa.js'
import { alertasJuridico } from './juridico/alertas.js'
import { processarCallbacks } from './juridico/callbacks.js'
import { classificarFases } from './juridico/classificar-fases.js'
import { descobrirProcessos, sincronizarMonitoramentos } from './juridico/descobrir-processos.js'
import { ehDiaDeResumoIa, lerMonitoramento } from '../juridico/config.js'
import { gerarBriefing, gerarBriefingsPendentes } from './juridico/briefing.js'
import { gerarParecer } from './juridico/parecer.js'
import { drenarSolicitacoes, sincronizarProcessos } from './juridico/sincronizar.js'
import { enviarFila } from './comunicacao/enviar-fila.js'
import { sincronizarGmail, renovarWatches } from './comunicacao/gmail-sync.js'
import { lembretesDeReuniao } from './comunicacao/lembretes-reuniao.js'
import { triarEntradas } from './comunicacao/triagem.js'
import { avancarSequencias } from './campanhas/avancar-sequencia.js'
import { executarCampanhas } from './campanhas/executar.js'
import { varrerSaudeDasCampanhas } from './campanhas/metricas.js'
import { simularCampanha } from './campanhas/simular.js'
import { decidirProximosPassos } from './agente/decidir.js'
import { apurarDesfechos, executarAgendados } from './agente/executar-agendados.js'
import { plantaoDeEventos } from '../comunicacao/plantao.js'

/**
 * Jobs are ASYNC, always. A Receita run downloads several gigabytes from a server
 * that is having a bad decade; it can take four hours. There is no HTTP client on
 * earth — least of all a Vercel Cron — that will hold that connection open, so the
 * route returns 202 with an id and the caller watches `mercado_ingestoes`.
 */

export type TipoJob =
  | 'receita'
  | 'cno'
  | 'reclassificar'
  | 'metricas'
  | 'promover'
  | 'onepay'
  | 'radar-lote'
  | 'protestos-mensal'
  | 'protestos-aviso-custo'
  | 'comercial-distribuir'
  | 'comercial-sla'
  | 'comercial-passivos'
  | 'comercial-comissoes'
  | 'comercial-comissoes-v2'
  | 'comercial-sdr-aceites'
  | 'comercial-reclassificacao'
  | 'comercial-rotear'
  | 'fornecedores-funil'
  | 'fornecedores-descoberta'
  | 'fornecedores-clique'
  | 'fornecedores-validar'
  | 'protestos-empresa'
  | 'contatos-empresa'
  | 'certificados'
  | 'analises-plataforma'
  | 'antecipacao-sync-nfs'
  | 'antecipacao-sync-antecipacoes'
  | 'antecipacao-calibrar'
  | 'antecipacao-reclassificar'
  | 'antecipacao-outbox'
  | 'antecipacao-lookup'
  | 'antecipacao-contatos'
  | 'antecipacao-protesto-fornecedor'
  | 'antecipacao-diario'
  | 'dominio-empresa'
  | 'funcionarios-backfill'
  | 'funcionarios-empresa'
  | 'funcionarios-lote'
  | 'estimador-calibrar'
  | 'estimador-estimar'
  | 'credito-calibrar'
  | 'credito-scores'
  | 'credito-potencial'
  | 'credito-enviar'
  | 'credito-poll'
  | 'credito-backfill'
  | 'credito-sync'
  | 'credito-expirar'
  | 'credito-analise-propria'
  | 'credito-analises-drenar'
  | 'credito-reanalises'
  | 'leads-enriquecer'
  | 'enriquecer-empresa'
  | 'perfil-recalcular'
  | 'juridico-descobrir'
  | 'juridico-sincronizar'
  | 'juridico-callbacks'
  | 'juridico-classificar'
  | 'juridico-alertas'
  | 'juridico-parecer'
  | 'juridico-briefing'
  | 'juridico-monitoramentos'
  | 'comunicacao-fila'
  | 'comunicacao-gmail'
  | 'comunicacao-triagem'
  | 'comunicacao-lembretes'
  | 'comunicacao-plantao'
  | 'agente-decidir'
  | 'agente-agendados'
  | 'campanhas-simular'
  | 'campanhas-executar'
  | 'campanhas-sequencia'
  | 'campanhas-metricas'

/** Single-flight, per job kind. Two concurrent Receita runs would COPY the same
 *  2M rows into the same tables and fight over the staging temp tables. */
const emExecucao = new Map<TipoJob, string>()

export class JobEmExecucaoError extends Error {
  constructor(readonly tipo: TipoJob, readonly id: string) {
    super(`Já existe um job "${tipo}" em execução (${id}).`)
    this.name = 'JobEmExecucaoError'
  }
}

function reservar(tipo: TipoJob, id: string): void {
  const atual = emExecucao.get(tipo)
  if (atual) throw new JobEmExecucaoError(tipo, atual)
  emExecucao.set(tipo, id)
}

/**
 * A reclassification + promotion rewrites `camada` and `empresa_id` across a large
 * slice of mercado_universo, and every updated row dirties the visibility map. The
 * pyramid (mercado_piramide) depends on it: its `group by camada` is an INDEX-ONLY
 * scan that stays ~300ms only while pages are all-visible. Left dirty it degrades
 * to a full 587MB heap scan (~10s+) and blows past the 8s statement_timeout, so the
 * Camadas tab stops loading until autovacuum eventually catches up.
 *
 * This MUST run at the END of the job, AFTER promotion — promotion's empresa_id
 * UPDATE re-dirties whatever an earlier VACUUM cleaned, which is why vacuuming
 * inside reclassificar() (before promotion) was not enough. Runs outside a
 * transaction, as VACUUM requires (the dedicated session is autocommit), and the
 * session's statement_timeout is 0 so it is never cut off.
 */
async function vacuumUniverso(client: pg.Client): Promise<void> {
  await client.query('vacuum (analyze) mercado_universo')
}

// ─── Derivadas (§3.2), na ordem em que dependem umas das outras ─────────────

export interface ResultadoDerivadas {
  spes_alteradas: number
  grupos: { arestas: number; grupos: number; membros: number }
  metricas: number
  reclassificacao: Awaited<ReturnType<typeof reclassificar>>
}

/**
 * The order is not a preference, it is a dependency chain:
 *   SPE   → is_spe is what grupo_spes_total counts.
 *   grupo → grupo_id is what the group metrics aggregate over.
 *   métricas → qtd_filiais / grupo_spes_* / obras_ativas are READ BY the rules.
 *   reclassificação → camada.
 * Running metrics after reclassification would classify the whole universe against
 * last month's numbers, every month, forever.
 *
 * PROMOTION IS NOT HERE ANYMORE. Turning market rows into `empresas` (§3.2.5) is a
 * heavy write (tens of thousands of inserts + index-amplified empresa_id updates)
 * that has nothing to do with keeping the universe fresh — it is a deliberate,
 * on-demand act (dispararPromocao / the "Promover" button). Folding it into every
 * ingestion and every rule change is what turned routine jobs into 30-minute IO
 * storms. The universe stays current here; the CRM base is populated when asked.
 */
export async function rodarDerivadas(client: pg.Client): Promise<ResultadoDerivadas> {
  const spes = await detectarSpes(client)
  const grupos = await montarGrupos(client)
  const metricas = await atualizarMetricas(client)
  const reclassificacao = await reclassificar(client)

  await vacuumUniverso(client)

  return { spes_alteradas: spes, grupos, metricas, reclassificacao }
}

// ─── Os jobs ────────────────────────────────────────────────────────────────

async function executar(
  tipo: TipoJob,
  ingestaoId: string,
  trabalho: (client: pg.Client) => Promise<Contadores & { meta?: Record<string, unknown> }>,
  fonte: 'receita_cnpj' | 'cno' | 'onepay_nf',
): Promise<void> {
  const client = await sessaoDedicada()
  try {
    const { meta, ...contadores } = await trabalho(client)
    await concluirIngestao(ingestaoId, fonte, contadores, meta ?? {})
  } catch (erro) {
    logger.error({ tipo, ingestaoId, erro: String(erro) }, 'Job falhou.')
    await falharIngestao(ingestaoId, fonte, erro)
  } finally {
    await client.end().catch(() => undefined)
    emExecucao.delete(tipo)
  }
}

/** Returns the `mercado_ingestoes` id immediately; the work continues in background. */
export async function dispararReceita(opcoes: OpcoesReceita): Promise<string> {
  const id = await abrirIngestao('receita_cnpj', { sample: !!opcoes.sample, fallback: !!opcoes.fallback })
  reservar('receita', id)

  void executar(
    'receita',
    id,
    async (client) => {
      const r = await ingerirReceita(client, id, opcoes)
      const derivadas = await rodarDerivadas(client)
      await anotarMeta(id, { receita: r, derivadas })
      return {
        linhas_processadas: r.linhas_processadas,
        linhas_novas: r.linhas_novas,
        linhas_atualizadas: r.linhas_atualizadas,
      }
    },
    'receita_cnpj',
  )

  return id
}

export async function dispararCno(opcoes: OpcoesCno): Promise<string> {
  const id = await abrirIngestao('cno', { sample: !!opcoes.sample, fallback: !!opcoes.fallback })
  reservar('cno', id)

  void executar(
    'cno',
    id,
    async (client) => {
      const r = await ingerirCno(client, id, opcoes)
      // Obras feed obras_ativas / m²_em_execução, which are SOM signals — so the
      // pyramid has to be recomputed, not just the metrics table.
      const derivadas = await rodarDerivadas(client)
      await anotarMeta(id, { cno: r, derivadas })
      return {
        linhas_processadas: r.linhas_processadas,
        linhas_novas: r.linhas_novas,
        linhas_atualizadas: r.linhas_atualizadas,
      }
    },
    'cno',
  )

  return id
}

// ─── Jobs sem ingestão (reclassificar / métricas) ───────────────────────────
// These write no source data, so they do not open a `mercado_ingestoes` row:
// `fonte` only admits receita_cnpj | cno | lista (migration 0011), and inventing a
// value would break the check constraint. They report through an in-memory job id.

export interface JobAvulso {
  id: string
  tipo: TipoJob
  status: 'executando' | 'concluida' | 'falhou'
  iniciado_em: string
  terminado_em?: string
  resultado?: unknown
  erro?: string
}

const avulsos = new Map<string, JobAvulso>()

export function statusJob(id: string): JobAvulso | undefined {
  return avulsos.get(id)
}

function dispararAvulso(tipo: TipoJob, trabalho: (client: pg.Client) => Promise<unknown>): string {
  const id = randomUUID()
  reservar(tipo, id)
  avulsos.set(id, { id, tipo, status: 'executando', iniciado_em: new Date().toISOString() })

  void (async () => {
    const client = await sessaoDedicada()
    try {
      const resultado = await trabalho(client)
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'concluida',
        terminado_em: new Date().toISOString(),
        resultado,
      })
    } catch (erro) {
      logger.error({ tipo, id, erro: String(erro) }, 'Job avulso falhou.')
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'falhou',
        terminado_em: new Date().toISOString(),
        erro: String(erro),
      })
    } finally {
      await client.end().catch(() => undefined)
      emExecucao.delete(tipo)
    }
  })()

  return id
}

/**
 * `camada` is accepted and recorded, but reclassification is ALWAYS global — and
 * that is not laziness. A company gets the HIGHEST layer whose rule matches, so
 * changing the SAM rule can move a company into SOM or out of it entirely.
 * "Reclassify only SAM" is not a well-defined operation; it would leave rows
 * holding a layer no active rule justifies.
 */
export function dispararReclassificacao(camada?: string): string {
  return dispararAvulso('reclassificar', async (client) => {
    logger.info({ camada_solicitada: camada ?? 'todas' }, 'Reclassificação sob demanda.')
    // Only camadas here — no metrics recompute, no promotion. Metrics change on
    // INGESTION, not when a rule changes, so re-running them on every rule edit was
    // pure churn (it is what bloated mercado_metricas to 63% dead). And promotion is
    // now its own on-demand job. This makes a rule change a light, fast operation.
    const reclassificacao = await reclassificar(client)
    await vacuumUniverso(client)
    return { camada_solicitada: camada ?? null, reclassificacao }
  })
}

export function dispararMetricas(): string {
  return dispararAvulso('metricas', async (client) => {
    const spes = await detectarSpes(client)
    const grupos = await montarGrupos(client)
    const metricas = await atualizarMetricas(client)
    return { spes_alteradas: spes, grupos, metricas }
  })
}

/**
 * Promotion (§3.2.5) as its OWN on-demand job — the "Promover SAM+SOM" button.
 * Deliberately separate from reclassification: it is a heavy write (creates
 * `empresas` rows for the whole eligible set) and belongs to a human decision, not
 * to every ingestion/rule change. Batched and resumable inside promoverElegiveis,
 * so a click always makes durable progress and a re-click finishes what's left.
 * VACUUMs at the end because the empresa_id backfill dirties the universe's map.
 */
export function dispararPromocao(): string {
  return dispararAvulso('promover', async (client) => {
    logger.info('Promoção sob demanda.')
    const promocao = await promoverElegiveis(client)
    await vacuumUniverso(client)
    return { promocao }
  })
}

/**
 * Sync diário dos clientes Onepay (§7). Job avulso: escreve em clientes_onepay via
 * service role (PostgREST), não usa a sessão pg dedicada — o client é ignorado.
 */
export function dispararSincronizarOnepay(): string {
  return dispararAvulso('onepay', async () => {
    logger.info('Sync de clientes Onepay.')
    return sincronizarOnepay()
  })
}

/**
 * Sync diário dos certificados digitais (04b §3).
 *
 * Registra em `mercado_ingestoes` (fonte `onepay_certificados`) — e não só no log de
 * jobs avulsos — porque a página de Ingestões é onde alguém vai perguntar "por que o
 * grid está com data de ontem?". Falha aqui é a mesma política das outras fontes: a
 * ingestão fica `falhou` e os admins são notificados.
 */
export async function dispararSincronizarCertificados(): Promise<string> {
  const id = await abrirIngestao('onepay_certificados')
  reservar('certificados', id)

  void (async () => {
    try {
      const r = await sincronizarCertificados()
      await concluirIngestao(
        id,
        'onepay_certificados',
        { linhas_processadas: r.itens, linhas_novas: r.novos, linhas_atualizadas: r.atualizados },
        { certificados: r },
      )
    } catch (erro) {
      logger.error({ id, erro: String(erro) }, 'Sync de certificados falhou.')
      await falharIngestao(id, 'onepay_certificados', erro)
    } finally {
      emExecucao.delete('certificados')
    }
  })()

  return id
}

/**
 * Sync das análises de crédito da plataforma + detecção de ex-clientes (04h §3).
 *
 * Ingestão registrada (`onepay_credit_analyses`) e não job avulso, pela mesma razão
 * dos certificados: quando a lista de ex-clientes estiver com cara de desatualizada,
 * a pergunta vai ser feita na página de Ingestões, não no log do worker.
 */
export async function dispararSincronizarAnalisesPlataforma(): Promise<string> {
  const id = await abrirIngestao('onepay_credit_analyses')
  reservar('analises-plataforma', id)

  void (async () => {
    try {
      const r = await sincronizarAnalisesPlataforma()
      await concluirIngestao(
        id,
        'onepay_credit_analyses',
        { linhas_processadas: r.itens, linhas_atualizadas: r.analises_upsert },
        { analises: r },
      )
    } catch (erro) {
      logger.error({ id, erro: String(erro) }, 'Sync de análises da plataforma falhou.')
      await falharIngestao(id, 'onepay_credit_analyses', erro)
    } finally {
      emExecucao.delete('analises-plataforma')
    }
  })()

  return id
}

/** O processador de item por tipo de lote. Domínio implementado; contatos/protestos vêm nas 3c/3d. */
function escolherProcessador(lote: Tables<'lotes_enriquecimento'>) {
  if (lote.tipo === 'dominio') return criarProcessadorDominio(lote)
  if (lote.tipo === 'contatos') return criarProcessadorContatos(lote)
  if (lote.tipo === 'protestos') return criarProcessadorProtestos(lote)
  if (lote.tipo === 'funcionarios') return criarProcessadorFuncionarios(lote)
  throw new Error(`Execução de lote do tipo "${lote.tipo}" ainda não implementada.`)
}

/**
 * Rotina mensal de protestos dos clientes (§5). Job avulso: cria um lote automático
 * (já aprovado) com a matriz + SPEs ativas de cada cliente e o executa (sempre nacional).
 */
export function dispararProtestosClientesMensal(): string {
  return dispararAvulso('protestos-mensal', async () => {
    logger.info('Rotina mensal de protestos de clientes.')
    return protestosClientesMensal()
  })
}

/**
 * O aviso de custo, cinco dias antes da rotina acima. Dispara nos dias 28–31 e só
 * notifica no último do mês — a expressão de cron não sabe dizer "último dia", e um
 * cron no dia 30 nunca rodaria em fevereiro.
 */
export function dispararAvisoCustoProtestos(): string {
  return dispararAvulso('protestos-aviso-custo', async () => avisarCustoProtestos())
}

/**
 * Protestos sob demanda de uma empresa (+ SPEs opcionais), disparado da ficha. Job
 * avulso: usa pool + service role. Single-flight por tipo — dois disparos concorrentes
 * de empresas diferentes serializam (o segundo recebe 409), aceitável no volume real.
 */
export function dispararProtestosEmpresa(opts: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
  somenteAfiancadas?: boolean
}): string {
  return dispararAvulso('protestos-empresa', async () => {
    logger.info(
      {
        empresaId: opts.empresaId,
        incluirSpes: opts.incluirSpes,
        anoMin: opts.anoMin,
        somenteAfiancadas: opts.somenteAfiancadas,
      },
      'Protestos sob demanda.',
    )
    return protestosEmpresa(opts)
  })
}

/**
 * Contatos sob demanda de uma empresa, do botão na ficha. Mesmo desenho do
 * `dispararProtestosEmpresa`: avulso, service role, single-flight por tipo.
 */
export function dispararContatosEmpresa(opts: { empresaId: string; revelarTelefone?: boolean }): string {
  return dispararAvulso('contatos-empresa', async () => {
    logger.info({ empresaId: opts.empresaId }, 'Contatos sob demanda.')
    return contatosEmpresa(opts)
  })
}

// ─── Antecipação (Prompt 04) ─────────────────────────────────────────────────

/**
 * Sync de NFs (§3), de 4 em 4 horas. Abre uma linha em `mercado_ingestoes` com
 * fonte `onepay_nf` — mesma política de retry/alerta dos outros syncs, e é dela
 * que a JANELA da próxima execução é derivada (último concluído menos o colchão).
 *
 * A reclassificação roda no fim, na MESMA corrida: sem isso uma nota recém
 * chegada ficaria sem faixa até o job diário, e "nova NF em faixa alta" — que é
 * um push para o comercial — chegaria com até 24h de atraso.
 *
 * E o LOOKUP roda entre os dois, pela mesma razão levada um passo adiante: de nada
 * adianta classificar na hora se o cadastro do fornecedor — que é o que a regra lê —
 * só chega de madrugada.
 */
export async function dispararSyncNfs(): Promise<string> {
  const id = await abrirIngestao('onepay_nf', { origem: 'worker' })
  reservar('antecipacao-sync-nfs', id)

  void executar(
    'antecipacao-sync-nfs',
    id,
    async (client) => {
      const sync = await sincronizarNotasFiscais()
      // O lookup ENTRE o sync e a reclassificação, não depois: o fornecedor chega na
      // nota só com nome e CNPJ, e é o cadastro dele (capital, situação, Simples) que
      // as variáveis de faixa leem. Rodando só no diário, toda nota sincronizada
      // durante o dia seria classificada com o cadastro em branco e só corrigida na
      // madrugada seguinte — até 16h de faixa errada, em silêncio.
      //
      // A fila prioriza `criado_em desc`, então os CNPJs desta corrida são exatamente
      // os primeiros da vez. O orçamento de tempo é mais curto que o do diário: aqui
      // há um sync a cada 4h esperando, e o que sobrar entra na próxima.
      const lookup = await lookupCadastral({ orcamentoMs: 4 * 60_000 })
      const reclass = await reclassificarFunil(client)
      // As antecipações DEPOIS da reclassificação, e não antes (04e §3): a
      // reclassificação expira notas cujo vencimento chegou perto demais, e uma
      // nota que acabou de ser ANTECIPADA não é uma nota expirada. Rodando nesta
      // ordem, a conversão é a última palavra — como deve ser, já que é a única
      // das duas que descreve um fato consumado.
      const antecipacoes = await sincronizarAntecipacoesComIngestao()
      // A outbox por último: mensagens para notas que acabaram de converter são
      // exatamente o disparo que faz o comercial perder credibilidade.
      const outbox = await gerarOutbox()

      /*
       * O funil de fornecedores (04l §3) atrás do sync, e não num cron próprio.
       *
       * A munição dele — volume 90d, prazo, sacados — é derivada exatamente das notas
       * que acabaram de chegar. Num relógio separado, o card mostraria o volume de
       * até quatro horas atrás, e a saída automática de quem virou cliente demoraria
       * o mesmo tanto: um fornecedor cadastrado hoje continuaria no kanban de alguém
       * como lead a prospectar.
       *
       * Best-effort: uma falha aqui não pode marcar como falha um sync de NF que deu
       * certo. O funil se recompõe inteiro na próxima corrida — ele é recalculado,
       * não incremental.
       */
      let funilFornecedores: unknown
      try {
        funilFornecedores = await atualizarFunilFornecedores()
      } catch (erro) {
        logger.error({ erro: String(erro) }, 'Funil de fornecedores falhou; o sync de NF segue.')
        funilFornecedores = { erro: String(erro) }
      }

      await anotarMeta(id, {
        sync, lookup, reclassificacao: reclass, antecipacoes, outbox,
        funil_fornecedores: funilFornecedores,
      })
      return {
        linhas_processadas: sync.notas,
        linhas_novas: sync.novas,
        linhas_atualizadas: sync.atualizadas,
      }
    },
    'onepay_nf',
  )

  return id
}

/**
 * O job DIÁRIO (§9): varre as NFs por emissão, limpa supressões vencidas,
 * consome a fila de lookup cadastral, reclassifica com expiração e regenera a
 * outbox.
 *
 * A ordem é uma cadeia de dependências, não uma preferência:
 *   varredura  → a rede de segurança do sync. `sync_hours` só olha 4 horas para
 *                trás e o cron roda de 4 em 4: uma corrida que falhe abre um
 *                buraco que nenhum incremental posterior alcança. A varredura por
 *                EMISSÃO o fecha, e é de graça porque o upsert é idempotente;
 *   supressões → um fornecedor cuja supressão caiu hoje precisa voltar a ser
 *                elegível ANTES de a faixa ser recalculada;
 *   lookup     → o dado cadastral que chega agora é o que as variáveis de faixa
 *                vão ler;
 *   reclassificar → faixa + expiração + receita esperada;
 *   outbox     → só faz sentido sobre faixas já corretas.
 *
 * A varredura é best-effort: se o endpoint estiver fora, o resto do diário (que
 * não depende dele) precisa rodar mesmo assim — senão uma indisponibilidade de
 * terceiro deixaria o funil sem expirar nota nenhuma.
 */
export function dispararAntecipacaoDiario(): string {
  return dispararAvulso('antecipacao-diario', async (client) => {
    let varredura: unknown
    try {
      varredura = await sincronizarNotasFiscais('varredura')
    } catch (erro) {
      logger.error({ erro: String(erro) }, 'Varredura de NFs falhou; o diário segue.')
      varredura = { erro: String(erro) }
    }

    const supressoes = await limparSupressoesExpiradas()
    const lookup = await lookupCadastral()
    // Depois do lookup, de propósito: promover um fornecedor cria a empresa, e
    // só a partir daí o contato dele tem onde ser gravado. Rodando antes, o
    // recém-promovido esperaria até amanhã.
    const contatos = await backfillContatosNf()
    const reclassificacao = await reclassificarFunil(client)
    // A rede de segurança das antecipações, pelo mesmo motivo da varredura de
    // NFs: a janela do ciclo de 4h é de 3 dias por criação, e uma sequência de
    // falhas abre um buraco que nenhum incremental posterior alcança. 15 dias
    // por criação o fecham, e é de graça — o upsert é idempotente por id_externo.
    const antecipacoes = await sincronizarAntecipacoesComIngestao(15)
    const outbox = await gerarOutbox()
    // Roteamento DEPOIS da reclassificação: a faixa muda com o calendário, e uma nota
    // que entrou em faixa hoje precisa de dono hoje — não na segunda que vem.
    const roteamento = await rotearNotasJob()
    return { varredura, supressoes, lookup, contatos, reclassificacao, antecipacoes, outbox, roteamento }
  })
}

// ─── Antecipações & conversão automática (Prompt 04e) ────────────────────────

/**
 * Sync de antecipações + re-matching, com ingestão própria (`onepay_antecipacoes`).
 *
 * BEST-EFFORT por dentro: encadeado ao sync de NFs, uma indisponibilidade deste
 * endpoint não pode derrubar a ingestão das notas — que já terminou com sucesso
 * quando chegamos aqui. A falha fica registrada na ingestão de antecipações, com
 * a política de alerta padrão, e o ciclo seguinte tenta de novo (a janela de 3
 * dias por criação existe exatamente para isso).
 */
async function sincronizarAntecipacoesComIngestao(diasJanela?: number): Promise<unknown> {
  const id = await abrirIngestao('onepay_antecipacoes', {
    origem: diasJanela ? 'diario' : 'encadeado_sync_nfs',
  })
  try {
    const sync = await sincronizarAntecipacoes(diasJanela)
    const rematch = await rematchPendentes()
    await concluirIngestao(
      id,
      'onepay_antecipacoes',
      {
        linhas_processadas: sync.antecipacoes,
        linhas_novas: sync.novas,
        linhas_atualizadas: sync.atualizadas,
      },
      { sync, rematch },
    )
    return { sync, rematch }
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Sync de antecipações falhou; o sync de NFs segue.')
    await falharIngestao(id, 'onepay_antecipacoes', erro)
    return { erro: String(erro) }
  }
}

/** Sync de antecipações sob demanda — o botão "sincronizar agora" da tela. */
export async function dispararSyncAntecipacoes(): Promise<string> {
  const id = await abrirIngestao('onepay_antecipacoes', { origem: 'worker' })
  reservar('antecipacao-sync-antecipacoes', id)

  void (async () => {
    try {
      const sync = await sincronizarAntecipacoes()
      const rematch = await rematchPendentes()
      await concluirIngestao(
        id,
        'onepay_antecipacoes',
        {
          linhas_processadas: sync.antecipacoes,
          linhas_novas: sync.novas,
          linhas_atualizadas: sync.atualizadas,
        },
        { sync, rematch },
      )
    } catch (erro) {
      logger.error({ id, erro: String(erro) }, 'Sync de antecipações falhou.')
      await falharIngestao(id, 'onepay_antecipacoes', erro)
    } finally {
      emExecucao.delete('antecipacao-sync-antecipacoes')
    }
  })()

  return id
}

/**
 * Calibração da economia com a carteira real (04e §5), mensal e sob demanda.
 *
 * Só MEDE. Aplicar os valores nas configs é um botão na tela de settings — e é
 * assim de propósito: essas três constantes multiplicam a receita esperada de
 * todo o funil e o valor esperado de todo o Crédito.
 */
export function dispararCalibrarEconomia(): string {
  return dispararAvulso('antecipacao-calibrar', async () => calibrarEconomiaCarteira())
}

/**
 * Protesto de um fornecedor do funil (ação PAGA), com reclassificação em seguida.
 *
 * A reclassificação é o ponto: `fornecedor_tem_protesto` e `fornecedor_protesto_valor`
 * são variáveis do motor de faixa. Consultar e não reclassificar deixaria o dado novo
 * na tabela e a faixa velha no card — o usuário pagou por uma informação que a tela
 * ainda não usa, que é o pior dos dois mundos.
 *
 * Reclassifica o funil INTEIRO, e não só as notas deste fornecedor: é a mesma função
 * que o diário roda, é SQL puro sobre a tabela, e uma segunda implementação "só deste
 * CNPJ" seria um segundo lugar onde a regra de faixa pode divergir.
 */
export function dispararProtestoFornecedor(opts: { cnpj: string }): string {
  return dispararAvulso('antecipacao-protesto-fornecedor', async (client) => {
    logger.info({ cnpj: opts.cnpj }, 'Protesto de fornecedor sob demanda.')
    const protesto = await protestoFornecedor(opts)
    const reclassificacao = await reclassificarFunil(client)
    return { protesto, reclassificacao }
  })
}

/**
 * Backfill de headcount (04c §4.1). Roda UMA vez e custa zero: só relê o payload dos
 * enriquecimentos de contatos que já foram pagos.
 */
export function dispararBackfillFuncionarios(): string {
  return dispararAvulso('funcionarios-backfill', async () => backfillFuncionarios())
}

/**
 * O botão "Resolver domínio" da ficha. Roda a cascata inteira (§3) para uma empresa.
 *
 * Vem antes de headcount e de contatos na ordem das coisas: as duas consultas do Apollo
 * são POR DOMÍNIO. Sem ele, os dois botões da ficha só sabem dizer "sem dados".
 */
export function dispararDominioEmpresa(empresaId: string): string {
  return dispararAvulso('dominio-empresa', async () => {
    logger.info({ empresaId }, 'Domínio sob demanda.')
    return dominioEmpresa(empresaId)
  })
}

/** O botão "Atualizar funcionários" da ficha. Uma empresa, uma chamada ao Apollo. */
export function dispararFuncionariosEmpresa(empresaId: string): string {
  return dispararAvulso('funcionarios-empresa', async () => {
    logger.info({ empresaId }, 'Funcionários sob demanda.')
    return funcionariosEmpresa(empresaId)
  })
}

/** Lote de funcionários pelo fluxo padrão do Radar (seleção → estimativa → aprovação). */
export function dispararFuncionariosLote(loteId: string): string {
  return dispararAvulso('funcionarios-lote', async () => {
    const lote = { id: loteId, tipo: 'funcionarios', parametros: {} } as unknown as Tables<'lotes_enriquecimento'>
    return executarLote(loteId, criarProcessadorFuncionarios(lote))
  })
}

/**
 * Calibrar e estimar, nesta ordem e na MESMA corrida (04c §10).
 *
 * Encadeados de propósito: estimar com os coeficientes do mês passado logo depois de
 * recalibrar produziria uma rodada inteira de números que já nascem desatualizados —
 * e, pior, gravados como snapshot, virando história.
 */
export function dispararEstimadorMensal(): string {
  return dispararAvulso('estimador-calibrar', async () => {
    const calibracao = await calibrarEstimadorJob()
    const estimativa = await estimarFaturamentoJob()
    return { calibracao, estimativa }
  })
}

/** Só a estimativa — o que o botão "Recalibrar agora" NÃO faz sozinho. */
export function dispararEstimativaFaturamento(): string {
  return dispararAvulso('estimador-estimar', async () => estimarFaturamentoJob())
}

/** Reclassificação sob demanda — o que a ativação de uma regra de faixa dispara. */
export function dispararReclassificacaoFunil(): string {
  return dispararAvulso('antecipacao-reclassificar', async (client) => {
    const reclassificacao = await reclassificarFunil(client)
    const outbox = await gerarOutbox()
    return { reclassificacao, outbox }
  })
}

/** Regeneração da outbox sob demanda (depois de mexer na régua de disparo). */
export function dispararOutbox(): string {
  return dispararAvulso('antecipacao-outbox', async () => gerarOutbox())
}

/** Lookup cadastral sob demanda — para esvaziar a fila sem esperar o diário. */
export function dispararLookupCadastral(): string {
  return dispararAvulso('antecipacao-lookup', async () => lookupCadastral())
}

/**
 * Materializa em `contatos` o que já está no jsonb das notas.
 *
 * Sob demanda porque a primeira execução é retroativa sobre a base inteira: o
 * sync é incremental e nunca rebusca a nota de ontem, então o contato que chegou
 * antes desta função existir só sai do jsonb por aqui.
 */
export function dispararContatosNf(): string {
  return dispararAvulso('antecipacao-contatos', async () => backfillContatosNf())
}

/**
 * Executa um lote de enriquecimento APROVADO (§6.3). Materializa os itens do filtro
 * (excluindo por TTL), processa com o teto de orçamento, reconcilia o custo. Job
 * avulso: usa pool + service role, não a sessão dedicada.
 */
/**
 * Os status a partir dos quais um lote pode rodar.
 *
 * `interrompido` está aqui porque a execução parcial retoma de onde parou — e a falta
 * dele custou uma tarde: a tela passou a oferecer "Executar" para lote interrompido, e
 * este guarda continuou só com 'aprovado'. Como a rota é fire-and-forget, o worker
 * respondia 202, a tela dizia "Execução enfileirada", e o erro morria no log do
 * Railway. Duas listas de status executável, em dois arquivos, é a definição de regra
 * que diverge; por isso agora é uma constante, e a rota valida com ela ANTES do 202.
 */
export const STATUS_LOTE_EXECUTAVEL: readonly string[] = ['aprovado', 'executando', 'interrompido']

/**
 * O motivo de o lote não poder rodar, ou null quando pode.
 *
 * Existe para que a recusa aconteça de forma SÍNCRONA, na resposta HTTP: um 409 com o
 * motivo vira toast na tela, e um erro dentro do job vira uma linha de log que ninguém
 * está lendo no minuto em que ela sai.
 */
export async function motivoLoteNaoExecutavel(loteId: string): Promise<string | null> {
  const { data: lote } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .select('status')
    .eq('id', loteId)
    .maybeSingle()
  if (!lote) return 'Lote não encontrado.'
  if (!STATUS_LOTE_EXECUTAVEL.includes(lote.status)) {
    return `Lote não é executável no status "${lote.status}".`
  }
  return null
}

export function dispararLoteRadar(loteId: string): string {
  return dispararAvulso('radar-lote', async () => {
    const { data: lote, error } = await supabaseAdmin
      .from('lotes_enriquecimento')
      .select('*')
      .eq('id', loteId)
      .single()
    if (error || !lote) throw new Error(`Lote ${loteId} não encontrado.`)
    if (!STATUS_LOTE_EXECUTAVEL.includes(lote.status)) {
      throw new Error(`Lote ${loteId} não é executável (status ${lote.status}).`)
    }
    logger.info({ loteId, tipo: lote.tipo }, 'Executando lote do Radar.')
    return executarLote(loteId, escolherProcessador(lote))
  })
}

// ─── Crédito (Prompt 04d) ────────────────────────────────────────────────────

/**
 * O mensal do Crédito, encadeado e NESTA ordem, que é uma cadeia de dependências:
 *
 *   calibrar  → o ratio limite/faturamento e o giro saem da carteira real;
 *   scores    → a chance de concessão é o multiplicador do valor esperado, então
 *               precisa existir ANTES de o potencial ser calculado;
 *   potencial → limite → receita → × chance = valor esperado.
 *
 * Rodar o potencial antes dos scores produziria uma rodada inteira de valores esperados
 * multiplicados pela chance do mês passado — e gravados como snapshot, virando história.
 */
export function dispararCreditoMensal(): string {
  return dispararAvulso('credito-calibrar', async () => {
    const calibracao = await calibrarCreditoJob()
    const scores = await recalcularScoresJob()
    const potencial = await estimarPotencialJob()
    return { calibracao, scores, potencial }
  })
}

/** Só os scores — o que a ativação de uma versão de scorecard dispara. */
export function dispararRecalcularScores(): string {
  return dispararAvulso('credito-scores', async () => {
    const scores = await recalcularScoresJob()
    // O potencial vem junto porque a chance de concessão acabou de mudar: deixar o
    // valor esperado com a chance antiga seria a mesma inconsistência que o mensal evita.
    const potencial = await estimarPotencialJob()
    return { scores, potencial }
  })
}

/** Só o potencial, reaplicando a versão vigente (depois de mexer em taxa/TAC/caps). */
export function dispararEstimarPotencial(): string {
  return dispararAvulso('credito-potencial', async () => estimarPotencialJob())
}

/** Envia à seguradora as análises marcadas. Ação PAGA: resolve buyer novo. */
export function dispararEnviarAnalises(analiseIds?: string[]): string {
  return dispararAvulso('credito-enviar', async () => {
    logger.info({ quantidade: analiseIds?.length ?? 'todas as solicitadas' }, 'Enviando análises à seguradora.')
    return enviarAnalises(analiseIds)
  })
}

/** Poll das decisões abertas. Roda no cron e sob demanda. */
export function dispararPollDecisoes(): string {
  return dispararAvulso('credito-poll', async () => pollDecisoes())
}

/**
 * Backfill do histórico da apólice. Roda UMA vez — e nunca descobre buyer novo: lê o
 * portfólio e as decisões que a apólice já tem.
 */
export function dispararBackfillAtradius(simular = false): string {
  return dispararAvulso('credito-backfill', async () => backfillAtradius({ simular }))
}

/** Sync incremental diário do que já está na apólice + expiração das aprovações vencidas. */
export function dispararSyncAtradius(): string {
  return dispararAvulso('credito-sync', async () => {
    const sync = await syncAtradius()
    const poll = await pollDecisoes()
    const expiradas = await expirarAnalises()
    return { sync, poll, expiradas }
  })
}

export function dispararExpirarAnalises(): string {
  return dispararAvulso('credito-expirar', async () => expirarAnalises())
}

// ─── Análise proprietária (Prompt 04j) ───────────────────────────────────────

/**
 * O single-flight aqui é por ANÁLISE, não por tipo de job — e é a única exceção no
 * arquivo.
 *
 * `dispararAvulso` serializa por tipo, o que é certo para uma reclassificação (só faz
 * sentido uma por vez) e errado para isto: dois analistas rodando dois sacados diferentes
 * ao mesmo tempo é o uso normal, e o segundo receberia 409. O que NÃO pode acontecer é a
 * mesma análise rodar duas vezes — cada corrida relê os mesmos PDFs no modelo e custa o
 * mesmo tanto de novo.
 */
const analisesEmVoo = new Set<string>()

export function dispararAnalisePropria(analiseId: string): string {
  const id = randomUUID()
  avulsos.set(id, {
    id,
    tipo: 'credito-analise-propria',
    status: 'executando',
    iniciado_em: new Date().toISOString(),
  })

  if (analisesEmVoo.has(analiseId)) {
    // Clique repetido não é erro: a análise já está rodando e o resultado é o mesmo.
    avulsos.set(id, {
      ...(avulsos.get(id) as JobAvulso),
      status: 'concluida',
      terminado_em: new Date().toISOString(),
      resultado: { analise_id: analiseId, ja_em_execucao: true },
    })
    return id
  }
  analisesEmVoo.add(analiseId)

  void (async () => {
    try {
      const resultado = await processarAnalisePropria(analiseId)
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'concluida',
        terminado_em: new Date().toISOString(),
        resultado,
      })
    } catch (erro) {
      logger.error({ analiseId, erro: String(erro) }, 'Análise proprietária falhou fora das etapas.')
      avulsos.set(id, {
        ...(avulsos.get(id) as JobAvulso),
        status: 'falhou',
        terminado_em: new Date().toISOString(),
        erro: String(erro),
      })
    } finally {
      analisesEmVoo.delete(analiseId)
    }
  })()

  return id
}

/** Rede de segurança: retoma o que ficou em `processando` depois de um deploy. */
export function dispararDrenarAnalisesProprias(): string {
  return dispararAvulso('credito-analises-drenar', async () => drenarAnalisesProprias())
}

/** Diário: sugere (não executa) reanálise do que vence em menos de 60 dias. */
export function dispararSugerirReanalises(): string {
  return dispararAvulso('credito-reanalises', async () => sugerirReanalises())
}

/**
 * Enriquecimento dos leads que chegaram pelo formulário (04i).
 *
 * Single-flight por tipo, e aqui isso é o certo: a varredura já pega TUDO que está
 * pendente, então uma segunda corrida simultânea trabalharia sobre as mesmas linhas —
 * pagando duas vezes pelas etapas pagas.
 */
export function dispararEnriquecerLeads(): string {
  return dispararAvulso('leads-enriquecer', async () => enriquecerLeads())
}

/**
 * A cadeia inteira sobre UMA empresa, do botão da ficha.
 *
 * Single-flight por tipo, como os outros jobs de empresa (protestos, contatos): dois
 * cliques concorrentes sobre empresas diferentes serializam, e no volume de uma ficha
 * aberta por vez isso é aceitável — enquanto reconsultar o Apollo em paralelo não é.
 */
export function dispararEnriquecerEmpresa(opts: {
  empresaId: string
  incluirPagos: boolean
}): string {
  return dispararAvulso('enriquecer-empresa', async () =>
    enriquecerEmpresa({ empresaId: opts.empresaId, incluirPagos: opts.incluirPagos }),
  )
}

// ─── Perfil de Quem Opera (Prompt 04f) ───────────────────────────────────────

/**
 * Coortes → contrastes → auditoria das regras → sugestões → snapshot.
 *
 * Usa a SESSÃO DEDICADA (e não o PostgREST) porque a auditoria compila as regras
 * de camada para SQL e as roda contra `mercado_explorador` — o mesmo caminho da
 * reclassificação. Auditar a régua por outra via seria auditar outra régua.
 *
 * Mensal e ENCADEADO depois das calibrações do 04c/04d (§7.6): o perfil lê
 * `faturamento_estimado` e `score_credito`, e rodar antes delas contrastaria a
 * base com os números do mês passado.
 */
export function dispararPerfilRecalcular(): string {
  return dispararAvulso('perfil-recalcular', async (client) => recalcularPerfil(client))
}

// ─── Comercial (Prompt 04g) ──────────────────────────────────────────────────

/**
 * Distribuição semanal de empresas para os SDRs. Segunda de manhã, e não domingo à
 * noite: um lead que chega quando ninguém está trabalhando já nasce com um dia de SLA
 * queimado.
 */
export function dispararDistribuirSdr(): string {
  return dispararAvulso('comercial-distribuir', async () => distribuirSdrJob())
}

/** Diário: devolve ao pool o lead que ninguém tocou, e cobra quem não moveu nada. */
export function dispararSlaComercial(): string {
  return dispararAvulso('comercial-sla', async () => {
    const sla = await slaLeadsJob()
    const inativos = await vendedoresSemAtividadeJob()
    // Diário, e não no sync: a operação pode chegar a qualquer hora, e o card sair do
    // funil no dia seguinte é rápido o bastante para algo que já está ganho.
    const operando = await detectarPrimeiraOperacaoJob()
    return { sla, inativos, operando }
  })
}

/** Mensal: quem parece ser conta passiva. Sugere e notifica — nunca muda sozinho. */
export function dispararSugerirPassivos(): string {
  return dispararAvulso('comercial-passivos', async () => sugerirPassivosJob())
}

/** Mensal: fecha a competência anterior. O gestor aprova antes de pagar. */
export function dispararApurarComissoes(competencia?: string): string {
  return dispararAvulso('comercial-comissoes', async () => apurarComissoesJob(competencia))
}

// ─── Motor de comissões v2 (04k) ─────────────────────────────────────────────

/**
 * O diário do motor: titularidades, backfill das cessões e — só no último dia útil —
 * o fechamento da competência.
 *
 * Um cron por dia em vez de um no dia 1º porque duas das três etapas são diárias por
 * natureza (um cedente dorme num dia qualquer; uma venda é ganha numa terça) e a
 * terceira precisa de um job que saiba consultar o calendário. Quem decide se hoje é o
 * dia de fechar é o job, não a agenda.
 */
export function dispararComissoesDiario(): string {
  return dispararAvulso('comercial-comissoes-v2', async () => comissoesDiarioJob())
}

/** Fecha uma competência à mão. Só para o caso em que o último dia útil passou batido. */
export function dispararFecharCompetencia(competencia?: string): string {
  return dispararAvulso('comercial-comissoes-v2', async () => fecharCompetenciaJob(competencia))
}

/** Horário: abre a fila de aceite, expira o que venceu e lança o que foi aceito. */
export function dispararAceitesSdr(): string {
  return dispararAvulso('comercial-sdr-aceites', async () => processarAceitesSdrJob())
}

/** Semanal: aponta contas passivas cujo volume desabou. SINALIZA — nunca reclassifica. */
export function dispararAlertaReclassificacao(): string {
  return dispararAvulso('comercial-reclassificacao', async () => alertaReclassificacaoJob())
}

/*
 * Funil de cadastro de fornecedores (04l §7).
 *
 * QUATRO jobs, e a separação é a separação do dinheiro:
 *
 *   funil       recalcula munição e titularidade. Custo zero, roda atrás do sync de NF.
 *   descoberta  camadas 0+1 em lote. Quase tudo grátis; o Google Places sai do
 *               orçamento AUTOMÁTICO da casa.
 *   clique      camadas 2+4 para UM fornecedor, debitando o teto do originador. É o
 *               único disparo deste módulo que nasce de uma pessoa apertando um botão.
 *   validar     diário, sobre qualquer fonte. Nunca toca canal.
 */
export function dispararFunilFornecedores(): string {
  return dispararAvulso('fornecedores-funil', async () => atualizarFunilFornecedores())
}

export function dispararDescobertaFornecedores(limite?: number): string {
  return dispararAvulso('fornecedores-descoberta', async () => descobertaAutomaticaJob(limite))
}

/*
 * O clique NÃO usa `dispararAvulso`: ele precisa devolver o RESULTADO, não um id.
 *
 * A tela mostrou um custo estimado e perguntou "confirma?". Responder 202 e mandar a
 * pessoa consultar depois transformaria uma decisão de gastar dinheiro em algo que
 * ela não vê acontecer — e o padrão de single-flight por tipo faria o segundo
 * originador do dia receber "já existe um job em execução" para um clique que é dele.
 */
export async function executarCliqueDescoberta(input: {
  cnpj: string
  solicitadoPor?: string | null
  forcar?: boolean
}): Promise<Awaited<ReturnType<typeof descobertaSobDemanda>>> {
  return descobertaSobDemanda(input.cnpj, {
    solicitadoPor: input.solicitadoPor ?? null,
    forcar: input.forcar ?? false,
  })
}

/**
 * A segunda busca. Síncrona como a primeira, e pelo mesmo motivo: a tela mostrou o
 * custo e perguntou se pode.
 */
export async function executarBuscaAprofundada(input: {
  cnpj: string
  solicitadoPor?: string | null
  forcar?: boolean
}): Promise<Awaited<ReturnType<typeof descobertaAprofundada>>> {
  return descobertaAprofundada(input.cnpj, {
    solicitadoPor: input.solicitadoPor ?? null,
    forcar: input.forcar ?? false,
  })
}

export function dispararValidarContatos(): string {
  return dispararAvulso('fornecedores-validar', async () => validarContatosJob())
}

/**
 * Só a etapa de titularidade do diário: vincular quem ganhou, liberar cedente dormente,
 * devolver o SDR ao pool no fim da janela e encerrar quem foi desligado.
 *
 * Existe separada porque é a etapa que alguém quer rodar sozinha depois de mexer em
 * carteira — e porque um diário que só pode rodar inteiro leva a rodar o fechamento sem
 * querer.
 */
export function dispararLiberarDormentes(): string {
  return dispararAvulso('comercial-comissoes-v2', async () => titularidadesJob())
}

/** Roteia as NFs vivas para os originadores. Encadeado no diário da Antecipação. */
export function dispararRotearNotas(): string {
  return dispararAvulso('comercial-rotear', async () => rotearNotasJob())
}

export { aplicarDecisaoCreditoEmVendas }

// ─── Jurídico (Prompt 08) ───────────────────────────────────────────────────
//
// Nenhum destes jobs usa a conexão `pg` direta: eles falam com a API do Escavador e
// escrevem por PostgREST com service role. `dispararAvulso` abre uma sessão dedicada
// mesmo assim (é o contrato dele) e o `client` fica sem uso — o custo é uma conexão
// ociosa por corrida, e a alternativa seria uma segunda máquina de estado de job só
// para este módulo.

/**
 * Descoberta pelos NOSSOS CNPJs. Sob demanda (botão do admin) e no agendado inicial.
 *
 * `comMovimentacoes` desligado por padrão: numa importação de trezentos processos, a
 * timeline de cada um é uma varredura paginada paga. A capa já dá a lista; as
 * movimentações chegam na primeira sincronização.
 */
export function dispararDescobrirProcessos(opcoes: {
  incluirInativos?: boolean
  cnpj?: string
  comMovimentacoes?: boolean
} = {}): string {
  return dispararAvulso('juridico-descobrir', async () => {
    const descoberta = await descobrirProcessos(opcoes)
    // Os monitoramentos DEPOIS da descoberta, na mesma corrida: cadastrar um CNPJ novo
    // e sair sem monitorá-lo deixaria o buraco exato que o monitoramento existe para
    // fechar — a ação nova que aparece amanhã e ninguém vê.
    const monitoramentos = await sincronizarMonitoramentos()
    return { descoberta, monitoramentos }
  })
}

/**
 * A sincronização agendada. A AGENDA é conferida dentro do job (juridico_config), não
 * aqui nem no cron: mudar os dias da semana é trabalho de tela, não de deploy.
 */
export function dispararSincronizarJuridico(opcoes: { forcarAgenda?: boolean; numeroCnj?: string } = {}): string {
  return dispararAvulso('juridico-sincronizar', async () => {
    // Os pedidos enfileirados pela tool da IA e pelo botão "Atualizar agora" são
    // drenados ANTES da varredura: eles são de alguém que está olhando a tela agora,
    // e a varredura pode levar minutos.
    const solicitacoes = await drenarSolicitacoes()
    const sincronizacao = await sincronizarProcessos(opcoes)
    // Os callbacks que chegaram durante a corrida entram na mesma passada — inclusive
    // as respostas das atualizações que ela acabou de pedir ao tribunal.
    const callbacks = await processarCallbacks()
    /*
     * Os resumos de IA na MESMA corrida, mas só no DIA configurado (sexta, por
     * padrão — `juridico_config.monitoramento.dia_resumo_ia`).
     *
     * Na mesma corrida porque o resumo fica velho exatamente quando chega
     * movimentação nova, e é isto aqui que acabou de trazê-la: um relógio próprio
     * acordaria de hora em hora para descobrir que nada mudou. Num dia só porque
     * ele custa token por processo — cinco vezes por semana é pagar cinco vezes
     * por um texto que muda com a movimentação, não com o calendário.
     *
     * Não derruba a sincronização se falhar: o dado do tribunal já está gravado,
     * e um texto de apoio que não saiu não é motivo para marcar como falha uma
     * corrida que trouxe o que importava.
     */
    const cfgMonitoramento = await lerMonitoramento()
    const briefings = ehDiaDeResumoIa(cfgMonitoramento)
      ? await gerarBriefingsPendentes().catch((erro: unknown) => {
          logger.error({ erro: String(erro) }, 'Briefings falharam depois do sync.')
          return null
        })
      : { pulado: 'Hoje não é o dia de regerar os resumos de IA.' }
    return { solicitacoes, sincronizacao, callbacks, briefings }
  })
}

export function dispararCallbacksJuridico(): string {
  return dispararAvulso('juridico-callbacks', async () => processarCallbacks())
}

/** Reclassificar as fases sobre o que já está no banco. Não gasta crédito. */
export function dispararClassificarFases(numeroCnj?: string): string {
  return dispararAvulso('juridico-classificar', async () => classificarFases({ numeroCnj }))
}

export function dispararAlertasJuridico(): string {
  return dispararAvulso('juridico-alertas', async () => alertasJuridico())
}

/**
 * O parecer é SÍNCRONO, ao contrário dos demais.
 *
 * Quem clicou "Gerar parecer" está com a tela aberta e acabou de autorizar um gasto
 * em tokens. Devolver 202 e um id o obrigaria a ficar recarregando para saber se o
 * texto que ele pagou saiu — e o job leva dezenas de segundos, não horas.
 */
export async function executarParecerJuridico(
  numeroCnj: string,
  geradoPor: string | null,
): Promise<unknown> {
  return gerarParecer(numeroCnj, geradoPor)
}

/**
 * SÍNCRONO, como o parecer: quem clicou está com a tela aberta esperando o
 * texto. A geração leva poucos segundos porque o briefing lê 25 movimentações,
 * não 80.
 */
export async function executarBriefingJuridico(
  numeroCnj: string,
  forcar: boolean,
): Promise<unknown> {
  return gerarBriefing(numeroCnj, forcar)
}

/** Em lote, depois do sync — que é quando os briefings ficam velhos. */
export function dispararBriefingsJuridico(limite?: number): string {
  return dispararAvulso('juridico-briefing', async () => gerarBriefingsPendentes(limite))
}

export function dispararMonitoramentosJuridico(): string {
  return dispararAvulso('juridico-monitoramentos', async () => sincronizarMonitoramentos())
}

// ─── Comunicação (05A) ──────────────────────────────────────────────────────
/*
 * Seis relógios, e cada um é um relógio diferente porque o que ele guarda é
 * diferente:
 *
 *   fila       de 5 em 5 minutos — uma mensagem aprovada não pode esperar meia
 *              hora, e o intervalo entre envios já é aplicado dentro do job.
 *   triagem    de 5 em 5 minutos — a triagem é o que acorda o agente; atrasá-la
 *              atrasa a resposta a quem acabou de escrever.
 *   gmail      de 10 em 10 minutos — é o FALLBACK do Pub/Sub, não o caminho
 *              principal.
 *   agente     de hora em hora — decisões de relação não são de minuto.
 *   agendados  de hora em hora — o relógio que o próprio agente marcou.
 *   lembretes  de hora em hora — o H-1 precisa de granularidade de hora.
 */

export function dispararEnviarFila(limite?: number): string {
  return dispararAvulso('comunicacao-fila', async () => enviarFila(limite))
}

export function dispararTriagem(limite?: number): string {
  return dispararAvulso('comunicacao-triagem', async () => triarEntradas(limite))
}

export function dispararGmailSync(): string {
  return dispararAvulso('comunicacao-gmail', async () => {
    const sync = await sincronizarGmail()
    // A renovação do watch anda junto do sync porque as duas dependem do mesmo
    // access token: separá-las dobraria o número de refreshes por hora.
    const watches = await renovarWatches()
    return { ...sync, watches_renovados: watches }
  })
}

export function dispararLembretesReuniao(): string {
  return dispararAvulso('comunicacao-lembretes', async () => lembretesDeReuniao())
}

export function dispararPlantao(): string {
  return dispararAvulso('comunicacao-plantao', async () => plantaoDeEventos())
}

export function dispararAgenteDecidir(limite?: number): string {
  return dispararAvulso('agente-decidir', async () => decidirProximosPassos(limite))
}

export function dispararAgenteAgendados(limite?: number): string {
  return dispararAvulso('agente-agendados', async () => {
    const passos = await executarAgendados(limite)
    // O desfecho é apurado na mesma passada: é sobre as decisões que este job
    // executou, e um segundo relógio só para ele seria um relógio a mais para
    // manter.
    const desfechos = await apurarDesfechos()
    return { ...passos, desfechos }
  })
}

/**
 * ─── OS QUATRO RELÓGIOS DAS CAMPANHAS (05B §9) ──────────────────────────────
 *
 *   simular    sob demanda — é a pessoa que pede, e ela está esperando na tela.
 *   executar   de 15 em 15 minutos. O ritmo do dia é espalhado pelo próprio job
 *              em horários agendados, então o executor não precisa ser fino: ele
 *              só precisa acordar antes de a leva anterior acabar.
 *   sequência  diário — `dias_apos` é medido em dias, e um job de hora em hora
 *              acordaria 24 vezes para responder "ainda não".
 *   métricas   de 30 em 30 minutos. É a varredura de saúde para quando NINGUÉM
 *              está olhando; o painel de quem abre a tela é calculado na hora.
 */

export function dispararCampanhaSimular(campanhaId: string): string {
  return dispararAvulso('campanhas-simular', async () => simularCampanha(campanhaId))
}

export function dispararCampanhasExecutar(): string {
  return dispararAvulso('campanhas-executar', async () => executarCampanhas())
}

export function dispararCampanhasSequencia(): string {
  return dispararAvulso('campanhas-sequencia', async () => avancarSequencias())
}

export function dispararCampanhasMetricas(): string {
  return dispararAvulso('campanhas-metricas', async () => varrerSaudeDasCampanhas())
}
