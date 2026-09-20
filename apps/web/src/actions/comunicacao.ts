'use server'

import { revalidatePath } from 'next/cache'
import {
  aceitarSugestao,
  aprovarMensagens,
  CONFIG_VOZ_PADRAO,
  fatosDaNotaDoFunil,
  montarPedidoDeLigacao,
  normalizarTelefoneBr,
  telefonesNoProcon,
  MOTIVO_NAO_LIGAR_LABELS,
  type ContatoDaLigacao,
  type NotaDoFunil,
  definirModoAgente,
  descartarSugestao,
  desconectarGmail,
  enfileirarMensagem,
  enviarPedidoApresentacao,
  ignorarConversa,
  marcarConversaLida,
  ocultarConversa,
  reexibirConversa,
  salvarComunicacaoConfig,
  salvarPlaybook,
  montarValoresVariaveis,
  salvarTemplateMensagem,
  vincularConversa,
  type ValoresVariaveis,
} from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { dispararEnviarFilaComunicacao } from '@/lib/mercado/worker'
import type { ActionResult } from './empresas'

/**
 * Mutações da Comunicação (05A).
 *
 * O client é o do USUÁRIO, nunca o de service role. As RPCs são SECURITY DEFINER
 * mas aplicam o portão e checam `app_tem_modulo('comunicacao')` por dentro — e é
 * essa checagem que impede alguém de mandar mensagem para um contato suprimido.
 * Passar o admin aqui anularia a única autorização que existe.
 */

async function autorizar() {
  const context = await getSessionContext()
  if (!context) {
    return {
      erro: { ok: false as const, message: 'Sessão expirada.', code: 'auth' },
      supabase: null,
      context: null,
    }
  }
  if (!context.grantedModuleIds.includes('comunicacao')) {
    return {
      erro: { ok: false as const, message: 'Sem acesso ao módulo Comunicação.', code: 'forbidden' },
      supabase: null,
      context: null,
    }
  }
  return { erro: null, supabase: await createClient(), context }
}

function falha(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
  return { ok: false, message, code: 'unknown' }
}

const ROTA = '/comunicacao'

/**
 * Os VALORES das variáveis do compositor, antes de o template ser aplicado.
 *
 * ── POR QUE SERVICE ROLE ───────────────────────────────────────────────────
 * As chaves do catálogo atravessam módulos: `{qtd_notas}` mora na Antecipação,
 * `{data_reuniao}` no Comercial, `{qtd_spes}` nos Certificados. Quem tem
 * Comunicação sem eles leria zero linhas sob RLS — e o compositor bloquearia o
 * envio dizendo que falta um dado que existe. A escalação é escopada à empresa
 * que a pessoa JÁ enxerga: a leitura de `empresas` abaixo é feita com o client do
 * USUÁRIO, e é ela que autoriza o resto. Mesma régua do `getSessionContext`.
 */
export async function valoresVariaveisAction(
  empresaId: string,
  contatoId: string | null,
): Promise<ActionResult<ValoresVariaveis>> {
  const { erro, supabase, context } = await autorizar()
  if (erro || !supabase || !context) return erro as ActionResult<never>
  try {
    const { data: visivel } = await supabase.from('empresas').select('id').eq('id', empresaId).maybeSingle()
    if (!visivel) return { ok: false, message: 'Empresa não encontrada.', code: 'forbidden' }

    const admin = createAdminClient()
    // O nome que assina é o do VENDEDOR quando a pessoa é um; quem não é vendedor
    // assina com o próprio nome. Cair no e-mail seria assinar "admin@oneos.com.br".
    const { data: vendedor } = await admin
      .from('vendedores')
      .select('nome')
      .eq('usuario_id', context.usuario.id)
      .maybeSingle()

    const valores = await montarValoresVariaveis(admin, {
      empresaId,
      contatoId,
      remetenteNome: vendedor?.nome ?? context.usuario.nome,
    })
    return { ok: true, data: valores }
  } catch (e) {
    return falha(e)
  }
}

/**
 * Enviar é ENFILEIRAR, e a tela diz isso.
 *
 * Depois de enfileirar, o worker é cutucado — best-effort, e o resultado dele não
 * muda a resposta: a mensagem já está na fila e o cron a pega em cinco minutos.
 * Falhar o envio porque o worker não respondeu faria a pessoa mandar de novo e
 * criar duas linhas na fila.
 */
export async function enviarMensagemAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await enfileirarMensagem(supabase, input)
    void dispararEnviarFilaComunicacao().catch(() => undefined)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

