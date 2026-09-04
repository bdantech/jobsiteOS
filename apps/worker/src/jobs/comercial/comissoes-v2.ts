import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  competenciaSp,
  diaSp,
  estornosDaCessao,
  gestaoNaData,
  lancamentoSdrContaFechada,
  lancamentoSdrReuniao,
  lancamentosDaCessao,
  sugereRevisao,
  valorParametro,
  type CessaoConvertida,
  type CommissionParam,
  type LancamentoOriginal,
  type LancamentoV2,
  type MudancaGestao,
  type Titular,
} from '../../../../../packages/core/src/comercial/comissao-v2.js'
import type { GestaoOperacao } from '../../../../../packages/core/src/comercial/schemas.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'

/**
 * Motor de comissões v2 (04k) — o lado que fala com o banco.
 *
 * Todo o CÁLCULO mora no core e é testado lá. Aqui só se busca o que aconteceu, se
 * resolvem os titulares NA DATA e se grava o que o core decidiu. A separação é o que
 * torna cada caso de borda do §8 um teste de três linhas: as perguntas difíceis —
 * "que parâmetro valia", "qual era a classificação", "quem era titular" — são todas
 * sobre o passado, e um teste é a única forma barata de garantir que a resposta não
 * mude quando o presente muda.
 *
 * LIVE: o lançamento nasce no instante da conversão, não no fechamento do mês. Não é
 * capricho — é a diferença entre o vendedor ver o número subir enquanto trabalha e
 * descobrir no dia 1º quanto ganhou. A idempotência que torna isso seguro é o
 * `unique (papel, origem_tipo, origem_id, vendedor_id)`: reprocessar não paga duas vezes.
 */

// ─── Parâmetros ─────────────────────────────────────────────────────────────

async function carregarParams(): Promise<CommissionParam[]> {
  const { data, error } = await supabaseAdmin
    .from('commission_params')
    .select('id, chave, vendedor_id, valor, unidade, vigente_de, vigente_ate')
  if (error) throw new Error(`Falha ao ler commission_params: ${error.message}`)
  return (data ?? []).map((p) => ({
    id: p.id,
    chave: p.chave,
    vendedor_id: p.vendedor_id,
    valor: Number(p.valor),
    unidade: p.unidade,
    vigente_de: p.vigente_de,
    vigente_ate: p.vigente_ate,
  }))
}

// ─── Titulares na data ──────────────────────────────────────────────────────

/**
 * Quem titularizava esta entidade, neste papel, NA DATA do evento.
 *
 * Intervalo semiaberto `[desde, ate)`: quem assumiu às 10h não recebe pelo que aconteceu
 * às 9h. Sem esse cuidado, uma troca de titularidade no meio do mês faria as duas pessoas
 * reivindicarem a mesma cessão — e as duas teriam razão.
 */
async function titularesNaData(
  empresaId: string | null,
  papel: 'vendedor' | 'originador' | 'sdr',
  quando: string,
): Promise<Titular[]> {
  if (!empresaId) return []
  const { rows } = await pool.query<{ vendedor_id: string; share_pct: string; is_ia: boolean }>(
    `select c.vendedor_id, c.share_pct, v.is_ia
     from vendedor_carteira c
     join vendedores v on v.id = c.vendedor_id
     where c.empresa_id = $1 and c.papel = $2
       and c.desde <= $3::timestamptz
       and (c.ate is null or c.ate > $3::timestamptz)`,
    [empresaId, papel, quando],
  )
  return rows.map((r) => ({
    vendedorId: r.vendedor_id,
    sharePct: Number(r.share_pct),
    isIa: r.is_ia,
  }))
}

async function historicoGestao(empresaId: string | null): Promise<MudancaGestao[]> {
  if (!empresaId) return []
  const { data } = await supabaseAdmin
    .from('gestao_operacao_historico')
    .select('valor_anterior, valor_novo, alterado_em')
    .eq('empresa_id', empresaId)
  return (data ?? []) as MudancaGestao[]
}

// ─── Gravação ───────────────────────────────────────────────────────────────

/**
 * `ignoreDuplicates`, e não "delete e reinsere": reinserir apagaria o status de
 * aprovação já dado, que é a única coisa neste sistema que uma pessoa fez à mão.
 *
 * Competência FECHADA é imutável (§6), e a trava mora aqui porque é aqui que passam os
 * três caminhos que criam linha: o handler live, o backfill e a fila do SDR. Um lançamento
 * que chega tarde para um mês já fechado não é descartado em silêncio — ele sai no log com
 * pessoa, competência e valor, porque a saída certa para ele é um ajuste manual no mês
 * corrente (`app_ajuste_manual_comissao`), e essa é uma decisão de gestor, não de job.
 */
async function gravar(lancamentos: readonly LancamentoV2[]): Promise<number> {
  if (lancamentos.length === 0) return 0

  const { data: fechadas } = await supabaseAdmin
    .from('comissao_competencias')
    .select('competencia')
    .in('competencia', [...new Set(lancamentos.map((l) => l.competencia))])
  const bloqueadas = new Set((fechadas ?? []).map((c) => c.competencia))
  const abertos = lancamentos.filter((l) => !bloqueadas.has(l.competencia))
  for (const l of lancamentos.filter((l) => bloqueadas.has(l.competencia))) {
    logger.warn(
      {
        vendedor: l.vendedor_id,
        papel: l.papel,
        competencia: l.competencia,
        origem: `${l.origem_tipo}:${l.origem_id}`,
        valor: l.valor,
      },
      'Lançamento recusado: a competência dele já foi fechada. Cabe ajuste manual no mês corrente.',
    )
  }
  if (abertos.length === 0) return 0

  const { error, count } = await supabaseAdmin
    .from('comissao_lancamentos_v2')
    .upsert(abertos as never, {
      onConflict: 'papel,origem_tipo,origem_id,vendedor_id',
      ignoreDuplicates: true,
      count: 'exact',
    })
  if (error) throw new Error(`Falha ao gravar lançamentos: ${error.message}`)
  return count ?? abertos.length
}

