/**
 * Quem é o sacado de uma nota — em uma linha, ou em duas.
 *
 * O card mostra a CONTA em cima (a empresa a que tudo está amarrado, e é por ela que a
 * pessoa pensa) e, embaixo, a SPE contra a qual a nota foi emitida, que é o que
 * identifica DE QUAL OBRA ela é. A segunda linha só faz sentido quando são duas empresas
 * diferentes.
 *
 * ─── O CRITÉRIO É O CNPJ, E NUNCA O NOME ───────────────────────────────────
 * A regra antiga comparava os dois nomes. Eles vêm de lugares diferentes: o da conta é a
 * razão social do NOSSO cadastro; o do sacado é o que o FORNECEDOR digitou no XML da
 * NF-e. Na base de hoje isso produz coisas como
 *
 *     RIBEIRO CARAM               ←→  CONSTRUTURA RIBERIO CARAM LTDA
 *     HALSTEN INCORPORADORA LTDA  ←→  HALSTEN INCORPARADORA LTDA
 *     CALURE EMPREENDIMENTOS LTDA ←→  Calure empreendimentos ltda
 *
 * — todas com o MESMO CNPJ, todas sem SPE nenhuma, e todas mostrando "via {a mesma
 * empresa, escrita errado}" numa linha própria. Eram 85 de 101 pares.
 *
 * Normalizar o texto não resolveria: "CONSTRUTURA RIBERIO" não casa com "RIBEIRO CARAM"
 * por régua nenhuma que seja segura — e não DEVE casar. Similaridade de nome é para
 * quando não existe identificador; aqui existe um, exato, do lado.
 */

export interface ContaDoSacadoResolvida {
  nome: string
  /** Nulo em cadastro sem CNPJ. Nesse caso a segunda linha volta a aparecer. */
  cnpj: string | null
}

/**
 * O nome da SPE a mostrar debaixo da conta — ou `null` quando repeti-lo não diz nada.
 *
 * Com CNPJ faltando de um dos lados a função prefere MOSTRAR: uma linha a mais é ruído,
 * uma SPE escondida é "de qual obra é esta nota?" sem resposta na tela. O erro barato e
 * o erro caro não são simétricos, e a dúvida vai para o lado barato.
 */
export function speDoSacado(
  conta: ContaDoSacadoResolvida | null | undefined,
  sacadoCnpj: string | null | undefined,
  sacadoNome: string,
): string | null {
  if (!conta) return null
  // A mesma pessoa jurídica: não há segunda empresa para nomear.
  if (conta.cnpj && sacadoCnpj && conta.cnpj === sacadoCnpj) return null
  // Cadastro antigo às vezes traz o nome idêntico; aí a segunda linha também é ruído.
  if (conta.nome === sacadoNome) return null
  return sacadoNome
}
