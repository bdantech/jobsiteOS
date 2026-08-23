import { EVENTO_TIPOS, type EventoTipo } from '../../../../../packages/core/src/constants.js'
import { houveReducaoDeLimite } from '../../../../../packages/core/src/credito/seguradora.js'
import type {
  DecisaoSeguradora,
  Seguradora,
} from '../../../../../packages/core/src/credito/seguradora.js'
import type { Json } from '../../../../../packages/core/src/types/database.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerConfigCredito, lerIntegracaoSeguradora } from '../../credito/config.js'
import { emitirEvento } from '../../radar/eventos.js'
import { aplicarDecisaoCreditoEmVendas } from '../comercial/comissoes.js'
import { atradius } from './atradius.js'
import { recalcularScoresDeCnpjs } from './potencial.js'
import { processarAnalisePropria } from './analise-propria.js'

/**
 * A esteira contra a seguradora (04d §4).
 *
 * Regras que valem para os cinco jobs deste arquivo:
 *
 * 1. **Buyer novo só entra pelo envio.** `resolverBuyer` pode ser cobrado, e por isso ele
 *    aparece exatamente uma vez, dentro de `enviarAnalises`, sobre uma análise que um
 *    humano marcou para enviar. Backfill e sync leem o que a apólice JÁ tem.
 * 2. **Decisão nunca vem da tela.** Só estes jobs escrevem `aprovada`/`negada`/`expirada`,
 *    com service role. A migração 0073 recusa esses estágios no RPC de mover.
 * 3. **Toda decisão vira snapshot em `credito_snapshots` + evento.** Um limite que muda
 *    sem deixar rastro é um limite que ninguém consegue explicar depois.
 */

const seguradora: Seguradora = atradius

/** Meses → data ISO, para a validade default quando a seguradora não devolve uma. */
function validadeDefault(meses: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + meses)
  return d.toISOString().slice(0, 10)
}

// ─── §4.2 Envio ─────────────────────────────────────────────────────────────

export async function enviarAnalises(analiseIds?: string[]): Promise<{
  status: 'ok' | 'nao_configurada'
  enviadas?: number
  falharam?: number
  /** Quantas análises proprietárias o envio abriu de carona (04j §6). */
  analises_disparadas?: number
  detalhes?: Array<{ id: string; erro: string }>
}> {
  // `configurada()` é assíncrono desde que o ambiente (sandbox/produção) virou setting:
  // quais credenciais são exigidas depende do que a tela escolheu, e isso mora no banco.
  // O motivo — qual variável falta, em qual ambiente — é logado dentro do provedor.
  if (!(await seguradora.configurada())) {
    logger.warn('Seguradora não configurada; envio não roda.')
    return { status: 'nao_configurada' }
  }

  // A apólice é resolvida UMA VEZ, antes do laço, e não dentro dele. `resolverBuyer` pode
  // ser cobrado e roda antes do pedido: com a apólice irresolvível, cada análise pendente
  // viraria uma busca de buyer paga seguida de falha — uma fatura produzida por um erro
  // de configuração. Falhando aqui, nenhuma chamada cobrada acontece.
  const apolice = await seguradora.apoliceVigente()
  if (!apolice.ok) {
    logger.error({ erro: apolice.erro, recuperavel: apolice.recuperavel }, 'Apólice indisponível; envio não roda.')
    return { status: 'nao_configurada' }
  }
  logger.info({ apolice: apolice.dados.descricao }, 'Envio à seguradora sob esta apólice.')

  let q = supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, limite_solicitado, moeda, atradius_buyer_id')
    .eq('estagio', 'solicitada')
  if (analiseIds?.length) q = q.in('id', analiseIds)

  const { data: pendentes } = await q
  const acc = { enviadas: 0, falharam: 0, analises_disparadas: 0 }
  const detalhes: Array<{ id: string; erro: string }> = []

  for (const a of pendentes ?? []) {
    // Buyer já resolvido numa tentativa anterior não é resolvido de novo: a chamada
    // pode ser cobrada, e um retry que recobra transforma uma instabilidade de rede em
    // linha na fatura.
    let buyerId = a.atradius_buyer_id
    if (!buyerId) {
      const r = await seguradora.resolverBuyer(a.cnpj)
      if (!r.ok) {
        acc.falharam++
        detalhes.push({ id: a.id, erro: r.erro })
        continue
      }
      if (!r.dados) {
        acc.falharam++
        detalhes.push({ id: a.id, erro: 'CNPJ não encontrado como buyer na seguradora.' })
        continue
      }
      buyerId = r.dados.buyer_id
      await supabaseAdmin
        .from('analises_credito')
        .update({ atradius_buyer_id: buyerId, rating_seguradora: r.dados.rating, atualizada_em: new Date().toISOString() })
        .eq('id', a.id)
    }

    const pedido = await seguradora.pedirCobertura({
      buyer_id: buyerId,
      limite_solicitado: Number(a.limite_solicitado ?? 0),
      moeda: a.moeda ?? 'BRL',
      referencia_externa: a.id,
    })
    if (!pedido.ok) {
      acc.falharam++
      detalhes.push({ id: a.id, erro: pedido.erro })
      continue
    }

    await supabaseAdmin
      .from('analises_credito')
      .update({
        estagio: 'enviada_seguradora',
        atradius_case_id: pedido.dados.case_id,
        atualizada_em: new Date().toISOString(),
      })
      .eq('id', a.id)

    await emitirEventoAnalise(a.id, EVENTO_TIPOS.ANALISE_ENVIADA, 'Análise enviada à seguradora', `Pedido ${pedido.dados.case_id} aberto na ${seguradora.nome}.`)
    acc.enviadas++

    // 04j §6: a análise proprietária dispara JUNTO do envio, não antes dele.
    //
    // Em paralelo e sem bloquear — o envio já aconteceu e não pode ser desfeito por uma
    // extração que demorou. Se ela falhar, o registro fica `falhou` com motivo, e o
    // envio à seguradora segue valendo.
    acc.analises_disparadas += await dispararPropriaSeFaltar(a.id)
  }

  logger.info(acc, 'Envio de análises concluído.')
  return { status: 'ok', ...acc, detalhes }
}

