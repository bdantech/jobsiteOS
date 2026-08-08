/**
 * Similaridade por trigramas — a MESMA definição do `pg_trgm`, reimplementada
 * aqui de propósito.
 *
 * O casamento acontece em dois passos, e essa divisão é o ponto:
 *   1. O POSTGRES filtra. Um `ilike '%TOKEN%'` sobre `razao_social` usa o índice
 *      GIN de trigramas que a migração 0011 criou (`gin_trgm_ops` indexa
 *      justamente LIKE/ILIKE), então varrer 2M de linhas custa um index scan e
 *      não um seq scan.
 *   2. O NODE ordena. `similarity()` não está exposto pelo PostgREST — não há
 *      RPC para ele, e criar uma é uma migração que este agente não pode
 *      escrever. Rankear no servidor Node as ~25 linhas que o passo 1 devolveu
 *      dá o mesmo resultado que `order by similarity(...)` daria, e custa
 *      microssegundos.
 *
 * O que sai daqui vai para `importacoes_linhas.candidatos`, e um humano decide.
 * Nada é resolvido automaticamente por similaridade: um match de 0,9 entre
 * "CONSTRUTORA SILVA LTDA" e "CONSTRUTORA SILVA S/A" pode ser duas empresas
 * diferentes do mesmo dono, e criar a empresa errada contamina o funil inteiro.
 */

/** Ruído societário: aparece em metade das razões sociais e não distingue ninguém. */
const RUIDO = new Set([
  'ltda',
  'me',
  'epp',
  'sa',
  's',
  'a',
  'eireli',
  'mei',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'cia',
  'companhia',
  'spe',
])

/**
 * Palavras que atrapalham a COMPARAÇÃO, não só a busca — saem do nome antes de
 * qualquer coisa.
 *
 * "GRUPO" é o caso que motivou isto. Ele tem 5 letras, não é ruído societário nem
 * genérico do setor, então `tokenDeBusca` o escolhia como âncora: "GRUPO MONTO"
 * buscava por GRUPO e trazia 60 empresas com "grupo" no nome, nenhuma delas a certa.
 * E na hora de pontuar, os trigramas de GRUPO ainda diluíam a semelhança com a razão
 * social do universo, que quase nunca repete a palavra.
 *
 * Sai dos DOIS lados da comparação, porque `normalizarNome` roda no nome da planilha
 * e no do universo — assimetria aqui criaria uma penalidade em vez de resolver.
 */
const PALAVRAS_REMOVIDAS = new Set(['grupo', 'grupos'])

/** Genéricos do setor: presentes em quase toda construtora, então não servem de âncora de busca. */
const GENERICOS = new Set([
  'construtora',
  'construcoes',
  'construcao',
  'incorporadora',
  'incorporacoes',
  'incorporacao',
  'empreendimentos',
  'empreendimento',
  'imobiliarios',
  'imobiliaria',
  'engenharia',
  'participacoes',
  'holding',
  'administradora',
  'servicos',
  'comercio',
  'industria',
  'projetos',
  'obras',
])

export function normalizarNome(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()

  const palavras = limpo.split(' ').filter((p) => p && !PALAVRAS_REMOVIDAS.has(p.toLowerCase()))

  // "GRUPO" sozinho não vira string vazia: sem nada para comparar, o nome original
  // ao menos ainda é alguma coisa.
  return palavras.length > 0 ? palavras.join(' ') : limpo
}

/**
 * A âncora do ILIKE: a palavra mais longa que não é ruído nem genérica. É ela
 * que faz "CONSTRUTORA ZANCHETTA EMPREENDIMENTOS" buscar por ZANCHETTA em vez
 * de por CONSTRUTORA — e é a diferença entre 30 candidatos e 400 mil.
 */
export function tokenDeBusca(nome: string): string | null {
  const palavras = normalizarNome(nome)
    .split(' ')
    .filter((p) => p.length >= 4)

  const distintivas = palavras.filter(
    (p) => !RUIDO.has(p.toLowerCase()) && !GENERICOS.has(p.toLowerCase()),
  )

  const candidatas = distintivas.length > 0 ? distintivas : palavras
  if (candidatas.length === 0) return null

  return candidatas.reduce((maior, p) => (p.length > maior.length ? p : maior))
}

