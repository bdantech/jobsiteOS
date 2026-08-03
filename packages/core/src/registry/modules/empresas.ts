import {
  ESTADO_CERTIFICADO_LABELS,
  avaliarCertificado,
  compararUrgencia,
  contaComoValido,
  formatarVencimento,
} from '../../certificados/estado.js'
import { criarEmpresa } from '../../db/mutations.js'
import {
  buscarEmpresasSchema,
  criarEmpresaSchema,
  formatCnpj,
  type BuscarEmpresasInput,
  type CriarEmpresaInput,
} from '../../schemas/index.js'
import type { AppModule, ToolContext } from '../types.js'
import { z } from 'zod'

const consultarCertificadoSchema = z.object({
  cnpj: z
    .string()
    .trim()
    .min(11)
    .describe('CNPJ da empresa (com ou sem pontuação) cujo certificado digital será consultado.'),
})
type ConsultarCertificadoInput = z.infer<typeof consultarCertificadoSchema>

const statusGeralSchema = z.object({})

/**
 * The proof that the registry pattern works: `empresas` is fully registry-driven
 * on both platforms. Adding a module = migration + screens + an entry here.
 */

async function buscarEmpresas(input: BuscarEmpresasInput, ctx: ToolContext) {
  let query = ctx.supabase
    .from('empresas')
    .select('id, cnpj, razao_social, nome_fantasia, tipo, estagio, uf, municipio, erp_atual, erp_mrr')
    .order('razao_social', { ascending: true })
    .limit(input.limite)

  if (input.termo) {
    // Indexed by the pg_trgm GIN indexes from migration 0007. Commas inside the
    // .or() string are the separator, so a term containing one would inject an
    // extra condition — strip it.
    const termo = input.termo.replace(/[,()]/g, '')
    query = query.or(
      `razao_social.ilike.%${termo}%,nome_fantasia.ilike.%${termo}%,cnpj.ilike.%${termo}%`,
    )
  }
  if (input.estagio) query = query.eq('estagio', input.estagio)
  if (input.tipo) query = query.eq('tipo', input.tipo)
  if (input.uf) query = query.eq('uf', input.uf.toUpperCase())

  const { data, error } = await query
  if (error) throw new Error(`Falha ao buscar empresas: ${error.message}`)

  // Shaped for the model: formatted CNPJ, and a route it can navigate to.
  return {
    total: data.length,
    empresas: data.map((e) => ({
      ...e,
      cnpj: formatCnpj(e.cnpj),
      route: `/empresas/${e.id}`,
    })),
  }
}


// ─── Certificados digitais (04b §6) ─────────────────────────────────────────

/**
 * Os três indicadores + o que precisa de ação. Vem da MESMA RPC que o grid usa, e
 * não de uma consulta própria: a pergunta "quantos clientes estão com certificado
 * válido?" tem de ter uma resposta só, seja na tela ou pelo chat.
 */
async function certificadosStatusGeral(_input: unknown, ctx: ToolContext) {
  const { data, error } = await ctx.supabase.rpc('certificados_grid' as never)
  if (error) throw new Error(`Falha ao ler certificados: ${error.message}`)

  const grid = data as unknown as {
    tem_acesso?: boolean
    clientes?: Array<{
      cnpj: string
      razao_social: string
      certificado: { expires_at?: string | null; status?: string | null } | null
      spes?: Array<{
        cnpj: string
        razao_social: string
        certificado: { expires_at?: string | null; status?: string | null } | null
      }>
    }>
    total_ativos?: number
    sincronizado_em?: string | null
  } | null

  if (!grid?.tem_acesso) throw new Error('Sem acesso ao módulo Empresas.')

  const clientes = grid.clientes ?? []
  const linhas = clientes.map((c) => ({
    cliente: c.razao_social,
    cnpj: formatCnpj(c.cnpj),
    matriz: avaliarCertificado(c.certificado),
    spes: (c.spes ?? []).map((s) => ({
      nome: s.razao_social,
      cnpj: formatCnpj(s.cnpj),
      ...avaliarCertificado(s.certificado),
    })),
  }))

  const matrizesOk = linhas.filter((l) => contaComoValido(l.matriz.estado)).length
  const spes = linhas.flatMap((l) => l.spes)
  const spesOk = spes.filter((s) => contaComoValido(s.estado)).length

  // Só o que exige ação: uma lista com 744 SPEs verdes não ajuda a responder nada.
  const atencao = linhas
    .flatMap((l) => [
      { empresa: l.cliente, tipo: 'matriz' as const, ...l.matriz, cliente: l.cliente },
      ...l.spes.map((s) => ({ empresa: s.nome, tipo: 'spe' as const, ...s, cliente: l.cliente })),
    ])
    .filter((i) => i.estado !== 'valido')
    .sort((a, b) => compararUrgencia(a, b))
    .slice(0, 50)

  return {
    indicadores: {
      pct_clientes_validos: linhas.length ? Math.round((100 * matrizesOk) / linhas.length) : null,
      clientes_validos: matrizesOk,
      clientes_total: linhas.length,
      pct_spes_validas: spes.length ? Math.round((100 * spesOk) / spes.length) : null,
      spes_validas: spesOk,
      spes_total: spes.length,
      // Escopo maior de propósito: inclui fornecedores, que não aparecem no grid.
      total_certificados_ativos: grid.total_ativos ?? 0,
    },
    sincronizado_em: grid.sincronizado_em ?? null,
    atencao: atencao.map((i) => ({
      empresa: i.empresa,
      cliente: i.cliente,
      tipo: i.tipo,
      estado: ESTADO_CERTIFICADO_LABELS[i.estado],
      vence_em: formatarVencimento(i.expiraEm),
      dias_restantes: i.diasRestantes,
    })),
    route: '/empresas/certificados',
  }
}