// ─── Titularidade automática (§4) ───────────────────────────────────────────

async function abrirTitularidade(input: {
  vendedorId: string
  empresaId: string
  papel: 'vendedor' | 'originador' | 'sdr'
  /*
   * O instante do FATO que abriu o vínculo — a conversão, a venda ganha —, não o instante
   * em que o job rodou.
   *
   * Sem isto o vínculo nascia depois do próprio fato que o criou, e `titularesNaData`
   * (`desde <= evento`) não o encontrava: a cessão que deu o cedente ao originador era
   * exatamente a única que nunca o pagava. Pelo relógio não passava de um segundo; para o
   * backfill, de dias — e como ele reprocessa com o mesmo `convertida_em`, o buraco não se
   * fechava nunca.
   */
  desde: string
  motivo: string
}): Promise<boolean> {
  /*
   * `not exists`, e não `on conflict do nothing`.
   *
   * O trigger que valida a soma de `share_pct` é BEFORE, e um BEFORE roda ANTES de o
   * ON CONFLICT decidir que a linha já existe: abrir a titularidade de quem já é titular
   * deixaria de ser um no-op e viraria exceção — que, dentro do laço do job horário,
   * derrubaria o processamento dos aceites seguintes.
   */
  const { rows } = await pool.query<{ id: string }>(
    `insert into vendedor_carteira (vendedor_id, empresa_id, papel, desde, origem)
     select $1::uuid, $2::uuid, $3::text, least($4::timestamptz, now()), 'automatica'
     where not exists (
       select 1 from vendedor_carteira c
       where c.empresa_id = $2::uuid and c.papel = $3::text and c.ate is null
     )
     returning id`,
    [input.vendedorId, input.empresaId, input.papel, input.desde],
  )
  if (rows.length === 0) return false

  await emitirEvento(input.empresaId, EVENTO_TIPOS.TITULARIDADE_ATRIBUIDA, {
    resumo: input.motivo,
    url: '/comercial/comissoes',
    papel: input.papel,
    vendedor_id: input.vendedorId,
    origem: 'automatica',
  })
  return true
}

/**
 * O originador do CEDENTE, quando ele ainda não tem um.
 *
 * A régua do §4 é indireta de propósito: o originador não escolhe cedentes, ele escolhe
 * SACADOS (a carteira de "Vendedores e territórios"). Quem trouxe o sacado leva os
 * cedentes que operam contra ele — que é como a relação de fato nasce.
 */
async function garantirOriginadorDoCedente(
  cedenteEmpresaId: string | null,
  sacadoEmpresaId: string | null,
  quando: string,
): Promise<void> {
  if (!cedenteEmpresaId || !sacadoEmpresaId) return
  const jaTem = await titularesNaData(cedenteEmpresaId, 'originador', quando)
  if (jaTem.length > 0) return

  // A carteira de originação (papel `originacao`) é o espelho de `empresas_escolhidas`,
  // mantido por `app_sincronizar_carteira_originacao`. Ler dela em vez do jsonb evita
  // uma segunda interpretação da mesma escolha.
  const { rows } = await pool.query<{ vendedor_id: string; nome: string }>(
    `select c.vendedor_id, v.nome
     from vendedor_carteira c
     join vendedores v on v.id = c.vendedor_id
     where c.empresa_id = $1 and c.papel = 'originacao' and c.ate is null
       and v.tipo = 'originador' and v.ativo
     limit 1`,
    [sacadoEmpresaId],
  )
  const dono = rows[0]
  if (!dono) return

  await abrirTitularidade({
    vendedorId: dono.vendedor_id,
    empresaId: cedenteEmpresaId,
    papel: 'originador',
    // A titularidade vale desde a CESSÃO que a criou, e é ela mesma a primeira a pagar.
    desde: quando,
    motivo: `${dono.nome} passa a titularizar este cedente: primeira NF convertida contra um sacado da carteira dele.`,
  })
}

// ─── O handler live de `nf.convertida` ──────────────────────────────────────

export interface ResultadoLancamentoCessao {
  antecipacao_id: number
  lancamentos: number
  motivo?: string
}

interface LinhaCessao {
  id_externo: number
  convertida_em: string
  gross_value: string | null
  anticipation_days: number | null
  sacado_cnpj: string | null
  fornecedor_cnpj: string | null
  access_key: string | null
  nf_numero: string | null
  sacado_empresa_id: string | null
  sacado_nome: string | null
  sacado_gestao: string | null
  sacado_marco: string | null
  cedente_empresa_id: string | null
  cedente_nome: string | null
}

