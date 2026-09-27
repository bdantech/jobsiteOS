import { faixaEngine } from '../antecipacao/faixas.js'
import {
  criarFiltroEngine,
  type FiltroEngine,
  type Grupo,
  type SqlCompilado,
  type VariavelCatalogo,
} from '../mercado/filters.js'
import type { EscopoAgente, ModoRodagem } from './schemas.js'

/**
 * O ESCOPO DE UM AGENTE (Prompt 09 §3.3) — com o motor de filtros do Prompt 02.
 *
 * ─── DOIS CATÁLOGOS, PORQUE SÃO DUAS POPULAÇÕES ─────────────────────────────
 * Originação trabalha NOTAS: faixa de valor, sacado, vencimento — o catálogo das faixas,
 * sobre `notas_funil`, que já governa a classificação do funil. Reunião, qualificação e
 * reativação trabalham EMPRESAS: porte, UF, score, estágio — um catálogo próprio, sobre a
 * view `agentes_empresas_alvo` (0270b). Um catálogo único deixaria uma regra de SDR
 * referenciar `dias_para_vencimento` e compilar para uma coluna que não existe.
 *
 * ─── O PILOTO É POR CIMA ────────────────────────────────────────────────────
 * Enquanto `modo_rodagem = 'piloto'`, o filtro de piloto entra em E com o escopo: cota
 * limita volume, piloto limita a QUEM. Onde errar é barato primeiro.
 */

export const CATALOGO_ALVOS: readonly VariavelCatalogo[] = [
  { id: 'uf', label: 'UF', tipo: 'texto', coluna: 'uf' },
  { id: 'municipio', label: 'Município', tipo: 'texto', coluna: 'municipio' },
  {
    id: 'porte',
    label: 'Porte',
    tipo: 'enum',
    coluna: 'porte',
    opcoes: ['MEI', 'ME', 'EPP', 'DEMAIS'],
    rotulos: { MEI: 'MEI', ME: 'Microempresa', EPP: 'Pequeno porte', DEMAIS: 'Demais (médio/grande)' },
  },
  { id: 'estagio', label: 'Estágio da relação', tipo: 'texto', coluna: 'estagio' },
  { id: 'camada', label: 'Camada da pirâmide', tipo: 'texto', coluna: 'camada' },
  { id: 'origem', label: 'Origem da empresa', tipo: 'texto', coluna: 'origem' },
  { id: 'cnae_principal', label: 'CNAE principal', tipo: 'texto', coluna: 'cnae_principal' },
  { id: 'is_spe', label: 'É SPE', tipo: 'booleano', coluna: 'is_spe' },
  { id: 'faturamento_anual', label: 'Faturamento anual (R$)', tipo: 'numero', coluna: 'faturamento_anual' },
  { id: 'funcionarios', label: 'Funcionários', tipo: 'numero', coluna: 'funcionarios' },
  { id: 'score_credito', label: 'Score de crédito', tipo: 'numero', coluna: 'score_credito' },
  { id: 'score_faixa', label: 'Faixa do score', tipo: 'texto', coluna: 'score_faixa' },
  { id: 'chance_concessao', label: 'Chance de concessão (0–1)', tipo: 'numero', coluna: 'chance_concessao' },
  { id: 'limite_potencial', label: 'Limite potencial (R$)', tipo: 'numero', coluna: 'limite_potencial' },
  {
    id: 'tipagem_antecipacao',
    label: 'Tipagem de antecipação',
    tipo: 'enum',
    coluna: 'tipagem_antecipacao',
    opcoes: ['aquisicao', 'ativacao', 'recorrencia'],
  },
  {
    id: 'gestao_operacao',
    label: 'Gestão da operação',
    tipo: 'texto',
    coluna: 'gestao_operacao',
  },
  { id: 'e_ex_cliente', label: 'É ex-cliente', tipo: 'booleano', coluna: 'e_ex_cliente' },
  { id: 'meses_desde_ex_cliente', label: 'Meses desde que virou ex-cliente', tipo: 'numero', coluna: 'meses_desde_ex_cliente' },
  { id: 'dias_sem_conversa', label: 'Dias sem conversa', tipo: 'numero', coluna: 'dias_sem_conversa' },
  { id: 'dias_sem_antecipar', label: 'Dias sem antecipar', tipo: 'numero', coluna: 'dias_sem_antecipar' },
  { id: 'tem_dominio', label: 'Tem domínio', tipo: 'booleano', coluna: 'tem_dominio' },
  { id: 'qtd_contatos_telefone', label: 'Contatos com telefone', tipo: 'numero', coluna: 'qtd_contatos_telefone' },
  { id: 'tem_titular', label: 'Tem vendedor titular', tipo: 'booleano', coluna: 'tem_titular' },
  { id: 'sdr_fit', label: 'Fit avaliado pelo SDR', tipo: 'booleano', coluna: 'sdr_fit' },
  { id: 'sdr_estagio', label: 'Estágio no funil do SDR', tipo: 'texto', coluna: 'sdr_estagio' },
]