/**
 * Abre a análise proprietária deste pedido, se ainda não houver uma.
 *
 * Roda com service role e por INSERT direto, não pelo RPC `app_rodar_analise_propria`:
 * o RPC exige `auth.uid()` e o módulo Crédito do usuário, e aqui não há usuário — o
 * gatilho é do sistema. A guarda contra duplicar é a mesma, aplicada aqui.
 *
 * `void` no processamento: o envio à seguradora não espera a extração terminar.
 */
async function dispararPropriaSeFaltar(analiseCreditoId: string): Promise<number> {
  const { data: existente } = await supabaseAdmin
    .from('analises_proprietarias')
    .select('id, status')
    .eq('analise_credito_id', analiseCreditoId)
    .in('status', ['processando', 'aguardando_revisao', 'concluida'])
    .limit(1)
  if (existente && existente.length > 0) return 0

  const { data: esteira } = await supabaseAdmin
    .from('analises_credito')
    .select('cnpj, empresa_id')
    .eq('id', analiseCreditoId)
    .maybeSingle()
  const { data: versao } = await supabaseAdmin
    .from('analise_parametros')
    .select('versao')
    .eq('ativa', true)
    .maybeSingle()
  if (!esteira || !versao) {
    logger.warn({ analiseCreditoId }, 'Sem esteira ou sem versão ativa de parâmetros; análise proprietária não disparada.')
    return 0
  }

  const { data: nova, error } = await supabaseAdmin
    .from('analises_proprietarias')
    .insert({
      analise_credito_id: analiseCreditoId,
      empresa_id: esteira.empresa_id,
      cnpj: esteira.cnpj,
      tipo: 'inicial',
      gatilho: 'automatico_envio_atradius',
      status: 'processando',
      etapa: 'extracao',
      parametros_versao: versao.versao,
    } as never)
    .select('id')
    .maybeSingle()
  if (error || !nova) {
    logger.error({ analiseCreditoId, erro: error?.message }, 'Falha ao abrir análise proprietária no envio.')
    return 0
  }

  await emitirEvento(esteira.empresa_id, EVENTO_TIPOS.ANALISE_PROPRIA_INICIADA, {
    analise_propria_id: nova.id,
    cnpj: esteira.cnpj,
    gatilho: 'automatico_envio_atradius',
  })

  void processarAnalisePropria(nova.id).catch((e) =>
    logger.error({ analise: nova.id, erro: String(e) }, 'Análise proprietária automática falhou.'),
  )
  return 1
}

