/**
 * Estado de um certificado digital — a regra de cor do grid (§4).
 *
 * Mora no core porque TRÊS consumidores dependem dela responder igual: o grid da
 * web, a lista "Atenção" do mobile e o job que decide se emite alerta. Duas
 * implementações dariam um quadrado verde na tela ao lado de uma notificação de
 * "vencido" — e a notificação seria a que está certa.
 *
 * Certificado vencido significa cegueira de NF-e naquela empresa. Por isso "sem
 * certificado na base" é VERMELHO, e não cinza de dado faltante: o efeito prático é
 * o mesmo (não ingerimos nota) e tratar como "sem informação" esconde exatamente o
 * caso que mais importa.
 */

export const DIAS_ALERTA = 30

export const ESTADOS_CERTIFICADO = ['valido', 'vencendo', 'vencido', 'ausente'] as const
export type EstadoCertificado = (typeof ESTADOS_CERTIFICADO)[number]

/** `ausente` e `vencido` são o mesmo vermelho: em ambos não há ingestão de NF-e. */
export const COR_CERTIFICADO: Record<EstadoCertificado, 'verde' | 'amarelo' | 'vermelho'> = {
  valido: 'verde',
  vencendo: 'amarelo',
  vencido: 'vermelho',
  ausente: 'vermelho',
}

export const ESTADO_CERTIFICADO_LABELS: Record<EstadoCertificado, string> = {
  valido: 'Válido',
  vencendo: 'Vencendo',
  vencido: 'Vencido',
  ausente: 'Sem certificado',
}

/** O mínimo que a regra precisa. Aceita a linha de `certificados` como é. */
export interface CertificadoLike {
  expires_at?: string | null
  status?: string | null
}

export interface AvaliacaoCertificado {
  estado: EstadoCertificado
  /** Negativo quando já venceu. `null` quando não há certificado ou data. */
  diasRestantes: number | null
  expiraEm: string | null
}

/** Meia-noite UTC do dia da referência: dias restantes é contagem de DIAS, não de horas. */
function diaUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Já tem fuso? Aceita `Z`, `+00:00`, `-0300` e também `+00` — este último é o que o
 * Postgres emite para `timestamptz`, e tratá-lo como "sem fuso" fazia a data ganhar
 * um `Z` no fim (`...+00Z`), virar inválida e cair em "sem certificado". O grid
 * inteiro ficaria vermelho, o que é exatamente o modo de falhar mais convincente.
 */
const TEM_FUSO = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

/**
 * O endpoint manda `"2026-08-15T23:59:59"` — SEM fuso. `new Date()` trata isso como
 * hora LOCAL, e aí o mesmo certificado tem datas diferentes em cada consumidor: o
 * worker roda em UTC no Railway, o browser do usuário em UTC−3. Um vencimento às
 * 23:59:59 escorrega um dia inteiro entre os dois, o que muda a contagem de dias, a
 * cor do quadrado e se o alerta dispara.
 *
 * Interpretamos como UTC, que é o que o emissor quis dizer com "fim do dia".
 */
export function parseDataCertificado(valor: string | null | undefined): Date | null {
  if (!valor) return null
  let s = valor.trim().replace(' ', 'T')
  if (s === '') return null

  // Data pura (`2026-08-15`) é tratada à parte porque ela TERMINA em `-15`, que o
  // teste de fuso leria como offset `-15`. Meia-noite UTC é o que "só a data" quer
  // dizer aqui.
  if (!s.includes(':')) {
    s = `${s}T00:00:00Z`
  } else if (TEM_FUSO.test(s)) {
    // `+00` é fuso VÁLIDO em Postgres e INVÁLIDO em ECMAScript — `new Date()` devolve
    // Invalid Date. Completar para `+00:00` é a diferença entre o grid funcionar e
    // ficar inteiro vermelho.
    s = s.replace(/([+-]\d{2})$/, '$1:00')
  } else {
    s = `${s}Z`
  }

  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function diasAte(expiresAt: string | null | undefined, hoje: Date = new Date()): number | null {
  const alvo = parseDataCertificado(expiresAt)
  if (!alvo) return null
  return Math.round((diaUtc(alvo) - diaUtc(hoje)) / 86_400_000)
}

/**
 * `status !== 'active'` derruba para vencido mesmo com data no futuro: um certificado
 * revogado ou suspenso não ingere nota, e a data de expiração dele continua lá,
 * intacta e irrelevante.
 */
export function avaliarCertificado(
  cert: CertificadoLike | null | undefined,
  hoje: Date = new Date(),
): AvaliacaoCertificado {
  if (!cert || (!cert.expires_at && !cert.status)) {
    return { estado: 'ausente', diasRestantes: null, expiraEm: null }
  }

  const diasRestantes = diasAte(cert.expires_at, hoje)
  const expiraEm = cert.expires_at ?? null

  if (cert.status !== null && cert.status !== undefined && cert.status !== 'active') {
    return { estado: 'vencido', diasRestantes, expiraEm }
  }
  // Sem data não há como afirmar validade; tratar como válido seria pintar de verde
  // uma empresa sobre a qual não sabemos nada.
  if (diasRestantes === null) return { estado: 'ausente', diasRestantes: null, expiraEm }
  if (diasRestantes < 0) return { estado: 'vencido', diasRestantes, expiraEm }
  if (diasRestantes <= DIAS_ALERTA) return { estado: 'vencendo', diasRestantes, expiraEm }
  return { estado: 'valido', diasRestantes, expiraEm }
}

/** Verde ou amarelo — é o que os dois KPIs de percentual contam como "com certificado válido". */
export function contaComoValido(estado: EstadoCertificado): boolean {
  return estado === 'valido' || estado === 'vencendo'
}

/** Ordem de urgência para a lista "Atenção" e para as células da linha do grid. */
export const PESO_URGENCIA: Record<EstadoCertificado, number> = {
  vencido: 0,
  ausente: 1,
  vencendo: 2,
  valido: 3,
}

/**
 * Mais urgente primeiro; dentro do mesmo estado, quem vence antes. `ausente` não tem
 * data, então empata por nome para a ordem não dançar entre dois carregamentos.
 */
export function compararUrgencia(
  a: { estado: EstadoCertificado; diasRestantes: number | null; nome?: string | null },
  b: { estado: EstadoCertificado; diasRestantes: number | null; nome?: string | null },
): number {
  const peso = PESO_URGENCIA[a.estado] - PESO_URGENCIA[b.estado]
  if (peso !== 0) return peso
  const da = a.diasRestantes
  const db = b.diasRestantes
  if (da !== null && db !== null && da !== db) return da - db
  if (da !== null && db === null) return -1
  if (da === null && db !== null) return 1
  return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')
}

export function formatarVencimento(expiresAt: string | null | undefined): string {
  const d = parseDataCertificado(expiresAt)
  if (!d) return '—'
  // timeZone UTC de novo de propósito: a data foi lida como UTC, tem de ser mostrada
  // como UTC. Formatar em horário local devolveria 14/08 para um vencimento em 15/08.
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

/** "vence em 12 dias" / "venceu há 3 dias" / "vence hoje" — o texto do tooltip. */
export function textoDias(diasRestantes: number | null): string {
  if (diasRestantes === null) return 'Sem certificado'
  if (diasRestantes === 0) return 'Vence hoje'
  if (diasRestantes < 0) {
    const d = Math.abs(diasRestantes)
    return `Venceu há ${d} ${d === 1 ? 'dia' : 'dias'}`
  }
  return `Vence em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}`
}
