import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { PESO_CONFIANCA, type Confianca } from '../../../../../packages/core/src/fornecedores/schemas.js'
import type { CamadaDescoberta, StatusDescoberta } from '../../../../../packages/core/src/fornecedores/schemas.js'
import type { ProvedorCascata } from '../../../../../packages/core/src/fornecedores/cascata.js'
import { DDD_POR_UF } from '../../../../../packages/core/src/fornecedores/telefone.js'
import {
  motivoDescarteDominio,
  normalizarDominio,
} from '../../../../../packages/core/src/radar/dominio.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * A plumbing compartilhada da cascata: gravar o que se achou, registrar o que se
 * gastou, e manter o resumo do card em dia.
 *
 * Está separada dos provedores porque a REGRA de gravação é a mesma para os oito, e
 * ela tem duas sutilezas que uma cópia por provedor perderia: a frequência acumula
 * em vez de sobrescrever, e a confiança sobe mas nunca desce sozinha.
 */

export interface ContatoParaGravar {
  tipo: string
  valor: string
  original?: string | null
  nome_pessoa?: string | null
  cargo?: string | null
  confianca: Confianca
  evidencia?: string | null
  frequencia?: number
  ultima_vez_visto?: string | null
}

/**
 * Grava os contatos de um provedor e devolve quantos eram NOVOS.
 *
 * ─── POR QUE SQL CRU, E NÃO O UPSERT DO POSTGREST ────────────────────────────
 *
 * A resolução de conflito precisa de EXPRESSÕES sobre a linha existente:
 * `frequencia = greatest(atual, nova)` e `confianca = a maior das duas`. O upsert do
 * PostgREST só sabe substituir a coluna pelo valor enviado — e substituir a
 * frequência por 1 a cada rodada apagaria justamente o sinal que o XML da NF-e
 * existe para dar: um telefone visto em 40 notas viraria um telefone visto uma vez.
 *
 * ─── POR QUE A CONFIANÇA NUNCA CAI AQUI ──────────────────────────────────────
 *
 * O mesmo telefone pode chegar por duas fontes: alta pelo `emit` da NF-e, baixa pelo
 * Claude. Deixar a segunda rebaixar a primeira faria a ordem do card depender da
 * ordem em que os provedores rodaram. Rebaixar é trabalho da VALIDAÇÃO (§4.4), que
 * testa o canal em vez de opinar sobre a origem.
 */
export async function gravarContatos(
  cnpj: string,
  contatos: readonly ContatoParaGravar[],
  fonte: string,
): Promise<{ novos: number; total: number }> {
  if (contatos.length === 0) return { novos: 0, total: 0 }

  const sql = `
    insert into public.contatos_descobertos
      (fornecedor_cnpj, tipo, valor, valor_original, nome_pessoa, cargo, fonte, confianca,
       evidencia, frequencia, ultima_vez_visto)
    select
      $1, x.tipo, x.valor, x.valor_original, x.nome_pessoa, x.cargo, $2, x.confianca,
      x.evidencia, x.frequencia, x.ultima_vez_visto
    from jsonb_to_recordset($3::jsonb) as x(
      tipo text, valor text, valor_original text, nome_pessoa text, cargo text,
      confianca text, evidencia text, frequencia int, ultima_vez_visto date
    )
    on conflict (fornecedor_cnpj, tipo, valor) do update set
      frequencia = greatest(public.contatos_descobertos.frequencia, excluded.frequencia),
      ultima_vez_visto = greatest(public.contatos_descobertos.ultima_vez_visto, excluded.ultima_vez_visto),
      confianca = case
        when public.contatos_descobertos.confianca = 'alta' or excluded.confianca = 'alta' then 'alta'
        when public.contatos_descobertos.confianca = 'media' or excluded.confianca = 'media' then 'media'
        else 'baixa' end,
      -- A evidência acompanha a confiança: mostrar "achado pelo Claude" ao lado de
      -- uma confiança que veio do campo estruturado da NF-e seria descrever a linha
      -- errada.
      evidencia = case
        when excluded.confianca = 'alta' and public.contatos_descobertos.confianca <> 'alta'
        then excluded.evidencia else public.contatos_descobertos.evidencia end,
      nome_pessoa = coalesce(public.contatos_descobertos.nome_pessoa, excluded.nome_pessoa),
      cargo = coalesce(public.contatos_descobertos.cargo, excluded.cargo),
      atualizado_em = now()
    returning (xmax = 0) as inserido`

  const payload = contatos.map((c) => ({
    tipo: c.tipo,
    valor: c.valor,
    valor_original: c.original ?? null,
    nome_pessoa: c.nome_pessoa ?? null,
    cargo: c.cargo ?? null,
    confianca: c.confianca,
    evidencia: c.evidencia ?? null,
    frequencia: c.frequencia ?? 1,
    ultima_vez_visto: c.ultima_vez_visto ?? null,
  }))

  // `xmax = 0` é o truque canônico do Postgres para distinguir INSERT de UPDATE num
  // upsert: numa linha recém-inserida o xmax é zero.
  const res = await pool.query<{ inserido: boolean }>(sql, [cnpj, fonte, JSON.stringify(payload)])
  const novos = res.rows.filter((r) => r.inserido).length
  return { novos, total: res.rows.length }
}

