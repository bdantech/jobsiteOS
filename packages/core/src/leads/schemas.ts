import { z } from 'zod'
import { isValidCnpj, normalizeCnpj } from '../schemas/cnpj.js'

/**
 * Leads & formulários (04i): o que a landing page manda para dentro.
 *
 * O formulário é EDITÁVEL e as submissões são eternas. Por isso cada submissão guarda
 * o `campos_snapshot` — a estrutura do form no momento do envio. Sem isso, renomear um
 * campo em outubro reescreveria retroativamente o que a pessoa respondeu em março, e a
 * análise passaria a ler perguntas que ninguém fez.
 */

// ─── Catálogo de campos ─────────────────────────────────────────────────────

export const TIPOS_CAMPO = ['texto', 'email', 'telefone', 'cnpj', 'numero', 'select', 'textarea'] as const
export type TipoCampo = (typeof TIPOS_CAMPO)[number]

/**
 * O catálogo é FECHADO, e é isso que faz o lead virar empresa sem intervenção: cada
 * `key` aqui tem destino conhecido em `empresas` ou `contatos`. Um campo livre viraria
 * texto num jsonb que ninguém lê — e o formulário existe para alimentar o CRM, não
 * para colecionar respostas.
 */
export interface CampoCatalogo {
  key: string
  label: string
  tipo: TipoCampo
  /** Onde o valor pousa depois do processamento. */
  destino: 'empresa' | 'contato'
  opcoes?: readonly string[]
  placeholder?: string
}

export const CATALOGO_EMPRESA: readonly CampoCatalogo[] = [
  { key: 'cnpj', label: 'CNPJ', tipo: 'cnpj', destino: 'empresa', placeholder: '00.000.000/0000-00' },
  { key: 'razao_social', label: 'Razão social', tipo: 'texto', destino: 'empresa' },
  { key: 'uf', label: 'UF', tipo: 'texto', destino: 'empresa' },
  { key: 'municipio', label: 'Município', tipo: 'texto', destino: 'empresa' },
  {
    key: 'faturamento_declarado',
    label: 'Faturamento mensal aproximado',
    tipo: 'numero',
    destino: 'empresa',
    placeholder: 'R$',
  },
  { key: 'erp_atual', label: 'ERP que usa hoje', tipo: 'texto', destino: 'empresa' },
  {
    key: 'tipo',
    label: 'Tipo de empresa',
    tipo: 'select',
    destino: 'empresa',
    opcoes: ['construtora', 'incorporadora', 'fornecedor', 'outro'],
  },
] as const

export const CATALOGO_CONTATO: readonly CampoCatalogo[] = [
  { key: 'nome', label: 'Seu nome', tipo: 'texto', destino: 'contato' },
  { key: 'cargo', label: 'Cargo', tipo: 'texto', destino: 'contato' },
  { key: 'email', label: 'E-mail', tipo: 'email', destino: 'contato' },
  { key: 'telefone', label: 'Telefone', tipo: 'telefone', destino: 'contato' },
  { key: 'whatsapp', label: 'WhatsApp', tipo: 'telefone', destino: 'contato' },
] as const

export const CATALOGO_CAMPOS: readonly CampoCatalogo[] = [...CATALOGO_EMPRESA, ...CATALOGO_CONTATO]

export function campoDoCatalogo(key: string): CampoCatalogo | null {
  return CATALOGO_CAMPOS.find((c) => c.key === key) ?? null
}

/** O microtexto default sob o CNPJ. Editável por formulário. */
export const AJUDA_CNPJ_DEFAULT = 'Usamos seu CNPJ apenas para agilizar seu atendimento.'

export const campoSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  tipo: z.enum(TIPOS_CAMPO),
  obrigatorio: z.boolean().default(false),
  ordem: z.number().int(),
  placeholder: z.string().nullable().optional(),
  ajuda: z.string().nullable().optional(),
  opcoes: z.array(z.string()).nullable().optional(),
})
export type Campo = z.infer<typeof campoSchema>

// ─── Pergunta de intenção ───────────────────────────────────────────────────

export const INTENCOES = ['cedente', 'sacado'] as const
export type Intencao = (typeof INTENCOES)[number]

export const INTENCAO_LABELS: Record<Intencao, string> = {
  cedente: 'Antecipar as notas que eu emito',
  sacado: 'Deixar meus fornecedores antecipar',
}

/**
 * A TAG ao lado de cada opção, e ela não é decoração.
 *
 * "Antecipar" e "deixar meus fornecedores antecipar" descrevem a mesma operação
 * vista dos dois lados da nota, e quem chega pela primeira vez não sabe de qual
 * lado está. A tag responde antes de a pessoa errar: quem emite a nota é
 * fornecedor, quem a recebe é construtora ou incorporadora.
 *
 * Errar aqui não é um detalhe de formulário — a intenção declarada alimenta
 * `papelDaIntencao`, que decide a tipagem da empresa na Antecipação e dispara o
 * alerta de divergência de papel quando bate contra o CNAE. Um lead que se marcou
 * do lado errado chega ao SDR com o pitch invertido.
 */
