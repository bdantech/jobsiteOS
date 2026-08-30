import { identificadorCanonico } from '../../../../../packages/core/src/comunicacao/index.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import {
  lerStatusWasender,
  lerWebhookResend,
  lerWebhookWasender,
} from '../../../../../packages/core/src/transportes/index.js'
import { conversaPara, escreverNoLedger, tocarConversa } from '../../comunicacao/ledger.js'
import { enfileirarNaoVinculada, resolverRemetente } from '../../comunicacao/resolver.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * Recebimento (§3.1 e §3.2).
 *
 * As duas rotas — a do worker e a da web — chamam ESTAS funções. É idempotente
 * por id da mensagem do provedor (índice único parcial em `comunicacoes`), o que
 * torna a reentrega segura: os dois provedores reentregam quando não recebem 200
 * rápido, e a alternativa a um upsert seria uma bolha duplicada por reentrega.
 *
 * A triagem NÃO roda aqui. O webhook grava e responde; classificar chama um
 * modelo, e um modelo dentro de um webhook é um webhook que estoura o timeout do
 * provedor e provoca a tempestade de reenvio que a idempotência está evitando.
 */

export interface ResultadoWebhook {
  ok: boolean
  gravada?: boolean
  motivo?: string
}

// ─── WhatsApp ───────────────────────────────────────────────────────────────

export async function processarWebhookWasender(payload: unknown): Promise<ResultadoWebhook> {
  const status = lerStatusWasender(payload)
  if (status) {
    const { error } = await supabaseAdmin
      .from('comunicacoes')
      .update({ status_envio: status.status })
      .eq('provedor', 'wasender')
      .eq('id_externo', status.idExterno)
    if (error) logger.error({ erro: error.message }, 'Falha ao atualizar status de entrega.')
    return { ok: true, gravada: false, motivo: 'status' }
  }

  const m = lerWebhookWasender(payload)
  if (!m) return { ok: true, gravada: false, motivo: 'evento ignorado' }

  const contaRecebedora = await numeroDaConta(m.para)
  const r = await resolverRemetente({ canal: 'whatsapp', identificador: m.de, corpo: m.corpo })

  const conversaId = await conversaPara({
    canal: 'whatsapp',
    identificador: m.de,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    vendedorId: r.vendedorId,
  })

  const comunicacaoId = await escreverNoLedger({
    conversaId,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    canal: 'whatsapp',
    direcao: 'entrada',
    vendedorId: r.vendedorId,
    corpo: m.corpo,
    provedor: 'wasender',
    idExterno: m.idExterno,
    contaRemetente: contaRecebedora ?? m.para,
    statusEnvio: 'entregue',
    origem: 'inbox',
    criadoEm: m.recebidaEm,
  })

  if (conversaId) {
    await tocarConversa({ conversaId, direcao: 'entrada', em: m.recebidaEm, novoStatus: 'ativa' })
  }

  // Não identificado → fila de identificação. Adivinhar seria pior: a conversa de
  // um estranho na timeline de um cliente não é encontrada depois.
  if (!r.contatoId) {
    await enfileirarNaoVinculada({
      canal: 'whatsapp',
      identificador: m.de,
      nomeSugerido: m.nomeSugerido,
      contaRecebedora: contaRecebedora ?? m.para,
      vendedorSugeridoId: r.vendedorId,
      em: m.recebidaEm,
    })
  }

  await avisarChegada({
    empresaId: r.empresaId,
    conversaId,
    comunicacaoId,
    vendedorId: r.vendedorId,
    canal: 'whatsapp',
    de: m.nomeSugerido ?? m.de,
    preview: m.corpo,
  })

  return { ok: true, gravada: true }
}

/** O apelido/id de sessão que o provedor manda → o número da nossa conta. */
async function numeroDaConta(referencia: string): Promise<string | null> {
  if (!referencia) return null
  const digitos = identificadorCanonico('whatsapp', referencia)
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select('numero')
    .or(digitos ? `numero.eq.${digitos},apelido.eq.${referencia}` : `apelido.eq.${referencia}`)
    .limit(1)
    .maybeSingle()
  return data?.numero ?? digitos
}

// ─── Resend ─────────────────────────────────────────────────────────────────