export interface ExecucaoDescoberta {
  cnpj: string
  camada: CamadaDescoberta
  provedor: ProvedorCascata
  status: StatusDescoberta
  motivo?: string | null
  custo?: number
  contatosNovos?: number
  originadorId?: string | null
  solicitadoPor?: string | null
}

/**
 * Registra a tentativa — inclusive as que não custaram e as que não acharam nada.
 *
 * O `pulado` é o registro mais importante do conjunto e o mais fácil de esquecer:
 * ele é a única prova de que o Apollo NÃO foi chamado para 576 PMEs sem domínio. Sem
 * ele, a leitura de "o Apollo tem 4% de acerto" é indistinguível de "o Apollo é
 * ruim" — quando a verdade pode ser que ele quase nunca foi tentado.
 */
export async function registrarExecucao(e: ExecucaoDescoberta): Promise<void> {
  const { error } = await supabaseAdmin.from('descoberta_execucoes').insert({
    fornecedor_cnpj: e.cnpj,
    camada: e.camada,
    provedor: e.provedor,
    status: e.status,
    motivo: e.motivo ?? null,
    custo: e.custo ?? 0,
    contatos_novos: e.contatosNovos ?? 0,
    originador_id: e.originadorId ?? null,
    solicitado_por: e.solicitadoPor ?? null,
  })
  if (error) logger.error({ cnpj: e.cnpj, provedor: e.provedor, erro: error.message }, 'Falha ao registrar execução de descoberta.')
}

/**
 * Recalcula o resumo do card (contagem e melhor confiança) e move o estágio quando a
 * cascata termina sem nada.
 *
 * `sem_contato` NÃO é julgamento do lead — é insumo de produto. Um fornecedor de R$
 * 900 mil/mês que a cascata inteira não alcançou é a evidência mais cara que temos
 * de que falta um provedor, e ele precisa estar numa coluna própria para que alguém
 * conte quantos são.
 */
