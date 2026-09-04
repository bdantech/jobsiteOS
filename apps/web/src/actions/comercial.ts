'use server'

import { revalidatePath } from 'next/cache'
import {
  atribuirLeadSdr,
  criarLeadSdr,
  atribuirNf,
  atribuirVenda,
  definirCarteira,
  definirCarteiraPassiva,
  definirFaseConta,
  vincularCnpjConta,
  desvincularCnpjConta,
  vincularSacado,
  definirGestaoOperacao,
  gerarTokenIcs,
  moverLeadSdr,
  moverVenda,
  mudarStatusComissao,
  ajusteManualComissao,
  decidirAceiteSdr,
  mudarStatusCompetencia,
  salvarParametroComissao,
  salvarAcessoVendedor,
  salvarComercialConfig,
  salvarComissaoRegra,
  salvarMotivoPerda,
  salvarTerritorio,
  salvarVendedor,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  aplicarDeriva,
  derivaComissao,
  dispararAceitesSdr,
  dispararPitchLead,
  dispararRotearNotas,
  recalcularConta,
} from '@/lib/mercado/worker'
import type { ActionResult } from './empresas'

/**
 * Mutations do módulo Comercial.
 *
 * O client é o do USUÁRIO, nunca o de service role: as RPCs são SECURITY DEFINER mas
 * checam `app_tem_modulo` e `app_gestor_comercial` por dentro, e é essa checagem que
 * decide quem pode mudar carteira e aprovar comissão. Passar o admin aqui anularia a
 * única autorização que existe.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return { erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' }, supabase: null }
  }
  if (!context.grantedModuleIds.includes('comercial')) {
    return { erro: { ok: false as const, message: 'Sem acesso ao módulo Comercial.', code: 'forbidden' }, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

export async function definirGestaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const e = (await definirGestaoOperacao(supabase, input)) as { id?: string } | null
    if (e?.id) revalidatePath(`/empresas/${e.id}`)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function definirCarteiraAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await definirCarteira(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Dizer de quem é um CNPJ que está operando sem conta.
 *
 * `revalidatePath` da ficha da empresa DESTINO, não da origem: o CNPJ vinculado
 * frequentemente não tem ficha nenhuma — é justamente por não estar cadastrado como
 * empresa que ele caiu na lista.
 */
/**
 * Ajustar o relógio de uma conta e reprecificar o mês na mesma ação.
 *
 * Os dois passos são deliberadamente sequenciais e NÃO transacionais: o primeiro é uma
 * escrita no banco, o segundo é o motor rodando no worker. Se o recálculo falhar, o ajuste
 * FICA — ele é a decisão da pessoa, e desfazê-lo por causa de uma falha de rede seria
 * perder a decisão. O backfill diário recolhe o número; a mensagem diz isso em vez de
 * mentir que deu tudo certo.
 */
export async function ajustarFaseContaAction(
  input: unknown,
): Promise<ActionResult<{ recalculado: boolean; total: number; lancamentos: number; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await definirFaseConta(supabase, input)
    const empresaId = (input as { empresa_id?: string }).empresa_id ?? ''
    if (empresaId) revalidatePath(`/empresas/${empresaId}`)
    revalidatePath('/comercial/comissoes')

    const r = await recalcularConta(empresaId)
    if (!r.ok) {
      return {
        ok: true,
        data: {
          recalculado: false,
          total: 0,
          lancamentos: 0,
          aviso: `Ajuste salvo, mas o recálculo não rodou: ${r.message}. O diário recolhe.`,
        },
      }
    }
    const corpo = (r.corpo ?? {}) as { total?: number; lancamentos?: number; motivo?: string }
    return {
      ok: true,
      data: {
        recalculado: corpo.motivo === undefined,
        total: Number(corpo.total ?? 0),
        lancamentos: Number(corpo.lancamentos ?? 0),
        ...(corpo.motivo ? { aviso: `Ajuste salvo, sem recálculo: ${corpo.motivo}.` } : {}),
      },
    }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Pendurar um CNPJ numa conta pela aba do grupo econômico.
 *
 * Recalcula a competência aberta da CONTA logo em seguida, pelo mesmo motivo do ajuste de
 * fase: o vínculo muda de quem é a cessão, e o número na tela tem de refletir isso sem
 * esperar o diário. Falha de recálculo não desfaz o vínculo — ele é a decisão, e o
 * backfill recolhe o número.
 */
export async function vincularCnpjContaAction(
  input: unknown,
): Promise<ActionResult<{ razao_social: string | null; criada: boolean; monitorada: boolean; total: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = (await vincularCnpjConta(supabase, input)) as {
      razao_social?: string | null
      criada?: boolean
      monitorada?: boolean
    } | null
    const contaId = (input as { empresa_id?: string }).empresa_id ?? ''
    if (contaId) revalidatePath(`/empresas/${contaId}`)
    revalidatePath('/comercial/comissoes')

    const rec = contaId ? await recalcularConta(contaId) : null
    const corpo = (rec?.ok ? rec.corpo : null) as { total?: number } | null
    return {
      ok: true,
      data: {
        razao_social: r?.razao_social ?? null,
        criada: r?.criada ?? false,
        monitorada: r?.monitorada ?? false,
        total: Number(corpo?.total ?? 0),
      },
    }
  } catch (error) {
    return falha(error)
  }
}