/**
 * Uma cessão convertida virou dinheiro de alguém. Chamado pelo sync (04e), na hora.
 *
 * O SACADO aqui é a CONTA, não o CNPJ da nota: numa construtora fatura-se contra a SPE, e
 * a comissão é da holding que a gestão de fato atende. `app_holding_do_sacado` é a mesma
 * função que o roteamento usa — duas réguas para "de quem é esta nota" fariam a tela
 * mostrar a nota no funil de um vendedor e a folha pagar outro.
 */
export async function lancarCessaoConvertida(
  antecipacaoId: number,
): Promise<ResultadoLancamentoCessao> {
  const { rows } = await pool.query<LinhaCessao>(
    `select a.id_externo,
            a.convertida_em,
            a.gross_value,
            a.anticipation_days,
            a.sacado_cnpj,
            a.fornecedor_cnpj,
            a.access_key_casada as access_key,
            nf.numero as nf_numero,
            sac.id as sacado_empresa_id,
            sac.razao_social as sacado_nome,
            sac.gestao_operacao as sacado_gestao,
            sac.marco_ativacao::text as sacado_marco,
            ced.id as cedente_empresa_id,
            ced.razao_social as cedente_nome
     from antecipacoes a
     left join notas_fiscais nf on nf.access_key = a.access_key_casada
     left join empresas sac on sac.id = public.app_holding_do_sacado(a.sacado_cnpj)
     left join empresas ced on ced.cnpj = a.fornecedor_cnpj
     where a.id_externo = $1`,
    [antecipacaoId],
  )
  const c = rows[0]
  if (!c || !c.convertida_em) {
    return { antecipacao_id: antecipacaoId, lancamentos: 0, motivo: 'antecipação não convertida' }
  }
  // A CESSÃO é identificada pela access_key da NF. Sem ela não há chave estável para a
  // idempotência, e um id que muda é pior que nenhum: pagaria de novo a cada reprocesso.
  const origemId = c.access_key ?? `antecipacao:${c.id_externo}`

  const quando = c.convertida_em
  const params = await carregarParams()

  /*
   * O marco de ativação: a data da PRIMEIRA NF convertida deste sacado.
   *
   * Gravado aqui, e nunca recuado (`is null` no where): é o zero do relógio de fase, e
   * mover o zero move todas as taxas dessa conta pelos anos seguintes.
   */
  let marco = c.sacado_marco
  let primeiraConversao = false
  if (c.sacado_empresa_id && !marco) {
    const dia = diaSp(quando)
    const { rowCount } = await pool.query(
      `update empresas set marco_ativacao = $2::date where id = $1 and marco_ativacao is null`,
      [c.sacado_empresa_id, dia],
    )
    marco = dia
    primeiraConversao = (rowCount ?? 0) > 0
  }

  await garantirOriginadorDoCedente(c.cedente_empresa_id, c.sacado_empresa_id, quando)

  const gestao = gestaoNaData(
    (c.sacado_gestao ?? null) as GestaoOperacao | null,
    await historicoGestao(c.sacado_empresa_id),
    quando,
  )

  const cessao: CessaoConvertida = {
    origemId,
    antecipacaoId: c.id_externo,
    convertidaEm: quando,
    valorCedido: Number(c.gross_value ?? 0),
    anticipationDays: Number(c.anticipation_days ?? 0),
    empresaId: c.sacado_empresa_id,
    sacadoNome: c.sacado_nome,
    cedenteCnpj: c.fornecedor_cnpj,
    cedenteNome: c.cedente_nome,
    nfNumero: c.nf_numero,
    gestaoOperacao: gestao,
    marcoAtivacao: marco,
  }

  const [tVendedor, tOriginador] = await Promise.all([
    titularesNaData(c.sacado_empresa_id, 'vendedor', quando),
    titularesNaData(c.cedente_empresa_id, 'originador', quando),
  ])

  const lancamentos = lancamentosDaCessao(cessao, { vendedor: tVendedor, originador: tOriginador }, params)

  // §5 — o bônus de conta fechada só existe na PRIMEIRA conversão do sacado.
  if (primeiraConversao && c.sacado_empresa_id) {
    const bonus = await bonusContaFechada(c.sacado_empresa_id, quando, origemId, params)
    if (bonus) lancamentos.push(bonus)
  }

  const gravados = await gravar(lancamentos)

  if (gravados > 0) {
    await emitirEvento(c.sacado_empresa_id, EVENTO_TIPOS.COMISSAO_LANCADA, {
      resumo:
        `Cessão de ${moeda(cessao.valorCedido)} em ${cessao.anticipationDays} dias: ` +
        `${gravados} lançamento(s) de comissão provisionados.`,
      url: '/comercial/comissoes',
      access_key: origemId,
      antecipacao_id: c.id_externo,
      vop: lancamentos[0]?.vop ?? null,
      papeis: lancamentos.map((l) => l.papel),
    })
  }

  logger.info(
    { antecipacao: antecipacaoId, gravados, gestao, fase: lancamentos[0]?.fase ?? null },
    'Cessão convertida processada pelo motor de comissão.',
  )
  return { antecipacao_id: antecipacaoId, lancamentos: gravados }
}

