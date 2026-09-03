import { identificadorCanonico } from '../../../../../packages/core/src/comunicacao/index.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import {
  lerEntradasWasender,
  lerEnviosWasender,
  lerStatusWasender,
  lerWebhookResend,
  type MensagemEnviadaWasender,
  type MensagemRecebidaWasender,
} from '../../../../../packages/core/src/transportes/index.js'
import type { ContaDoWebhook } from '../../comunicacao/webhook-auth.js'
import { anexarNoLedger, baixarEGuardarMidia, legendaDaMidia } from '../../comunicacao/midia.js'
import {
  absorverLid,
  conversaPara,
  conversaPorLid,
  escreverNoLedger,
  jaNoLedger,
  tocarConversa,
} from '../../comunicacao/ledger.js'
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

export async function processarWebhookWasender(
  payload: unknown,
  /**
   * A conta por cujo segredo o webhook entrou (0152). É o NÚMERO que recebeu, e o
   * payload não o informa: `sessionId` é um identificador de sessão, e gravá-lo
   * como `conta_remetente` pôs 48 dígitos na coluna do telefone em 158 mensagens.
   * Sem ele não há como dizer de quem é a conversa não vinculada.
   */
  conta: ContaDoWebhook | null = null,
): Promise<ResultadoWebhook> {
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

  /*
   * UM PAYLOAD PODE TRAZER VÁRIAS MENSAGENS, e por muito tempo trouxe uma só
   * porque o leitor não sabia ler a outra forma: `messages.received` manda um
   * objeto em `data.messages` e `messages.upsert` manda um ARRAY. Com o array,
   * `dados.key` era `undefined` e a mensagem sumia em silêncio — justamente no
   * evento que cobre o que a equipe digita no aparelho.
   */
  const entradas = lerEntradasWasender(payload)
  const envios = lerEnviosWasender(payload)
  if (entradas.length === 0 && envios.length === 0) {
    return { ok: true, gravada: false, motivo: 'evento ignorado' }
  }

  let gravadas = 0
  for (const e of envios) {
    const r = await registrarEnvioPeloCelular(e, conta)
    if (r.gravada) gravadas += 1
  }
  for (const m of entradas) {
    const r = await registrarEntrada(m, conta)
    if (r.gravada) gravadas += 1
  }

  return { ok: true, gravada: gravadas > 0, motivo: `${gravadas} gravada(s)` }
}

