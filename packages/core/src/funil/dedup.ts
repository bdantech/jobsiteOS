import type { MotivoOcultacao, PrioridadeNfVsTitulo, TipoOportunidade } from './schemas.js'

/**
 * A DEDUPLICAÇÃO (§5) — quem aparece quando o mesmo recebível chega por dois
 * caminhos.
 *
 * ── A HIERARQUIA ────────────────────────────────────────────────────────────
 * O ORIGINAL TEM PRECEDÊNCIA SOBRE O DERIVADO. Quando uma NF ou uma parcela já
 * virou pré-autorização, lista-se o original e ele ganha um selo "já tem
 * pré-autorização". A pré-autorização não vira card próprio: ela é uma coisa que
 * ACONTECEU com o documento, não um segundo documento.
 *
 * ── A REGRA QUE VALE MAIS QUE TODAS ─────────────────────────────────────────
 * AMBÍGUO NÃO ESCONDE NADA. Quando dois candidatos casam igualmente bem, os dois
 * ficam visíveis e o caso vai para a fila de revisão. Esconder por palpite é pior
 * que mostrar duplicado: o card duplicado custa dez segundos de quem varre a
 * coluna, e o card escondido por engano custa a oportunidade inteira — ninguém
 * procura o que não sabe que existe.
 *
 * ── POR QUE ISTO É PURO ─────────────────────────────────────────────────────
 * Nenhuma linha aqui toca o banco. O job carrega as três listas, chama esta
 * função e escreve o resultado. É o que permite que os casos difíceis — título de
 * matriz casando com pré-auth de SPE, `billId` repetido entre conexões, credor PF
 * — existam como teste em vez de como suposição.
 */

export interface NotaParaDedup {
  access_key: string
  /** Sempre a MATRIZ: é nela que as três fontes se encontram (§4.1). */
  sacado_matriz_cnpj: string
  fornecedor_cnpj: string
  numero_normalizado: string | null
  valor: number | null
  vencimento: string | null
}

export interface PreAuthParaDedup {
  id_externo: number
  origin: string
  status: string
  criada_em: string | null
  sacado_matriz_cnpj: string
  fornecedor_cnpj: string
  numero_normalizado: string | null
  valor: number
  vencimento: string | null
  sienge_bill_id: number | null
  sienge_installment_id: number | null
}

export interface TituloParaDedup {
  id_externo: number
  connection_id: number | null
  bill_id: number
  installment_id: number | null
  bill_access_key: string | null
  nfe_candidate_access_key: string | null
  pre_autorizacao_id_externo: number | null
}

export interface Ocultacao {
  tipo: TipoOportunidade
  referencia_id: string
  motivo: MotivoOcultacao
  original_tipo: TipoOportunidade
  original_id: string
}

/** O selo "já tem pré-autorização" que o card do ORIGINAL exibe. */
export interface SeloPreAutorizacao {
  tipo: TipoOportunidade
  referencia_id: string
  pre_autorizacao_id: number
  status: string
  criada_em: string | null
}

/**
 * Um caso que a regra NÃO resolveu. Vai para a fila de revisão do 04e, e os dois
 * (ou três) envolvidos continuam visíveis.
 */
export interface AmbiguidadeDedup {
  pre_autorizacao_id: number
  candidatos: string[]
  motivo: 'varios_titulos' | 'varias_nfs'
}

export interface EntradaDedup {
  notas: readonly NotaParaDedup[]
  preAutorizacoes: readonly PreAuthParaDedup[]
  titulos: readonly TituloParaDedup[]
}

export interface ResultadoDedup {
  ocultacoes: Ocultacao[]
  selos: SeloPreAutorizacao[]
  ambiguidades: AmbiguidadeDedup[]
}

/** `nf:3512…` — a identidade de uma oportunidade nas três fontes. */
export function chaveDedup(tipo: TipoOportunidade, id: string | number): string {
  return `${tipo}:${id}`
}

/** Tolerância do DESEMPATE por valor: 1%. */
const TOLERANCIA_VALOR = 0.01
/** Tolerância do DESEMPATE por vencimento: 5 dias para cada lado. */
const TOLERANCIA_DIAS = 5

function diasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()
  const db = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return null
  return Math.abs(Math.round((da - db) / 86_400_000))
}

/**
 * O desempate do §5, e ele só roda quando HÁ empate.
 *
 * Com um candidato só, valor e vencimento não são testados de propósito: a
 * plataforma arredonda, a construtora paga com desconto de duplicata e o
 * vencimento do título quase nunca é o da nota. Exigir os três faria a regra
 * falhar justamente nos casamentos corretos — e falhar aqui é mostrar duplicado,
 * o que já é o comportamento seguro. Como critério de DESEMPATE, porém, ele é
 * exatamente a pergunta certa: entre dois candidatos iguais, o mais parecido ganha.
 */