async function bonusContaFechada(
  empresaId: string,
  fechadaEm: string,
  origemIdCessao: string,
  params: readonly CommissionParam[],
): Promise<LancamentoV2 | null> {
  const { rows } = await pool.query<{
    id: string
    sdr_id: string
    is_ia: boolean
    decidido_em: string | null
    prazo_em: string
    nome: string | null
  }>(
    `select ac.id, ac.sdr_id, v.is_ia, ac.decidido_em, ac.prazo_em, e.razao_social as nome
     from sdr_aceites ac
     join vendedores v on v.id = ac.sdr_id
     join empresas e on e.id = ac.empresa_id
     where ac.empresa_id = $1 and ac.status = 'aceita'
     order by coalesce(ac.decidido_em, ac.prazo_em) desc
     limit 1`,
    [empresaId],
  )
  const ac = rows[0]
  if (!ac) return null

  return lancamentoSdrContaFechada(
    {
      aceiteId: ac.id,
      sdrId: ac.sdr_id,
      sdrIsIa: ac.is_ia,
      empresaId,
      empresaNome: ac.nome,
      reuniaoAceitaEm: ac.decidido_em ?? ac.prazo_em,
      fechadaEm,
      origemIdCessao,
    },
    params,
  )
}

// ─── Estorno (§1) ───────────────────────────────────────────────────────────

export interface ResultadoEstorno {
  antecipacao_id: number
  estornos: number
}

/**
 * A cessão deixou de existir: status virou não-conversor, ou a NF foi cancelada.
 *
 * Estes são os DOIS únicos casos. Recompra e inadimplência não entram porque vendedor e
 * originador não correm risco de crédito — a comissão nasceu na conversão, e cobrá-la de
 * volta por um risco que não é deles seria mudar o contrato depois do jogo.
 *
 * O original NÃO é reescrito. Quando ele ainda está `provisionado`, ganha a marca
 * `estornado` para o extrato mostrar os dois lados; quando já está fechado ou pago, nem
 * a marca — o passado fica como está, e quem zera é a linha negativa do mês corrente.
 */
export async function estornarCessao(
  antecipacaoId: number,
  motivo: string,
  proporcao = 1,
): Promise<ResultadoEstorno> {
  const { rows: refs } = await pool.query<{ access_key: string | null }>(
    `select access_key_casada as access_key from antecipacoes where id_externo = $1`,
    [antecipacaoId],
  )
  const origemId = refs[0]?.access_key ?? `antecipacao:${antecipacaoId}`

  const { data } = await supabaseAdmin
    .from('comissao_lancamentos_v2')
    .select(
      'id, vendedor_id, papel, origem_id, origem_tipo, valor, empresa_id, cedente_cnpj, cedente_nome, nf_numero, descricao, competencia, status',
    )
    .eq('origem_tipo', 'nf_convertida')
    .eq('origem_id', origemId)

  const originais = (data ?? []) as (LancamentoOriginal & { id: string; status: string })[]
  // Sem lançamento original não há o que estornar. Criar um negativo do nada seria cobrar
  // de alguém por dinheiro que essa pessoa nunca recebeu.
  if (originais.length === 0) return { antecipacao_id: antecipacaoId, estornos: 0 }

  const agora = new Date().toISOString()
  const estornos = estornosDaCessao(originais, agora, motivo, proporcao)
  const gravados = await gravar(estornos)

  const aindaAbertos = originais.filter((o) => o.status === 'provisionado').map((o) => o.id)
  if (aindaAbertos.length > 0) {
    await supabaseAdmin
      .from('comissao_lancamentos_v2')
      .update({ status: 'estornado' })
      .in('id', aindaAbertos)
  }

  const total = estornos.reduce((s, e) => s + e.valor, 0)
  const resumo =
    `Cessão ${origemId} revertida (${motivo}): ${moeda(total)} estornados em ` +
    `${estornos.length} lançamento(s), na competência ${competenciaSp(agora)}.`

  await emitirEvento(originais[0]?.empresa_id ?? null, EVENTO_TIPOS.COMISSAO_ESTORNADA, {
    titulo: 'Comissão estornada',
    resumo,
    url: '/comercial/comissoes',
    antecipacao_id: antecipacaoId,
    access_key: origemId,
    motivo,
    proporcao,
  })
  await notificarPerfis(['Admin', 'Comercial'], {
    titulo: 'Comissão estornada',
    corpo: resumo,
    url: '/comercial/comissoes',
  })

  logger.info({ antecipacao: antecipacaoId, gravados, total }, 'Estorno de comissão registrado.')
  return { antecipacao_id: antecipacaoId, estornos: gravados }
}

// ─── SDR: abrir, expirar e lançar a fila de aceite (§5) ─────────────────────

export interface ResultadoAceitesSdr {
  abertos: number
  expirados: number
  lancados: number
}

/**
 * O job horário da fila de aceite, e o reconciliador de tudo que envolve SDR.
 *
 * As três etapas rodam juntas de propósito: abrir a fila, expirar o que venceu e lançar o
 * que foi aceito são o mesmo assunto, e separá-las criaria três relógios para uma coisa
 * que a pessoa vive como uma. Também é ele que cobre a falha do caminho rápido — a tela
 * acorda o worker ao decidir, e se essa chamada se perder, aqui o lançamento aparece na
 * hora seguinte em vez de nunca.
 */
