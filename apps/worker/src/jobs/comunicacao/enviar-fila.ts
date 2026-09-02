import {
  intervaloEntreEnvios,
  podeEnviar,
  tetoDiarioDaConta,
  exigeDescadastro,
  variaveisPendentes,
  MOTIVO_RECUSA_ENVIO_LABELS,
  type BaseLegal,
  type CanalThread,
  type FatosDoEnvio,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import type { Transporte } from '../../../../../packages/core/src/transportes/index.js'
import { lerConfigComunicacao } from '../../comunicacao/config.js'
import {
  conversaPara,
  enviadasNaThreadHoje,
  enviadasPelaContaHoje,
  escreverNoLedger,
  tocarConversa,
  ultimoToqueEm,
} from '../../comunicacao/ledger.js'
import {
  buscarConta,
  contaGmailDoUsuario,
  escolherConta,
  transporteGmail,
  transporteResend,
  transporteWhatsapp,
  type ContaWhatsapp,
} from '../../comunicacao/transportes.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * `aprovada → enviada`: o passo que faltava (§5).
 *
 * Consome `mensagens_outbox`, aplica a metade do portão que só o worker conhece
 * (janela, teto do número, warmup, intervalo entre envios), envia pelo transporte
 * e grava no ledger. Ao gravar, APAGA o texto da fila — a constraint
 * `mensagens_outbox_sem_copia_do_ledger` garante que a linha não possa carregar
 * as duas coisas.
 *
 * ─── RETRY COM BACKOFF, E A DIFERENÇA QUE ELE PRECISA ENXERGAR ──────────────
 * Três tentativas, com espera crescente. Mas só para o que é retryável: rede,
 * 429, 5xx. Um número inválido ou uma credencial revogada não melhoram com
 * insistência — insistir neles gasta a reputação da conta e adia a notificação
 * que resolveria o problema.
 *
 * ─── UMA MENSAGEM POR VEZ, COM INTERVALO ────────────────────────────────────
 * O laço é sequencial de propósito. Paralelizar por conta faria os envios saírem
 * em rajada, que é a assinatura que a detecção do provedor procura primeiro.
 */

const MAX_TENTATIVAS = 3
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface ResultadoEnvioFila {
  candidatas: number
  enviadas: number
  falhas: number
  reagendadas: number
  bloqueadas: number
}

interface LinhaFila {
  id: string
  canal: string
  destinatario: string | null
  destinatario_contato_id: string | null
  whatsapp_conta_id: string | null
  assunto: string | null
  corpo: string | null
  conversa_id: string | null
  empresa_id: string | null
  vendedor_id: string | null
  criada_por: string | null
  template_id: string | null
  origem: string
  por_ia: boolean
  funil: string | null
  funil_card_id: string | null
  tentativas: number
  agendada_para: string | null
  fornecedor_empresa_id: string | null
  campanha_id: string | null
}

const COLUNAS =
  'id, canal, destinatario, destinatario_contato_id, whatsapp_conta_id, assunto, corpo, conversa_id, empresa_id, vendedor_id, criada_por, template_id, origem, por_ia, funil, funil_card_id, tentativas, agendada_para, fornecedor_empresa_id, campanha_id'

export async function enviarFila(limite = 100): Promise<ResultadoEnvioFila> {
  const cfg = await lerConfigComunicacao(true)
  const agora = new Date()

  const { data, error } = await supabaseAdmin
    .from('mensagens_outbox')
    .select(COLUNAS)
    .eq('status', 'aprovada')
    .or(`agendada_para.is.null,agendada_para.lte.${agora.toISOString()}`)
    /*
     * O INDIVIDUAL TEM PRIORIDADE (05B §7).
     *
     * `campanha_id` nulo primeiro: o vendedor que apertou enviar às 11h não pode
     * ficar atrás de duzentos disparos. Ordenar assim é o que torna a promessa
     * verdadeira sem precisar de duas filas — e duas filas seriam dois lugares
     * contando o mesmo teto de número, que é como o warmup vira ficção.
     */
    .order('campanha_id', { ascending: true, nullsFirst: true })
    .order('criada_em', { ascending: true })
    .limit(limite)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler a fila de envio.')
    return { candidatas: 0, enviadas: 0, falhas: 0, reagendadas: 0, bloqueadas: 0 }
  }

  const fila = (data ?? []) as LinhaFila[]
  const acc: ResultadoEnvioFila = {
    candidatas: fila.length,
    enviadas: 0,
    falhas: 0,
    reagendadas: 0,
    bloqueadas: 0,
  }

  // Uma conta por vez, com o intervalo dela entre um envio e o próximo.
  let ultimaContaUsada: ContaWhatsapp | null = null

  for (const linha of fila) {
    try {
      const r = await processar(linha, cfg, new Date(), ultimaContaUsada)
      ultimaContaUsada = r.conta ?? ultimaContaUsada
      acc[r.desfecho] += 1
      if (r.desfecho === 'enviadas' && r.conta) {
        await dormir(intervaloEntreEnvios(r.conta))
      }
    } catch (erro) {
      logger.error({ id: linha.id, erro: String(erro) }, 'Falha inesperada ao processar a fila.')
      acc.falhas += 1
    }
  }

  logger.info(acc, 'Fila de comunicação processada.')
  return acc
}

