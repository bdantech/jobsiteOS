import { formatarCnj, type Polo } from './schemas.js'

/**
 * A parte PURA da integração com o Escavador (08 §3): consolidação da capa, leitura do
 * cursor e contabilização de créditos.
 *
 * O HTTP mora no worker (`apps/worker/src/juridico/escavador.ts`), que tem o token, o
 * throttle e o retry. O que está aqui é o que decide o CONTEÚDO de uma linha de
 * `processos` — e é exatamente o que precisa de teste, porque o payload da API tem
 * `fontes[]` (uma por grau/tribunal) e escolher a fonte errada troca o órgão julgador,
 * a comarca e o valor da causa de um processo inteiro.
 */

// ─── O formato que a API devolve ────────────────────────────────────────────

export interface EscavadorAdvogado {
  nome?: string | null
  oab?: { numero?: string | number | null; uf?: string | null } | null
  oabs?: Array<{ numero?: string | number | null; uf?: string | null }> | null
}

export interface EscavadorEnvolvido {
  nome?: string | null
  tipo_pessoa?: string | null
  cpf?: string | null
  cnpj?: string | null
  tipo?: string | null
  tipo_normalizado?: string | null
  polo?: string | null
  advogados?: EscavadorAdvogado[] | null
}

export interface EscavadorCapa {
  classe?: string | null
  assunto?: string | null
  area?: string | null
  orgao_julgador?: string | null
  valor_causa?: { valor?: number | string | null; moeda?: string | null } | number | string | null
  data_distribuicao?: string | null
  data_inicio?: string | null
  data_arquivamento?: string | null
  segredo_justica?: boolean | null
  arquivado?: boolean | null
  fisico?: boolean | null
}

export interface EscavadorFonte {
  id?: number | null
  processo_fonte_id?: number | null
  descricao?: string | null
  nome?: string | null
  sigla?: string | null
  tipo?: string | null
  grau?: number | null
  grau_formatado?: string | null
  sistema?: string | null
  url?: string | null
  tribunal?: { nome?: string | null; sigla?: string | null } | null
  capa?: EscavadorCapa | null
  envolvidos?: EscavadorEnvolvido[] | null
  data_ultima_movimentacao?: string | null
  quantidade_movimentacoes?: number | null
  data_ultima_verificacao?: string | null
}

export interface EscavadorProcesso {
  numero_cnj?: string | null
  titulo_polo_ativo?: string | null
  titulo_polo_passivo?: string | null
  ano_inicio?: number | null
  data_inicio?: string | null
  data_ultima_movimentacao?: string | null
  quantidade_movimentacoes?: number | null
  fontes_tribunais_estao_arquivadas?: boolean | null
  data_ultima_verificacao?: string | null
  tempo_desde_ultima_verificacao?: string | null
  estado_origem?: { nome?: string | null; sigla?: string | null } | null
  unidade_origem?: { nome?: string | null; cidade?: string | null; estado?: { sigla?: string | null } | null } | null
  match_documento_por?: string | null
  status_predito?: string | null
  fontes?: EscavadorFonte[] | null
}

export interface EscavadorMovimentacao {
  id?: number | null
  data?: string | null
  tipo?: string | null
  conteudo?: string | null
  fonte?: { nome?: string | null; sigla?: string | null; grau?: number | null } | null
}

// ─── Cursor ─────────────────────────────────────────────────────────────────

/**
 * A paginação do Escavador é por CURSOR (`links.next`), não por página.
 *
 * Devolver a URL inteira, e não extrair o parâmetro, é deliberado: o cursor é opaco e o
 * caminho pode mudar entre endpoints. Remontar a URL a partir de um `cursor=` extraído
 * é a forma de quebrar silenciosamente na primeira vez que eles acrescentarem um
 * parâmetro ao link — e o sintoma seria "a segunda página vem igual à primeira", que é
 * um laço infinito, não um erro.
 */
export function proximaPagina(resposta: unknown): string | null {
  if (typeof resposta !== 'object' || resposta === null) return null
  const links = (resposta as { links?: { next?: unknown } }).links
  const next = links?.next
  return typeof next === 'string' && next.length > 0 ? next : null
}

/**
 * `Creditos-Utilizados` do header da resposta. Ausente → 0, nunca `null`: a soma do
 * painel de gasto não pode carregar um buraco que o `+` transforma em `NaN`.
 */