/**
 * Aprovar a fila da régua. Depois de aprovar, o worker é cutucado — best-effort,
 * porque a mensagem já está na fila e o cron a pega em cinco minutos.
 */
export async function aprovarMensagensAction(
  ids: string[],
): Promise<ActionResult<{ aprovadas: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const linhas = await aprovarMensagens(supabase, ids)
    void dispararEnviarFilaComunicacao().catch(() => undefined)
    revalidatePath('/comunicacao/outbox')
    revalidatePath(ROTA)
    return { ok: true, data: { aprovadas: Array.isArray(linhas) ? linhas.length : 0 } }
  } catch (e) {
    return falha(e)
  }
}

export async function vincularConversaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await vincularConversa(supabase, input)
    revalidatePath(ROTA)
    revalidatePath('/comunicacao/nao-vinculadas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function ignorarConversaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await ignorarConversa(supabase, input)
    revalidatePath('/comunicacao/nao-vinculadas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function ocultarConversaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await ocultarConversa(supabase, input)
    revalidatePath(ROTA)
    revalidatePath('/comunicacao/nao-vinculadas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function reexibirConversaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await reexibirConversa(supabase, input)
    revalidatePath(ROTA)
    revalidatePath('/comunicacao/nao-vinculadas')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function marcarLidaAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await marcarConversaLida(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function definirModoAgenteAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await definirModoAgente(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

/** Aceitar a sugestão ENFILEIRA — o portão continua valendo (§7). */
export async function aceitarSugestaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await aceitarSugestao(supabase, input)
    void dispararEnviarFilaComunicacao().catch(() => undefined)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function descartarSugestaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await descartarSugestao(supabase, input)
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

/*
 * Literal ÚNICO, e não montado com `+`: o `select` do supabase-js é lido como
 * template no tipo, e uma concatenação vira `GenericStringError` — com o erro
 * aparecendo nas linhas de USO, longe daqui. Mesma lista da tela (`queries.ts`),
 * de propósito: as duas montam os mesmos fatos a partir da mesma view.
 */
const COLUNAS_NOTA_DA_LIGACAO =
  'access_key, numero, serie, emitida_em, vencimento, vencimento_origem, valor, taxa_usada, taxa_analise_am, taxa_analise_origem, receita_esperada, tac_estimada, seguro_estimado, status_sync, operavel, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_cadastrado, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_razao_social, contato_fornecedor'

/**
 * Põe uma nota na fila da Ana, a partir da tela.
 *
 * A tela manda a INTENÇÃO (qual nota, qual contato); quem monta o pedido é
 * aqui, lendo a nota e o contato de novo. O navegador nunca dita o que a Ana vai
 * falar — ele nem teria como saber se o número mudou desde que a tela abriu.
 *
 * O portão de conteúdo roda aqui; o de supressão roda de novo dentro da RPC,
 * porque é fato do banco e pode ter mudado no meio do caminho.
 */
export async function enfileirarLigacaoAction(input: {
  accessKey: string
  contatoId?: string | null
}): Promise<ActionResult<{ id_externo: string; tentativa: number }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { data: nota, error: erroNota } = await supabase
      .from('notas_funil')
      .select(COLUNAS_NOTA_DA_LIGACAO)
      .eq('access_key', input.accessKey)
      .maybeSingle()
    if (erroNota) return { ok: false, message: erroNota.message, code: 'db' }
    if (!nota) return { ok: false, message: 'Nota não encontrada.', code: 'not_found' }

    let contato: ContatoDaLigacao | null = null
    if (input.contatoId) {
      const { data: c } = await supabase
        .from('contatos')
        .select('id, nome, cargo, email, telefone, whatsapp, base_legal')
        .eq('id', input.contatoId)
        .maybeSingle()
      const tel = normalizarTelefoneBr(c?.whatsapp ?? c?.telefone)
      if (c && tel.valido && tel.e164) {
        contato = {
          nome: c.nome,
          cargo: c.cargo,
          telefone_e164: tel.e164,
          email: c.email,
          base_legal: c.base_legal,
        }
      }
    }
    if (!contato) {
      const doPayload = (nota as { contato_fornecedor?: { name?: string; phone?: string } | null })
        .contato_fornecedor
      const tel = normalizarTelefoneBr(doPayload?.phone)
      if (tel.valido && tel.e164) {
        contato = {
          nome: doPayload?.name ?? (nota as { fornecedor_nome?: string | null }).fornecedor_nome ?? null,
          telefone_e164: tel.e164,
          base_legal: 'dado_publico_nfe',
        }
      }
    }

    /*
     * O Procon, lido AQUI e não na tela: a marca vive na evidência do
     * enriquecimento e o portão só tem o booleano. Ligar para quem está na lista
     * é risco jurídico, e o clique é o último ponto em que dá para recusar.
     */
    if (contato?.telefone_e164) {
      const { data: evidencias } = await supabase
        .from('contatos_descobertos')
        .select('valor, evidencia')
        .eq('valor', contato.telefone_e164)
      contato.no_procon = telefonesNoProcon(evidencias ?? []).has(contato.telefone_e164)
    }

    // A config do banco manda: `kill_switch` para tudo sem apagar a fila, e
    // `validade_dias` é o prazo que a Ana diz em voz alta ("vale até sexta").
    const { data: cfgLinha } = await supabase
      .from('antecipacao_config')
      .select('valor')
      .eq('chave', 'voz')
      .maybeSingle()
    const cfg = {
      ...CONFIG_VOZ_PADRAO,
      ...((cfgLinha?.valor ?? {}) as Partial<typeof CONFIG_VOZ_PADRAO>),
    }

    const montado = montarPedidoDeLigacao(
      fatosDaNotaDoFunil(nota as unknown as NotaDoFunil, contato, {
        killSwitch: cfg.kill_switch,
        validadeDias: cfg.validade_dias,
      }),
    )
    if (!montado.ok) {
      return {
        ok: false,
        message: `Não dá para ligar: ${MOTIVO_NAO_LIGAR_LABELS[montado.motivo].toLowerCase()}.`,
        code: montado.motivo,
      }
    }

    // `app_voz_enfileirar` nasceu na 0211 e `database.ts` é gerado do banco: o
    // cast some quando o `pnpm db:types` rodar.
    const rpc = supabase.rpc as unknown as (
      nome: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: { id_externo: string; tentativa: number } | null; error: { message: string } | null }>
    const { data, error } = await rpc('app_voz_enfileirar', {
      p: {
        access_key: input.accessKey,
        telefone: montado.pedido.telefone,
        contato_id: input.contatoId ?? null,
        pedido: montado.pedido,
      },
    })
    if (error) return { ok: false, message: error.message, code: 'rpc' }

    revalidatePath('/comunicacao/ligacoes')
    revalidatePath(ROTA)
    return {
      ok: true,
      data: {
        id_externo: data?.id_externo ?? input.accessKey,
        tentativa: data?.tentativa ?? 1,
      },
    }
  } catch (e) {
    return falha(e)
  }
}

export async function salvarTemplateAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarTemplateMensagem(supabase, input)
    revalidatePath('/comunicacao/templates')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

/**
 * Config e playbooks são de ADMIN, e a checagem que vale é a do RPC
 * (`app_is_admin()`). A daqui existe para a tela poder recusar antes de uma ida
 * ao banco — nunca no lugar dela.
 */
export async function salvarConfigAction(
  valores: Record<string, unknown>,
): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarComunicacaoConfig(supabase, valores)
    revalidatePath('/comunicacao/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

/**
 * O KILL SWITCH. Um clique, e todos os modos autônomos param (§7.5).
 *
 * Tem action própria em vez de ser um campo do formulário de config porque o
 * gesto é outro: config se salva depois de revisar; o kill switch se aperta
 * porque algo está saindo errado agora.
 */
export async function alternarKillSwitchAction(
  ligado: boolean,
): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    const { data } = await supabase
      .from('comunicacao_config')
      .select('valor')
      .eq('chave', 'agente')
      .maybeSingle()
    const atual = (data?.valor ?? {}) as Record<string, unknown>
    await salvarComunicacaoConfig(supabase, { agente: { ...atual, kill_switch: ligado } })
    revalidatePath('/comunicacao/config')
    revalidatePath(ROTA)
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function salvarPlaybookAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await salvarPlaybook(supabase, input)
    revalidatePath('/comunicacao/playbooks')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function desconectarGmailAction(): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await desconectarGmail(supabase)
    revalidatePath('/comunicacao/config')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}

export async function enviarApresentacaoAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  const { erro, supabase } = await autorizar()
  if (erro || !supabase) return erro as ActionResult<never>
  try {
    await enviarPedidoApresentacao(supabase, input)
    void dispararEnviarFilaComunicacao().catch(() => undefined)
    revalidatePath('/comercial/fornecedores')
    return { ok: true, data: { ok: true } }
  } catch (e) {
    return falha(e)
  }
}
