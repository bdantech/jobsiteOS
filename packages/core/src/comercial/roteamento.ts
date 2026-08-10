/**
 * Para quem vai esta nota fiscal, e para qual closer vai esta conta (04g §3).
 *
 * Mora no core, e não no worker, porque três consumidores precisam da MESMA resposta:
 * o job que roteia, a tela que explica por que a nota caiu no colo de alguém, e a fila
 * sem dono, que é literalmente o complemento deste cálculo. Duas implementações dariam
 * um dono na gravação e outro na explicação — e a explicação é o que faz um vendedor
 * aceitar que a nota não é dele.
 *
 * ── Duas atribuições diferentes, e a distinção é o ponto ──
 *
 * ORIGINADOR trabalha NOTA. A carteira dele é uma lista de empresas escolhidas a dedo,
 * e as notas dessas empresas são dele. É escolha, não regra: quem originou a relação
 * continua dono dela mesmo que a empresa mude de porte ou de estado.
 *
 * CLOSER trabalha CONTA. A carteira dele é um recorte — UF e faixa de faturamento —
 * porque quem fecha negócio é alocado por perfil de cliente, não por relação prévia.
 *
 * Território NÃO participa do roteamento de nota. Uma versão anterior deste arquivo
 * usava território como segundo critério para NF, e isso trocava as duas coisas de
 * lugar: fazia o originador receber conta por região (que é a régua do closer) e
 * deixava o closer sem régua nenhuma.
 *
 * ── A conta é a holding E as SPEs dela ──
 *
 * Uma construtora não é um CNPJ: é uma holding com dezenas de SPEs, e é contra a SPE que
 * se fatura. Escolher a holding na carteira e receber só as notas emitidas contra o CNPJ
 * dela entregava um quarto do trabalho — medido: 3.148 notas vivas contra clientes e
 * outras 1.112 contra SPEs desses mesmos clientes, que nunca chegavam a ninguém.
 *
 * Por isso a carteira casa por DOIS caminhos: a empresa escolhida, e o grupo econômico
 * dela quando a contraparte é uma SPE. Só `is_spe` sobe pelo grupo — o grupo também junta
 * empresas operacionais irmãs, que são contas próprias e podem ter dono próprio.
 */

export type OrigemDono = 'carteira' | 'manual'

export interface Territorio {
  ufs: readonly string[]
  faturamento_min: number | null
  faturamento_max: number | null
}

export interface OriginadorRoteavel {
  vendedor_id: string
  /** `settings.empresas_escolhidas`: a carteira explícita, por empresa_id. */
  empresas_escolhidas: readonly string[]
  /**
   * Os grupos econômicos das empresas escolhidas — é por aqui que as SPEs delas entram.
   *
   * Derivado da carteira, nunca escolhido à mão: um grupo na carteira sem a holding
   * correspondente seria uma atribuição que ninguém consegue explicar ao vendedor.
   */
  grupos_escolhidos?: readonly string[]
  /** NFs vivas hoje. Só desempata quando dois reivindicam a mesma empresa. */
  nfs_vivas: number
}

export interface NotaRoteavel {
  sacado_empresa_id: string | null
  fornecedor_empresa_id: string | null
  /**
   * Grupo econômico do sacado/fornecedor, preenchido SÓ quando ele é uma SPE.
   *
   * Vem nulo para empresa operacional mesmo que ela tenha grupo: quem decide se o vínculo
   * conta é quem monta a consulta, e a regra é "holding e suas SPEs" — não "tudo que
   * divide sócio".
   */
  sacado_grupo_spe?: string | null
  fornecedor_grupo_spe?: string | null
  /**
   * `gestao_operacao` do sacado — da HOLDING dele, quando o sacado é uma SPE. 'passivo'
   * tira a nota do roteamento inteiro, e o rótulo mora na holding: a SPE não tem gestão
   * própria, e ler o campo dela devolveria nulo para toda conta passiva do grupo.
   */
  sacado_gestao: string | null
  /** Dono atual e como ele chegou lá: 'manual' é decisão humana e não se revisa. */
  vendedor_id_atual?: string | null
  vendedor_origem_atual?: string | null
}

export interface ResultadoRoteamento {
  vendedor_id: string | null
  origem: OrigemDono | null
  /** Por que este dono — a frase que a tela mostra. */
  motivo: string
}

const SEM_DONO = (motivo: string): ResultadoRoteamento => ({ vendedor_id: null, origem: null, motivo })

/** Menos NFs vivas vence; empate resolve pelo id, para a decisão ser reprodutível. */
function menorCarga(lista: readonly OriginadorRoteavel[]): OriginadorRoteavel {
  return [...lista].sort(
    (a, b) => a.nfs_vivas - b.nfs_vivas || a.vendedor_id.localeCompare(b.vendedor_id),
  )[0] as OriginadorRoteavel
}

