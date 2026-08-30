'use server'

import { revalidatePath } from 'next/cache'
import {
  MutationError,
  ativarFaixaRegra,
  canAccessRoute,
  casarAntecipacaoManual,
  definirPontoFocal,
  descartarMensagem,
  marcarFornecedorSemInteresse,
  marcarSemInteresse,
  moverEstagio,
  promoverFornecedor,
  registrarToqueManual,
  reverterFornecedorSemInteresse,
  salvarAntecipacaoConfig,
  salvarCreditoConfig,
  salvarFaixaDisparo,
  salvarFaixaRegra,
  salvarWhatsappConta,
  type FieldErrors,
  type Tables,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  dispararAntecipacaoDiario,
  dispararCalibrarEconomia,
  dispararContatosNf,
  dispararLookupCadastral,
  dispararOutbox,
  dispararProtestoFornecedor,
  dispararReclassificacaoFunil,
  dispararSyncAntecipacoes,
  dispararSyncNfs,
} from '@/lib/mercado/worker'

/**
 * Mutações do módulo Antecipação. Todas pelos write helpers de @jobsiteos/core
 * (RPCs da migração 0047, com evento + audit_log na mesma transação), sempre com
 * o client do USUÁRIO — o RLS decide o que a escrita toca. Os jobs são
 * enfileirados no worker.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

type Falha = { ok: false; message: string; code: string; fieldErrors?: FieldErrors }

const SEM_SESSAO: Falha = { ok: false, message: 'Sua sessão expirou. Entre novamente.', code: 'forbidden' }
const SEM_MODULO: Falha = {
  ok: false,
  message: 'Você não tem acesso ao módulo Antecipação.',
  code: 'forbidden',
}

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO as Falha, supabase: null }
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds)) {
    return { erro: SEM_MODULO as Falha, supabase: null }
  }
  return { erro: null, supabase: await createClient() }
}

function falhaDe(e: unknown): Falha {
  if (e instanceof MutationError) return { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors }
  return { ok: false, message: 'Não foi possível concluir a operação.', code: 'unknown' }
}

// ─── Funil ──────────────────────────────────────────────────────────────────

export async function moverEstagioAction(input: unknown): Promise<ActionResult<Tables<'notas_fiscais'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const nf = await moverEstagio(supabase, input)
    revalidatePath('/antecipacao')
    return { ok: true, data: nf }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function marcarSemInteresseAction(input: unknown): Promise<ActionResult<Tables<'supressao'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const sup = await marcarSemInteresse(supabase, input)
    revalidatePath('/antecipacao')
    revalidatePath('/radar/supressao')
    return { ok: true, data: sup }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * O descarte de um LEAD da prospecção, que não é a supressão de canal acima:
 * `marcarSemInteresseAction` diz "não toque neste CNPJ"; esta diz "este fornecedor
 * não vai se cadastrar, e este é o motivo". Some da lista a prospectar, tira as
 * notas dos dois funis, e se desfaz com `reverterFornecedorSemInteresseAction`.
 */
export async function marcarFornecedorSemInteresseAction(
  input: unknown,
): Promise<ActionResult<Tables<'antecipacao_fornecedor_sem_interesse'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const r = await marcarFornecedorSemInteresse(supabase, input)
    revalidatePath('/antecipacao')
    revalidatePath('/antecipacao/prospectar-fornecedores')
    revalidatePath('/comercial/nfs')
    return { ok: true, data: r }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function reverterFornecedorSemInteresseAction(
  input: unknown,
): Promise<ActionResult<{ revertido: boolean }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const revertido = await reverterFornecedorSemInteresse(supabase, input)
    revalidatePath('/antecipacao')
    revalidatePath('/antecipacao/prospectar-fornecedores')
    revalidatePath('/comercial/nfs')
    return { ok: true, data: { revertido } }
  } catch (e) {
    return falhaDe(e)
  }
}

/** Ligação / WhatsApp / e-mail disparados pelo app. Alimenta o cooldown da outbox. */
export async function registrarToqueManualAction(input: unknown): Promise<ActionResult<null>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    await registrarToqueManual(supabase, input)
    return { ok: true, data: null }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Regras de faixa ────────────────────────────────────────────────────────