export async function processarAceitesSdrJob(): Promise<ResultadoAceitesSdr> {
  const params = await carregarParams()
  const acc: ResultadoAceitesSdr = { abertos: 0, expirados: 0, lancados: 0 }

  const slaHoras = valorParametro(params, 'sdr_sla_recusa_horas', null, new Date()) ?? 48

  /*
   * ── 1. Abrir a fila para reuniões realizadas que ainda não têm aceite ──
   *
   * O corte pela data do PRIMEIRO parâmetro publicado é a mesma régua dos seeds: o modelo
   * v2 não existia antes dela. Sem o corte, ligar a fila numa base com histórico abriria
   * aceite para toda reunião já realizada — e, como o SLA aceita por decurso de prazo,
   * quarenta e oito horas depois isso viraria uma folha retroativa que ninguém combinou.
   */
  const { rows: novos } = await pool.query<{
    lead_id: string
    sdr_id: string
    destino_id: string | null
    empresa_id: string
    empresa: string | null
    reuniao_em: string | null
  }>(
    `select l.id as lead_id, l.sdr_id, l.vendedor_destino_id as destino_id,
            l.empresa_id, e.razao_social as empresa, l.reuniao_em
     from sdr_leads l
     join empresas e on e.id = l.empresa_id
     where l.estagio = 'reuniao_realizada'
       and l.vendedor_destino_id is not null
       and coalesce(l.reuniao_em, l.atualizado_em)
             >= (select min(vigente_de) from commission_params)
       and not exists (select 1 from sdr_aceites a where a.sdr_lead_id = l.id)`,
  )
  for (const n of novos) {
    const { rows: criado } = await pool.query<{ id: string }>(
      `insert into sdr_aceites (sdr_lead_id, sdr_id, vendedor_destino_id, empresa_id, reuniao_em, prazo_em)
       values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
       on conflict (sdr_lead_id) do nothing
       returning id`,
      [n.lead_id, n.sdr_id, n.destino_id, n.empresa_id, n.reuniao_em, Math.round(slaHoras)],
    )
    if (criado.length === 0) continue
    acc.abertos++
    await emitirEvento(n.empresa_id, EVENTO_TIPOS.SDR_ACEITE_PENDENTE, {
      resumo:
        `Reunião com ${n.empresa ?? 'a empresa'} aguarda confirmação do vendedor. ` +
        `Sem resposta em ${Math.round(slaHoras)}h, conta como aceita.`,
      url: '/comercial/comissoes',
      aceite_id: criado[0]!.id,
      lead_id: n.lead_id,
    })
  }

  // ── 2. Expirar COMO ACEITA o que passou do prazo ──
  const { rows: expirados } = await pool.query<{ id: string }>(
    `update sdr_aceites
        set status = 'aceita', aceite_automatico = true, decidido_em = now()
      where status = 'pendente' and prazo_em <= now()
      returning id`,
  )
  acc.expirados = expirados.length

  // ── 3. Lançar o que foi aceito e ainda não virou dinheiro ──
  const { rows: aLancar } = await pool.query<{
    id: string
    sdr_id: string
    is_ia: boolean
    empresa_id: string
    empresa: string | null
    decidido_em: string | null
    prazo_em: string
    automatico: boolean
  }>(
    `select a.id, a.sdr_id, v.is_ia, a.empresa_id, e.razao_social as empresa,
            a.decidido_em, a.prazo_em, a.aceite_automatico as automatico
     from sdr_aceites a
     join vendedores v on v.id = a.sdr_id
     join empresas e on e.id = a.empresa_id
     where a.status = 'aceita' and a.lancado_em is null`,
  )
  for (const a of aLancar) {
    const aceitaEm = a.decidido_em ?? a.prazo_em
    const l = lancamentoSdrReuniao(
      {
        aceiteId: a.id,
        sdrId: a.sdr_id,
        sdrIsIa: a.is_ia,
        empresaId: a.empresa_id,
        empresaNome: a.empresa,
        aceitaEm,
        automatico: a.automatico,
      },
      params,
    )
    // Sem lançamento (SDR de IA, ou parâmetro inexistente naquela data) a marca vai do
    // mesmo jeito: sem ela, o job tentaria de novo toda hora, para sempre.
    if (l) {
      await gravar([l])
      acc.lancados++
    }
    await pool.query(`update sdr_aceites set lancado_em = now() where id = $1`, [a.id])

    /*
     * §4 — reunião ACEITA cria o vínculo de SDR no sacado, tenha ou não gerado dinheiro.
     * O vínculo é sobre QUEM TROUXE a conta, e essa afirmação continua verdadeira quando
     * o parâmetro do dia não existia. Só o vendedor de IA fica de fora: ele não recebe, e
     * uma titularidade dele bloquearia a de quem receberia.
     */
    if (!a.is_ia) {
      await abrirTitularidade({
        vendedorId: a.sdr_id,
        empresaId: a.empresa_id,
        papel: 'sdr',
        // O aceite é o fato. A janela de atribuição conta dele, não da hora do job.
        desde: aceitaEm,
        motivo: 'Reunião aceita: o SDR passa a titularizar este sacado enquanto a janela durar.',
      })
    }
  }

  logger.info(acc, 'Fila de aceite do SDR processada.')
  return acc
}

// ─── Titularidade: criar pelo funil e liberar por dormência (§4) ────────────

export interface ResultadoTitularidades {
  vendedores_vinculados: number
  cedentes_liberados: number
  sdr_liberados: number
  desligados_encerrados: number
}

