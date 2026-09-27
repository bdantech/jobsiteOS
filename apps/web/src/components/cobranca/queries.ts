import {
  COBRANCA_ESTAGIOS_ENCERRADOS,
  lerCobrancaConfig,
  type CobrancaConfig,
  type TabelaIndices,
  type Tables,
  type Views,
} from '@jobsiteos/core'
import { createClient } from '@/lib/supabase/client'

/**
 * Leituras das telas de cobranças (kanban, nova cobrança, detalhe). Mesma convenção do
 * Jurídico: React Query com o client do navegador, e a RLS do módulo `cobranca` decide
 * o que volta. Nenhuma escrita aqui — toda escrita é RPC, por `actions/cobranca.ts`.
 */
export const cobrancaKeys = {
  all: ['cobranca'] as const,
  cards: (encerradas: boolean) => [...cobrancaKeys.all, 'cards', encerradas] as const,
  cobranca: (id: string) => [...cobrancaKeys.all, 'cobranca', id] as const,
  titulos: (id: string) => [...cobrancaKeys.all, 'titulos', id] as const,
  notificacoes: (id: string) => [...cobrancaKeys.all, 'notificacoes', id] as const,
  acordos: (id: string) => [...cobrancaKeys.all, 'acordos', id] as const,
  protestos: (id: string) => [...cobrancaKeys.all, 'protestos', id] as const,
  interacoes: (id: string) => [...cobrancaKeys.all, 'interacoes', id] as const,
  eventos: (id: string) => [...cobrancaKeys.all, 'eventos', id] as const,
  sinistros: (id: string) => [...cobrancaKeys.all, 'sinistros', id] as const,
  bloqueio: (cnpj: string) => [...cobrancaKeys.all, 'bloqueio', cnpj] as const,
  config: () => [...cobrancaKeys.all, 'config'] as const,
  modelos: () => [...cobrancaKeys.all, 'modelos-ativos'] as const,
  usuarios: () => [...cobrancaKeys.all, 'usuarios'] as const,
  indices: (indice: string) => [...cobrancaKeys.all, 'indices', indice] as const,
  grupos: (termo: string) => [...cobrancaKeys.all, 'grupos', termo] as const,
  abertos: (matriz: string) => [...cobrancaKeys.all, 'abertos', matriz] as const,
  cadastro: (cnpjs: string) => [...cobrancaKeys.all, 'cadastro', cnpjs] as const,
  contatos: (empresaId: string) => [...cobrancaKeys.all, 'contatos', empresaId] as const,
  processos: (termo: string) => [...cobrancaKeys.all, 'processos', termo] as const,
  processo: (cnj: string) => [...cobrancaKeys.all, 'processo', cnj] as const,
}

export type CardCobranca = Views<'cobranca_cards'>
export type TituloAberto = Views<'cobranca_titulos_abertos'>

// ─── Kanban e cabeçalho ─────────────────────────────────────────────────────

/**
 * O kanban inteiro numa consulta. Sem as encerradas por padrão: a lista é a fila de
 * trabalho, e quitada, perdida e cancelada não pedem trabalho — só aparecem quando
 * alguém liga o filtro para procurar uma.
 */
export async function buscarCards(encerradas: boolean): Promise<CardCobranca[]> {
  const supabase = createClient()
  let q = supabase.from('cobranca_cards').select('*').order('criada_em', { ascending: false }).limit(1000)
  if (!encerradas) q = q.not('estagio', 'in', `(${COBRANCA_ESTAGIOS_ENCERRADOS.join(',')})`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as CardCobranca[]
}

export async function buscarCobranca(id: string): Promise<CardCobranca | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('cobranca_cards').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CardCobranca | null) ?? null
}

export async function buscarSacadoBloqueado(cnpj: string): Promise<boolean> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_cobranca_sacado_bloqueado', { p_cnpj: cnpj })
  if (error) throw new Error(error.message)
  return data === true
}

// ─── Títulos ────────────────────────────────────────────────────────────────

export type TituloDaCobranca = Tables<'cobranca_titulos'> & {
  titulos: Pick<
    Tables<'titulos'>,
    | 'numero'
    | 'externo_id'
    | 'nf_chave_acesso'
    | 'sacado_nome'
    | 'sacado_matriz_cnpj'
    | 'cedente_nome'
    | 'cedente_matriz_cnpj'
    | 'emissao'
    | 'status'
    | 'status_producao'
  > | null
}

