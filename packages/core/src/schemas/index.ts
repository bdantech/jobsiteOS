import { z } from 'zod'
import { isValidCnpj, normalizeCnpj } from './cnpj.js'

export * from './cnpj.js'

// ─── Domain vocabulary ──────────────────────────────────────────────────────
// Mirrors the CHECK constraints in migration 0001. Keep both in sync: the DB is
// the last line of defence, zod is the one that produces a readable pt-BR error.

export const ESTAGIOS = ['mercado', 'lead', 'prospect', 'cliente', 'ex_cliente'] as const
/**
 * Quatro tipos desde o Prompt 04c. `construtora` continua sendo o default e NADA foi
 * reclassificado: a distinção incorporadora/subempreiteiro é refinada à mão, porque
 * inferir por CNAE erraria justamente nas empresas que fazem as duas coisas — que são
 * as maiores e as que mais importam.
 */
export const TIPOS_EMPRESA = ['construtora', 'incorporadora', 'fornecedor', 'subempreiteiro'] as const

export const estagioSchema = z.enum(ESTAGIOS)
export const tipoEmpresaSchema = z.enum(TIPOS_EMPRESA)

export type Estagio = z.infer<typeof estagioSchema>
export type TipoEmpresa = z.infer<typeof tipoEmpresaSchema>

export const ESTAGIO_LABELS: Record<Estagio, string> = {
  mercado: 'Mercado',
  lead: 'Lead',
  prospect: 'Prospect',
  cliente: 'Cliente',
  ex_cliente: 'Ex-cliente',
}

export const TIPO_EMPRESA_LABELS: Record<TipoEmpresa, string> = {
  construtora: 'Construtora',
  incorporadora: 'Incorporadora',
  fornecedor: 'Fornecedor',
  subempreiteiro: 'Subempreiteiro',
}

export const REGIMES_TRIBUTARIOS = ['simples', 'presumido', 'real'] as const
export const regimeTributarioSchema = z.enum(REGIMES_TRIBUTARIOS)
export type RegimeTributario = z.infer<typeof regimeTributarioSchema>

export const REGIME_TRIBUTARIO_LABELS: Record<RegimeTributario, string> = {
  simples: 'Simples Nacional',
  presumido: 'Lucro Presumido',
  real: 'Lucro Real',
}

// ─── Shared field schemas ───────────────────────────────────────────────────

/** Accepts formatted or bare input, always yields the 14 bare digits the DB stores. */
export const cnpjSchema = z
  .string()
  .transform(normalizeCnpj)
  .refine(isValidCnpj, { message: 'CNPJ inválido.' })

export const ufSchema = z
  .string()
  .length(2, 'UF deve ter 2 letras.')
  .transform((v) => v.toUpperCase())

// ─── empresas ───────────────────────────────────────────────────────────────

