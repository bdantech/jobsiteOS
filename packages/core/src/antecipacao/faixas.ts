import {
  criarFiltroEngine,
  type FiltroEngine,
  type Grupo,
  type No,
  type Operador,
  type SqlCompilado,
  type VariavelCatalogo,
} from '../mercado/filters.js'

/**
 * O catálogo de variáveis das FAIXAS — nível NF, com o contexto de fornecedor e
 * de sacado já resolvido.
 *
 * Mesmo contrato do catálogo do Mercado: toda entrada aqui DEVE nomear uma
 * coluna real da view `notas_funil` (migration 0046). O catálogo é a whitelist;
 * nada além dele chega a SQL.
 *
 * É um catálogo SEPARADO, e não uma extensão do outro, porque as duas superfícies
 * não têm as mesmas colunas: `obras_ativas` não existe em notas_funil e
 * `dias_para_vencimento` não existe em mercado_explorador. Um catálogo único
 * deixaria uma regra de faixa referenciar `capital_social` e compilar para uma
 * coluna inexistente — erro que ninguém vê até a reclassificação noturna falhar.
 */
export const CATALOGO_FAIXAS: readonly VariavelCatalogo[] = [
  // ─── Fornecedor (a unidade de abordagem) ──────────────────────────────────
  {
    id: 'fornecedor_cadastrado',
    label: 'Fornecedor cadastrado na plataforma',
    tipo: 'booleano',
    coluna: 'fornecedor_cadastrado',
    descricao: 'Veio como `supplier.registered` no payload da NF.',
  },
  {
    id: 'fornecedor_tipagem',
    label: 'Tipagem do fornecedor',
    tipo: 'enum',
    coluna: 'fornecedor_tipagem',
    opcoes: ['aquisicao', 'ativacao', 'recorrencia'],
    descricao:
      'aquisicao (fora da plataforma) | ativacao (dentro, nunca antecipou) | recorrencia (já antecipou).',
  },
  {
    id: 'fornecedor_ja_antecipou',
    label: 'Fornecedor já antecipou',
    tipo: 'booleano',
    coluna: 'fornecedor_ja_antecipou',
  },
  {
    id: 'fornecedor_e_cliente_onepay',
    label: 'Fornecedor é cliente Onepay',
    tipo: 'booleano',
    coluna: 'fornecedor_e_cliente_onepay',
  },
  {
    id: 'fornecedor_tem_protesto',
    label: 'Fornecedor tem protesto',
    tipo: 'booleano',
    coluna: 'fornecedor_tem_protesto',
    descricao:
      'Última consulta de protesto do Radar indicou protesto. ATENÇÃO: consulta de protesto é ' +
      'paga e opt-in por empresa, então `false` aqui significa "não consultamos" com muito mais ' +
      'frequência do que "não tem". Serve para EXCLUIR quem tem, não para atestar quem não tem.',
  },
  {
    id: 'fornecedor_protesto_valor',
    label: 'Valor protestado do fornecedor',
    tipo: 'numero',
    coluna: 'fornecedor_protesto_valor',
    descricao:
      'Soma dos protestos na última consulta. R$ 800 de protesto e R$ 800 mil não são o mesmo ' +
      'risco, e o booleano não distingue os dois.',
  },
  {
    id: 'fornecedor_capital_social',
    label: 'Capital social do fornecedor',
    tipo: 'numero',
    coluna: 'fornecedor_capital_social',
    descricao:
      'Vem de `mercado_universo`, ou seja: do lookup cadastral. Fornecedor ainda não enriquecido ' +
      'fica NULO — e nulo não satisfaz nenhum operador de comparação, então uma regra com esta ' +
      'variável exclui silenciosamente quem a fila ainda não processou.',
  },
  {
    id: 'fornecedor_situacao_cadastral',
    label: 'Situação cadastral do fornecedor',
    tipo: 'texto',
    coluna: 'fornecedor_situacao_cadastral',
    descricao:
      'ativa | suspensa | inapta | baixada | nula, normalizado no lookup. Nota de empresa baixada ' +
      'não se antecipa.',
  },
  {
    id: 'fornecedor_ultimo_numero_nf',
    label: 'Último número de NFe do fornecedor',
    tipo: 'numero',
    coluna: 'fornecedor_ultimo_numero_nf',
    descricao:
      'A maior sequência de NFe já observada deste emitente — proxy de PORTE, não de relação ' +
      'conosco: o `nNF` é sequencial por emitente, então ele estima quantas notas o fornecedor ' +
      'emitiu no total, inclusive as que nunca passam por nós. Serve para tirar do funil o ' +
      'gigante que emite muito e não precisa antecipar. Só NFe: o número da NFS-e nacional é ' +
      'identificador composto, não sequência. Quem só emite serviço fica nulo.',
  },
  {
    id: 'fornecedor_suprimido',
    label: 'Fornecedor suprimido',
    tipo: 'booleano',
    coluna: 'fornecedor_suprimido',
    descricao:
      'Está na lista de supressão e a supressão ainda vale. Notas de suprimidos saem das ' +
      'faixas de qualquer forma — a variável existe para regras que queiram ser explícitas.',
  },
  { id: 'fornecedor_uf', label: 'UF do fornecedor', tipo: 'texto', coluna: 'fornecedor_uf' },

  // ─── Sacado (quem paga, e portanto quem carrega o risco) ──────────────────
  {
    id: 'sacado_cadastrado',
    label: 'Sacado cadastrado na plataforma',
    tipo: 'booleano',
    coluna: 'sacado_cadastrado',
  },
  {
    id: 'sacado_credito_status',
    label: 'Status de crédito do sacado',
    tipo: 'texto',
    coluna: 'sacado_credito_status',
    descricao: 'Vem de `creditAnalysis.status` (ex.: APPROVED, PENDING, DENIED).',
  },
  {
    id: 'sacado_limite_disponivel',
    label: 'Limite disponível do sacado',
    tipo: 'numero',
    coluna: 'sacado_limite_disponivel',
  },
  {
    id: 'sacado_limite_cobre_nota',
    label: 'Limite do sacado cobre a nota',
    tipo: 'booleano',
    coluna: 'sacado_limite_cobre_nota',
    descricao: 'Limite disponível ≥ valor da nota. Sem isto, "aprovado" não significa operável.',
  },
  { id: 'sacado_uf', label: 'UF do sacado', tipo: 'texto', coluna: 'sacado_uf' },

  // ─── A nota ───────────────────────────────────────────────────────────────
  {
    id: 'dias_para_vencimento',
    label: 'Dias para o vencimento',
    tipo: 'numero',
    coluna: 'dias_para_vencimento',
    descricao:
      'Calculado na view (vencimento − hoje), não lido de coluna: uma regra não pode classificar ' +
      'com o número de ontem quando o job diário atrasa.',
  },
  { id: 'valor', label: 'Valor da nota', tipo: 'numero', coluna: 'valor' },
  {
    id: 'receita_esperada',
    label: 'Receita esperada',
    tipo: 'numero',
    coluna: 'receita_esperada',
    descricao: 'valor × taxa mensal × (dias para vencimento ÷ 30).',
  },
  {
    id: 'direction',
    label: 'Direção da nota',
    tipo: 'enum',
    coluna: 'direction',
    opcoes: ['received', 'issued'],
  },
  { id: 'tipo_nf', label: 'Tipo da nota', tipo: 'enum', coluna: 'tipo_nf', opcoes: ['NFe', 'NFSe'] },
  {
    id: 'vencimento_origem',
    label: 'Origem do vencimento',
    tipo: 'enum',
    coluna: 'vencimento_origem',
    opcoes: ['xml', 'endpoint', 'estimado'],
    descricao:
      'Uma faixa pode (e provavelmente deve) exigir vencimento real: "estimado" é emissão + 30 dias.',
  },
  {
    id: 'estagio_funil',
    label: 'Estágio no funil',
    tipo: 'enum',
    coluna: 'estagio_funil',
    opcoes: [
      'a_prospectar',
      'em_prospeccao',
      'em_negociacao',
      'antecipacao_andamento',
      'convertida',
      'perdida',
      'expirada',
    ],
    descricao: 'Posição no funil, movida por AÇÃO. Não confundir com faixa, que é computada.',
  },
]