export async function buscarTitulosDaCobranca(cobrancaId: string): Promise<TituloDaCobranca[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_titulos')
    .select(
      '*, titulos(numero, externo_id, nf_chave_acesso, sacado_nome, sacado_matriz_cnpj, cedente_nome, cedente_matriz_cnpj, emissao, status, status_producao)',
    )
    .eq('cobranca_id', cobrancaId)
    .order('vencimento_snapshot')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as TituloDaCobranca[]
}

/** Situações que ainda devem: é sobre elas que a dívida se atualiza e o acordo incide. */
export const SITUACOES_ATIVAS = ['em_cobranca', 'acordado', 'protestado', 'sinistrado'] as const

export function tituloAtivo(t: { situacao: string }): boolean {
  return (SITUACOES_ATIVAS as readonly string[]).includes(t.situacao)
}

export function numeroDoTitulo(t: TituloDaCobranca): string {
  return t.titulos?.numero ?? t.titulos?.externo_id ?? t.titulo_id.slice(0, 8)
}

// ─── Notificações e entregas ────────────────────────────────────────────────

export type NotificacaoDaCobranca = Tables<'cobranca_notificacoes'> & {
  cobranca_notificacao_titulos: { cobranca_titulo_id: string }[]
  cobranca_notificacao_entregas: Tables<'cobranca_notificacao_entregas'>[]
}

export async function buscarNotificacoes(cobrancaId: string): Promise<NotificacaoDaCobranca[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_notificacoes')
    .select('*, cobranca_notificacao_titulos(cobranca_titulo_id), cobranca_notificacao_entregas(*)')
    .eq('cobranca_id', cobrancaId)
    .order('rodada', { ascending: false })
    .order('papel')
    .order('destinatario_cnpj')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as NotificacaoDaCobranca[]
}

export type ContatoDestinatario = Pick<
  Tables<'contatos'>,
  'id' | 'nome' | 'cargo' | 'email' | 'telefone' | 'whatsapp' | 'ponto_focal'
>

/**
 * Os contatos da empresa notificada, na ordem do §4: ponto focal primeiro, depois quem
 * tem cargo de financeiro/jurídico/cobrança, depois o resto. A ordem é a sugestão; a
 * escolha continua de quem envia.
 */
export async function buscarContatosDestinatario(empresaId: string): Promise<ContatoDestinatario[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contatos')
    .select('id, nome, cargo, email, telefone, whatsapp, ponto_focal')
    .eq('empresa_id', empresaId)
    .order('nome')
  if (error) throw new Error(error.message)
  const peso = (c: ContatoDestinatario) =>
    c.ponto_focal ? 0 : /financ|jur[ií]d|cobran|contas a pagar|tesour|control/i.test(c.cargo ?? '') ? 1 : 2
  return [...(data ?? [])].sort((a, b) => peso(a) - peso(b))
}

// ─── Acordos, protesto, sinistro ────────────────────────────────────────────

export async function buscarAcordos(cobrancaId: string): Promise<Tables<'acordos'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('acordos')
    .select('*')
    .eq('cobranca_id', cobrancaId)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export type RemessaComTitulos = Tables<'protesto_remessas'> & { protesto_titulos: Tables<'protesto_titulos'>[] }

export async function buscarRemessas(cobrancaId: string): Promise<RemessaComTitulos[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('protesto_remessas')
    .select('*, protesto_titulos(*)')
    .eq('cobranca_id', cobrancaId)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as RemessaComTitulos[]
}

export async function buscarSinistrosDaCobranca(
  cobrancaId: string,
): Promise<Pick<Tables<'sinistros'>, 'id' | 'codigo' | 'estagio' | 'data_limite_envio'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('sinistros')
    .select('id, codigo, estagio, data_limite_envio')
    .eq('cobranca_id', cobrancaId)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Histórico ──────────────────────────────────────────────────────────────

export type InteracaoComAutor = Tables<'cobranca_interacoes'> & { usuarios: { nome: string } | null }

export async function buscarInteracoes(cobrancaId: string): Promise<InteracaoComAutor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_interacoes')
    .select('*, usuarios(nome)')
    .eq('cobranca_id', cobrancaId)
    .order('ocorrida_em', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as InteracaoComAutor[]
}

/**
 * Os eventos da cobrança na timeline das empresas envolvidas. O filtro é pelo
 * `cobranca_id` do payload — a mesma empresa tem eventos de outros módulos, e de outras
 * cobranças — e as empresas vão junto para a consulta usar o índice por empresa em vez
 * de varrer a tabela inteira de eventos.
 */