// The ERP block is COMPETITIVE INTEL, not our own revenue. Every .describe()
// below lands in the JSON Schema handed to Anthropic for `empresas.create`, and
// without them the model was being given `erp_mrr` with no definition at all —
// free to decide for itself that it meant ONE OS revenue. Migration 0001 called
// this block "ERP intelligence (Brik)" and the Prompt 01 spec defined erp_mrr as
// "MRR paid to ONE OS for Brik", so that is exactly the wrong guess it would make.
export const criarEmpresaSchema = z.object({
  cnpj: cnpjSchema,
  razao_social: z.string().min(1, 'Razão social é obrigatória.').max(200),
  nome_fantasia: z.string().max(200).optional().nullable(),
  tipo: tipoEmpresaSchema.default('construtora'),
  estagio: estagioSchema.default('mercado'),
  uf: ufSchema.optional().nullable(),
  municipio: z.string().max(120).optional().nullable(),
  cnae_principal: z.string().max(20).optional().nullable(),
  porte: z.string().max(40).optional().nullable(),
  erp_atual: z
    .string()
    .max(80)
    .optional()
    .nullable()
    .describe('ERP que a empresa usa HOJE (ex: sienge, brik, mega, uau). Inteligência competitiva.'),
  erp_mrr: z.coerce
    .number()
    .nonnegative('O MRR do ERP não pode ser negativo.')
    .optional()
    .nullable()
    .describe(
      'Valor mensal, em reais, que a empresa PAGA pelo ERP que usa hoje (erp_atual). ' +
        'NÃO é receita da ONE OS: só coincide com ela no caso em que erp_atual = "brik".',
    ),
  erp_canal_venda: z
    .string()
    .max(40)
    .optional()
    .nullable()
    .describe('Canal por onde a empresa comprou o ERP atual (inbound, outbound, parceiro, onepay-cross).'),
  // Só LIMITA a estimativa de faturamento (04c §6.2), nunca a determina: presumido
  // diz que a empresa está abaixo do teto, não onde. Aceita '' para limpar.
  regime_tributario: z
    .union([regimeTributarioSchema, z.literal('')])
    .optional()
    .nullable()
    .describe(
      'Regime tributário: simples, presumido ou real. Preenchido à mão — não é inferido. ' +
        'Serve para LIMITAR a estimativa de faturamento, não para calculá-la.',
    ),
})
export type CriarEmpresaInput = z.infer<typeof criarEmpresaSchema>

// CNPJ is intentionally absent: it is the identity of the row. Changing it means
// this is a different company, which is a merge, not an edit.
export const atualizarEmpresaSchema = criarEmpresaSchema.omit({ cnpj: true }).partial().extend({
  id: z.string().uuid(),
  // O "site" da empresa É a coluna empresas.dominio (Radar §3): a mesma unidade de
  // cobrança do enriquecimento de contatos. Normaliza para o host puro (sem esquema,
  // sem caminho, minúsculo) para bater com o formato que a cascata de domínio grava.
  // '' limpa o campo (o write helper 0038 marca dominio_origem='manual' quando muda).
  dominio: z
    .string()
    .trim()
    .max(255)
    .transform((s) => (s ? (s.replace(/^https?:\/\//i, '').split('/')[0] ?? '').toLowerCase() : s))
    .optional(),
})
export type AtualizarEmpresaInput = z.infer<typeof atualizarEmpresaSchema>

/**
 * Declaração de métrica pelo cliente (04c §5). Topo da hierarquia de origens: o que
 * entra por aqui nunca é sobrescrito por estimativa, e é o que calibra o modelo para
 * o resto da base — por isso vale mais que qualquer outro dado deste sistema.
 */
export const declararMetricaSchema = z.object({
  empresa_id: z.string().uuid(),
  metrica: z.enum(['faturamento_anual', 'funcionarios']),
  valor: z.coerce
    .number()
    .nonnegative('O valor não pode ser negativo.')
    .describe('Faturamento anual em reais, ou número de funcionários.'),
  ano: z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .nullable()
    .describe('Ano de referência do faturamento declarado.'),
})
export type DeclararMetricaInput = z.infer<typeof declararMetricaSchema>

export const buscarEmpresasSchema = z.object({
  termo: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Busca por razão social, nome fantasia ou CNPJ. Aceita trechos parciais.'),
  estagio: estagioSchema.optional().describe('Filtra por estágio do funil.'),
  tipo: tipoEmpresaSchema.optional().describe('Filtra por tipo de empresa.'),
  uf: z.string().length(2).optional().describe('Sigla do estado, ex: SP.'),
  limite: z.coerce.number().int().min(1).max(50).default(20),
})
export type BuscarEmpresasInput = z.infer<typeof buscarEmpresasSchema>

// ─── notas ──────────────────────────────────────────────────────────────────

export const criarNotaSchema = z.object({
  empresa_id: z.string().uuid(),
  conteudo: z.string().trim().min(1, 'A nota não pode estar vazia.').max(5000),
})
export type CriarNotaInput = z.infer<typeof criarNotaSchema>

// ─── contatos ───────────────────────────────────────────────────────────────

/** Campo de texto opcional: '' do formulário vira null, e não string vazia no banco. */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v))
    .nullable()

/**
 * Contato criado à mão. Só `empresa_id` é obrigatório junto de UMA forma de falar
 * com a pessoa — um contato sem nome, e-mail nem telefone não é contato, é uma linha
 * vazia que ainda concorre a ponto focal.
 *
 * `origem` é fixada em 'manual' pelo servidor, nunca pelo cliente: é o que distingue
 * o que um humano digitou do que o Apollo trouxe, e o enriquecimento não pode
 * sobrescrever o primeiro (o upsert do Apollo casa por `apollo_person_id`, que aqui
 * é nulo).
 */
export const criarContatoSchema = z
  .object({
    empresa_id: z.string().uuid(),
    nome: textoOpcional(160),
    cargo: textoOpcional(160),
    email: z
      .string()
      .trim()
      .email('E-mail inválido.')
      .max(200)
      .optional()
      .or(z.literal(''))
      .transform((v) => (v === '' || v === undefined ? null : v))
      .nullable(),
    telefone: textoOpcional(40),
    whatsapp: textoOpcional(40),
    linkedin_url: textoOpcional(300),
    senioridade: textoOpcional(40),
    departamento: textoOpcional(60),
  })
  .refine((v) => Boolean(v.nome || v.email || v.telefone || v.whatsapp), {
    message: 'Informe ao menos nome, e-mail, telefone ou WhatsApp.',
    path: ['nome'],
  })
export type CriarContatoInput = z.infer<typeof criarContatoSchema>

export const excluirContatoSchema = z.object({ id: z.string().uuid() })
export type ExcluirContatoInput = z.infer<typeof excluirContatoSchema>

// ─── auth / usuarios ────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  senha: z.string().min(1, 'Informe a senha.'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const alterarSenhaSchema = z
  .object({
    senha: z
      .string()
      .min(12, 'A senha deve ter no mínimo 12 caracteres.')
      .regex(/[a-z]/, 'Inclua ao menos uma letra minúscula.')
      .regex(/[A-Z]/, 'Inclua ao menos uma letra maiúscula.')
      .regex(/[0-9]/, 'Inclua ao menos um número.'),
    confirmacao: z.string(),
  })
  .refine((v) => v.senha === v.confirmacao, {
    message: 'As senhas não conferem.',
    path: ['confirmacao'],
  })
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>

export const criarUsuarioSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(120),
  email: z.string().email('E-mail inválido.').toLowerCase(),
  perfil_id: z.string().uuid('Selecione um perfil.'),
})
export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>