// ─── §4.3 Aplicar uma decisão ───────────────────────────────────────────────

/**
 * O único lugar que escreve o desfecho de uma análise. Concentrado de propósito: poll,
 * backfill e sync chegam à mesma decisão por caminhos diferentes, e três cópias desta
 * função seriam três lugares onde "aprovada parcial" pode virar "aprovada".
 */
async function aplicarDecisao(
  analiseId: string,
  cnpj: string,
  empresaId: string | null,
  anterior: { estagio: string; limite_aprovado: number | null },
  d: DecisaoSeguradora,
  validadeMeses: number,
): Promise<{ mudou: boolean; reduziu: boolean }> {
  const expira = d.expira_em ?? (d.estagio === 'aprovada' || d.estagio === 'aprovada_parcial' ? validadeDefault(validadeMeses) : null)
  const mudou = anterior.estagio !== d.estagio || Number(anterior.limite_aprovado ?? 0) !== Number(d.limite_aprovado ?? 0)
  if (!mudou) return { mudou: false, reduziu: false }

  await supabaseAdmin
    .from('analises_credito')
    .update({
      estagio: d.estagio,
      limite_aprovado: d.limite_aprovado,
      moeda: d.moeda,
      rating_seguradora: d.rating,
      expira_em: expira,
      decidida_em: d.decidida_em ?? new Date().toISOString(),
      motivo: d.motivo,
      atualizada_em: new Date().toISOString(),
    })
    .eq('id', analiseId)

  // Snapshot em credito_snapshots: a decisão da seguradora entra na MESMA série que os
  // limites da Onepay, com origem própria. É o que permite ler as duas juntas depois.
  if (d.limite_aprovado !== null) {
    await supabaseAdmin.from('credito_snapshots').insert({
      cnpj,
      origem: 'atradius',
      credit_limit: d.limite_aprovado,
      expiration_date: expira,
      status: d.estagio,
    })
  }

  const reduziu = houveReducaoDeLimite(anterior.limite_aprovado, d.limite_aprovado)

  const tipo =
    d.estagio === 'aprovada'
      ? EVENTO_TIPOS.ANALISE_APROVADA
      : d.estagio === 'aprovada_parcial'
        ? EVENTO_TIPOS.ANALISE_APROVADA_PARCIAL
        : d.estagio === 'negada'
          ? EVENTO_TIPOS.ANALISE_NEGADA
          : d.estagio === 'expirada'
            ? EVENTO_TIPOS.ANALISE_EXPIRADA
            : null

  if (tipo) {
    await emitirEvento(empresaId, tipo, {
      titulo: `Análise de crédito: ${d.estagio.replace('_', ' ')}`,
      resumo:
        d.limite_aprovado !== null
          ? `Limite aprovado: R$ ${Math.round(d.limite_aprovado).toLocaleString('pt-BR')}${expira ? ` (até ${expira})` : ''}.`
          : (d.motivo ?? 'Sem limite aprovado.'),
      url: `/credito/analises/${analiseId}`,
      cnpj,
      analise_id: analiseId,
    })
  }

  // O card do funil comercial (04g §5) anda junto com a decisão. Aprovada e negada
  // são inequívocas e ficam mais caras quanto mais demoram; parcial NÃO anda sozinha,
  // e a própria função devolve 0 nesse caso.
  if (d.estagio === 'aprovada' || d.estagio === 'negada' || d.estagio === 'aprovada_parcial') {
    await aplicarDecisaoCreditoEmVendas(analiseId, d.estagio)
  }

  // Evento próprio, e não um caso dentro de "atualizada": a seguradora CORTANDO
  // cobertura que já tinha dado é o sinal de risco mais forte que este sistema recebe
  // de fora, e ele vai para Admin além de Crédito.
  if (reduziu) {
    await emitirEvento(empresaId, EVENTO_TIPOS.ANALISE_LIMITE_REDUZIDO, {
      titulo: 'Limite reduzido pela seguradora',
      resumo:
        `De R$ ${Math.round(Number(anterior.limite_aprovado)).toLocaleString('pt-BR')} para ` +
        `R$ ${Math.round(Number(d.limite_aprovado ?? 0)).toLocaleString('pt-BR')}.`,
      url: `/credito/analises/${analiseId}`,
      cnpj,
      analise_id: analiseId,
      de: anterior.limite_aprovado,
      para: d.limite_aprovado,
    })
  }

  return { mudou: true, reduziu }
}

