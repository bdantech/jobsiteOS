/**
 * Natureza jurídica → uma categoria que cabe num card (04f §3).
 *
 * A Receita guarda o campo como `"2062 - Sociedade Empresária Limitada"`: código
 * de quatro dígitos, hífen, descrição. São dezenas de códigos, e nenhum perfil
 * legível por não-analista sobrevive a uma tabela com dezenas de linhas — por
 * isso a redução a quatro caixas.
 *
 * UMA descoberta que muda a leitura da categoria `eireli_slu`, e por isso está
 * aqui e não numa nota de rodapé: a EIRELI foi EXTINTA em 2021 e convertida em
 * Sociedade Limitada Unipessoal — que a Receita registra como **2062**, o mesmo
 * código de uma LTDA comum. Na base inteira sobraram 9 empresas com 2305. Ou
 * seja: esta categoria é residual por construção, e a ausência dela num achado
 * não diz nada sobre unipessoais. Elas estão em `ltda`, indistinguíveis.
 */

export const CATEGORIAS_NJ = ['ltda', 'sa', 'eireli_slu', 'outras'] as const
export type CategoriaNaturezaJuridica = (typeof CATEGORIAS_NJ)[number]

export const CATEGORIA_NJ_LABELS: Record<CategoriaNaturezaJuridica, string> = {
  ltda: 'LTDA',
  sa: 'S.A.',
  eireli_slu: 'EIRELI/SLU',
  outras: 'Outras',
}

/**
 * Códigos da tabela de natureza jurídica da RFB (2021), sem o dígito separador.
 *
 * `2240 — Sociedade Simples Limitada` entra em LTDA porque é, literalmente, uma
 * limitada: o que separa "simples" de "empresária" é o objeto social, não a
 * responsabilidade dos sócios — e é a responsabilidade que interessa a quem lê
 * um perfil de crédito.
 *
 * `2127 — Sociedade em Conta de Participação` fica em `outras` de propósito,
 * apesar do volume (2.377 na SAM+SOM): é um veículo de investimento sem
 * personalidade jurídica própria, e agrupá-la com LTDA misturaria duas coisas
 * que se comportam de formas opostas na análise.
 */
const LTDA = new Set(['2062', '2240'])
const SA = new Set(['2046', '2054', '2038'])
const EIRELI_SLU = new Set(['2305', '2313', '2321'])

/** Extrai os 4 dígitos iniciais, aceitando `2062`, `206-2` e `2062 - Sociedade…`. */
export function codigoNaturezaJuridica(valor: string | null | undefined): string | null {
  if (!valor) return null
  const digitos = String(valor).trim().replace(/\D/g, '')
  return digitos.length >= 4 ? digitos.slice(0, 4) : null
}

/**
 * `null` quando não há código — e `null` NÃO é "outras". A diferença importa: um
 * perfil precisa distinguir "esta empresa é de outro tipo societário" de "não
 * sabemos o tipo societário desta empresa", porque a segunda entra na cobertura
 * e a primeira não.
 */
export function categoriaNaturezaJuridica(
  valor: string | null | undefined,
): CategoriaNaturezaJuridica | null {
  const codigo = codigoNaturezaJuridica(valor)
  if (!codigo) return null
  if (LTDA.has(codigo)) return 'ltda'
  if (SA.has(codigo)) return 'sa'
  if (EIRELI_SLU.has(codigo)) return 'eireli_slu'
  return 'outras'
}
