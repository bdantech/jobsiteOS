import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { CAMADAS_DA_FONTE } from '../../../../../packages/core/src/comercial/schemas.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { lerDistribuicao } from '../../comercial/config.js'

/**
 * Distribuição semanal de empresas para os SDRs (04g §4), e o SLA que devolve ao pool
 * o que ninguém tocou.
 *
 * A ordenação é por `valor_esperado_mensal` — a régua do Crédito (04d), que já
 * multiplica limite × giro × taxa × chance. Ordenar por faturamento estimado daria
 * peso a empresa grande que nunca vai antecipar; ordenar por "parece bom" é o que este
 * sistema inteiro existe para substituir.
 *
 * O que NÃO entra, e cada exclusão custou alguma coisa em algum lugar:
 *   passiva            — decidiu-se não trabalhar a conta;
 *   já cliente         — SDR prospecta quem não é;
 *   lead vivo          — dois SDRs na mesma porta é pior que ninguém;
 *   sem_fit recente    — bater de novo em 30 dias queima a marca e gasta a vez de outra.
 */

interface Candidata {
  empresa_id: string
  razao_social: string | null
  uf: string | null
  faturamento: number | null
  valor_esperado: number | null
}

interface SdrDisponivel {
  id: string
  nome: string
  direcao: 'in' | 'out' | 'both'
  cota: number
  ufs: string[]
  faturamento_min: number | null
  faturamento_max: number | null
  carga: number
}

export interface ResultadoDistribuicao {
  sdrs: number
  candidatas: number
  distribuidos: number
  por_sdr: Record<string, number>
  motivo?: 'sem_sdr' | 'sem_candidata'
}

async function sdrsDisponiveis(cotaPadrao: number): Promise<SdrDisponivel[]> {
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('id, nome, settings, ativo, tipo')
    .eq('tipo', 'sdr')
    .eq('ativo', true)
  if (!data?.length) return []

  const ids = data.map((v) => v.id)
  const { data: terrs } = await supabaseAdmin
    .from('vendedor_territorios')
    .select('vendedor_id, ufs, faturamento_min, faturamento_max')
    .in('vendedor_id', ids)
  const porVendedor = new Map((terrs ?? []).map((t) => [t.vendedor_id, t]))

  // Carga = leads que ainda pedem trabalho. Um SDR com 40 leads parados não deve
  // receber mais 25 só porque é segunda-feira.
  const { rows } = await pool.query<{ sdr_id: string; n: string }>(
    `select sdr_id, count(*) as n from sdr_leads
     where estagio not in ('sem_fit', 'desqualificada', 'qualificada')
     group by sdr_id`,
  )
  const carga = new Map(rows.map((r) => [r.sdr_id, Number(r.n)]))

  return data.map((v) => {
    const s = (v.settings ?? {}) as { direcao?: string; empresas_por_semana?: number }
    const t = porVendedor.get(v.id)
    return {
      id: v.id,
      nome: v.nome,
      direcao: (s.direcao === 'in' || s.direcao === 'out' ? s.direcao : 'both') as 'in' | 'out' | 'both',
      cota: Number(s.empresas_por_semana ?? cotaPadrao),
      ufs: (t?.ufs ?? []) as string[],
      faturamento_min: t?.faturamento_min === undefined ? null : Number(t.faturamento_min),
      faturamento_max: t?.faturamento_max === undefined ? null : Number(t.faturamento_max),
      carga: carga.get(v.id) ?? 0,
    }
  })
}

function cabeNoTerritorio(c: Candidata, s: SdrDisponivel): boolean {
  if (s.ufs.length > 0 && (!c.uf || !s.ufs.includes(c.uf.toUpperCase()))) return false
  if (s.faturamento_min !== null && (c.faturamento === null || c.faturamento < s.faturamento_min)) return false
  if (s.faturamento_max !== null && (c.faturamento === null || c.faturamento > s.faturamento_max)) return false
  return true
}

