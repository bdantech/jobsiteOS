/**
 * Para quem vai esta nota fiscal (04g §3).
 *
 * Mora no core, e não no worker, porque três consumidores precisam da MESMA resposta:
 * o sync que classifica a NF em faixa, a tela que explica por que a nota caiu no colo
 * de alguém, e a fila sem dono, que é literalmente o complemento deste cálculo. Duas
 * implementações dariam um dono na gravação e outro na explicação — e a explicação é o
 * que faz um vendedor aceitar que a nota não é dele.
 *
 * A precedência é uma regra de negócio, não uma otimização:
 *
 *   1. CARTEIRA explícita — alguém escolheu esta empresa. Escolha vence heurística.
 *   2. TERRITÓRIO — UF do sacado + faixa de faturamento. Empate resolve por carga.
 *   3. SEM DONO — vai para a fila do gestor. É resposta, não falha.
 *
 * E uma exclusão que vem antes de tudo: **sacado passivo não entra**. Passivo é uma
 * decisão de não trabalhar a conta; rotear a NF dela para um originador seria pedir
 * trabalho de quem não vai ser comissionado por ele.
 */

export type OrigemDono = 'carteira' | 'territorio' | 'manual'

export interface Territorio {
  ufs: readonly string[]
  faturamento_min: number | null
  faturamento_max: number | null
}

export interface OriginadorRoteavel {
  vendedor_id: string
  /** `empresas_escolhidas` das settings: carteira explícita, por empresa_id. */
  empresas_escolhidas: readonly string[]
  territorio: Territorio | null
  /** NFs vivas hoje. Só desempata território — nunca vence uma carteira explícita. */
  nfs_vivas: number
}

export interface NotaRoteavel {
  sacado_empresa_id: string | null
  fornecedor_empresa_id: string | null
  sacado_uf: string | null
  sacado_faturamento: number | null
  /** `gestao_operacao` do SACADO. 'passivo' tira a nota do roteamento inteiro. */
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

function dentroDaFaixa(valor: number | null, t: Territorio): boolean {
  // Faixa aberta é faixa: um território sem mínimo aceita qualquer coisa abaixo do
  // máximo. Tratar null como "não casa" faria todo território mal preenchido virar
  // território vazio, e as notas iriam todas para a fila sem ninguém entender.
  if (t.faturamento_min !== null && (valor === null || valor < t.faturamento_min)) return false
  if (t.faturamento_max !== null && (valor === null || valor > t.faturamento_max)) return false
  return true
}

function casaTerritorio(nota: NotaRoteavel, t: Territorio | null): boolean {
  if (!t) return false
  // Território sem UF nenhuma e sem faixa não é território — é um cadastro vazio, e
  // aceitá-lo faria um originador recém-criado abocanhar a base inteira.
  if (t.ufs.length === 0 && t.faturamento_min === null && t.faturamento_max === null) return false
  if (t.ufs.length > 0) {
    if (!nota.sacado_uf) return false
    if (!t.ufs.includes(nota.sacado_uf.toUpperCase())) return false
  }
  return dentroDaFaixa(nota.sacado_faturamento, t)
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

  // ── 1. Carteira explícita ──
  const porCarteira = originadores.filter(
    (o) =>
      (nota.sacado_empresa_id !== null && o.empresas_escolhidas.includes(nota.sacado_empresa_id)) ||
      (nota.fornecedor_empresa_id !== null && o.empresas_escolhidas.includes(nota.fornecedor_empresa_id)),
  )
  if (porCarteira.length > 0) {
    // Dois donos para a mesma empresa é erro de cadastro, não de roteamento. Escolher
    // o de menor carga é arbitrário mas estável, e o motivo denuncia a duplicidade.
    const escolhido = menorCarga(porCarteira)
    return {
      vendedor_id: escolhido.vendedor_id,
      origem: 'carteira',
      motivo:
        porCarteira.length > 1
          ? `Carteira explícita — ${porCarteira.length} originadores reivindicam esta empresa; conferir cadastro.`
          : 'Carteira explícita do originador.',
    }
  }

  // ── 2. Território ──
  const porTerritorio = originadores.filter((o) => casaTerritorio(nota, o.territorio))
  if (porTerritorio.length > 0) {
    const escolhido = menorCarga(porTerritorio)
    return {
      vendedor_id: escolhido.vendedor_id,
      origem: 'territorio',
      motivo:
        porTerritorio.length > 1
          ? `Território (${nota.sacado_uf ?? 'sem UF'}) — desempate por carga: ${escolhido.nfs_vivas} NFs vivas.`
          : `Território (${nota.sacado_uf ?? 'sem UF'}) do originador.`,
    }
  }

  // ── 3. Fila sem dono ──
  return SEM_DONO(
    nota.sacado_uf
      ? `Nenhum originador cobre ${nota.sacado_uf} nesta faixa de faturamento.`
      : 'Sacado sem UF conhecida: nenhum território pode reivindicar a nota.',
  )
}

/** Menos NFs vivas vence; empate resolve pelo id, para a decisão ser reprodutível. */
function menorCarga(lista: readonly OriginadorRoteavel[]): OriginadorRoteavel {
  return [...lista].sort(
    (a, b) => a.nfs_vivas - b.nfs_vivas || a.vendedor_id.localeCompare(b.vendedor_id),
  )[0] as OriginadorRoteavel
}
