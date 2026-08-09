import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  comissaoNfConvertida,
  comissaoReuniao,
  comissaoVolumePassivo,
  competenciaDe,
  donoNaData,
  estornoDe,
  regraVigente,
  type JanelaCarteira,
  type Lancamento,
  type RegraComissao,
  type TipoVendedor,
} from '../../../../../packages/core/src/comercial/comissao.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { lerComissao } from '../../comercial/config.js'

/**
 * Apuração mensal de comissão (04g §6).
 *
 * Todo o cálculo mora no core e é testado lá; aqui só se busca o que aconteceu e se
 * grava o que ele decidiu. A separação importa porque as duas perguntas difíceis —
 * "que regra valia" e "quem era dono" — são sobre o passado, e um teste é a única
 * forma barata de garantir que a resposta não mude quando o presente muda.
 *
 * Idempotente pelo `unique (origem_tipo, origem_id, vendedor_id)`: rodar duas vezes a
 * mesma competência não paga duas vezes. É `upsert ... ignoreDuplicates`, e não um
 * "delete e reinsere", porque reinserir apagaria o status de aprovação já dado.
 */

export interface ResultadoApuracao {
  competencia: string
  reunioes: number
  nfs: number
  volumes: number
  estornos: number
  gravados: number
  sem_regra: number
}

function mesAnterior(hoje = new Date()): string {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1))
  return d.toISOString().slice(0, 10)
}

