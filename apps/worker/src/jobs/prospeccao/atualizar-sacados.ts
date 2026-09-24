import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { tipoDeEmpresaPorCnae } from '../../../../../packages/core/src/leads/roteamento.js'
import {
  agregarSacado,
  entraNaProspeccao,
  margemEstimada,
  prazoMinimoOperavel,
  valorEsperadoMensal,
  type MetricasSacado,
  type NotaDoSacado,
} from '../../../../../packages/core/src/prospeccao/index.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { avisar, emitirEvento } from '../../radar/eventos.js'
import {
  lerChanceSemScore,
  lerCorteVolume,
  lerEconomiaCredito,
  lerExigirContratante,
  lerJanelas,
  lerLimiarNotificacao,
  lerMaxCardsPorOriginador,
  lerParametrosPrazo,
} from './config.js'

/**
 * Alimentação do funil de Sacados por NF (04r §4). Roda depois de cada sync de NF.
 *
 * ─── AS NOTAS VÊM CRUAS, E A CONTA MORA NO CORE ──────────────────────────────
 *
 * Ao contrário do irmão (04l), este job NÃO agrega em SQL. São 7.550 notas na janela de
 * seis meses — nada que justifique reimplementar em Postgres uma regra que já existe
 * testada no core (`agregarSacado`). E aqui a duplicação seria cara: o total do card e a
 * quebra por fornecedor saem da MESMA passada, e duas implementações eventualmente
 * diriam números diferentes para "R$ 740 mil" e "400 + 250 + 90".
 *
 * O que o SQL faz é o recorte — quais notas sequer entram —, que é onde ele ganha: o
 * `join` com `fornecedores_seguidos` é o que traduz "cedente que ELE segue" em linhas.
 *
 * ─── AS MÉTRICAS SÃO RECALCULADAS; O ESTADO NÃO ──────────────────────────────
 *
 * Volume, operável, recorrência e valor esperado se sobrescrevem toda rodada. Estágio,
 * dono manual e vínculo com a esteira são estado humano e nunca são tocados aqui — as
 * únicas exceções são a saída automática por cadastro, que é fato observado, e a
 * derivação do dono para quem ainda não tem, que é a ausência de uma decisão.
 */

interface LinhaNota {
  sacado_cnpj: string
  sacado_nome: string | null
  sacado_cnae: string | null
  sacado_empresa_id: string | null
  tem_cadastral: boolean
  fornecedor_cnpj: string
  fornecedor_nome: string | null
  fornecedor_empresa_id: string | null
  valor: string | number
  emitida_em: string | null
  vencimento: string | null
  dias_para_vencimento: number | null
}

/**
 * O recorte do §2 e do §4, numa consulta.
 *
 * `fornecedores_seguidos` entra como EXISTS e não como join: um cedente seguido por três
 * originadores multiplicaria cada nota dele por três, e o volume do card sairia
 * triplicado. Quem segue o quê é lido à parte, para decidir o DONO — que é outra
 * pergunta.
 *
 * A janela é a de RECORRÊNCIA (seis meses civis), não a de emissão: a de 30 dias é um
 * recorte DENTRO desta, feito no core. Duas consultas para as duas janelas leriam as
 * mesmas notas duas vezes.
 *
 * AS DUAS DATAS SAEM COMO `::text`, e isto não é enfeite. O `pg` converte `date` em
 * `Date` do JavaScript, e o core trata emissão e vencimento como `'YYYY-MM-DD'` — ele
 * fatia com `.slice(0, 10)`. Sem o cast, a primeira nota da primeira rodada estoura
 * `n.emitida_em?.slice is not a function`, o try/catch do sync engole o erro e o funil
 * fica VAZIO para todo mundo, sem que nada apareça como falha.
 *
 * O QUE ESCONDEU O DEFEITO POR UM DIA: enquanto `fornecedores_seguidos` estava vazia, o
 * EXISTS acima não devolvia nota nenhuma, o laço não rodava e as três primeiras rodadas
 * terminaram `candidatos: 0` — indistinguíveis de "ninguém segue ninguém ainda". O
 * espelho da titularidade encheu a tabela em 21/09/2026 04:40 e as quatro rodadas
 * seguintes estouraram, todas. Um job cujo caminho quente só é exercitado quando outra
 * tabela tem linhas precisa ser lido no ledger, não no status verde do sync.
 */
