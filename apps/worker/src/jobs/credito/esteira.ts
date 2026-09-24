import { EVENTO_TIPOS, type EventoTipo } from '../../../../../packages/core/src/constants.js'
import {
  casarPedidosComCoberturas,
  houveReducaoDeLimite,
} from '../../../../../packages/core/src/credito/seguradora.js'
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
import { enviarDocumentosPorEmail } from './documentos-email.js'
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
 * 2. **Limite aprovado nunca vem da tela.** Só estes jobs escrevem `limite_aprovado` e os
 *    códigos da apólice, com service role. O ESTÁGIO ganhou uma segunda porta na 0187
 *    (`app_concluir_analise`), que conclui a esteira a partir da nossa decisão e não
 *    encosta no número da seguradora — são duas verdades diferentes.
 * 3. **Toda decisão vira snapshot em `credito_snapshots` + evento.** Um limite que muda
 *    sem deixar rastro é um limite que ninguém consegue explicar depois.
 */

const seguradora: Seguradora = atradius

// ─── §4.2 Envio ─────────────────────────────────────────────────────────────

export async function enviarAnalises(
  analiseIds?: string[],
  /**
   * Os documentos que o analista marcou no diálogo de envio, por id de `analise_docs`.
   *
   * `undefined` significa "não escolheram nada" e NÃO significa "mande todos": o envio
   * também roda por lote e por retomada, onde não houve tela nenhuma. Mandar a pasta
   * inteira por omissão faria uma rotina automática despejar documento na seguradora
   * sem ninguém ter olhado.
   */
  docIds?: string[],
): Promise<{
  status: 'ok' | 'nao_configurada'
  enviadas?: number
  falharam?: number
  /** Quantas análises proprietárias o envio abriu de carona (04j §6). */
  analises_disparadas?: number
  /**
   * Documentos que saíram por e-mail, somando as análises do lote.
   *
   * "Saiu" é "o Resend aceitou a mensagem", não "o analista leu" — é a única régua que o
   * momento do envio conhece. Entrega e bounce chegam depois, pelo webhook.
   */
  documentos_enviados?: number
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

  // `docs_recebidos` entra junto de `solicitada`: é de lá que sai o envio depois de a
  // pasta ser conferida, e era para lá que o gatilho do checklist passou a levar (0187).
  // `empresas(razao_social)` entra pelo e-mail dos documentos: o assunto e o corpo
  // nomeiam a empresa, e um e-mail à seguradora que só tem CNPJ obriga quem o recebe a
  // procurar de quem é antes de saber se é com ele.
  let q = supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, limite_solicitado, moeda, atradius_buyer_id, empresas(razao_social)')
    .in('estagio', ['solicitada', 'docs_recebidos'])
  if (analiseIds?.length) q = q.in('id', analiseIds)

  const { data: pendentes } = await q
  const acc = { enviadas: 0, falharam: 0, analises_disparadas: 0, documentos_enviados: 0 }
  const detalhes: Array<{ id: string; erro: string }> = []

  /**
   * Registra a falha ONDE ALGUÉM VÊ, e não só em `detalhes`.
   *
   * `detalhes` volta na resposta do job e morre ali: a action da web responde `ok`
   * assim que o worker aceita o trabalho — ela não espera o resultado, e nem
   * deveria, porque o envio pode demorar. O efeito era uma análise parada em
   * `solicitada` sem nada na tela dizendo por quê, e o motivo só no log do
   * container.
   *
   * O evento resolve isso por dois caminhos de uma vez: entra na timeline da
   * empresa e, pela regra de fan-out da 0193, vira notificação no sino de quem
   * cuida da esteira. O texto do erro vai no resumo — é ele que diz se foi
   * credencial, apólice ou recusa da seguradora.
   */
  const registrarFalha = async (analiseId: string, erro: string): Promise<void> => {
    acc.falharam++
    detalhes.push({ id: analiseId, erro })
    await emitirEventoAnalise(
      analiseId,
      EVENTO_TIPOS.ANALISE_ENVIO_FALHOU,
      'Falha ao enviar à seguradora',
      erro,
    )
  }

  for (const a of pendentes ?? []) {
    // Buyer já resolvido numa tentativa anterior não é resolvido de novo: a chamada
    // pode ser cobrada, e um retry que recobra transforma uma instabilidade de rede em
    // linha na fatura.
    let buyerId = a.atradius_buyer_id
    if (!buyerId) {
      const r = await seguradora.resolverBuyer(a.cnpj)
      if (!r.ok) {
        await registrarFalha(a.id, r.erro)
        continue
      }
      if (!r.dados) {
        await registrarFalha(a.id, 'CNPJ não encontrado como buyer na seguradora.')
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
      await registrarFalha(a.id, pedido.erro)
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

    /*
     * Os documentos vão DEPOIS do pedido, e por E-MAIL (ver `documentos-email.ts`): a API
     * da Atradius não recebe anexo, e foi a própria seguradora que pediu assim.
     *
     * O resultado deles não muda o do envio — a cobertura já foi submetida, e a papelada
     * é aceita depois. Tratar um e-mail que não saiu como falha de envio faria alguém
     * reenviar a análise, e reenviar resolve buyer, que é a chamada paga. Quando o e-mail
     * falha, o motivo fica em cada linha de `analise_docs` e a tela oferece o reenvio só
     * dos documentos.
     */
    const empresaDaAnalise = a.empresas as { razao_social: string | null } | null
    const docs = await enviarDocumentosPorEmail(
      {
        id: a.id,
        cnpj: a.cnpj,
        razao_social: empresaDaAnalise?.razao_social ?? null,
        case_id: pedido.dados.case_id,
        limite_solicitado: a.limite_solicitado === null ? null : Number(a.limite_solicitado),
        moeda: a.moeda,
      },
      docIds ?? [],
    )
    acc.documentos_enviados += docs.enviados

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
  /**
   * O estado ANTES, e os três campos são obrigatórios de propósito.
   *
   * `codigo_decisao` era opcional, e três dos quatro chamadores simplesmente não o
   * mandavam — embora todos o lessem do banco. A comparação virava `null !== 'DC01'`,
   * sempre verdadeira, e toda decisão velha era reescrita como se fosse nova: 16 eventos
   * de aprovada/negada repetidos a cada rodada do sync (duas por dia), um snapshot
   * duplicado por linha por rodada, e o card do funil reprocessado toda vez.
   *
   * Tornar o campo obrigatório é o que impede a repetição: agora é o compilador quem
   * cobra, e não a leitura atenta de quem escrever o próximo chamador.
   */
  anterior: { estagio: string; limite_aprovado: number | null; codigo_decisao: string | null },
  d: DecisaoSeguradora,
): Promise<{ mudou: boolean; reduziu: boolean }> {
  // A VALIDADE NÃO É INVENTADA AQUI. Uma cobertura Atradius viva não tem prazo — ela vale
  // até ser cancelada, e `withdrawalDate`/`effectiveToDate` só aparecem quando já acabou.
  //
  // Antes, este caminho carimbava `hoje + validade_padrao_meses` em toda aprovação sem
  // data, enquanto o insert do backfill gravava null. A mesma cobertura ficava com prazos
  // diferentes conforme qual job a visse primeiro — e a inventada expirava sozinha meses
  // depois, tirando do ar uma cobertura que a seguradora nunca retirou.
  const expira = d.expira_em
  // `codigo_decisao` entra na comparação: sem isso, uma linha cujo código nunca foi
  // gravado (as da primeira carga) jamais receberia o valor, porque estágio e limite já
  // estariam iguais — e o campo que existe para diagnosticar ficaria eternamente nulo.
  //
  // O contrário também vale, e custou caro: um chamador que NÃO informe o código lido do
  // banco faz esta linha comparar null com o código que a seguradora mandou, e daí toda
  // decisão parada parece decisão nova. Por isso o campo é obrigatório na assinatura.
  const mudou =
    anterior.estagio !== d.estagio ||
    Number(anterior.limite_aprovado ?? 0) !== Number(d.limite_aprovado ?? 0) ||
    (anterior.codigo_decisao ?? null) !== (d.codigo_decisao ?? null)
  if (!mudou) return { mudou: false, reduziu: false }

  await supabaseAdmin
    .from('analises_credito')
    .update({
      estagio: d.estagio,
      limite_aprovado: d.limite_aprovado,
      moeda: d.moeda,
      rating_seguradora: d.rating,
      rating_classe_seguradora: d.rating_classe ?? null,
      codigo_decisao: d.codigo_decisao ?? null,
      codigo_historico: d.codigo_historico ?? null,
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
          : null

  if (tipo) {
    /*
     * A decisão avisa o perfil Crédito (ou o Admin, enquanto ele estiver vazio) E quem
     * PEDIU a análise (0248) — as duas pela regra do tipo no motor (0262), a segunda
     * pelo papel `quem_pediu`, que lê `analise_id`. Quem pediu é justamente a pessoa
     * cuja próxima ação depende da resposta.
     *
     * O nome da empresa no título: um push que diz "aprovada" sem dizer de quem obriga
     * a abrir o app para descobrir do que se trata.
     */
    const { data: empresaDaAnalise } = empresaId
      ? await supabaseAdmin.from('empresas').select('razao_social').eq('id', empresaId).maybeSingle()
      : { data: null }
    const nomeOuCnpj = empresaDaAnalise?.razao_social ?? cnpj

    await emitirEvento(empresaId, tipo, {
      titulo:
        d.estagio === 'negada'
          ? `Crédito negado: ${nomeOuCnpj}`
          : d.estagio === 'aprovada_parcial'
            ? `Crédito aprovado em parte: ${nomeOuCnpj}`
            : `Crédito aprovado: ${nomeOuCnpj}`,
      resumo:
        d.limite_aprovado !== null && d.limite_aprovado > 0
          ? `R$ ${Math.round(d.limite_aprovado).toLocaleString('pt-BR')} aprovados pela seguradora${expira ? ` (até ${expira})` : ''}.`
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
  /**
   * Casos que a apólice NÃO conhece pelo número que temos.
   *
   * Não é falha — a consulta funcionou e a resposta foi "não tenho esse cover" — e não
   * muda o estágio de nada. Mas era invisível: a análise ficava parada com cara de "a
   * seguradora ainda não decidiu", e a explicação verdadeira (número errado, cobertura
   * substituída, pedido reaberto no portal com outro número) não aparecia em lugar
   * nenhum. Contado aqui, vira uma linha de log que alguém consegue seguir — e o
   * conserto é informar o número certo pela tela (0247).
   */
  desconhecidas?: number
  erro?: string
}> {
  if (!(await seguradora.configurada())) return { status: 'nao_configurada' }

  const cfg = await lerConfigCredito()
  const { data: abertas } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, estagio, limite_aprovado, codigo_decisao, atradius_case_id')
    .in('estagio', ['enviada_seguradora', 'em_analise'])
    .not('atradius_case_id', 'is', null)

  const acc = { consultadas: 0, decididas: 0, falhas: 0, desconhecidas: 0 }
  const decididos: string[] = []
  const semCobertura: string[] = []
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
    // fica onde está até alguém explicar por quê. O que mudou é que ela não fica CALADA:
    // o número aparece no log, porque "a apólice não conhece o cover 143912539" é uma
    // frase que se investiga, e um card parado sem motivo não é.
    if (!r.dados) {
      acc.desconhecidas++
      semCobertura.push(a.atradius_case_id as string)
      continue
    }

    const { mudou } = await aplicarDecisao(
      a.id,
      a.cnpj,
      a.empresa_id,
      { estagio: a.estagio, limite_aprovado: a.limite_aprovado, codigo_decisao: a.codigo_decisao },
      r.dados,
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
  if (acc.desconhecidas > 0) {
    logger.warn(
      { casos: semCobertura },
      'A apólice não conhece estes covers. O número pode estar errado ou a cobertura ter sido reaberta com outro — vincule o certo na análise.',
    )
  }
  if (acc.falhas > 0) logger.warn(acc, 'Poll de decisões concluído com falhas.')
  else logger.info(acc, 'Poll de decisões concluído.')
  return { status: 'ok', ...acc }
}

// ─── O pedido aberto por fora encontra o card parado (0247) ─────────────────

/**
 * Adota, para o card que está parado, a cobertura que a apólice passou a ter.
 *
 * ── O CASO ──────────────────────────────────────────────────────────────────
 * O CNPJ não estava cadastrado como buyer, não há cadastro por API, e o analista abriu o
 * pedido direto no portal da Atradius. O card foi marcado como "enviada à mão" (0216) e
 * ficou sem `atradius_case_id` — que é exatamente por onde o poll pergunta e por onde o
 * sync casa. Resultado: a seguradora decidia, a decisão existia no portal, e o card ficava
 * parado para sempre. Em 22/09/2026 havia três assim, dois deles (HITACHI ENERGY e
 * NEOBETEL) já concluídos do lado de lá.
 *
 * Este job é a ponte que faltava, e ela é por CNPJ: quando uma cobertura daquele CNPJ
 * aparece na apólice sem dono aqui dentro, ela vira o `atradius_case_id` do card parado —
 * e a partir daí o poll cuida dele sozinho, como cuida de qualquer análise enviada pela
 * API.
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
 * **Não inventa buyer.** `resolverBuyer` (que pode ser cobrado) não é chamado aqui: as duas
 * leituras são as mesmas do backfill, e leem o que a apólice JÁ tem.
 *
 * **Não escolhe entre duas.** Ambiguidade — dois cards abertos do mesmo CNPJ, ou duas
 * coberturas livres — não vira escrita: vira evento para uma pessoa resolver pela tela,
 * vinculando o número do cover à mão. `casarPedidosComCoberturas` (core, testado) é quem
 * decide isso, e é lá que a regra está escrita.
 *
 * **Não roda fora de produção.** Aqui está a diferença para o sync e o poll, que são
 * inofensivos em homologação porque casam por `atradius_case_id` — um número que a própria
 * sandbox gerou. CNPJ é o mesmo nos dois ambientes: um buyer de mentira com CNPJ de
 * verdade daria a um card real o limite aprovado de um teste.
 */
export async function adotarPedidosAbertos(): Promise<{
  status: 'ok' | 'nao_configurada' | 'fora_de_producao' | 'erro'
  /** Cards parados sem número de cover — o universo que este job tenta resolver. */
  candidatas?: number
  vinculadas?: number
  /** Dos vinculados, quantos já vieram com desfecho e andaram na esteira. */
  decididas?: number
  ambiguas?: number
  erro?: string
}> {
  if (!(await seguradora.configurada())) return { status: 'nao_configurada' }

  /*
   * Os candidatos vêm ANTES de qualquer chamada. Sem card parado não há nada a casar, e
   * duas listagens por rodada de sync para não fazer nada é tráfego que só aparece na
   * conta de alguém.
   *
   * O filtro é `atradius_case_id is null` porque é isso que torna o casamento possível —
   * não é inferência sobre como a análise chegou aqui. `envio_manual_em` vai junto para o
   * log: ele diz se o pedido tinha nome e hora (0216) ou se chegou a "enviada" por algum
   * caminho que ninguém previu, o que é novidade digna de investigação.
   */
  const { data: abertas } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, estagio, limite_aprovado, codigo_decisao, envio_manual_em')
    .in('estagio', ['enviada_seguradora', 'em_analise'])
    .is('atradius_case_id', null)

  const candidatas = abertas?.length ?? 0
  if (!candidatas) return { status: 'ok', candidatas: 0, vinculadas: 0, decididas: 0, ambiguas: 0 }

  const { ambiente } = await lerIntegracaoSeguradora()
  if (ambiente !== 'producao') {
    logger.warn(
      { ambiente, candidatas },
      'Adoção de pedidos abertos não roda fora de produção: ela casa por CNPJ, que é o mesmo nos dois ambientes.',
    )
    return { status: 'fora_de_producao', candidatas }
  }

  /*
   * Sem janela de data, e é de propósito. O sync recorta 30 dias porque ele varre a
   * apólice inteira todo dia; aqui a pergunta é outra — "existe cobertura para ESTE CNPJ,
   * que ninguém reclamou?" — e um card pode estar parado há dois meses justamente porque
   * nunca ninguém o viu. Recortar por data deixaria de fora o caso que motivou o job.
   *
   * Portfólio primeiro e decisões por cima: mesma ordem de `mapaDeCoberturas`, porque a
   * decisão é a informação mais nova e a leitura inversa adotaria um "em análise" para
   * uma cobertura que já tem desfecho.
   */
  const coberturas: DecisaoSeguradora[] = []
  const portfolio = await seguradora.listarPortfolio()
  if (!portfolio.ok) {
    logger.error({ erro: portfolio.erro, candidatas }, 'Adoção de pedidos abertos FALHOU.')
    return { status: 'erro', erro: portfolio.erro, candidatas }
  }
  coberturas.push(...portfolio.dados.itens)
  const decisoes = await seguradora.listarDecisoes()
  if (!decisoes.ok) {
    logger.error({ erro: decisoes.erro, candidatas }, 'Adoção de pedidos abertos FALHOU.')
    return { status: 'erro', erro: decisoes.erro, candidatas }
  }
  coberturas.push(...decisoes.dados.itens)

  // Quem já tem dono não é adotado de novo — é o que impede o histórico que o backfill
  // importou de ser recolhido por um pedido novo do mesmo CNPJ.
  const { data: comCase } = await supabaseAdmin
    .from('analises_credito')
    .select('atradius_case_id')
    .not('atradius_case_id', 'is', null)

  const { vinculos, ambiguos } = casarPedidosComCoberturas(
    (abertas ?? []).map((a) => ({ analise_id: a.id, cnpj: a.cnpj })),
    coberturas,
    (comCase ?? []).map((c) => c.atradius_case_id as string),
  )

  const porId = new Map((abertas ?? []).map((a) => [a.id, a]))
  const acc = { candidatas, vinculadas: 0, decididas: 0, ambiguas: 0 }
  const decididos: string[] = []

  for (const v of vinculos) {
    const a = porId.get(v.analise_id)
    if (!a) continue

    await supabaseAdmin
      .from('analises_credito')
      .update({
        atradius_case_id: v.cobertura.case_id,
        atradius_buyer_id: v.cobertura.buyer_id,
        rating_seguradora: v.cobertura.rating,
        atualizada_em: new Date().toISOString(),
      })
      .eq('id', a.id)

    /*
     * O vínculo é evento próprio, ANTES do desfecho, e não um detalhe dentro de
     * "aprovada". Quem marcou "enviei à mão" é a única pessoa que sabe qual pedido abriu
     * no portal — e é ela que precisa poder conferir que o sistema casou com o certo. Sem
     * esta linha, um limite aprovado apareceria no card sem nada explicando de onde veio.
     */
    await emitirEventoAnalise(
      a.id,
      EVENTO_TIPOS.ANALISE_PEDIDO_VINCULADO,
      'Pedido da seguradora vinculado ao card',
      `Cobertura ${v.cobertura.case_id} da ${seguradora.nome}, casada pelo CNPJ. ` +
        'A partir de agora o acompanhamento automático cuida desta análise.',
    )
    acc.vinculadas++

    const { mudou } = await aplicarDecisao(
      a.id,
      a.cnpj,
      a.empresa_id,
      { estagio: a.estagio, limite_aprovado: a.limite_aprovado, codigo_decisao: a.codigo_decisao },
      v.cobertura,
    )
    if (mudou) {
      acc.decididas++
      decididos.push(a.cnpj)
    }
  }

  /*
   * O aviso de ambiguidade sai UMA VEZ por análise, nunca a cada rodada.
   *
   * Ele descreve um estado que dura até alguém agir, e o sync roda duas vezes por dia:
   * reemitir transformaria o sino no lugar que ninguém olha — a mesma razão pela qual a
   * sugestão de reanálise também só sai uma vez.
   */
  if (ambiguos.length) {
    const { data: avisados } = await supabaseAdmin
      .from('empresa_eventos')
      .select('payload')
      .eq('tipo', EVENTO_TIPOS.ANALISE_VINCULO_AMBIGUO)
    const jaAvisados = new Set(
      (avisados ?? [])
        .map((e) => (e.payload as { analise_id?: string } | null)?.analise_id)
        .filter((id): id is string => !!id),
    )

    for (const amb of ambiguos) {
      for (const analiseId of amb.analise_ids) {
        if (jaAvisados.has(analiseId)) continue
        const a = porId.get(analiseId)
        if (!a) continue
        acc.ambiguas++
        await emitirEvento(a.empresa_id, EVENTO_TIPOS.ANALISE_VINCULO_AMBIGUO, {
          titulo: 'Cobertura na seguradora sem vínculo certo',
          resumo:
            amb.motivo === 'mais_de_um_pedido'
              ? `Há mais de uma análise aberta deste CNPJ sem número de cover, e ${amb.case_ids.length} cobertura(s) livre(s) na apólice (${amb.case_ids.join(', ')}). Vincule o número do cover na análise certa.`
              : `A apólice tem ${amb.case_ids.length} coberturas livres para este CNPJ (${amb.case_ids.join(', ')}). Vincule à mão a que corresponde a este pedido.`,
          url: `/credito/analises/${analiseId}`,
          cnpj: a.cnpj,
          analise_id: analiseId,
          motivo: amb.motivo,
          case_ids: amb.case_ids,
        })
      }
    }
  }

  // Mesma razão do poll: a decisão mexe no histórico e no knockout de negada, e sem
  // repontuar a empresa ficaria com a faixa antiga até a virada do mês.
  await recalcularScoresDeCnpjs(decididos)

  // `sem_envio_manual` é para ser sempre zero: hoje o único caminho que leva uma análise
  // a "enviada" sem case id é a porta da 0216, que grava quem afirmou. Um número aqui
  // significa que apareceu outro caminho — e é melhor descobrir isso pelo log do que
  // pela ausência de um registro que alguém foi procurar.
  const semEnvioManual = (abertas ?? []).filter((a) => !a.envio_manual_em).length
  logger.info({ ...acc, sem_envio_manual: semEnvioManual }, 'Adoção de pedidos abertos concluída.')
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
export async function backfillAtradius(opcoes: { simular?: boolean } = {}): Promise<{
  status: 'ok' | 'nao_configurada' | 'erro'
  simulado?: boolean
  lidos?: number
  inseridos?: number
  atualizados?: number
  sem_cnpj?: number
  sem_empresa?: number
  amostra?: unknown[]
  erro?: string
}> {
  const simular = opcoes.simular === true
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
  // A simulação passa em qualquer ambiente: ela não escreve, e é justamente em homologação
  // que se quer ensaiar o backfill antes de deixá-lo tocar o banco real.
  if (!simular && ambiente !== 'producao') {
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

  /*
   * A ADOÇÃO VEM ANTES DA INSERÇÃO, e é o que impede o backfill de criar um card
   * duplicado para um pedido que já tem card aqui.
   *
   * Sem isto, uma cobertura aberta no portal para um CNPJ que está parado na esteira não
   * encontra dono por `atradius_case_id` e vira linha nova com origem `atradius_backfill`
   * — uma segunda análise do mesmo CNPJ, com o desfecho, enquanto a original continua
   * parada na coluna "enviada à seguradora". Duas linhas para um pedido só, e a que anda
   * é a que ninguém pediu.
   *
   * Fora da simulação, que não escreve nada por definição — e adotar é escrever.
   */
  if (!simular) {
    const adocao = await adotarPedidosAbertos()
    logger.info({ adocao }, 'Adoção de pedidos abertos, antes do backfill.')
  }

  const cfg = await lerConfigCredito()
  const acc = { lidos: 0, inseridos: 0, atualizados: 0, sem_cnpj: 0, sem_empresa: 0 }
  // Poucas linhas, e sem valor de limite: a amostra existe para conferir MAPEAMENTO
  // (o CNPJ saiu? o estágio bate com o que a apólice mostra?), não para relatar carteira.
  const amostra: unknown[] = []
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
          .select('id, estagio, limite_aprovado, codigo_decisao')
          .eq('atradius_case_id', d.case_id)
          .maybeSingle()

        if (!empresa) acc.sem_empresa++

        if (simular) {
          // Contabiliza o que ACONTECERIA e não toca em nada. É o ensaio: exercita
          // autenticação, listagem, resolução de CNPJ e mapeamento — tudo que pode estar
          // errado — parando exatamente antes da única linha irreversível.
          if (existente) acc.atualizados++
          else acc.inseridos++
          if (amostra.length < 5) {
            amostra.push({
              cnpj,
              case_id: d.case_id,
              estagio: d.estagio,
              moeda: d.moeda,
              tem_empresa: !!empresa,
              acao: existente ? 'atualizaria' : 'inseriria',
            })
          }
          continue
        }

        if (existente) {
          const { mudou } = await aplicarDecisao(
            existente.id,
            cnpj,
            empresa?.id ?? null,
            { estagio: existente.estagio, limite_aprovado: existente.limite_aprovado, codigo_decisao: existente.codigo_decisao },
            d,
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
          rating_classe_seguradora: d.rating_classe ?? null,
          codigo_decisao: d.codigo_decisao ?? null,
          codigo_historico: d.codigo_historico ?? null,
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
    logger.error({ ...acc, simulado: simular, erro: falha }, 'Backfill da Atradius FALHOU.')
    return { status: 'erro', simulado: simular, erro: falha, ...acc }
  }

  if (simular) {
    // Nem repontuação: o scorecard leria um histórico que não existe.
    logger.info({ ...acc, amostra }, 'Backfill SIMULADO — nada foi gravado.')
    return { status: 'ok', simulado: true, amostra, ...acc }
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
        .select('id, cnpj, empresa_id, estagio, limite_aprovado, codigo_decisao')
        .eq('atradius_case_id', d.case_id)
        .maybeSingle()
      if (!existente) continue // buyer que não passou por aqui: backfill resolve, sync não descobre

      const { mudou } = await aplicarDecisao(
        existente.id,
        existente.cnpj,
        existente.empresa_id,
        { estagio: existente.estagio, limite_aprovado: existente.limite_aprovado, codigo_decisao: existente.codigo_decisao },
        d,
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
 * Repara nas aprovações cuja validade passou. Roda mesmo sem seguradora configurada:
 * a data de validade é NOSSA, e uma aprovação vencida contando como vigente no
 * scorecard valeria pontos que ela não tem mais.
 *
 * ── O QUE ELA NÃO FAZ MAIS: MUDAR O ESTÁGIO ───────────────────────────────
 * Havia um estágio `expirada`, e ele apagava o desfecho: depois de expirar, ninguém
 * mais sabia se aquilo tinha sido aprovado ou aprovado parcial. O vencimento já está
 * dito por `expira_em` no passado — uma data não precisa de uma coluna para ser lida.
 *
 * `expirada_em` existe só para esta rotina ser idempotente: sem ele, a varredura diária
 * reencontraria as mesmas linhas para sempre e reemitiria o mesmo evento todo dia.
 */
export async function expirarAnalises(): Promise<{ expiradas: number }> {
  const hoje = new Date().toISOString().slice(0, 10)
  const { data: vencidas } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, expira_em')
    .in('estagio', ['aprovada', 'aprovada_parcial'])
    .not('expira_em', 'is', null)
    .lt('expira_em', hoje)
    .is('expirada_em', null)
    // Uma cobertura que já foi substituída não tem o que expirar: quem vale é a
    // decisão que tomou o lugar dela (0208), e o evento diria à empresa que perdeu
    // algo que ela não tem mais desde a reanálise.
    .is('substituida_em', null)

  for (const a of vencidas ?? []) {
    await supabaseAdmin
      .from('analises_credito')
      .update({ expirada_em: new Date().toISOString(), atualizada_em: new Date().toISOString() })
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
  // cobertura que acabou ontem. O scorecard olha a DATA, não o estágio — por isso ele
  // continua acertando depois de o estágio ter deixado de mudar.
  await recalcularScoresDeCnpjs((vencidas ?? []).map((a) => a.cnpj))

  const expiradas = (vencidas ?? []).length
  if (expiradas > 0) logger.info({ expiradas }, 'Aprovações vencidas marcadas.')
  return { expiradas }
}
