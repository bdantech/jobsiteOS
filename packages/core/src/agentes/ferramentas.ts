import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  MOTIVOS_ENCERRAMENTO,
  OBJETIVOS_LIGACAO,
  TIPOS_MANDATO,
  planoSchema,
  type PrecosAgentes,
  type VersaoVoz,
} from './schemas.js'

/**
 * O CATÁLOGO DE FERRAMENTAS DO AGENTE (Prompt 09 §6.1).
 *
 * ─── DE "ESCOLHER UMA DE DEZ AÇÕES" PARA UM LOOP REAL ───────────────────────
 * O agente de conversa escolhia um item de uma lista fechada. O de mandato CHAMA
 * ferramentas: cada chamada é executada, o resultado volta, e ele decide o próximo passo.
 * É o que permite encadear "buscar contato no Apollo → registrar → ligar" num mesmo ciclo.
 *
 * ─── O QUE NÃO PODE FAZER, NÃO APARECE ──────────────────────────────────────
 * Cada ferramenta declara custo, se muta estado e se exige orçamento. Ferramenta paga com
 * orçamento insuficiente NÃO É DESCRITA ao modelo naquele ciclo (§6.1): um modelo que vê
 * `ligar` planeja ligar, e descobrir no meio do plano que não pode é um ciclo perdido e
 * um plano errado gravado. A mesma regra vale para cota esgotada e para o que o playbook
 * não permite.
 *
 * ─── NENHUM NO-OP ───────────────────────────────────────────────────────────
 * "Ferramentas que hoje são no-op precisam funcionar ou sair da lista." Todas estas têm
 * efeito real no executor do worker (`jobs/agentes/executor.ts`). Um agente que acha que
 * agiu e não agiu é pior que um agente que não age.
 */

export const IDS_FERRAMENTAS = [
  'consultar_empresa',
  'consultar_historico',
  'consultar_contatos',
  'listar_materiais',
  'buscar_contatos_apollo',
  'enriquecer_telefone',
  'buscar_dominio_empresa',
  'registrar_contato',
  'atualizar_contato',
  'enviar_whatsapp',
  'enviar_email',
  'enviar_material',
  'ligar',
  'agendar_ligacao',
  'consultar_agenda_closer',
  'agendar_reuniao',
  'mover_estagio_funil',
  'propor_mandato',
  'escalar_humano',
  'encerrar_mandato',
  'atualizar_plano',
] as const
export type IdFerramenta = (typeof IDS_FERRAMENTAS)[number]

/** Canal que a ferramenta consome — é o que as cotas diárias contam. */
export type CanalDaFerramenta = 'whatsapp' | 'email' | 'ligacao' | null

export interface Ferramenta<I = unknown> {
  id: IdFerramenta
  /** pt-BR, para o feed Ao vivo. */
  rotulo: string
  /** Escrita PARA O MODELO. */
  descricao: string
  inputSchema: z.ZodType<I>
  muta: boolean
  requerOrcamento: boolean
  canal: CanalDaFerramenta
  /** Encerra o ciclo depois de executada (o mandato saiu das mãos do agente). */
  terminal?: boolean
}

const uuid = z.string().uuid()
const contatoId = uuid.describe('O id do contato (de consultar_contatos ou registrar_contato).')

const def = <I>(f: Ferramenta<I>): Ferramenta<I> => f

