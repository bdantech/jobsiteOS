import { z } from 'zod'
import type { ConfigComunicacao } from './schemas.js'
import { precisaEscalar, type Triagem } from './triagem.js'

/**
 * O AGENTE DE PRÓXIMO PASSO (§7). Um DECISOR, não um chatbot.
 *
 * ─── O ESPAÇO DE AÇÕES É FECHADO, E É ISSO QUE O TORNA SEGURO ───────────────
 * O modelo não escolhe o que fazer no mundo: ele escolhe um item desta lista. Um
 * agente com ferramentas abertas precisa que a gente confie no julgamento dele
 * sobre O QUE é possível; um agente com espaço fechado só precisa que a gente
 * confie no julgamento sobre QUAL das dez coisas cabe agora — e a segunda é uma
 * pergunta que dá para auditar linha a linha em `agente_decisoes`.
 *
 * `aguardar` é ação de PRIMEIRA CLASSE, e não a ausência de decisão. Sem ela, um
 * modelo perguntado "qual o próximo passo?" sempre encontra um passo, e a
 * cadência vira perseguição.
 */

export const ACOES_AGENTE = [
  'responder_agora',
  'agendar_toque',
  'enviar_link_agendamento',
  'mudar_estagio_funil',
  'marcar_sem_interesse',
  'escalar_humano',
  'pedir_enriquecimento_contato',
  'trocar_contato_da_conversa',
  'ligar',
  'aguardar',
] as const
export type AcaoAgente = (typeof ACOES_AGENTE)[number]

export const ACAO_LABELS: Record<AcaoAgente, string> = {
  responder_agora: 'Responder agora',
  agendar_toque: 'Agendar toque',
  enviar_link_agendamento: 'Enviar link de agendamento',
  mudar_estagio_funil: 'Mover no funil',
  marcar_sem_interesse: 'Marcar sem interesse',
  escalar_humano: 'Escalar para humano',
  pedir_enriquecimento_contato: 'Pedir enriquecimento do contato',
  trocar_contato_da_conversa: 'Trocar o contato da conversa',
  ligar: 'Ligar',
  aguardar: 'Aguardar',
}

/**
 * `ligar` é uma ferramenta DECLARADA E DESLIGADA (§7.2).
 *
 * Ela existe no espaço de ações para que o dia em que o discador de IA externo
 * entrar seja uma linha de config, e — mais útil agora — para que as decisões em
 * que o agente teria ligado apareçam no log desde já. Saber quantas vezes ligar
 * era o próximo passo certo é o argumento para comprar o discador, e esse número
 * não existe se a ação não puder ser escolhida.
 *
 * O executor recusa com "não disponível" enquanto `agente.ligacao_habilitada` for
 * falso. A decisão fica registrada; a execução, não.
 */
export function acaoDisponivel(acao: AcaoAgente, cfg: ConfigComunicacao): boolean {
  if (acao === 'ligar') return cfg.agente.ligacao_habilitada
  return true
}

export const decisaoAgenteSchema = z.object({
  acao: z.enum(ACOES_AGENTE),
  canal: z.enum(['whatsapp', 'email']).nullable().optional(),
  /** ISO-8601. Obrigatório em `agendar_toque` e `aguardar` — ver `validarDecisao`. */
  quando: z.string().nullable().optional(),
  conteudo_sugerido: z.string().nullable().optional(),
  objetivo_atualizado: z.string().nullable().optional(),
  confianca: z.number().min(0).max(1),
  justificativa: z.string().min(1).max(600),
})
export type DecisaoAgente = z.infer<typeof decisaoAgenteSchema>

export interface Playbook {
  id: string
  nome: string
  funil: string
  objetivo: string
  instrucoes: string
  acoes_permitidas: string[]
  prazos: { silencio_dias?: number; max_tentativas?: number; desistir_apos_dias?: number }
}