function pontuarProximidade(
  pre: PreAuthParaDedup,
  nota: NotaParaDedup,
): { dentro: boolean; distancia: number } {
  const valorOk =
    nota.valor === null ||
    Math.abs(nota.valor - pre.valor) <= Math.max(Math.abs(pre.valor), 1) * TOLERANCIA_VALOR
  const dias = diasEntre(pre.vencimento, nota.vencimento)
  const prazoOk = dias === null || dias <= TOLERANCIA_DIAS
  const distancia =
    (nota.valor === null ? 0 : Math.abs(nota.valor - pre.valor)) + (dias ?? 0) * 0.001
  return { dentro: valorOk && prazoOk, distancia }
}

export function deduplicarFunil(
  entrada: EntradaDedup,
  prioridade: PrioridadeNfVsTitulo = 'titulo',
): ResultadoDedup {
  const ocultacoes = new Map<string, Ocultacao>()
  const selos: SeloPreAutorizacao[] = []
  const ambiguidades: AmbiguidadeDedup[] = []

  // ── 1. Pré-auth ↔ título, por id. Sem ambiguidade quando o título aponta. ──

  const tituloPorPreAuth = new Map<number, TituloParaDedup>()
  for (const t of entrada.titulos) {
    if (t.pre_autorizacao_id_externo !== null) {
      tituloPorPreAuth.set(t.pre_autorizacao_id_externo, t)
    }
  }

  /*
   * O índice por `(bill_id, installment_id)` guarda uma LISTA, e não um título.
   *
   * `bill.billId` só é único dentro de uma conexão (§2.2): duas construtoras
   * diferentes têm títulos de mesmo id, e a pré-autorização não diz de qual
   * conexão veio. Guardar um só aqui esconderia a parcela de um cliente atrás da
   * de outro — e o card sumido seria de um sacado que nem aparece na tela.
   */
  const titulosPorParcela = new Map<string, TituloParaDedup[]>()
  for (const t of entrada.titulos) {
    if (t.installment_id === null) continue
    const k = `${t.bill_id}/${t.installment_id}`
    const lista = titulosPorParcela.get(k)
    if (lista) lista.push(t)
    else titulosPorParcela.set(k, [t])
  }

  // ── 2. Pré-auth ↔ NF, por sacado MATRIZ + fornecedor + número normalizado. ──

  const notasPorChave = new Map<string, NotaParaDedup[]>()
  for (const n of entrada.notas) {
    if (!n.numero_normalizado) continue
    const k = `${n.sacado_matriz_cnpj}/${n.fornecedor_cnpj}/${n.numero_normalizado}`
    const lista = notasPorChave.get(k)
    if (lista) lista.push(n)
    else notasPorChave.set(k, [n])
  }

  for (const pre of entrada.preAutorizacoes) {
    const chavePre = chaveDedup('pre_autorizacao', pre.id_externo)

    // 2a. O título que aponta para ela. É id contra id: não há o que interpretar.
    let original: { tipo: TipoOportunidade; id: string } | null = null

    const apontado = tituloPorPreAuth.get(pre.id_externo)
    if (apontado) {
      original = { tipo: 'titulo', id: String(apontado.id_externo) }
    } else if (pre.sienge_bill_id !== null && pre.sienge_installment_id !== null) {
      const candidatos =
        titulosPorParcela.get(`${pre.sienge_bill_id}/${pre.sienge_installment_id}`) ?? []
      if (candidatos.length === 1) {
        original = { tipo: 'titulo', id: String((candidatos[0] as TituloParaDedup).id_externo) }
      } else if (candidatos.length > 1) {
        /*
         * O `billId` repetido entre conexões, acontecendo de verdade. Não há como
         * escolher — a pré-autorização não carrega a conexão —, então ninguém é
         * escondido e alguém decide olhando.
         */
        ambiguidades.push({
          pre_autorizacao_id: pre.id_externo,
          candidatos: candidatos.map((c) => chaveDedup('titulo', c.id_externo)),
          motivo: 'varios_titulos',
        })
      }
    }

    // 2b. Sem título: a NF. Só quando há número para casar.
    if (!original && pre.numero_normalizado) {
      const k = `${pre.sacado_matriz_cnpj}/${pre.fornecedor_cnpj}/${pre.numero_normalizado}`
      const candidatos = notasPorChave.get(k) ?? []
      if (candidatos.length === 1) {
        original = { tipo: 'nf', id: (candidatos[0] as NotaParaDedup).access_key }
      } else if (candidatos.length > 1) {
        const proximos = candidatos
          .map((n) => ({ n, p: pontuarProximidade(pre, n) }))
          .filter((x) => x.p.dentro)
          .sort((a, b) => a.p.distancia - b.p.distancia)

        // Um único sobrevivente do desempate vence; dois empatados não escondem nada.
        if (proximos.length === 1) {
          original = { tipo: 'nf', id: (proximos[0] as { n: NotaParaDedup }).n.access_key }
        } else {
          ambiguidades.push({
            pre_autorizacao_id: pre.id_externo,
            candidatos: candidatos.map((c) => chaveDedup('nf', c.access_key)),
            motivo: 'varias_nfs',
          })
        }
      }
    }

    /*
     * Pré-autorização ÓRFÃ — origem manual, integration, file, lite, ou `nfe` cuja
     * NF simplesmente não é nossa (o fornecedor não tem certificado conosco). Ela
     * É o original, e vira card normalmente. Este é o caso mais comum nas contas
     * novas, e tratá-lo como erro deixaria o funil vazio justamente onde há mais a
     * ganhar.
     */
    if (!original) continue

    ocultacoes.set(chavePre, {
      tipo: 'pre_autorizacao',
      referencia_id: String(pre.id_externo),
      motivo: 'tem_original',
      original_tipo: original.tipo,
      original_id: original.id,
    })
    selos.push({
      tipo: original.tipo,
      referencia_id: original.id,
      pre_autorizacao_id: pre.id_externo,
      status: pre.status,
      criada_em: pre.criada_em,
    })
  }

  // ── 3. Título ↔ NF, pela chave de acesso, sob a config. ──────────────────

  /*
   * Sem `accessKey` dos dois lados NÃO SE DEDUPLICA, e não há plano B por número:
   * PARCELA NÃO É NOTA. Uma NF de R$ 55 mil em três parcelas casaria por número
   * com as três, e esconder a nota em favor de uma delas — ou as três em favor da
   * nota — descreveria errado o que está disponível para antecipar hoje.
   */
  const notasPorChaveAcesso = new Map<string, NotaParaDedup>()
  for (const n of entrada.notas) notasPorChaveAcesso.set(n.access_key, n)

  for (const t of entrada.titulos) {
    const chave = t.bill_access_key ?? t.nfe_candidate_access_key
    if (!chave) continue
    const nota = notasPorChaveAcesso.get(chave)
    if (!nota) continue

    if (prioridade === 'titulo') {
      // A PARCELA é a unidade que vira oferta. A nota inteira esconderia que só
      // uma das três está disponível agora.
      ocultacoes.set(chaveDedup('nf', nota.access_key), {
        tipo: 'nf',
        referencia_id: nota.access_key,
        motivo: 'duplicado_canal',
        original_tipo: 'titulo',
        original_id: String(t.id_externo),
      })
    } else {
      ocultacoes.set(chaveDedup('titulo', t.id_externo), {
        tipo: 'titulo',
        referencia_id: String(t.id_externo),
        motivo: 'duplicado_canal',
        original_tipo: 'nf',
        original_id: nota.access_key,
      })
    }
  }

  // ── 4. A cadeia: o selo tem de pousar em quem está VISÍVEL. ──────────────

  /*
   * Uma pré-autorização pode apontar para uma NF que, por sua vez, está escondida
   * atrás de uma parcela. Sem este passo o selo "já tem pré-autorização" ficaria
   * pendurado num card que ninguém vê, e o card visível — a parcela — não diria
   * que a oferta já foi feita. É exatamente a informação mais quente do funil,
   * perdida por um elo.
   */
  const raiz = (tipo: TipoOportunidade, id: string): { tipo: TipoOportunidade; id: string } => {
    let atual = { tipo, id }
    // Teto de saltos: um ciclo (que a regra não produz, mas um dado torto pode)
    // não pode virar laço infinito dentro de um job noturno.
    for (let i = 0; i < 8; i++) {
      const o = ocultacoes.get(chaveDedup(atual.tipo, atual.id))
      if (!o) return atual
      atual = { tipo: o.original_tipo, id: o.original_id }
    }
    return atual
  }

  for (const o of ocultacoes.values()) {
    const r = raiz(o.original_tipo, o.original_id)
    o.original_tipo = r.tipo
    o.original_id = r.id
  }
  for (const s of selos) {
    const r = raiz(s.tipo, s.referencia_id)
    s.tipo = r.tipo
    s.referencia_id = r.id
  }

  return { ocultacoes: [...ocultacoes.values()], selos, ambiguidades }
}
