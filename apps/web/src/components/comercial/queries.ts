'use client'

import { createClient } from '@/lib/supabase/client'
import type { Tables } from '@jobsiteos/core'

/**
 * Leituras do Comercial. Todas passam pela RLS do módulo; a de comissão é a única
 * restrita por pessoa, e essa restrição vive no banco — repeti-la aqui criaria uma
 * segunda regra para divergir da primeira.
 */

export const comercialKeys = {
  resumo: (vendedorId?: string | null) => ['comercial', 'resumo', vendedorId ?? 'eu'] as const,
  vendedores: () => ['comercial', 'vendedores'] as const,
  leads: (sdrId?: string | null) => ['comercial', 'leads', sdrId ?? 'todos'] as const,
  vendas: (vendedorId?: string | null) => ['comercial', 'vendas', vendedorId ?? 'todos'] as const,
  fila: () => ['comercial', 'fila'] as const,
  comissoes: (competencia: string) => ['comercial', 'comissoes', competencia] as const,
  agenda: (vendedorId?: string | null, janela?: string) =>
    ['comercial', 'agenda', vendedorId ?? 'eu', janela ?? 'padrao'] as const,
  motivos: (contexto: string) => ['comercial', 'motivos', contexto] as const,
  territorios: () => ['comercial', 'territorios'] as const,
  config: () => ['comercial', 'config'] as const,
  carteira: (vendedorId?: string | null) => ['comercial', 'carteira', vendedorId ?? 'eu'] as const,
  visiveis: () => ['comercial', 'visiveis'] as const,
  /*
   * CHAVE PRÓPRIA, e não a `visiveis()`. As duas listas respondem perguntas diferentes
   * ("quem eu abro" e "de quem eu vejo a folha", 0210) e a segunda é mais curta. Sob a
   * mesma chave, o React Query serve a primeira que chegou: quem entrasse em Comissões
   * vindo de um funil veria a lista do TRABALHO no seletor da folha — e escolheria um
   * nome cujo extrato a RLS devolve vazio.
   */
  visiveisComissao: () => ['comercial', 'visiveis-comissao'] as const,
  pitch: (leadId: string) => ['comercial', 'pitch', leadId] as const,
  submissoes: (empresaId: string) => ['comercial', 'submissoes', empresaId] as const,
  reuniao: (alvo: string) => ['comercial', 'reuniao', alvo] as const,
}

/**
 * O pitch de um lead. `pontos` e `jargoes` são `jsonb` — o gerador os tipa como
 * `Json`, e quem lê tem de estreitar para lista de string na tela.
 */
export type PitchDoLeadRow = Tables<'sdr_lead_pitches'>

export interface ResumoComercial {
  tem_acesso: boolean
  sem_vendedor?: boolean
  vendedor?: { id: string; nome: string; tipo: string; is_ia: boolean }
  leads_por_estagio: Record<string, number>
  vendas_por_estagio: Record<string, number>
  nfs_vivas: number
  passivas_geridas: number
  proximas_reunioes: { id: string; titulo: string; inicio_em: string; empresa_id: string | null }[]
  /**
   * `null` quando quem pede não pode ver a FOLHA desta pessoa (0215) — o auxiliar
   * abrindo o painel do closer, por exemplo. Nulo, e não zero: zero afirmaria que a
   * comissão dele é zero, que é falso. O trabalho dele continua todo aqui.
   */
  comissao_mes: { competencia: string; total: number; por_status: Record<string, number> } | null
}

export async function buscarResumo(vendedorId?: string | null): Promise<ResumoComercial> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_resumo_vendedor', {
    p_vendedor_id: vendedorId ?? undefined,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<ResumoComercial>
  return {
    tem_acesso: r.tem_acesso ?? false,
    sem_vendedor: r.sem_vendedor,
    vendedor: r.vendedor,
    leads_por_estagio: r.leads_por_estagio ?? {},
    vendas_por_estagio: r.vendas_por_estagio ?? {},
    nfs_vivas: r.nfs_vivas ?? 0,
    passivas_geridas: r.passivas_geridas ?? 0,
    proximas_reunioes: r.proximas_reunioes ?? [],
    comissao_mes: r.comissao_mes ?? null,
  }
}