export async function buscarEventosDaCobranca(
  cobrancaId: string,
  empresaIds: readonly string[],
): Promise<Tables<'empresa_eventos'>[]> {
  const supabase = createClient()
  let q = supabase
    .from('empresa_eventos')
    .select('*')
    .eq('payload->>cobranca_id', cobrancaId)
    .order('criado_em', { ascending: false })
    .limit(300)
  if (empresaIds.length > 0) q = q.in('empresa_id', [...empresaIds])
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

// ─── Settings, modelos, pessoas, índices ────────────────────────────────────

export async function buscarConfigCobranca(): Promise<CobrancaConfig> {
  const supabase = createClient()
  const { data, error } = await supabase.from('cobranca_config').select('chave, valor')
  if (error) throw new Error(error.message)
  return lerCobrancaConfig(data ?? [])
}

export async function buscarModelosAtivos(): Promise<Pick<Tables<'cobranca_modelos'>, 'id' | 'tipo' | 'nome' | 'versao'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_modelos')
    .select('id, tipo, nome, versao')
    .eq('ativo', true)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function buscarUsuariosAtivos(): Promise<{ id: string; nome: string }[]> {
  const supabase = createClient()
  const { data, error } = await supabase.from('usuarios').select('id, nome').eq('ativo', true).order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * A tabela de UM índice. Mesma razão do Jurídico: um select de todos os índices faria
 * o motor corrigir a mesma competência pelo que viesse por último.
 */
export async function buscarTabelaIndices(indice: string): Promise<TabelaIndices> {
  if (indice === 'nenhum') return {}
  const supabase = createClient()
  const { data, error } = await supabase
    .from('juridico_indices')
    .select('competencia, valor')
    .eq('indice', indice)
    .limit(1200)
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((i) => [i.competencia, Number(i.valor)]))
}

// ─── Nova cobrança ──────────────────────────────────────────────────────────

export interface GrupoSacado {
  matriz: string
  nome: string | null
  cnpjs: string[]
  qtdAbertos: number
}

/** Tira do termo o que quebraria o `or()` do PostgREST (vírgula, parênteses). */
function termoSeguro(termo: string): string {
  return termo.replace(/[,()*%\\]/g, ' ').trim()
}

/**
 * O seletor do §1: busca por razão social ou CNPJ entre os sacados de títulos em
 * aberto, e resolve SEMPRE para a matriz. Escolher uma SPE seleciona o grupo inteiro —
 * é o `sacado_matriz_cnpj` que agrupa, não o CNPJ digitado.
 */
export async function buscarGruposSacado(termo: string): Promise<GrupoSacado[]> {
  const t = termoSeguro(termo)
  if (t.length < 3) return []
  const digitos = t.replace(/\D/g, '')
  const filtros = [`sacado_nome.ilike.%${t}%`]
  if (digitos.length >= 3) {
    filtros.push(`sacado_cnpj.like.%${digitos}%`, `sacado_matriz_cnpj.like.%${digitos}%`)
  }
  const supabase = createClient()
  const { data, error } = await supabase
    .from('titulos')
    .select('sacado_cnpj, sacado_nome, sacado_matriz_cnpj')
    .eq('status', 'aberto')
    .or(filtros.join(','))
    .limit(1000)
  if (error) throw new Error(error.message)

  const grupos = new Map<string, GrupoSacado>()
  for (const l of data ?? []) {
    const g = grupos.get(l.sacado_matriz_cnpj) ?? { matriz: l.sacado_matriz_cnpj, nome: null, cnpjs: [], qtdAbertos: 0 }
    g.qtdAbertos++
    if (!g.cnpjs.includes(l.sacado_cnpj)) g.cnpjs.push(l.sacado_cnpj)
    // O nome do grupo é o da matriz quando ela aparece; senão, o primeiro que vier.
    if (l.sacado_cnpj === l.sacado_matriz_cnpj || !g.nome) g.nome = l.sacado_nome ?? g.nome
    grupos.set(l.sacado_matriz_cnpj, g)
  }
  return [...grupos.values()].sort((a, b) => b.qtdAbertos - a.qtdAbertos).slice(0, 30)
}

export async function buscarTitulosAbertosDoGrupo(matriz: string): Promise<TituloAberto[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('cobranca_titulos_abertos')
    .select('*')
    .eq('sacado_matriz_cnpj', matriz)
    .order('vencimento')
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as TituloAberto[]
}

export type CadastroCnpj = {
  cnpj: string
  razao_social: string | null
  empresa_id: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
}

/** Razão social e endereço cadastral (Receita) de uma lista de CNPJs. */
export async function buscarCadastro(cnpjs: readonly string[]): Promise<Map<string, CadastroCnpj>> {
  if (cnpjs.length === 0) return new Map()
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_cobranca_cadastro', { p_cnpjs: [...cnpjs] })
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as CadastroCnpj[]).map((c) => [c.cnpj, c]))
}