interface Desfecho {
  desfecho: 'enviadas' | 'falhas' | 'reagendadas' | 'bloqueadas'
  conta?: ContaWhatsapp | null
}

async function processar(
  linha: LinhaFila,
  cfg: Awaited<ReturnType<typeof lerConfigComunicacao>>,
  agora: Date,
  _ultima: ContaWhatsapp | null,
): Promise<Desfecho> {
  const canal = linha.canal as CanalThread
  if (!linha.destinatario) {
    await marcarFalha(linha, 'Sem destinatário.')
    return { desfecho: 'falhas' }
  }

  /*
   * NENHUM `{placeholder}` ATRAVESSA DAQUI (§5).
   *
   * Quem monta o corpo é sempre outro código — compositor, régua, campanha,
   * agente — e cada um deles conhece só o pedaço do catálogo que o seu contexto
   * preenche. Uma chave que nenhum deles soube resolver sobrevive à renderização
   * de propósito, para ser vista; o que faltava era alguém enxergando-a no
   * último instante. Sem isto, "Aqui é {remetente_nome}, da ONE OS" chegou ao
   * WhatsApp de um fornecedor.
   *
   * Falha PERMANENTE, e não retry: insistir manda o mesmo texto quebrado três
   * vezes. Quem escreveu recebe a notificação com as chaves pelo nome, corrige o
   * template e reenvia.
   */
  const pendentes = variaveisPendentes(`${linha.assunto ?? ''}\n${linha.corpo ?? ''}`)
  if (pendentes.length > 0) {
    await marcarFalha(
      linha,
      `A mensagem ainda tem variáveis não preenchidas e não pode sair assim: ${pendentes
        .map((v) => `{${v}}`)
        .join(', ')}.`,
    )
    return { desfecho: 'falhas' }
  }

  const contato = await buscarContato(linha.destinatario_contato_id)
  const empresaId = linha.empresa_id ?? linha.fornecedor_empresa_id ?? contato?.empresa_id ?? null

  const conversaId =
    linha.conversa_id ??
    (await conversaPara({
      canal,
      identificador: linha.destinatario,
      empresaId,
      contatoId: linha.destinatario_contato_id,
      vendedorId: linha.vendedor_id,
    }))

  // ── A conta que envia ────────────────────────────────────────────────────
  let conta: ContaWhatsapp | null = null
  if (canal === 'whatsapp') {
    conta = linha.whatsapp_conta_id
      ? await buscarConta(linha.whatsapp_conta_id)
      : await escolherConta(linha.por_ia ? 'ia' : 'relacionamento')
    if (!conta || !conta.ativo) {
      await marcarFalha(linha, 'Nenhuma conta de WhatsApp ativa para este tipo de envio.')
      return { desfecho: 'falhas' }
    }
  }

  // ── O portão, metade do worker ───────────────────────────────────────────
  const fatos: FatosDoEnvio = {
    canal,
    tipoConta: (conta?.tipo ?? 'relacionamento') as FatosDoEnvio['tipoConta'],
    // Campanha conta como automática: o kill switch do 05A precisa alcançá-la.
    // Ele existe justamente para o momento em que alguém percebe que algo está
    // saindo errado em massa.
    automatica: linha.origem === 'agente' || linha.origem === 'campanha' || linha.por_ia,
    suprimido: await estaSuprimido(canal, linha.destinatario, empresaId),
    baseLegal: (contato?.base_legal ?? null) as BaseLegal | null,
    enviadasNaThreadHoje: conversaId ? await enviadasNaThreadHoje(conversaId, agora) : 0,
    enviadasPelaContaHoje: conta ? await enviadasPelaContaHoje(conta.numero, agora) : 0,
    tetoDaConta: conta ? tetoDiarioDaConta(conta, cfg, agora) : 0,
    ultimoToqueEm: await ultimoToqueEm(linha.destinatario_contato_id),
    agora,
    // O compositor já gravou a decisão de furar a janela em `agendada_para`; o
    // cooldown, quando furado, foi checado na transação que enfileirou. Aqui o
    // que resta é a janela e os tetos.
    forcarJanela: linha.agendada_para !== null,
  }

  // O cooldown já foi decidido no enfileiramento (que é onde a pessoa viu o
  // motivo). Reaplicá-lo aqui bloquearia a segunda mensagem de uma conversa que
  // a própria pessoa escolheu continuar.
  const vereditoCfg = { ...cfg, cooldown_dias: linha.origem === 'outbox' ? cfg.cooldown_dias : 0 }
  const veredito = podeEnviar(fatos, vereditoCfg)

  if (!veredito.pode) {
    if (veredito.motivo === 'fora_da_janela' && veredito.reagendarPara) {
      await supabaseAdmin
        .from('mensagens_outbox')
        .update({ agendada_para: veredito.reagendarPara.toISOString() })
        .eq('id', linha.id)
      return { desfecho: 'reagendadas', conta }
    }
    if (veredito.motivo === 'teto_conta' || veredito.motivo === 'teto_thread') {
      // Teto é do DIA: adia para a próxima abertura, não descarta.
      const amanha = new Date(agora.getTime() + 12 * 3_600_000)
      await supabaseAdmin
        .from('mensagens_outbox')
        .update({ agendada_para: amanha.toISOString() })
        .eq('id', linha.id)
      return { desfecho: 'reagendadas', conta }
    }
    await supabaseAdmin
      .from('mensagens_outbox')
      .update({
        status: 'descartada',
        motivo_descarte: veredito.motivo,
        erro: MOTIVO_RECUSA_ENVIO_LABELS[veredito.motivo!],
      })
      .eq('id', linha.id)
    return { desfecho: 'bloqueadas', conta }
  }

  // ── O transporte ─────────────────────────────────────────────────────────
  const { transporte, remetente, motivo } = await montarTransporte(linha, canal, conta)
  if (!transporte) {
    // O MOTIVO, não o rótulo. "Credencial ausente" mandou alguém conferir uma
    // credencial que estava certa enquanto o que faltava era uma variável de
    // ambiente do worker — a falta e o conserto ficam no mesmo texto.
    await marcarFalha(linha, motivo ?? 'Transporte indisponível.')
    return { desfecho: 'falhas', conta }
  }

  const corpo = comDescadastro(linha, canal, fatos.baseLegal)
  const emRespostaA = await ultimaThreadExterna(conversaId)

  const r = await transporte.enviar({
    destino: linha.destinatario,
    assunto: linha.assunto,
    corpo,
    emRespostaA,
  })

  if (!r.ok) {
    const tentativas = (linha.tentativas ?? 0) + 1
    const podeTentar = r.retryavel !== false && tentativas < MAX_TENTATIVAS
    await supabaseAdmin
      .from('mensagens_outbox')
      .update({
        tentativas,
        ultima_tentativa_em: agora.toISOString(),
        erro: r.erro ?? 'Falha ao enviar.',
        ...(podeTentar
          ? // Backoff: 5min, 25min. O provedor que devolveu 429 não melhora em
            // trinta segundos.
            { agendada_para: new Date(agora.getTime() + 5 * 60_000 * 5 ** (tentativas - 1)).toISOString() }
          : { status: 'falhou' }),
      })
      .eq('id', linha.id)

    if (!podeTentar) await avisarFalha(linha, r.erro ?? 'Falha ao enviar.')
    return { desfecho: 'falhas', conta }
  }

  const comunicacaoId = await escreverNoLedger({
    conversaId,
    empresaId,
    contatoId: linha.destinatario_contato_id,
    canal,
    direcao: 'saida',
    usuarioId: linha.criada_por,
    vendedorId: linha.vendedor_id,
    porIa: linha.por_ia,
    assunto: linha.assunto,
    corpo,
    provedor: transporte.nome,
    idExterno: r.idExterno,
    threadExterna: r.threadExterna,
    contaRemetente: remetente,
    statusEnvio: 'enviada',
    origem: (linha.origem as 'compositor' | 'outbox' | 'agente') ?? 'outbox',
    templateId: linha.template_id,
    funil: linha.funil,
    funilCardId: linha.funil_card_id,
    campanhaId: linha.campanha_id,
    enviadoEm: agora,
  })

  /*
   * O texto SAI da fila na mesma escrita que aponta para o ledger. A constraint
   * do banco recusaria os dois juntos, e é essa recusa que impede a outbox de
   * voltar a ser histórico.
   */
  await supabaseAdmin
    .from('mensagens_outbox')
    .update({
      status: 'enviada',
      comunicacao_id: comunicacaoId,
      // A conversa que este envio abriu (ou continuou). Sem isto a linha da fila
      // esquecia em qual thread ela caiu, e o destinatário de campanha ficava sem
      // saber para onde olhar quando a resposta chegasse.
      conversa_id: conversaId,
      corpo: null,
      assunto: null,
      erro: null,
      ultima_tentativa_em: agora.toISOString(),
    })
    .eq('id', linha.id)

  if (conversaId) {
    await tocarConversa({
      conversaId,
      direcao: 'saida',
      em: agora,
      novoStatus: 'aguardando_resposta',
    })
  }

  if (empresaId) {
    await emitirEvento(empresaId, EVENTO_TIPOS.COMUNICACAO_ENVIADA, {
      titulo: `Mensagem enviada por ${canal === 'email' ? 'e-mail' : 'WhatsApp'}`,
      resumo: (corpo ?? '').slice(0, 200),
      url: conversaId ? `/comunicacao/${conversaId}` : '/comunicacao',
      canal,
      comunicacao_id: comunicacaoId,
      conversa_id: conversaId,
      por_ia: linha.por_ia,
    })
  }

  return { desfecho: 'enviadas', conta }
}