export async function desvincularCnpjContaAction(
  input: unknown,
): Promise<ActionResult<{ removido: boolean }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = (await desvincularCnpjConta(supabase, input)) as
      | { removido?: boolean; empresa_id?: string }
      | null
    if (r?.empresa_id) {
      revalidatePath(`/empresas/${r.empresa_id}`)
      await recalcularConta(r.empresa_id)
    }
    revalidatePath('/comercial/comissoes')
    return { ok: true, data: { removido: r?.removido ?? false } }
  } catch (error) {
    return falha(error)
  }
}

export async function vincularSacadoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await vincularSacado(supabase, input)
    const alvo = (input as { empresa_id?: string | null } | null)?.empresa_id
    if (alvo) revalidatePath(`/empresas/${alvo}`)
    revalidatePath('/comercial/comissoes')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function definirCarteiraPassivaAction(
  input: unknown,
): Promise<ActionResult<{ adicionadas: number; removidas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = (await definirCarteiraPassiva(supabase, input)) as
      | { adicionadas?: number; removidas?: number }
      | null
    revalidatePath('/comercial/admin')
    revalidatePath('/comercial/carteira')
    return { ok: true, data: { adicionadas: r?.adicionadas ?? 0, removidas: r?.removidas ?? 0 } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverLeadAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const l = (await moverLeadSdr(supabase, input)) as { id?: string; estagio?: string } | null

    /*
     * Reunião marcada como realizada abre a fila de aceite (04k §5) — e ela é acordada
     * AGORA, não na virada da hora. O SLA é contado em horas e o vendedor destino costuma
     * decidir logo depois da reunião; uma fila que só aparece uma hora depois faria a
     * pessoa procurar o item, não achar, e concluir que a tela está quebrada.
     *
     * Sem await no resultado do erro: a fila é criada pelo job, e o cron horário é a rede
     * embaixo. Falhar aqui não pode desfazer o movimento do card, que já está gravado.
     */
    if (l?.estagio === 'reuniao_realizada') void dispararAceitesSdr()

    return { ok: true, data: { id: l?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function moverVendaAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const v = (await moverVenda(supabase, input)) as { id?: string } | null
    return { ok: true, data: { id: v?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Pede a análise de crédito a partir do negócio.
 *
 * O RPC reaproveita uma análise ABERTA do mesmo CNPJ quando existe, em vez de recusar como
 * `app_solicitar_analise` faz: do lado do comercial, "já existe uma em andamento" é o caso
 * feliz — o Crédito já está trabalhando — e apresentá-lo como erro faria a pessoa achar que
 * o pedido falhou.
 */
export async function pedirAnaliseDaVendaAction(
  input: { venda_id: string; limite_solicitado?: number },
): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { data, error } = await supabase.rpc('app_solicitar_analise_da_venda', {
      p: input as never,
    })
    if (error) throw new Error(error.message)
    revalidatePath('/comercial')
    return { ok: true, data: { id: (data as { id?: string } | null)?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirLeadSdrAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirLeadSdr(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Devolve o nome do SDR para a tela poder dizer PARA QUEM foi, e não só "pronto".
 * `revalidatePath` no funil e na ficha: o card novo tem de aparecer nos dois.
 */
export async function criarLeadSdrAction(
  input: unknown,
): Promise<ActionResult<{ lead_id: string; sdr_nome: string; carencia_ignorada: boolean }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const r = (await criarLeadSdr(supabase, input)) as {
      lead_id: string
      sdr_nome: string
      carencia_ignorada: boolean
    }
    revalidatePath('/comercial/sdr')
    return { ok: true, data: r }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirVendaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirVenda(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function atribuirNfAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await atribuirNf(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function mudarStatusComissaoAction(input: unknown): Promise<ActionResult<{ linhas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const n = await mudarStatusComissao(supabase, input)
    return { ok: true, data: { linhas: n } }
  } catch (error) {
    return falha(error)
  }
}

/** Gera (e revoga o anterior) o link .ics do calendário. */
export async function gerarTokenIcsAction(vendedorId?: string): Promise<ActionResult<{ token: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const token = await gerarTokenIcs(supabase, vendedorId)
    return { ok: true, data: { token } }
  } catch (error) {
    return falha(error)
  }
}

// ─── Cadastro ───────────────────────────────────────────────────────────────
//
// Todas revalidam `/comercial/admin`: a tela é lida em servidor no primeiro paint, e
// sem isso o cadastro novo só aparece no refresh seguinte.

export async function salvarVendedorAction(input: unknown): Promise<ActionResult<{ id: string | null }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const v = (await salvarVendedor(supabase, input)) as { id?: string } | null
    revalidatePath('/comercial/admin')
    return { ok: true, data: { id: v?.id ?? null } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * Reroteia as NFs vivas agora, em vez de esperar o diário.
 *
 * Chamado depois de mexer na carteira de um originador. Sem isto a pessoa linka a
 * empresa, abre o funil de NFs, não vê nada e conclui que o link não pegou — e no dia
 * seguinte aparecem centenas de notas de uma vez. É o pior dos dois mundos: parece
 * quebrado na hora e parece mágica depois.
 *
 * Devolve `enfileirado: false` em vez de estourar quando o worker não responde: a
 * carteira JÁ foi salva, e transformar "o reroteamento não começou" em erro de
 * salvamento faria a pessoa salvar de novo achando que perdeu o trabalho.
 */
export async function rotearNotasAction(): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro as ActionResult<never>
  const r = await dispararRotearNotas()
  return r.ok
    ? { ok: true, data: { enfileirado: true } }
    : { ok: true, data: { enfileirado: false, aviso: r.message } }
}

/**
 * O pitch do SDR para um lead — gerado sob demanda, na primeira abertura do card.
 *
 * ─── A RLS É A AUTORIZAÇÃO, E ELA PRECISA DE UMA LEITURA ────────────────────
 * Quem grava o pitch é o worker, com service_role, que passa por cima de toda
 * policy. Então a pergunta "esta pessoa pode ver este lead?" tem de ser respondida
 * AQUI, e a única forma honesta de respondê-la é lendo o lead com o client DELA:
 * se `sdr_leads_select` não devolver a linha, não há pitch a gerar. Sem isso,
 * qualquer pessoa com o módulo Comercial mandaria o worker escrever (e cobrar) um
 * dossiê sobre a carteira de outro SDR.
 *
 * `forcar` é o botão "regerar": o SDR falou com a empresa e o texto não bate com o
 * que ele ouviu. Sem ele, um pitch já gravado volta na hora e não custa nada.
 */
export async function gerarPitchLeadAction(
  leadId: string,
  forcar = false,
): Promise<ActionResult<{ gerado: boolean; motivo?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>

  const { data: lead, error } = await supabase
    .from('sdr_leads')
    .select('id')
    .eq('id', leadId)
    .maybeSingle()
  if (error) return { ok: false, message: error.message, code: 'unknown' }
  if (!lead) return { ok: false, message: 'Lead não encontrado no seu alcance.', code: 'forbidden' }

  const context = await getSessionContext()
  const r = await dispararPitchLead({ leadId, forcar, geradoPor: context?.usuario.id ?? null })
  if (!r.ok) return { ok: false, message: r.message, code: r.code }

  const corpo = (r.corpo ?? {}) as { gerado?: boolean; motivo?: string }
  return { ok: true, data: { gerado: corpo.gerado === true, motivo: corpo.motivo } }
}

export async function salvarTerritorioAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarTerritorio(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarRegraAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarComissaoRegra(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarAcessoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarAcessoVendedor(supabase, input)
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarConfigAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarComercialConfig(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

export async function salvarMotivoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarMotivoPerda(supabase, input)
    revalidatePath('/comercial/admin')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}


// ─── Motor de comissões v2 (04k) ────────────────────────────────────────────

/**
 * Publica um parâmetro com vigência.
 *
 * Não existe "editar": publicar é abrir uma vigência nova e encerrar a anterior. Toda a
 * recusa em português — competência fechada, sobreposição, retroação — vem do RPC, que é
 * onde a regra pode ser garantida; repeti-la aqui criaria uma segunda régua para divergir.
 */
export async function salvarParametroAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarParametroComissao(supabase, input)
    revalidatePath('/comercial/admin')
    revalidatePath('/comercial/comissoes')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}

/**
 * A DERIVA do mês aberto: o que a régua de hoje diria sobre o que já está lançado.
 *
 * Só lê. É a metade "avisar" do avisar-e-oferecer, e existe porque publicar um parâmetro
 * nunca reescreve lançamento — a vigência abre para frente, o motor resolve a taxa na
 * data da cessão, e reprocessar não repaga. As três coisas protegem o passado e deixam a
 * régua e a folha discordarem dentro do mês corrente sem ninguém ver.
 *
 * Não recebe qual parâmetro mudou de propósito: compara tudo contra tudo, e assim pega
 * também a deriva que veio de titularidade, classificação ou data de ativação.
 */
export async function derivaComissaoAction(): Promise<
  ActionResult<{
    competencia: string
    fechada: boolean
    cessoes: number
    contas: {
      empresa_id: string
      conta_nome: string | null
      lancamentos: number
      total_atual: number
      total_novo: number
      delta: number
      tipos: string[]
    }[]
    total_atual: number
    total_novo: number
    delta: number
  }>
> {
  const { erro } = await autorizar()
  if (erro) return erro as ActionResult<never>
  const r = await derivaComissao()
  if (!r.ok) {
    return { ok: false, message: `A prévia não rodou: ${r.message}`, code: r.code ?? 'worker' }
  }
  const c = (r.corpo ?? {}) as Record<string, unknown>
  return {
    ok: true,
    data: {
      competencia: String(c.competencia ?? ''),
      fechada: Boolean(c.fechada),
      cessoes: Number(c.cessoes ?? 0),
      contas: (c.contas ?? []) as never,
      total_atual: Number(c.total_atual ?? 0),
      total_novo: Number(c.total_novo ?? 0),
      delta: Number(c.delta ?? 0),
    },
  }
}

/**
 * Aplica o recálculo nas contas escolhidas — a metade "oferecer".
 *
 * Exige a lista. Recalcular é a única operação do motor que APAGA lançamento, e um
 * default que significasse "todas" faria um clique distraído reescrever a folha inteira.
 * A checagem de gestor é do RPC no caminho normal; aqui ela é explícita porque este
 * caminho fala com o worker por service role e não passaria por RLS nenhuma.
 */
export async function aplicarDerivaAction(
  empresaIds: string[],
): Promise<
  ActionResult<{
    contas: number
    lancamentos: number
    total: number
    falhas: { empresa_id: string; erro: string }[]
  }>
> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  if (!Array.isArray(empresaIds) || empresaIds.length === 0) {
    return { ok: false, message: 'Escolha ao menos uma conta.', code: 'invalid' }
  }

  /*
   * A checagem de gestor é EXPLÍCITA aqui, e é a única action do módulo em que ela
   * precisa ser: as outras escrevem por RPC SECURITY DEFINER, que confere
   * `app_gestor_comercial()` por dentro. Esta fala com o worker, que escreve por service
   * role — sem esta linha, qualquer sessão do módulo Comercial reescreveria a folha.
   */
  const { data: gestor } = await supabase.rpc('app_gestor_comercial')
  if (gestor !== true) {
    return { ok: false, message: 'Só gestores recalculam a folha do mês.', code: 'forbidden' }
  }

  const r = await aplicarDeriva(empresaIds)
  if (!r.ok) {
    return { ok: false, message: `O recálculo não rodou: ${r.message}`, code: r.code ?? 'worker' }
  }
  revalidatePath('/comercial/comissoes')
  revalidatePath('/comercial/admin')
  const c = (r.corpo ?? {}) as Record<string, unknown>
  return {
    ok: true,
    data: {
      contas: Number(c.contas ?? 0),
      lancamentos: Number(c.lancamentos ?? 0),
      total: Number(c.total ?? 0),
      falhas: (c.falhas ?? []) as never,
    },
  }
}

/**
 * Aceita ou recusa a reunião — e acorda o worker para lançar na hora.
 *
 * A decisão é gravada pelo RPC; o LANÇAMENTO é do motor, no worker, que sabe resolver
 * parâmetro na data e gravar o snapshot. Se a chamada ao worker falhar, o aceite JÁ está
 * salvo e o cron horário recolhe — por isso o `enfileirado: false` não é erro: transformar
 * "o lançamento não saiu ainda" em falha faria a pessoa aceitar duas vezes.
 */
export async function decidirAceiteSdrAction(
  input: unknown,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await decidirAceiteSdr(supabase, input)
  } catch (error) {
    return falha(error)
  }
  const r = await dispararAceitesSdr()
  revalidatePath('/comercial/comissoes')
  return r.ok
    ? { ok: true, data: { enfileirado: true } }
    : { ok: true, data: { enfileirado: false, aviso: r.message } }
}

/** Aprova ou marca como paga uma competência inteira. Só avança; nunca reabre. */
export async function mudarStatusCompetenciaAction(
  input: unknown,
): Promise<ActionResult<{ linhas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const n = await mudarStatusCompetencia(supabase, input)
    revalidatePath('/comercial/comissoes')
    return { ok: true, data: { linhas: n } }
  } catch (error) {
    return falha(error)
  }
}

/** A linha que o motor não sabe fazer. Só em competência aberta, e com descrição. */
export async function ajusteManualComissaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await ajusteManualComissao(supabase, input)
    revalidatePath('/comercial/comissoes')
    return { ok: true, data: { ok: true } }
  } catch (error) {
    return falha(error)
  }
}