async function registrarEntrada(
  m: MensagemRecebidaWasender,
  conta: ContaDoWebhook | null,
): Promise<ResultadoWebhook> {
  const contaRecebedora = conta?.numero ?? (await numeroDaConta(m.para))
  const r = await resolverRemetente({ canal: 'whatsapp', identificador: m.de, corpo: m.corpo })

  /*
   * A THREAD, e a ordem aqui não é indiferente.
   *
   * Quando o telefone veio (`m.de !== m.lid`), ele é a chave — a mesma que o
   * compositor usa para enviar, e a única que o cooldown e a supressão sabem
   * procurar. Quando veio SÓ o LID, a thread já conhecida por aquele LID é a
   * resposta certa; abrir uma nova recriaria a conversa paralela que a absorção
   * existe para desfazer.
   */
  const soLid = m.lid !== null && m.de === m.lid
  const conversaId =
    (soLid ? await conversaPorLid(m.lid) : null) ??
    (await conversaPara({
      canal: 'whatsapp',
      identificador: m.de,
      empresaId: r.empresaId,
      contatoId: r.contatoId,
      vendedorId: r.vendedorId,
    }))

  // Com os dois identificadores na mão, casa a thread que ficou presa ao LID.
  if (!soLid) await absorverLid(m.lid, conversaId)

  const comunicacaoId = await escreverNoLedger({
    conversaId,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    canal: 'whatsapp',
    direcao: 'entrada',
    // Carteira primeiro, dono do número depois: quem já é dono da conta continua
    // sendo, e o que a segunda fonte cobre é a conversa ainda não identificada —
    // que é a maioria delas, e era 100% do que ficava sem dono.
    vendedorId: r.vendedorId ?? (await vendedorDaConta(conta?.id)),
    corpo: m.midia ? legendaDaMidia(m.midia, m.corpo) : m.corpo,
    provedor: 'wasender',
    idExterno: m.idExterno,
    contaRemetente: contaRecebedora,
    statusEnvio: 'entregue',
    origem: 'inbox',
    criadoEm: m.recebidaEm,
  })

  // A mídia vem DEPOIS da linha do ledger, sempre: se o download falhar, a bolha
  // existe com "(áudio)" escrito e um erro no log — e não some junto do arquivo.
  if (m.midia && comunicacaoId) {
    const anexo = await baixarEGuardarMidia({ midia: m.midia, conversaId, comunicacaoId })
    if (anexo) await anexarNoLedger(comunicacaoId, anexo)
  }

  if (conversaId) {
    await tocarConversa({ conversaId, direcao: 'entrada', em: m.recebidaEm, novoStatus: 'ativa' })
  }

  // Não identificado → fila de identificação. Adivinhar seria pior: a conversa de
  // um estranho na timeline de um cliente não é encontrada depois.
  if (!r.contatoId) {
    await enfileirarNaoVinculada({
      canal: 'whatsapp',
      identificador: m.de,
      lid: m.lid,
      nomeSugerido: m.nomeSugerido,
      contaRecebedora,
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

/**
 * A mensagem que a EQUIPE mandou, vista pelo webhook.
 *
 * ── DUAS PROCEDÊNCIAS, UM SÓ EVENTO ─────────────────────────────────────────
 * O provedor manda o mesmo evento para o que saiu daqui e para o que alguém
 * digitou no aparelho, e o `id_externo` é o que separa as duas: quando ele já
 * está no ledger, foi o `enviar-fila` que gravou — com autor, vendedor, template
 * e origem — e não há nada a fazer. Um upsert aqui seria pior que inútil:
 * substituiria aquela linha por uma cópia anônima, apagando de quem foi a
 * mensagem.
 *
 * ── E POR QUE A DE FORA ENTRA ───────────────────────────────────────────────
 * Porque o inbox mostrava metade do diálogo. O cliente perguntava, o vendedor
 * respondia pelo celular, e a tela guardava só a pergunta — de modo que a próxima
 * pessoa a abrir a conversa concluía que ninguém tinha respondido.
 *
 * Ela entra como `origem = 'celular'` e nunca como `compositor`: não passou pelo
 * portão, e uma auditoria de supressão que não conseguisse distinguir as duas
 * juraria que passou.
 */
async function registrarEnvioPeloCelular(
  e: MensagemEnviadaWasender,
  conta: ContaDoWebhook | null,
): Promise<ResultadoWebhook> {
  if (await jaNoLedger('wasender', e.idExterno)) {
    return { ok: true, gravada: false, motivo: 'envio da plataforma' }
  }

  const r = await resolverRemetente({ canal: 'whatsapp', identificador: e.para, corpo: e.corpo })
  const soLid = e.lid !== null && e.para === e.lid
  const conversaId =
    (soLid ? await conversaPorLid(e.lid) : null) ??
    (await conversaPara({
      canal: 'whatsapp',
      identificador: e.para,
      empresaId: r.empresaId,
      contatoId: r.contatoId,
      vendedorId: r.vendedorId,
    }))
  if (!soLid) await absorverLid(e.lid, conversaId)

  const comunicacaoId = await escreverNoLedger({
    conversaId,
    empresaId: r.empresaId,
    contatoId: r.contatoId,
    canal: 'whatsapp',
    direcao: 'saida',
    /*
     * O DONO DO NÚMERO é quem responde por esta mensagem.
     *
     * O provedor não diz qual das pessoas com acesso ao aparelho digitou, mas o
     * aparelho tem dono — e é ele quem atende aquele fornecedor. Sem isto a
     * mensagem ficaria órfã, e a conversa dela também: é esta atribuição que faz
     * a regra de carteira funcionar para quem responde pelo celular.
     */
    usuarioId: conta?.id ? await donoDaConta(conta.id) : null,
    /*
     * Aqui o dono do número vem ANTES da carteira, ao contrário da entrada.
     *
     * Esta mensagem saiu fisicamente de um aparelho, e o aparelho tem dono. Se a
     * empresa é da carteira do Fabio e quem digitou foi o Rodrigo, creditar o
     * Fabio no painel de atividade seria contar o trabalho de um como do outro —
     * e o painel existe justamente para responder quem trabalhou.
     */
    vendedorId: (await vendedorDaConta(conta?.id)) ?? r.vendedorId,
    corpo: e.midia
      ? legendaDaMidia(e.midia, e.corpo)
      : (e.corpo ?? (e.temMidia ? '(mídia enviada pelo celular)' : null)),
    provedor: 'wasender',
    idExterno: e.idExterno,
    contaRemetente: conta?.numero ?? null,
    statusEnvio: 'enviada',
    origem: 'celular',
    enviadoEm: e.enviadaEm,
    criadoEm: e.enviadaEm,
  })

  if (e.midia && comunicacaoId) {
    const anexo = await baixarEGuardarMidia({ midia: e.midia, conversaId, comunicacaoId })
    if (anexo) await anexarNoLedger(comunicacaoId, anexo)
  }

  if (conversaId) {
    // Responder é ler: `tocarConversa` com direção de saída zera `nao_lidas`, e é
    // o que faz o contador do inbox parar de cobrar uma resposta que já foi dada.
    await tocarConversa({
      conversaId,
      direcao: 'saida',
      em: e.enviadaEm,
      novoStatus: 'aguardando_resposta',
    })
  }

  if (r.empresaId) {
    await emitirEvento(r.empresaId, EVENTO_TIPOS.COMUNICACAO_ENVIADA, {
      titulo: 'Mensagem enviada pelo WhatsApp (celular)',
      resumo: (e.corpo ?? '(mídia)').slice(0, 200),
      url: conversaId ? `/comunicacao/${conversaId}` : '/comunicacao',
      canal: 'whatsapp',
      comunicacao_id: comunicacaoId,
      conversa_id: conversaId,
      por_ia: false,
    })
  }

  return { ok: true, gravada: true }
}

/** O usuário responsável por um número. É ele quem "falou" pelo aparelho. */
async function donoDaConta(contaId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select('usuario_responsavel')
    .eq('id', contaId)
    .maybeSingle()
  return data?.usuario_responsavel ?? null
}

/**
 * O VENDEDOR dono do número — a segunda fonte de atribuição, e a que faltava.
 *
 * `resolverRemetente` só sabe atribuir pela CARTEIRA: acha a empresa pelo contato
 * e devolve o dono dela. Enquanto ninguém identificou o contato — o estado normal
 * de uma conversa nova — não há empresa, logo não há dono, e a mensagem ficava
 * órfã. O painel de atividade lê exatamente essa coluna, então a equipe aparecia
 * quase parada enquanto o WhatsApp dela não parava: 12 mensagens com dono em 426.
 *
 * O número resolve porque ele é de uma pessoa (`usuario_responsavel`). É o mesmo
 * argumento da posse da conversa: quem atendeu o número foi quem falou.
 */
async function vendedorDaConta(contaId: string | null | undefined): Promise<string | null> {
  if (!contaId) return null
  const usuario = await donoDaConta(contaId)
  if (!usuario) return null
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('id')
    .eq('usuario_id', usuario)
    .eq('ativo', true)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * O apelido/id de sessão que o provedor manda → o número da nossa conta.
 *
 * Só é usado quando o webhook entrou pelo fallback global, que não distingue
 * número. O fallback deixou de ser "os dígitos do que veio": `sessionId` é um
 * identificador de sessão, e devolvê-lo gravava coisas como
 * `7553307842893651945777...` no lugar do número — 48 dígitos que nenhuma tela
 * formata e que o teto diário por número conta como se fosse mais um telefone.
 */
async function numeroDaConta(referencia: string): Promise<string | null> {
  if (!referencia) return null
  const digitos = identificadorCanonico('whatsapp', referencia)
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select('numero')
    .or(digitos ? `numero.eq.${digitos},apelido.eq.${referencia}` : `apelido.eq.${referencia}`)
    .limit(1)
    .maybeSingle()
  if (data?.numero) return data.numero
  return digitos && digitos.length >= 10 && digitos.length <= 13 ? digitos : null
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