export const INTENCAO_TAGS: Record<Intencao, string> = {
  cedente: 'Fornecedor',
  sacado: 'Construtora / Incorporadora',
}

/*
 * `erp` — "Sistema de gestão para minha empresa" — saiu daqui, e não só da lista
 * de opções: sair do tipo é o que garante que nenhuma tela volte a oferecê-la.
 *
 * Era a terceira opção desde a 0120 e nunca recebeu uma submissão (as oito
 * existentes são todas `sacado`), de modo que remover não deixa dado
 * inexprimível. O CHECK do banco foi estreitado na mesma migração, e o formulário
 * público lê as opções do banco a cada requisição — não há script colado em
 * landing page que continue oferecendo a opção antiga.
 */

/** O default seedado. A LP pode omitir a pergunta inteira (`pergunta_intencao = null`). */
export const PERGUNTA_INTENCAO_DEFAULT = {
  titulo: 'O que você procura?',
  opcoes: INTENCOES.map((v) => ({ valor: v, label: INTENCAO_LABELS[v], tag: INTENCAO_TAGS[v] })),
}

export const perguntaIntencaoSchema = z.object({
  titulo: z.string().min(1),
  opcoes: z
    .array(
      z.object({
        valor: z.enum(INTENCOES),
        label: z.string().min(1),
        /**
         * Opcional porque os formulários gravados antes desta versão não a têm — e
         * um schema que a exigisse recusaria salvar uma LP existente sem que
         * ninguém tivesse mexido nela.
         */
        tag: z.string().max(48).nullable().optional(),
      }),
    )
    .min(2),
})
export type PerguntaIntencao = z.infer<typeof perguntaIntencaoSchema>

// ─── O formulário ───────────────────────────────────────────────────────────

/**
 * O slug vira URL e id de elemento no DOM da landing page (`jobsiteos-form-{slug}`).
 * Fechado em minúsculas, dígitos e hífen porque qualquer outra coisa quebra um dos
 * dois — e descobrir isso só depois de colado na página do cliente é caro.
 */
export const slugSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use minúsculas, números e hífen (ex.: lp-antecipacao-sp).')

export const salvarFormularioSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  slug: slugSchema,
  nome: z.string().min(1).max(120),
  descricao: z.string().max(500).nullable().optional(),
  titulo: z.string().max(160).nullable().optional(),
  subtitulo: z.string().max(300).nullable().optional(),
  texto_botao: z.string().max(40).default('Enviar'),
  mensagem_sucesso: z.string().max(500).nullable().optional(),
  ajuda_cnpj: z.string().max(200).nullable().optional(),
  campos: z.array(campoSchema).min(1),
  pergunta_intencao: perguntaIntencaoSchema.nullable().optional(),
  consentimento_texto: z.string().max(1000).nullable().optional(),
  consentimento_obrigatorio: z.boolean().default(true),
  vendedor_destino_id: z.string().uuid().nullable().optional(),
  auto_resposta_habilitada: z.boolean().default(true),
  auto_resposta_assunto: z.string().max(200).nullable().optional(),
  auto_resposta_corpo: z.string().max(4000).nullable().optional(),
  enriquecimento_pago: z.boolean().default(false),
  ativo: z.boolean().default(true),
})
export type SalvarFormularioInput = z.infer<typeof salvarFormularioSchema>

/**
 * CNPJ é sempre obrigatório e sempre presente — não é preferência, é o que faz o
 * pipeline inteiro funcionar: sem ele não há dedup de empresa, nem cadastral, nem
 * score, e o lead vira um e-mail solto numa caixa.
 */
export function normalizarCampos(campos: Campo[]): Campo[] {
  const semCnpj = campos.filter((c) => c.key !== 'cnpj')
  const cnpj = campos.find((c) => c.key === 'cnpj')
  const primeiro: Campo = {
    key: 'cnpj',
    label: cnpj?.label ?? 'CNPJ',
    tipo: 'cnpj',
    obrigatorio: true,
    ordem: 0,
    placeholder: cnpj?.placeholder ?? '00.000.000/0000-00',
    ajuda: cnpj?.ajuda ?? AJUDA_CNPJ_DEFAULT,
    opcoes: null,
  }
  return [primeiro, ...semCnpj.sort((a, b) => a.ordem - b.ordem).map((c, i) => ({ ...c, ordem: i + 1 }))]
}

// ─── UTM ────────────────────────────────────────────────────────────────────

export const CHAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
export type ChaveUtm = (typeof CHAVES_UTM)[number]

export type Utm = Partial<Record<ChaveUtm, string | null>>

/**
 * Normaliza UTM para o dashboard poder AGRUPAR.
 *
 * Minúsculas e sem espaço nas pontas porque `Google`, `google` e `google ` são a mesma
 * campanha em toda planilha do mundo e três linhas distintas em todo `group by`. O
 * corte em 200 caracteres é contra UTM colada por engano com a URL inteira dentro.
 */
