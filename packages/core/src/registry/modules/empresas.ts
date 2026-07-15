import { criarEmpresa } from '../../db/mutations.js'
import {
  buscarEmpresasSchema,
  criarEmpresaSchema,
  formatCnpj,
  type BuscarEmpresasInput,
  type CriarEmpresaInput,
} from '../../schemas/index.js'
import type { AppModule, ToolContext } from '../types.js'

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

export const empresasModule: AppModule = {
  id: 'empresas',
  name: 'Empresas',
  icon: 'building-2',
  route: '/empresas',
  tools: [
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
