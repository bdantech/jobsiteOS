import { PESO_CONFIANCA, type Confianca, type FonteContato } from './schemas.js'

/**
 * A cascata de descoberta de contato (§4): o que roda, em que ordem, e o que cada
 * clique vai custar ANTES de o originador clicar.
 *
 * Este arquivo é puro de propósito. O plano precisa ser calculável na tela (para
 * mostrar "este clique custa R$ 0,47"), no worker (para executar) e no teste (para
 * provar que a ordem não mudou). Se a tela estimasse por uma regra e o worker
 * cobrasse por outra, a diferença apareceria na fatura, não no código.
 *
 * ─── POR QUE A ORDEM É ESTA ──────────────────────────────────────────────────
 *
 * Do mais barato e mais certo para o mais caro e mais incerto. Medido nos 688
 * fornecedores do funil: o XML da NF-e tem telefone para 528 deles (77%) e custa
 * zero; a Receita, para 75 (11%). Rodar um provedor pago antes de esgotar os dois é
 * pagar por 77% de informação que já está no nosso banco.
 *
 * Camada 0+1 roda sozinha, para todos, no job. Camada 2+4 só roda quando alguém
 * clica — e debita do teto mensal do originador.
 */

/** Todo provedor da cascata, na ordem em que a cascata os tenta. */
export const PROVEDORES_CASCATA = [
  'xml_nfe',
  'receita',
  'contatos_base',
  'site_empresa',
  'google_places',
  'novavida',
  'apollo',
  'claude_busca',
  'claude_aprofundado',
] as const
export type ProvedorCascata = (typeof PROVEDORES_CASCATA)[number]

export const PROVEDOR_LABELS: Record<ProvedorCascata, string> = {
  xml_nfe: 'XML das notas',
  receita: 'Cadastro da Receita',
  contatos_base: 'Contatos que já temos',
  site_empresa: 'Site da empresa',
  google_places: 'Google Places',
  novavida: 'Nova Vida TI (sócios)',
  apollo: 'Apollo',
  claude_busca: 'Busca do Claude',
  claude_aprofundado: 'Busca aprofundada',
}

/** Em que `contatos_descobertos.fonte` cada provedor grava. */
export const FONTE_DO_PROVEDOR: Record<ProvedorCascata, FonteContato> = {
  xml_nfe: 'xml_nfe',
  receita: 'receita',
  contatos_base: 'site_empresa',
  site_empresa: 'site_empresa',
  google_places: 'google_places',
  novavida: 'novavida',
  apollo: 'apollo',
  claude_busca: 'claude_busca',
  claude_aprofundado: 'claude_aprofundado',
}

export const PROVEDORES_AUTOMATICOS: readonly ProvedorCascata[] = [
  'xml_nfe',
  'receita',
  'contatos_base',
  'site_empresa',
  'google_places',
]

export const PROVEDORES_SOB_DEMANDA: readonly ProvedorCascata[] = [
  'novavida',
  'apollo',
  'claude_busca',
]

export interface CustosDescoberta {
  google_places: number
  novavida: number
  apollo: number
  claude_busca: number
  claude_aprofundado: number
}

export const CUSTOS_PADRAO: CustosDescoberta = {
  // Text Search do Places: US$ 0,032/consulta na faixa básica, ~R$ 0,18 ao câmbio de
  // referência. Fica em config porque câmbio e tabela do Google mudam sem avisar.
  google_places: 0.18,
  novavida: 0.35,
  // O mesmo crédito de revelação do Radar (`contato_apollo`), mantido igual de
  // propósito: é a mesma cobrança, e dois valores diferentes para ela fariam o
  // orçamento do Radar e o deste módulo divergirem sobre a mesma fatura.
  apollo: 1.2,
  claude_busca: 0.1,
  /*
   * Mais cara que a primeira, e é o desenho: ela lê o que já foi achado, o que falhou
   * na validação, e procura em lugares que a primeira não tenta — sindicato, junta
   * comercial, notícia local, perfil de sócio. Mais busca web por chamada.
   */
  claude_aprofundado: 0.25,
}