// ─── Processo ───────────────────────────────────────────────────────────────

export interface ProcessoEncontrado {
  numero_cnj: string
  devedor_nome: string | null
  cnpj_devedor: string | null
  classe: string | null
  comarca: string | null
  uf: string | null
  valor_causa: number | null
}

type LinhaProcesso = Pick<
  Tables<'processos'>,
  'numero_cnj' | 'cnpj_devedor' | 'classe' | 'comarca' | 'uf' | 'valor_causa' | 'polo_nosso' | 'titulo_polo_ativo' | 'titulo_polo_passivo'
>

// O devedor é o polo OPOSTO ao nosso (0143): nós no ativo, ele no passivo — e o contrário
// nos embargos em que somos réus.
const paraEncontrado = (p: LinhaProcesso): ProcessoEncontrado => ({
  numero_cnj: p.numero_cnj,
  devedor_nome: p.polo_nosso === 'passivo' ? p.titulo_polo_ativo : p.titulo_polo_passivo,
  cnpj_devedor: p.cnpj_devedor,
  classe: p.classe,
  comarca: p.comarca,
  uf: p.uf,
  valor_causa: p.valor_causa,
})

/**
 * Busca no Jurídico por CNJ ou parte (§10). Lê `processos`, e não a carteira do
 * Jurídico: a tabela é visível com o módulo Empresas, que os perfis de cobrança têm
 * (0269i); a carteira só com o módulo Jurídico. A tela aceita também o CNJ digitado,
 * e a RPC de vínculo confere se ele existe.
 */
export async function buscarProcessos(termo: string): Promise<ProcessoEncontrado[]> {
  const t = termoSeguro(termo)
  if (t.length < 3) return []
  const digitos = t.replace(/\D/g, '')
  const filtros = [`titulo_polo_passivo.ilike.%${t}%`, `titulo_polo_ativo.ilike.%${t}%`, `numero_cnj.ilike.%${t}%`]
  if (digitos.length >= 3) filtros.push(`cnpj_devedor.like.%${digitos}%`)
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processos')
    .select('numero_cnj, cnpj_devedor, classe, comarca, uf, valor_causa, polo_nosso, titulo_polo_ativo, titulo_polo_passivo')
    .or(filtros.join(','))
    .limit(20)
  if (error) return []
  return (data ?? []).map(paraEncontrado)
}

export async function buscarProcessoVinculado(cnj: string): Promise<ProcessoEncontrado | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('processos')
    .select('numero_cnj, cnpj_devedor, classe, comarca, uf, valor_causa, polo_nosso, titulo_polo_ativo, titulo_polo_passivo')
    .eq('numero_cnj', cnj)
    .maybeSingle()
  if (error || !data) return null
  return paraEncontrado(data)
}

// ─── Arquivos do bucket ─────────────────────────────────────────────────────

export const BUCKET_COBRANCAS = 'cobrancas'

/**
 * Sobe um arquivo para a pasta da cobrança e devolve o caminho. `upsert: false` porque
 * o bucket não tem política de UPDATE: o que entra no dossiê não se sobrescreve, e um
 * nome com carimbo de tempo evita a colisão.
 */
export async function subirArquivoCobranca(pasta: string, arquivo: File, prefixo?: string): Promise<string> {
  const supabase = createClient()
  const limpo = arquivo.name.replace(/[^\w.\-]/g, '_')
  const caminho = `${pasta}/${prefixo ? `${prefixo}-` : ''}${Date.now()}-${limpo}`
  // O Windows anuncia CSV como `application/vnd.ms-excel`, que o bucket não aceita; o
  // retorno do CRA é texto, e é assim que ele sobe.
  const contentType = /\.csv$/i.test(arquivo.name) ? 'text/csv' : arquivo.type || undefined
  const { error } = await supabase.storage
    .from(BUCKET_COBRANCAS)
    .upload(caminho, arquivo, { upsert: false, contentType })
  if (error) throw new Error(`Falha ao subir "${arquivo.name}": ${error.message}`)
  return caminho
}

/** Assinado no clique e com validade curta, como no resto da casa. */
export async function abrirArquivoCobranca(caminho: string): Promise<void> {
  const supabase = createClient()
  const { data, error } = await supabase.storage.from(BUCKET_COBRANCAS).createSignedUrl(caminho, 300)
  if (error || !data) throw new Error('Não foi possível abrir o arquivo.')
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
}
