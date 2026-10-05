import { DOMINIOS_GENERICOS } from '../comunicacao/identificador.js'

/**
 * VINCULAÇÃO DE CONTAS A EMPRESAS (05C §10) — a cascata que tira da mão do comercial o
 * casamento de "quem é este número / este e-mail".
 *
 *   determinístico (grátis) → shortlist → Jev pontua cada par → banda cinzenta: Claude → humano
 *
 * A ordem é a do custo, e cada degrau só vê o que o anterior não resolveu.
 *
 * ─── OS TRÊS MODOS DE FALHA CONHECIDOS ──────────────────────────────────────
 * - **E-mail pessoal** (gmail, hotmail…) não diz nada sobre empresa. Não se força: vai
 *   para humano marcado como não resolvível automaticamente.
 * - **Base com empresa duplicada** derruba a precisão — a mesma construtora com matriz e
 *   duas filiais parece três candidatas empatadas. Deduplica pela raiz do CNPJ ANTES de pontuar.
 * - **Domínio compartilhado** — a contabilidade que responde por quinze clientes tem um
 *   domínio que casa com todos. Mais de uma empresa no domínio não é determinístico: humano.
 *
 * E par na faixa 0,2–0,5 nunca é aceito automaticamente; ele vai para humano.
 */

/** O domínio, aceitando "Nome <endereco@dominio>". */
function dominioDe(email: string | null | undefined): string | null {
  if (!email) return null
  const m = /@([^@\s>]+)\s*>?\s*$/.exec(email.trim().toLowerCase())
  return m ? m[1]!.replace(/\.$/, '') : null
}

/** A mesma lista do filtro de ingestão do Gmail: duas listas divergiriam no primeiro provedor novo. */
export function ehEmailPessoal(email: string | null | undefined): boolean {
  const d = dominioDe(email)
  return d !== null && DOMINIOS_GENERICOS.has(d)
}

/** Sufixos societários e palavras que não distinguem empresa nenhuma. */
const RUIDO = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's/a', 'ss', 'mei', 'cia', 'companhia', 'e', 'de', 'da', 'do', 'das', 'dos',
  'comercio', 'servicos', 'industria', 'empreendimentos', 'participacoes', 'grupo',
])

export function normalizarNome(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !RUIDO.has(t))
    .join(' ')
}

function trigramas(s: string): Set<string> {
  const t = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3))
  return out
}