function fimDoMes(competencia: string): string {
  const d = new Date(`${competencia}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString()
}

async function carregarRegras(): Promise<RegraComissao[]> {
  const { data } = await supabaseAdmin
    .from('comissao_regras')
    .select('id, tipo_vendedor, vendedor_id, parametros, vigente_de, vigente_ate')
  return (data ?? []).map((r) => ({
    id: r.id,
    tipo_vendedor: r.tipo_vendedor as TipoVendedor,
    vendedor_id: r.vendedor_id,
    parametros: (r.parametros ?? {}) as Record<string, unknown>,
    vigente_de: r.vigente_de,
    vigente_ate: r.vigente_ate,
  }))
}

async function carregarVendedores(): Promise<Map<string, { id: string; tipo: TipoVendedor; nome: string }>> {
  const { data } = await supabaseAdmin.from('vendedores').select('id, tipo, nome')
  return new Map((data ?? []).map((v) => [v.id, { id: v.id, tipo: v.tipo as TipoVendedor, nome: v.nome }]))
}

async function carregarCarteira(): Promise<JanelaCarteira[]> {
  const { data } = await supabaseAdmin
    .from('vendedor_carteira')
    .select('vendedor_id, empresa_id, papel, desde, ate')
  return (data ?? []) as JanelaCarteira[]
}

export async function apurarComissoesJob(competenciaIn?: string): Promise<ResultadoApuracao> {
  const competencia = competenciaIn ?? mesAnterior()
  const de = `${competencia}T00:00:00Z`
  const ate = fimDoMes(competencia)
  const cfg = await lerComissao()

  const [regras, vendedores, carteira] = await Promise.all([
    carregarRegras(),
    carregarVendedores(),
    carregarCarteira(),
  ])

  const acc: ResultadoApuracao = {
    competencia, reunioes: 0, nfs: 0, volumes: 0, estornos: 0, gravados: 0, sem_regra: 0,
  }
  const lancamentos: Lancamento[] = []

  const regraDe = (vendedorId: string | null, data: string): RegraComissao | null => {
    if (!vendedorId) return null
    const v = vendedores.get(vendedorId)
    if (!v) return null
    return regraVigente(regras, v, data)
  }

  // ── SDR: reuniões AGENDADAS na competência ──
  const { rows: reunioes } = await pool.query<{
    lead_id: string; sdr_id: string; agendada_em: string; empresa: string | null
  }>(
    `select l.id as lead_id, l.sdr_id, l.reuniao_em as agendada_em, e.razao_social as empresa
     from sdr_leads l join empresas e on e.id = l.empresa_id
     where l.reuniao_em is not null and l.reuniao_em >= $1 and l.reuniao_em < $2`,
    [de, ate],
  )
  for (const r of reunioes) {
    const regra = regraDe(r.sdr_id, r.agendada_em)
    const l = comissaoReuniao(regra, {
      lead_id: r.lead_id, vendedor_id: r.sdr_id, agendada_em: r.agendada_em, empresa: r.empresa ?? '—',
    })
    if (l) { lancamentos.push(l); acc.reunioes++ } else acc.sem_regra++
  }

  // ── Originador: NFs convertidas, atribuídas a quem era dono NA DATA ──
  const { rows: convertidas } = await pool.query<{
    id_externo: number; convertida_em: string; gross_value: string | null;
    empresa_id: string | null; empresa: string | null
  }>(
    `select a.id_externo, a.convertida_em, a.gross_value,
            e.id as empresa_id, e.razao_social as empresa
     from antecipacoes a
     left join notas_fiscais nf on nf.access_key = a.access_key_casada
     left join empresas e on e.id = nf.fornecedor_empresa_id
     where a.convertida_em >= $1 and a.convertida_em < $2 and a.regrediu_em is null`,
    [de, ate],
  )
  for (const c of convertidas) {
    if (!c.empresa_id) continue
    const dono = donoNaData(carteira, c.empresa_id, 'originacao', c.convertida_em)
    if (!dono) continue
    const l = comissaoNfConvertida(regraDe(dono, c.convertida_em), {
      antecipacao_id: String(c.id_externo),
      vendedor_id: dono,
      convertida_em: c.convertida_em,
      gross_value: Number(c.gross_value ?? 0),
      empresa: c.empresa ?? '—',
    })
    if (l) { lancamentos.push(l); acc.nfs++ } else acc.sem_regra++
  }

  // ── Vendedor: volume das passivas que ele geria NAQUELE mês ──
  const { rows: volumes } = await pool.query<{
    empresa_id: string; empresa: string | null; volume: string
  }>(
    `select e.id as empresa_id, e.razao_social as empresa, coalesce(sum(a.gross_value), 0) as volume
     from antecipacoes a
     join empresas e on e.cnpj = a.sacado_cnpj
     where a.convertida_em >= $1 and a.convertida_em < $2 and a.regrediu_em is null
     group by 1, 2`,
    [de, ate],
  )
  for (const v of volumes) {
    // O dono é aferido no FIM da competência: a gestão vale para o mês inteiro, e usar
    // o início faria uma conta assumida no dia 2 render zero para quem a trabalhou.
    const dono = donoNaData(carteira, v.empresa_id, 'gestao_passiva', ate)
    if (!dono) continue
    const l = comissaoVolumePassivo(regraDe(dono, ate), {
      vendedor_id: dono,
      empresa_id: v.empresa_id,
      competencia,
      volume: Number(v.volume),
      empresa: v.empresa ?? '—',
    })
    if (l) { lancamentos.push(l); acc.volumes++ } else acc.sem_regra++
  }

  // ── Clawback: antecipação comissionada que regrediu ──
  const { rows: regressoes } = await pool.query<{ id_externo: number; regrediu_em: string }>(
    `select a.id_externo, a.regrediu_em from antecipacoes a
     where a.regrediu_em is not null and a.regrediu_em >= $1 and a.regrediu_em < $2`,
    [de, ate],
  )
  for (const r of regressoes) {
    const { data: original } = await supabaseAdmin
      .from('comissao_lancamentos')
      .select('vendedor_id, origem_id, valor, descricao')
      .eq('origem_tipo', 'nf_convertida')
      .eq('origem_id', String(r.id_externo))
      .maybeSingle()
    // Sem lançamento original não há o que estornar. Criar um negativo do nada seria
    // cobrar de alguém por dinheiro que essa pessoa nunca recebeu.
    if (!original) continue
    lancamentos.push(
      estornoDe(
        { vendedor_id: original.vendedor_id, origem_id: original.origem_id, valor: Number(original.valor), descricao: original.descricao ?? '' },
        r.regrediu_em,
      ),
    )
    acc.estornos++
  }

  // ── No-show, quando ligado na config ──
  if (cfg.estorno_no_show) {
    const { rows: noShows } = await pool.query<{ lead_id: string; quando: string }>(
      `select l.id as lead_id, l.atualizado_em as quando from sdr_leads l
       where l.estagio = 'no_show' and l.atualizado_em >= $1 and l.atualizado_em < $2`,
      [de, ate],
    )
    for (const n of noShows) {
      const { data: original } = await supabaseAdmin
        .from('comissao_lancamentos')
        .select('vendedor_id, origem_id, valor, descricao')
        .eq('origem_tipo', 'reuniao_agendada')
        .eq('origem_id', n.lead_id)
        .maybeSingle()
      if (!original) continue
      lancamentos.push(
        estornoDe(
          { vendedor_id: original.vendedor_id, origem_id: original.origem_id, valor: Number(original.valor), descricao: original.descricao ?? '' },
          n.quando,
        ),
      )
      acc.estornos++
    }
  }

  if (lancamentos.length > 0) {
    const { error, count } = await supabaseAdmin
      .from('comissao_lancamentos')
      .upsert(lancamentos, { onConflict: 'origem_tipo,origem_id,vendedor_id', ignoreDuplicates: true, count: 'exact' })
    if (error) throw new Error(`Falha ao gravar comissões: ${error.message}`)
    acc.gravados = count ?? lancamentos.length
  }

  // Um aviso por VENDEDOR, com o total dele. Um aviso agregado ("42 lançamentos")
  // obriga cada pessoa a abrir a tela para descobrir se a parte dela mudou.
  const porVendedor = new Map<string, number>()
  for (const l of lancamentos) porVendedor.set(l.vendedor_id, (porVendedor.get(l.vendedor_id) ?? 0) + l.valor)

  await emitirEvento(null, EVENTO_TIPOS.COMISSAO_APURADA, {
    titulo: 'Comissões apuradas',
    resumo:
      `Competência ${competencia}: ${lancamentos.length} lançamento(s) em ${porVendedor.size} vendedor(es). ` +
      'Falta aprovar antes de pagar.',
    url: '/comercial/comissoes',
    competencia,
  })
  await notificarPerfis(['Admin', 'Comercial'], {
    titulo: 'Comissões apuradas',
    corpo: `Competência ${competencia} fechada com ${lancamentos.length} lançamento(s). Revise e aprove.`,
    url: '/comercial/comissoes',
  })

  logger.info(acc, 'Apuração de comissões concluída.')
  return acc
}

/**
 * Hook do 04d: a seguradora decidiu, e o card do funil anda sozinho.
 *
 * Aprovada e negada são inequívocas e ficam mais caras quanto mais demoram — deixar o
 * vendedor mover à mão só adiciona atraso entre a decisão e a próxima ação. Parcial
 * NÃO anda: metade do limite pedido pode ser ótimo ou inviável, e essa leitura é de
 * quem está na mesa.
 */
export async function aplicarDecisaoCreditoEmVendas(analiseId: string, decisao: string): Promise<number> {
  const { data: vendas } = await supabaseAdmin
    .from('vendas')
    .select('id, empresa_id, estagio')
    .eq('analise_credito_id', analiseId)
    .eq('situacao', 'em_andamento')
  if (!vendas?.length) return 0

  if (decisao === 'aprovada_parcial') {
    for (const v of vendas) {
      await emitirEvento(v.empresa_id, EVENTO_TIPOS.VENDA_ESTAGIO_ALTERADO, {
        titulo: 'Crédito aprovado parcialmente',
        resumo: 'A seguradora aprovou parte do limite. O card NÃO andou sozinho: decida na mesa.',
        url: `/comercial/vendas/${v.id}`,
        venda_id: v.id,
      })
    }
    return 0
  }

  if (decisao !== 'aprovada' && decisao !== 'negada') return 0

  const aprovada = decisao === 'aprovada'
  let motivoId: string | null = null
  if (!aprovada) {
    const { data: motivo } = await supabaseAdmin
      .from('motivos_perda')
      .select('id')
      .eq('contexto', 'funil_vendedor')
      .eq('motivo', 'Crédito negado')
      .maybeSingle()
    motivoId = motivo?.id ?? null
    // Sem o motivo cadastrado o CHECK do banco recusaria a linha. Parar aqui é melhor
    // que gravar "perdido" sem motivo — que é justamente o que o CHECK existe para impedir.
    if (!motivoId) {
      logger.error({ analiseId }, 'Motivo "Crédito negado" ausente; card não foi movido.')
      return 0
    }
  }

  for (const v of vendas) {
    // Aprovada move o ESTÁGIO (seguir adiante); negada muda a SITUAÇÃO e deixa o estágio
    // onde está — é ele que diz até onde o negócio chegou antes de morrer.
    await supabaseAdmin
      .from('vendas')
      .update(
        aprovada
          ? { estagio: 'proposta_enviada', atualizada_em: new Date().toISOString() }
          : {
              situacao: 'perdido',
              perdido_motivo: motivoId,
              perdido_em: new Date().toISOString(),
              atualizada_em: new Date().toISOString(),
            },
      )
      .eq('id', v.id)

    await emitirEvento(v.empresa_id, aprovada ? EVENTO_TIPOS.VENDA_ESTAGIO_ALTERADO : EVENTO_TIPOS.VENDA_PERDIDA, {
      titulo: aprovada ? 'Crédito aprovado' : 'Venda perdida por crédito negado',
      resumo: aprovada
        ? 'Limite aprovado pela seguradora — o card avançou para proposta enviada.'
        : 'A seguradora negou o limite; o card foi encerrado com o motivo "Crédito negado".',
      url: `/comercial/vendas/${v.id}`,
      venda_id: v.id,
    })
  }

  logger.info({ analiseId, decisao, cards: vendas.length }, 'Decisão de crédito aplicada ao funil.')
  return vendas.length
}
