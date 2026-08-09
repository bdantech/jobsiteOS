/**
 * Ler TODAS as linhas de uma consulta PostgREST, e não as primeiras mil.
 *
 * Existe por causa de um bug que custou meia base: o PostgREST corta a resposta em
 * `db-max-rows` (mil, no padrão do Supabase) e **não avisa** — não há erro, não há
 * flag, a resposta simplesmente vem menor. Um lote de 1.614 domínios processou 1.000
 * itens, marcou-se como concluído e deixou 614 pendentes que ninguém tinha como ver.
 *
 * O modo de falhar é o pior possível: silencioso, e proporcional ao tamanho do dado.
 * Funciona em desenvolvimento, funciona nos primeiros meses, e quebra exatamente
 * quando a base cresce o bastante para importar.
 *
 * Recebe uma FÁBRICA de consulta, não a consulta: um builder do supabase-js é
 * thenable e só pode ser executado uma vez, então cada página precisa de um novo.
 */

export interface RespostaPagina<T> {
  data: T[] | null
  error: { message: string } | null
}

export async function todasAsPaginas<T>(
  consulta: (de: number, ate: number) => PromiseLike<RespostaPagina<T>>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = []
  let de = 0

  for (;;) {
    const { data, error } = await consulta(de, de + tamanho - 1)
    if (error) throw new Error(error.message)
    const pagina = data ?? []
    todas.push(...pagina)
    // Página incompleta é o fim: pedir a próxima só devolveria vazio.
    if (pagina.length < tamanho) return todas
    de += tamanho
  }
}
