import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * Espelha as titularidades de cedente em `fornecedores_seguidos` (04r §2). Diário.
 *
 * ─── QUAL PAPEL, E POR QUE NÃO O QUE A SPEC ESCREVEU ─────────────────────────
 *
 * O §2 diz "papel `originacao` (04k)". Em `vendedor_carteira` vivem cinco papéis, e os
 * dois de nome parecido significam coisas diferentes (PAPEIS_CARTEIRA, em
 * packages/core/src/comercial/schemas.ts):
 *
 *   originacao  roteamento de NF (04g) — quem recebe as notas daquela empresa.
 *   originador  TITULAR DO CEDENTE (04k §4) — que é exatamente o que o §2 descreve.
 *
 * A titularidade lida aqui é a de `originador`. Medido em 20/09/2026, sobre os 130
 * cedentes que emitem contra sacados não cadastrados: `originador` cobre 8 deles,
 * `originacao` cobre 1. Ler o papel errado deixaria o funil 8x mais vazio do que ele
 * já é — e ele já nasce vazio, que é por que o botão "Seguir" existe.
 *
 * (No §7 o papel gravado É `originacao`, e ali a spec está certa: o que a aprovação
 * entrega ao originador é o roteamento das NFs daquele sacado.)
 *
 * ─── O QUE ESTE JOB NÃO TOCA ────────────────────────────────────────────────
 *
 * As linhas de `origem = 'manual'`. Elas são o clique de alguém, e fechá-las porque a
 * titularidade caiu é literalmente o caso que o §2 proíbe: "perder titularidade por
 * dormência não remove o seguir manual".
 */

/*
 * Uma consulta, não N+1. A titularidade é `vendedor_carteira` × `empresas` pelo CNPJ, e
 * puxar as duas para o TypeScript para cruzá-las em memória seria duas leituras grandes
 * para responder o que o Postgres responde num join.
 */
const SQL_TITULARES = `
select distinct c.vendedor_id as originador_id, e.cnpj as fornecedor_cnpj
from public.vendedor_carteira c
  join public.empresas e on e.id = c.empresa_id
  join public.vendedores v on v.id = c.vendedor_id and v.ativo
where c.papel = 'originador'
  and c.ate is null
  and e.cnpj ~ '^[0-9]{14}$'`

export interface ResultadoSincronizarSeguidos {
  titulares: number
  abertos: number
  fechados: number
}

export async function sincronizarSeguidos(): Promise<ResultadoSincronizarSeguidos> {
  const { rows } = await pool.query<{ originador_id: string; fornecedor_cnpj: string }>(SQL_TITULARES)
  const vigentesAgora = new Set(rows.map((r) => `${r.originador_id}|${r.fornecedor_cnpj}`))

  const { data: espelhados, error } = await supabaseAdmin
    .from('fornecedores_seguidos')
    .select('id, originador_id, fornecedor_cnpj')
    .eq('origem', 'titularidade')
    .is('ate', null)
  if (error) throw new Error(`Falha ao ler os seguidos por titularidade: ${error.message}`)

  const jaEspelhados = new Set((espelhados ?? []).map((s) => `${s.originador_id}|${s.fornecedor_cnpj}`))

  const novos = rows
    .filter((r) => !jaEspelhados.has(`${r.originador_id}|${r.fornecedor_cnpj}`))
    .map((r) => ({
      originador_id: r.originador_id,
      fornecedor_cnpj: r.fornecedor_cnpj,
      origem: 'titularidade' as const,
    }))

  if (novos.length > 0) {
    const { error: e } = await supabaseAdmin.from('fornecedores_seguidos').insert(novos)
    if (e) throw new Error(`Falha ao abrir vínculos de titularidade: ${e.message}`)
  }

  /*
   * FECHA em vez de apagar. `desde`/`ate` é uma linha do tempo, e é ela que responde
   * "desde quando ele via este fluxo?" — a diferença entre uma oportunidade perdida e
   * uma que nunca esteve na mesa de ninguém.
   */
  const caducos = (espelhados ?? []).filter(
    (s) => !vigentesAgora.has(`${s.originador_id}|${s.fornecedor_cnpj}`),
  )
  if (caducos.length > 0) {
    const { error: e } = await supabaseAdmin
      .from('fornecedores_seguidos')
      .update({ ate: new Date().toISOString() })
      .in('id', caducos.map((c) => c.id))
    if (e) throw new Error(`Falha ao fechar vínculos de titularidade: ${e.message}`)
  }

  const r = { titulares: rows.length, abertos: novos.length, fechados: caducos.length }
  logger.info(r, 'Cedentes seguidos por titularidade sincronizados.')
  return r
}
