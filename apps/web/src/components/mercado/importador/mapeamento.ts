import {
  CAMPOS_IMPORTACAO,
  CAMPO_IMPORTACAO_LABELS,
  isValidCnpj,
  normalizeCnpj,
  type CampoImportacao,
  type MapeamentoImportacao,
} from '@jobsiteos/core'

/**
 * O mapeamento: da coluna que veio na planilha para o campo canônico.
 *
 * Funções puras, sem I/O — as MESMAS rodam no cliente (para a prévia da tela de
 * mapeamento) e no servidor (para aplicar a importação de verdade). Se a prévia
 * e a aplicação usassem regras diferentes, a tela mentiria, e é justamente a
 * tela que o usuário está usando para decidir se confia no arquivo.
 *
 * `CAMPOS_IMPORTACAO` vem do core (§5.5): esta lista NÃO é reinventada aqui.
 */

export const IGNORAR = '__ignorar__'

// ─── Sugestão automática de mapeamento ──────────────────────────────────────

function normalizarChave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Sinônimos por campo. Uma lista de ERP não vem com os nossos nomes: vem com
 * "Razão Social", "CNPJ/CPF", "Vlr Mensal", "Qtde Usuários", "Situação".
 * O primeiro sinônimo que casar por igualdade vence; depois tenta-se `includes`.
 */
const SINONIMOS: Record<CampoImportacao, readonly string[]> = {
  cnpj: ['cnpj', 'cnpj cpf', 'cpf cnpj', 'documento', 'doc', 'inscricao', 'ni'],
  razao_social: ['razao social', 'razao', 'empresa', 'cliente', 'nome empresa', 'nome'],
  nome_fantasia: ['nome fantasia', 'fantasia', 'apelido', 'nome comercial'],
  uf: ['uf', 'estado', 'sigla uf'],
  municipio: ['municipio', 'cidade', 'localidade'],
  erp_atual: ['erp atual', 'erp', 'sistema', 'sistema atual', 'software', 'produto', 'concorrente'],
  erp_mrr: [
    'erp mrr',
    'mrr',
    'mensalidade',
    'valor mensal',
    'vlr mensal',
    'valor',
    'ticket',
    'ticket mensal',
    'contrato mensal',
  ],
  'erp_detalhes.qtd_usuarios': [
    'qtd usuarios',
    'quantidade de usuarios',
    'usuarios contratados',
    'qtde usuarios',
    'licencas',
    'usuarios',
  ],
  'erp_detalhes.usuarios_ativos': ['usuarios ativos', 'qtd usuarios ativos', 'ativos'],
  'erp_detalhes.qtd_sistemas': ['qtd sistemas', 'quantidade de sistemas', 'sistemas', 'modulos'],
  'erp_detalhes.canal': ['canal', 'representante', 'parceiro', 'revenda', 'canal de venda'],
  'erp_detalhes.modalidade': ['modalidade', 'plano', 'tipo de contrato', 'contrato'],
  churn_erp_concorrente: [
    'churn',
    'churn erp concorrente',
    'status',
    'situacao',
    'situacao contrato',
    'ativo inativo',
    'cancelado',
  ],
  'contato.nome': ['contato', 'contato nome', 'nome contato', 'responsavel'],
  'contato.email': ['email', 'e mail', 'contato email', 'email contato'],
  'contato.telefone': ['telefone', 'fone', 'celular', 'whatsapp', 'contato telefone'],
  'contato.cargo': ['cargo', 'funcao', 'contato cargo'],
}

/**
 * Palpite inicial. NUNCA é a palavra final: a tela mostra o palpite e o humano
 * confirma. Um mapeamento errado aceito em silêncio grava o MRR do ERP na coluna
 * de usuários em milhares de empresas.
 */
