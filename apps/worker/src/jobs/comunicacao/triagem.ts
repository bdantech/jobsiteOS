import {
  PROMPT_TRIAGEM,
  PRIMEIRO_CONTATO_MOVE,
  ehOptOut,
  precisaEscalar,
  triagemSchema,
  triarPorRegra,
  type Funil,
  type Triagem,
} from '../../../../../packages/core/src/comunicacao/index.js'
import { AI_MODEL, EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * TRIAGEM (§6). Toda mensagem de entrada passa por aqui.
 *
 * ─── QUALIDADE ACIMA DE CUSTO ───────────────────────────────────────────────
 * O classificador barato do core resolve só o inequívoco (opt-out por palavra,
 * ausência automática, mídia sem texto). Todo o resto vai ao modelo. A tentação
 * inversa — regex para tudo — custa caro do jeito errado: "me chama em março"
 * classificado como recusa vira supressão, e supressão indevida é irreversível na
 * prática.
 *
 * ─── OS EFEITOS SÃO O PRODUTO, NÃO A CLASSIFICAÇÃO ──────────────────────────
 * Classificar não muda nada sozinho. O que muda é: opt-out vira supressão,
 * escalação avisa gente, e a PRIMEIRA resposta de quem nunca foi contatado move o
 * card. Esse último é o que faz o funil parar de mentir — mover o card à mão
 * depois de responder é a etapa que ninguém faz.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export interface ResultadoTriagem {
  candidatas: number
  por_regra: number
  por_modelo: number
  falhas: number
  optouts: number
  escalacoes: number
  cards_movidos: number
}

interface Pendente {
  id: string
  conversa_id: string | null
  empresa_id: string | null
  contato_id: string | null
  corpo: string | null
  canal: string
  funil: string | null
  funil_card_id: string | null
}

export async function triarEntradas(limite = 50): Promise<ResultadoTriagem> {
  const acc: ResultadoTriagem = {
    candidatas: 0,
    por_regra: 0,
    por_modelo: 0,
    falhas: 0,
    optouts: 0,
    escalacoes: 0,
    cards_movidos: 0,
  }

  const { data, error } = await supabaseAdmin
    .from('comunicacoes')
    .select('id, conversa_id, empresa_id, contato_id, corpo, canal, funil, funil_card_id')
    .eq('direcao', 'entrada')
    .is('triagem', null)
    .order('criado_em', { ascending: true })
    .limit(limite)
  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler a fila de triagem.')
    return acc
  }

  const pendentes = (data ?? []) as Pendente[]
  acc.candidatas = pendentes.length

  for (const p of pendentes) {
    try {
      const porRegra = triarPorRegra({ corpo: p.corpo })
      const triagem = porRegra ?? (await triarComModelo(p.corpo))
      if (!triagem) {
        acc.falhas += 1
        continue
      }
      if (porRegra) acc.por_regra += 1
      else acc.por_modelo += 1

      await supabaseAdmin
        .from('comunicacoes')
        .update({ triagem: triagem as never })
        .eq('id', p.id)

      const efeitos = await aplicarEfeitos(p, triagem)
      acc.optouts += efeitos.optout ? 1 : 0
      acc.escalacoes += efeitos.escalou ? 1 : 0
      acc.cards_movidos += efeitos.moveuCard ? 1 : 0
    } catch (erro) {
      logger.error({ id: p.id, erro: String(erro) }, 'Falha ao triar mensagem.')
      acc.falhas += 1
    }
  }

  logger.info(acc, 'Triagem de entradas concluída.')
  return acc
}

/**
 * O modelo devolve JSON e o zod valida. Uma resposta que não bate com o schema é
 * uma FALHA, não um "melhor esforço": gravar uma triagem parcial faria a conversa
 * parecer classificada e nunca mais voltar para a fila.
 */
async function triarComModelo(corpo: string | null): Promise<Triagem | null> {
  if (!env.ANTHROPIC_API_KEY) {
    logger.warn('ANTHROPIC_API_KEY não configurada — triagem por modelo indisponível.')
    return null
  }
  if (!corpo?.trim()) return null

  try {
    const resposta = await requisitarJson<{ content?: Array<{ type: string; text?: string }> }>(
      ANTHROPIC_URL,
      {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: {
          model: AI_MODEL,
          max_tokens: 1024,
          system: PROMPT_TRIAGEM,
          messages: [{ role: 'user', content: corpo.slice(0, 6000) }],
        },
        tentativas: 3,
        timeoutMs: 45_000,
      },
    )

    const texto = (resposta.content ?? []).find((c) => c.type === 'text')?.text ?? ''
    const json = texto.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null

    const r = triagemSchema.safeParse({ ...JSON.parse(json), fonte: 'modelo' })
    if (!r.success) {
      logger.warn({ erros: r.error.issues.length }, 'Triagem do modelo não bateu com o schema.')
      return null
    }
    return r.data
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao chamar o modelo para triagem.')
    return null
  }
}

interface Efeitos {
  optout: boolean
  escalou: boolean
  moveuCard: boolean
}