export function creditosDoHeader(headers: { get(nome: string): string | null }): number {
  const bruto = headers.get('Creditos-Utilizados') ?? headers.get('creditos-utilizados')
  const n = Number(bruto)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ─── Consolidação da capa ───────────────────────────────────────────────────

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')) : Number(v)
  return Number.isFinite(n) ? n : null
}

function valorDaCausa(capa: EscavadorCapa | null | undefined): number | null {
  const v = capa?.valor_causa
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return numeroOuNulo((v as { valor?: unknown }).valor)
  return numeroOuNulo(v)
}

/**
 * A fonte PRINCIPAL é a de MENOR grau (§3.2).
 *
 * O primeiro grau é onde o processo corre: é dele a comarca, o órgão julgador e o valor
 * da causa que o advogado usa. O segundo grau carrega a capa do recurso — mesmo número
 * CNJ, outro órgão julgador ("3ª Câmara Cível"), às vezes outro valor. Guardar a fonte
 * de grau maior como principal faria a lista mostrar o tribunal de recurso como se fosse
 * a vara de origem, e a comarca sumiria justo nos processos mais avançados.
 *
 * Fonte sem grau vai para o fim: um `null` ordenado como zero venceria o primeiro grau.
 */
export function fontePrincipal(fontes: readonly EscavadorFonte[] | null | undefined): EscavadorFonte | null {
  const lista = (fontes ?? []).filter((f) => f !== null && f !== undefined)
  if (lista.length === 0) return null
  return [...lista].sort((a, b) => (a.grau ?? 99) - (b.grau ?? 99))[0] ?? null
}

export interface CapaConsolidada {
  numero_cnj: string
  classe: string | null
  assunto: string | null
  area: string | null
  orgao_julgador: string | null
  comarca: string | null
  uf: string | null
  tribunal_sigla: string | null
  tribunal_nome: string | null
  grau: number | null
  sistema: string | null
  valor_causa: number | null
  data_distribuicao: string | null
  data_inicio: string | null
  data_arquivamento: string | null
  segredo_justica: boolean | null
  arquivado: boolean | null
  fisico: boolean | null
  status_predito: string | null
  url_tribunal: string | null
  titulo_polo_ativo: string | null
  titulo_polo_passivo: string | null
  data_ultima_movimentacao: string | null
  qtd_movimentacoes: number | null
  data_ultima_verificacao: string | null
}

