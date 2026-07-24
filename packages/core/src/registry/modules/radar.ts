import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import { criarLote, suprimir } from '../../radar/mutations.js'
import {
  buscarContatosEmpresaSchema,
  criarLoteSchema,
  protestosEmpresaSchema,
  statusEnriquecimentoSchema,
  suprimirSchema,
  type BuscarContatosEmpresaInput,
  type CriarLoteInput,
  type ProtestosEmpresaInput,
  type StatusEnriquecimentoInput,
  type SuprimirInput,
} from '../../radar/schemas.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Radar: enriquecimento com controle de custo (domínios, contatos, protestos) e
 * clientes Onepay. As tools de leitura veem só o que a RLS deixa; as de escrita
 * (criar_lote, suprimir) NUNCA executam enriquecimento pago — criam rascunho /
 * suprimem — e por isso pedem confirmação.
 *
 * webOnly por enquanto: as telas mobile entram na Fase 5; enquanto não existirem,
 * marcar não-webOnly quebraria o build mobile (invariante: todo módulo não-webOnly
 * exige a pasta apps/mobile/app/(tabs)/radar/).
 */

// ─── radar.status_enriquecimento ────────────────────────────────────────────

async function statusEnriquecimento(input: StatusEnriquecimentoInput, ctx: ToolContext) {
  const base = () => {
    const q = ctx.supabase.from('mercado_explorador').select('*', { count: 'exact', head: true })
    return input.camada ? q.eq('camada', input.camada) : q
  }

  const [tot, dom, con, pro] = await Promise.all([
    base(),
    base().not('dominio', 'is', null),
    base().gt('qtd_contatos', 0),
    base().not('protestos_consultados_em', 'is', null),
  ])

  const total = tot.count ?? 0
  const pct = (n: number) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0)
  const cobertura = (n: number | null) => ({ total: n ?? 0, pct: pct(n ?? 0) })

  return {
    camada: input.camada ?? 'todas',
    total,
    dominio: cobertura(dom.count),
    contato: cobertura(con.count),
    protesto: cobertura(pro.count),
    route: '/radar',
  }
}

// ─── radar.buscar_contatos_empresa ──────────────────────────────────────────

async function buscarContatosEmpresa(input: BuscarContatosEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data: empresa } = await ctx.supabase
    .from('empresas')
    .select('id, razao_social')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!empresa) {
    return {
      encontrado: false,
      mensagem: 'Empresa não está na base (talvez não promovida). Contatos são vinculados a empresas.',
    }
  }

  const { data, error } = await ctx.supabase
    .from('contatos')
    .select('nome, cargo, email, telefone, whatsapp, email_status, telefone_status, senioridade, departamento, linkedin_url, origem')
    .eq('empresa_id', empresa.id)
  if (error) throw new Error(`Falha ao buscar contatos: ${error.message}`)

  return {
    encontrado: true,
    empresa: { id: empresa.id, razao_social: empresa.razao_social },
    contatos: data ?? [],
    route: `/empresas/${empresa.id}`,
  }
}

// ─── radar.protestos_empresa ────────────────────────────────────────────────

async function protestosEmpresa(input: ProtestosEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data, error } = await ctx.supabase
    .from('protestos_consultas')
    .select('fonte, consultado_em, tem_protesto, qtd_protestos, valor_total')
    .eq('cnpj', cnpj)
    .order('consultado_em', { ascending: false })
    .limit(20)
  if (error) throw new Error(`Falha ao buscar protestos: ${error.message}`)

  return { cnpj: formatCnpj(cnpj), consultas: data ?? [] }
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export const radarModule: AppModule = {
  id: 'radar',
  name: 'Radar',
  icon: 'radar',
  route: '/radar',
  webOnly: true, // TODO Fase 5: criar telas mobile e remover este flag.
  tools: [
    {
      id: 'radar.status_enriquecimento',
      name: 'Status de enriquecimento',
      description:
        'Cobertura de enriquecimento por camada: % de empresas com domínio resolvido, com ' +
        'contato conhecido e com protesto já consultado. Filtro opcional de camada. Use para ' +
        'responder "qual a cobertura de contatos no SAM?" e priorizar lotes.',
      inputSchema: statusEnriquecimentoSchema,
      mutates: false,
      execute: (input, ctx) => statusEnriquecimento(input as StatusEnriquecimentoInput, ctx),
    },
    {
      id: 'radar.buscar_contatos_empresa',
      name: 'Buscar contatos da empresa',
      description:
        'Lista os contatos conhecidos de uma empresa a partir do CNPJ (nome, cargo, e-mail, ' +
        'telefone, senioridade, LinkedIn). Só enxerga empresas já na base.',
      inputSchema: buscarContatosEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => buscarContatosEmpresa(input as BuscarContatosEmpresaInput, ctx),
    },
    {
      id: 'radar.protestos_empresa',
      name: 'Protestos da empresa',
      description:
        'Histórico de consultas de protesto de um CNPJ (fonte, data, se tem protesto, ' +
        'quantidade e valor). É histórico: mostra a evolução, não só o estado atual.',
      inputSchema: protestosEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => protestosEmpresa(input as ProtestosEmpresaInput, ctx),
    },
    {
      id: 'radar.criar_lote',
      name: 'Criar lote de enriquecimento',
      description:
        'Monta um lote de enriquecimento (dominio | contatos | protestos) a partir de uma ' +
        'árvore de filtros sobre o universo. NÃO executa e NÃO gasta: cria em rascunho / ' +
        'aguardando aprovação, para um humano revisar o custo estimado antes de rodar. Como ' +
        'grava dados, exige confirmação explícita.',
      inputSchema: criarLoteSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const lote = await criarLote(ctx.supabase, input as CriarLoteInput)
        return {
          id: lote.id,
          tipo: lote.tipo,
          nome: lote.nome,
          status: lote.status,
          route: `/radar/lotes/${lote.id}`,
        }
      },
    },
    {
      id: 'radar.suprimir',
      name: 'Adicionar à lista de supressão',
      description:
        'Adiciona um e-mail, telefone, whatsapp ou CNPJ à lista de supressão, com motivo ' +
        'obrigatório. A partir daí, nenhum canal pode tocá-lo. Como grava dados, exige ' +
        'confirmação explícita.',
      inputSchema: suprimirSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const sup = await suprimir(ctx.supabase, input as SuprimirInput)
        return { id: sup.id, escopo: sup.escopo, valor: sup.valor, motivo: sup.motivo, route: '/radar/supressao' }
      },
    },
  ],
}
