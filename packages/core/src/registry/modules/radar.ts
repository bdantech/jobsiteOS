import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import { criarLote, suprimir } from '../../radar/mutations.js'
import {
  ORIGEM_METRICA_LABELS,
  MODELO_LABELS,
  type ModeloId,
  type OrigemMetrica,
} from '../../radar/faturamento.js'
import {
  atualizarFuncionariosSchema,
  buscarContatosEmpresaSchema,
  criarLoteSchema,
  faturamentoEmpresaSchema,
  protestosEmpresaSchema,
  statusEnriquecimentoSchema,
  suprimirSchema,
  type AtualizarFuncionariosInput,
  type BuscarContatosEmpresaInput,
  type FaturamentoEmpresaInput,
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


// ─── radar.faturamento_empresa (04c §9) ─────────────────────────────────────

/**
 * O valor vigente E como se chegou nele.
 *
 * A explicação não é enfeite: uma estimativa sem procedência não sobrevive à
 * primeira pergunta numa reunião. Por isso a resposta carrega os modelos usados, os
 * pesos, as restrições aplicadas e a versão dos coeficientes — e diz explicitamente
 * quando o número é declarado, que é o único caso em que não é estimativa.
 */
async function faturamentoEmpresa(input: FaturamentoEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)

  const { data: empresa } = await ctx.supabase
    .from('empresas')
    // Literal numa linha só, e não concatenação: o supabase-js infere o tipo do
    // retorno a partir do texto do select, e `'a' + 'b'` não é um literal para o
    // compilador — o resultado vira GenericStringError e o tipo se perde inteiro.
    .select('id, razao_social, tipo, faturamento_anual, faturamento_origem, faturamento_confianca, faturamento_atualizado_em, funcionarios, funcionarios_origem, funcionarios_atualizado_em, funcionarios_crescimento_12m, regime_tributario')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!empresa) {
    return {
      encontrada: false,
      cnpj: formatCnpj(cnpj),
      resumo: 'Esta empresa não está na base — só CNPJs promovidos têm faturamento estimado.',
    }
  }

  const { data: serie } = await ctx.supabase
    .from('empresa_metricas')
    .select('metrica, valor, origem, confianca, detalhes, capturado_em')
    .eq('cnpj', cnpj)
    .order('capturado_em', { ascending: false })
    .limit(20)

  const ultimoModelo = (serie ?? []).find(
    (m) => m.metrica === 'faturamento_anual' && (m.origem === 'modelo' || m.origem === 'bracket_simples'),
  )
  const detalhes = (ultimoModelo?.detalhes ?? {}) as {
    versao_estimador?: number
    modelos?: Array<{ id: ModeloId; valor: number; peso: number }>
    restricoes?: string[]
  }

  const declarado = empresa.faturamento_origem === 'declarado_cliente'

  return {
    encontrada: true,
    cnpj: formatCnpj(cnpj),
    razao_social: empresa.razao_social,
    tipo: empresa.tipo,
    faturamento: {
      valor: empresa.faturamento_anual,
      origem: empresa.faturamento_origem,
      origem_label: empresa.faturamento_origem
        ? (ORIGEM_METRICA_LABELS[empresa.faturamento_origem as OrigemMetrica] ?? empresa.faturamento_origem)
        : null,
      confianca: empresa.faturamento_confianca,
      atualizado_em: empresa.faturamento_atualizado_em,
      declarado_pelo_cliente: declarado,
    },
    funcionarios: {
      valor: empresa.funcionarios,
      origem: empresa.funcionarios_origem,
      crescimento_12m: empresa.funcionarios_crescimento_12m,
      atualizado_em: empresa.funcionarios_atualizado_em,
    },
    regime_tributario: empresa.regime_tributario,
    como_foi_estimado: declarado
      ? 'Não foi estimado: este valor foi DECLARADO pelo cliente e nenhuma estimativa o sobrescreve.'
      : {
          versao_estimador: detalhes.versao_estimador ?? null,
          modelos: (detalhes.modelos ?? []).map((m) => ({
            modelo: MODELO_LABELS[m.id] ?? m.id,
            valor: m.valor,
            peso: m.peso,
          })),
          restricoes: detalhes.restricoes ?? [],
        },
    historico: (serie ?? []).map((m) => ({
      metrica: m.metrica,
      valor: m.valor,
      origem: m.origem,
      em: m.capturado_em,
    })),
    aviso:
      'Headcount de fontes como o Apollo SUBCONTA mão de obra de canteiro. Serve para comparar ' +
      'empresas sob a mesma régua, não como quadro real.',
    route: `/empresas/${empresa.id}`,
  }
}

// ─── radar.atualizar_funcionarios ───────────────────────────────────────────

async function atualizarFuncionarios(input: AtualizarFuncionariosInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)
  const { data: empresa } = await ctx.supabase
    .from('empresas')
    .select('id, razao_social, dominio')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!empresa) throw new Error('Empresa não encontrada na base.')
  // Sem domínio a consulta não tem como acontecer. Dizer isso agora é melhor que
  // enfileirar um job que vai falhar com `sem_dominio` daqui a um minuto.
  if (!empresa.dominio) {
    throw new Error('Esta empresa ainda não tem domínio resolvido — rode a cascata de domínio antes.')
  }

  return {
    empresa_id: empresa.id,
    razao_social: empresa.razao_social,
    dominio: empresa.dominio,
    enfileirado: true,
    aviso:
      'A consulta é assíncrona e não consome crédito de revelação. O resultado aparece na ' +
      'Company 360 em alguns instantes.',
    route: `/empresas/${empresa.id}`,
  }
}

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
      id: 'radar.faturamento_empresa',
      name: 'Faturamento da empresa',
      description:
        'Faturamento anual e headcount vigentes de um CNPJ, com a ORIGEM de cada um (declarado ' +
        'pelo cliente vs. estimado), a confiança, e como a estimativa foi feita: quais modelos ' +
        'entraram, com que peso, que restrições foram aplicadas e qual versão dos coeficientes. ' +
        'Inclui o histórico resumido. Use para responder "quanto essa empresa fatura?" sem ' +
        'apresentar estimativa como fato.',
      inputSchema: faturamentoEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => faturamentoEmpresa(input as FaturamentoEmpresaInput, ctx),
    },
    {
      id: 'radar.atualizar_funcionarios',
      name: 'Atualizar funcionários',
      description:
        'Dispara a consulta de headcount no Apollo para uma empresa (por CNPJ). Exige domínio ' +
        'resolvido. Não consome crédito de revelação, mas grava um snapshot novo na série — ' +
        'como altera dados, exige confirmação explícita.',
      inputSchema: atualizarFuncionariosSchema,
      mutates: true,
      execute: (input, ctx) => atualizarFuncionarios(input as AtualizarFuncionariosInput, ctx),
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