/** Só a data (AAAA-MM-DD) — as colunas de capa são `date`, não `timestamptz`. */
function soData(v: string | null | undefined): string | null {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function consolidarCapa(p: EscavadorProcesso): CapaConsolidada | null {
  const numero = p.numero_cnj ? formatarCnj(p.numero_cnj) : null
  if (!numero) return null

  const f = fontePrincipal(p.fontes)
  const capa = f?.capa ?? null

  return {
    numero_cnj: numero,
    classe: capa?.classe ?? null,
    assunto: capa?.assunto ?? null,
    area: capa?.area ?? null,
    orgao_julgador: capa?.orgao_julgador ?? null,
    // A comarca vem da unidade de origem do processo, não da capa da fonte: a capa
    // nomeia o órgão ("2ª Vara Cível"), e o órgão sem a cidade não localiza nada.
    comarca: p.unidade_origem?.cidade ?? p.unidade_origem?.nome ?? null,
    uf: p.estado_origem?.sigla ?? p.unidade_origem?.estado?.sigla ?? null,
    tribunal_sigla: f?.tribunal?.sigla ?? f?.sigla ?? null,
    tribunal_nome: f?.tribunal?.nome ?? f?.nome ?? null,
    grau: f?.grau ?? null,
    sistema: f?.sistema ?? null,
    valor_causa: valorDaCausa(capa),
    data_distribuicao: soData(capa?.data_distribuicao),
    data_inicio: soData(capa?.data_inicio ?? p.data_inicio),
    data_arquivamento: soData(capa?.data_arquivamento),
    segredo_justica: capa?.segredo_justica ?? null,
    // `arquivado` do processo vale mais que o da capa de UMA fonte: o campo do topo
    // responde "está arquivado em todos os tribunais", que é a pergunta da lista.
    arquivado: p.fontes_tribunais_estao_arquivadas ?? capa?.arquivado ?? null,
    fisico: capa?.fisico ?? null,
    status_predito: p.status_predito ?? null,
    url_tribunal: f?.url ?? null,
    titulo_polo_ativo: p.titulo_polo_ativo ?? null,
    titulo_polo_passivo: p.titulo_polo_passivo ?? null,
    data_ultima_movimentacao: soData(p.data_ultima_movimentacao ?? f?.data_ultima_movimentacao),
    qtd_movimentacoes: p.quantidade_movimentacoes ?? f?.quantidade_movimentacoes ?? null,
    data_ultima_verificacao: p.data_ultima_verificacao ?? f?.data_ultima_verificacao ?? null,
  }
}

// ─── Envolvidos e o vínculo com `empresas` ──────────────────────────────────

export interface EnvolvidoNormalizado {
  nome: string
  tipo_pessoa: string | null
  cpf_cnpj: string | null
  tipo: string | null
  tipo_normalizado: string | null
  polo: Polo | null
  advogados: { nome: string | null; oab_numero: string | null; oab_uf: string | null }[]
}

const POLO_ATIVO = new Set(['ATIVO', 'ativo', 'AUTOR', 'EXEQUENTE', 'REQUERENTE'])
const POLO_PASSIVO = new Set(['PASSIVO', 'passivo', 'REU', 'RÉU', 'EXECUTADO', 'REQUERIDO'])

/** `ativo` | `passivo` | null. Um polo desconhecido é null, nunca um chute. */
export function normalizarPolo(polo: string | null | undefined): Polo | null {
  if (!polo) return null
  const p = polo.trim()
  if (POLO_ATIVO.has(p) || POLO_ATIVO.has(p.toUpperCase())) return 'ativo'
  if (POLO_PASSIVO.has(p) || POLO_PASSIVO.has(p.toUpperCase())) return 'passivo'
  return null
}

export function normalizarEnvolvidos(
  fontes: readonly EscavadorFonte[] | null | undefined,
): EnvolvidoNormalizado[] {
  const porChave = new Map<string, EnvolvidoNormalizado>()

  for (const f of fontes ?? []) {
    for (const e of f.envolvidos ?? []) {
      const nome = (e.nome ?? '').trim()
      if (!nome) continue
      const polo = normalizarPolo(e.polo)
      // A chave é (nome, polo) — a MESMA do índice único da tabela. A dedup precisa
      // acontecer aqui, e não no upsert: o mesmo envolvido aparece uma vez por fonte, e
      // um upsert em lote com duas linhas da mesma chave é `ON CONFLICT DO UPDATE
      // command cannot affect row a second time`, que derruba a importação inteira.
      const chave = `${nome}|${polo ?? ''}`
      const advogados = (e.advogados ?? []).map((a) => {
        const oab = a.oab ?? a.oabs?.[0] ?? null
        return {
          nome: a.nome ?? null,
          oab_numero: oab?.numero !== null && oab?.numero !== undefined ? String(oab.numero) : null,
          oab_uf: oab?.uf ?? null,
        }
      })

      const existente = porChave.get(chave)
      if (existente) {
        // Fonte de outro grau pode trazer o CNPJ que a primeira omitiu, e trazer mais
        // advogados. Completar em vez de substituir: perder o CNPJ aqui é perder o
        // vínculo com `empresas`, que é a razão de a importação existir.
        existente.cpf_cnpj ??= e.cnpj ?? e.cpf ?? null
        existente.tipo_normalizado ??= e.tipo_normalizado ?? null
        for (const a of advogados) {
          if (!existente.advogados.some((x) => x.nome === a.nome)) existente.advogados.push(a)
        }
        continue
      }

      porChave.set(chave, {
        nome,
        tipo_pessoa: e.tipo_pessoa ?? null,
        cpf_cnpj: e.cnpj ?? e.cpf ?? null,
        tipo: e.tipo ?? null,
        tipo_normalizado: e.tipo_normalizado ?? null,
        polo,
        advogados,
      })
    }
  }

  return [...porChave.values()]
}

const SO_DIGITOS = /\D/g

/**
 * Em que polo ESTAMOS, e quem é o devedor (§3).
 *
 * O devedor é procurado no polo OPOSTO ao nosso, e por CNPJ — nunca por nome. "Construtora
 * Alfa Ltda" e "CONSTRUTORA ALFA LTDA - EM RECUPERAÇÃO JUDICIAL" são a mesma empresa com
 * dois nomes, e são duas empresas diferentes quando a razão social é parecida por acaso.
 * Casar por nome produziria vínculos errados na ficha de uma empresa que nada tem a ver
 * com a ação, e o erro apareceria como um processo na Company 360 de outra pessoa.
 */
export function identificarPartes(
  envolvidos: readonly EnvolvidoNormalizado[],
  nossosCnpjs: readonly string[],
): { nosso_cnpj: string | null; polo_nosso: Polo | null; cnpjs_devedores: string[] } {
  const nossos = new Set(nossosCnpjs.map((c) => c.replace(SO_DIGITOS, '')))

  let nosso: string | null = null
  let poloNosso: Polo | null = null

  for (const e of envolvidos) {
    const doc = (e.cpf_cnpj ?? '').replace(SO_DIGITOS, '')
    if (doc.length === 14 && nossos.has(doc)) {
      nosso = doc
      poloNosso = e.polo
      break
    }
  }

  // Sem saber o nosso polo não há "polo oposto", e chutar produziria o devedor errado
  // com a mesma confiança do acerto. Nesse caso o processo entra com `empresa_devedora_id`
  // nulo e vai para a fila de vinculação manual.
  const oposto: Polo | null = poloNosso === 'ativo' ? 'passivo' : poloNosso === 'passivo' ? 'ativo' : null

  const devedores = oposto
    ? envolvidos
        .filter((e) => e.polo === oposto)
        .map((e) => (e.cpf_cnpj ?? '').replace(SO_DIGITOS, ''))
        .filter((d) => d.length === 14 && !nossos.has(d))
    : []

  return { nosso_cnpj: nosso, polo_nosso: poloNosso, cnpjs_devedores: [...new Set(devedores)] }
}

/** `ANDAMENTO` | `PUBLICACAO`. Qualquer outra coisa vira `ANDAMENTO` — o caso geral. */
export function normalizarTipoMovimentacao(tipo: string | null | undefined): 'ANDAMENTO' | 'PUBLICACAO' {
  const t = (tipo ?? '').toUpperCase()
  return t.startsWith('PUBLICA') ? 'PUBLICACAO' : 'ANDAMENTO'
}

// ─── A varredura por cursor ─────────────────────────────────────────────────

export interface PaginaVarrida<T> {
  itens: T[]
  creditos: number
  paginas: number
  /** Parou no teto de páginas ou num cursor repetido — a lista está INCOMPLETA. */
  truncado: boolean
}

/**
 * Percorre todas as páginas de um endpoint paginado por cursor.
 *
 * Recebe a função que busca (o HTTP mora no worker, com o token e o throttle) e a
 * que extrai os itens. Fica aqui, e não lá, porque as duas defesas abaixo são a
 * parte que precisa de teste — e testá-las no worker exigiria uma rede falsa:
 *
 *   1. **CURSOR REPETIDO PARA A VARREDURA.** `links.next` é opaco. Uma API que
 *      devolva a mesma URL duas vezes — e paginações por cursor já fizeram isso —
 *      viraria um laço infinito gastando crédito a 460 chamadas por minuto. O
 *      sintoma seria uma fatura, não um erro.
 *   2. **TETO DE PÁGINAS.** Mesmo sem repetição, uma cadeia que não termina tem de
 *      parar em algum lugar.
 *
 * Nos dois casos o resultado volta marcado como `truncado`, e é isso que separa
 * "não há mais processos" de "paramos de olhar". Quem chama registra a diferença.
 */
export async function varrerCursor<T>(
  inicial: string,
  buscar: (url: string) => Promise<{ dados: unknown; creditos: number }>,
  extrair: (pagina: unknown) => T[],
  maxPaginas = 200,
): Promise<PaginaVarrida<T>> {
  const itens: T[] = []
  const vistas = new Set<string>()
  let creditos = 0
  let paginas = 0
  let proxima: string | null = inicial

  while (proxima) {
    if (vistas.has(proxima)) return { itens, creditos, paginas, truncado: true }
    if (paginas >= maxPaginas) return { itens, creditos, paginas, truncado: true }
    vistas.add(proxima)

    const r = await buscar(proxima)
    paginas++
    creditos += r.creditos
    itens.push(...extrair(r.dados))
    proxima = proximaPagina(r.dados)
  }

  return { itens, creditos, paginas, truncado: false }
}
