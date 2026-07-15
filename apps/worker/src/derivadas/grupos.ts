import type pg from 'pg'
import { copiarLinhas } from '../pg/copy.js'
import { logger } from '../logger.js'

/**
 * Grupo econômico assembly (§3.2.2): connected components over sócio-PJ edges.
 *
 * Done in Node, not in SQL. A recursive CTE would need one pass per level of the
 * ownership chain and re-scan the edge set every time; the edge list is ~1M rows
 * (a few dozen MB), so union-find in memory is one linear pass — and it makes the
 * head-selection rule readable, which matters more than the microseconds.
 *
 * Components are computed at the RAIZ (8-digit) level, not the CNPJ level: an
 * establishment is not a member of a group, its company is. Groups of one raiz are
 * not groups — a company that owns nothing and is owned by nobody gets grupo_id
 * null, and the Explorador is spared 1.5M "groups" of one.
 */

interface Aresta {
  mae: string
  filha: string
}

class UnionFind {
  private readonly pai = new Map<string, string>()

  /** Iterative on purpose: an ownership chain can be deep, and a stack overflow
   *  halfway through 1M edges would take the whole ingestion down. */
  achar(x: string): string {
    let raiz = x
    let proximo = this.pai.get(raiz)
    while (proximo !== undefined && proximo !== raiz) {
      raiz = proximo
      proximo = this.pai.get(raiz)
    }
    // path compression
    let atual = x
    while (atual !== raiz) {
      const pai = this.pai.get(atual) ?? raiz
      this.pai.set(atual, raiz)
      atual = pai
    }
    this.pai.set(raiz, raiz)
    return raiz
  }

  unir(a: string, b: string): void {
    const ra = this.achar(a)
    const rb = this.achar(b)
    if (ra !== rb) this.pai.set(ra, rb)
  }
}

export interface ResultadoGrupos {
  arestas: number
  grupos: number
  membros: number
}

export async function montarGrupos(client: pg.Client): Promise<ResultadoGrupos> {
  // Edges: sócio-PJ (mãe) → participada (filha). Both ends must exist in the
  // universe, otherwise the "group" would have a member we know nothing about.
  const { rows: arestas } = await client.query<Aresta>(
    `select distinct
       left(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g'), 8) as mae,
       left(s.cnpj, 8) as filha
     from mercado_socios s
     where s.tipo_socio = 'PJ'
       and length(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g')) = 14
       and left(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g'), 8) <> left(s.cnpj, 8)
       and exists (
         select 1 from mercado_universo m
         where m.cnpj_raiz = left(regexp_replace(s.cpf_cnpj_socio, '\\D', '', 'g'), 8)
       )`,
  )

  const uf = new UnionFind()
  const filhas = new Map<string, number>() // out-degree: how many companies it owns
  const donos = new Map<string, number>() // in-degree: how many PJs own it

  for (const a of arestas) {
    uf.unir(a.mae, a.filha)
    filhas.set(a.mae, (filhas.get(a.mae) ?? 0) + 1)
    donos.set(a.filha, (donos.get(a.filha) ?? 0) + 1)
  }

  // component root → members. A Set, not an array: `includes` on a component with
  // 400 SPEs, a million times over, is the difference between seconds and minutes.
  const componentes = new Map<string, Set<string>>()
  for (const a of arestas) {
    for (const raiz of [a.mae, a.filha]) {
      const c = uf.achar(raiz)
      const membros = componentes.get(c)
      if (membros) membros.add(raiz)
      else componentes.set(c, new Set([raiz]))
    }
  }

  // Head = the top PJ: nobody in the cut owns it, and it owns the most. A cycle
  // (A owns B owns A — it happens) leaves no in-degree-zero candidate, so fall
  // back to the biggest owner in the component; picking none would drop the group.
  const cabecaDe = new Map<string, string>() // raiz → cabeça
  const cabecas: string[] = []

  for (const conjunto of componentes.values()) {
    if (conjunto.size < 2) continue
    const membros = [...conjunto]

    const candidatos = membros.filter((m) => (donos.get(m) ?? 0) === 0)
    const pool = candidatos.length > 0 ? candidatos : membros
    let cabeca = pool[0] as string
    for (const m of pool) {
      if ((filhas.get(m) ?? 0) > (filhas.get(cabeca) ?? 0)) cabeca = m
    }

    cabecas.push(cabeca)
    for (const m of membros) cabecaDe.set(m, cabeca)
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  await client.query('drop table if exists stg_membros')
  await client.query('create temp table stg_membros (cnpj_raiz text primary key, cnpj_cabeca text not null)')

  const membrosIterados = (async function* (): AsyncGenerator<readonly [string, string]> {
    for (const [raiz, cabeca] of cabecaDe) yield [raiz, cabeca] as const
  })()

  const totalMembros = await copiarLinhas(
    client,
    'stg_membros',
    ['cnpj_raiz', 'cnpj_cabeca'],
    membrosIterados,
  )
  await client.query('analyze stg_membros')

  // The group's name is the head's razão social — read from the matriz, so a
  // filial's row cannot name the group.
  await client.query(
    `insert into grupos_economicos (nome, cnpj_cabeca)
     select
       (select u.razao_social from mercado_universo u
        where u.cnpj_raiz = m.cnpj_cabeca
        order by (u.matriz_filial = 'matriz') desc nulls last, u.cnpj
        limit 1),
       m.cnpj_cabeca
     from (select distinct cnpj_cabeca from stg_membros) m
     where not exists (
       select 1 from grupos_economicos g where g.cnpj_cabeca = m.cnpj_cabeca
     )`,
  )

  // grupo_id lands on every establishment of every member raiz…
  await client.query(
    `update mercado_universo u
     set grupo_id = g.id
     from stg_membros m
     join grupos_economicos g on g.cnpj_cabeca = m.cnpj_cabeca
     where u.cnpj_raiz = m.cnpj_raiz
       and u.grupo_id is distinct from g.id`,
  )

  // …and is cleared where a company left its group (a sócio-PJ that is gone from
  // this month's QSA). Leaving a stale grupo_id would keep counting an SPE that
  // no longer belongs to the holding.
  await client.query(
    `update mercado_universo u
     set grupo_id = null
     where u.grupo_id is not null
       and not exists (select 1 from stg_membros m where m.cnpj_raiz = u.cnpj_raiz)`,
  )

  // Promoted / imported companies follow the universe (join by CNPJ, §3.2.2).
  await client.query(
    `update empresas e
     set grupo_id = u.grupo_id
     from mercado_universo u
     where u.cnpj = e.cnpj and e.grupo_id is distinct from u.grupo_id`,
  )

  const resultado = { arestas: arestas.length, grupos: cabecas.length, membros: totalMembros }
  logger.info(resultado, 'Grupos econômicos montados.')
  return resultado
}
