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

/** O papel que a INTENÇÃO declarada implica. */
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

  const noTerritorio = inbound.filter((s) => cobre(s, alvo))
  return menorCarga(noTerritorio.length > 0 ? noTerritorio : inbound)
}

function menorCarga(lista: readonly SdrCandidato[]): SdrCandidato | null {
  return [...lista].sort((a, b) => a.carga - b.carga || a.nome.localeCompare(b.nome))[0] ?? null
}

/**
 * A CASCATA COMPLETA — e ela existe por causa de um lead perdido de verdade.
 *
 * `escolherSdrInbound` cobria "ninguém cobre o território" mas não "não existe SDR
 * nenhum". Na primeira submissão real da base isso aconteceu: o único vendedor
 * cadastrado era um originador, o roteador devolveu `null`, e o lead virou empresa e
 * contato sem nunca aparecer em funil algum. Silenciosamente, que é o pior modo.
 *
 * A regra agora é: alguém SEMPRE recebe, enquanto existir um vendedor ativo. E cada
 * degrau abaixo do primeiro deixa um aviso gravado na submissão — porque atribuir um
 * lead de reunião a quem não trabalha reuniões é uma solução temporária que precisa
 * parecer temporária, em vez de virar o normal que ninguém nota.
 */
export type NivelRoteamento =
  | 'sdr_inbound'
  | 'sdr_qualquer'
  | 'destino_do_formulario'
  | 'ultimo_recurso'
  | 'ninguem'

export interface CandidatoInbound extends SdrCandidato {
  /** `vendedores.tipo = 'sdr'`. Quem não é, só entra nos degraus de baixo. */
  ehSdr: boolean
}

export interface Roteamento {
  vendedorId: string | null
  nivel: NivelRoteamento
  /** Texto para a tela de Leads quando o lead caiu num degrau improvisado. */
  aviso: string | null
}

export function rotearInbound(
  candidatos: readonly CandidatoInbound[],
  alvo: AlvoInbound,
  destinoDoFormulario: string | null,
): Roteamento {
  const sdrs = candidatos.filter((c) => c.ehSdr)

  const porInbound = escolherSdrInbound(sdrs, alvo)
  if (porInbound) return { vendedorId: porInbound.id, nivel: 'sdr_inbound', aviso: null }

  // Um SDR marcado só como `out` ainda é um SDR: o funil de reuniões é a tela dele, e
  // um lead parado lá é melhor que um lead em lugar nenhum.
  const qualquerSdr = menorCarga(sdrs)
  if (qualquerSdr) {
    return {
      vendedorId: qualquerSdr.id,
      nivel: 'sdr_qualquer',
      aviso: 'Nenhum SDR está marcado para inbound — o lead foi para o SDR menos carregado.',
    }
  }

  const destino = candidatos.find((c) => c.id === destinoDoFormulario)
  if (destino) {
    return {
      vendedorId: destino.id,
      nivel: 'destino_do_formulario',
      aviso:
        'Não há SDR cadastrado. O lead foi para o vendedor de destino do formulário — cadastre um SDR para o funil de reuniões funcionar sozinho.',
    }
  }

  const ultimo = menorCarga(candidatos)
  if (ultimo) {
    return {
      vendedorId: ultimo.id,
      nivel: 'ultimo_recurso',
      aviso:
        'Não há SDR cadastrado nem vendedor de destino no formulário. O lead foi para o vendedor ativo menos carregado.',
    }
  }

  return {
    vendedorId: null,
    nivel: 'ninguem',
    aviso: 'Nenhum vendedor ativo para receber o lead. Atribua à mão.',
  }
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