async function emitirEventoAnalise(
  analiseId: string,
  tipo: EventoTipo,
  titulo: string,
  resumo: string,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('analises_credito')
    .select('empresa_id, cnpj')
    .eq('id', analiseId)
    .maybeSingle()
  await emitirEvento(data?.empresa_id ?? null, tipo, {
    titulo,
    resumo,
    url: `/credito/analises/${analiseId}`,
    cnpj: data?.cnpj,
    analise_id: analiseId,
  })
}

// ─── §4.3 Poll das decisões ─────────────────────────────────────────────────

export async function pollDecisoes(): Promise<{
  status: 'ok' | 'nao_configurada' | 'erro'
  consultadas?: number
  decididas?: number
  falhas?: number
  erro?: string
}> {
  if (!(await seguradora.configurada())) return { status: 'nao_configurada' }

  const cfg = await lerConfigCredito()
  const { data: abertas } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, estagio, limite_aprovado, atradius_case_id')
    .in('estagio', ['enviada_seguradora', 'em_analise'])
    .not('atradius_case_id', 'is', null)

  const acc = { consultadas: 0, decididas: 0, falhas: 0 }
  const decididos: string[] = []
  let ultimoErro: string | null = null

  for (const a of abertas ?? []) {
    acc.consultadas++
    const r = await seguradora.consultarDecisao(a.atradius_case_id as string)
    if (!r.ok) {
      // Contado, e não engolido: um `continue` calado transformava "a seguradora está
      // fora do ar" em "nenhuma decisão saiu hoje" — que é o que se espera ver num dia
      // normal, e por isso ninguém investiga.
      acc.falhas++
      ultimoErro = r.erro
      continue
    }
    // Sem dados NÃO é falha: significa que a apólice não conhece este caso, e a análise
    // fica onde está até alguém explicar por quê.
    if (!r.dados) continue

    const { mudou } = await aplicarDecisao(
      a.id,
      a.cnpj,
      a.empresa_id,
      { estagio: a.estagio, limite_aprovado: a.limite_aprovado },
      r.dados,
      cfg.validade_padrao_meses,
    )
    if (mudou) {
      acc.decididas++
      decididos.push(a.cnpj)
    }
  }

  // A decisão muda dois fatores do scorecard da empresa decidida (histórico e, se
  // negada, o knockout). Repontuar aqui é o que impede que ela fique com a faixa antiga
  // até a virada do mês, sendo multiplicada por uma chance que a seguradora desmentiu.
  await recalcularScoresDeCnpjs(decididos)

  // Toda consulta falhou: não é "nada mudou", é "não consegui perguntar".
  if (acc.falhas > 0 && acc.falhas === acc.consultadas) {
    logger.error({ ...acc, erro: ultimoErro }, 'Poll de decisões FALHOU.')
    return { status: 'erro', erro: ultimoErro ?? undefined, ...acc }
  }
  if (acc.falhas > 0) logger.warn(acc, 'Poll de decisões concluído com falhas.')
  else logger.info(acc, 'Poll de decisões concluído.')
  return { status: 'ok', ...acc }
}

// ─── §4.3 Backfill do histórico da apólice ──────────────────────────────────

/**
 * Recupera o que JÁ EXISTE na apólice: limites vigentes, decisões pendentes e o
 * histórico. **Nunca descobre buyer novo** — `resolverBuyer` não é chamado aqui, e o
 * `detalharBuyer` só age sobre buyers que vieram nas listagens, para traduzir
 * buyer_id → CNPJ.
 *
 * Buyer sem CNPJ nos 14 dígitos vai para revisão manual (fica sem `empresa_id` e com o
 * motivo preenchido) em vez de ser casado por nome — dois homônimos viram uma empresa
 * só, e o erro só aparece quando alguém aprova o limite errado.
 */
