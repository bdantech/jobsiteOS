import type { JanelaEnvio } from './schemas.js'

/**
 * A janela de envio (§5), e a decisão que ela carrega: fora da janela a mensagem
 * é AGENDADA, nunca descartada.
 *
 * Uma mensagem gerada às 22h não é errada, é cedo demais. Descartá-la perde o
 * toque — e o toque é o produto. Mandá-la manda WhatsApp de madrugada para um
 * fornecedor, que custa a relação inteira.
 *
 * ─── POR QUE A CONTA É FEITA COM `Intl`, E NÃO COM OFFSET FIXO ──────────────
 * São Paulo já teve horário de verão e pode voltar a ter. Um `-3` fixo faz a
 * janela abrir e fechar uma hora errada durante meio ano — e o erro aparece como
 * mensagens saindo às 8h, o que ninguém liga ao código do fuso.
 */

interface PartesLocais {
  ano: number
  mes: number
  dia: number
  hora: number
  minuto: number
  /** 1 = segunda … 7 = domingo (ISO), como a config guarda. */
  diaSemana: number
}

const DIAS_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export function partesNoFuso(instante: Date, timezone: string): PartesLocais {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const p = Object.fromEntries(fmt.formatToParts(instante).map((x) => [x.type, x.value]))
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    // `hour12: false` em en-US devolve 24 para a meia-noite, não 0.
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
    diaSemana: DIAS_ISO[p.weekday ?? 'Mon'] ?? 1,
  }
}

export function dentroDaJanela(instante: Date, janela: JanelaEnvio): boolean {
  const l = partesNoFuso(instante, janela.timezone)
  if (!janela.dias_semana.includes(l.diaSemana)) return false
  return l.hora >= janela.hora_inicio && l.hora < janela.hora_fim
}

/**
 * O instante da próxima abertura. Devolve o próprio `instante` quando já estamos
 * dentro — quem chama não precisa perguntar duas coisas.
 *
 * Avança de hora em hora e não de dia em dia porque o passo de dia perderia a
 * abertura de hoje: às 7h de uma terça a próxima abertura é às 9h da MESMA terça.
 * O limite de 14 dias é a rede de segurança para uma config impossível (uma janela
 * de `dias_semana: []`, por exemplo) — sem ele o laço não termina.
 */
export function proximaAbertura(instante: Date, janela: JanelaEnvio): Date {
  if (dentroDaJanela(instante, janela)) return instante

  const cursor = new Date(instante.getTime())
  // Zera minutos/segundos: a abertura é no topo da hora.
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(0)

  for (let i = 0; i < 24 * 14; i++) {
    cursor.setUTCHours(cursor.getUTCHours() + 1)
    if (dentroDaJanela(cursor, janela)) return cursor
  }
  // Janela impossível: devolve o instante original e deixa o chamador enviar.
  // Silenciar por 14 dias seria pior que a etiqueta que a janela protege.
  return instante
}

/**
 * A próxima abertura DEPOIS DA VIRADA DO DIA local.
 *
 * ── PARA QUE SERVE ──────────────────────────────────────────────────────────
 * Teto diário — da conta (warmup) ou da thread — não é "espere um pouco": é "hoje
 * acabou". O que a fila precisa saber é quando o contador ZERA, e ele zera na virada
 * do dia local, não daqui a N horas.
 *
 * ── A CICATRIZ ──────────────────────────────────────────────────────────────
 * A fila adiava com `agora + 12h`, sob um comentário que dizia "adia para a próxima
 * abertura". Doze horas não são a próxima abertura de nada: uma mensagem barrada pelo
 * teto às 10h15 de uma terça reaparecia às 22h15 da terça — de noite, e ainda no
 * mesmo dia cujo teto ela tinha estourado.
 *
 * Em 15/09/2026 foram 36 mensagens assim, num dia de 82 pedidas contra um teto de
 * warmup de ~40. O SDR relatou mensagens saindo 22h30. Elas saíram porque o adiamento
 * errado se somou a um segundo defeito (ver `forcar_janela` na 0219): o campo que
 * guardava o adiamento era o MESMO que dizia "esta mensagem pode furar a janela".
 *
 * Voltando pela virada do dia, o teto de amanhã é outro e a janela volta a valer.
 */
export function proximaAberturaAposVirada(instante: Date, janela: JanelaEnvio): Date {
  const hoje = partesNoFuso(instante, janela.timezone)
  const cursor = new Date(instante.getTime())
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(0)

  // Três dias de margem: qualquer fuso vira em menos de 24h, e o excedente só existe
  // para que uma config estranha não vire laço infinito.
  for (let i = 0; i < 24 * 3; i++) {
    cursor.setUTCHours(cursor.getUTCHours() + 1)
    const l = partesNoFuso(cursor, janela.timezone)
    if (l.dia !== hoje.dia || l.mes !== hoje.mes || l.ano !== hoje.ano) {
      return proximaAbertura(cursor, janela)
    }
  }
  return proximaAbertura(instante, janela)
}