/** Um vendedor cujo painel o usuário logado pode abrir de fato — a mesma régua da RLS. */
export interface VendedorVisivel {
  id: string
  nome: string
  tipo: string
  is_ia: boolean
  /**
   * Este sou eu. É o que separa "há outro funil ao alcance" de "a lista tem um item",
   * e é a diferença entre um filtro útil e um seletor de uma opção só: um originador
   * sozinho enxerga a si mesmo e não tem escolha a fazer; um closer que enxerga UM
   * originador tem duas respostas possíveis (tudo, ou só o dele).
   */
  sou_eu: boolean
}

/** Há alguém ALÉM de mim nesta lista? É o que decide se o seletor de vendedor existe. */
export function haOutroAoAlcance(lista: readonly VendedorVisivel[] | undefined): boolean {
  return (lista ?? []).some((v) => !v.sou_eu)
}

/**
 * O seletor "ver painel de…" se monta com ISTO, não com a lista de vendedores.
 *
 * A lista completa é legível para quem tem o módulo — um cadastro de pessoas não é
 * segredo. Já ABRIR o painel do outro depende de `vendedor_acessos`, e oferecer no
 * seletor um nome cujo funil volta vazio ensina que a tela está quebrada.
 */
export async function buscarVendedoresVisiveis(): Promise<VendedorVisivel[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_vendedores_visiveis')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VendedorVisivel[]
}

/**
 * Os vendedores cuja FOLHA quem está logado pode abrir — régua mais curta que a do
 * trabalho (0210).
 *
 * O auxiliar enxerga o funil do closer e os acessos cruzados dele, porque é com isso
 * que ele trabalha. Remuneração de terceiro não entra nessa conta, e por isso a tela de
 * comissões pergunta por aqui e não por `buscarVendedoresVisiveis`.
 */
export async function buscarVendedoresDaComissao(): Promise<VendedorVisivel[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_vendedores_da_comissao')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VendedorVisivel[]
}

export async function buscarVendedores(): Promise<Tables<'vendedores'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vendedores')
    .select('*')
    .order('ativo', { ascending: false })
    .order('nome')
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Um lead com a ficha da empresa.
 *
 * Os quatro campos de baixo (tipo, origem do faturamento e o par de score) entraram
 * para a <FichaDoCard> poder ser desenhada no card do Funil de Reuniões, como já é
 * no de Vendas. Sem eles a tira renderiza travessão em tudo — e um card que mostra
 * "—" em quatro lugares é pior do que um card que não mostra nada.
 */
export interface LeadComEmpresa extends Tables<'sdr_leads'> {
  empresas: {
    id: string
    razao_social: string | null
    uf: string | null
    valor_esperado_mensal: number | null
    faturamento_anual: number | null
    tipo: string | null
    faturamento_origem: string | null
    score_credito: number | null
    score_faixa: string | null
  } | null
}

