import { z } from 'zod'
import { MOTIVOS_SEM_INTERESSE } from '../antecipacao/schemas.js'
import { normalizeCnpj } from '../schemas/cnpj.js'

/**
 * Vocabulário do funil de cadastro de fornecedores (04l).
 *
 * Uma fonte só para os cinco consumidores: o kanban da web, a lista do celular, os
 * jobs do worker, as tools de IA e a RPC. Estágio, fonte e confiança são escritos no
 * banco como texto com CHECK — se o TypeScript e o CHECK discordarem, quem descobre é
 * o usuário, no meio de um clique que custa dinheiro.
 */

// ─── Estágios ───────────────────────────────────────────────────────────────

/*
 * A ordem É a ordem das colunas do kanban, e ela segue o que ACONTECE com o lead:
 * entra sem ninguém ter falado com ele, alguém assume, alguém espera resposta. Os
 * três finais são saídas, e cada uma diz uma coisa diferente sobre o que fazer
 * depois:
 *
 *   sem_contato   — a cascata inteira rodou e não achou por onde falar. É insumo de
 *                   produto (a §6 mede isso), não julgamento do lead.
 *   sem_interesse — falamos e ele disse não. Suprime.
 *   cadastrado    — ganhou. Sai da lista ativa sozinho, pelo sync.
 */
export const ESTAGIOS_FORNECEDOR = [
  'a_cadastrar',
  'em_prospeccao',
  'aguardando_retorno',
  'sem_contato',
  'sem_interesse',
  'cadastrado',
] as const
export type EstagioFornecedor = (typeof ESTAGIOS_FORNECEDOR)[number]

export const ESTAGIO_FORNECEDOR_LABELS: Record<EstagioFornecedor, string> = {
  a_cadastrar: 'A cadastrar',
  em_prospeccao: 'Em prospecção',
  aguardando_retorno: 'Aguardando retorno',
  sem_contato: 'Sem contato',
  sem_interesse: 'Sem interesse',
  cadastrado: 'Cadastrado',
}

export const ESTAGIO_FORNECEDOR_DESCRICOES: Record<EstagioFornecedor, string> = {
  a_cadastrar: 'Entrou pelo volume e ninguém falou com ele ainda.',
  em_prospeccao: 'Alguém assumiu e está tentando contato.',
  aguardando_retorno: 'A bola está com o fornecedor.',
  sem_contato: 'A cascata rodou inteira e não achou por onde falar.',
  sem_interesse: 'Disse não. A supressão decide se ele volta em 90 dias ou nunca.',
  cadastrado: 'Entrou na plataforma. As NFs dele seguem o funil de antecipação.',
}

/** As colunas do kanban. `cadastrado` sai da view ativa — vive no filtro "concluídos". */
export const ESTAGIOS_FORNECEDOR_ATIVOS = ESTAGIOS_FORNECEDOR.filter(
  (e) => e !== 'cadastrado',
) as readonly EstagioFornecedor[]

// ─── Contatos descobertos ───────────────────────────────────────────────────

export const TIPOS_CONTATO_DESCOBERTO = ['telefone', 'email', 'whatsapp', 'site', 'instagram'] as const
export type TipoContatoDescoberto = (typeof TIPOS_CONTATO_DESCOBERTO)[number]

export const TIPO_CONTATO_LABELS: Record<TipoContatoDescoberto, string> = {
  telefone: 'Telefone',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  site: 'Site',
  instagram: 'Instagram',
}

/**
 * De onde o contato veio. A fonte é gravada em TODA linha porque a §6 reordena a
 * cascata com ela: sem a fonte no dado, "o Google Places paga?" vira opinião.
 *
 * `sacado` é a única fonte que não é um provedor — é o contato que o próprio cliente
 * nos passou ao apresentar o fornecedor. Ela existe separada de propósito: é a que
 * tem a maior taxa de conversão do conjunto e a única cujo custo é político, não
 * financeiro.
 */
export const FONTES_CONTATO = [
  'xml_nfe',
  'receita',
  'google_places',
  'site_empresa',
  'apollo',
  'novavida',
  'claude_busca',
  'claude_aprofundado',
  'sacado',
] as const
export type FonteContato = (typeof FONTES_CONTATO)[number]

export const FONTE_CONTATO_LABELS: Record<FonteContato, string> = {
  xml_nfe: 'XML da NF-e',
  receita: 'Cadastro da Receita',
  google_places: 'Google Places',
  site_empresa: 'Site da empresa',
  apollo: 'Apollo',
  novavida: 'Nova Vida TI',
  claude_busca: 'Busca do Claude',
  claude_aprofundado: 'Busca aprofundada',
  sacado: 'Indicação do sacado',
}

export const CONFIANCAS = ['alta', 'media', 'baixa'] as const
export type Confianca = (typeof CONFIANCAS)[number]

export const CONFIANCA_LABELS: Record<Confianca, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
}

/** Ordem de exibição e de decisão. Maior é melhor — usada para ordenar e para o corte. */
export const PESO_CONFIANCA: Record<Confianca, number> = { alta: 3, media: 2, baixa: 1 }

// ─── Camadas da cascata ─────────────────────────────────────────────────────