export async function processarWebhookResend(payload: unknown): Promise<ResultadoWebhook> {
  const evento = lerWebhookResend(payload)
  if (!evento) return { ok: true, gravada: false, motivo: 'evento ignorado' }

  if (evento.tipo === 'status') {
    const { error } = await supabaseAdmin
      .from('comunicacoes')
      .update({ status_envio: evento.status })
      .eq('provedor', 'resend')
      .eq('id_externo', evento.idExterno)
    if (error) logger.error({ erro: error.message }, 'Falha ao atualizar status do Resend.')
    return { ok: true, gravada: false, motivo: 'status' }
  }

  /*
   * Hard bounce e reclamação viram SUPRESSÃO automática (§3.2).
   *
   * Não é zelo excessivo: continuar mandando para um endereço que não existe
   * derruba a reputação do domínio, e a próxima mensagem legítima — a que alguém
   * escreveu à mão para um cliente — cai no spam. O custo de suprimir um endereço
   * morto é zero; o de não suprimir é o canal inteiro.
   */
  const email = evento.email.toLowerCase()
  await supabaseAdmin
    .from('supressao')
    .upsert(
      {
        escopo: 'email',
        valor: email,
        motivo: evento.motivo === 'hard_bounce' ? 'hard_bounce' : 'descadastro',
        observacao:
          evento.motivo === 'hard_bounce'
            ? 'Hard bounce reportado pelo Resend.'
            : 'Marcado como spam pelo destinatário (Resend).',
        contexto: 'geral',
      },
      { onConflict: 'escopo,valor', ignoreDuplicates: true },
    )

  await supabaseAdmin
    .from('comunicacoes')
    .update({ status_envio: 'falhou', erro: `Resend: ${evento.motivo}` })
    .eq('provedor', 'resend')
    .eq('id_externo', evento.idExterno)

  const { data: contato } = await supabaseAdmin
    .from('contatos')
    .select('id, empresa_id, nome')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  await emitirEvento(contato?.empresa_id ?? null, EVENTO_TIPOS.OPTOUT_REGISTRADO, {
    titulo: 'Descadastro registrado',
    resumo:
      evento.motivo === 'hard_bounce'
        ? `${email} não existe (hard bounce). Suprimido para proteger o domínio.`
        : `${email} marcou nossa mensagem como spam. Suprimido.`,
    url: '/radar/supressao',
    email,
    motivo: evento.motivo,
  })

  return { ok: true, gravada: true }
}

// ─── Aviso de chegada ───────────────────────────────────────────────────────

/**
 * Mensagem recebida avisa o DONO da conversa — nunca um perfil inteiro.
 *
 * Uma regra de fan-out por perfil daria a todo o time comercial todas as
 * conversas de todo mundo, e o sino viraria ruído em dois dias. É a mesma decisão
 * do advogado do processo (0143).
 */
async function avisarChegada(args: {
  empresaId: string | null
  conversaId: string | null
  comunicacaoId: string | null
  vendedorId: string | null
  canal: 'whatsapp' | 'email'
  de: string
  preview: string | null
}): Promise<void> {
  if (args.empresaId) {
    await emitirEvento(args.empresaId, EVENTO_TIPOS.COMUNICACAO_RECEBIDA, {
      titulo: `Mensagem recebida por ${args.canal === 'email' ? 'e-mail' : 'WhatsApp'}`,
      resumo: (args.preview ?? '(sem texto)').slice(0, 200),
      url: args.conversaId ? `/comunicacao/${args.conversaId}` : '/comunicacao',
      canal: args.canal,
      comunicacao_id: args.comunicacaoId,
      conversa_id: args.conversaId,
    })
  }

  if (!args.vendedorId) return
  const { data: vendedor } = await supabaseAdmin
    .from('vendedores')
    .select('usuario_id')
    .eq('id', args.vendedorId)
    .maybeSingle()
  if (!vendedor?.usuario_id) return

  try {
    await notify(supabaseAdmin, [vendedor.usuario_id], {
      titulo: `${args.de} respondeu`,
      corpo: (args.preview ?? '(sem texto)').slice(0, 140),
      url: args.conversaId ? `/comunicacao/${args.conversaId}` : '/comunicacao',
    })
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao notificar o dono da conversa.')
  }
}
