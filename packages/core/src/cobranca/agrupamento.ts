import type { EscopoNotificacao, PapelNotificacaoCobranca } from './schemas.js'

/**
 * Quem recebe qual notificação (Prompt 07 §4). A unidade é a NOTIFICAÇÃO, não o título.
 *
 * Sacado:
 *   • a matriz recebe UMA carta com TODOS os títulos do grupo — ela responde pelo conjunto;
 *   • cada SPE/filial devedora recebe uma carta só com os títulos dela;
 *   • dedup: título cujo sacado É a matriz entra só na consolidada — a matriz nunca
 *     recebe duas cartas. Grupo com uma entidade só, e ela sendo a matriz, é uma carta.
 *
 * Cedente (só com `escopo = 'sacado_e_cedente'`):
 *   • uma carta por cedente, com todos os títulos dele na cobrança, qualquer que seja a
 *     SPE devedora;
 *   • com `notificarMatrizCedente` (padrão), a mesma regra matriz/filial: a matriz do
 *     cedente recebe o consolidado, a filial recebe o dela, com o mesmo dedup. Sem ela,
 *     cada CNPJ cedente recebe o que cedeu, e nada mais.
 *
 * A RPC `app_cobranca_salvar_notificacoes` confere as mesmas invariantes do lado do
 * banco. É defesa em profundidade, não uma segunda regra: se as duas divergirem, o
 * banco recusa e a tela mostra o erro — nunca sai uma carta errada.
 */

export interface TituloParaAgrupar {
  /** id em `cobranca_titulos`. */
  id: string
  sacado_cnpj: string
  sacado_matriz_cnpj: string
  cedente_cnpj: string
  cedente_matriz_cnpj: string
}

export interface NotificacaoAgrupada {
  papel: PapelNotificacaoCobranca
  destinatario_cnpj: string
  titulo_ids: string[]
}

export interface OpcoesAgrupamento {
  escopo: EscopoNotificacao
  notificarMatrizCedente: boolean
}

export class ErroAgrupamento extends Error {
  readonly codigo: 'vazio' | 'grupos_diferentes' | 'destinatario_duplicado'

  constructor(codigo: ErroAgrupamento['codigo'], mensagem: string) {
    super(mensagem)
    this.name = 'ErroAgrupamento'
    this.codigo = codigo
  }
}

function agruparPor<T>(itens: readonly T[], chave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const i of itens) {
    const k = chave(i)
    const lista = m.get(k)
    if (lista) lista.push(i)
    else m.set(k, [i])
  }
  return m
}

const ids = (ts: readonly TituloParaAgrupar[]): string[] => ts.map((t) => t.id)

/** Matriz e filiais de um mesmo nível (sacado ou cedente), com o dedup da matriz. */
function matrizEFiliais(
  titulos: readonly TituloParaAgrupar[],
  matriz: string,
  cnpjDe: (t: TituloParaAgrupar) => string,
  papelMatriz: PapelNotificacaoCobranca,
  papelFilial: PapelNotificacaoCobranca,
): NotificacaoAgrupada[] {
  const saida: NotificacaoAgrupada[] = [{ papel: papelMatriz, destinatario_cnpj: matriz, titulo_ids: ids(titulos) }]
  const filiais = agruparPor(
    titulos.filter((t) => cnpjDe(t) !== matriz),
    cnpjDe,
  )
  for (const [cnpj, ts] of [...filiais].sort(([a], [b]) => a.localeCompare(b))) {
    saida.push({ papel: papelFilial, destinatario_cnpj: cnpj, titulo_ids: ids(ts) })
  }
  return saida
}

export function agruparNotificacoes(
  titulos: readonly TituloParaAgrupar[],
  opcoes: OpcoesAgrupamento,
): NotificacaoAgrupada[] {
  if (titulos.length === 0) {
    throw new ErroAgrupamento('vazio', 'Selecione ao menos um título.')
  }

  const grupos = new Set(titulos.map((t) => t.sacado_matriz_cnpj))
  if (grupos.size > 1) {
    throw new ErroAgrupamento(
      'grupos_diferentes',
      'A seleção tem títulos de grupos diferentes. Uma cobrança é sempre de um único sacado (matriz e SPEs).',
    )
  }
  const matrizSacado = titulos[0]!.sacado_matriz_cnpj

  const notificacoes = matrizEFiliais(titulos, matrizSacado, (t) => t.sacado_cnpj, 'sacado_matriz', 'sacado_filial')

  if (opcoes.escopo === 'sacado_e_cedente') {
    if (opcoes.notificarMatrizCedente) {
      const porGrupoCedente = agruparPor(titulos, (t) => t.cedente_matriz_cnpj)
      for (const [matrizCedente, ts] of [...porGrupoCedente].sort(([a], [b]) => a.localeCompare(b))) {
        notificacoes.push(
          ...matrizEFiliais(ts, matrizCedente, (t) => t.cedente_cnpj, 'cedente_matriz', 'cedente_filial'),
        )
      }
    } else {
      const porCedente = agruparPor(titulos, (t) => t.cedente_cnpj)
      for (const [cnpj, ts] of [...porCedente].sort(([a], [b]) => a.localeCompare(b))) {
        const ehMatriz = ts[0]!.cedente_matriz_cnpj === cnpj
        notificacoes.push({ papel: ehMatriz ? 'cedente_matriz' : 'cedente_filial', destinatario_cnpj: cnpj, titulo_ids: ids(ts) })
      }
    }
  }

  // Um CNPJ recebe no máximo uma carta por rodada (é a unique do banco).
  const vistos = new Set<string>()
  for (const n of notificacoes) {
    if (vistos.has(n.destinatario_cnpj)) {
      throw new ErroAgrupamento(
        'destinatario_duplicado',
        `O CNPJ ${n.destinatario_cnpj} aparece como sacado e como cedente na mesma cobrança.`,
      )
    }
    vistos.add(n.destinatario_cnpj)
  }

  return notificacoes
}