export async function titularidadesJob(): Promise<ResultadoTitularidades> {
  const params = await carregarParams()
  const acc: ResultadoTitularidades = {
    vendedores_vinculados: 0,
    cedentes_liberados: 0,
    sdr_liberados: 0,
    desligados_encerrados: 0,
  }

  /*
   * ── Vendedor: quem GANHOU o negócio titulariza o sacado ──
   *
   * O gatilho é `vendas.situacao = 'ganho'` — no 04g o "ganho" saiu do estágio e virou
   * situação justamente porque um negócio ganho continua andando (onboarding, primeira
   * nota). Olhar o estágio aqui não encontraria nenhum.
   */
  const { rows: ganhas } = await pool.query<{
    empresa_id: string
    vendedor_id: string
    nome: string
    empresa: string | null
    ganho_em: string
  }>(
    `select distinct on (v.empresa_id)
            v.empresa_id, v.vendedor_id, vd.nome, e.razao_social as empresa,
            coalesce(v.ganho_em, v.atualizada_em) as ganho_em
     from vendas v
     join vendedores vd on vd.id = v.vendedor_id
     join empresas e on e.id = v.empresa_id
     where v.situacao = 'ganho' and vd.ativo
       and not exists (
         select 1 from vendedor_carteira c
         where c.empresa_id = v.empresa_id and c.papel = 'vendedor' and c.ate is null
       )
     order by v.empresa_id, coalesce(v.ganho_em, v.atualizada_em) desc`,
  )
  for (const g of ganhas) {
    const criou = await abrirTitularidade({
      vendedorId: g.vendedor_id,
      empresaId: g.empresa_id,
      papel: 'vendedor',
      // O dia em que a venda foi GANHA. O job roda de madrugada; datar por ele faria a
      // conta que fechou na terça só passar a pagar na quarta.
      desde: g.ganho_em,
      motivo: `${g.nome} fechou ${g.empresa ?? 'esta conta'} e passa a titularizá-la.`,
    })
    if (criou) acc.vendedores_vinculados++
  }

  /*
   * ── Dormência do cedente: sem conversão na janela, volta ao pool ──
   *
   * A janela conta da ÚLTIMA conversão daquele cedente, não da data do vínculo: um
   * cedente que opera todo mês nunca dorme, e um que parou há dois meses volta ao pool
   * mesmo que o vínculo seja de ontem.
   */
  const dormencia = valorParametro(params, 'dormencia_cedente_dias', null, new Date()) ?? 60
  const { rows: dormentes } = await pool.query<{
    id: string
    empresa_id: string
    vendedor_id: string
    empresa: string | null
  }>(
    `update vendedor_carteira c
        set ate = now()
      from empresas e
      where c.empresa_id = e.id
        and c.papel = 'originador' and c.ate is null
        and not exists (
          select 1 from antecipacoes a
          where a.fornecedor_cnpj = e.cnpj
            and a.convertida_em is not null and a.regrediu_em is null
            and a.convertida_em >= now() - make_interval(days => $1)
        )
        -- Vínculo recém-criado ainda não teve chance de operar: liberar hoje o que se
        -- atribuiu ontem faria a carteira girar sem que ninguém tivesse feito nada.
        and c.desde <= now() - make_interval(days => $1)
      returning c.id, c.empresa_id, c.vendedor_id, e.razao_social as empresa`,
    [Math.round(dormencia)],
  )
  for (const d of dormentes) {
    acc.cedentes_liberados++
    await emitirEvento(d.empresa_id, EVENTO_TIPOS.TITULARIDADE_LIBERADA, {
      resumo:
        `${d.empresa ?? 'Cedente'} sem conversão há ${Math.round(dormencia)} dias: ` +
        'a titularidade de originação voltou ao pool.',
      url: '/comercial/comissoes',
      papel: 'originador',
      vendedor_id: d.vendedor_id,
    })
  }

  /*
   * ── SDR: fim da janela sem fechamento ──
   *
   * "Sem fechamento" é `marco_ativacao is null`: a conta nunca converteu uma NF. Se
   * converteu, a reunião cumpriu o que prometia e o vínculo fica — encerrá-lo aqui
   * apagaria a trilha de quem trouxe a conta.
   */
  const janelaSdr = valorParametro(params, 'janela_atribuicao_sdr_dias', null, new Date()) ?? 180
  const { rows: sdrLiberados } = await pool.query<{ empresa_id: string; vendedor_id: string }>(
    `update vendedor_carteira c
        set ate = now()
      from empresas e
      where c.empresa_id = e.id
        and c.papel = 'sdr' and c.ate is null
        and c.desde <= now() - make_interval(days => $1)
        and e.marco_ativacao is null
      returning c.empresa_id, c.vendedor_id`,
    [Math.round(janelaSdr)],
  )
  acc.sdr_liberados = sdrLiberados.length

  /*
   * ── Colaborador desligado (§8) ──
   *
   * Os lançamentos já criados são devidos e não se tocam. O que encerra é a
   * TITULARIDADE, na data — e ela não transfere: a conta volta ao pool e um gestor
   * decide quem assume, porque herdar carteira automaticamente é como alguém passa a
   * receber por uma relação que nunca teve.
   */
  const { rows: desligados } = await pool.query<{ id: string }>(
    `update vendedor_carteira c
        set ate = now()
      from vendedores v
      where c.vendedor_id = v.id and not v.ativo
        and c.ate is null and c.papel in ('vendedor', 'originador', 'sdr')
      returning c.id`,
  )
  acc.desligados_encerrados = desligados.length

  logger.info(acc, 'Titularidades automáticas processadas.')
  return acc
}

// ─── Fechamento mensal (§6) ─────────────────────────────────────────────────

export interface ResultadoFechamento {
  competencia: string | null
  lancamentos: number
  total: number
  motivo?: string
}

