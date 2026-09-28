import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  escolherCloser,
  fimDoExpedienteDaVoz,
  instanteNoFuso,
  janelasLivres,
  rotuloDaJanela,
  type ParametrosJanelas,
} from './agenda.ts'

const TZ = 'America/Sao_Paulo'
// Segunda 28/09/2026, 8h em SP.
const SEGUNDA_8H = new Date('2026-09-28T11:00:00Z')

function params(extra: Partial<ParametrosJanelas> = {}): ParametrosJanelas {
  return {
    agora: SEGUNDA_8H,
    horario: { hora_inicio: 9, hora_fim: 18, dias_semana: [1, 2, 3, 4, 5], timezone: TZ },
    horizonteDiasUteis: 10,
    duracaoMin: 30,
    bufferMin: 15,
    ocupados: [],
    reservas: [],
    mandatoId: 'mA',
    quantas: 3,
    ...extra,
  }
}

const sp = (dia: number, h: number, m = 0) => instanteNoFuso(2026, 9, dia, h, m, TZ)

test('instante no fuso: 10h de São Paulo é 13h UTC', () => {
  assert.equal(sp(29, 10).toISOString(), '2026-09-29T13:00:00.000Z')
})

test('as janelas respeitam antecedência, horário comercial e no máximo duas por dia', () => {
  const j = janelasLivres(params())
  assert.equal(j.length, 3)
  // Antecedência de 2h a partir das 8h: a primeira é às 10h de segunda.
  assert.equal(j[0]!.inicio.toISOString(), sp(28, 10).toISOString())
  // A segunda, duas horas depois.
  assert.equal(j[1]!.inicio.toISOString(), sp(28, 12).toISOString())
  // A terceira já é no dia seguinte (duas por dia no máximo).
  assert.equal(j[2]!.inicio.toISOString(), sp(29, 9).toISOString())
})

test('evento do closer bloqueia com o buffer dos dois lados', () => {
  const j = janelasLivres(params({ ocupados: [{ inicio: sp(28, 10), fim: sp(28, 11) }], quantas: 1 }))
  // 10h–11h ocupado + 15 min de buffer: 11h não serve (11h–11h15 dentro do buffer); 11h30 serve.
  assert.equal(j[0]!.inicio.toISOString(), sp(28, 11, 30).toISOString())
})

test('closer sem janela no horizonte: vai para o substituto', () => {
  const lotado = janelasLivres(params({ ocupados: [{ inicio: sp(1, 0), fim: sp(30 + 20, 0) }] }))
  assert.equal(lotado.length, 0)
  const livre = janelasLivres(params())
  const e = escolherCloser(
    { id: 'titular', ausenteAte: null, janelas: lotado },
    { id: 'substituto', ausenteAte: null, janelas: livre },
    SEGUNDA_8H,
  )
  assert.deepEqual(e.ok && [e.closerId, e.substituto], ['substituto', true])
})

test('titular de férias: substituto, mesmo com a agenda do titular livre', () => {
  const e = escolherCloser(
    { id: 'titular', ausenteAte: '2026-10-05', janelas: janelasLivres(params()) },
    { id: 'substituto', ausenteAte: null, janelas: janelasLivres(params()) },
    SEGUNDA_8H,
  )
  assert.equal(e.ok && e.closerId, 'substituto')
})

test('nenhum dos dois com janela: sem_janela (o gestor é avisado)', () => {
  const e = escolherCloser({ id: 't', ausenteAte: null, janelas: [] }, { id: 's', ausenteAte: null, janelas: [] }, SEGUNDA_8H)
  assert.deepEqual(e, { ok: false, motivo: 'sem_janela' })
  assert.deepEqual(escolherCloser(null, null, SEGUNDA_8H), { ok: false, motivo: 'sem_closer' })
})

test('reserva expirada não bloqueia nada', () => {
  const j = janelasLivres(params({
    quantas: 1,
    reservas: [{ inicio: sp(28, 10), fim: sp(28, 10, 30), expiraEm: new Date(SEGUNDA_8H.getTime() - 60_000), mandatoId: 'mB' }],
  }))
  assert.equal(j[0]!.inicio.toISOString(), sp(28, 10).toISOString())
})

test('duas conversas disputando o mesmo horário: a reserva viva de outro mandato bloqueia', () => {
  const reservaDeB = { inicio: sp(28, 10), fim: sp(28, 10, 30), expiraEm: new Date(SEGUNDA_8H.getTime() + 30 * 60_000), mandatoId: 'mB' }
  const paraA = janelasLivres(params({ quantas: 1, reservas: [reservaDeB], mandatoId: 'mA' }))
  assert.notEqual(paraA[0]!.inicio.toISOString(), sp(28, 10).toISOString())
  // O próprio mandato que reservou continua enxergando a janela dele.
  const paraB = janelasLivres(params({ quantas: 1, reservas: [reservaDeB], mandatoId: 'mB' }))
  assert.equal(paraB[0]!.inicio.toISOString(), sp(28, 10).toISOString())
})

test('fim de semana não entra', () => {
  // Sexta 02/10/2026 às 17h: nada cabe hoje com 2h de antecedência; a próxima é segunda 05/10.
  const sextaAs17 = instanteNoFuso(2026, 10, 2, 17, 0, TZ)
  const j = janelasLivres(params({ agora: sextaAs17, quantas: 1 }))
  assert.equal(j[0]!.inicio.toISOString(), instanteNoFuso(2026, 10, 5, 9, 0, TZ).toISOString())
  assert.match(rotuloDaJanela(j[0]!, TZ), /segunda/)
})

test('fim do expediente da Ana: hoje às 18h, ou o próximo dia útil quando falta menos de uma hora', () => {
  // Segunda, 28/09/2026, 10h em São Paulo → segunda 18h.
  assert.equal(fimDoExpedienteDaVoz(new Date('2026-09-28T13:00:00Z')).toISOString(), '2026-09-28T21:00:00.000Z')
  // Segunda 17h30: meia hora de fila não basta → terça 18h.
  assert.equal(fimDoExpedienteDaVoz(new Date('2026-09-28T20:30:00Z')).toISOString(), '2026-09-29T21:00:00.000Z')
  // Sexta 17h40 → segunda 18h (o fim de semana não conta).
  assert.equal(fimDoExpedienteDaVoz(new Date('2026-10-02T20:40:00Z')).toISOString(), '2026-10-05T21:00:00.000Z')
  // Sábado → segunda 18h.
  assert.equal(fimDoExpedienteDaVoz(new Date('2026-10-03T15:00:00Z')).toISOString(), '2026-10-05T21:00:00.000Z')
})