/** O que já sabemos sobre o fornecedor, e que decide o que vale a pena rodar. */
export interface EstadoFornecedor {
  /** Domínio resolvido pela cascata do Radar, quando houver. */
  dominio: string | null
  funcionarios: number | null
  faturamento_estimado: number | null
  /**
   * Porte declarado à Receita: `ME` | `EPP` | `DEMAIS`.
   *
   * É o sinal de porte que EXISTE para quem nunca foi enriquecido — e essa é a regra,
   * não a exceção: dos 530 fornecedores do funil, ZERO têm `funcionarios` (nenhum tem
   * ficha em `empresas`, porque não estar na plataforma é a definição deles).
   *
   * Sem ele, "porte desconhecido" era tratado como "porte pequeno" e o Apollo nunca
   * rodava para ninguém. Desconhecido não é pequeno; `ME`/`EPP` é a própria empresa
   * declarando que é pequena, e `DEMAIS` é o contrário.
   */
  porte_rfb: string | null
  municipio: string | null
  uf: string | null
  razao_social: string | null
  /** A melhor confiança entre os contatos JÁ descobertos. */
  melhor_confianca: Confianca | null
}

export interface OpcoesCascata {
  custos?: Partial<CustosDescoberta>
  /** §4.2: para na primeira fonte de confiança alta. Default true. */
  pararAoEncontrarAlta?: boolean
  /** Porte mínimo para o Apollo valer a pena (§4.2b). */
  apolloMinimoFuncionarios?: number
  apolloMinimoFaturamento?: number
}

export interface EtapaPlano {
  provedor: ProvedorCascata
  rodara: boolean
  custo: number
  /** Por que NÃO vai rodar. Sempre preenchido quando `rodara` é false. */
  motivo: string | null
}

export interface PlanoDescoberta {
  etapas: EtapaPlano[]
  /** O que a tela mostra no botão. Só soma o que de fato vai rodar. */
  custo_estimado: number
  /**
   * True quando a cascata pode parar antes do fim. O custo estimado é o TETO — se a
   * Nova Vida achar um celular de sócio, o Apollo e o Claude não rodam e a fatura é
   * menor. Prometer o teto e cobrar menos é a única direção aceitável do erro.
   */
  pode_custar_menos: boolean
  /**
   * O Apollo está no plano mas depende de a busca do Claude achar um domínio primeiro.
   * A tela diz isso em vez de prometer um custo que pode não ser cobrado.
   */
  apollo_depende_da_busca: boolean
}

/**
 * O plano do clique pago (camadas 2+4).
 *
 * Já-tem-alta é avaliado ANTES de tudo: se a camada automática já achou um telefone
 * do `emit` da NF-e, o clique inteiro é desnecessário e o botão precisa dizer isso em
 * vez de aceitar R$ 1,65 para confirmar o que está na tela.
 */
