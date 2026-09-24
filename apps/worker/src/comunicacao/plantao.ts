import { paraE164Brasil } from '../../../../packages/core/src/comunicacao/index.js'
import { TransporteWasender } from '../../../../packages/core/src/transportes/index.js'
import { supabaseAdmin } from '../db.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import { lerConfigComunicacao } from './config.js'
import { escreverNoLedger } from './ledger.js'
import { lerSegredo } from './vault.js'

/**
 * PLANTÃO INTERNO (§1.5): transporte SEPARADO.
 *
 * Alerta crítico para a equipe não passa por warmup, supressão, janela nem teto —
 * e a separação é a razão de este arquivo existir em vez de uma flag no envio
 * normal. Um orçamento estourado às 23h de um sábado é exatamente o alerta que
 * precisa sair às 23h de um sábado; uma flag num caminho compartilhado é uma
 * condição que alguém vai remover por engano no primeiro refactor do portão.
 *
 * A conta é OUTRA, e é escolhida por `tipo = 'plantao'` (ou pelo
 * `PLANTAO_WHATSAPP_CONTA_ID`). Mandar alerta interno pelo número de
 * relacionamento gastaria o teto de mercado com mensagem que não é de mercado.
 *
 * As mensagens são gravadas no ledger com `canal = 'interno'`: elas ficam fora do
 * painel de atividade (a view filtra) e fora de qualquer thread de cliente.
 */

export interface ResultadoPlantao {
  destinatarios: number
  enviadas: number
  falhas: number
}

export async function avisarPlantao(args: {
  titulo: string
  corpo: string
  /** Perfis que recebem. Vazio = os configurados em `plantao.perfis`. */
  perfis?: string[]
}): Promise<ResultadoPlantao> {
  const acc: ResultadoPlantao = { destinatarios: 0, enviadas: 0, falhas: 0 }
  const cfg = await lerConfigComunicacao()

  const conta = await contaDePlantao()
  if (!conta) {
    logger.warn('Nenhuma conta de plantão configurada — alerta interno não sai por WhatsApp.')
    return acc
  }

  const token = await lerSegredo(conta.token_secret_id)
  if (!token || !env.WASENDER_BASE_URL) {
    logger.warn('Conta de plantão sem token ou sem base URL — alerta interno não sai.')
    return acc
  }

  const numeros = await numerosDoPlantao(args.perfis ?? cfg.plantao.perfis)
  acc.destinatarios = numeros.length
  if (numeros.length === 0) return acc

  const transporte = new TransporteWasender({
    baseUrl: env.WASENDER_BASE_URL,
    token,
    numero: conta.numero,
  })
  const texto = `🔔 ${args.titulo}\n\n${args.corpo}`

  for (const n of numeros) {
    const r = await transporte.enviar({ destino: n.numero, corpo: texto })
    if (r.ok) acc.enviadas += 1
    else acc.falhas += 1

    await escreverNoLedger({
      conversaId: null,
      empresaId: null,
      contatoId: null,
      canal: 'interno',
      direcao: 'saida',
      usuarioId: n.usuarioId,
      corpo: texto,
      provedor: 'wasender',
      idExterno: r.idExterno,
      contaRemetente: conta.numero,
      statusEnvio: r.ok ? 'enviada' : 'falhou',
      erro: r.erro,
      origem: 'sistema',
      enviadoEm: new Date(),
    })
  }

  return acc
}