/**
 * Salvar cria a próxima VERSÃO; ativar troca qual vale. Ativar dispara a
 * reclassificação do funil inteiro — sem isso as notas continuariam carregando a
 * faixa que a regra antiga atribuiu, e o Kanban mostraria um número que nenhuma
 * regra ativa justifica.
 */
export async function salvarFaixaRegraAction(
  input: unknown,
): Promise<ActionResult<{ regra: Tables<'faixa_regras'>; enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  let regra: Tables<'faixa_regras'>
  try {
    regra = await salvarFaixaRegra(supabase, input)
  } catch (e) {
    return falhaDe(e)
  }

  let enfileirado = false
  let aviso: string | undefined
  if (regra.ativa) {
    const r = await dispararReclassificacaoFunil()
    enfileirado = r.ok
    aviso = r.ok ? undefined : r.message
  }

  revalidatePath('/antecipacao/faixas')
  revalidatePath('/antecipacao')
  return { ok: true, data: { regra, enfileirado, aviso } }
}

export async function ativarFaixaRegraAction(
  id: string,
): Promise<ActionResult<{ regra: Tables<'faixa_regras'>; enfileirado: boolean; aviso?: string }>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  let regra: Tables<'faixa_regras'>
  try {
    regra = await ativarFaixaRegra(supabase, { id })
  } catch (e) {
    return falhaDe(e)
  }
  const r = await dispararReclassificacaoFunil()
  revalidatePath('/antecipacao/faixas')
  revalidatePath('/antecipacao')
  return { ok: true, data: { regra, enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

// ─── Régua de disparo, contas e outbox ──────────────────────────────────────

export async function salvarFaixaDisparoAction(
  input: unknown,
): Promise<ActionResult<Tables<'faixa_disparos'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarFaixaDisparo(supabase, input)
    // A régua mudou: regenera a fila-sombra para que a tela de Outbox mostre o
    // que a régua NOVA produziria, não o que a antiga produziu.
    await dispararOutbox()
    revalidatePath('/comunicacao/disparos')
    revalidatePath('/comunicacao/outbox')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function salvarWhatsappContaAction(
  input: unknown,
): Promise<ActionResult<Tables<'whatsapp_contas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const conta = await salvarWhatsappConta(supabase, input)
    revalidatePath('/comunicacao/whatsapp')
    return { ok: true, data: conta }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function descartarMensagemAction(
  input: unknown,
): Promise<ActionResult<Tables<'mensagens_outbox'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const msg = await descartarMensagem(supabase, input)
    revalidatePath('/comunicacao/outbox')
    return { ok: true, data: msg }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Ponto focal (Company 360) ──────────────────────────────────────────────

export async function definirPontoFocalAction(
  input: unknown,
): Promise<ActionResult<Tables<'contatos'>>> {
  // Autoriza pelo módulo `empresas`: o ponto focal é um atributo do CONTATO, e a
  // lista de contatos vive na Company 360. Quem pode editar contato pode marcar
  // qual deles é o ponto focal.
  const context = await getSessionContext()
  if (!context) return SEM_SESSAO
  if (!canAccessRoute('/empresas', context.grantedModuleIds)) {
    return { ok: false, message: 'Você não tem acesso ao módulo Empresas.', code: 'forbidden' }
  }
  try {
    const contato = await definirPontoFocal(await createClient(), input)
    revalidatePath(`/empresas/${contato.empresa_id}`)
    return { ok: true, data: contato }
  } catch (e) {
    return falhaDe(e)
  }
}

// ─── Settings e jobs ────────────────────────────────────────────────────────

export async function salvarConfigAction(
  input: unknown,
): Promise<ActionResult<Tables<'antecipacao_config'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const cfg = await salvarAntecipacaoConfig(supabase, input)
    revalidatePath('/antecipacao/config')
    return { ok: true, data: cfg }
  } catch (e) {
    return falhaDe(e)
  }
}

