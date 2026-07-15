import { z } from 'zod'
import { isValidCnpj, normalizeCnpj } from './cnpj.js'

export * from './cnpj.js'

// ─── Domain vocabulary ──────────────────────────────────────────────────────
// Mirrors the CHECK constraints in migration 0001. Keep both in sync: the DB is
// the last line of defence, zod is the one that produces a readable pt-BR error.

export const ESTAGIOS = ['mercado', 'lead', 'prospect', 'cliente', 'ex_cliente'] as const
export const TIPOS_EMPRESA = ['construtora', 'fornecedor'] as const

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
  fornecedor: 'Fornecedor',
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
})
export type CriarEmpresaInput = z.infer<typeof criarEmpresaSchema>

// CNPJ is intentionally absent: it is the identity of the row. Changing it means
// this is a different company, which is a merge, not an edit.
export const atualizarEmpresaSchema = criarEmpresaSchema.omit({ cnpj: true }).partial().extend({
  id: z.string().uuid(),
})
export type AtualizarEmpresaInput = z.infer<typeof atualizarEmpresaSchema>

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
