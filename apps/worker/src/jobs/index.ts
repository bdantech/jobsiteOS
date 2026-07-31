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
import {
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
import { sincronizarNotasFiscais } from './antecipacao/sync-nfs.js'
import { reclassificarFunil } from './antecipacao/reclassificar.js'
import { gerarOutbox } from './antecipacao/outbox.js'
import { lookupCadastral } from './antecipacao/lookup-cadastral.js'
import { backfillContatosNf } from './antecipacao/contatos-nf.js'
import { limparSupressoesExpiradas } from './antecipacao/supressoes.js'

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
  | 'protestos-empresa'
  | 'contatos-empresa'
  | 'certificados'
  | 'antecipacao-sync-nfs'
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
 * Protestos sob demanda de uma empresa (+ SPEs opcionais), disparado da ficha. Job
 * avulso: usa pool + service role. Single-flight por tipo — dois disparos concorrentes
 * de empresas diferentes serializam (o segundo recebe 409), aceitável no volume real.
 */
export function dispararProtestosEmpresa(opts: {
  empresaId: string
  incluirSpes: boolean
  anoMin: number | null
}): string {
  return dispararAvulso('protestos-empresa', async () => {
    logger.info({ empresaId: opts.empresaId, incluirSpes: opts.incluirSpes, anoMin: opts.anoMin }, 'Protestos sob demanda.')
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
      const outbox = await gerarOutbox()
      await anotarMeta(id, { sync, lookup, reclassificacao: reclass, outbox })
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
    const outbox = await gerarOutbox()
    return { varredura, supressoes, lookup, contatos, reclassificacao, outbox }
  })
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
export function dispararLoteRadar(loteId: string): string {
  return dispararAvulso('radar-lote', async () => {
    const { data: lote, error } = await supabaseAdmin
      .from('lotes_enriquecimento')
      .select('*')
      .eq('id', loteId)
      .single()
    if (error || !lote) throw new Error(`Lote ${loteId} não encontrado.`)
    if (lote.status !== 'aprovado' && lote.status !== 'executando') {
      throw new Error(`Lote ${loteId} não está aprovado (status ${lote.status}).`)
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
export function dispararBackfillAtradius(): string {
  return dispararAvulso('credito-backfill', async () => backfillAtradius())
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