export const FERRAMENTAS = {
  consultar_empresa: def({
    id: 'consultar_empresa',
    rotulo: 'Consultou a empresa',
    descricao:
      'Dados da empresa do mandato: razão social, porte, UF, estágio, domínio e o resumo de crédito (se houver). Grátis.',
    inputSchema: z.object({}),
    muta: false,
    requerOrcamento: false,
    canal: null,
  }),
  consultar_historico: def({
    id: 'consultar_historico',
    rotulo: 'Leu o histórico',
    descricao:
      'Mensagens e ligações de TODAS as conversas do mandato, mais recentes primeiro (o contexto já traz as últimas 30). Use `antes_de` para paginar. Grátis.',
    inputSchema: z.object({
      limite: z.number().int().min(1).max(50).default(20),
      antes_de: z.string().nullable().optional().describe('ISO-8601: traz mensagens anteriores a este instante.'),
    }),
    muta: false,
    requerOrcamento: false,
    canal: null,
  }),
  consultar_contatos: def({
    id: 'consultar_contatos',
    rotulo: 'Consultou os contatos',
    descricao:
      'Contatos conhecidos da empresa, com cargo, telefone/e-mail disponíveis, base legal e quantas vezes já foram tentados neste mandato (com o último resultado). Grátis.',
    inputSchema: z.object({}),
    muta: false,
    requerOrcamento: false,
    canal: null,
  }),
  listar_materiais: def({
    id: 'listar_materiais',
    rotulo: 'Consultou os materiais',
    descricao:
      'O catálogo da biblioteca de materiais: nome, descrição, QUANDO USAR e canais. Escolha pelo "quando usar". Grátis.',
    inputSchema: z.object({ canal: z.enum(['whatsapp', 'email']).nullable().optional() }),
    muta: false,
    requerOrcamento: false,
    canal: null,
  }),
  buscar_contatos_apollo: def({
    id: 'buscar_contatos_apollo',
    rotulo: 'Buscou contatos no Apollo',
    descricao:
      'PAGO. Busca pessoas da empresa no Apollo pelo domínio e grava as que casarem com os cargos pedidos (ex.: ["financeiro", "controller", "sócio"]). Exige domínio resolvido — use buscar_dominio_empresa antes se não houver.',
    inputSchema: z.object({ cargos: z.array(z.string().min(2).max(40)).min(1).max(6) }),
    muta: true,
    requerOrcamento: true,
    canal: null,
  }),
  enriquecer_telefone: def({
    id: 'enriquecer_telefone',
    rotulo: 'Enriqueceu telefones',
    descricao:
      'PAGO. Consulta a Nova Vida pelo CNPJ da empresa e grava telefones (com marca de Procon e WhatsApp). Use quando nenhum contato conhecido tem telefone bom.',
    inputSchema: z.object({}),
    muta: true,
    requerOrcamento: true,
    canal: null,
  }),
  buscar_dominio_empresa: def({
    id: 'buscar_dominio_empresa',
    rotulo: 'Buscou o domínio',
    descricao: 'Custo baixo. Resolve o domínio do site da empresa (heurística + busca web). Pré-requisito do Apollo.',
    inputSchema: z.object({}),
    muta: true,
    requerOrcamento: true,
    canal: null,
  }),
  registrar_contato: def({
    id: 'registrar_contato',
    rotulo: 'Registrou um contato',
    descricao:
      'Grava um contato novo da empresa — inclusive o indicado numa conversa ou ligação ("fala com o Carlos do financeiro, 11 9…"). A `evidencia` é o trecho que justifica (vira a base legal de indicação). Grátis.',
    inputSchema: z
      .object({
        nome: z.string().min(2).max(120),
        cargo: z.string().max(120).nullable().optional(),
        telefone: z.string().max(40).nullable().optional(),
        email: z.string().email().max(200).nullable().optional(),
        evidencia: z.string().min(5).max(500),
      })
      .refine((c) => !!c.telefone || !!c.email, { message: 'Informe telefone ou e-mail.' }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  atualizar_contato: def({
    id: 'atualizar_contato',
    rotulo: 'Atualizou um contato',
    descricao: 'Corrige cargo/telefone/e-mail de um contato, ou marca que ele NÃO é o decisor (nunca suprime). Grátis.',
    inputSchema: z.object({
      contato_id: contatoId,
      cargo: z.string().max(120).nullable().optional(),
      telefone: z.string().max(40).nullable().optional(),
      email: z.string().email().max(200).nullable().optional(),
      nao_e_o_decisor: z.boolean().nullable().optional(),
    }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  enviar_whatsapp: def({
    id: 'enviar_whatsapp',
    rotulo: 'Enviou WhatsApp',
    descricao:
      'Envia uma mensagem de WhatsApp pela SUA linha. Curta, uma pergunta por vez. Passa pela supressão, janela de envio e cooldown — se recusar, o resultado diz por quê.',
    inputSchema: z.object({ contato_id: contatoId, texto: z.string().min(1).max(1500) }),
    muta: true,
    requerOrcamento: true,
    canal: 'whatsapp',
  }),
  enviar_email: def({
    id: 'enviar_email',
    rotulo: 'Enviou e-mail',
    descricao: 'Envia um e-mail pela SUA caixa, com a sua assinatura. Passa pela supressão, janela e cooldown.',
    inputSchema: z.object({
      contato_id: contatoId,
      assunto: z.string().min(3).max(160),
      texto: z.string().min(1).max(6000),
    }),
    muta: true,
    requerOrcamento: true,
    canal: 'email',
  }),
  enviar_material: def({
    id: 'enviar_material',
    rotulo: 'Enviou material',
    descricao: 'Envia um material da biblioteca (PDF, imagem, link ou texto) por WhatsApp ou e-mail, com uma frase de contexto.',
    inputSchema: z.object({
      contato_id: contatoId,
      material_id: uuid,
      canal: z.enum(['whatsapp', 'email']),
      texto: z.string().max(1500).nullable().optional(),
    }),
    muta: true,
    requerOrcamento: true,
    canal: null,
  }),
  ligar: def({
    id: 'ligar',
    rotulo: 'Pediu uma ligação',
    descricao:
      'PAGO. Põe uma ligação da Ana na fila (ela liga em horário comercial e o resultado volta sozinho). `objetivo` diz o que a ligação quer. Hoje só `ofertar_antecipacao` com NF é garantido; os demais dependem da versão da Ana e podem voltar recusados — aí use outro canal.',
    inputSchema: z.object({
      contato_id: contatoId,
      objetivo: z.enum(OBJETIVOS_LIGACAO),
      motivo: z.string().min(5).max(500).describe('Briefing para a Ana: por que está ligando, em português.'),
    }),
    muta: true,
    requerOrcamento: true,
    canal: 'ligacao',
  }),
  agendar_ligacao: def({
    id: 'agendar_ligacao',
    rotulo: 'Agendou uma ligação',
    descricao:
      'Marca uma ligação para o futuro (o horário que a pessoa indicou, por exemplo). No horário, o ciclo acorda e você decide ligar. Grátis.',
    inputSchema: z.object({
      contato_id: contatoId,
      quando: z.string().describe('ISO-8601 com fuso.'),
      motivo: z.string().min(3).max(300),
    }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  consultar_agenda_closer: def({
    id: 'consultar_agenda_closer',
    rotulo: 'Consultou a agenda do closer',
    descricao:
      'Janelas LIVRES do closer designado (ou do substituto) dentro do horizonte, já com duração, intervalo e horário comercial. As janelas devolvidas ficam RESERVADAS por alguns minutos para você oferecer. Nunca ofereça horário fora desta lista.',
    inputSchema: z.object({ quantas: z.number().int().min(1).max(6).default(3) }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  agendar_reuniao: def({
    id: 'agendar_reuniao',
    rotulo: 'Marcou uma reunião',
    descricao:
      'Marca a reunião na agenda do closer, convida o contato e anexa o resumo do mandato. Use UMA das janelas de consultar_agenda_closer (passe o `reserva_id`).',
    inputSchema: z.object({
      contato_id: contatoId,
      reserva_id: uuid,
      modalidade: z.enum(['meet', 'telefone', 'presencial']).default('meet'),
      local: z.string().max(300).nullable().optional(),
    }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  mover_estagio_funil: def({
    id: 'mover_estagio_funil',
    rotulo: 'Moveu no funil',
    descricao:
      'Move o card do mandato PARA FRENTE: na originação, a nota (em_prospeccao, em_negociacao); nos demais, o lead do SDR (em_conversa, qualificada). Nunca para trás, nunca para convertida/perdida.',
    inputSchema: z.object({ estagio: z.enum(['em_prospeccao', 'em_negociacao', 'em_conversa', 'qualificada']) }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  propor_mandato: def({
    id: 'propor_mandato',
    rotulo: 'Propôs um mandato',
    descricao:
      'Propõe um mandato NOVO (ex.: a qualificação achou interesse → agendamento). Vai para aprovação humana; você não cria mandato sozinho.',
    inputSchema: z.object({
      tipo: z.enum(TIPOS_MANDATO),
      objetivo: z.string().min(10).max(600),
      justificativa: z.string().min(10).max(600),
    }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  escalar_humano: def({
    id: 'escalar_humano',
    rotulo: 'Escalou para uma pessoa',
    descricao:
      'Para o mandato e chama uma pessoa. Obrigatório em: pedido expresso de falar com alguém, reclamação, negociação de taxa/prazo/condição, menção a advogado, processo ou cobrança. Pergunta sobre ser robô NÃO é motivo.',
    inputSchema: z.object({ motivo: z.string().min(5).max(500) }),
    muta: true,
    requerOrcamento: false,
    canal: null,
    terminal: true,
  }),
  encerrar_mandato: def({
    id: 'encerrar_mandato',
    rotulo: 'Encerrou o mandato',
    descricao:
      'Encerra o mandato com o resultado e o motivo estruturado. `sucesso: true` só com o objetivo atingido.',
    inputSchema: z.object({
      sucesso: z.boolean(),
      motivo: z.enum(MOTIVOS_ENCERRAMENTO),
      resultado: z.string().min(5).max(600),
    }),
    muta: true,
    requerOrcamento: false,
    canal: null,
    terminal: true,
  }),
  atualizar_plano: def({
    id: 'atualizar_plano',
    rotulo: 'Atualizou o plano',
    descricao:
      'OBRIGATÓRIA antes de terminar o ciclo: grava o que você está tentando, a hipótese, as próximas ações (com quando e por quê) e os bloqueios. A primeira próxima ação define quando o mandato acorda de novo.',
    inputSchema: z.object({ plano: planoSchema, motivo: z.string().min(3).max(300) }),
    muta: true,
    requerOrcamento: false,
    canal: null,
  }),
  // `any` porque cada ferramenta tem o seu tipo de entrada, e o `satisfies` só precisa
  // garantir que TODO id do catálogo tem uma definição com a forma de Ferramenta.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<IdFerramenta, Ferramenta<any>>

export function ferramenta(id: string): Ferramenta | undefined {
  return (FERRAMENTAS as Record<string, Ferramenta>)[id]
}

/** O custo estimado (centavos) desta ferramenta, pela tabela de preços da config. */
export function custoEstimado(id: IdFerramenta, precos: PrecosAgentes): number {
  const f = ferramenta(id)
  if (!f?.requerOrcamento) return 0
  return Math.max(0, Math.round(precos.ferramentas_centavos[id] ?? 0))
}

export interface CotasRestantes {
  ligacoes: number
  mensagens: number
  emails: number
}

export interface FiltroDeFerramentas {
  /** O que o playbook do mandato permite. Vazio = todas. */
  permitidas: readonly string[]
  /** O menor dos saldos: mandato, mês global, dia do agente (centavos). */
  saldoCentavos: number
  precos: PrecosAgentes
  cotas: CotasRestantes
  versaoVoz: VersaoVoz
  /** O agente tem closer designado (sem ele, agenda e reunião não existem). */
  temCloser: boolean
  /** Algum canal já passou do teto de ações do mandato hoje? Então só ferramentas grátis. */
  acoesDoDiaEsgotadas: boolean
}

/**
 * As ferramentas que o modelo PODE VER neste ciclo — e, para as que ficaram de fora, o
 * porquê (vai para o contexto em uma linha, para o modelo não planejar o que não pode).
 */
export function ferramentasDisponiveis(f: FiltroDeFerramentas): {
  disponiveis: IdFerramenta[]
  ocultas: Array<{ id: IdFerramenta; motivo: string }>
} {
  const disponiveis: IdFerramenta[] = []
  const ocultas: Array<{ id: IdFerramenta; motivo: string }> = []
  for (const id of IDS_FERRAMENTAS) {
    const fe = FERRAMENTAS[id] as Ferramenta
    // `atualizar_plano`, `escalar_humano` e `encerrar_mandato` são sempre visíveis: sem
    // elas o agente não teria como cumprir a regra do ciclo nem como sair dele.
    const essencial = id === 'atualizar_plano' || id === 'escalar_humano' || id === 'encerrar_mandato'
    if (!essencial && f.permitidas.length > 0 && !f.permitidas.includes(id)) {
      ocultas.push({ id, motivo: 'fora do playbook' })
      continue
    }
    if (fe.requerOrcamento && custoEstimado(id, f.precos) > f.saldoCentavos) {
      ocultas.push({ id, motivo: 'orçamento insuficiente' })
      continue
    }
    if (fe.muta && fe.requerOrcamento && f.acoesDoDiaEsgotadas) {
      ocultas.push({ id, motivo: 'limite de ações do mandato hoje' })
      continue
    }
    if ((id === 'ligar' && f.cotas.ligacoes <= 0) || (id === 'enviar_whatsapp' && f.cotas.mensagens <= 0) ||
        (id === 'enviar_email' && f.cotas.emails <= 0) ||
        (id === 'enviar_material' && f.cotas.mensagens <= 0 && f.cotas.emails <= 0)) {
      ocultas.push({ id, motivo: 'cota diária do agente' })
      continue
    }
    if ((id === 'consultar_agenda_closer' || id === 'agendar_reuniao') && !f.temCloser) {
      ocultas.push({ id, motivo: 'agente sem closer designado' })
      continue
    }
    disponiveis.push(id)
  }
  return { disponiveis, ocultas }
}

/** O formato `tools` da API da Anthropic, só para as disponíveis. */
export function ferramentasParaAnthropic(ids: readonly IdFerramenta[]): Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}> {
  return ids.map((id) => {
    const f = FERRAMENTAS[id] as Ferramenta
    const schema = zodToJsonSchema(f.inputSchema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>
    delete schema.$schema
    return { name: id, description: f.descricao, input_schema: schema }
  })
}