export function sugerirMapeamento(cabecalhos: readonly string[]): MapeamentoImportacao {
  const mapeamento: MapeamentoImportacao = {}
  const usados = new Set<CampoImportacao>()

  const normalizados = cabecalhos.map((c) => ({ original: c, chave: normalizarChave(c) }))

  // Duas passadas: igualdade exata primeiro, para que "nome" não roube
  // `razao_social` de uma coluna que se chama exatamente "Razão Social".
  for (const campo of CAMPOS_IMPORTACAO) {
    const alvo = normalizados.find(
      (h) => !mapeamento[h.original] && SINONIMOS[campo].includes(h.chave),
    )
    if (alvo) {
      mapeamento[alvo.original] = campo
      usados.add(campo)
    }
  }

  for (const campo of CAMPOS_IMPORTACAO) {
    if (usados.has(campo)) continue
    const alvo = normalizados.find(
      (h) =>
        !mapeamento[h.original] &&
        SINONIMOS[campo].some((s) => s.length >= 3 && h.chave.includes(s)),
    )
    if (alvo) {
      mapeamento[alvo.original] = campo
      usados.add(campo)
    }
  }

  for (const { original } of normalizados) {
    if (!(original in mapeamento)) mapeamento[original] = null
  }

  return mapeamento
}

export function labelDoCampo(campo: CampoImportacao): string {
  return CAMPO_IMPORTACAO_LABELS[campo]
}

// ─── Conversão de valores ───────────────────────────────────────────────────

/** "1.234,56" e "R$ 1.234,56" são o que uma planilha brasileira escreve. "1234.56" é o que o Excel exporta. */
export function parseNumeroBr(bruto: string): number | null {
  const texto = bruto.trim()
  if (!texto) return null

  const limpo = texto.replace(/[^\d,.-]/g, '')
  if (!limpo) return null

  const temVirgula = limpo.includes(',')
  const temPonto = limpo.includes('.')

  let normalizado = limpo
  if (temVirgula && temPonto) {
    // O último separador que aparece é o decimal.
    normalizado =
      limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
        ? limpo.replace(/\./g, '').replace(',', '.')
        : limpo.replace(/,/g, '')
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.')
  }

  const valor = Number(normalizado)
  return Number.isFinite(valor) ? valor : null
}

export function parseInteiro(bruto: string): number | null {
  const valor = parseNumeroBr(bruto)
  if (valor === null) return null
  return Math.trunc(valor)
}

const VERDADEIROS = ['sim', 's', 'true', 'verdadeiro', '1', 'x', 'yes'] as const

/**
 * A coluna de churn quase nunca se chama "churn": ela é a coluna de STATUS do
 * contrato no concorrente. "Cancelado", "Inativo", "Encerrado", "Ex-cliente"
 * são todos churn. "Ativo" é explicitamente NÃO churn — e essa distinção é o
 * ponto: é o sinal que coloca a empresa no SOM.
 */
const CHURN = [
  'cancelado',
  'cancelada',
  'inativo',
  'inativa',
  'encerrado',
  'encerrada',
  'churn',
  'ex cliente',
  'ex-cliente',
  'perdido',
  'perdida',
  'rescindido',
  'distratado',
  'nao ativo',
]

const NAO_CHURN = ['ativo', 'ativa', 'vigente', 'em dia', 'adimplente', 'nao', 'n', 'false', '0']

export function interpretarChurn(bruto: string): boolean | null {
  const texto = normalizarChave(bruto)
  if (!texto) return null
  if (NAO_CHURN.includes(texto)) return false
  if ((VERDADEIROS as readonly string[]).includes(texto)) return true
  if (CHURN.some((termo) => texto.includes(termo))) return true
  return false
}

// ─── Extração de uma linha ──────────────────────────────────────────────────

export interface ContatoImportado {
  nome: string | null
  email: string | null
  telefone: string | null
  cargo: string | null
}

export interface ErpDetalhes {
  qtd_usuarios?: number
  usuarios_ativos?: number
  qtd_sistemas?: number
  canal?: string
  modalidade?: string
}

export interface LinhaExtraida {
  /** 14 dígitos válidos, ou null — um CNPJ com dígito verificador errado é lixo, não dado. */
  cnpj: string | null
  /** O que veio na coluna de CNPJ, mesmo inválido: o revisor precisa ver o que a planilha dizia. */
  cnpj_bruto: string | null
  razao_social: string | null
  nome_fantasia: string | null
  uf: string | null
  municipio: string | null
  erp_atual: string | null
  erp_mrr: number | null
  erp_detalhes: ErpDetalhes
  churn_erp_concorrente: boolean | null
  contato: ContatoImportado | null
}