export function planejarDescobertaSobDemanda(
  estado: EstadoFornecedor,
  opcoes: OpcoesCascata = {},
): PlanoDescoberta {
  const custos = { ...CUSTOS_PADRAO, ...(opcoes.custos ?? {}) }
  const parar = opcoes.pararAoEncontrarAlta ?? true
  const minFunc = opcoes.apolloMinimoFuncionarios ?? 10
  const minFat = opcoes.apolloMinimoFaturamento ?? null

  const jaTemAlta =
    estado.melhor_confianca !== null &&
    PESO_CONFIANCA[estado.melhor_confianca] >= PESO_CONFIANCA.alta

  const bloqueioGlobal = parar && jaTemAlta ? 'Já existe contato de confiança alta.' : null

  const etapa = (provedor: ProvedorCascata, custo: number, motivo: string | null): EtapaPlano => ({
    provedor,
    rodara: motivo === null,
    custo: motivo === null ? custo : 0,
    motivo,
  })

  /*
   * O PORTE, com três fontes e nesta ordem.
   *
   * `funcionarios` é o melhor sinal e quase nunca existe aqui. `porte_rfb` é o que
   * sempre existe (687 dos 688 estão no universo da Receita), e é a declaração da
   * própria empresa: `ME` e `EPP` são tetos de faturamento, `DEMAIS` é tudo acima.
   *
   * Tratar porte desconhecido como pequeno foi o erro da primeira versão, e ele não
   * era visível num caso — era total: com `funcionarios` nulo para os 530, o Apollo
   * era pulado para todo mundo, sempre, e o registro dizia "porte abaixo do mínimo"
   * sobre uma empresa cujo porte ninguém tinha medido.
   */
  const porteOk =
    estado.funcionarios !== null
      ? estado.funcionarios >= minFunc
      : minFat !== null && estado.faturamento_estimado !== null
        ? estado.faturamento_estimado >= minFat
        : estado.porte_rfb !== null
          ? estado.porte_rfb.toUpperCase() === 'DEMAIS'
          : false

  const motivoPorte =
    estado.funcionarios !== null
      ? `Porte abaixo do mínimo (${minFunc} funcionários): PME sem LinkedIn é gasto sem retorno.`
      : estado.porte_rfb !== null
        ? `Porte ${estado.porte_rfb} na Receita: empresa pequena raramente tem página no LinkedIn.`
        : 'Porte desconhecido e sem cadastro na Receita.'

  const motivoApollo =
    bloqueioGlobal ?? (!porteOk ? motivoPorte : null)

  const novavida = etapa('novavida', custos.novavida, bloqueioGlobal)
  const claude = etapa('claude_busca', custos.claude_busca, bloqueioGlobal)

  /*
   * ─── A ORDEM MUDA QUANDO NÃO HÁ DOMÍNIO ────────────────────────────────────
   *
   * O Apollo consulta POR DOMÍNIO, e quem descobre domínio nesta cascata é a busca do
   * Claude. Rodando o Apollo antes dela, ele é pulado por falta de domínio — e como o
   * `site` que o Claude acha não era gravado, ele seria pulado no segundo clique
   * também, e no terceiro.
   *
   * Foi o que aconteceu com a I3M Engenharia: o Apollo pulou por "sem domínio
   * resolvido" às 14:20:17, e treze segundos depois a busca devolveu `i3m.com.br`.
   *
   * Com domínio, a ordem da spec vale como está (§4.2 a/b/c). Sem domínio, o Apollo
   * desce para depois da busca e roda com o que ela encontrar — o worker grava o
   * domínio achado antes de chamá-lo. De quebra é mais barato: a busca custa R$ 0,10 e
   * o Apollo R$ 1,20, então a etapa que pode tornar a outra desnecessária vem primeiro.
   */
  const etapas: EtapaPlano[] = estado.dominio
    ? [novavida, etapa('apollo', custos.apollo, motivoApollo), claude]
    : [
        novavida,
        claude,
        etapa(
          'apollo',
          custos.apollo,
          motivoApollo ??
            // Não é recusa: é condição. O worker reavalia depois da busca.
            null,
        ),
      ]

  const vaiRodar = etapas.filter((e) => e.rodara)
  return {
    etapas,
    custo_estimado: Math.round(vaiRodar.reduce((s, e) => s + e.custo, 0) * 100) / 100,
    pode_custar_menos: parar && vaiRodar.length > 1,
    /*
     * Sem domínio hoje, o Apollo só roda se a busca achar um. A tela usa isto para
     * dizer "até R$ X" em vez de prometer um número que pode não ser cobrado.
     */
    apollo_depende_da_busca: !estado.dominio && porteOk && bloqueioGlobal === null,
  }
}

/**
 * Depois de cada provedor: para aqui?
 *
 * A pergunta é feita entre etapas, com o que a etapa acabou de achar, porque é o
 * único lugar onde ela tem resposta. Um plano calculado inteiro no início não sabe
 * que a Nova Vida ia trazer o celular do sócio.
 */
export function deveParar(
  melhorConfiancaAtual: Confianca | null,
  pararAoEncontrarAlta = true,
): boolean {
  if (!pararAoEncontrarAlta) return false
  return melhorConfiancaAtual !== null && PESO_CONFIANCA[melhorConfiancaAtual] >= PESO_CONFIANCA.alta
}

// ─── Orçamento ──────────────────────────────────────────────────────────────

export interface EstadoOrcamentoDescoberta {
  gasto: number
  teto: number
  saldo: number
  /** O clique cabe? */
  cabe: boolean
  /** Passou do percentual de alerta com este clique. */
  alerta: boolean
}