async function montarTransporte(
  linha: LinhaFila,
  canal: CanalThread,
  conta: ContaWhatsapp | null,
): Promise<{ transporte: Transporte | null; remetente: string | null; motivo: string | null }> {
  if (canal === 'whatsapp') {
    if (!conta) return { transporte: null, remetente: null, motivo: 'Nenhuma conta de WhatsApp escolhida.' }
    const { transporte, motivo } = await transporteWhatsapp(conta)
    return { transporte, remetente: conta.numero, motivo }
  }

  /*
   * E-mail tem DOIS caminhos, e a escolha não é preferência (§3.2):
   *
   *   Gmail  — quando quem manda é uma PESSOA que conectou a caixa. A mensagem
   *            sai dela, entra na thread que o cliente já tinha e fica nos
   *            "Enviados" dela.
   *   Resend — o resto: sistema, IA, e a pessoa que não conectou o Gmail.
   *
   * A ordem importa: preferir o Resend quando há Gmail conectado quebraria a
   * thread do outro lado e faria o cliente achar que trocou de interlocutor.
   */
  if (linha.criada_por && !linha.por_ia) {
    const contaGmail = await contaGmailDoUsuario(linha.criada_por)
    if (contaGmail) {
      const { data: u } = await supabaseAdmin
        .from('usuarios')
        .select('nome')
        .eq('id', linha.criada_por)
        .maybeSingle()
      const t = await transporteGmail(contaGmail, u?.nome ?? null)
      if (t) return { transporte: t, remetente: contaGmail.endereco, motivo: null }
    }
  }

  const remetente = linha.por_ia
    ? (env.RESEND_REMETENTE_IA ?? env.RESEND_REMETENTE ?? null)
    : (env.RESEND_REMETENTE ?? null)
  if (!remetente) {
    return {
      transporte: null,
      remetente: null,
      motivo: 'Nenhum remetente de e-mail configurado (RESEND_REMETENTE) e o Gmail de quem enviou não está conectado.',
    }
  }
  const t = transporteResend(remetente)
  return {
    transporte: t,
    remetente,
    motivo: t ? null : 'RESEND_API_KEY não configurada no worker — nenhum e-mail do sistema sai sem ela.',
  }
}

