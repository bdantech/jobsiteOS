import {
  avaliarCertificado,
  compararUrgencia,
  contaComoValido,
  type AvaliacaoCertificado,
  type CertificadoLike,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras do grid de certificados (04b §4).
 *
 * Tudo vem de UMA chamada (`certificados_grid`): o grid cruza `empresas`,
 * `clientes_onepay`, `mercado_universo` e `certificados`, e montar isso no cliente
 * seria 4 leituras + um join em JavaScript sobre 744 SPEs. A RPC é SECURITY DEFINER
 * porque as SPEs vivem em `mercado_universo`, que o módulo `empresas` não lê.
 */

export const certificadosKeys = {
  all: ['certificados'] as const,
  grid: () => [...certificadosKeys.all, 'grid'] as const,
}

interface CelulaBruta {
  cnpj: string
  razao_social: string
  empresa_id?: string | null
  certificado: CertificadoLike | null
}

interface ClienteBruto extends CelulaBruta {
  empresa_id: string
  nome_fantasia: string | null
  credito_disponivel: number | null
  credito_limite: number | null
  spes: CelulaBruta[]
}

interface GridBruto {
  tem_acesso: boolean
  clientes?: ClienteBruto[]
  ocultas?: SpeOculta[]
  total_ativos?: number
  sincronizado_em?: string | null
}

export interface SpeOculta {
  cnpj: string
  razao_social: string
  oculto_em: string
  oculto_por_nome: string | null
  /** Cliente (matriz) ou SPE — o painel de ocultados diz qual é qual. */
  eh_cliente: boolean
}

export interface Celula extends AvaliacaoCertificado {
  cnpj: string
  razao_social: string
  empresaId: string | null
}

export interface LinhaCliente {
  empresaId: string
  cnpj: string
  razaoSocial: string
  matriz: Celula
  spes: Celula[]
  /** Limite disponível do cliente na Onepay. `null` = sem dado sincronizado. */
  creditoDisponivel: number | null
  creditoLimite: number | null
}

export interface Indicadores {
  /** Matrizes verdes ou amarelas ÷ total de construtoras clientes. */
  pctClientes: number | null
  clientesValidos: number
  clientesTotal: number
  /** SPEs visíveis verdes ou amarelas ÷ total de SPEs visíveis. */
  pctSpes: number | null
  spesValidas: number
  spesTotal: number
  /** Inclui FORNECEDORES — escopo diferente dos outros dois de propósito (§4). */
  totalAtivos: number
}

export interface Grid {
  clientes: LinhaCliente[]
  ocultas: SpeOculta[]
  indicadores: Indicadores
  sincronizadoEm: string | null
}

function montarCelula(c: CelulaBruta, hoje: Date): Celula {
  return {
    cnpj: c.cnpj,
    razao_social: c.razao_social,
    empresaId: c.empresa_id ?? null,
    ...avaliarCertificado(c.certificado, hoje),
  }
}

export async function buscarGridCertificados(): Promise<Grid> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('certificados_grid' as never)
  if (error) throw new Error(error.message)

  const bruto = data as unknown as GridBruto | null
  if (!bruto?.tem_acesso) throw new Error('Você não tem acesso ao módulo Empresas.')

  // UMA referência de "hoje" para o grid inteiro: avaliar cada célula com um `new
  // Date()` próprio faria duas células virarem o dia em momentos diferentes se o
  // carregamento cruzasse a meia-noite.
  const hoje = new Date()

  const clientes: LinhaCliente[] = (bruto.clientes ?? []).map((c) => ({
    empresaId: c.empresa_id,
    cnpj: c.cnpj,
    razaoSocial: c.razao_social,
    matriz: montarCelula(c, hoje),
    creditoDisponivel: c.credito_disponivel ?? null,
    creditoLimite: c.credito_limite ?? null,
    // Mais urgente primeiro: com até 370 SPEs numa linha, o que o olho alcança
    // primeiro tem de ser o que exige ação.
    spes: (c.spes ?? []).map((s) => montarCelula(s, hoje)).sort(ordenarCelulas),
  }))

  const matrizesValidas = clientes.filter((c) => contaComoValido(c.matriz.estado)).length
  const todasSpes = clientes.flatMap((c) => c.spes)
  const spesValidas = todasSpes.filter((s) => contaComoValido(s.estado)).length

  return {
    clientes,
    ocultas: bruto.ocultas ?? [],
    sincronizadoEm: bruto.sincronizado_em ?? null,
    indicadores: {
      pctClientes: clientes.length ? matrizesValidas / clientes.length : null,
      clientesValidos: matrizesValidas,
      clientesTotal: clientes.length,
      pctSpes: todasSpes.length ? spesValidas / todasSpes.length : null,
      spesValidas,
      spesTotal: todasSpes.length,
      totalAtivos: bruto.total_ativos ?? 0,
    },
  }
}

const ordenarCelulas = (a: Celula, b: Celula): number =>
  compararUrgencia(
    { estado: a.estado, diasRestantes: a.diasRestantes, nome: a.razao_social },
    { estado: b.estado, diasRestantes: b.diasRestantes, nome: b.razao_social },
  )

/** A lista "Atenção" (§5): amarelos e vermelhos de clientes e SPEs, por urgência. */
export function itensAtencao(grid: Grid): Array<Celula & { cliente: string; ehMatriz: boolean }> {
  const itens = grid.clientes.flatMap((c) => [
    { ...c.matriz, cliente: c.razaoSocial, ehMatriz: true },
    ...c.spes.map((s) => ({ ...s, cliente: c.razaoSocial, ehMatriz: false })),
  ])
  return itens.filter((i) => i.estado !== 'valido').sort(ordenarCelulas)
}