const SQL_NOTAS = `
select
  nf.sacado_cnpj,
  coalesce(mu.razao_social, nf.sacado_nome) as sacado_nome,
  coalesce(e.cnae_principal, mu.cnae_principal) as sacado_cnae,
  coalesce(e.id, mu.empresa_id) as sacado_empresa_id,
  (mu.cnpj is not null) as tem_cadastral,
  nf.fornecedor_cnpj,
  nf.fornecedor_nome,
  nf.fornecedor_empresa_id,
  nf.valor,
  nf.emitida_em::date::text as emitida_em,
  nf.vencimento::text as vencimento,
  nf.dias_para_vencimento
from public.notas_fiscais nf
  left join public.mercado_universo mu on mu.cnpj = nf.sacado_cnpj
  left join public.empresas e on e.cnpj = nf.sacado_cnpj
where nf.fornecedor_cadastrado is true
  and nf.sacado_cadastrado is not true
  and nf.emitida_em >= date_trunc('month', now()) - make_interval(months => $1::int - 1)
  and exists (
    select 1 from public.fornecedores_seguidos fs
    where fs.fornecedor_cnpj = nf.fornecedor_cnpj and fs.ate is null
  )`

/** Quem segue cada cedente, hoje. É daqui que sai o DONO do card. */
const SQL_SEGUIDORES = `
select fs.fornecedor_cnpj, fs.originador_id
from public.fornecedores_seguidos fs
  join public.vendedores v on v.id = fs.originador_id and v.ativo
where fs.ate is null
group by fs.fornecedor_cnpj, fs.originador_id`

/**
 * O TEMPO DE ESTEIRA, medido (04d).
 *
 * Mesma régua do report semanal: só o que foi decidido e só o que não veio do backfill
 * da apólice com a decisão datada de antes do registro (`decidida_em >= criada_em`). A
 * média sobre a base inteira dava −152 dias.
 *
 * `n` volta junto porque é ele que decide se o número é usável: com 7 análises, a
 * mediana é de horas, e usá-la marcaria como operável toda nota que vence amanhã.
 */
const SQL_ESTEIRA = `
select
  round(avg(extract(epoch from (ac.decidida_em - ac.criada_em)) / 86400)::numeric)::int as dias,
  count(*)::int as n
from public.analises_credito ac
where ac.decidida_em is not null
  and ac.decidida_em >= ac.criada_em
  and ac.decidida_em >= now() - interval '365 days'`

export interface ResultadoAtualizarSacados {
  candidatos: number
  entraram: number
  atualizados: number
  aprovados: number
  prazo_minimo_dias: number
  prazo_minimo_origem: 'medido' | 'configurado'
}

