import { slugSchema } from './schemas.js'

/**
 * Duplicar uma landing page (04i).
 *
 * ── O QUE É COPIADO, E O QUE NÃO É ──────────────────────────────────────────
 * Copia-se a ESTRUTURA: campos, ordem, textos, pergunta de intenção,
 * consentimento, auto-resposta e destino. Não se copiam as métricas nem as
 * submissões — elas são o histórico daquela página, e uma cópia que nasce com 400
 * visualizações que nunca teve estraga o único número que decide se o problema
 * está no formulário ou no tráfego.
 *
 * ── E POR QUE O SLUG PRECISA DE CUIDADO ─────────────────────────────────────
 * Ele é único no banco, vira a URL pública e vira o nome do script colado na
 * landing page do cliente. Uma cópia que tenta nascer com o slug do original
 * falha com `duplicate key`; uma que nasce com um slug truncado no lugar errado
 * nasce com um endereço quebrado. Por isso a derivação é uma função testada e não
 * uma interpolação na tela.
 */

/** O mesmo limite do `slugSchema`. Repetido aqui porque a truncagem depende dele. */
const MAX_SLUG = 64
const MAX_NOME = 120
const SUFIXO = '-copia'

/** Corta sem deixar hífen na borda — `lp-antecipacao-` não passa no `slugSchema`. */
function aparar(s: string, limite: number): string {
  return s.slice(0, limite).replace(/-+$/, '')
}

/**
 * O slug da cópia, garantido único contra os que já existem.
 *
 * `-copia`, depois `-copia-2`, `-copia-3`. E a base é limpa do sufixo antes de
 * recebê-lo de novo: duplicar a cópia de uma cópia produziria
 * `lp-copia-copia-copia` até estourar os 64 caracteres, e o nome deixaria de
 * dizer de onde ela veio.
 */
export function slugDaCopia(slug: string, existentes: readonly string[]): string {
  const usados = new Set(existentes)
  const base = aparar(slug.replace(/-copia(-\d+)?$/, ''), MAX_SLUG - SUFIXO.length) || 'formulario'

  const primeiro = `${base}${SUFIXO}`
  if (!usados.has(primeiro)) return primeiro

  for (let n = 2; n <= 999; n++) {
    const sufixo = `${SUFIXO}-${n}`
    const candidato = `${aparar(base, MAX_SLUG - sufixo.length)}${sufixo}`
    if (!usados.has(candidato)) return candidato
  }

  /*
   * Mil cópias do mesmo formulário não acontecem, mas devolver um slug repetido
   * aconteceria: o insert falharia com uma mensagem de Postgres na cara de quem
   * clicou. O relógio sempre desempata.
   */
  const relogio = `${SUFIXO}-${Date.now().toString(36)}`
  return `${aparar(base, MAX_SLUG - relogio.length)}${relogio}`
}

/**
 * O nome interno da cópia. Só isto aparece na lista, então ele precisa dizer que
 * é cópia — duas linhas com o mesmo nome fazem alguém editar a página errada.
 */
export function nomeDaCopia(nome: string, existentes: readonly string[]): string {
  const usados = new Set(existentes)
  const base = nome.replace(/\s*\(cópia(\s+\d+)?\)$/u, '').trim() || 'Formulário'

  const primeiro = `${base.slice(0, MAX_NOME - 9)} (cópia)`
  if (!usados.has(primeiro)) return primeiro

  for (let n = 2; n <= 999; n++) {
    const sufixo = ` (cópia ${n})`
    const candidato = `${base.slice(0, MAX_NOME - sufixo.length)}${sufixo}`
    if (!usados.has(candidato)) return candidato
  }
  return `${base.slice(0, MAX_NOME - 20)} (cópia ${Date.now().toString(36)})`
}

/** A estrutura que a cópia herda. É o formulário menos identidade e menos status. */
export interface EstruturaFormulario {
  slug: string
  nome: string
  ativo: boolean
}

/**
 * A cópia, pronta para o construtor.
 *
 * `id` vazio é o que faz o construtor mostrar "Novo formulário" e o RPC INSERIR em
 * vez de atualizar — é a mesma convenção que o botão "Novo" usa.
 *
 * `ativo: false` é deliberado e não é timidez: publicar é a decisão de expor uma
 * URL ao público, e ela não pode acontecer como efeito colateral de um clique em
 * "Duplicar". Quem duplicou ainda vai trocar textos antes de querer tráfego ali.
 */
export function duplicarFormulario<T extends EstruturaFormulario>(
  original: T,
  existentes: readonly EstruturaFormulario[],
): T & { id: string } {
  return {
    ...original,
    id: '',
    slug: slugDaCopia(
      original.slug,
      existentes.map((e) => e.slug),
    ),
    nome: nomeDaCopia(
      original.nome,
      existentes.map((e) => e.nome),
    ),
    ativo: false,
  }
}

/** O slug derivado passa no schema? Usado só em teste — e é o que importa aqui. */
export function slugValido(slug: string): boolean {
  return slugSchema.safeParse(slug).success
}
