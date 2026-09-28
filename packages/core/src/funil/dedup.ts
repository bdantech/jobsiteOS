import type { MotivoOcultacao, TipoOportunidade } from './schemas.js'

/**
 * A DEDUPLICAÇÃO (§5) — quem aparece quando o mesmo recebível chega por dois
 * caminhos.
 *
 * ── A HIERARQUIA: NF > PRÉ-AUTORIZAÇÃO > TÍTULO ────────────────────────────
 * Um recebível, um card. Quando as três fontes trazem o mesmo documento, fica a NF;
 * sem NF, a oferta; sem as duas, a parcela. Os escondidos não somem da tela: o
 * modal de detalhe do card que ficou lista os outros (`funil_ocultacoes`), e a nota
 * leva o selo "já tem pré-autorização".
 *
 * Até 28/09/2026 a oferta com parcela era a RAIZ — nada a escondia — e a disputa
 * NF × título era uma config com default `titulo`. Com as três presentes, isso
 * punha a OFERTA na tela no lugar da nota, e com a config em `nf` punha as DUAS.
 * A decisão de negócio passou a ser uma só, fixa: a nota é o documento mais rico
 * (XML, emissão, natureza da operação), e é nela que o resto do funil se apoia.
 *
 * Como a NF nunca é escondida, ela é sempre a raiz, e o ciclo que a regra antiga
 * precisava evitar (parcela → oferta → NF → parcela) deixou de ser possível.
 *
 * Os pares têm CARDINALIDADES diferentes, e é por isso que casam de jeitos
 * diferentes:
 *
 *   pré-auth ↔ título ... 1:1. A oferta aponta `billId` + `installmentId`, então é
 *                         a MESMA unidade que a parcela. Medido em 23/09/2026: 123
 *                         parcelas com oferta, nenhuma com duas.
 *   pré-auth ↔ NF ....... 1:N. Uma nota de R$ 55 mil em três parcelas gera até três
 *                         ofertas, e esconder a nota atrás de uma delas diria que só
 *                         aquela existe.
 *
 * Contra o título a oferta descreve melhor o mesmo recebível: ela tem relógio
 * (`expiresAt`), status e valor autorizado, e o card da parcela não tem onde
 * mostrar isso — a view do título fixa `relogio = NULL`. Medido: dos 87 títulos que
 * escondiam uma oferta aberta, TODOS tinham `situation = 'offer_created'` e nenhum
 * tinha `guard_reason`; o card na tela dizia "uma oferta foi criada" e escondia
 * exatamente essa oferta, com 9 prazos já vencidos sem ninguém ver.
 *
 * O preço conhecido da NF na frente: uma nota de três parcelas aparece inteira, e
 * quem liga precisa abrir o detalhe para ver que só uma parcela tem oferta. É o
 * que as etiquetas do modal existem para mostrar.
 *
 * ── OFERTA ENCERRADA ENCERRA A PARCELA ──────────────────────────────────────
 * Quando a oferta acaba — convertida, perdida ou expirada — a parcela NÃO volta
 * para a coluna aberta: ela é marcada com o mesmo estágio da oferta. É decisão de
 * negócio, e a razão é que oferta recusada não é parcela a retrabalhar. Sem isso a
 * parcela reapareceria como prospecção nova no dia seguinte, e o funil pediria de
 * novo o trabalho que a construtora já respondeu.
 *
 * É por isso que `encerramentos` existe: a ocultação sozinha esconderia a parcela
 * sem consertar o estágio dela, e qualquer relatório que leia `sienge_titulos`
 * direto continuaria contando uma parcela aberta que não está.
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
  /**
   * A lista traz as ABERTAS e as `convertida`, e o estágio decide o papel: aberta é
   * original de qualquer oferta; convertida só da oferta que também converteu — é
   * ela que mantém a oferta escondida atrás da nota que a conversão encerrou.
   */
  estagio_funil: string
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
  /**
   * O estágio da OFERTA, e ele entra no core porque a decisão depende dele: uma
   * oferta encerrada encerra a parcela em vez de devolvê-la à coluna aberta.
   */
  estagio_funil: string
  /** Acompanha o encerramento da parcela: perda sem causa não tem resposta. */
  perda_motivo?: string | null
  /** A antecipação que a oferta virou. Desce para a NF que a conversão encerra. */
  antecipacao_id_externo?: number | null
}