export async function buscarLeads(sdrId?: string | null): Promise<LeadComEmpresa[]> {
  const supabase = createClient()
  let q = supabase
    .from('sdr_leads')
    // Literal ÚNICO, sem concatenação: um select montado com `+` vira
    // GenericStringError e o erro aparece nas linhas de uso, não aqui.
    .select(
      '*, empresas(id, razao_social, uf, valor_esperado_mensal, faturamento_anual, tipo, faturamento_origem, score_credito, score_faixa)',
    )
    // Melhor empresa primeiro dentro do funil: a ordem da lista é a ordem de trabalho.
    .order('distribuido_em', { ascending: false })
    .limit(500)
  if (sdrId) q = q.eq('sdr_id', sdrId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LeadComEmpresa[]
}

export interface VendaComEmpresa extends Tables<'vendas'> {
  empresas: {
    id: string
    razao_social: string | null
    uf: string | null
    /** construtora / incorporadora / fornecedor / subempreiteiro. */
    tipo: string | null
    faturamento_anual: number | null
    /** `declarado_cliente` é o único que não é estimativa — a tela precisa distinguir. */
    faturamento_origem: string | null
    score_credito: number | null
    score_faixa: string | null
    origem: string | null
  } | null
  /** De onde o negócio veio. `inbound` é quem chegou sozinho pelo formulário. */
  sdr_leads: { origem: string | null } | null
  /** `null` quando não há análise ligada — ou quando a RLS não deixa esta pessoa ver. */
  analises_credito: {
    id: string
    estagio: string
    limite_solicitado: number | null
    limite_aprovado: number | null
    moeda: string | null
    motivo: string | null
    decidida_em: string | null
  } | null
}

export async function buscarVendas(vendedorId?: string | null): Promise<VendaComEmpresa[]> {
  const supabase = createClient()
  let q = supabase
    .from('vendas')
    /*
     * A análise vem junto, e não numa consulta por card: o funil mostra dezenas de
     * negócios e a etapa do crédito é informação de card, não de detalhe. Buscar por
     * card faria N requisições ao abrir a tela.
     *
     * A RLS decide o que volta: quem não é dono do negócio recebe `null` aqui, sem erro.
     */
    /*
     * O `select` é UM literal, e não uma soma de pedaços: o supabase-js tipa a string em
     * tempo de compilação, e uma concatenação vira `GenericStringError` — com o erro
     * aparecendo nas linhas de USO, longe daqui.
     */
    .select(
      '*, empresas(id, razao_social, uf, tipo, faturamento_anual, faturamento_origem, score_credito, score_faixa, origem), sdr_leads(origem), analises_credito(id, estagio, limite_solicitado, limite_aprovado, moeda, motivo, decidida_em)',
    )
    .order('atualizada_em', { ascending: false })
    .limit(500)
  if (vendedorId) q = q.eq('vendedor_id', vendedorId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as VendaComEmpresa[]
}

/**
 * O limite Onepay da empresa, do temperature report (sync diário).
 *
 * Tudo `null` quando a empresa não é cliente Onepay — a carteira também tem prospect
 * e ex-cliente, e para eles não existe limite algum. `null` aqui é "não há", não
 * "zero": a tela precisa distinguir uma conta sem cadastro de uma no talo.
 *
 * O limite é do CNPJ da empresa, e não do grupo econômico, ao contrário de
 * `volume_mes` e `nfs_vivas`. O cadastro de crédito da Onepay é da holding.
 */
export interface LimiteOnepay {
  credit_limit: number | null
  /** Quanto ainda dá para antecipar. É o número que decide a ligação. */
  available_limit: number | null
  /** Fração de 0 a 1, não porcentagem — 0.9396 é 94%. */
  consumed_pct: number | null
  /** Veredito da Onepay, cru: `operating_normally`, `inoperative`… */
  operation_status: string | null
  /** Quando o sync trouxe estes números. O limite é de ontem até o cron rodar. */
  limite_em: string | null
}

export interface PassivaNaCarteira extends LimiteOnepay {
  id: string
  cnpj: string
  razao_social: string | null
  uf: string | null
  faturamento_anual: number | null
  desde: string
  gestao_operacao: string | null
  /** SPEs no grupo econômico da holding — o tamanho do que ela arrasta. */
  spes: number
  /** Volume antecipado no mês corrente, da holding E das SPEs. Vira comissão. */
  volume_mes: number
  /** Quantas dessas operações vieram por uma SPE, não pelo CNPJ da holding. */
  operacoes_via_spe: number
}

export interface EmpresaDeOriginacao extends LimiteOnepay {
  id: string
  cnpj: string
  razao_social: string | null
  uf: string | null
  estagio: string
  gestao_operacao: string | null
  spes: number
  nfs_vivas: number
}

export interface CarteiraVendedorDados {
  tem_acesso: boolean
  sem_vendedor?: boolean
  vendedor_id?: string
  tipo?: string
  competencia?: string
  passivas: PassivaNaCarteira[]
  originacao: EmpresaDeOriginacao[]
}

export async function buscarCarteira(vendedorId?: string | null): Promise<CarteiraVendedorDados> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_carteira_vendedor', {
    p_vendedor_id: vendedorId ?? undefined,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Partial<CarteiraVendedorDados>
  return {
    tem_acesso: r.tem_acesso ?? false,
    sem_vendedor: r.sem_vendedor,
    vendedor_id: r.vendedor_id,
    tipo: r.tipo,
    competencia: r.competencia,
    passivas: r.passivas ?? [],
    originacao: r.originacao ?? [],
  }
}

/**
 * Quantas NFs vivas a carteira de um originador alcança AGORA.
 *
 * Responde "meu link pegou?" na hora, sem esperar o roteamento. É diferente de "quantas
 * mudaram de dono", que só se sabe depois do job — e é a pergunta que a pessoa
 * realmente faz ao salvar.
 */
export async function buscarAlcanceCarteira(
  vendedorId: string,
): Promise<{ nfs_vivas: number; via_spe: number }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('comercial_alcance_da_carteira', {
    p_vendedor_id: vendedorId,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { nfs_vivas?: number; via_spe?: number }
  return { nfs_vivas: r.nfs_vivas ?? 0, via_spe: r.via_spe ?? 0 }
}

export async function buscarMotivos(contexto: string): Promise<Tables<'motivos_perda'>[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('motivos_perda')
    .select('*')
    .eq('contexto', contexto)
    .eq('ativo', true)
    .order('ordem')
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface TerritorioCloser {
  ufs: readonly string[]
  faturamento_min: number | null
  faturamento_max: number | null
}

/**
 * Territórios por vendedor, indexados por id. Um mapa, e não uma lista, porque o único
 * uso é "qual o território deste closer" — e um `find` por card de reunião seria uma
 * varredura por linha da tela.
 */
export async function buscarTerritoriosCloser(): Promise<Record<string, TerritorioCloser>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vendedor_territorios')
    .select('vendedor_id, ufs, faturamento_min, faturamento_max')
  if (error) throw new Error(error.message)
  return Object.fromEntries(
    (data ?? []).map((t) => [
      t.vendedor_id,
      {
        ufs: (t.ufs ?? []) as string[],
        faturamento_min: t.faturamento_min === null ? null : Number(t.faturamento_min),
        faturamento_max: t.faturamento_max === null ? null : Number(t.faturamento_max),
      },
    ]),
  )
}

export interface NfSemDono {
  access_key: string
  numero: string | null
  valor: number
  sacado_nome: string | null
  fornecedor_nome: string | null
  estagio_funil: string
  receita_esperada: number | null
  dias_para_vencimento: number | null
}

export async function buscarFilaSemDono(): Promise<NfSemDono[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('access_key, numero, valor, sacado_nome, fornecedor_nome, estagio_funil, receita_esperada, dias_para_vencimento')
    .is('vendedor_id', null)
    .not('estagio_funil', 'in', '("convertida","perdida")')
    // Maior receita esperada primeiro: a fila do gestor é uma fila de decisão, e a
    // decisão que mais paga é a que não pode esperar.
    .order('receita_esperada', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []) as NfSemDono[]
}

export interface LancamentoComVendedor extends Tables<'comissao_lancamentos'> {
  vendedores: { id: string; nome: string; tipo: string } | null
}

export async function buscarComissoes(competencia: string): Promise<LancamentoComVendedor[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('comissao_lancamentos')
    .select('*, vendedores(id, nome, tipo)')
    .eq('competencia', competencia)
    .order('valor', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LancamentoComVendedor[]
}

export interface EventoAgenda extends Tables<'vendedor_eventos'> {
  empresas: { id: string; razao_social: string | null } | null
}

/**
 * `desde` existe por causa da vista de MÊS: a lista só precisa de "da semana
 * passada em diante", mas quem navega para março quer ver março. Sem o parâmetro,
 * voltar um mês mostrava um calendário vazio que parecia quebrado.
 */
export async function buscarAgenda(
  vendedorId?: string | null,
  janela?: { desde: string; ate: string },
): Promise<EventoAgenda[]> {
  const supabase = createClient()
  let q = supabase
    .from('vendedor_eventos')
    .select('*, empresas(id, razao_social)')
    .is('cancelado_em', null)
    .gte('inicio_em', janela?.desde ?? new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('inicio_em')
    .limit(300)
  if (janela) q = q.lte('inicio_em', janela.ate)
  /*
   * "Minha agenda" é o que eu ORGANIZO mais o que eu ACOMPANHO (0201).
   *
   * Desde que a reunião virou uma linha só, o SDR não é dono de nenhuma — ele
   * entra em `acompanhantes`. Filtrar só por `vendedor_id` deixaria a agenda do
   * SDR vazia, que é como se troca uma linha duplicada por uma linha invisível.
   */
  if (vendedorId) q = q.or(`vendedor_id.eq.${vendedorId},acompanhantes.cs.{${vendedorId}}`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as EventoAgenda[]
}

// ─── O que o lead preencheu no formulário ───────────────────────────────────

export interface RespostaFormulario {
  chave: string
  label: string
  valor: string
}

export interface SubmissaoDoLead {
  id: string
  formulario: string | null
  intencao: string | null
  criada_em: string
  /** utm_source/medium/campaign, quando a campanha carimbou. */
  campanha: { rotulo: string; valor: string }[]
  pagina_url: string | null
  respostas: RespostaFormulario[]
}

interface CampoSnapshot {
  key?: string
  label?: string
  ordem?: number
}

/**
 * O que a PESSOA escreveu, com os rótulos que ela viu.
 *
 * `campos_snapshot` é a cópia do formulário no instante do envio, e é ela que dá a ordem
 * e o texto de cada pergunta. Ler os rótulos do formulário de HOJE mostraria a pergunta
 * errada para uma resposta antiga — o formulário é editável, a submissão não.
 *
 * Campo respondido que não está no snapshot ainda aparece, com a chave crua como rótulo:
 * sumir com uma resposta porque o formulário mudou seria perder o que o lead disse.
 */
export async function buscarSubmissoesDaEmpresa(empresaId: string): Promise<SubmissaoDoLead[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('formulario_submissoes')
    .select(
      'id, dados, campos_snapshot, intencao, criada_em, pagina_url, utm_source, utm_medium, utm_campaign, formularios(nome)',
    )
    .eq('empresa_id', empresaId)
    .order('criada_em', { ascending: false })
    .limit(10)
  if (error) throw new Error(error.message)

  return (data ?? []).map((s) => {
    const dados = (s.dados ?? {}) as Record<string, unknown>
    const campos = (Array.isArray(s.campos_snapshot) ? s.campos_snapshot : []) as CampoSnapshot[]
    const rotulos = new Map(campos.map((c) => [c.key ?? '', c.label ?? c.key ?? '']))
    const ordem = new Map(campos.map((c, i) => [c.key ?? '', c.ordem ?? i]))

    const respostas = Object.entries(dados)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([chave, v]) => ({ chave, label: rotulos.get(chave) ?? chave, valor: String(v) }))
      .sort((a, b) => (ordem.get(a.chave) ?? 999) - (ordem.get(b.chave) ?? 999))

    const campanha = (
      [
        ['Origem', s.utm_source],
        ['Meio', s.utm_medium],
        ['Campanha', s.utm_campaign],
      ] as const
    )
      .filter(([, v]) => Boolean(v))
      .map(([rotulo, valor]) => ({ rotulo, valor: String(valor) }))

    return {
      id: s.id,
      formulario: (s.formularios as { nome: string | null } | null)?.nome ?? null,
      intencao: s.intencao,
      criada_em: s.criada_em,
      campanha,
      pagina_url: s.pagina_url,
      respostas,
    }
  })
}

// ─── A reunião do card ──────────────────────────────────────────────────────

export interface ParticipanteDaReuniao {
  contato_id: string | null
  nome: string | null
  email: string
}

export interface PessoaDaCasa {
  vendedor_id: string
  nome: string
}

/** O estado da escrita no Google, que é metade do que a aba precisa dizer. */
export interface EstadoGoogle {
  evento_id: string | null
  pendente: boolean
  sincronizado_em: string | null
  erro: string | null
  /** O endereço da conta conectada do anfitrião, ou nulo se ele não conectou. */
  conta: string | null
  tem_escopo_agenda: boolean
}

export interface ReuniaoDoCard {
  id: string
  titulo: string
  inicio_em: string
  duracao_min: number
  modalidade: string
  local: string | null
  meet_url: string | null
  descricao: string | null
  venda_id: string | null
  sdr_lead_id: string | null
  participantes: ParticipanteDaReuniao[]
  anfitriao: PessoaDaCasa
  acompanhantes: PessoaDaCasa[]
  google: EstadoGoogle
}

/**
 * A reunião viva de um card, pelos dois lados do funil.
 *
 * Uma RPC e não um `select` direto porque o que a aba mostra atravessa quatro
 * tabelas (evento, vendedores, gmail_contas) e porque a decisão de "qual é a
 * reunião deste card" — a viva, a mais recente — tem de ser a mesma nos dois
 * funis. Duas telas montando essa consulta cada uma do seu jeito é como elas
 * passam a discordar sobre qual reunião está marcada.
 */
export async function buscarReuniaoDoCard(alvo: {
  vendaId?: string | null
  sdrLeadId?: string | null
}): Promise<ReuniaoDoCard | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('app_reuniao_do_card', {
    p: { venda_id: alvo.vendaId ?? null, sdr_lead_id: alvo.sdrLeadId ?? null } as never,
  })
  if (error) throw new Error(error.message)
  return (data as unknown as ReuniaoDoCard | null) ?? null
}