export async function atualizarResumo(
  cnpj: string,
  opcoes: { camada?: CamadaDescoberta; marcarSemContato?: boolean } = {},
): Promise<{ contatos: number; melhor: Confianca | null }> {
  const { data } = await supabaseAdmin
    .from('contatos_descobertos')
    .select('confianca')
    .eq('fornecedor_cnpj', cnpj)

  const linhas = data ?? []
  const melhor =
    linhas.length === 0
      ? null
      : (linhas
          .map((l) => l.confianca as Confianca)
          .sort((a, b) => PESO_CONFIANCA[b] - PESO_CONFIANCA[a])[0] as Confianca)

  const agora = new Date().toISOString()
  const campos: Record<string, unknown> = {
    contatos_encontrados: linhas.length,
    melhor_confianca: melhor,
  }
  if (opcoes.camada === 'automatica') campos.descoberta_automatica_em = agora
  if (opcoes.camada === 'sob_demanda') campos.ultima_busca_em = agora

  const { data: atual } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('estagio')
    .eq('fornecedor_cnpj', cnpj)
    .maybeSingle()

  if (opcoes.marcarSemContato && linhas.length === 0 && atual?.estagio === 'a_cadastrar') {
    campos.estagio = 'sem_contato'
    campos.estagio_alterado_em = agora
  }
  // Achou depois de ter sido marcado como sem contato: volta para a fila. O estágio
  // descreve o que sabemos, e agora sabemos outra coisa.
  if (linhas.length > 0 && atual?.estagio === 'sem_contato') {
    campos.estagio = 'a_cadastrar'
    campos.estagio_alterado_em = agora
  }

  await supabaseAdmin.from('fornecedores_funil').update(campos).eq('fornecedor_cnpj', cnpj)

  if (opcoes.marcarSemContato && linhas.length === 0) {
    await emitirEvento(null, EVENTO_TIPOS.FORNECEDOR_SEM_CONTATO, {
      titulo: 'Fornecedor sem contato',
      resumo: `A cascata inteira rodou para ${cnpj} e não achou por onde falar.`,
      url: '/comercial/fornecedores',
      cnpj,
    })
  }

  return { contatos: linhas.length, melhor }
}

export interface CadastralFornecedor {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  porte_rfb: string | null
  municipio: string | null
  uf: string | null
  logradouro: string | null
  numero: string | null
  email_rfb: string | null
  telefone1_rfb: string | null
  telefone2_rfb: string | null
  dominio: string | null
  funcionarios: number | null
  faturamento_estimado: number | null
  ddd: string | null
}

/**
 * O cadastral, com o DDD já resolvido.
 *
 * O DDD importa mais do que parece: rodapé de site e `infCpl` trazem o número sem
 * ele, porque quem escreveu sabia de cor. Sem um DDD de referência esses achados
 * morrem em "sem_ddd" — e é justamente a faixa de PME onde há menos alternativa.
 */
export async function cadastralDoFornecedor(cnpj: string): Promise<CadastralFornecedor> {
  const { data: mu } = await supabaseAdmin
    .from('mercado_universo')
    .select('razao_social, nome_fantasia, porte_rfb, municipio, uf, logradouro, numero, email_rfb, telefone1_rfb, telefone2_rfb, dominio, empresa_id')
    .eq('cnpj', cnpj)
    .maybeSingle()

  let funcionarios: number | null = null
  let faturamento: number | null = null
  let dominioEmpresa: string | null = null
  if (mu?.empresa_id) {
    const { data: emp } = await supabaseAdmin
      .from('empresas')
      .select('funcionarios, faturamento_anual, dominio')
      .eq('id', mu.empresa_id)
      .maybeSingle()
    funcionarios = emp?.funcionarios ?? null
    faturamento = emp?.faturamento_anual ? Number(emp.faturamento_anual) : null
    // O domínio da ficha ganha do universo: é lá que mora a correção manual, e a
    // cascata do Radar (0026) não a sobrescreve de propósito.
    dominioEmpresa = emp?.dominio ?? null
  }

  // O DDD do telefone declarado ganha do da UF: ele é o número real da empresa, e a
  // capital do estado é só o palpite de quem não tem outro.
  const declarado = (mu?.telefone1_rfb ?? mu?.telefone2_rfb ?? '').replace(/\D/g, '')
  const dddDeclarado = declarado.length >= 10 ? declarado.slice(0, 2) : null

  return {
    cnpj,
    razao_social: mu?.razao_social ?? null,
    nome_fantasia: mu?.nome_fantasia ?? null,
    porte_rfb: mu?.porte_rfb ?? null,
    municipio: mu?.municipio ?? null,
    uf: mu?.uf ?? null,
    logradouro: mu?.logradouro ?? null,
    numero: mu?.numero ?? null,
    email_rfb: mu?.email_rfb ?? null,
    telefone1_rfb: mu?.telefone1_rfb ?? null,
    telefone2_rfb: mu?.telefone2_rfb ?? null,
    dominio: dominioEmpresa ?? mu?.dominio ?? null,
    funcionarios,
    faturamento_estimado: faturamento,
    ddd: dddDeclarado ?? (mu?.uf ? (DDD_POR_UF[mu.uf] ?? null) : null),
  }
}

