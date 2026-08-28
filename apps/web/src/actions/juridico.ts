'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  atualizarProcesso,
  calcularDivida,
  canAccessRoute,
  concluirPrazo,
  editarParecerJuridico,
  registrarCusto,
  registrarRecuperacao,
  removerOperacao,
  salvarAdvogado,
  salvarIndices,
  salvarJuridicoConfig,
  salvarOperacao,
  salvarPrazo,
  type FieldErrors,
  type Json,
  type ParametrosCalculo,
  type ResultadoCalculo,
  type TabelaIndices,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararClassificarFases,
  dispararDescobrirProcessos,
  dispararMonitoramentosJuridico,
  dispararParecerJuridico,
  dispararSincronizarJuridico,
} from '@/lib/mercado/worker'

/**
 * Mutações do módulo Jurídico. Escrita sempre pelos RPCs SECURITY DEFINER da migração
 * 0143, com o client do USUÁRIO — o RLS e o próprio RPC decidem o que a escrita toca.
 *
 * NENHUMA action aqui escreve capa, movimentação ou envolvido: isso é do Escavador, no
 * worker, com service role. Um atalho de tela para "corrigir a data da citação"
 * produziria um cronograma que a próxima sincronização desfaz em silêncio — e o
 * cronograma é o que dispara o alerta de lentidão e a notificação ao advogado.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = { ok: false, message: 'Você não tem acesso ao módulo Jurídico.', code: 'forbidden' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null, userId: null }
  if (!canAccessRoute('/juridico', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null, userId: null }
  }
  return { erro: null, supabase: await createClient(), userId: context.usuario.id }
}

/** Só admin: mexer na agenda, nos benchmarks e nos índices muda o custo da carteira. */
async function autorizarAdmin() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!context.grantedModuleIds.includes('admin')) {
    return {
      erro: {
        ok: false,
        message: 'Somente a administração altera as configurações do Jurídico.',
        code: 'forbidden',
      } as Falha,
      supabase: null,
    }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

function revalidar(numeroCnj?: string): void {
  revalidatePath('/juridico')
  if (numeroCnj) revalidatePath(`/juridico/${numeroCnj}`)
}

// ─── Gestão do processo ─────────────────────────────────────────────────────

export async function atualizarProcessoAction(input: unknown): Promise<ActionResult<Tables<'processos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const p = await atualizarProcesso(supabase, input)
    revalidar(p.numero_cnj)
    // A ficha da empresa mostra a seção Jurídico, e a situação interna acabou de
    // mudar o "em disputa" dela.
    if (p.empresa_devedora_id) revalidatePath(`/empresas/${p.empresa_devedora_id}`)
    return { ok: true, data: p }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarAdvogadoAction(input: unknown): Promise<ActionResult<Tables<'advogados'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await salvarAdvogado(supabase, input)
    revalidatePath('/juridico/config')
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Operações, custos e recuperações ───────────────────────────────────────

export async function salvarOperacaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'processo_operacoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const o = await salvarOperacao(supabase, input)
    revalidar(o.numero_cnj)
    return { ok: true, data: o }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function removerOperacaoAction(id: string): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await removerOperacao(supabase, { id })
    revalidar()
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function registrarCustoAction(
  input: unknown,
): Promise<ActionResult<Tables<'processo_custos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const c = await registrarCusto(supabase, input)
    revalidar(c.numero_cnj)
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function registrarRecuperacaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'processo_recuperacoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await registrarRecuperacao(supabase, input)
    revalidar(r.numero_cnj)
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Prazos ─────────────────────────────────────────────────────────────────

export async function salvarPrazoAction(input: unknown): Promise<ActionResult<Tables<'processo_prazos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const p = await salvarPrazo(supabase, input)
    revalidar(p.numero_cnj)
    // O calendário do 04g lê a agenda jurídica; um prazo novo tem de aparecer nele
    // sem esperar o cache da rota expirar.
    revalidatePath('/comercial/calendario')
    return { ok: true, data: p }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function concluirPrazoAction(
  id: string,
  concluido: boolean,
): Promise<ActionResult<Tables<'processo_prazos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const p = await concluirPrazo(supabase, { id, concluido })
    revalidar(p.numero_cnj)
    revalidatePath('/comercial/calendario')
    return { ok: true, data: p }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §6 Cálculo da dívida ───────────────────────────────────────────────────

export interface CalculoGerado {
  calculo: Tables<'processo_calculos'>
  resultado: ResultadoCalculo
}

/**
 * O cálculo roda AQUI, no servidor, com o motor de `packages/core`, e é gravado por
 * RPC. Duas razões para não deixar isso no cliente:
 *
 *   1. os parâmetros e a tabela de índices são lidos do banco na mesma transação
 *      lógica, então o que foi gravado é o que foi calculado;
 *   2. um cálculo no navegador seria um total que o usuário pode alterar antes de
 *      mandar gravar — e este total vai para os autos.
 *
 * Falta de índice NÃO impede o cálculo: as competências sem valor entram na memória
 * e voltam na resposta, para a tela avisar antes de alguém protocolar.
 */
export async function gerarCalculoAction(input: {
  numeroCnj: string
  dataBase?: string
  parametros?: Partial<ParametrosCalculo>
}): Promise<ActionResult<CalculoGerado>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  try {
    const dataBase = input.dataBase ?? new Date().toISOString().slice(0, 10)

    const [{ data: operacoes }, { data: cfg }, { data: custos }] = await Promise.all([
      supabase
        .from('processo_operacoes')
        .select('id, valor_original, vencimento, descricao, access_key, antecipacao_id_externo')
        .eq('numero_cnj', input.numeroCnj),
      supabase.from('juridico_config').select('valor').eq('chave', 'calculo').maybeSingle(),
      supabase
        .from('processo_custos')
        .select('valor')
        .eq('numero_cnj', input.numeroCnj)
        .lte('data', dataBase),
    ])

    if (!operacoes?.length) {
      return {
        ok: false,
        code: 'sem_operacoes',
        message:
          'Cadastre as operações cobradas antes de gerar o cálculo. Sem elas o total sairia ' +
          'zero, e um zero aqui parece uma dívida quitada.',
      }
    }

    const parametros = {
      ...(cfg?.valor as ParametrosCalculo | undefined),
      ...input.parametros,
    } as ParametrosCalculo

    // A tabela de índices, só do índice escolhido. Um `select *` traria IPCA, IGP-M e
    // INPC juntos e o motor aplicaria a última linha que casasse a competência —
    // corrigindo o mesmo mês por dois índices diferentes conforme a ordem do retorno.
    const { data: indices } = await supabase
      .from('juridico_indices')
      .select('competencia, valor')
      .eq('indice', parametros.indice)

    const tabela: TabelaIndices = Object.fromEntries(
      (indices ?? []).map((i) => [i.competencia, Number(i.valor)]),
    )

    const totalCustas = (custos ?? []).reduce((s, c) => s + Number(c.valor), 0)

    const resultado = calcularDivida(
      (operacoes ?? []).map((o) => ({
        id: o.id,
        valor_original: Number(o.valor_original),
        vencimento: o.vencimento,
        descricao: o.descricao,
        access_key: o.access_key,
        antecipacao_id_externo: o.antecipacao_id_externo,
      })),
      parametros,
      tabela,
      dataBase,
      totalCustas,
    )

    const { data: gravado, error } = await supabase.rpc('app_juridico_registrar_calculo', {
      p: {
        numero_cnj: input.numeroCnj,
        data_base: dataBase,
        parametros: resultado.parametros,
        principal: resultado.principal,
        correcao: resultado.correcao,
        juros: resultado.juros,
        multa: resultado.multa,
        honorarios: resultado.honorarios,
        custas: resultado.custas,
        total: resultado.total,
        memoria: resultado.memoria,
      } as unknown as Json,
    })
    if (error) throw new MutationError(error.message, error.code ?? 'unknown')

    revalidar(input.numeroCnj)
    return { ok: true, data: { calculo: gravado as Tables<'processo_calculos'>, resultado } }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── §7 Parecer ─────────────────────────────────────────────────────────────

/** Gera o parecer no worker (que tem a chave da Anthropic) e devolve o resultado. */
export async function gerarParecerAction(
  numeroCnj: string,
): Promise<ActionResult<{ risco: string | null; proximo_passo: string; tokens: number }>> {
  const { erro, userId } = await autorizar()
  if (erro) return erro

  const r = await dispararParecerJuridico({ numeroCnj, geradoPor: userId })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }

  revalidar(numeroCnj)
  const corpo = (r.corpo ?? {}) as { risco?: string | null; proximo_passo?: string; tokens?: number }
  return {
    ok: true,
    data: {
      risco: corpo.risco ?? null,
      proximo_passo: corpo.proximo_passo ?? '',
      tokens: corpo.tokens ?? 0,
    },
  }
}

export async function editarParecerAction(
  input: unknown,
): Promise<ActionResult<Tables<'processo_pareceres'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const p = await editarParecerJuridico(supabase, input)
    revalidar(p.numero_cnj)
    return { ok: true, data: p }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Jobs (worker) ──────────────────────────────────────────────────────────

/** "Atualizar agora" de UM processo: pede ao robô que vá ao tribunal. Custa crédito. */
export async function atualizarAgoraAction(numeroCnj: string): Promise<ActionResult<{ ok: true }>> {
  const { erro } = await autorizar()
  if (erro) return erro

  const r = await dispararSincronizarJuridico({ numeroCnj })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  revalidar(numeroCnj)
  return { ok: true, data: { ok: true } }
}

export async function descobrirProcessosAction(input: {
  cnpj?: string
  incluirInativos?: boolean
  comMovimentacoes?: boolean
} = {}): Promise<ActionResult<{ ok: true }>> {
  const { erro } = await autorizarAdmin()
  if (erro) return erro
  const r = await dispararDescobrirProcessos(input)
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  revalidar()
  return { ok: true, data: { ok: true } }
}

export async function sincronizarAgoraAction(): Promise<ActionResult<{ ok: true }>> {
  const { erro } = await autorizarAdmin()
  if (erro) return erro
  // `forcarAgenda` porque quem clicou está pedindo AGORA, e a agenda existe para o
  // automático — não para bloquear uma pessoa que decidiu rodar hoje.
  const r = await dispararSincronizarJuridico({ forcarAgenda: true })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  revalidar()
  return { ok: true, data: { ok: true } }
}

export async function reclassificarFasesAction(): Promise<ActionResult<{ ok: true }>> {
  const { erro } = await autorizarAdmin()
  if (erro) return erro
  const r = await dispararClassificarFases()
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  revalidar()
  return { ok: true, data: { ok: true } }
}

export async function sincronizarMonitoramentosAction(): Promise<ActionResult<{ ok: true }>> {
  const { erro } = await autorizarAdmin()
  if (erro) return erro
  const r = await dispararMonitoramentosJuridico()
  if (!r.ok) return { ok: false, message: r.message, code: r.code }
  revalidatePath('/juridico/config')
  return { ok: true, data: { ok: true } }
}

// ─── Configurações (admin) ──────────────────────────────────────────────────

export async function salvarJuridicoConfigAction(
  chave: string,
  valor: unknown,
): Promise<ActionResult<Tables<'juridico_config'>>> {
  const { erro, supabase } = await autorizarAdmin()
  if (erro) return erro
  try {
    const c = await salvarJuridicoConfig(supabase, { chave, valor })
    revalidatePath('/juridico/config')
    /*
     * Mexer nas REGRAS do classificador não reclassifica sozinho, de propósito.
     * A reclassificação varre a base inteira e pode mover a fase de centenas de
     * processos — inclusive disparando alertas de lentidão. É um botão separado na
     * tela, com o número de processos afetados na frente.
     */
    return { ok: true, data: c }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarIndicesAction(input: unknown): Promise<ActionResult<{ gravadas: number }>> {
  const { erro, supabase } = await autorizarAdmin()
  if (erro) return erro
  try {
    const r = await salvarIndices(supabase, input)
    revalidatePath('/juridico/config')
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}