function texto(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim()
  return limpo.length > 0 ? limpo : null
}

/** `dados` é o jsonb cru da linha da planilha: { cabeçalho: valor }. */
export function extrairLinha(
  dados: Record<string, string>,
  mapeamento: MapeamentoImportacao,
): LinhaExtraida {
  const por = new Map<CampoImportacao, string>()

  for (const [coluna, campo] of Object.entries(mapeamento)) {
    if (!campo) continue
    const valor = dados[coluna]
    if (valor === undefined || valor.trim() === '') continue
    // Primeira coluna não vazia mapeada num campo vence: duas colunas no mesmo
    // campo é erro do usuário, mas não pode ser motivo de perder a linha.
    if (!por.has(campo)) por.set(campo, valor.trim())
  }

  const cnpjBruto = texto(por.get('cnpj'))
  const cnpjNormalizado = cnpjBruto ? normalizeCnpj(cnpjBruto) : null
  const cnpj = cnpjNormalizado && isValidCnpj(cnpjNormalizado) ? cnpjNormalizado : null

  const erpDetalhes: ErpDetalhes = {}
  const qtdUsuarios = por.get('erp_detalhes.qtd_usuarios')
  const usuariosAtivos = por.get('erp_detalhes.usuarios_ativos')
  const qtdSistemas = por.get('erp_detalhes.qtd_sistemas')
  const canal = texto(por.get('erp_detalhes.canal'))
  const modalidade = texto(por.get('erp_detalhes.modalidade'))

  if (qtdUsuarios !== undefined) {
    const valor = parseInteiro(qtdUsuarios)
    if (valor !== null) erpDetalhes.qtd_usuarios = valor
  }
  if (usuariosAtivos !== undefined) {
    const valor = parseInteiro(usuariosAtivos)
    if (valor !== null) erpDetalhes.usuarios_ativos = valor
  }
  if (qtdSistemas !== undefined) {
    const valor = parseInteiro(qtdSistemas)
    if (valor !== null) erpDetalhes.qtd_sistemas = valor
  }
  if (canal) erpDetalhes.canal = canal
  if (modalidade) erpDetalhes.modalidade = modalidade

  const mrrBruto = por.get('erp_mrr')
  const churnBruto = por.get('churn_erp_concorrente')

  const contatoNome = texto(por.get('contato.nome'))
  const contatoEmail = texto(por.get('contato.email'))
  const contatoTelefone = texto(por.get('contato.telefone'))
  const contatoCargo = texto(por.get('contato.cargo'))
  const temContato = Boolean(contatoNome || contatoEmail || contatoTelefone)

  const uf = texto(por.get('uf'))

  return {
    cnpj,
    cnpj_bruto: cnpjBruto,
    razao_social: texto(por.get('razao_social')),
    nome_fantasia: texto(por.get('nome_fantasia')),
    uf: uf ? uf.toUpperCase().slice(0, 2) : null,
    municipio: texto(por.get('municipio')),
    erp_atual: texto(por.get('erp_atual')),
    erp_mrr: mrrBruto === undefined ? null : parseNumeroBr(mrrBruto),
    erp_detalhes: erpDetalhes,
    churn_erp_concorrente: churnBruto === undefined ? null : interpretarChurn(churnBruto),
    contato: temContato
      ? {
          nome: contatoNome,
          email: contatoEmail,
          telefone: contatoTelefone,
          cargo: contatoCargo,
        }
      : null,
  }
}

/** O mapeamento precisa, no mínimo, saber QUEM é a empresa de cada linha. */
export function validarMapeamento(mapeamento: MapeamentoImportacao): string | null {
  const campos = new Set(Object.values(mapeamento).filter((c): c is CampoImportacao => c !== null))

  if (!campos.has('cnpj') && !campos.has('razao_social')) {
    return 'Mapeie ao menos a coluna de CNPJ ou a de razão social — sem uma das duas não há como identificar a empresa.'
  }

  return null
}