/** Sábado e domingo não. Feriado não é modelado — e é o único caso em que o fecho anda um dia. */
function ehDiaUtil(d: Date): boolean {
  const dow = d.getUTCDay()
  return dow !== 0 && dow !== 6
}

/** O último dia útil do mês de `dia`, em ISO (YYYY-MM-DD), lido no calendário de SP. */
export function ultimoDiaUtilDoMes(dia: string): string {
  const [ano, mes] = dia.split('-').map(Number)
  const d = new Date(Date.UTC(ano!, mes!, 0)) // dia 0 do mês seguinte = último do mês
  while (!ehDiaUtil(d)) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Fecha a competência corrente — no último dia útil, às 23h59 de São Paulo.
 *
 * O cron roda TODO dia e o job decide se é o dia. É o mesmo desenho do aviso de custo dos
 * protestos, e pelo mesmo motivo: "último dia útil" não é uma expressão que o cron saiba
 * dizer, e um cron marcado no dia 30 nunca dispararia em fevereiro.
 *
 * Fechar é declarar o mês IMUTÁVEL. Depois disto, um estorno descoberto entra como linha
 * negativa no mês seguinte; nada reescreve o que já virou folha.
 */
export async function fecharCompetenciaJob(forcarCompetencia?: string): Promise<ResultadoFechamento> {
  const agoraSp = diaSp(new Date())
  const competencia = forcarCompetencia ?? `${agoraSp.slice(0, 7)}-01`

  if (!forcarCompetencia && agoraSp !== ultimoDiaUtilDoMes(agoraSp)) {
    return {
      competencia: null,
      lancamentos: 0,
      total: 0,
      motivo: `hoje (${agoraSp}) não é o último dia útil do mês`,
    }
  }

  const { rows: jaFechada } = await pool.query<{ status: string }>(
    `select status from comissao_competencias where competencia = $1::date`,
    [competencia],
  )
  if (jaFechada.length > 0) {
    return {
      competencia,
      lancamentos: 0,
      total: 0,
      motivo: `competência já ${jaFechada[0]!.status}`,
    }
  }

  const { rows: fechados } = await pool.query<{ n: string; total: string }>(
    `with mudou as (
       update comissao_lancamentos_v2
          set status = 'fechado'
        where competencia = $1::date and status = 'provisionado'
        returning valor
     )
     select count(*)::text as n, coalesce(sum(valor), 0)::text as total from mudou`,
    [competencia],
  )
  const n = Number(fechados[0]?.n ?? 0)
  // O total da competência inclui os estornados: eles somam zero com a linha negativa
  // espelhada, e é essa soma que a folha paga.
  const { rows: totalRows } = await pool.query<{ total: string }>(
    `select coalesce(sum(valor), 0)::text as total from comissao_lancamentos_v2 where competencia = $1::date`,
    [competencia],
  )
  const total = Number(totalRows[0]?.total ?? 0)

  await pool.query(
    `insert into comissao_competencias (competencia, status, lancamentos, total)
     values ($1::date, 'fechada', $2, $3)
     on conflict (competencia) do nothing`,
    [competencia, n, total],
  )

  const resumo =
    `Competência ${competencia.slice(0, 7)} fechada: ${n} lançamento(s), ${moeda(total)}. ` +
    'Falta aprovar antes de pagar — e ela agora é imutável.'

  await emitirEvento(null, EVENTO_TIPOS.COMPETENCIA_FECHADA, {
    titulo: 'Competência fechada',
    resumo,
    url: '/comercial/comissoes',
    competencia,
    lancamentos: n,
    total,
  })
  await notificarPerfis(['Admin', 'Comercial'], {
    titulo: 'Competência fechada',
    corpo: resumo,
    url: '/comercial/comissoes',
  })

  logger.info({ competencia, n, total }, 'Competência de comissão fechada.')
  return { competencia, lancamentos: n, total }
}

// ─── Alerta de reclassificação (§3) ─────────────────────────────────────────

export interface ResultadoAlertaReclassificacao {
  avaliadas: number
  sinalizadas: number
}

/**
 * Semanal: aponta contas passivas cujo volume recente desabou.
 *
 * SINALIZA. Nunca reclassifica. O número não sabe se a obra parou, se o sacado trocou de
 * banco ou se ninguém registrou nada — e reclassificar sozinho mudaria a comissão de
 * alguém a partir de uma hipótese.
 */
export async function alertaReclassificacaoJob(): Promise<ResultadoAlertaReclassificacao> {
  const params = await carregarParams()
  const hoje = new Date()
  const janela = valorParametro(params, 'alerta_revisao_dias', null, hoje) ?? 45
  const piso = valorParametro(params, 'alerta_revisao_percentual', null, hoje) ?? 50

  /*
   * A agregação vem de um CTE, e não de subconsultas correlacionadas:
   * `app_holding_do_sacado` é uma função POR LINHA, e duas subconsultas por empresa
   * varreriam `antecipacoes` inteira duas vezes para cada conta avaliada.
   */
  const { rows } = await pool.query<{
    empresa_id: string
    nome: string | null
    gestao: string | null
    volume_janela: string
    media_anterior: string
  }>(
    `with vol as (
       select public.app_holding_do_sacado(a.sacado_cnpj) as empresa_id,
              coalesce(sum(a.gross_value)
                       filter (where a.convertida_em >= now() - make_interval(days => $1)), 0) as janela,
              -- Os TRÊS meses ANTERIORES à janela: incluir a própria janela na base de
              -- comparação diluiria justamente a queda que se quer detectar.
              coalesce(sum(a.gross_value) filter (
                where a.convertida_em >= now() - make_interval(days => $1) - interval '90 days'
                  and a.convertida_em < now() - make_interval(days => $1)), 0) / 3 as media_anterior
       from antecipacoes a
       where a.convertida_em is not null and a.regrediu_em is null
       group by 1
     )
     select e.id as empresa_id, e.razao_social as nome, e.gestao_operacao as gestao,
            coalesce(vol.janela, 0)::text as volume_janela,
            coalesce(vol.media_anterior, 0)::text as media_anterior
     from empresas e
     left join vol on vol.empresa_id = e.id
     where e.gestao_operacao = 'passivo' and e.estagio in ('cliente', 'ex_cliente')`,
    [Math.round(janela)],
  )

  let sinalizadas = 0
  for (const r of rows) {
    const volumeJanela = Number(r.volume_janela)
    const mediaMensalAnterior = Number(r.media_anterior)
    if (
      !sugereRevisao({
        gestaoOperacao: (r.gestao ?? null) as GestaoOperacao | null,
        volumeJanela,
        mediaMensalAnterior,
        percentualPiso: piso,
      })
    ) {
      continue
    }
    sinalizadas++
    await emitirEvento(r.empresa_id, EVENTO_TIPOS.CONTA_REVISAO_SUGERIDA, {
      titulo: 'Revisão de classificação sugerida',
      resumo:
        `${r.nome ?? 'Conta passiva'}: ${moeda(volumeJanela)} nos últimos ${Math.round(janela)} dias, ` +
        `contra uma média mensal de ${moeda(mediaMensalAnterior)} nos três meses anteriores. ` +
        'Vale revisar a classificação — o sistema não muda sozinho.',
      url: '/comercial/comissoes',
      volume_janela: volumeJanela,
      media_mensal_anterior: mediaMensalAnterior,
      piso_percentual: piso,
    })
  }

  logger.info({ avaliadas: rows.length, sinalizadas }, 'Alerta de reclassificação avaliado.')
  return { avaliadas: rows.length, sinalizadas }
}

// ─── Backfill: cessões já convertidas que ainda não passaram pelo motor ─────

export interface ResultadoBackfill {
  candidatas: number
  processadas: number
  lancamentos: number
}

/**
 * Processa as conversões que aconteceram DEPOIS do deploy dos parâmetros e antes de o
 * handler live existir — e, de quebra, é a rede que pega qualquer conversão em que a
 * chamada live tenha falhado.
 *
 * Dois pisos, e cada um evita um trabalho que nunca daria em nada:
 *
 *   o primeiro parâmetro publicado   Uma cessão anterior a ele não encontra taxa e não
 *                                    gera lançamento — o modelo v2 não existia naquele dia.
 *
 *   a última competência fechada     Um mês fechado é imutável, e `gravar` recusa. Sem o
 *                                    piso, o job reofereceria as mesmas cessões todo dia,
 *                                    para sempre, e cada corrida encheria o log da recusa
 *                                    que a corrida anterior já tinha registrado.
 */
export async function backfillCessoesJob(limite = 500): Promise<ResultadoBackfill> {
  const { rows } = await pool.query<{ id_externo: number }>(
    `select a.id_externo
     from antecipacoes a
     where a.convertida_em is not null and a.regrediu_em is null
       and a.access_key_casada is not null
       and a.convertida_em >= greatest(
             (select min(vigente_de) from commission_params),
             coalesce((select (max(competencia) + interval '1 month')::date
                       from comissao_competencias), '-infinity'::date)
           )
       and not exists (
         select 1 from comissao_lancamentos_v2 l
         where l.origem_tipo = 'nf_convertida' and l.origem_id = a.access_key_casada
       )
     order by a.convertida_em
     limit $1`,
    [limite],
  )

  let lancamentos = 0
  let processadas = 0
  for (const r of rows) {
    try {
      const res = await lancarCessaoConvertida(r.id_externo)
      lancamentos += res.lancamentos
      processadas++
    } catch (e) {
      logger.error({ antecipacao: r.id_externo, erro: String(e) }, 'Backfill de cessão falhou.')
    }
  }

  logger.info({ candidatas: rows.length, processadas, lancamentos }, 'Backfill de cessões concluído.')
  return { candidatas: rows.length, processadas, lancamentos }
}

// ─── O diário do módulo ─────────────────────────────────────────────────────

export interface ResultadoComissoesDiario {
  titularidades: ResultadoTitularidades
  backfill: ResultadoBackfill
  fechamento: ResultadoFechamento
}

/**
 * Uma corrida por dia, na ordem em que as coisas dependem umas das outras.
 *
 * Titularidade antes do backfill: uma cessão processada sem titular não é reprocessada
 * (a chave de idempotência já existe... e não existe — sem titular não há linha), então
 * abrir o vínculo primeiro é o que faz o backfill encontrar dono. Fechamento por último,
 * porque é ele que congela tudo o que os dois anteriores produziram.
 */
export async function comissoesDiarioJob(): Promise<ResultadoComissoesDiario> {
  const titularidades = await titularidadesJob()
  const backfill = await backfillCessoesJob()
  const fechamento = await fecharCompetenciaJob()
  return { titularidades, backfill, fechamento }
}

const moeda = (n: number): string =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