async function aplicarEfeitos(p: Pendente, triagem: Triagem): Promise<Efeitos> {
  const efeitos: Efeitos = { optout: false, escalou: false, moveuCard: false }

  if (ehOptOut(triagem, p.corpo)) {
    efeitos.optout = await registrarOptOut(p)
  }

  const esc = precisaEscalar(triagem, p.corpo)
  if (esc.escalar) {
    efeitos.escalou = await escalar(p, esc.motivo ?? 'Escalado pela triagem.')
  }

  if (p.conversa_id) {
    await supabaseAdmin
      .from('conversas')
      .update({ status: 'ativa' })
      .eq('id', p.conversa_id)
      .eq('status', 'aguardando_resposta')
  }

  efeitos.moveuCard = await moverPrimeiroContato(p)
  return efeitos
}

/**
 * Opt-out suprime o CANAL daquela pessoa, não a empresa inteira: quem pediu para
 * parar foi ela, e suprimir o CNPJ apagaria a conversa com o financeiro porque o
 * comprador se irritou.
 */
async function registrarOptOut(p: Pendente): Promise<boolean> {
  if (!p.conversa_id) return false

  const { data: conversa } = await supabaseAdmin
    .from('conversas')
    .select('canal, identificador_externo, responsavel_vendedor_id')
    .eq('id', p.conversa_id)
    .maybeSingle()
  if (!conversa) return false

  await supabaseAdmin.from('supressao').upsert(
    {
      escopo: conversa.canal === 'email' ? 'email' : 'whatsapp',
      valor: conversa.identificador_externo,
      motivo: 'descadastro',
      observacao: 'Pedido explícito na conversa.',
      contexto: 'geral',
    },
    { onConflict: 'escopo,valor', ignoreDuplicates: true },
  )

  await supabaseAdmin
    .from('conversas')
    .update({ status: 'encerrada', modo_agente: 'desligado', proxima_acao_em: null })
    .eq('id', p.conversa_id)

  await emitirEvento(p.empresa_id, EVENTO_TIPOS.OPTOUT_REGISTRADO, {
    titulo: 'Pedido de descadastro',
    resumo: `${conversa.identificador_externo} pediu para não receber mais mensagens.`,
    url: `/comunicacao/${p.conversa_id}`,
    canal: conversa.canal,
  })

  await avisarDono(conversa.responsavel_vendedor_id, {
    titulo: 'Pedido de descadastro',
    corpo: `${conversa.identificador_externo} pediu para parar. Já suprimido.`,
    url: `/comunicacao/${p.conversa_id}`,
  })
  return true
}

async function escalar(p: Pendente, motivo: string): Promise<boolean> {
  if (!p.conversa_id) return false

  const { data: conversa } = await supabaseAdmin
    .from('conversas')
    .select('responsavel_vendedor_id, modo_agente')
    .eq('id', p.conversa_id)
    .maybeSingle()

  // Escalar DESLIGA o autônomo naquela thread. Deixá-lo ligado faria o agente
  // responder por cima da pessoa que acabou de ser chamada para assumir.
  if (conversa?.modo_agente === 'autonomo') {
    await supabaseAdmin.from('conversas').update({ modo_agente: 'sugestao' }).eq('id', p.conversa_id)
  }

  await emitirEvento(p.empresa_id, EVENTO_TIPOS.AGENTE_ESCALOU, {
    titulo: 'Conversa escalada para humano',
    resumo: motivo,
    url: `/comunicacao/${p.conversa_id}`,
    conversa_id: p.conversa_id,
  })

  await avisarDono(conversa?.responsavel_vendedor_id ?? null, {
    titulo: 'Uma conversa precisa de você',
    corpo: motivo,
    url: `/comunicacao/${p.conversa_id}`,
  })
  return true
}

/**
 * A PRIMEIRA resposta move o card de "nunca contatado" para "contatado", em todos
 * os funis que tenham esse estágio.
 *
 * Vale para o card de onde a mensagem partiu (`funil`/`funil_card_id`) — o vínculo
 * é do ledger, e é por isso que ele existe. Sem esse efeito, o funil segue
 * dizendo que ninguém falou com uma pessoa que já respondeu.
 */
async function moverPrimeiroContato(p: Pendente): Promise<boolean> {
  if (!p.funil || !p.funil_card_id) return false
  const regra = PRIMEIRO_CONTATO_MOVE[p.funil as Funil]
  if (!regra) return false

  const chave =
    regra.tabela === 'fornecedores_funil'
      ? 'fornecedor_cnpj'
      : regra.tabela === 'notas_fiscais'
        ? 'access_key'
        : 'id'

  const { data, error } = await supabaseAdmin
    .from(regra.tabela as 'fornecedores_funil')
    .update({ [regra.coluna]: regra.para } as never)
    .eq(chave as 'fornecedor_cnpj', p.funil_card_id)
    .eq(regra.coluna as 'estagio', regra.de)
    .select('fornecedor_cnpj')
  if (error) {
    logger.warn({ funil: p.funil, erro: error.message }, 'Não foi possível mover o card no primeiro contato.')
    return false
  }
  return (data ?? []).length > 0
}

async function avisarDono(
  vendedorId: string | null,
  payload: { titulo: string; corpo: string; url: string },
): Promise<void> {
  if (!vendedorId) return
  const { data } = await supabaseAdmin
    .from('vendedores')
    .select('usuario_id')
    .eq('id', vendedorId)
    .maybeSingle()
  if (!data?.usuario_id) return
  try {
    await notify(supabaseAdmin, [data.usuario_id], payload)
  } catch (erro) {
    logger.error({ erro: String(erro) }, 'Falha ao notificar o dono da conversa.')
  }
}
