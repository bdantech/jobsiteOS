import { identificadorCanonico } from '../comunicacao/identificador.js'
import type { BaseLegal, CanalThread } from '../comunicacao/schemas.js'

/**
 * O RESOLVEDOR DE DESTINATÁRIO POR EMPRESA (§2).
 *
 * Uma empresa gera **um** destinatário. Nunca dois contatos da mesma empresa na
 * mesma campanha — receber a mesma abordagem duas vezes no mesmo dia, de duas
 * pessoas diferentes da mesma casa, é como uma empresa descobre que está sendo
 * trabalhada por um robô.
 *
 * A ordem de preferência responde "quem é a pessoa certa?", e cada critério
 * existe por um motivo distinto:
 *
 *   1. ponto focal        alguém DECIDIU que é essa pessoa. Curadoria ganha de
 *                         heurística, sempre.
 *   2. é o decisor        `nao_e_o_decisor` é informação que custou uma conversa
 *                         para ser descoberta; ignorá-la é jogá-la fora.
 *   3. base legal forte   aceite explícito antes das demais bases.
 *   4. cargo relevante    quem assina é quem responde.
 *   5. mais recente       na falta de tudo, o cadastro mais novo.
 *
 * Contato sem identificador no canal escolhido não entra na disputa: ele não
 * perde, ele nem concorre.
 */

export interface ContatoCandidato {
  id: string
  empresa_id: string
  nome: string | null
  cargo: string | null
  email: string | null
  telefone: string | null
  whatsapp: string | null
  ponto_focal: boolean
  nao_e_o_decisor: boolean
  base_legal: string | null
  criado_em: string | null
}

export interface DestinatarioResolvido {
  contato: ContatoCandidato
  /** Já em forma canônica — é o que vai para a fila e para o ledger. */
  identificador: string
  baseLegal: BaseLegal | null
}

/**
 * Cargos que costumam decidir sobre antecipação. É heurística declarada, não
 * inteligência: uma lista visível pode ser discutida e corrigida, um score
 * escondido não.
 */
const CARGOS_FORTES = [
  'financeiro',
  'controller',
  'controladoria',
  'cfo',
  'tesouraria',
  'diretor',
  'socio',
  'sócio',
  'proprietario',
  'proprietário',
  'administrativo',
]

function pesoDoCargo(cargo: string | null): number {
  if (!cargo) return 0
  const c = cargo
    .toLowerCase()
    .normalize('NFD')
        // Escape, não o caractere combinante literal: uma classe de regex com marcas
    // de acentuação cruas some no primeiro editor que normaliza o arquivo.
    .replace(/[\u0300-\u036f]/g, '')
  return CARGOS_FORTES.some((k) => c.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))
    ? 1
    : 0
}

function pesoDaBase(base: string | null): number {
  // `formulario_aceite` é a única base que é PERMISSÃO, e não apenas legitimidade
  // para abordar (05A §2) — é também a única que dispensa o link de descadastro.
  // Quando as duas existem na mesma empresa, escrever para quem pediu para
  // receber é sempre melhor.
  if (base === 'formulario_aceite') return 2
  if (base === null) return 0
  return 1
}

export function identificadorDoContato(canal: CanalThread, c: ContatoCandidato): string | null {
  if (canal === 'email') return identificadorCanonico('email', c.email)
  // WhatsApp primeiro, telefone como reserva: o campo `whatsapp` foi preenchido
  // por alguém que sabia que aquele número tem WhatsApp.
  return identificadorCanonico('whatsapp', c.whatsapp) ?? identificadorCanonico('whatsapp', c.telefone)
}

export function resolverDestinatario(
  canal: CanalThread,
  contatos: readonly ContatoCandidato[],
): DestinatarioResolvido | null {
  const elegiveis = contatos
    .map((c) => ({ c, ident: identificadorDoContato(canal, c) }))
    .filter((x): x is { c: ContatoCandidato; ident: string } => x.ident !== null)

  if (elegiveis.length === 0) return null

  const ordenado = [...elegiveis].sort((a, b) => {
    if (a.c.ponto_focal !== b.c.ponto_focal) return a.c.ponto_focal ? -1 : 1
    if (a.c.nao_e_o_decisor !== b.c.nao_e_o_decisor) return a.c.nao_e_o_decisor ? 1 : -1
    const base = pesoDaBase(b.c.base_legal) - pesoDaBase(a.c.base_legal)
    if (base !== 0) return base
    const cargo = pesoDoCargo(b.c.cargo) - pesoDoCargo(a.c.cargo)
    if (cargo !== 0) return cargo
    const da = Date.parse(a.c.criado_em ?? '') || 0
    const db = Date.parse(b.c.criado_em ?? '') || 0
    if (da !== db) return db - da
    // Desempate estável: sem isto, duas execuções da mesma simulação podem
    // escolher pessoas diferentes, e o dry-run deixa de descrever o envio.
    return a.c.id.localeCompare(b.c.id)
  })

  const escolhido = ordenado[0]!
  return {
    contato: escolhido.c,
    identificador: escolhido.ident,
    baseLegal: (escolhido.c.base_legal as BaseLegal | null) ?? null,
  }
}

/**
 * Agrupa contatos por empresa e resolve um destinatário para cada uma.
 * Empresas sem contato utilizável saem da lista — e voltam no placar como
 * `sem_contato`, que é informação de enriquecimento, não de filtro.
 */
export function resolverPorEmpresa(
  canal: CanalThread,
  contatos: readonly ContatoCandidato[],
): Map<string, DestinatarioResolvido> {
  const porEmpresa = new Map<string, ContatoCandidato[]>()
  for (const c of contatos) {
    const lista = porEmpresa.get(c.empresa_id)
    if (lista) lista.push(c)
    else porEmpresa.set(c.empresa_id, [c])
  }

  const out = new Map<string, DestinatarioResolvido>()
  for (const [empresaId, lista] of porEmpresa) {
    const r = resolverDestinatario(canal, lista)
    if (r) out.set(empresaId, r)
  }
  return out
}