async function enfileirar(
  disparo: () => Promise<{ ok: boolean; message?: string }>,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  const r = await disparo()
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

// Cada uma escrita por extenso, e não como `const x = () => enfileirar(...)`: um
// módulo 'use server' só pode exportar FUNÇÕES ASSÍNCRONAS — uma arrow function
// que devolve promise não passa pelo compilador do Next.

export async function sincronizarNfsAction() {
  return enfileirar(dispararSyncNfs)
}

export async function rodarDiarioAction() {
  return enfileirar(dispararAntecipacaoDiario)
}

export async function reclassificarFunilAction() {
  return enfileirar(dispararReclassificacaoFunil)
}

export async function regenerarOutboxAction() {
  return enfileirar(dispararOutbox)
}

/**
 * Promove o fornecedor a partir do funil.
 *
 * Autorizada por **Antecipação**, ao contrário de `promoverEmpresaAction`, que exige
 * Mercado. Não é frouxidão: o RPC por trás (0068) só aceita CNPJ que seja fornecedor
 * de alguma nota, e fixa `tipo = 'fornecedor'` — este caminho não consegue criar uma
 * construtora nem tocar a pirâmide comercial.
 */
export async function promoverFornecedorAction(
  cnpj: string,
): Promise<ActionResult<Tables<'empresas'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const empresa = await promoverFornecedor(supabase, { cnpj })
    revalidatePath('/empresas')
    return { ok: true, data: empresa }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Protesto de um fornecedor do funil (ação PAGA), seguido de reclassificação.
 *
 * Autorizado pelo módulo **Antecipação**, e não por Radar como os outros disparos de
 * protesto. É uma decisão: o público desta tela é o Comercial, que tem só
 * `antecipacao` — exigir Radar deixaria o botão visível e inútil justamente para quem
 * ele existe. O gasto continua auditável no mesmo lugar de sempre, porque a consulta
 * abre um lote em `lotes_enriquecimento` com `motivo: 'antecipacao_fornecedor'`.
 *
 * O teto natural é o clique: um CNPJ por vez, com o custo mostrado antes.
 */
export async function rodarProtestoFornecedorAction(
  cnpj: string,
): Promise<ActionResult<{ enfileirado: boolean; aviso?: string }>> {
  const { erro } = await autorizar()
  if (erro) return erro
  if (!/^[0-9]{14}$/.test(cnpj)) {
    return { ok: false, message: 'CNPJ inválido.', code: 'validation' }
  }
  const r = await dispararProtestoFornecedor(cnpj)
  return { ok: true, data: { enfileirado: r.ok, aviso: r.ok ? undefined : r.message } }
}

export async function rodarLookupAction() {
  return enfileirar(dispararLookupCadastral)
}

// ─── Antecipações & conversão (04e) ─────────────────────────────────────────

/**
 * Resolve um caso da fila de revisão: vincula a antecipação a uma NF ou a
 * ignora com motivo.
 *
 * O RPC por trás faz a conversão da nota, o evento e o audit na MESMA transação
 * — e é o mesmo caminho que o job automático usa. Duas formas de converter uma
 * nota é como uma delas passa a esquecer de atualizar a tipagem do fornecedor.
 */
export async function casarAntecipacaoAction(
  input: unknown,
): Promise<ActionResult<Tables<'antecipacoes'>>> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro
  try {
    const a = await casarAntecipacaoManual(supabase, input)
    revalidatePath('/antecipacao')
    revalidatePath('/antecipacao/antecipacoes')
    return { ok: true, data: a }
  } catch (e) {
    return falhaDe(e)
  }
}

export async function sincronizarAntecipacoesAction() {
  return enfileirar(dispararSyncAntecipacoes)
}

/**
 * Recalcula as medianas da carteira. NÃO aplica nada: aplicar é o botão da tela
 * de settings, que grava as configs uma a uma pelo caminho auditado de sempre.
 */
export async function calibrarEconomiaAction() {
  return enfileirar(dispararCalibrarEconomia)
}

export interface ResultadoAplicarCalibracao {
  aplicados: string[]
  ignorados: string[]
}