/** Já rodou este provedor para este CNPJ dentro do TTL? (não paga duas vezes pela mesma resposta) */
export async function dentroDoTtl(cnpj: string, provedor: ProvedorCascata, dias: number): Promise<boolean> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const { count } = await supabaseAdmin
    .from('descoberta_execucoes')
    .select('id', { count: 'exact', head: true })
    .eq('fornecedor_cnpj', cnpj)
    .eq('provedor', provedor)
    .in('status', ['sucesso', 'sem_dados'])
    .gte('executado_em', desde)
  return (count ?? 0) > 0
}

/**
 * Grava o domínio que a cascata descobriu.
 *
 * ─── POR QUE ISTO PRECISA EXISTIR ────────────────────────────────────────────
 *
 * A busca do Claude achou `i3m.com.br` e o resultado virou uma linha de tipo `site`
 * em `contatos_descobertos` — útil para ligar, inútil para o Apollo, que consulta POR
 * DOMÍNIO. Sem gravar, o Apollo era pulado por "sem domínio resolvido" no primeiro
 * clique, no segundo e no décimo, para os 530 fornecedores do funil (nenhum tinha
 * domínio: nem um).
 *
 * ─── A CASCATA NÃO SOBRESCREVE DECISÃO HUMANA ────────────────────────────────
 *
 * Mesma guarda de `radar/dominios.ts`: um `dominio_origem = 'manual'` fica onde está.
 * Sem ela, alguém corrige o domínio à mão e a próxima descoberta devolve o valor
 * antigo — a correção some sem rastro e a pessoa a refaz no mês seguinte.
 *
 * O universo é atualizado mesmo assim, porque lá não existe curadoria manual.
 */
export async function gravarDominioDescoberto(
  cnpj: string,
  dominio: string,
  evidencia: string | null,
): Promise<boolean> {
  const limpo = normalizarDominio(dominio)
  if (!limpo) return false
  // O mesmo guarda das quatro origens da cascata do Radar: provedor genérico,
  // placeholder e escritório contábil não são o domínio da empresa.
  if (motivoDescarteDominio(limpo) !== null) return false

  const { data: mu } = await supabaseAdmin
    .from('mercado_universo')
    .select('dominio, empresa_id')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (!mu?.dominio) {
    await supabaseAdmin
      .from('mercado_universo')
      .update({ dominio: limpo, dominio_origem: 'claude_busca', dominio_confianca: 'media' })
      .eq('cnpj', cnpj)
  }

  if (mu?.empresa_id) {
    const { data: emp } = await supabaseAdmin
      .from('empresas')
      .select('dominio, dominio_origem')
      .eq('id', mu.empresa_id)
      .maybeSingle()
    if (emp?.dominio_origem === 'manual' && emp.dominio) {
      logger.info({ cnpj, manual: emp.dominio, achado: limpo }, 'Domínio manual preservado.')
      return false
    }
    if (!emp?.dominio) {
      await supabaseAdmin
        .from('empresas')
        .update({
          dominio: limpo,
          dominio_origem: 'claude_busca',
          dominio_confianca: 'media',
          dominio_validado_em: new Date().toISOString(),
          dominio_evidencia: evidencia,
        })
        .eq('id', mu.empresa_id)
    }
  }

  logger.info({ cnpj, dominio: limpo }, 'Domínio gravado a partir da descoberta de contatos.')
  return true
}