export async function backfillAtradius(): Promise<{
  status: 'ok' | 'nao_configurada' | 'erro'
  lidos?: number
  inseridos?: number
  atualizados?: number
  sem_cnpj?: number
  erro?: string
}> {
  if (!(await seguradora.configurada())) return { status: 'nao_configurada' }

  // ── O backfill é o único job que ESCREVE o que veio da seguradora ──────────
  //
  // Sync e poll só tocam análises que nasceram aqui, então rodá-los contra a sandbox é
  // inofensivo. Este INSERE: as coberturas da apólice que não existem na nossa base viram
  // linhas novas em `analises_credito`.
  //
  // E aí está a assimetria que quase me escapou: o interruptor de ambiente troca a
  // SEGURADORA, não o nosso banco. Rodando em homologação, os buyers de mentira da
  // sandbox entram no banco de produção como análises indistinguíveis das reais — e uma
  // vez dentro, elas contam no funil, no scorecard e em qualquer conciliação de carteira.
  //
  // O ambiente de teste existe para que errar não custe. Aqui custaria, então ele recusa.
  const { ambiente } = await lerIntegracaoSeguradora()
  if (ambiente !== 'producao') {
    logger.warn(
      { ambiente },
      'Backfill recusado fora de produção: ele grava no banco real o que ler da seguradora.',
    )
    return {
      status: 'erro',
      erro:
        'O backfill só roda com a seguradora em produção: ele insere no nosso banco o que ' +
        'ler da apólice, e o ambiente de homologação não tem um banco separado para receber isso.',
    }
  }

  const cfg = await lerConfigCredito()
  const acc = { lidos: 0, inseridos: 0, atualizados: 0, sem_cnpj: 0 }
  const cnpjPorBuyer = new Map<string, string | null>()
  const tocados: string[] = []

  // O mapa CNPJ→buyer sai de UMA chamada (`my-buyers`) em vez de uma por buyer. Numa
  // apólice com centenas de buyers, a diferença é entre uma requisição e centenas.
  //
  // Falhar aqui não interrompe nada: o backfill segue no plano B, detalhando um a um. Uma
  // otimização que derruba o job quando indisponível é pior que a versão não otimizada.
  const lista = await seguradora.listarBuyersDaApolice()
  if (lista.ok && lista.dados) {
    for (const b of lista.dados) cnpjPorBuyer.set(b.buyer_id, b.identificador_nacional)
    logger.info({ buyers: lista.dados.length }, 'Buyers da apólice pré-carregados.')
  } else {
    logger.warn(
      { erro: lista.ok ? 'listagem indisponível' : lista.erro },
      'Sem listagem de buyers; o backfill vai detalhar um a um.',
    )
  }

  /**
   * O CNPJ do buyer, na ordem do mais barato para o mais caro:
   *
   * 1. o que a própria decisão trouxe (a Atradius embute `uniqueIdentifiers` em cada
   *    cobertura) — custo zero;
   * 2. o mapa pré-carregado da apólice — uma chamada para todos;
   * 3. o detalhamento individual — uma chamada por buyer, e só para quem sobrou.
   *
   * Cada degrau existe porque o de cima pode faltar: nem toda cobertura traz identificador,
   * e a listagem pode não estar disponível. O terceiro nunca deixou de funcionar, então
   * continua sendo o piso.
   */
  async function cnpjDoBuyer(buyerId: string, daDecisao?: string | null): Promise<string | null> {
    if (daDecisao) {
      if (!cnpjPorBuyer.has(buyerId)) cnpjPorBuyer.set(buyerId, daDecisao)
      return daDecisao
    }
    if (cnpjPorBuyer.has(buyerId)) return cnpjPorBuyer.get(buyerId) ?? null
    const r = await seguradora.detalharBuyer(buyerId)
    const cnpj = r.ok ? (r.dados?.identificador_nacional ?? null) : null
    cnpjPorBuyer.set(buyerId, cnpj)
    return cnpj
  }

  let falha: string | null = null

  async function consumir(
    ler: (cursor?: string) => Promise<
      | { ok: true; dados: { itens: DecisaoSeguradora[]; proximoCursor: string | null } }
      | { ok: false; erro: string; recuperavel: boolean }
    >,
  ): Promise<void> {
    let cursor: string | undefined
    // Teto de páginas: uma paginação que não devolve `proximoCursor: null` por um bug
    // do outro lado giraria para sempre gastando chamadas.
    for (let pagina = 0; pagina < 200; pagina++) {
      const r = await ler(cursor)
      if (!r.ok) {
        falha = r.erro
        return
      }
      for (const d of r.dados.itens) {
        acc.lidos++
        const cnpj = await cnpjDoBuyer(d.buyer_id, d.identificador_nacional)
        if (!cnpj) {
          acc.sem_cnpj++
          continue
        }

        const { data: empresa } = await supabaseAdmin
          .from('empresas')
          .select('id')
          .eq('cnpj', cnpj)
          .maybeSingle()

        const { data: existente } = await supabaseAdmin
          .from('analises_credito')
          .select('id, estagio, limite_aprovado')
          .eq('atradius_case_id', d.case_id)
          .maybeSingle()

        if (existente) {
          const { mudou } = await aplicarDecisao(
            existente.id,
            cnpj,
            empresa?.id ?? null,
            { estagio: existente.estagio, limite_aprovado: existente.limite_aprovado },
            d,
            cfg.validade_padrao_meses,
          )
          if (mudou) {
            acc.atualizados++
            tocados.push(cnpj)
          }
          continue
        }

        await supabaseAdmin.from('analises_credito').insert({
          empresa_id: empresa?.id ?? null,
          cnpj,
          estagio: d.estagio,
          limite_aprovado: d.limite_aprovado,
          moeda: d.moeda,
          seguradora: seguradora.id,
          atradius_buyer_id: d.buyer_id,
          atradius_case_id: d.case_id,
          rating_seguradora: d.rating,
          expira_em: d.expira_em,
          decidida_em: d.decidida_em,
          motivo: d.motivo,
          // A marca que impede a esteira de levar crédito por decisões que ela não tomou.
          origem: 'atradius_backfill',
        })
        acc.inseridos++
        tocados.push(cnpj)
      }
      if (!r.dados.proximoCursor) return
      cursor = r.dados.proximoCursor
    }
    logger.warn('Backfill parou no teto de 200 páginas.')
  }

  await consumir((c) => seguradora.listarPortfolio(c))
  await consumir((c) => seguradora.listarDecisoes(undefined, c))

  // Uma das duas listagens não veio: o backfill leu um pedaço da apólice e não a apólice.
  // Reportar isso como sucesso faria alguém concluir que o histórico está completo — e o
  // backfill é justamente o job que se roda UMA vez, confiando que trouxe tudo.
  if (falha) {
    logger.error({ ...acc, erro: falha }, 'Backfill da Atradius FALHOU.')
    return { status: 'erro', erro: falha, ...acc }
  }

  // O backfill traz histórico de decisões, e histórico é um fator do scorecard: sem
  // repontuar, a empresa que a apólice já aprovou continuaria contando como "nunca
  // analisada" na conta que decide a chance de concessão dela.
  await recalcularScoresDeCnpjs(tocados)

  logger.info(acc, 'Backfill da Atradius concluído.')
  return { status: 'ok', ...acc }
}

