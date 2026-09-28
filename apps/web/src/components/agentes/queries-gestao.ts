import {
  alvosEngine,
  faixaEngine,
  montarConfigAgentes,
  type ConfigAgentes,
  type Grupo,
  type Json,
  type Tables,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras das telas de GESTÃO dos Agentes (Prompt 09 §11.3–§11.5, §12): Personas,
 * Materiais, Desempenho e Configurações. As de Ao vivo e Mandatos moram em
 * `queries-operacao.ts`, de outra frente; as chaves ficam sob o mesmo prefixo `agentes`
 * para uma escrita daqui (pausar um agente) poder invalidar a faixa de lá com um só
 * `invalidateQueries`.
 *
 * Tudo roda com o client do USUÁRIO: a RLS da 0270c é quem decide. `email_caixas` e
 * `mandato_regras` só respondem ao gestor — e é exatamente por isso que as quatro telas
 * perguntam `app_agentes_gestor()` antes de montar qualquer coisa.
 */
export const gestaoAgentesKeys = {
  all: ['agentes'] as const,
  gestor: () => [...gestaoAgentesKeys.all, 'gestor'] as const,
  personas: () => [...gestaoAgentesKeys.all, 'personas'] as const,
  disjuntores: () => [...gestaoAgentesKeys.all, 'disjuntores'] as const,
  contasIa: () => [...gestaoAgentesKeys.all, 'contas-ia'] as const,
  caixas: () => [...gestaoAgentesKeys.all, 'caixas'] as const,
  closers: () => [...gestaoAgentesKeys.all, 'closers'] as const,
  config: () => [...gestaoAgentesKeys.all, 'config'] as const,
  orcamento: () => [...gestaoAgentesKeys.all, 'orcamento-mes'] as const,
  materiais: () => [...gestaoAgentesKeys.all, 'materiais'] as const,
  desempenho: (dias: number) => [...gestaoAgentesKeys.all, 'desempenho', dias] as const,
  regras: () => [...gestaoAgentesKeys.all, 'regras'] as const,
  playbooks: () => [...gestaoAgentesKeys.all, 'playbooks-mandato'] as const,
  contagem: (populacao: string, arvore: string) =>
    [...gestaoAgentesKeys.all, 'contagem', populacao, arvore] as const,
}

// ─── Gestor ─────────────────────────────────────────────────────────────────

/** "Sou gestor?" — decide o que a tela monta. Cada RPC de escrita decide de verdade. */
export async function buscarSouGestorAgentes(): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_agentes_gestor')
  if (error) return false
  return data === true
}

// ─── Personas ───────────────────────────────────────────────────────────────

export type AgenteIa = Pick<
  Tables<'vendedores'>,
  | 'id'
  | 'nome'
  | 'tipo'
  | 'ativo'
  | 'whatsapp_conta_id'
  | 'email_remetente'
  | 'email_caixa_id'
  | 'voz_conta_id'
  | 'persona'
  | 'closer_id'
  | 'closer_substituto_id'
  | 'escopo'
  | 'limites'
  | 'modo_rodagem'
  | 'autonomo'
  | 'pausado_em'
  | 'pausado_motivo'
  | 'criado_em'
>

