import type { Consultavel } from '../../db.js'
import {
  compileToSql,
  descrever,
  isGrupo,
  type Grupo,
  type No,
} from '../../../../../packages/core/src/mercado/filters.js'
import type {
  AuditoriaCamada,
  AuditoriaFaixas,
  CondicaoBarreira,
  TaxaPorFaixa,
} from '../../../../../packages/core/src/perfil/auditoria.js'
import { deslocarPlaceholders, regrasAtivas } from '../../derivadas/regras.js'

/**
 * A auditoria do §5 — rodar quem REALMENTE opera através da régua vigente.
 *
 * É a parte que morde porque produz uma frase que ninguém quer ler e todo mundo
 * precisa: "38% dos seus sacados pesados não passariam na regra de SOM". A régua
 * é lida todo dia; o que ela DEIXA DE FORA, nunca — porque quem fica de fora não
 * aparece em tela nenhuma.
 *
 * O compilador é o MESMO da reclassificação (`compileToSql`). Auditar com uma
 * segunda implementação da regra seria auditar uma regra que não existe.
 */

/** As condições do TOPO da regra. É por elas que um ajuste entra. */
function condicoesDoTopo(arvore: Grupo): No[] {
  return arvore.condicoes
}

/**
 * Quem NÃO passa, incluindo os nulos.
 *
 * `not (cond)` é NULL quando `cond` é NULL, e um `count(*) filter (where not …)`
 * simplesmente não conta essas linhas. Mas para a regra, capital nulo NÃO passa —
 * então elas são exatamente as que precisam ser contadas. Sem o coalesce, uma
 * condição sobre uma coluna esparsa pareceria não barrar ninguém.
 */
function naoPassa(sql: string): string {
  return `coalesce(${sql}, false) = false`
}

export async function auditarCamada(
  db: Consultavel,
  camada: string,
  versao: number,
  definicao: Grupo,
  cnpjs: readonly string[],
  coorte: string,
  hoje = new Date(),
): Promise<AuditoriaCamada> {
  const vazia: AuditoriaCamada = {
    camada,
    versao,
    coorte,
    total: 0,
    passam: 0,
    nao_passam: 0,
    sem_cadastro: cnpjs.length,
    barreiras: [],
    definicao,
  }
  if (cnpjs.length === 0) return vazia

  const condicoes = condicoesDoTopo(definicao)
  const values: unknown[] = [cnpjs]
  const selects: string[] = []

  // A regra inteira.
  const regra = compileToSql(definicao, hoje)
  selects.push(
    `count(*) filter (where ${deslocarPlaceholders(regra.text, values.length)})::int as passam`,
  )
  values.push(...regra.values)

  // Cada condição do topo, sozinha.
  condicoes.forEach((no, i) => {
    // Uma condição solta precisa virar um grupo para o compilador aceitar.
    const arvore: Grupo = isGrupo(no) ? no : { operador: 'e', condicoes: [no] }
    const c = compileToSql(arvore, hoje)
    selects.push(
      `count(*) filter (where ${naoPassa(deslocarPlaceholders(c.text, values.length))})::int as barrados_${i}`,
    )
    values.push(...c.values)
  })

  // `count(*)` junto: o total avaliável é quantos da coorte o universo conhece,
  // e não quantos a coorte tem. A diferença vira `sem_cadastro` — sem isso, os
  // fornecedores que operam mas nunca passaram pelo lookup entrariam na conta
  // como se a régua os tivesse reprovado.
  selects.unshift('count(*)::int as avaliaveis')

  const { rows } = await db.query<Record<string, number>>(
    `select ${selects.join(', ')} from mercado_explorador where cnpj = any($1)`,
    values,
  )
  const r = rows[0]
  if (!r) return vazia

  const total = Number(r.avaliaveis ?? 0)
  if (total === 0) return vazia

  const barreiras: CondicaoBarreira[] = condicoes
    .map((no, i) => {
      const barrados = Number(r[`barrados_${i}`] ?? 0)
      return {
        indice: i,
        descricao: descrever(no),
        barrados,
        fracao: total > 0 ? barrados / total : 0,
        no,
      }
    })
    .filter((b) => b.barrados > 0)
    .sort((a, b) => b.barrados - a.barrados)

  const passam = Number(r.passam ?? 0)
  return {
    camada,
    versao,
    coorte,
    total,
    passam,
    nao_passam: total - passam,
    sem_cadastro: cnpjs.length - total,
    barreiras,
    definicao,
  }
}

export async function auditarCamadas(
  db: Consultavel,
  cnpjs: readonly string[],
  coorte: string,
): Promise<AuditoriaCamada[]> {
  const regras = await regrasAtivas(db)
  const saida: AuditoriaCamada[] = []

  // SOM e SAM apenas. O TAM é o recorte de existência (construção, ativa, idade
  // e capital mínimos) — auditá-lo produziria a sugestão de afrouxar o que
  // define o mercado, que não é um ajuste de mira, é abrir mão dela.
  for (const regra of regras.filter((r) => r.camada === 'som' || r.camada === 'sam')) {
    saida.push(
      await auditarCamada(
        db,
        regra.camada,
        regra.versao,
        regra.definicao as Grupo,
        cnpjs,
        coorte,
      ),
    )
  }
  return saida
}

// ─── Faixas ─────────────────────────────────────────────────────────────────

/**
 * Taxa de conversão REAL por faixa, e quantas converteram fora de qualquer faixa.
 *
 * A `faixa` de uma nota convertida é confiável como "a faixa de quando ela
 * converteu": a reclassificação pula explicitamente `estagio_funil in
 * ('convertida','perdida')`, então o valor congela na saída do funil. Sem essa
 * propriedade, este número seria uma foto de hoje travestida de história.
 */
export async function auditarFaixas(
  db: Consultavel,
  janelaDias: number,
): Promise<AuditoriaFaixas> {
  const { rows } = await db.query<{
    faixa: string | null
    versao: number | null
    nfs: number
    convertidas: number
  }>(
    `select
       nf.faixa,
       max(nf.faixa_regra_versao)::int as versao,
       count(*)::int as nfs,
       count(*) filter (where nf.estagio_funil = 'convertida')::int as convertidas
     from notas_fiscais nf
     where nf.sincronizada_em >= now() - make_interval(days => $1)
     group by nf.faixa`,
    [janelaDias],
  )

  const porFaixa: TaxaPorFaixa[] = rows
    .filter((r) => r.faixa !== null)
    .map((r) => ({
      faixa: r.faixa as string,
      versao: r.versao,
      nfs: Number(r.nfs),
      convertidas: Number(r.convertidas),
      taxa: Number(r.nfs) > 0 ? Number(r.convertidas) / Number(r.nfs) : 0,
    }))
    .sort((a, b) => b.taxa - a.taxa)

  // As convertidas contam TODAS, dentro e fora da janela de sincronização: a
  // pergunta "quantas converteram fora de faixa" é sobre o desfecho, e recortar
  // por data de sync esconderia justamente as antigas.
  const { rows: conv } = await db.query<{ total: number; sem_faixa: number }>(
    `select count(*)::int as total,
            count(*) filter (where faixa is null)::int as sem_faixa
     from notas_fiscais where estagio_funil = 'convertida'`,
  )
  const total = Number(conv[0]?.total ?? 0)
  const semFaixa = Number(conv[0]?.sem_faixa ?? 0)

  return {
    janela_dias: janelaDias,
    por_faixa: porFaixa,
    convertidas_total: total,
    convertidas_sem_faixa: semFaixa,
    fracao_sem_faixa: total > 0 ? semFaixa / total : 0,
  }
}