/** Jaccard de trigramas sobre os nomes normalizados: o mesmo critério do pg_trgm. */
export function similaridade(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizarNome(a)
  const nb = normalizarNome(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = trigramas(na)
  const tb = trigramas(nb)
  let inter = 0
  for (const x of ta) if (tb.has(x)) inter++
  return inter / (ta.size + tb.size - inter)
}

export interface Candidata {
  empresa_id: string
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  dominio: string | null
  uf: string | null
  /** Valor potencial, para ordenar a fila humana. */
  valor?: number | null
}

const raizCnpj = (cnpj: string) => cnpj.replace(/\D/g, '').slice(0, 8)
const ehMatriz = (cnpj: string) => cnpj.replace(/\D/g, '').slice(8, 12) === '0001'

/**
 * Uma candidata por raiz de CNPJ (a matriz, se estiver na lista). Mesma raiz é a mesma
 * pessoa jurídica — matriz e filiais não são candidatas concorrentes, são uma só.
 */
export function deduplicarCandidatas(cs: readonly Candidata[]): Candidata[] {
  const porRaiz = new Map<string, Candidata>()
  for (const c of cs) {
    const raiz = raizCnpj(c.cnpj) || c.empresa_id
    const atual = porRaiz.get(raiz)
    if (!atual || (!ehMatriz(atual.cnpj) && ehMatriz(c.cnpj))) porRaiz.set(raiz, c)
  }
  return [...porRaiz.values()]
}

export interface EntradaVinculo {
  canal: 'whatsapp' | 'email'
  identificador: string
  nome_sugerido: string | null
  /** Quando veio de reunião da plataforma, a empresa já é conhecida. */
  empresa_referencia?: string | null
}

export type EtapaVinculo = 'deterministico' | 'jev' | 'claude' | 'humano'

export interface ResultadoVinculo {
  etapa: EtapaVinculo
  empresa_id: string | null
  probabilidade: number | null
  motivo: string
  /** O que o humano vê como sugestão, já deduplicado e ordenado. */
  candidatas: Candidata[]
  /** E-mail pessoal ou sem nome para comparar: nada a fazer automaticamente. */
  nao_resolvivel: boolean
}

export interface DepsVinculo {
  porDominio(dominio: string): Promise<Candidata[]>
  porTelefone(digitos: string): Promise<Candidata[]>
  /** A shortlist por similaridade de nome (razão social, fantasia, domínio). */
  buscarParecidas(nome: string, limite: number): Promise<Candidata[]>
  /** Jev: probabilidade de cada par ser a mesma entidade. Ausente = sem Jev configurado. */
  pontuar?(entrada: EntradaVinculo, cs: readonly Candidata[]): Promise<Array<{ empresa_id: string; probabilidade: number }>>
  /** Claude: escolhe uma ou nenhuma. */
  desempatar?(entrada: EntradaVinculo, cs: readonly Candidata[]): Promise<{ empresa_id: string | null; motivo: string }>
  cfg: { aceite_automatico: number; banda_inferior: number; max_candidatas: number }
}

export async function resolverVinculo(e: EntradaVinculo, d: DepsVinculo): Promise<ResultadoVinculo> {
  const humano = (motivo: string, candidatas: Candidata[] = [], nao_resolvivel = false): ResultadoVinculo => ({
    etapa: 'humano',
    empresa_id: null,
    probabilidade: null,
    motivo,
    candidatas: ordenarPorValor(candidatas),
    nao_resolvivel,
  })
  const resolvido = (etapa: EtapaVinculo, c: Candidata, probabilidade: number | null, motivo: string, cs: Candidata[]) => ({
    etapa,
    empresa_id: c.empresa_id,
    probabilidade,
    motivo,
    candidatas: cs,
    nao_resolvivel: false,
  })

  // 1. Determinístico.
  if (e.empresa_referencia) {
    return { etapa: 'deterministico', empresa_id: e.empresa_referencia, probabilidade: 1, motivo: 'Reunião da plataforma.', candidatas: [], nao_resolvivel: false }
  }

  if (e.canal === 'email') {
    const dominio = dominioDe(e.identificador)
    if (!dominio) return humano('Endereço sem domínio.', [], true)
    if (DOMINIOS_GENERICOS.has(dominio)) {
      return humano(`E-mail pessoal (${dominio}) não identifica empresa.`, [], true)
    }
    const doDominio = deduplicarCandidatas(await d.porDominio(dominio))
    if (doDominio.length === 1) return resolvido('deterministico', doDominio[0]!, 1, `Domínio ${dominio}.`, doDominio)
    if (doDominio.length > 1) {
      return humano(`O domínio ${dominio} é de ${doDominio.length} empresas — compartilhado, não determina.`, doDominio)
    }
  } else {
    const digitos = e.identificador.replace(/\D/g, '')
    const doTelefone = deduplicarCandidatas(await d.porTelefone(digitos))
    if (doTelefone.length === 1) return resolvido('deterministico', doTelefone[0]!, 1, 'Telefone já cadastrado.', doTelefone)
    if (doTelefone.length > 1) return humano('Telefone cadastrado em mais de uma empresa.', doTelefone)
  }

  // 2. Shortlist por nome.
  const nome = e.nome_sugerido?.trim() ?? ''
  if (normalizarNome(nome).length < 3) return humano('Sem nome para comparar.', [], true)
  const shortlist = deduplicarCandidatas(await d.buscarParecidas(nome, d.cfg.max_candidatas)).slice(0, d.cfg.max_candidatas)
  if (shortlist.length === 0) return humano('Nenhuma empresa parecida na base.')
  if (!d.pontuar) return humano('Sem classificador configurado; candidatas por similaridade.', shortlist)

  // 3. Jev pontua cada par.
  let notas: Array<{ empresa_id: string; probabilidade: number }>
  try {
    notas = await d.pontuar(e, shortlist)
  } catch {
    return humano('O classificador falhou; candidatas por similaridade.', shortlist)
  }
  const porId = new Map(shortlist.map((c) => [c.empresa_id, c]))
  const ordenadas = notas
    .filter((n) => porId.has(n.empresa_id))
    .sort((a, b) => b.probabilidade - a.probabilidade)
  const candidatasOrdenadas = ordenadas.map((n) => porId.get(n.empresa_id)!)
  const [primeira, segunda] = ordenadas

  if (!primeira || primeira.probabilidade < d.cfg.banda_inferior) {
    return humano('Nenhum par provável o bastante.', candidatasOrdenadas)
  }
  const acimaDoAceite = ordenadas.filter((n) => n.probabilidade >= d.cfg.aceite_automatico)
  if (acimaDoAceite.length === 1 && (!segunda || segunda.probabilidade < d.cfg.banda_inferior)) {
    return resolvido('jev', porId.get(primeira.empresa_id)!, primeira.probabilidade, 'Par pontuado pelo Jev.', candidatasOrdenadas)
  }

  // 4. Banda cinzenta (ou empate no topo): Claude.
  if (!d.desempatar) return humano('Banda cinzenta sem desempatador.', candidatasOrdenadas)
  const empatadas = candidatasOrdenadas.filter((_, i) => ordenadas[i]!.probabilidade >= d.cfg.banda_inferior)
  try {
    const r = await d.desempatar(e, empatadas)
    const escolhida = r.empresa_id ? porId.get(r.empresa_id) : null
    if (escolhida) return resolvido('claude', escolhida, primeira.probabilidade, r.motivo, candidatasOrdenadas)
    return humano(r.motivo || 'O desempate não reconheceu nenhuma.', candidatasOrdenadas)
  } catch {
    return humano('O desempate falhou.', candidatasOrdenadas)
  }
}

function ordenarPorValor(cs: Candidata[]): Candidata[] {
  return [...cs].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0))
}

/** A pergunta que vai ao Jev para cada par. Texto curto: o estado é o par, não a conversa. */
export function estadoDoPar(e: EntradaVinculo, c: Candidata): string {
  return JSON.stringify({
    conta: { canal: e.canal, identificador: e.identificador, nome: e.nome_sugerido },
    empresa: { razao_social: c.razao_social, nome_fantasia: c.nome_fantasia, dominio: c.dominio, uf: c.uf },
  })
}

export const PERGUNTA_MESMA_ENTIDADE =
  'A conta (quem nos escreveu) pertence a esta empresa? Considere nome, nome fantasia e domínio. ' +
  'Nome de pessoa sozinho não basta.'