/**
 * Grava o cadastral que a Nova Vida devolve de graça junto com os contatos.
 *
 * `QTDEFUNCIONARIOS` é EXATAMENTE o número que o gate de porte do Apollo procura e que
 * nenhum fornecedor deste funil tem — não estar na plataforma é a definição deles.
 * Jogá-lo fora era pagar por um dado e descartar a metade que resolve o problema
 * seguinte da mesma cascata.
 *
 * Só grava onde está VAZIO. O headcount do Apollo (`organizations/enrich`) é medido e
 * o desta é presumido: sobrescrever um número apurado por uma estimativa faria a série
 * de `empresa_metricas` contar uma queda que não existiu.
 */
export async function gravarCadastralDescoberto(
  cnpj: string,
  cad: { funcionarios: number | null; faturamento_presumido: number | null },
): Promise<void> {
  if (cad.funcionarios === null && cad.faturamento_presumido === null) return

  const empresaId = await fichaParaGravar(cnpj)
  if (!empresaId) return

  const { data: emp } = await supabaseAdmin
    .from('empresas')
    .select('funcionarios, faturamento_anual')
    .eq('id', empresaId)
    .maybeSingle()

  const campos: Record<string, unknown> = {}
  if (cad.funcionarios !== null && emp?.funcionarios === null) {
    campos.funcionarios = cad.funcionarios
    campos.funcionarios_origem = 'novavida'
    campos.funcionarios_atualizado_em = new Date().toISOString()
  }
  if (cad.faturamento_presumido !== null && emp?.faturamento_anual === null) {
    campos.faturamento_anual = cad.faturamento_presumido
    campos.faturamento_origem = 'novavida'
    campos.faturamento_confianca = 'baixa'
    campos.faturamento_atualizado_em = new Date().toISOString()
  }
  if (Object.keys(campos).length === 0) return

  await supabaseAdmin.from('empresas').update(campos).eq('id', empresaId)
  logger.info({ cnpj, campos: Object.keys(campos) }, 'Cadastral da Nova Vida gravado na ficha.')
}

/**
 * A ficha onde o cadastral descoberto vai morar — CRIANDO-A se preciso.
 *
 * Antes esta função desistia quando o fornecedor não tinha ficha (`if
 * (!mu?.empresa_id) return`), e é aí que estava o desperdício: o fornecedor SEM
 * cadastro é a definição deste funil, e era exatamente nele que o headcount e o
 * faturamento pagos à Nova Vida eram jogados fora. Junto com eles ia todo o resto
 * do cadastral, porque `app__promover_fornecedor_para_empresa` traz razão social,
 * fantasia, UF, município, CNAE, porte, camada e grupo do universo de mercado — o
 * "trazer os demais dados" acontece por criar a ficha, não por copiar campo a
 * campo.
 *
 * ── POR QUE CRIAR AQUI É SEGURO ────────────────────────────────────────────
 * Esta função só é chamada pela descoberta SOB DEMANDA — o clique pago de uma
 * pessoa naquele fornecedor específico. A varredura noturna não passa por aqui, e
 * é isso que impede a promoção em massa de milhares de CNPJs que ninguém pediu.
 *
 * Falhar em criar não pode derrubar a descoberta: o CNPJ pode ainda não estar no
 * universo de mercado (a RPC recusa, e com razão — sem ele não há cadastral para
 * copiar). Os contatos achados valem por si.
 */
async function fichaParaGravar(cnpj: string): Promise<string | null> {
  const { data: mu } = await supabaseAdmin
    .from('mercado_universo')
    .select('empresa_id')
    .eq('cnpj', cnpj)
    .maybeSingle()
  if (mu?.empresa_id) return mu.empresa_id

  const { data, error } = await supabaseAdmin.rpc('app__promover_fornecedor_para_empresa', {
    p_cnpj: cnpj,
    p_ator: null,
    p_origem: 'antecipacao',
  })
  if (error) {
    logger.info(
      { cnpj, erro: error.message },
      'Sem ficha de empresa para o cadastral descoberto — seguindo só com os contatos.',
    )
    return null
  }
  return (data as { id?: string } | null)?.id ?? null
}