/**
 * O engine das faixas: mesmo compilador, mesma validação, outro catálogo.
 * `compileToSql` daqui roda no worker contra `notas_funil`; `compileToPostgrest`
 * roda no browser/celular contra a mesma view, sob RLS.
 */
export const faixaEngine: FiltroEngine = criarFiltroEngine(CATALOGO_FAIXAS)

export const VARIAVEL_FAIXA_IDS = faixaEngine.variavelIds
export const arvoreFaixaSchema = faixaEngine.arvoreSchema

export function variavelFaixa(id: string): VariavelCatalogo | undefined {
  return faixaEngine.variavel(id)
}

export function operadoresFaixaDe(id: string): readonly Operador[] {
  return faixaEngine.operadoresDe(id)
}

export function parseArvoreFaixa(input: unknown): Grupo {
  return faixaEngine.parseArvore(input)
}

export function compileFaixaToPostgrest(arvore: unknown, hoje: Date = new Date()): string {
  return faixaEngine.compileToPostgrest(arvore, hoje)
}

export function compileFaixaToSql(arvore: unknown, hoje: Date = new Date()): SqlCompilado {
  return faixaEngine.compileToSql(arvore, hoje)
}

export function descreverFaixa(no: No, nivel = 0): string {
  return faixaEngine.descrever(no, nivel)
}
