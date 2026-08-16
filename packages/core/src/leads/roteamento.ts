import type { Intencao } from './schemas.js'

/**
 * O motor de roteamento inbound (04i §3 e §5.6).
 *
 * Puro de propósito: decide QUEM recebe e COMO o lead é rotulado, sem tocar no banco.
 * O endpoint público chama isto antes de gravar, e os testes cobrem os quatro casos
 * que a spec chama pelo nome — dedup de empresa existente, divergência de papel,
 * supressão em revisão e spam.
 */

// ─── Diagnóstico de papel ───────────────────────────────────────────────────

export type PapelInferido = 'contratante' | 'prestador' | 'indefinido'

/**
 * CNAEs de construção de obra: quem CONSTRÓI e quem INCORPORA. É o recorte do Mercado
 * (divisões 41 e 42 e o grupo 68.1 de incorporação), e é o que separa "contrata
 * fornecedor" de "é fornecedor".
 */
const PREFIXOS_CONTRATANTE = ['41', '42', '4110', '6810']

/**
 * O diagnóstico é uma HIPÓTESE, não um veredito — e é assim que ele é usado: nunca
 * descarta lead, só levanta a bandeira quando discorda do que a pessoa declarou.
 *
 * `indefinido` é resposta legítima e é o estado até a cadastral chegar da fila. Chutar
 * um papel sem CNAE produziria divergências inventadas, e uma bandeira que aparece
 * sem motivo é uma bandeira que o SDR aprende a ignorar.
 */
export function inferirPapel(cnaePrincipal: string | null | undefined): PapelInferido {
  const digitos = (cnaePrincipal ?? '').replace(/\D/g, '')
  if (digitos.length < 2) return 'indefinido'
  if (PREFIXOS_CONTRATANTE.some((p) => digitos.startsWith(p))) return 'contratante'
  return 'prestador'
}

/** O papel que a INTENÇÃO declarada implica. `erp` não fala de papel nenhum. */
export function papelDaIntencao(intencao: Intencao | null | undefined): PapelInferido {
  if (intencao === 'sacado') return 'contratante'
  if (intencao === 'cedente') return 'prestador'
  return 'indefinido'
}

/**
 * Divergência = os dois lados têm opinião e elas não batem.
 *
 * Divergir NÃO é defeito do lead: costuma ser lead confuso OU lead muito interessante
 * (o subempreiteiro grande que também subcontrata é os dois papéis ao mesmo tempo).
 * Por isso isto devolve um booleano para exibir alerta, e nunca um motivo de descarte.
 */
export function haDivergenciaDePapel(
  intencao: Intencao | null | undefined,
  cnaePrincipal: string | null | undefined,
): boolean {
  const declarado = papelDaIntencao(intencao)
  const inferido = inferirPapel(cnaePrincipal)
  if (declarado === 'indefinido' || inferido === 'indefinido') return false
  return declarado !== inferido
}

export function textoDivergencia(intencao: Intencao | null | undefined): string {
  return intencao === 'sacado'
    ? 'Declarou-se contratante, mas o CNAE indica prestador de serviço.'
    : 'Declarou-se prestador, mas o CNAE indica construtora ou incorporadora.'
}

// ─── Rótulo do lead por intenção ────────────────────────────────────────────

export interface RotuloIntencao {
  /** Tag no card do SDR. Muda o pitch, não o funil: em todos os casos o SDR trabalha. */
  tag: string
  /** `cedente` é oportunidade de FORNECEDOR: a empresa entra como alvo de aquisição. */
  tipagemAntecipacao: 'aquisicao' | null
}

export function rotuloDaIntencao(intencao: Intencao | null | undefined): RotuloIntencao {
  switch (intencao) {
    case 'cedente':
      return { tag: 'oportunidade de fornecedor', tipagemAntecipacao: 'aquisicao' }
    case 'sacado':
      return { tag: 'antecipação', tipagemAntecipacao: null }
    case 'erp':
      return { tag: 'produto Brik', tipagemAntecipacao: null }
    default:
      return { tag: 'inbound', tipagemAntecipacao: null }
  }
}

// ─── Escolha do SDR ─────────────────────────────────────────────────────────

export interface SdrCandidato {
  id: string
  nome: string
  /** `settings.direcao`. Só `in` e `both` recebem inbound. */
  direcao: 'in' | 'out' | 'both'
  /** Território: UFs cobertas. Vazio = cobre todas. */
  ufs: readonly string[]
  faturamentoMin: number | null
  faturamentoMax: number | null
  /** Leads vivos hoje. Desempata: quem tem menos fila atende mais rápido. */
  carga: number
}

export interface AlvoInbound {
  uf: string | null
  faturamento: number | null
}

function cobre(sdr: SdrCandidato, alvo: AlvoInbound): boolean {
  if (sdr.ufs.length > 0 && alvo.uf && !sdr.ufs.includes(alvo.uf)) return false
  if (alvo.faturamento !== null) {
    if (sdr.faturamentoMin !== null && alvo.faturamento < sdr.faturamentoMin) return false
    if (sdr.faturamentoMax !== null && alvo.faturamento > sdr.faturamentoMax) return false
  }
  return true
}

/**
 * Quem atende este lead.
 *
 * A ordem é: quem faz inbound → quem cobre o território → menor carga. E o último
 * recurso importa mais que os outros: se NINGUÉM cobre o território, o lead vai para o
 * SDR de inbound menos carregado assim mesmo.
 *
 * Um lead inbound é alguém pedindo contato AGORA. Deixá-lo sem dono porque o
 * território não estava configurado seria perder a única coisa que este funil tem de
 * diferente do outbound — a pessoa já quer falar com a gente.
 */
export function escolherSdrInbound(
  candidatos: readonly SdrCandidato[],
  alvo: AlvoInbound,
): SdrCandidato | null {
  const inbound = candidatos.filter((s) => s.direcao === 'in' || s.direcao === 'both')
  if (inbound.length === 0) return null

  const menorCarga = (lista: readonly SdrCandidato[]) =>
    [...lista].sort((a, b) => a.carga - b.carga || a.nome.localeCompare(b.nome))[0] ?? null

  const noTerritorio = inbound.filter((s) => cobre(s, alvo))
  return menorCarga(noTerritorio.length > 0 ? noTerritorio : inbound)
}

// ─── O destino final da submissão ───────────────────────────────────────────

export type StatusSubmissao = 'recebida' | 'processada' | 'revisao' | 'descartada_spam' | 'erro'

export interface DecisaoInbound {
  status: StatusSubmissao
  /** Por que foi para revisão humana, quando foi. */
  motivoRevisao: string | null
  /** Cria lead de SDR? Em revisão NÃO — a decisão é de uma pessoa. */
  criarLead: boolean
}

/**
 * Supressão NÃO bloqueia um inbound: a pessoa está pedindo contato, e o "não me
 * procure" de seis meses atrás não vale contra um formulário preenchido hoje.
 *
 * Mas também não se ignora o registro em silêncio — quem pediu descadastro por LGPD
 * merece que um humano olhe antes de voltar à régua. Daí `revisao`: nem bloqueia, nem
 * atropela.
 */
export function decidirDestino(opts: {
  suprimido: boolean
  motivoSupressao?: string | null
}): DecisaoInbound {
  if (opts.suprimido) {
    return {
      status: 'revisao',
      motivoRevisao: `CNPJ ou e-mail está em supressão (${opts.motivoSupressao ?? 'motivo não registrado'}), mas preencheu o formulário. Decisão humana.`,
      criarLead: false,
    }
  }
  return { status: 'processada', motivoRevisao: null, criarLead: true }
}