/**
 * O teto é do ORIGINADOR e é mensal (§4.2).
 *
 * Ele existe para que o originador acione sozinho — o teto é a autorização, não o
 * gestor. Pedir aprovação para cada R$ 1,65 transformaria a descoberta num processo
 * com fila, e uma fila de aprovação de centavos é como um recurso pago vira um
 * recurso que ninguém usa.
 */
export function avaliarOrcamento(
  gasto: number,
  teto: number,
  custoDoClique: number,
  alertaPercentual = 0.8,
): EstadoOrcamentoDescoberta {
  const projetado = gasto + custoDoClique
  return {
    gasto,
    teto,
    saldo: Math.max(0, teto - gasto),
    cabe: projetado <= teto,
    alerta: teto > 0 && projetado >= teto * alertaPercentual,
  }
}

// ─── Segunda passada: o que faltou ──────────────────────────────────────────

/**
 * O que já temos, o que morreu na validação, e o que ainda falta.
 *
 * É o insumo da busca aprofundada, e a razão de ela não ser "buscar de novo". Repetir
 * o mesmo prompt paga duas vezes pela mesma resposta; mandar junto o que já foi achado
 * e o que não funcionou muda a pergunta — de "ache contatos desta empresa" para "isto
 * aqui não serviu, ache o que falta".
 *
 * `pessoa` é a lacuna mais valiosa e a que a primeira passada quase nunca preenche: um
 * `contato@` genérico é um endereço, não alguém com quem falar.
 */
export interface ContatoConhecido {
  tipo: string
  valor: string
  confianca: Confianca
  nome_pessoa?: string | null
  /** `false` quando a validação reprovou (telefone impossível, domínio sem MX). */
  valido?: boolean | null
}

export interface LacunasDeContato {
  /** Já temos, e servem para a busca não devolver a mesma coisa. */
  temos: string[]
  /** Foram achados e NÃO funcionam. Dizer isso evita que ela os traga de novo. */
  falharam: string[]
  /** O que procurar. Vazio significa que não há o que pedir. */
  faltam: ('pessoa' | 'celular' | 'email' | 'whatsapp' | 'qualquer')[]
  /** Vale gastar? False quando já há canal direto e validado com uma pessoa. */
  vale_aprofundar: boolean
}

export function lacunasDeContato(contatos: readonly ContatoConhecido[]): LacunasDeContato {
  const vivos = contatos.filter((c) => c.valido !== false)
  const mortos = contatos.filter((c) => c.valido === false)

  const temPessoa = vivos.some((c) => (c.nome_pessoa ?? '').trim().length > 0)
  const temCelular = vivos.some((c) => c.tipo === 'telefone' && /^\+55\d{2}9\d{8}$/.test(c.valor))
  const temWhats = vivos.some((c) => c.tipo === 'whatsapp')
  const temEmail = vivos.some((c) => c.tipo === 'email')

  const faltam: LacunasDeContato['faltam'] = []
  if (vivos.length === 0) faltam.push('qualquer')
  else {
    if (!temPessoa) faltam.push('pessoa')
    if (!temCelular && !temWhats) faltam.push('celular')
    if (!temEmail) faltam.push('email')
  }

  return {
    temos: vivos.map((c) => `${c.tipo}: ${c.valor}${c.nome_pessoa ? ` (${c.nome_pessoa})` : ''}`),
    falharam: mortos.map((c) => `${c.tipo}: ${c.valor}`),
    faltam,
    /*
     * VALE SEMPRE QUE FALTA ALGO, e quem decide gastar é quem clica.
     *
     * A regra era mais estreita: `!(temPessoa && (temCelular || temWhats))`, para não
     * gastar R$ 0,25 confirmando o que está na tela. Na prática ela travava o botão
     * no caso mais comum de todos — um contato de confiança alta achado pela
     * varredura noturna, sem e-mail e sem segunda pessoa — e o originador ficava
     * sem caminho para procurar o decisor, que é exatamente o que a busca funda faz.
     *
     * A economia continua existindo onde ela não atrapalha: `faltam` vazio (temos
     * pessoa, celular/WhatsApp E e-mail) continua devolvendo false, e o TTL segue
     * recusando a repetição da mesma busca dentro da janela.
     */
    vale_aprofundar: faltam.length > 0,
  }
}