/** Igual ao pg_trgm: a palavra é cercada por dois espaços à esquerda e um à direita. */
function trigramas(texto: string): Set<string> {
  const conjunto = new Set<string>()

  for (const palavra of normalizarNome(texto).split(' ')) {
    if (!palavra) continue
    const acolchoado = `  ${palavra} `
    for (let i = 0; i < acolchoado.length - 2; i++) {
      conjunto.add(acolchoado.slice(i, i + 3))
    }
  }

  return conjunto
}

/** |A ∩ B| / |A ∪ B|, exatamente como `similarity()` do pg_trgm. */
export function similaridade(a: string, b: string): number {
  const ta = trigramas(a)
  const tb = trigramas(b)
  if (ta.size === 0 || tb.size === 0) return 0

  let intersecao = 0
  for (const t of ta) {
    if (tb.has(t)) intersecao++
  }

  const uniao = ta.size + tb.size - intersecao
  return uniao === 0 ? 0 : intersecao / uniao
}

/**
 * Matriz, não filial: os quatro dígitos de ordem do CNPJ são `0001`.
 *
 * No dump da Receita a razão social é da RAIZ — matriz e filiais têm exatamente o
 * mesmo nome e, portanto, exatamente a mesma similaridade. O desempate era a ordem
 * em que o índice devolvia, ou seja, nenhum critério. Uma lista publicada fala da
 * empresa, não de um estabelecimento: a matriz é a resposta certa quase sempre.
 */
export function ehMatriz(cnpj: string): boolean {
  return cnpj.length === 14 && cnpj.slice(8, 12) === '0001'
}

/**
 * Diferença de score abaixo da qual dois candidatos são considerados empatados, e a
 * matriz passa na frente. Não é zero porque a filial pode ter `nome_fantasia`
 * próprio e arranhar o score em alguns centésimos — o que não a torna a melhor
 * resposta, só a torna diferente.
 */
export const EMPATE_TECNICO = 0.02

/**
 * Quanto do nome buscado APARECE no candidato: |A ∩ B| / |A|.
 *
 * A similaridade de Jaccard divide pela UNIÃO, então nome curto contra razão social
 * longa tem teto baixo por construção — "GRUPO MONTO" contra "MONTO ENGENHARIA LTDA"
 * dá 0,27 e morria no corte de 0,3, mesmo sendo a empresa certa. Não é o nome que é
 * ruim, é a métrica que pune comprimento diferente.
 *
 * A cobertura não pune: ela pergunta se o que a planilha escreveu está inteiro
 * dentro do nome do universo. Medido nos casos reais desta importação, ela dá 1,00
 * nos acertos e 0,67 no melhor falso positivo ("MONTO" contra "MONTREAL").
 */
export function cobertura(buscado: string, candidato: string): number {
  const a = trigramas(buscado)
  if (a.size === 0) return 0
  const b = trigramas(candidato)

  let intersecao = 0
  for (const t of a) if (b.has(t)) intersecao++
  return intersecao / a.size
}

/** O default do pg_trgm. Abaixo disso, "candidato" é um chute. */
export const LIMITE_SIMILARIDADE = 0.3

/**
 * A segunda porta: entra também quem contém o nome buscado quase inteiro, ainda que
 * a similaridade fique baixa por diferença de comprimento. 0,8 é onde os acertos
 * (1,00) ficam de um lado e o falso positivo mais próximo (0,67) do outro.
 */
export const COBERTURA_MINIMA = 0.8

/** Mais que isso não é uma escolha, é uma lista de leitura. */
export const MAX_CANDIDATOS = 5

export interface Candidato {
  cnpj: string
  razao_social: string | null
  /** A marca. É por ela que uma lista publicada costuma chamar a empresa. */
  nome_fantasia: string | null
  uf: string | null
  municipio: string | null
  situacao_cadastral: string | null
  /** 0–1. Exibido como % na fila de resolução, para o revisor saber o quanto confiar. */
  score: number
}