export async function buscarAgentesIa(): Promise<AgenteIa[]> {
  const supabase = createClient()
  // prettier-ignore
  const { data, error } = await supabase
    .from('vendedores')
    .select('id, nome, tipo, ativo, whatsapp_conta_id, email_remetente, email_caixa_id, voz_conta_id, persona, closer_id, closer_substituto_id, escopo, limites, modo_rodagem, autonomo, pausado_em, pausado_motivo, criado_em')
    .eq('is_ia', true)
    .order('ativo', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export type Disjuntor = Tables<'agentes_disjuntor'>

export async function buscarDisjuntores(): Promise<Disjuntor[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('agentes_disjuntor').select('*')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface ContaIa {
  id: string
  apelido: string
  numero: string
  ativo: boolean
}

/**
 * As linhas que um agente pode ter: contas do tipo `ia`. Inativas vêm junto de propósito
 * — a tela mostra que existem e por que não servem, em vez de sumir com elas e deixar o
 * gestor procurando o número que ele sabe que cadastrou.
 */
export async function buscarContasIa(): Promise<ContaIa[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('whatsapp_contas')
    .select('id, apelido, numero, ativo')
    .eq('tipo', 'ia')
    .order('apelido')
  if (error) throw new Error(error.message)
  return data ?? []
}

export type CaixaEmail = Pick<
  Tables<'email_caixas'>,
  'id' | 'endereco' | 'provedor' | 'ativa' | 'conectada_em' | 'ultimo_erro' | 'ultimo_sync_em'
>

export async function buscarCaixas(): Promise<CaixaEmail[]> {
  const supabase = createClient()
  // Sem os ids de segredo do Vault: a tela não tem o que fazer com eles.
  const { data, error } = await supabase
    .from('email_caixas')
    .select('id, endereco, provedor, ativa, conectada_em, ultimo_erro, ultimo_sync_em')
    .order('endereco')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface Closer {
  id: string
  nome: string
  ausente_ate: string | null
}

/** Closers humanos ativos — a RPC recusa closer que seja IA ou que não seja `vendedor`. */
export async function buscarClosers(): Promise<Closer[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vendedores')
    .select('id, nome, ausente_ate')
    .eq('is_ia', false)
    .eq('tipo', 'vendedor')
    .eq('ativo', true)
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Quantos mandatos ATIVOS o agente tem agora — a cota livre da prévia de impacto. Contado
 * no banco (`head: true`), não somando linhas: o PostgREST corta a resposta em mil linhas,
 * e uma soma no navegador subestimaria justamente o agente mais carregado.
 */
export async function contarAtivosDoAgente(agenteId: string): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('mandatos')
    .select('id', { count: 'exact', head: true })
    .eq('agente_id', agenteId)
    .in('estado', ['aberto', 'em_andamento', 'aguardando_externo'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Mandatos ainda vivos criados por uma regra — o que já ocupa o teto dela (inclui pausados). */
export async function contarAtivosDaRegra(regraId: string): Promise<number> {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('mandatos')
    .select('id', { count: 'exact', head: true })
    .eq('regra_id', regraId)
    .in('estado', ['aberto', 'em_andamento', 'aguardando_externo', 'pausado'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

// ─── Configuração ───────────────────────────────────────────────────────────

export interface VozStatus {
  versao: string | null
  detectada_em: string | null
}

export interface ConfigLida {
  config: ConfigAgentes
  vozStatus: VozStatus | null
  atualizadoEm: string | null
}

/**
 * A config montada com o default por chave (`montarConfigAgentes`): linha ausente ou
 * pela metade aparece como o padrão da spec — que é também o que o worker usa. Mostrar
 * outra coisa seria a tela dizer um número e o ciclo rodar com outro.
 */
export async function buscarConfigAgentes(): Promise<ConfigLida> {
  const supabase = createClient()
  const { data, error } = await supabase.from('agentes_config').select('chave, valor, atualizado_em')
  if (error) throw new Error(error.message)
  const linhas = data ?? []
  const voz = linhas.find((l) => l.chave === 'voz_status')?.valor as
    | { versao?: unknown; detectada_em?: unknown }
    | null
    | undefined
  const atualizadoEm = linhas
    .filter((l) => l.chave !== 'voz_status')
    .map((l) => l.atualizado_em)
    .sort()
    .pop()
  return {
    config: montarConfigAgentes(linhas),
    vozStatus: voz
      ? {
          versao: typeof voz.versao === 'string' ? voz.versao : null,
          detectada_em: typeof voz.detectada_em === 'string' ? voz.detectada_em : null,
        }
      : null,
    atualizadoEm: atualizadoEm ?? null,
  }
}

export type OrcamentoMes = Tables<'agentes_orcamento'>

function primeiroDiaDoMes(): string {
  // O mês é o de São Paulo, o mesmo de `app__agentes_mes_atual()`: na virada, às 22h do
  // dia 31 em Brasília já é dia 1 em UTC, e a tela mostraria o mês que ainda não começou.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
  return `${partes.slice(0, 7)}-01`
}

export async function buscarOrcamentoMes(): Promise<OrcamentoMes | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('agentes_orcamento')
    .select('*')
    .eq('mes', primeiroDiaDoMes())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ─── Materiais ──────────────────────────────────────────────────────────────

export type Material = Tables<'materiais'>

export async function buscarMateriais(): Promise<Material[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('materiais')
    .select('*')
    .order('ativo', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export const BUCKET_MATERIAIS = 'agentes-materiais'

/** URL assinada de 10 minutos para pré-visualizar (ou baixar) um arquivo do bucket. */
export async function urlAssinadaMaterial(caminho: string): Promise<string | null> {
  const supabase = createClient()
  const { data, error } = await supabase.storage.from(BUCKET_MATERIAIS).createSignedUrl(caminho, 600)
  if (error) return null
  return data.signedUrl
}

/**
 * Sobe um arquivo pelo client do usuário: a política `agentes_materiais_insert` só deixa
 * o gestor escrever. Sem `upsert` de propósito — o bucket não tem política de UPDATE, e
 * todo arquivo novo vai para um caminho novo (uuid), inclusive a troca de foto da persona.
 */
export async function enviarArquivoAgentes(caminho: string, arquivo: File): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.storage
    .from(BUCKET_MATERIAIS)
    .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined })
  if (error) throw new Error(error.message)
}

// ─── Desempenho (§11.5) ─────────────────────────────────────────────────────

export interface DesempenhoAgente {
  agente_id: string
  nome: string
  mandatos: number
  ativos: number
  concluidos: number
  encerrados: number
  escalados: number
  taxa_sucesso: number | null
  reunioes: number
  convertidos: number
  custo_centavos: number
  custo_por_concluido: number | null
  custo_por_reuniao: number | null
  custo_por_conversao: number | null
  horas_ate_objetivo: number | null
  por_tipo: Record<string, { total: number; concluidos: number }>
}

export interface DesempenhoPlaybook {
  playbook: string
  mandatos: number
  concluidos: number
  taxa_sucesso: number | null
  custo_por_concluido: number | null
}

export interface DesempenhoMaterial {
  material_id: string
  nome: string
  enviados: number
  respondidos: number
  taxa_resposta: number | null
  vezes_usado: number
}

export interface DesempenhoCanal {
  canal: string
  enviados: number
  respondidos: number
  taxa_resposta: number | null
}

export interface Desempenho {
  desde: string
  por_agente: DesempenhoAgente[]
  por_playbook: DesempenhoPlaybook[]
  motivos_encerramento: Record<string, number>
  materiais: DesempenhoMaterial[]
  canais: DesempenhoCanal[]
  humanos: {
    sdr_taxa_reuniao: number | null
    originacao_taxa_conversao: number | null
    observacao: string
  }
}

/** O painel inteiro numa RPC só (0270f) — a mesma que a tool `agentes.desempenho` lê. */
export async function buscarDesempenho(dias: number): Promise<Desempenho> {
  const supabase = createClient()
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { data, error } = await supabase.rpc('app_agentes_desempenho', { p: { desde } })
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as unknown as Partial<Desempenho>
  return {
    desde: d.desde ?? desde,
    por_agente: d.por_agente ?? [],
    por_playbook: d.por_playbook ?? [],
    motivos_encerramento: d.motivos_encerramento ?? {},
    materiais: d.materiais ?? [],
    canais: d.canais ?? [],
    humanos: d.humanos ?? { sdr_taxa_reuniao: null, originacao_taxa_conversao: null, observacao: '' },
  }
}

// ─── Regras de mandato (§2.3) ───────────────────────────────────────────────

export type RegraMandato = Tables<'mandato_regras'>

export async function buscarRegras(): Promise<RegraMandato[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('mandato_regras')
    .select('*')
    .order('ativa', { ascending: false })
    .order('prioridade', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface PlaybookMandato {
  id: string
  nome: string
  funil: string
  objetivo: string
  instrucoes: string
  acoes_permitidas: string[]
  templates_disponiveis: string[] | null
  prazos: Json
  tipo_mandato: string | null
  ativo: boolean
  versao: number
  atualizado_em: string
}

/**
 * Os playbooks de MANDATO (os de conversa ficam em Comunicação). Todas as versões: o
 * seletor da regra mostra as inativas desabilitadas, e a aba Playbooks lista o histórico.
 */
export async function buscarPlaybooksMandato(): Promise<PlaybookMandato[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('agente_playbooks')
    .select('id, nome, funil, objetivo, instrucoes, acoes_permitidas, templates_disponiveis, prazos, tipo_mandato, ativo, versao, atualizado_em')
    .not('tipo_mandato', 'is', null)
    .order('nome')
    .order('versao', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Prévia de população ────────────────────────────────────────────────────

/**
 * Quantas empresas (ou notas) a árvore pega HOJE, sob a RLS de quem pergunta.
 *
 * Aplica as mesmas exclusões que o criador de mandatos aplica fora do filtro (worker
 * `criar-mandatos`): empresa em cobrança ou suprimida nunca entra, e nota só conta nos
 * estágios que o agente pode trabalhar. Uma prévia que ignorasse isso prometeria um
 * número que o job nunca entregaria.
 *
 * Árvore nula conta a base inteira — quem chama decide se isso é aceitável (a regra sem
 * filtro efetivo não cria nada; a tela diz isso).
 */
export async function contarPopulacao(populacao: 'empresas' | 'notas', arvore: Grupo | null): Promise<number> {
  const supabase = createClient()
  if (populacao === 'empresas') {
    let q = supabase
      .from('agentes_empresas_alvo')
      .select('empresa_id', { count: 'exact', head: true })
      .eq('em_cobranca', false)
      .eq('suprimida', false)
    if (arvore) q = q.or(alvosEngine.compileToPostgrest(arvore))
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count ?? 0
  }
  let q = supabase
    .from('notas_funil')
    .select('access_key', { count: 'exact', head: true })
    .in('estagio_funil', ['a_prospectar', 'em_prospeccao'])
  if (arvore) q = q.or(faixaEngine.compileToPostgrest(arvore))
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}