export interface TituloParaDedup {
  id_externo: number
  connection_id: number | null
  bill_id: number
  installment_id: number | null
  bill_access_key: string | null
  nfe_candidate_access_key: string | null
  pre_autorizacao_id_externo: number | null
  /**
   * O estágio da PARCELA, e ele é filtrado AQUI e não no SQL do job — porque o
   * filtro depende do PAPEL, e o mesmo título tem os dois:
   *
   *   escondido atrás da oferta ... qualquer estágio serve. Filtrar encerrados no
   *       SQL tirava da lista justamente a parcela que acabou de ser encerrada pela
   *       oferta, a ocultação dela se perdia na recomposição, e ela reaparecia em
   *       Encerradas ao lado da própria oferta — dois cards do mesmo recebível.
   *   original de uma NF (§3) .... encerrado NÃO esconde. É a regra da 0254:
   *       documento que já saiu do funil não leva card aberto com ele.
   */
  estagio_funil: string
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

/**
 * O documento que a oferta encerrou, com o estágio que ele herda.
 *
 *   `titulo` ... a oferta ganha da parcela, então o estado do card visível desce
 *                para quem ficou escondido — qualquer um dos três encerramentos.
 *   `nf` ....... a nota ganha da oferta e fica na tela, então só a CONVERSÃO sobe
 *                para ela. Oferta perdida ou expirada atrás de nota aberta é o caso
 *                certo: a nota segue sendo trabalho. Oferta antecipada, não — o
 *                fornecedor já pediu, e a nota numa coluna aberta pedia de novo.
 */
export interface EncerramentoDerivado {
  tipo: 'titulo' | 'nf'
  referencia_id: string
  /** Sempre um de `ESTAGIOS_ENCERRADOS`, espelhado da oferta. */
  estagio: string
  perda_motivo: string | null
  /** Só na `nf`: a antecipação que a converteu, para o card dizer qual foi. */
  conversao_antecipacao_id?: number | null
}

export interface ResultadoDedup {
  ocultacoes: Ocultacao[]
  selos: SeloPreAutorizacao[]
  ambiguidades: AmbiguidadeDedup[]
  encerramentos: EncerramentoDerivado[]
}

/** `nf:3512…` — a identidade de uma oportunidade nas três fontes. */
export function chaveDedup(tipo: TipoOportunidade, id: string | number): string {
  return `${tipo}:${id}`
}

/** Tolerância do DESEMPATE por valor: 1%. */
/**
 * Os estágios que significam "saiu do funil".
 *
 * Repetido aqui, e não importado de `antecipacao/schemas`, porque `dedup.ts` é puro
 * e não deve depender do módulo de Antecipação para uma lista de três palavras. O
 * `satisfies` amarra os dois: se a lista de lá mudar, o typecheck deste arquivo cai.
 */
const ENCERRADOS: ReadonlySet<string> = new Set<string>(['convertida', 'perdida', 'expirada'])

/** A frase quando a oferta não trouxe a própria: o relatório não fica sem causa. */
function motivoPadraoDeEncerramento(estagio: string): string | null {
  if (estagio === 'convertida') return null
  return estagio === 'expirada'
    ? 'A oferta desta parcela expirou na plataforma.'
    : 'A oferta desta parcela foi encerrada na plataforma.'
}

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

export function deduplicarFunil(entrada: EntradaDedup): ResultadoDedup {
  const ocultacoes = new Map<string, Ocultacao>()
  const selos: SeloPreAutorizacao[] = []
  const ambiguidades: AmbiguidadeDedup[] = []
  const encerramentos: EncerramentoDerivado[] = []

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

  const notasPorAcesso = new Map<string, NotaParaDedup>()
  const notasPorChave = new Map<string, NotaParaDedup[]>()
  for (const n of entrada.notas) {
    notasPorAcesso.set(n.access_key, n)
    if (!n.numero_normalizado) continue
    const k = `${n.sacado_matriz_cnpj}/${n.fornecedor_cnpj}/${n.numero_normalizado}`
    const lista = notasPorChave.get(k)
    if (lista) lista.push(n)
    else notasPorChave.set(k, [n])
  }

  // Uma nota com duas ofertas antecipadas (as duas metades de uma NF) encerra uma vez.
  const notasEncerradas = new Set<string>()

  for (const pre of entrada.preAutorizacoes) {
    const chavePre = chaveDedup('pre_autorizacao', pre.id_externo)

    // 2a. A PARCELA desta oferta, por id. É id contra id: não há o que interpretar.
    let parcelaDaOferta: TituloParaDedup | null = null

    const apontado = tituloPorPreAuth.get(pre.id_externo)
    if (apontado) {
      parcelaDaOferta = apontado
    } else if (pre.sienge_bill_id !== null && pre.sienge_installment_id !== null) {
      const candidatos =
        titulosPorParcela.get(`${pre.sienge_bill_id}/${pre.sienge_installment_id}`) ?? []
      if (candidatos.length === 1) {
        parcelaDaOferta = candidatos[0] as TituloParaDedup
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

    /*
     * A OFERTA ESCONDE A PARCELA — e já não é a raiz: logo abaixo ela mesma pode
     * ficar atrás da NF, e a cadeia (passo 4) leva a parcela junto até a nota.
     */
    if (parcelaDaOferta) {
      ocultacoes.set(chaveDedup('titulo', parcelaDaOferta.id_externo), {
        tipo: 'titulo',
        referencia_id: String(parcelaDaOferta.id_externo),
        motivo: 'oferta_criada',
        original_tipo: 'pre_autorizacao',
        original_id: String(pre.id_externo),
      })

      // Oferta encerrada encerra a parcela: ela não volta para a coluna aberta.
      if (ENCERRADOS.has(pre.estagio_funil)) {
        encerramentos.push({
          tipo: 'titulo',
          referencia_id: String(parcelaDaOferta.id_externo),
          estagio: pre.estagio_funil,
          perda_motivo: pre.perda_motivo ?? motivoPadraoDeEncerramento(pre.estagio_funil),
        })
      }
    }

    // 2b. A NF, e aí quem fica é a NOTA.
    /*
     * Nota encerrada só é original de oferta CONVERTIDA. É o que mantém a oferta
     * atrás da nota depois que a conversão encerrou as duas — sem isso a oferta
     * voltaria como card próprio e Encerradas mostraria o mesmo recebível duas
     * vezes. E oferta aberta não se esconde atrás de nota que saiu do funil.
     */
    const podeSerOriginal = (n: NotaParaDedup): boolean =>
      !ENCERRADOS.has(n.estagio_funil) || pre.estagio_funil === 'convertida'

    let original: { tipo: TipoOportunidade; id: string } | null = null

    /*
     * Pela PARCELA primeiro: ela carrega a chave de acesso da nota, e aí é id contra
     * id. É o caminho das três fontes juntas — a oferta, a parcela e a nota do
     * mesmo recebível —, e não tem desempate nem ambiguidade.
     */
    const chaveDaParcela = parcelaDaOferta
      ? (parcelaDaOferta.bill_access_key ?? parcelaDaOferta.nfe_candidate_access_key)
      : null
    const notaDaParcela = chaveDaParcela ? notasPorAcesso.get(chaveDaParcela) : undefined
    if (notaDaParcela && podeSerOriginal(notaDaParcela)) {
      original = { tipo: 'nf', id: notaDaParcela.access_key }
    } else if (pre.numero_normalizado) {
      // Sem chave pela parcela: por número, que é o par 1:N.
      const k = `${pre.sacado_matriz_cnpj}/${pre.fornecedor_cnpj}/${pre.numero_normalizado}`
      const candidatos = (notasPorChave.get(k) ?? []).filter(podeSerOriginal)
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
     * Sem NF: a oferta é o card (com ou sem parcela atrás dela). Inclui a ÓRFÃ —
     * origem manual, integration, file, lite, ou `nfe` cuja NF simplesmente não é
     * nossa (o fornecedor não tem certificado conosco). Ela É o original, e vira
     * card normalmente. Este é o caso mais comum nas contas novas, e tratá-lo como
     * erro deixaria o funil vazio justamente onde há mais a ganhar.
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

    /*
     * OFERTA ANTECIPADA ENCERRA A NOTA. Medido em 24/09/2026: 9 NFs em
     * `a_prospectar` com a oferta já em ANTICIPATION_REQUESTED, o card na coluna
     * aberta pedindo ao SDR um trabalho que o fornecedor já tinha feito.
     *
     * No par 1:N isto encerra a nota inteira mesmo que só uma metade tenha virado
     * oferta, e é seguro: a nota encerrada sai da lista de originais, então a
     * oferta da outra metade, quando vier, nasce como card próprio.
     */
    const nota = notasPorAcesso.get(original.id)
    if (
      pre.estagio_funil === 'convertida' &&
      nota &&
      !ENCERRADOS.has(nota.estagio_funil) &&
      !notasEncerradas.has(nota.access_key)
    ) {
      notasEncerradas.add(nota.access_key)
      encerramentos.push({
        tipo: 'nf',
        referencia_id: nota.access_key,
        estagio: 'convertida',
        perda_motivo: null,
        conversao_antecipacao_id: pre.antecipacao_id_externo ?? null,
      })
    }
  }

  // ── 3. Título ↔ NF, pela chave de acesso: a NOTA fica. ──────────────────

  /*
   * Sem `accessKey` dos dois lados NÃO SE DEDUPLICA, e não há plano B por número:
   * PARCELA NÃO É NOTA. Uma NF de R$ 55 mil em três parcelas casaria por número
   * com as três, e o casamento errado esconderia a parcela de outra nota.
   */
  /*
   * Só as notas ABERTAS, contando o encerramento desta passada: a `convertida` está
   * na lista só para segurar a oferta que a encerrou. Nota encerrada não esconde
   * parcela aberta — documento que saiu do funil não leva card aberto com ele (0254).
   */
  const notasPorChaveAcesso = new Map<string, NotaParaDedup>()
  for (const n of entrada.notas) {
    if (ENCERRADOS.has(n.estagio_funil) || notasEncerradas.has(n.access_key)) continue
    notasPorChaveAcesso.set(n.access_key, n)
  }

  for (const t of entrada.titulos) {
    const chave = t.bill_access_key ?? t.nfe_candidate_access_key
    if (!chave) continue
    const nota = notasPorChaveAcesso.get(chave)
    if (!nota) continue

    // Já atrás da oferta: a oferta foi para trás desta mesma nota no passo 2 (pela
    // mesma chave), e a cadeia leva a parcela até ela. Sobrescrever perderia o
    // motivo `oferta_criada`, que é o que o detalhe mostra.
    const k = chaveDedup('titulo', t.id_externo)
    if (ocultacoes.has(k)) continue

    ocultacoes.set(k, {
      tipo: 'titulo',
      referencia_id: String(t.id_externo),
      motivo: 'duplicado_canal',
      original_tipo: 'nf',
      original_id: nota.access_key,
    })
  }

  // ── 4. A cadeia: o selo tem de pousar em quem está VISÍVEL. ──────────────

  /*
   * A parcela vai para trás da oferta, e a oferta para trás da nota: sem este
   * passo a parcela apontaria para um card que ninguém vê, e o detalhe da nota não
   * a listaria. Com a NF sempre na raiz a cadeia tem no máximo dois elos; o teto de
   * saltos fica para dado torto.
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

  return { ocultacoes: [...ocultacoes.values()], selos, ambiguidades, encerramentos }
}