/**
 * O link de descadastro é anexado AQUI, no último instante antes do envio, e não
 * no template: um template novo escrito com pressa não pode ser a diferença entre
 * uma mensagem conforme e uma que não é (§2).
 */
function comDescadastro(linha: LinhaFila, canal: CanalThread, base: BaseLegal | null): string {
  const corpo = linha.corpo ?? ''
  if (!exigeDescadastro(canal, base)) return corpo
  const url = env.APP_BASE_URL
    ? `${env.APP_BASE_URL.replace(/\/$/, '')}/descadastro/${linha.destinatario_contato_id ?? ''}`
    : null
  if (!url) return corpo
  return `${corpo}\n\n—\nNão quer mais receber e-mails nossos? ${url}`
}

/** O `Message-ID` da última mensagem da thread, para o `In-Reply-To`. */
async function ultimaThreadExterna(conversaId: string | null): Promise<string | null> {
  if (!conversaId) return null
  const { data } = await supabaseAdmin
    .from('comunicacoes')
    .select('thread_externa')
    .eq('conversa_id', conversaId)
    .not('thread_externa', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.thread_externa ?? null
}

async function buscarContato(
  id: string | null,
): Promise<{ empresa_id: string; base_legal: string | null } | null> {
  if (!id) return null
  const { data } = await supabaseAdmin
    .from('contatos')
    .select('empresa_id, base_legal')
    .eq('id', id)
    .maybeSingle()
  return data ?? null
}

async function estaSuprimido(
  canal: CanalThread,
  destinatario: string,
  empresaId: string | null,
): Promise<boolean> {
  const hoje = new Date().toISOString().slice(0, 10)
  const escopos = canal === 'email' ? ['email'] : ['whatsapp', 'telefone']

  const { data: porValor } = await supabaseAdmin
    .from('supressao')
    .select('id')
    .in('escopo', escopos)
    .eq('valor', destinatario)
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
    .limit(1)
    .maybeSingle()
  if (porValor) return true

  if (!empresaId) return false
  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    .select('cnpj')
    .eq('id', empresaId)
    .maybeSingle()
  if (!empresa?.cnpj) return false

  const { data: porEmpresa } = await supabaseAdmin
    .from('supressao')
    .select('id')
    .eq('escopo', 'empresa')
    .eq('valor', empresa.cnpj)
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
    .limit(1)
    .maybeSingle()
  return porEmpresa !== null
}

async function marcarFalha(linha: LinhaFila, motivo: string): Promise<void> {
  await supabaseAdmin
    .from('mensagens_outbox')
    .update({ status: 'falhou', erro: motivo, ultima_tentativa_em: new Date().toISOString() })
    .eq('id', linha.id)
  await avisarFalha(linha, motivo)
}

/**
 * Falha PERMANENTE avisa o dono da mensagem — não um perfil inteiro.
 *
 * Quem escreveu precisa saber que não saiu; o time comercial não precisa saber
 * que a mensagem de outra pessoa falhou. Por isso `notify()` direto e não uma
 * regra de fan-out (mesma decisão do 0143 para o advogado do processo).
 */
async function avisarFalha(linha: LinhaFila, motivo: string): Promise<void> {
  if (!linha.criada_por) return
  try {
    await notify(supabaseAdmin, [linha.criada_por], {
      titulo: 'Sua mensagem não foi enviada',
      corpo: motivo,
      url: linha.conversa_id ? `/comunicacao/${linha.conversa_id}` : '/comunicacao',
    })
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao notificar o dono da mensagem.')
  }

  if (linha.empresa_id) {
    await emitirEvento(linha.empresa_id, EVENTO_TIPOS.COMUNICACAO_FALHOU, {
      titulo: 'Falha ao enviar mensagem',
      resumo: motivo,
      url: '/comunicacao',
      outbox_id: linha.id,
    })
  }
}