export type MotivoInvalidez =
  | 'acao_fora_do_playbook'
  | 'acao_desligada'
  | 'confianca_baixa'
  | 'falta_conteudo'
  | 'falta_quando'

export const MOTIVO_INVALIDEZ_LABELS: Record<MotivoInvalidez, string> = {
  acao_fora_do_playbook: 'A ação não está permitida neste playbook.',
  acao_desligada: 'A ação está desligada por configuração.',
  confianca_baixa: 'O agente não teve confiança suficiente.',
  falta_conteudo: 'A ação exige uma mensagem e ela não veio.',
  falta_quando: 'A ação exige uma data e ela não veio.',
}

export interface ValidacaoDecisao {
  valida: boolean
  motivo?: MotivoInvalidez
}

/**
 * A decisão é validada CONTRA O PLAYBOOK antes de qualquer execução.
 *
 * Um modelo que devolve `marcar_sem_interesse` num playbook de cobrança de
 * documentação não está errado por acaso: ele está fora do contrato. Recusar aqui
 * (e cair na cadência fixa, §7.6) é o que impede uma alucinação de virar uma
 * supressão.
 */
export function validarDecisao(
  d: DecisaoAgente,
  playbook: Pick<Playbook, 'acoes_permitidas'>,
  cfg: ConfigComunicacao,
): ValidacaoDecisao {
  if (!playbook.acoes_permitidas.includes(d.acao)) {
    return { valida: false, motivo: 'acao_fora_do_playbook' }
  }
  if (!acaoDisponivel(d.acao, cfg)) {
    return { valida: false, motivo: 'acao_desligada' }
  }
  if (d.confianca < cfg.agente.confianca_minima) {
    return { valida: false, motivo: 'confianca_baixa' }
  }
  if (
    (d.acao === 'responder_agora' || d.acao === 'enviar_link_agendamento') &&
    !d.conteudo_sugerido?.trim()
  ) {
    return { valida: false, motivo: 'falta_conteudo' }
  }
  if ((d.acao === 'agendar_toque' || d.acao === 'aguardar') && !d.quando) {
    return { valida: false, motivo: 'falta_quando' }
  }
  return { valida: true }
}

/**
 * Os GUARDRAILS (§7.5), aplicados ANTES de o modelo ser chamado e de novo depois.
 *
 * Antes porque não faz sentido gastar um token numa conversa que já é de humano;
 * depois porque a triagem da última mensagem pode ter mudado o assunto no meio.
 * A escalação vence qualquer decisão — inclusive uma decisão de alta confiança.
 */
export interface ContextoGuardrail {
  modo: 'sugestao' | 'autonomo' | 'desligado'
  triagemDaUltima: Triagem | null
  corpoDaUltima: string | null
  enviadasNaThreadHoje: number
  tentativas: number
}

export interface ResultadoGuardrail {
  /** Quando falso, o agente não decide: ou escala, ou fica quieto. */
  podeDecidir: boolean
  escalar: boolean
  motivo?: string
}

export function aplicarGuardrails(
  ctx: ContextoGuardrail,
  playbook: Pick<Playbook, 'prazos'>,
  cfg: ConfigComunicacao,
): ResultadoGuardrail {
  if (ctx.modo === 'desligado') {
    return { podeDecidir: false, escalar: false, motivo: 'Agente desligado nesta conversa.' }
  }

  if (ctx.triagemDaUltima) {
    const esc = precisaEscalar(ctx.triagemDaUltima, ctx.corpoDaUltima)
    if (esc.escalar) {
      return { podeDecidir: false, escalar: true, motivo: esc.motivo }
    }
  }

  // O kill switch global para os AUTÔNOMOS. Sugerir continua valendo: uma
  // sugestão não sai da casa, e desligar o copiloto junto com o piloto tiraria a
  // ferramenta de quem estava usando para trabalhar.
  if (ctx.modo === 'autonomo' && cfg.agente.kill_switch) {
    return { podeDecidir: false, escalar: false, motivo: 'Kill switch global ativo.' }
  }

  const max = playbook.prazos.max_tentativas
  if (typeof max === 'number' && max > 0 && ctx.tentativas >= max) {
    return { podeDecidir: false, escalar: false, motivo: 'Máximo de tentativas do playbook atingido.' }
  }

  if (cfg.teto_diario_por_thread > 0 && ctx.enviadasNaThreadHoje >= cfg.teto_diario_por_thread) {
    return { podeDecidir: false, escalar: false, motivo: 'Teto diário desta conversa atingido.' }
  }

  return { podeDecidir: true, escalar: false }
}