export async function atualizarSacadosProspeccao(): Promise<ResultadoAtualizarSacados> {
  const [janelas, corte, prazoCfg, exigirContratante, maxCards, economia, chanceSemScore, limiar] =
    await Promise.all([
      lerJanelas(),
      lerCorteVolume(),
      lerParametrosPrazo(),
      lerExigirContratante(),
      lerMaxCardsPorOriginador(),
      lerEconomiaCredito(),
      lerChanceSemScore(),
      lerLimiarNotificacao(),
    ])

  const { rows: esteira } = await pool.query<{ dias: number | null; n: number }>(SQL_ESTEIRA)
  const prazoMinimo = prazoMinimoOperavel(
    { dias: esteira[0]?.dias ?? null, base: esteira[0]?.n ?? 0 },
    prazoCfg,
  )
  const margem = margemEstimada(economia)

  const [{ rows: notas }, { rows: seguidores }] = await Promise.all([
    pool.query<LinhaNota>(SQL_NOTAS, [janelas.janela_recorrencia_meses]),
    pool.query<{ fornecedor_cnpj: string; originador_id: string }>(SQL_SEGUIDORES),
  ])

  // Quem segue cada cedente. Um cedente pode ter vários seguidores; o desempate é o
  // volume contra ESTE sacado, logo abaixo.
  const seguidoresPorCnpj = new Map<string, string[]>()
  for (const s of seguidores) {
    const lista = seguidoresPorCnpj.get(s.fornecedor_cnpj) ?? []
    lista.push(s.originador_id)
    seguidoresPorCnpj.set(s.fornecedor_cnpj, lista)
  }

  interface Candidato {
    cnpj: string
    nome: string | null
    cnae: string | null
    empresaId: string | null
    temCadastral: boolean
    notas: (NotaDoSacado & { fornecedor_empresa_id: string | null })[]
  }
  const porSacado = new Map<string, Candidato>()
  for (const n of notas) {
    const c =
      porSacado.get(n.sacado_cnpj) ??
      ({
        cnpj: n.sacado_cnpj,
        nome: n.sacado_nome,
        cnae: n.sacado_cnae,
        empresaId: n.sacado_empresa_id,
        temCadastral: n.tem_cadastral,
        notas: [],
      } satisfies Candidato)
    if (!c.nome && n.sacado_nome) c.nome = n.sacado_nome
    if (!c.cnae && n.sacado_cnae) c.cnae = n.sacado_cnae
    if (!c.empresaId && n.sacado_empresa_id) c.empresaId = n.sacado_empresa_id
    c.notas.push({
      fornecedor_cnpj: n.fornecedor_cnpj,
      fornecedor_nome: n.fornecedor_nome,
      fornecedor_empresa_id: n.fornecedor_empresa_id,
      valor: Number(n.valor) || 0,
      emitida_em: n.emitida_em,
      vencimento: n.vencimento,
      dias_para_vencimento: n.dias_para_vencimento,
    })
    porSacado.set(n.sacado_cnpj, c)
  }

  // ── O estado que já existe ────────────────────────────────────────────────
  const { data: existentes, error: erroLer } = await supabaseAdmin
    .from('sacados_prospeccao')
    .select('id, cnpj_sacado, estagio, originador_id, originador_origem, empresa_id')
  if (erroLer) throw new Error(`Falha ao ler o funil de sacados: ${erroLer.message}`)
  const porCnpjExistente = new Map((existentes ?? []).map((s) => [s.cnpj_sacado, s]))

  /*
   * A qualificação automática (§4) é de GRAÇA: score, chance e faturamento já foram
   * calculados pelo 04c/04d e moram em `empresas`. Protestos NÃO entram aqui — custam,
   * e ficam sob demanda no botão "Enriquecer".
   */
  const cnpjsInteressantes = [...porSacado.keys()]
  const qualificacao = new Map<
    string,
    {
      id: string
      score: number | null
      completude: number | null
      chance: number | null
      faturamento: number | null
      limite: number | null
      tipo: string | null
    }
  >()
  for (let i = 0; i < cnpjsInteressantes.length; i += 500) {
    const fatia = cnpjsInteressantes.slice(i, i + 500)
    const { data } = await supabaseAdmin
      .from('empresas')
      .select(
        'id, cnpj, tipo, score_credito, score_completude, chance_concessao, faturamento_anual, limite_potencial',
      )
      .in('cnpj', fatia)
    for (const e of data ?? []) {
      qualificacao.set(e.cnpj, {
        id: e.id,
        score: e.score_credito,
        completude: e.score_completude,
        chance: e.chance_concessao,
        faturamento: e.faturamento_anual,
        limite: e.limite_potencial,
        tipo: e.tipo,
      })
    }
  }

  interface Preparado {
    cand: Candidato
    m: MetricasSacado
    originadorId: string | null
    valorEsperado: number
  }
  const preparados: Preparado[] = []
  const semCadastral: string[] = []
  let candidatos = 0

  for (const cand of porSacado.values()) {
    /*
     * O recorte por CNAE, herdado da aba que esta substitui.
     *
     * Sem ele a lista vira "todo CNPJ que já apareceu como destinatário" — posto de
     * gasolina, papelaria, o contador do fornecedor. Medido em 20/09/2026: dos 243
     * sacados acima do corte, 114 contratam obra.
     *
     * CNAE AUSENTE NÃO É RECUSA: são 2 dos 243, e eles entram na fila de lookup em vez
     * de sumirem em silêncio. Recusar por falta de dado seria transformar uma janela de
     * espera numa decisão.
     */
    if (!cand.temCadastral || !cand.cnae) semCadastral.push(cand.cnpj)
    if (exigirContratante && cand.cnae) {
      const tipo = tipoDeEmpresaPorCnae(cand.cnae)
      if (tipo !== 'construtora' && tipo !== 'incorporadora') continue
    }

    const m = agregarSacado(cand.notas, {
      janelaEmissaoDias: janelas.janela_emissao_dias,
      janelaRecorrenciaMeses: janelas.janela_recorrencia_meses,
      prazoMinimoOperavel: prazoMinimo.dias,
    })
    if (!entraNaProspeccao(m, corte)) continue
    candidatos += 1

    /*
     * O DONO sai do cedente de maior volume CONTRA ESTE SACADO, entre quem o segue.
     *
     * Mesmo desempate do 04l, e pelo mesmo motivo: quem trabalha o fornecedor que fatura
     * R$ 400 mil contra aquela construtora tem mais o que dizer numa ligação do que quem
     * trabalha o de R$ 30 mil. Empate entre dois seguidores do mesmo cedente cai no
     * primeiro, e o gestor reatribui — é decisão de distribuição, não de cálculo.
     */
    let originadorId: string | null = null
    for (const f of m.fornecedores) {
      const donos = seguidoresPorCnpj.get(f.fornecedor_cnpj)
      if (donos?.length) {
        originadorId = donos[0]!
        break
      }
    }

    const q = qualificacao.get(cand.cnpj)
    preparados.push({
      cand,
      m,
      originadorId,
      valorEsperado: valorEsperadoMensal(
        m.media_mensal_6m,
        q?.chance ?? chanceSemScore,
        margem,
      ),
    })
  }

  /*
   * O TETO POR ORIGINADOR (§8), aplicado só a QUEM AINDA NÃO ESTÁ no funil.
   *
   * Cortar cards que já existem apagaria estágio, dono e análise em curso por causa de
   * um ranking que muda toda rodada — e um card sumindo do kanban no meio de uma
   * negociação é a pior forma possível de dizer "prioriza outra coisa".
   */
  preparados.sort((a, b) => b.valorEsperado - a.valorEsperado)
  const jaNoFunilPorOriginador = new Map<string, number>()
  for (const s of existentes ?? []) {
    if (!s.originador_id) continue
    if (!['identificado', 'fornecedor_consultado', 'apresentacao_solicitada'].includes(s.estagio)) continue
    jaNoFunilPorOriginador.set(s.originador_id, (jaNoFunilPorOriginador.get(s.originador_id) ?? 0) + 1)
  }

  const novos: Preparado[] = []
  const atualizar: Preparado[] = []
  for (const p of preparados) {
    const existente = porCnpjExistente.get(p.cand.cnpj)
    if (existente) {
      atualizar.push(p)
      continue
    }
    if (p.originadorId) {
      const n = jaNoFunilPorOriginador.get(p.originadorId) ?? 0
      if (n >= maxCards) continue
      jaNoFunilPorOriginador.set(p.originadorId, n + 1)
    }
    novos.push(p)
  }

  /*
   * A FICHA da empresa, e o SINAL DE MERCADO (§4).
   *
   * `grafo_sefaz` é gravado no UNIVERSO, não só em `empresas`: é `mercado_universo` que
   * as regras da pirâmide (02) leem para promover, e marcar apenas a ficha deixaria a
   * promoção automática cega justamente para os CNPJs que acabamos de descobrir. A
   * denormalização para `empresas` acompanha, porque é dela que a tela lê.
   *
   * O tipo vem do CNAE pela régua do TypeScript — a 0195 derrubou a cópia em SQL de
   * propósito. `app_promover_empresa` só aceita 'construtora'/'fornecedor', então uma
   * incorporadora é promovida como construtora e corrigida logo em seguida: abrir o
   * CHECK daquele RPC mexeria num caminho que quatro outros módulos usam.
   */
  const empresaPorCnpj = new Map<string, string>()
  for (const p of [...novos, ...atualizar]) {
    const q = qualificacao.get(p.cand.cnpj)
    if (q?.id) {
      empresaPorCnpj.set(p.cand.cnpj, q.id)
      continue
    }
    if (!p.cand.temCadastral) continue
    const tipo = tipoDeEmpresaPorCnae(p.cand.cnae)
    const { data: empresa, error } = await supabaseAdmin.rpc('app_promover_empresa', {
      p: { cnpj: p.cand.cnpj, tipo: 'construtora', origem: 'prospeccao_fluxo' } as never,
    })
    if (error || !empresa) {
      logger.warn({ cnpj: p.cand.cnpj, erro: error?.message }, 'Não foi possível criar a ficha do sacado.')
      continue
    }
    const linha = empresa as unknown as { id: string }
    empresaPorCnpj.set(p.cand.cnpj, linha.id)
    if (tipo === 'incorporadora') {
      await supabaseAdmin.from('empresas').update({ tipo }).eq('id', linha.id)
    }
  }

  const cnpjsDoFunil = [...new Set([...novos, ...atualizar].map((p) => p.cand.cnpj))]
  for (let i = 0; i < cnpjsDoFunil.length; i += 500) {
    const fatia = cnpjsDoFunil.slice(i, i + 500)
    await supabaseAdmin.from('mercado_universo').update({ grafo_sefaz: true }).in('cnpj', fatia)
    await supabaseAdmin.from('empresas').update({ grafo_sefaz: true }).in('cnpj', fatia)
  }

  /*
   * A FILA DE LOOKUP para quem não tem cadastral.
   *
   * Sem isto o sacado sem CNAE ficaria de fora para sempre e ninguém saberia por quê —
   * e o recorte por CNAE, que é o que torna a lista útil, viraria um buraco silencioso.
   *
   * `motivo` reusa `sacado_nf`, que é literalmente o que este caso é. O CHECK vivo da
   * fila aceita só três valores (fornecedor_nf, sacado_nf, manual) — um `prospeccao_*`
   * exigiria migração para dizer a mesma coisa com outra palavra.
   */
  if (semCadastral.length > 0) {
    await supabaseAdmin.from('cnpj_lookup_fila').upsert(
      semCadastral.map((cnpj) => ({ cnpj, motivo: 'sacado_nf' })) as never,
      { onConflict: 'cnpj', ignoreDuplicates: true },
    )
  }

  // ── Grava ─────────────────────────────────────────────────────────────────
  function camposDoCard(p: Preparado): Record<string, unknown> {
    const q = qualificacao.get(p.cand.cnpj)
    return {
      cnpj_sacado: p.cand.cnpj,
      sacado_nome: p.cand.nome,
      empresa_id: empresaPorCnpj.get(p.cand.cnpj) ?? null,
      volume_30d: p.m.volume_30d,
      valor_operavel: p.m.valor_operavel,
      qtd_nfs_30d: p.m.qtd_nfs_30d,
      qtd_fornecedores: p.m.qtd_fornecedores,
      meses_com_emissao_6m: p.m.meses_com_emissao_6m,
      media_mensal_6m: p.m.media_mensal_6m,
      prazo_medio_dias: p.m.prazo_medio_dias,
      ultima_nf_em: p.m.ultima_nf_em,
      prazo_minimo_operavel_dias: prazoMinimo.dias,
      prazo_minimo_origem: prazoMinimo.origem,
      score_credito: q?.score ?? null,
      score_completude: q?.completude ?? null,
      chance_concessao: q?.chance ?? null,
      faturamento_estimado: q?.faturamento ?? null,
      limite_potencial: q?.limite ?? null,
      valor_esperado_mensal: p.valorEsperado,
    }
  }

  /*
   * `estagio` fica FORA do payload de atualização, e `originador_id` também quando o
   * dono é manual. É a cicatriz do 04l: o upsert do PostgREST escreve exatamente as
   * colunas enviadas, e mandar o default faria a rodada devolver ao início todo card
   * que alguém moveu durante o dia.
   */
  const comDonoAutomatico: Record<string, unknown>[] = []
  const semTocarNoDono: Record<string, unknown>[] = []

  for (const p of atualizar) {
    const e = porCnpjExistente.get(p.cand.cnpj)!
    const linha = camposDoCard(p)
    if (e.originador_origem === 'manual') semTocarNoDono.push(linha)
    else comDonoAutomatico.push({ ...linha, originador_id: p.originadorId })
  }
  for (const p of novos) {
    comDonoAutomatico.push({
      ...camposDoCard(p),
      originador_id: p.originadorId,
      originador_origem: 'automatica',
      estagio: 'identificado',
    })
  }

  const LOTE = 500
  async function gravar(linhas: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < linhas.length; i += LOTE) {
      const { error } = await supabaseAdmin
        .from('sacados_prospeccao')
        .upsert(linhas.slice(i, i + LOTE) as never, { onConflict: 'cnpj_sacado' })
      if (error) throw new Error(`Falha ao gravar o funil de sacados: ${error.message}`)
    }
  }
  await gravar(comDonoAutomatico)
  await gravar(semTocarNoDono)

  // ── A quebra por fornecedor ───────────────────────────────────────────────
  const { data: idsAtuais } = await supabaseAdmin
    .from('sacados_prospeccao')
    .select('id, cnpj_sacado, originador_id')
  const cardPorCnpj = new Map((idsAtuais ?? []).map((s) => [s.cnpj_sacado, s]))

  /*
   * "Na carteira do originador" é a titularidade de CEDENTE (04k, papel `originador`) —
   * a mesma fonte que o §2 usa para o seguir automático. É a diferença entre "ligar para
   * um cliente meu" e "pedir um favor a um cliente de outra pessoa", e ela muda o texto
   * da abordagem inteira.
   */
  const { rows: titulares } = await pool.query<{ originador_id: string; fornecedor_cnpj: string }>(
    `select distinct c.vendedor_id as originador_id, e.cnpj as fornecedor_cnpj
       from public.vendedor_carteira c join public.empresas e on e.id = c.empresa_id
      where c.papel = 'originador' and c.ate is null`,
  )
  const carteiraDe = new Map<string, Set<string>>()
  for (const t of titulares) {
    const s = carteiraDe.get(t.originador_id) ?? new Set<string>()
    s.add(t.fornecedor_cnpj)
    carteiraDe.set(t.originador_id, s)
  }

  const quebras: Record<string, unknown>[] = []
  for (const p of [...novos, ...atualizar]) {
    const card = cardPorCnpj.get(p.cand.cnpj)
    if (!card) continue
    const minha = card.originador_id ? (carteiraDe.get(card.originador_id) ?? new Set<string>()) : null
    for (const f of p.m.fornecedores) {
      quebras.push({
        sacado_prospeccao_id: card.id,
        fornecedor_cnpj: f.fornecedor_cnpj,
        fornecedor_nome: f.fornecedor_nome,
        fornecedor_empresa_id:
          p.cand.notas.find((n) => n.fornecedor_cnpj === f.fornecedor_cnpj)?.fornecedor_empresa_id ?? null,
        na_carteira_do_originador: minha ? minha.has(f.fornecedor_cnpj) : false,
        valor_30d: f.valor_30d,
        valor_operavel: f.valor_operavel,
        qtd_nfs_30d: f.qtd_nfs_30d,
        meses_com_emissao_6m: f.meses_com_emissao_6m,
        media_mensal_6m: f.media_mensal_6m,
        ultima_nf_em: f.ultima_nf_em,
      })
    }
  }

  /*
   * A quebra é APAGADA e reescrita por card, e não só atualizada.
   *
   * Um cedente que deixou de ser seguido — ou que parou de emitir na janela — precisa
   * SUMIR da lista. Um upsert puro o deixaria lá com os números da semana passada, e a
   * soma da quebra não bateria com o total do card: o defeito mais caro possível numa
   * tela cuja tese é "olhe de onde vem o volume".
   */
  const idsComQuebra = [...new Set(quebras.map((q) => q.sacado_prospeccao_id as string))]
  for (let i = 0; i < idsComQuebra.length; i += LOTE) {
    await supabaseAdmin
      .from('sacados_prospeccao_fornecedores')
      .delete()
      .in('sacado_prospeccao_id', idsComQuebra.slice(i, i + LOTE))
  }
  for (let i = 0; i < quebras.length; i += LOTE) {
    const { error } = await supabaseAdmin
      .from('sacados_prospeccao_fornecedores')
      .insert(quebras.slice(i, i + LOTE) as never)
    if (error) throw new Error(`Falha ao gravar a quebra por fornecedor: ${error.message}`)
  }

  /*
   * ── SAÍDA AUTOMÁTICA (§4) ────────────────────────────────────────────────
   *
   * O sacado que passou a `sacado_cadastrado = true` no sync virou cliente: as notas
   * dele seguem o fluxo normal do funil de NFs, e este card não tem mais o que fazer.
   *
   * O flag vem do endpoint POR NOTA, então a leitura é no GRUPO — a mesma cicatriz da
   * 0101: uma nota cadastrada decide o CNPJ inteiro.
   *
   * `aprovado` sem passar pela esteira é deliberado: o que o estágio descreve é "este
   * sacado está operável", e ele está. O que NÃO acontece é a carteira do §7 — ela nasce
   * da decisão de crédito, e não houve nenhuma aqui.
   */
  const abertos = (existentes ?? []).filter((s) =>
    ['identificado', 'fornecedor_consultado', 'apresentacao_solicitada', 'analise_solicitada', 'em_analise'].includes(
      s.estagio,
    ),
  )
  let aprovados = 0
  for (let i = 0; i < abertos.length; i += 500) {
    const fatia = abertos.slice(i, i + 500)
    const { data: cadastradas } = await supabaseAdmin
      .from('notas_fiscais')
      .select('sacado_cnpj')
      .in('sacado_cnpj', fatia.map((s) => s.cnpj_sacado))
      .eq('sacado_cadastrado', true)
    const viraramCliente = new Set((cadastradas ?? []).map((n) => n.sacado_cnpj))
    for (const s of fatia) {
      if (!viraramCliente.has(s.cnpj_sacado)) continue
      await supabaseAdmin
        .from('sacados_prospeccao')
        .update({ estagio: 'aprovado', estagio_alterado_em: new Date().toISOString() })
        .eq('id', s.id)
      aprovados += 1
      await emitirEvento(s.empresa_id, EVENTO_TIPOS.SACADO_PROSPECCAO_APROVADO, {
        titulo: 'Sacado descoberto por fluxo virou cliente',
        resumo: `${s.cnpj_sacado} passou a ser sacado cadastrado. As notas dele seguem o funil de NFs.`,
        url: '/antecipacao/sacados-por-nf',
        cnpj_sacado: s.cnpj_sacado,
      })
    }
  }

  // ── Eventos e push dos novos (§9) ─────────────────────────────────────────
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  for (const p of novos) {
    const card = cardPorCnpj.get(p.cand.cnpj)
    await emitirEvento(empresaPorCnpj.get(p.cand.cnpj) ?? null, EVENTO_TIPOS.SACADO_PROSPECCAO_IDENTIFICADO, {
      titulo: 'Sacado identificado por fluxo de notas',
      resumo:
        `${p.cand.nome ?? p.cand.cnpj} recebeu ${brl(p.m.volume_30d)} de ${p.m.qtd_fornecedores} ` +
        `cedente(s) nossos em ${janelas.janela_emissao_dias} dias.`,
      url: '/antecipacao/sacados-por-nf',
      cnpj_sacado: p.cand.cnpj,
      valor_esperado_mensal: p.valorEsperado,
    })

    /*
     * O push é NOMINAL e tem LIMIAR: só o originador dono, e só acima do valor esperado
     * configurado. Avisar todo mundo sobre todo card transformaria o aviso em ruído na
     * primeira semana — e o valor esperado, não o volume, é o corte certo: um pico de R$
     * 2 milhões que a esteira não vai aprovar não é notícia.
     */
    if (!card?.originador_id || p.valorEsperado < limiar) continue
    // Ao originador do card (regra `vendedor_citado`, 0262). O limiar fica aqui porque
    // é regra de negócio sobre o dado, não sobre o aviso.
    await avisar('sacado_prospeccao.novo_relevante', {
      titulo: `Novo sacado: ${p.cand.nome ?? p.cand.cnpj}`,
      resumo:
        `${brl(p.m.volume_30d)} em ${janelas.janela_emissao_dias} dias · ` +
        `${brl(p.m.valor_operavel)} operável · ${p.m.meses_com_emissao_6m} dos últimos ` +
        `${janelas.janela_recorrencia_meses} meses.`,
      url: '/antecipacao/sacados-por-nf',
      vendedor_id: card.originador_id,
      cnpj_sacado: p.cand.cnpj,
      valor_esperado_mensal: p.valorEsperado,
    })
  }

  const r: ResultadoAtualizarSacados = {
    candidatos,
    entraram: novos.length,
    atualizados: atualizar.length,
    aprovados,
    prazo_minimo_dias: prazoMinimo.dias,
    prazo_minimo_origem: prazoMinimo.origem,
  }
  logger.info(r, 'Funil de Sacados por NF atualizado.')
  return r
}