export async function distribuirSdrJob(): Promise<ResultadoDistribuicao> {
  const cfg = await lerDistribuicao()

  /*
   * Só SDRs de saída entram na distribuição automática.
   *
   * O prompt prevê que o SDR de entrada receba "empresas com evento de resposta ou
   * interesse", e esse canal não existe até o Prompt 05 — não há inbound de onde
   * puxar. Inventar um proxy aqui encheria a fila de quem trabalha inbound com
   * empresas frias, e o número de "leads inbound" viraria ficção. Enquanto isso, o
   * SDR de entrada recebe lead por criação manual (`origem = 'inbound'`).
   */
  const todos = await sdrsDisponiveis(cfg.empresas_por_semana)
  const sdrs = todos.filter((s) => s.direcao !== 'in')
  if (sdrs.length === 0) {
    logger.warn({ sdrs_totais: todos.length }, 'Distribuição sem SDR de saída disponível.')
    return { sdrs: 0, candidatas: 0, distribuidos: 0, por_sdr: {}, motivo: 'sem_sdr' }
  }

  const camadas = CAMADAS_DA_FONTE[cfg.fonte]
  const teto = sdrs.reduce((s, v) => s + Math.max(0, v.cota), 0)

  const { rows } = await pool.query<Candidata>(
    `
    select e.id as empresa_id, u.razao_social, u.uf,
           e.faturamento_anual as faturamento,
           e.valor_esperado_mensal as valor_esperado
    from empresas e
    join mercado_universo u on u.cnpj = e.cnpj
    where u.camada = any($1::text[])
      and e.estagio not in ('cliente', 'ex_cliente')
      and coalesce(e.gestao_operacao, '') <> 'passivo'
      and not exists (
        select 1 from sdr_leads l
        where l.empresa_id = e.id
          and (
            l.estagio not in ('sem_fit', 'desqualificada', 'qualificada')
            or (l.estagio = 'sem_fit' and l.atualizado_em > now() - ($2 || ' days')::interval)
          )
      )
    order by e.valor_esperado_mensal desc nulls last, e.faturamento_anual desc nulls last
    limit $3
  `,
    [camadas, String(cfg.sem_fit_carencia_dias), teto * 3],
  )

  if (rows.length === 0) {
    logger.warn({ camadas }, 'Distribuição sem candidatas.')
    return { sdrs: sdrs.length, candidatas: 0, distribuidos: 0, por_sdr: {}, motivo: 'sem_candidata' }
  }

  // Guloso com balanceamento: a melhor empresa disponível vai para o SDR elegível de
  // MENOR carga. Sortear seria mais justo entre SDRs e pior para a empresa — a melhor
  // conta da semana tem de cair na mão de quem tem tempo de trabalhá-la.
  const restante = new Map(sdrs.map((s) => [s.id, Math.max(0, s.cota)]))
  const carga = new Map(sdrs.map((s) => [s.id, s.carga]))
  const novos: { empresa_id: string; sdr_id: string; origem: string }[] = []
  const porSdr: Record<string, number> = {}

  for (const c of rows) {
    const elegiveis = sdrs
      .filter((s) => (restante.get(s.id) ?? 0) > 0 && cabeNoTerritorio(c, s))
      .sort((a, b) => (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0) || a.id.localeCompare(b.id))
    const escolhido = elegiveis[0]
    if (!escolhido) continue

    novos.push({ empresa_id: c.empresa_id, sdr_id: escolhido.id, origem: 'distribuicao' })
    restante.set(escolhido.id, (restante.get(escolhido.id) ?? 0) - 1)
    carga.set(escolhido.id, (carga.get(escolhido.id) ?? 0) + 1)
    porSdr[escolhido.nome] = (porSdr[escolhido.nome] ?? 0) + 1
    if ([...restante.values()].every((n) => n <= 0)) break
  }

  if (novos.length > 0) {
    const { error } = await supabaseAdmin.from('sdr_leads').insert(novos)
    if (error) throw new Error(`Falha ao gravar leads: ${error.message}`)
  }

  await emitirEvento(null, EVENTO_TIPOS.SDR_LEAD_DISTRIBUIDO, {
    titulo: 'Distribuição semanal concluída',
    resumo:
      `${novos.length} empresa(s) distribuída(s) entre ${Object.keys(porSdr).length} SDR(s), ` +
      `da fonte ${cfg.fonte}.`,
    url: '/comercial/sdr',
    por_sdr: porSdr,
  })

  logger.info({ distribuidos: novos.length, porSdr, camadas }, 'Distribuição semanal de SDR concluída.')
  return { sdrs: sdrs.length, candidatas: rows.length, distribuidos: novos.length, por_sdr: porSdr }
}

export interface ResultadoSla {
  expirados: number
  redistribuidos: number
}

/**
 * Lead `a_contatar` parado além do SLA volta ao pool.
 *
 * "Volta ao pool" aqui é `desqualificada` + evento, não deleção: o histórico de que
 * aquela empresa passou pela mão de alguém e não foi trabalhada é justamente o dado
 * que explica por que ela reaparece na distribuição da semana seguinte.
 */
export async function slaLeadsJob(): Promise<ResultadoSla> {
  const cfg = await lerDistribuicao()

  const { rows } = await pool.query<{ id: string; empresa_id: string; sdr_id: string; nome: string | null }>(
    `
    update sdr_leads l set estagio = 'desqualificada', atualizado_em = now()
    from empresas e
    where l.empresa_id = e.id
      and l.estagio = 'a_contatar'
      and coalesce(l.ultimo_toque_em, l.distribuido_em) < now() - ($1 || ' days')::interval
    returning l.id, l.empresa_id, l.sdr_id, e.razao_social as nome
  `,
    [String(cfg.sla_lead_dias)],
  )

  for (const r of rows) {
    await emitirEvento(r.empresa_id, EVENTO_TIPOS.SDR_LEAD_EXPIRADO, {
      titulo: 'Lead expirado',
      resumo: `${cfg.sla_lead_dias} dias sem toque: o lead voltou ao pool e será redistribuído.`,
      url: '/comercial/sdr',
      lead_id: r.id,
    })
  }

  if (rows.length > 0) {
    await notificarPerfis(['Comercial'], {
      titulo: 'Leads expirados',
      corpo: `${rows.length} lead(s) sem toque em ${cfg.sla_lead_dias} dias voltaram ao pool.`,
      url: '/comercial/sdr',
    })
  }

  logger.info({ expirados: rows.length }, 'SLA de leads aplicado.')
  // A redistribuição em si é da rotina semanal: devolver ao pool e redistribuir no
  // mesmo instante daria ao próximo SDR um lead que ninguém teve tempo de olhar.
  return { expirados: rows.length, redistribuidos: 0 }
}