export function rotearNota(
  nota: NotaRoteavel,
  originadores: readonly OriginadorRoteavel[],
): ResultadoRoteamento {
  // Atribuição manual do gestor não é revista por heurística nenhuma. Sem esta guarda,
  // o próximo sync desfaz a correção e a pessoa refaz o mesmo trabalho amanhã.
  if (nota.vendedor_origem_atual === 'manual' && nota.vendedor_id_atual) {
    return {
      vendedor_id: nota.vendedor_id_atual,
      origem: 'manual',
      motivo: 'Atribuição manual do gestor — o roteamento automático não sobrescreve.',
    }
  }

  if (nota.sacado_gestao === 'passivo') {
    return SEM_DONO('Sacado é conta PASSIVA: não entra em carteira de originação.')
  }

  /** A empresa está na carteira dele — direto, ou por ser SPE de uma holding escolhida. */
  function alcanca(o: OriginadorRoteavel): 'direto' | 'spe' | null {
    if (
      (nota.sacado_empresa_id !== null && o.empresas_escolhidas.includes(nota.sacado_empresa_id)) ||
      (nota.fornecedor_empresa_id !== null && o.empresas_escolhidas.includes(nota.fornecedor_empresa_id))
    ) {
      return 'direto'
    }
    const grupos = o.grupos_escolhidos ?? []
    if (
      (nota.sacado_grupo_spe != null && grupos.includes(nota.sacado_grupo_spe)) ||
      (nota.fornecedor_grupo_spe != null && grupos.includes(nota.fornecedor_grupo_spe))
    ) {
      return 'spe'
    }
    return null
  }

  const porCarteira = originadores
    .map((o) => ({ o, via: alcanca(o) }))
    .filter((x): x is { o: OriginadorRoteavel; via: 'direto' | 'spe' } => x.via !== null)

  if (porCarteira.length === 0) {
    // Fila do gestor. É resposta, não falha — e uma fila comprida por muito tempo diz
    // que faltam empresas nas carteiras, não que falta trabalho manual.
    return SEM_DONO('Nenhum originador tem esta empresa na carteira.')
  }

  /*
   * Quem tem a empresa DIRETO ganha de quem a alcança pela SPE.
   *
   * O caso é real: um grupo pode ter dois clientes, e a SPE de um deles pode ser sacada
   * numa nota cujo fornecedor é o outro. Sem a precedência, a nota iria para o dono do
   * grupo em vez de para o dono da empresa que está escrita nela — e o vendedor olharia
   * a nota, veria o nome do próprio cliente, e não entenderia por que ela não é dele.
   */
  const diretos = porCarteira.filter((x) => x.via === 'direto')
  const candidatos = diretos.length > 0 ? diretos : porCarteira
  const via = candidatos[0]?.via
  const escolhido = menorCarga(candidatos.map((x) => x.o))

  return {
    vendedor_id: escolhido.vendedor_id,
    origem: 'carteira',
    motivo:
      candidatos.length > 1
        ? `Carteira explícita — ${candidatos.length} originadores reivindicam esta empresa; conferir cadastro.`
        : via === 'spe'
          ? 'Carteira explícita: SPE de uma holding do originador.'
          : 'Carteira explícita do originador.',
  }
}

// ─── O closer de uma conta ──────────────────────────────────────────────────

export interface CloserComTerritorio {
  vendedor_id: string
  territorio: Territorio | null
  /** Cards vivos no funil. Desempata entre closers que cobrem o mesmo recorte. */
  vendas_vivas: number
}

export interface ContaParaCloser {
  uf: string | null
  faturamento: number | null
}

function dentroDaFaixa(valor: number | null, t: Territorio): boolean {
  // Faixa aberta é faixa: um território sem mínimo aceita qualquer coisa abaixo do
  // máximo. Tratar null como "não casa" faria todo território mal preenchido virar
  // território vazio, e nenhuma conta encontraria dono.
  if (t.faturamento_min !== null && (valor === null || valor < t.faturamento_min)) return false
  if (t.faturamento_max !== null && (valor === null || valor > t.faturamento_max)) return false
  return true
}

export function cobreTerritorio(conta: ContaParaCloser, t: Territorio | null): boolean {
  if (!t) return false
  // Território sem UF nenhuma e sem faixa não é território — é um cadastro vazio, e
  // aceitá-lo faria um closer recém-criado receber todas as contas da casa.
  if (t.ufs.length === 0 && t.faturamento_min === null && t.faturamento_max === null) return false
  if (t.ufs.length > 0) {
    if (!conta.uf) return false
    if (!t.ufs.includes(conta.uf.toUpperCase())) return false
  }
  return dentroDaFaixa(conta.faturamento, t)
}

/**
 * Qual closer cobre esta conta — a sugestão que o SDR vê ao agendar.
 *
 * É SUGESTÃO, não imposição: o SDR pode escolher outro, e a tela deixa. Território
 * descreve o recorte normal; a exceção (o closer que já conhece aquele dono, a conta
 * que precisa de alguém sênior) é justamente o que uma regra automática erraria.
 *
 * Null quando ninguém cobre — e aí a tela mostra a lista inteira, sem inventar um dono.
 */
export function closerParaConta(
  conta: ContaParaCloser,
  closers: readonly CloserComTerritorio[],
): { vendedor_id: string; motivo: string } | null {
  const cobrem = closers.filter((c) => cobreTerritorio(conta, c.territorio))
  if (cobrem.length === 0) return null

  const escolhido = [...cobrem].sort(
    (a, b) => a.vendas_vivas - b.vendas_vivas || a.vendedor_id.localeCompare(b.vendedor_id),
  )[0] as CloserComTerritorio

  return {
    vendedor_id: escolhido.vendedor_id,
    motivo:
      cobrem.length > 1
        ? `Território (${conta.uf ?? 'sem UF'}) — desempate por carga: ${escolhido.vendas_vivas} cards vivos.`
        : `Território (${conta.uf ?? 'sem UF'}) do closer.`,
  }
}