async function contaDePlantao(): Promise<{
  id: string
  numero: string
  token_secret_id: string | null
} | null> {
  const colunas = 'id, numero, token_secret_id'
  if (env.PLANTAO_WHATSAPP_CONTA_ID) {
    const { data } = await supabaseAdmin
      .from('whatsapp_contas')
      .select(colunas)
      .eq('id', env.PLANTAO_WHATSAPP_CONTA_ID)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await supabaseAdmin
    .from('whatsapp_contas')
    .select(colunas)
    .eq('tipo', 'plantao')
    .eq('ativo', true)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

/**
 * O WhatsApp de quem está de plantão vem do `contatos` da própria pessoa? Não: um
 * usuário do sistema não é um contato de empresa. Vem de
 * `usuarios.prefs_notificacoes.whatsapp`, que é configurável por perfil em
 * settings — e que só o service role lê (coluna sem grant, 0005).
 */
async function numerosDoPlantao(perfis: string[]): Promise<{ numero: string; usuarioId: string }[]> {
  if (perfis.length === 0) return []

  const { data: ps } = await supabaseAdmin.from('perfis').select('id').in('nome', perfis)
  if (!ps?.length) return []

  const { data: us } = await supabaseAdmin
    .from('usuarios')
    .select('id, prefs_notificacoes')
    .in(
      'perfil_id',
      ps.map((p) => p.id),
    )
    .eq('ativo', true)

  const saida: { numero: string; usuarioId: string }[] = []
  for (const u of us ?? []) {
    const prefs = (u.prefs_notificacoes ?? {}) as { whatsapp?: string; plantao?: boolean }
    if (prefs.plantao === false) continue
    const numero = paraE164Brasil(prefs.whatsapp)
    if (numero) saida.push({ numero, usuarioId: u.id })
  }
  return saida
}

/**
 * A varredura que liga os eventos críticos ao plantão. Roda de hora em hora.
 *
 * ─── CADA EVENTO SAI UMA VEZ ────────────────────────────────────────────────
 * Olhava 65 minutos a cada 60, sem registro do que já tinha ido: o evento que
 * caía nos 5 minutos de sobra saía duas vezes. Agora a janela é de três horas —
 * cobre uma rodada perdida — e cada evento é REIVINDICADO em `plantao_enviados`
 * antes do envio (0264): quem insere manda, quem esbarra na chave pula. Um
 * alerta de seis horas atrás continua não sendo plantão.
 *
 * A reivindicação vem depois de saber que há por onde mandar: sem conta de
 * plantão ou sem ninguém com número, marcar o evento como enviado o esconderia
 * de quem configurar o plantão na hora seguinte.
 */
export async function plantaoDeEventos(agora = new Date()): Promise<ResultadoPlantao> {
  const acc: ResultadoPlantao = { destinatarios: 0, enviadas: 0, falhas: 0 }
  const cfg = await lerConfigComunicacao()
  const conta = await contaDePlantao()
  if (!conta || !env.WASENDER_BASE_URL || !(await lerSegredo(conta.token_secret_id))) return acc
  if ((await numerosDoPlantao(cfg.plantao.perfis)).length === 0) return acc

  const desde = new Date(agora.getTime() - 3 * 60 * 60_000)
  const { data } = await supabaseAdmin
    .from('empresa_eventos')
    .select('id, tipo, empresa_id, payload, criado_em')
    .in('tipo', cfg.plantao.eventos)
    .gte('criado_em', desde.toISOString())
    .order('criado_em', { ascending: true })
    .limit(50)

  for (const ev of data ?? []) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    // A decisão do aceite reusa o tipo do pedido (ver `fanout_evento_para_notificacoes`).
    // O plantão é do pedido que espera alguém; a decisão já foi tomada.
    if (ev.tipo === 'sdr.aceite_pendente' && 'decisao' in payload) continue

    const { data: reivindicado } = await supabaseAdmin
      .from('plantao_enviados')
      .upsert({ evento_id: ev.id }, { onConflict: 'evento_id', ignoreDuplicates: true })
      .select('evento_id')
    if (!reivindicado?.length) continue

    const texto = await textoDoAviso(ev.tipo, ev.empresa_id, payload)
    const r = await avisarPlantao({ titulo: texto.titulo, corpo: texto.corpo ?? 'Sem detalhes.' })
    acc.destinatarios = Math.max(acc.destinatarios, r.destinatarios)
    acc.enviadas += r.enviadas
    acc.falhas += r.falhas
  }
  return acc
}

/**
 * O texto do evento pela régua do sino (0264): modelo do painel, senão o do
 * evento, senão "Empresa — nome do tipo". Era `titulo ?? tipo`, e o aceite
 * pendente, que nasce em SQL sem título, chegava como "sdr.aceite_pendente".
 */
async function textoDoAviso(
  tipo: string,
  empresaId: string | null,
  payload: Record<string, unknown>,
): Promise<{ titulo: string; corpo: string | null }> {
  const { data, error } = await supabaseAdmin.rpc('notificacao_texto', {
    p_tipo: tipo,
    p_empresa_id: empresaId ?? undefined,
    p_payload: payload as never,
  })
  const texto = data as { titulo?: string | null; corpo?: string | null } | null
  if (error || !texto?.titulo) {
    const p = payload as { titulo?: string; resumo?: string }
    return { titulo: p.titulo ?? tipo, corpo: p.resumo ?? null }
  }
  return { titulo: texto.titulo, corpo: texto.corpo ?? null }
}