export const definirAtivoUsuarioSchema = z.object({
  usuario_id: z.string().uuid(),
  ativo: z.boolean(),
})
export type DefinirAtivoUsuarioInput = z.infer<typeof definirAtivoUsuarioSchema>

// ─── perfis ─────────────────────────────────────────────────────────────────

export const salvarPerfilSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(1, 'Nome do perfil é obrigatório.').max(60),
  descricao: z.string().max(240).optional().nullable(),
  modulos: z.array(z.string()).describe('Lista de AppModule.id concedidos a este perfil.'),
})
export type SalvarPerfilInput = z.infer<typeof salvarPerfilSchema>

// ─── notificações ───────────────────────────────────────────────────────────

export const marcarNotificacaoLidaSchema = z.object({
  notificacao_id: z.string().uuid(),
})

export const registrarPushWebSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
})
export type RegistrarPushWebInput = z.infer<typeof registrarPushWebSchema>

export const registrarPushExpoSchema = z.object({
  token: z.string().min(1),
  device: z.string().max(120).optional(),
})
export type RegistrarPushExpoInput = z.infer<typeof registrarPushExpoSchema>

export const prefsNotificacoesSchema = z.object({
  push_web: z.boolean().default(true),
  push_mobile: z.boolean().default(true),
})
export type PrefsNotificacoes = z.infer<typeof prefsNotificacoesSchema>