/**
 * `automatica` roda sozinha, no job, para todo mundo — as fontes que já pagamos ou
 * que não custam nada. `sob_demanda` é o clique do originador, e ele custa: cada
 * provedor aqui debita do teto mensal dele.
 *
 * A separação é a regra de negócio central do §4: nenhuma fonte paga pode rodar sem
 * alguém ter olhado o card e decidido gastar. 688 fornecedores × qualquer centavo é
 * uma fatura que ninguém aprovou.
 */
export const CAMADAS_DESCOBERTA = ['automatica', 'sob_demanda'] as const
export type CamadaDescoberta = (typeof CAMADAS_DESCOBERTA)[number]

export const STATUS_DESCOBERTA = ['sucesso', 'sem_dados', 'erro', 'pulado'] as const
export type StatusDescoberta = (typeof STATUS_DESCOBERTA)[number]

export const STATUS_DESCOBERTA_LABELS: Record<StatusDescoberta, string> = {
  sucesso: 'Achou',
  sem_dados: 'Não achou',
  erro: 'Falhou',
  pulado: 'Pulado',
}

// ─── Pedido de apresentação ─────────────────────────────────────────────────

export const STATUS_PEDIDO = ['rascunho', 'enviado', 'respondido', 'sem_resposta'] as const
export type StatusPedido = (typeof STATUS_PEDIDO)[number]

export const STATUS_PEDIDO_LABELS: Record<StatusPedido, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  respondido: 'Respondido',
  sem_resposta: 'Sem resposta',
}

// ─── Contratos das mutações ─────────────────────────────────────────────────

const cnpj = z
  .string()
  .transform(normalizeCnpj)
  .refine((v) => /^\d{14}$/.test(v), 'CNPJ precisa ter 14 dígitos.')

const uuid = z.string().uuid()

export const moverFornecedorSchema = z.object({
  fornecedor_cnpj: cnpj,
  estagio: z.enum(ESTAGIOS_FORNECEDOR),
  observacao: z.string().max(500).optional(),
})
export type MoverFornecedorInput = z.infer<typeof moverFornecedorSchema>

/**
 * Descartar o fornecedor do funil de cadastro (§3).
 *
 * Chama-se `descartar`, e não `marcarSemInteresse`, porque a Antecipação já tem uma
 * função com esse nome e as duas fazem coisas diferentes o bastante para não
 * poderem compartilhar um: lá é qualificação reversível do lead, aqui é qualificação
 * MAIS supressão de canal com validade. Dois nomes iguais para dois efeitos
 * diferentes é como alguém chama o errado achando que desfaz.
 *
 * O motivo vem da lista ENUMERADA da Antecipação, e reusá-la é o ponto: "quantos
 * fornecedores perdemos porque já operam com outro?" é uma pergunta que só tem
 * resposta se os dois funis responderem com o mesmo vocabulário. Um enum aqui e
 * texto livre lá daria duas metades que ninguém soma.
 *
 * `dias` é a decisão inteira: 90 (soft, volta ao funil) ou null (eterna, LGPD).
 */
export const descartarFornecedorSchema = z
  .object({
    fornecedor_cnpj: cnpj,
    motivo: z.enum(MOTIVOS_SEM_INTERESSE),
    observacao: z.string().trim().max(500).optional(),
    dias: z.number().int().positive().max(3650).nullable().default(90),
  })
  .refine((v) => v.motivo !== 'outro' || (v.observacao?.length ?? 0) >= 3, {
    path: ['observacao'],
    message: 'Com motivo "Outro", a observação é obrigatória.',
  })
export type DescartarFornecedorInput = z.infer<typeof descartarFornecedorSchema>

export const reatribuirFornecedorSchema = z.object({
  fornecedor_cnpj: cnpj,
  /** null devolve o fornecedor à fila sem dono. */
  originador_id: uuid.nullable(),
})
export type ReatribuirFornecedorInput = z.infer<typeof reatribuirFornecedorSchema>

export const promoverContatoSchema = z.object({
  contato_descoberto_id: uuid,
  /** Marcar como ponto focal desmarca o anterior, em transação. */
  ponto_focal: z.boolean().default(true),
})
export type PromoverContatoInput = z.infer<typeof promoverContatoSchema>

export const pedirApresentacaoSchema = z.object({
  fornecedor_cnpj: cnpj,
  sacado_cnpj: cnpj,
  contato_sacado_id: uuid.nullable().optional(),
  mensagem: z.string().min(10).max(4000),
})
export type PedirApresentacaoInput = z.infer<typeof pedirApresentacaoSchema>

export const statusPedidoSchema = z.object({
  pedido_id: uuid,
  status: z.enum(STATUS_PEDIDO),
})
export type StatusPedidoInput = z.infer<typeof statusPedidoSchema>

export const salvarConfigFornecedoresSchema = z.object({
  chave: z.string().min(1).max(60),
  valor: z.unknown(),
})
export type SalvarConfigFornecedoresInput = z.infer<typeof salvarConfigFornecedoresSchema>

/** O clique pago. `forcar` é do gestor: libera quem estourou o teto do mês. */
export const buscarContatosSchema = z.object({
  fornecedor_cnpj: cnpj,
  forcar: z.boolean().default(false),
})
export type BuscarContatosInput = z.infer<typeof buscarContatosSchema>