/**
 * Sync incremental diário. Mesma restrição do backfill: só o que já está na apólice.
 * A janela de 30 dias existe para a listagem não crescer para sempre — decisões mais
 * antigas que isso já foram vistas, e o backfill é quem recupera história.
 */
export async function syncAtradius(): Promise<{
  status: 'ok' | 'nao_configurada' | 'erro'
  lidos?: number
  atualizados?: number
  erro?: string
}> {
  if (!(await seguradora.configurada())) return { status: 'nao_configurada' }

  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  const cfg = await lerConfigCredito()
  const acc = { lidos: 0, atualizados: 0 }
  const decididos: string[] = []

  // Um retrato do que foi LIDO, e não só do que foi escrito.
  //
  // `lidos: 14, atualizados: 0` é o resultado normal enquanto a apólice tem coberturas que
  // não vieram daqui — e não diz nada sobre se a leitura está certa. O retrato diz: se
  // todas as decisões caem em `em_analise`, o mapa de códigos não está batendo; se nenhuma
  // traz CNPJ, o backfill não vai conseguir casar linha nenhuma; e a moeda revela em que
  // moeda a apólice realmente opera, que é uma pergunta de negócio.
  const retrato = {
    por_estagio: {} as Record<string, number>,
    moedas: new Set<string>(),
    com_cnpj: 0,
    com_pendencia: 0,
  }

  let cursor: string | undefined
  let falha: string | null = null
  for (let pagina = 0; pagina < 200; pagina++) {
    const r = await seguradora.listarDecisoes(desde, cursor)
    if (!r.ok) {
      falha = r.erro
      break
    }
    for (const d of r.dados.itens) {
      acc.lidos++
      retrato.por_estagio[d.estagio] = (retrato.por_estagio[d.estagio] ?? 0) + 1
      retrato.moedas.add(d.moeda)
      if (d.identificador_nacional) retrato.com_cnpj++
      if (d.pendencia) retrato.com_pendencia++
      const { data: existente } = await supabaseAdmin
        .from('analises_credito')
        .select('id, cnpj, empresa_id, estagio, limite_aprovado')
        .eq('atradius_case_id', d.case_id)
        .maybeSingle()
      if (!existente) continue // buyer que não passou por aqui: backfill resolve, sync não descobre

      const { mudou } = await aplicarDecisao(
        existente.id,
        existente.cnpj,
        existente.empresa_id,
        { estagio: existente.estagio, limite_aprovado: existente.limite_aprovado },
        d,
        cfg.validade_padrao_meses,
      )
      if (mudou) {
        acc.atualizados++
        decididos.push(existente.cnpj)
      }
    }
    if (!r.dados.proximoCursor) break
    cursor = r.dados.proximoCursor
  }

  await recalcularScoresDeCnpjs(decididos)

  // "Não consegui falar com a seguradora" e "falei e não havia nada" produziam a MESMA
  // linha de log e os MESMOS zeros. Quem lia o log não tinha como distinguir os dois — e
  // um sync que falha calado é um sync que ninguém percebe que parou de rodar.
  if (falha) {
    logger.error({ ...acc, erro: falha }, 'Sync da Atradius FALHOU.')
    return { status: 'erro', erro: falha, ...acc }
  }

  logger.info(
    { ...acc, ...retrato, moedas: [...retrato.moedas] },
    'Sync da Atradius concluído.',
  )
  return { status: 'ok', ...acc }
}