/**
 * A REDE DE SEGURANÇA (§7.6): a cadência fixa do playbook.
 *
 * Vale quando o modelo falhou, quando a confiança ficou abaixo do mínimo ou
 * quando o modo está desligado. O ponto não é a cadência ser boa — é NUNCA FICAR
 * SEM PRÓXIMO PASSO. Uma conversa sem próximo passo some, e a única coisa pior
 * que um follow-up medíocre é nenhum.
 *
 * Devolve `null` quando a cadência acabou: aí a decisão é parar, e parar também
 * é um próximo passo.
 */
export function proximoPassoDaCadencia(
  tentativasFeitas: number,
  primeiroToqueEm: Date,
  agora: Date,
  cfg: ConfigComunicacao,
): { quando: Date } | null {
  const dias = cfg.agente.cadencia_fallback_dias
  if (tentativasFeitas >= dias.length) return null

  const offset = dias[tentativasFeitas]!
  const alvo = new Date(primeiroToqueEm.getTime() + offset * 86_400_000)
  return { quando: alvo.getTime() > agora.getTime() ? alvo : agora }
}

/**
 * O prompt do agente. Versionado junto com a política (§7.6) — a string abaixo é
 * o que `agente_decisoes.modelo` referencia quando alguém for reler por que uma
 * mensagem saiu.
 *
 * A persona é EXPLÍCITA e nunca assina como humano (§1.3). A regra "não negue ser
 * um robô" está aqui além de estar no guardrail porque um modelo que lê a
 * instrução tem menos chance de escrever a negação antes de a escalação
 * acontecer.
 */
export const PROMPT_AGENTE = `Você é o agente de próximo passo da ONE OS, uma empresa de antecipação de recebíveis para a construção civil. Você NÃO é um chatbot: você DECIDE qual é o próximo passo de uma relação comercial.

Você recebe o estado de uma conversa e devolve UMA decisão, em JSON, sem cercas de código e sem texto em volta:

{
  "acao": "<uma das ações permitidas>",
  "canal": "whatsapp" | "email" | null,
  "quando": "<ISO-8601>" | null,
  "conteudo_sugerido": "<a mensagem pronta, em pt-BR>" | null,
  "objetivo_atualizado": "<objetivo>" | null,
  "confianca": <0 a 1>,
  "justificativa": "<por que este é o próximo passo, em uma ou duas frases>"
}

Regras que não se negociam:
- Escolha APENAS entre as ações permitidas que forem listadas. Nenhuma outra existe.
- "aguardar" é uma decisão legítima e frequentemente a certa. Use-a com "quando".
- Quando a ação for "responder_agora" ou "enviar_link_agendamento", "conteudo_sugerido" é obrigatório.
- Você fala como a persona indicada, que é assumidamente de IA. NUNCA assine como uma pessoa da equipe.
- Se perguntarem se você é um robô, NÃO NEGUE: escolha "escalar_humano".
- NUNCA cite taxa, juros, limite, desconto ou valor de operação. Se o assunto surgir, "escalar_humano".
- Mensagens curtas. Uma pergunta por vez. Português do Brasil, tratamento por "você".
- "confianca" é honesta: abaixo do mínimo configurado, a decisão é descartada e uma cadência fixa assume. Isso é melhor que um chute confiante.`