export function normalizarUtm(bruto: Record<string, unknown> | null | undefined): Utm {
  const out: Utm = {}
  for (const chave of CHAVES_UTM) {
    const v = bruto?.[chave]
    if (typeof v !== 'string') continue
    const limpo = v.trim().toLowerCase().slice(0, 200)
    if (limpo) out[chave] = limpo
  }
  return out
}

/** Extrai UTMs de uma URL completa — o script lê a URL da página hospedeira. */
export function utmDaUrl(url: string | null | undefined): Utm {
  if (!url) return {}
  try {
    const params = new URL(url).searchParams
    const bruto: Record<string, string> = {}
    for (const chave of CHAVES_UTM) {
      const v = params.get(chave)
      if (v) bruto[chave] = v
    }
    return normalizarUtm(bruto)
  } catch {
    return {}
  }
}

// ─── A submissão que chega ──────────────────────────────────────────────────

export const submissaoSchema = z.object({
  dados: z.record(z.string(), z.unknown()),
  intencao: z.enum(INTENCOES).nullable().optional(),
  consentimento_aceito: z.boolean().nullable().optional(),
  /** Honeypot: campo escondido no DOM. Preenchido = bot. */
  _hp: z.string().nullable().optional(),
  /** Milissegundos entre a renderização e o submit. */
  _ms: z.number().int().nonnegative().nullable().optional(),
  utm_source: z.string().nullable().optional(),
  utm_medium: z.string().nullable().optional(),
  utm_campaign: z.string().nullable().optional(),
  utm_term: z.string().nullable().optional(),
  utm_content: z.string().nullable().optional(),
  referrer: z.string().max(2000).nullable().optional(),
  pagina_url: z.string().max(2000).nullable().optional(),
})
export type SubmissaoInput = z.infer<typeof submissaoSchema>

/** Menos que isto não é gente preenchendo formulário. */
export const TEMPO_MINIMO_MS = 2000

export function normalizarEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null
}

/*
 * O telefone reusa `normalizarTelefone` de `antecipacao/contato-nf.ts` — ele já sabe
 * derrubar o prefixo 55 e recusar meio número, aprendido contra os telefones que vêm
 * nas NFs. Uma segunda normalização de telefone nesta base seria uma segunda opinião
 * sobre o que é um telefone válido.
 */

export type MotivoRecusa =
  | 'spam_honeypot'
  | 'spam_rapido_demais'
  | 'cnpj_invalido'
  | 'email_invalido'
  | 'consentimento_ausente'
  | 'campo_obrigatorio'

export interface Validacao {
  ok: boolean
  motivo?: MotivoRecusa
  /** Qual campo faltou, quando o motivo é `campo_obrigatorio`. */
  campo?: string
  /** Spam é descartado em SILÊNCIO: o bot não pode aprender o que o denunciou. */
  silencioso: boolean
  cnpj?: string
  email?: string | null
}

/**
 * A porta de entrada, e ela é uma porta aberta para a internet.
 *
 * A ordem das checagens não é arbitrária: as duas de spam vêm primeiro porque são as
 * únicas que não devem gerar resposta útil. Validar CNPJ antes do honeypot faria o bot
 * receber "CNPJ inválido" e aprender o formato certo na segunda tentativa.
 */
export function validarSubmissao(
  entrada: SubmissaoInput,
  campos: Campo[],
  consentimentoObrigatorio: boolean,
): Validacao {
  if (entrada._hp) return { ok: false, motivo: 'spam_honeypot', silencioso: true }
  if (typeof entrada._ms === 'number' && entrada._ms < TEMPO_MINIMO_MS) {
    return { ok: false, motivo: 'spam_rapido_demais', silencioso: true }
  }

  const cnpj = normalizeCnpj(String(entrada.dados.cnpj ?? ''))
  if (!isValidCnpj(cnpj)) return { ok: false, motivo: 'cnpj_invalido', silencioso: false }

  const emailBruto = entrada.dados.email
  const email = normalizarEmail(emailBruto)
  // String não-vazia que não é e-mail é erro; ausência só é erro se o campo for
  // obrigatório — e isso o laço abaixo cobre.
  if (typeof emailBruto === 'string' && emailBruto.trim() && !email) {
    return { ok: false, motivo: 'email_invalido', silencioso: false }
  }

  for (const c of campos) {
    if (!c.obrigatorio || c.key === 'cnpj') continue
    const v = entrada.dados[c.key]
    if (v === undefined || v === null || String(v).trim() === '') {
      return { ok: false, motivo: 'campo_obrigatorio', campo: c.key, silencioso: false }
    }
  }

  if (consentimentoObrigatorio && entrada.consentimento_aceito !== true) {
    return { ok: false, motivo: 'consentimento_ausente', silencioso: false }
  }

  return { ok: true, silencioso: false, cnpj, email }
}
