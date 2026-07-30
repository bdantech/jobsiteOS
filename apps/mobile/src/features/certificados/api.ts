import {
  avaliarCertificado,
  compararUrgencia,
  contaComoValido,
  type AvaliacaoCertificado,
  type CertificadoLike,
} from '@jobsiteos/core'

import { supabase } from '@/lib/supabase'

/**
 * Certificados no mobile (04b §5).
 *
 * O grid completo NÃO cabe em tela pequena — 47 clientes × até 370 SPEs. O celular
 * entrega o que é acionável fora do escritório: os três indicadores e a lista do que
 * precisa de ação, por urgência, com link para a Company 360.
 *
 * Mesma RPC da web, e mesma regra de estado do core: um quadrado amarelo no desktop
 * e "válido" no celular seria o pior resultado possível.
 */

export interface ItemAtencao extends AvaliacaoCertificado {
  cnpj: string
  nome: string
  cliente: string
  ehMatriz: boolean
  empresaId: string | null
}

export interface IndicadoresCertificados {
  pctClientes: number | null
  clientesValidos: number
  clientesTotal: number
  pctSpes: number | null
  spesValidas: number
  spesTotal: number
  totalAtivos: number
}

export interface ResumoCertificadosData {
  indicadores: IndicadoresCertificados
  atencao: ItemAtencao[]
  sincronizadoEm: string | null
}

interface CelulaBruta {
  cnpj: string
  razao_social: string
  empresa_id?: string | null
  certificado: CertificadoLike | null
}

interface GridBruto {
  tem_acesso?: boolean
  clientes?: Array<CelulaBruta & { empresa_id: string; spes?: CelulaBruta[] }>
  total_ativos?: number
  sincronizado_em?: string | null
}

export async function fetchResumoCertificados(): Promise<ResumoCertificadosData> {
  const { data, error } = await supabase.rpc('certificados_grid' as never)
  if (error) throw new Error(error.message)

  const grid = data as unknown as GridBruto | null
  if (!grid?.tem_acesso) throw new Error('Você não tem acesso ao módulo Empresas.')

  // Uma referência de "hoje" para o resumo inteiro — ver a mesma nota na web.
  const hoje = new Date()
  const clientes = grid.clientes ?? []

  const linhas = clientes.map((c) => ({
    cliente: c.razao_social,
    empresaId: c.empresa_id,
    matriz: { ...avaliarCertificado(c.certificado, hoje), cnpj: c.cnpj, nome: c.razao_social },
    spes: (c.spes ?? []).map((s) => ({
      ...avaliarCertificado(s.certificado, hoje),
      cnpj: s.cnpj,
      nome: s.razao_social,
      empresaId: s.empresa_id ?? null,
    })),
  }))

  const matrizesOk = linhas.filter((l) => contaComoValido(l.matriz.estado)).length
  const spes = linhas.flatMap((l) => l.spes)
  const spesOk = spes.filter((s) => contaComoValido(s.estado)).length

  const atencao: ItemAtencao[] = linhas
    .flatMap((l) => [
      { ...l.matriz, cliente: l.cliente, ehMatriz: true, empresaId: l.empresaId },
      ...l.spes.map((s) => ({ ...s, cliente: l.cliente, ehMatriz: false })),
    ])
    .filter((i) => i.estado !== 'valido')
    .sort((a, b) => compararUrgencia({ ...a, nome: a.nome }, { ...b, nome: b.nome }))

  return {
    indicadores: {
      pctClientes: linhas.length ? matrizesOk / linhas.length : null,
      clientesValidos: matrizesOk,
      clientesTotal: linhas.length,
      pctSpes: spes.length ? spesOk / spes.length : null,
      spesValidas: spesOk,
      spesTotal: spes.length,
      totalAtivos: grid.total_ativos ?? 0,
    },
    atencao,
    sincronizadoEm: grid.sincronizado_em ?? null,
  }
}