export const alvosEngine: FiltroEngine = criarFiltroEngine(CATALOGO_ALVOS)

/** Em que população um tipo de mandato trabalha. */
export function populacaoDoTipo(tipo: string): 'notas' | 'empresas' {
  return tipo === 'originacao_nf' ? 'notas' : 'empresas'
}

export function engineDaPopulacao(p: 'notas' | 'empresas'): FiltroEngine {
  return p === 'notas' ? faixaEngine : alvosEngine
}

/** Junta duas árvores em E. Nula de um lado = a outra, sozinha; as duas nulas = sem filtro. */
export function combinarArvores(a: Grupo | null, b: Grupo | null): Grupo | null {
  if (a && b) return { operador: 'e', condicoes: [a, b] }
  return a ?? b ?? null
}

/** A árvore validada, ou nula se não houver árvore. Árvore INVÁLIDA lança — o gestor precisa ver. */
export function lerArvore(engine: FiltroEngine, bruto: unknown): Grupo | null {
  if (bruto === null || bruto === undefined) return null
  if (typeof bruto === 'object' && !Array.isArray(bruto) && Object.keys(bruto as object).length === 0) return null
  return engine.parseArvore(bruto)
}

/**
 * A árvore que VALE agora para a população: escopo (e piloto por cima, em modo piloto),
 * opcionalmente em E com o filtro de uma regra de mandato.
 */
export function arvoreEfetiva(
  escopo: EscopoAgente | null,
  modo: ModoRodagem,
  populacao: 'notas' | 'empresas',
  filtroDaRegra: unknown = null,
): Grupo | null {
  const engine = engineDaPopulacao(populacao)
  const base = lerArvore(engine, populacao === 'notas' ? escopo?.filtro_nf : escopo?.filtro)
  const piloto = modo === 'piloto' ? lerArvore(engine, populacao === 'notas' ? escopo?.piloto_nf : escopo?.piloto) : null
  const regra = lerArvore(engine, filtroDaRegra)
  return combinarArvores(combinarArvores(base, piloto), regra)
}

/** `where` para o worker. Sem árvore nenhuma, `true` — quem chama decide se isso é aceitável. */
export function whereDaArvore(populacao: 'notas' | 'empresas', arvore: Grupo | null): SqlCompilado {
  if (!arvore) return { text: 'true', values: [] }
  return engineDaPopulacao(populacao).compileToSql(arvore)
}

/**
 * O agente entra na DISTRIBUIÇÃO padrão (leads, notas por cota)? (§1.9 e §3.3)
 *
 * Humano: sempre. IA: só no modo `carteira`, e só com o modo liberado em config — hoje
 * desligado. A distribuição filtrava só tipo e ativo, e um vendedor de IA ativo recebia
 * leads e notas que nenhum job trabalhava: carteira fantasma, com aviso para ninguém.
 */
export function entraNaDistribuicao(
  v: { is_ia: boolean; escopo?: unknown },
  modoCarteiraHabilitado: boolean,
): boolean {
  if (!v.is_ia) return true
  if (!modoCarteiraHabilitado) return false
  const modo = v.escopo && typeof v.escopo === 'object' ? (v.escopo as { modo?: unknown }).modo : null
  return modo === 'carteira'
}