/**
 * "Aplicar valores da carteira" (04e §5).
 *
 * A taxa vive em DOIS lugares e os dois são atualizados aqui:
 * `antecipacao.economia.taxa_mensal_padrao` precifica a receita esperada de cada
 * NF do funil; `credito.economia.taxa_padrao_am` precifica o potencial do sacado.
 * Aplicar só uma corrigiria metade da casa em silêncio.
 *
 * Cada valor `null` (amostra insuficiente) é IGNORADO, não zerado — e a lista do
 * que ficou de fora volta para a tela. Escrever zero num denominador é como uma
 * calibração honesta vira uma base inteira de números impossíveis.
 *
 * Escrever em `credito_config` exige o módulo Crédito, e o RPC repete a checagem.
 * A tela é admin-only, então na prática os dois lados sempre passam; quando não
 * passarem, a resposta diz exatamente o que não foi aplicado.
 */
export async function aplicarCalibracaoAction(
  input: unknown,
): Promise<ActionResult<ResultadoAplicarCalibracao>> {
  const context = await getSessionContext()
  if (!context) return SEM_SESSAO
  if (!canAccessRoute('/antecipacao', context.grantedModuleIds)) return SEM_MODULO

  const v = (input ?? {}) as {
    taxa_am?: number | null
    prazo_dias?: number | null
    valor_medio_nf?: number | null
  }
  const supabase = await createClient()
  const aplicados: string[] = []
  const ignorados: string[] = []

  try {
    if (typeof v.taxa_am === 'number' && v.taxa_am > 0) {
      const atual = await lerConfigJson(supabase, 'antecipacao_config', 'economia')
      await salvarAntecipacaoConfig(supabase, {
        chave: 'economia',
        valor: { ...atual, taxa_mensal_padrao: v.taxa_am },
      })
      aplicados.push('Taxa do funil (% a.m.)')
    } else {
      ignorados.push('Taxa do funil (sem amostra suficiente)')
    }

    const temCredito = canAccessRoute('/credito', context.grantedModuleIds)
    const economiaCredito: Record<string, unknown> = {}
    if (typeof v.taxa_am === 'number' && v.taxa_am > 0) economiaCredito.taxa_padrao_am = v.taxa_am
    if (typeof v.prazo_dias === 'number' && v.prazo_dias > 0) {
      economiaCredito.prazo_medio_dias = Math.round(v.prazo_dias)
    } else {
      ignorados.push('Prazo médio (sem amostra suficiente)')
    }
    if (typeof v.valor_medio_nf === 'number' && v.valor_medio_nf > 0) {
      economiaCredito.valor_medio_nf = v.valor_medio_nf
    } else {
      ignorados.push('Ticket médio (sem amostra suficiente)')
    }

    if (Object.keys(economiaCredito).length > 0) {
      if (!temCredito) {
        ignorados.push('Valores do Crédito (você não tem acesso ao módulo Crédito)')
      } else {
        const atual = await lerConfigJson(supabase, 'credito_config', 'economia')
        await salvarCreditoConfig(supabase, {
          chave: 'economia',
          valor: { ...atual, ...economiaCredito },
        })
        aplicados.push(...Object.keys(economiaCredito).map((k) => `Crédito: ${k}`))
      }
    }

    revalidatePath('/antecipacao/config')
    revalidatePath('/credito/config')
    return { ok: true, data: { aplicados, ignorados } }
  } catch (e) {
    return falhaDe(e)
  }
}

/**
 * Lê o jsonb atual da chave para fazer MERGE em vez de substituição.
 *
 * `valor` é um jsonb inteiro: gravar `{ taxa_padrao_am: 2.4 }` apagaria `tac`,
 * `giro_mensal` e o resto da economia do Crédito de uma vez só.
 */
async function lerConfigJson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: 'antecipacao_config' | 'credito_config',
  chave: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase.from(tabela).select('valor').eq('chave', chave).maybeSingle()
  const v = data?.valor
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export async function rodarContatosNfAction() {
  return enfileirar(dispararContatosNf)
}