async function certificadosConsultar(input: ConsultarCertificadoInput, ctx: ToolContext) {
  const cnpj = input.cnpj.replace(/\D/g, '')
  const { data, error } = await ctx.supabase
    .from('certificados')
    .select('cnpj, company_name, expires_at, status, sincronizado_em')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (error) throw new Error(`Falha ao consultar certificado: ${error.message}`)

  const avaliacao = avaliarCertificado(data)
  return {
    cnpj: formatCnpj(cnpj),
    empresa: data?.company_name ?? null,
    // 'ausente' aqui significa "não há certificado na base" — e o efeito prático é o
    // mesmo de vencido: nenhuma NF-e desta empresa é ingerida.
    estado: ESTADO_CERTIFICADO_LABELS[avaliacao.estado],
    vence_em: formatarVencimento(avaliacao.expiraEm),
    dias_restantes: avaliacao.diasRestantes,
    status_origem: data?.status ?? null,
    sincronizado_em: data?.sincronizado_em ?? null,
    route: '/empresas/certificados',
  }
}

export const empresasModule: AppModule = {
  id: 'empresas',
  name: 'Empresas',
  icon: 'building-2',
  route: '/empresas',
  group: 'operacoes',
  tools: [
    {
      id: 'certificados.status_geral',
      name: 'Status geral dos certificados digitais',
      description:
        'Os três indicadores de cobertura de certificado digital (% de clientes com certificado ' +
        'válido, % de SPEs válidas, total de certificados ativos) mais a lista do que exige ação — ' +
        'vencendo em até 30 dias, vencido, ou sem certificado na base. Certificado vencido significa ' +
        'que a plataforma PAROU de ingerir NF-e daquela empresa. Use para responder "quais clientes ' +
        'estão com certificado a vencer?" e "qual nossa cobertura de certificados?".',
      inputSchema: statusGeralSchema,
      mutates: false,
      execute: (input, ctx) => certificadosStatusGeral(input, ctx),
    },
    {
      id: 'certificados.consultar',
      name: 'Consultar certificado de uma empresa',
      description:
        'Estado do certificado digital de um CNPJ: válido, vencendo, vencido ou sem certificado ' +
        'na base, com a data de vencimento e os dias restantes. Cobre qualquer empresa ' +
        'sincronizada, inclusive fornecedores (que não aparecem no grid).',
      inputSchema: consultarCertificadoSchema,
      mutates: false,
      execute: (input, ctx) => certificadosConsultar(input as ConsultarCertificadoInput, ctx),
    },
    {
      id: 'empresas.search',
      name: 'Buscar empresas',
      description:
        'Busca empresas por razão social, nome fantasia ou CNPJ (aceita trechos parciais), ' +
        'com filtros opcionais de estágio do funil, tipo e UF. Use para responder perguntas ' +
        'sobre a carteira e para localizar uma empresa antes de abri-la. Retorna a rota de ' +
        'cada empresa no campo `route`, que pode ser usada para navegar até ela. ' +
        'Retorna também `erp_atual` (o ERP que a empresa usa hoje) e `erp_mrr` (o valor mensal ' +
        'que ela PAGA por esse ERP) — isso é inteligência competitiva, NÃO é receita da ONE OS. ' +
        'Só busca na base de Empresas; para o universo de mercado use mercado.buscar_universo.',
      inputSchema: buscarEmpresasSchema,
      mutates: false,
      execute: (input, ctx) => buscarEmpresas(input as BuscarEmpresasInput, ctx),
    },
    {
      id: 'empresas.create',
      name: 'Criar empresa',
      description:
        'Cadastra uma nova empresa a partir do CNPJ e da razão social. O CNPJ é validado ' +
        '(dígitos verificadores) e precisa ser único. Como esta ação grava dados, exige ' +
        'confirmação explícita do usuário antes de executar.',
      inputSchema: criarEmpresaSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const empresa = await criarEmpresa(ctx.supabase, input as CriarEmpresaInput)
        return {
          id: empresa.id,
          cnpj: formatCnpj(empresa.cnpj),
          razao_social: empresa.razao_social,
          route: `/empresas/${empresa.id}`,
        }
      },
    },
  ],
}