// ─── §4.4 Expiração ─────────────────────────────────────────────────────────

/**
 * Marca como expirada a aprovação cuja validade passou. Roda mesmo sem seguradora
 * configurada: a data de validade é NOSSA, e uma aprovação vencida contando como
 * vigente no scorecard valeria pontos que ela não tem mais.
 */
export async function expirarAnalises(): Promise<{ expiradas: number }> {
  const hoje = new Date().toISOString().slice(0, 10)
  const { data: vencidas } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, expira_em')
    .in('estagio', ['aprovada', 'aprovada_parcial'])
    .not('expira_em', 'is', null)
    .lt('expira_em', hoje)

  for (const a of vencidas ?? []) {
    await supabaseAdmin
      .from('analises_credito')
      .update({ estagio: 'expirada', atualizada_em: new Date().toISOString() })
      .eq('id', a.id)

    await emitirEvento(a.empresa_id, EVENTO_TIPOS.ANALISE_EXPIRADA, {
      titulo: 'Análise de crédito expirada',
      resumo: `A aprovação venceu em ${a.expira_em}. Candidata a renovação.`,
      url: `/credito/analises/${a.id}`,
      cnpj: a.cnpj,
      analise_id: a.id,
    })
  }

  // Expirar também mexe no fator de histórico: "aprovada vigente" vale mais que
  // "aprovada expirada", e a empresa não pode continuar levando os pontos de uma
  // cobertura que acabou ontem.
  await recalcularScoresDeCnpjs((vencidas ?? []).map((a) => a.cnpj))

  const expiradas = (vencidas ?? []).length
  if (expiradas > 0) logger.info({ expiradas }, 'Análises expiradas.')
  return { expiradas }
}
