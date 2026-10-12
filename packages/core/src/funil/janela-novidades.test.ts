import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CALENDARIO_SO_FIM_DE_SEMANA,
  CONFIG_NOVIDADES_PADRAO as CFG,
  calcularInicioDaJanela,
  descreverJanela,
  ehNovoDesdeAVisita,
  inicioJanelaNovidades,
  instanteDoExpediente,
  lerConfigNovidades,
  lerDataHoraDigitada,
  montarCalendario,
  resolverJanelaNovidades,
  textoDeEntrada,
  textoDeReentrada,
} from './janela-novidades.ts'

/** Hora de Brasília (-03:00), que é como a regra é escrita. */
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`)

// Outubro de 2026: 19 é segunda, 16 é sexta, 15 é quinta.
const cal = (...feriados: string[]) =>
  montarCalendario([
    // Um nacional qualquer do ano, só para o calendário constar como importado.
    { data: '2026-01-01', origem: 'brasilapi' },
    ...feriados.map((data) => ({ data, origem: 'manual' })),
  ])

const inicio = (agora: Date, c = cal()) => inicioJanelaNovidades(agora, c, CFG).toISOString()

test('segunda 09:00 → sexta 18:00', () => {
  assert.equal(inicio(sp('2026-10-19', '09:00')), sp('2026-10-16', '18:00').toISOString())
})

test('terça 15:00 → segunda 18:00', () => {
  assert.equal(inicio(sp('2026-10-20', '15:00')), sp('2026-10-19', '18:00').toISOString())
})

test('quarta 08:00, com terça feriado → segunda 18:00', () => {
  assert.equal(inicio(sp('2026-10-21', '08:00'), cal('2026-10-20')), sp('2026-10-19', '18:00').toISOString())
})

test('segunda 10:00, com sexta feriado emendado → quinta 18:00', () => {
  assert.equal(inicio(sp('2026-10-19', '10:00'), cal('2026-10-16')), sp('2026-10-15', '18:00').toISOString())
})

test('sexta 20:00 → a própria sexta 18:00 (janela de 2h)', () => {
  assert.equal(inicio(sp('2026-10-16', '20:00')), sp('2026-10-16', '18:00').toISOString())
})

test('sábado 11:00 → sexta 18:00', () => {
  assert.equal(inicio(sp('2026-10-17', '11:00')), sp('2026-10-16', '18:00').toISOString())
})

test('domingo 23:00 → sexta 18:00', () => {
  assert.equal(inicio(sp('2026-10-18', '23:00')), sp('2026-10-16', '18:00').toISOString())
})

test('às 18:00 em ponto o expediente de hoje ainda não acabou: vale o de ontem', () => {
  assert.equal(inicio(sp('2026-10-20', '18:00')), sp('2026-10-19', '18:00').toISOString())
})

test('feriado trabalhado além do expediente não vira início de janela', () => {
  // Terça feriado, 20:00: o último expediente útil ainda é o de segunda.
  assert.equal(inicio(sp('2026-10-20', '20:00'), cal('2026-10-20')), sp('2026-10-19', '18:00').toISOString())
})

test('o dia é o de Brasília: 22:30 de sexta já é sábado em UTC', () => {
  // 01:30Z de sábado = 22:30 de sexta em São Paulo. Em UTC a conta leria "sábado".
  const agora = new Date('2026-10-17T01:30:00Z')
  assert.equal(inicio(agora), sp('2026-10-16', '18:00').toISOString())
})

test('o expediente configurado desloca a borda', () => {
  const r = inicioJanelaNovidades(sp('2026-10-19', '09:00'), cal(), { expediente_fim: '17:30' })
  assert.equal(r.toISOString(), sp('2026-10-16', '17:30').toISOString())
})

test('horário de verão: a janela não pula nem duplica hora', () => {
  // Em 2018 São Paulo adiantou o relógio à meia-noite de domingo, 4/11 (-03 → -02).
  // Sexta 2/11 foi Finados. Segunda 5/11, 09:00 (-02:00): o último expediente útil é
  // o de quinta, 1/11, às 18:00 no fuso DAQUELE dia (-03:00) = 21:00Z.
  const c = montarCalendario([{ data: '2018-11-02', origem: 'brasilapi' }])
  const agora = new Date('2018-11-05T09:00:00-02:00')
  assert.equal(inicioJanelaNovidades(agora, c, CFG).toISOString(), '2018-11-01T21:00:00.000Z')

  // E no próprio dia já no horário novo: segunda 20:00 → segunda 18:00 (-02:00) = 20:00Z.
  const noite = new Date('2018-11-05T20:00:00-02:00')
  assert.equal(inicioJanelaNovidades(noite, c, CFG).toISOString(), '2018-11-05T20:00:00.000Z')

  // 18:00 de parede é 18:00 de parede dos dois lados da virada.
  assert.equal(instanteDoExpediente('2018-11-03', '18:00').toISOString(), '2018-11-03T21:00:00.000Z')
  assert.equal(instanteDoExpediente('2018-11-04', '18:00').toISOString(), '2018-11-04T20:00:00.000Z')
  // A volta: 17/02/2018, meia-noite de sábado para domingo (-02 → -03).
  assert.equal(instanteDoExpediente('2018-02-16', '18:00').toISOString(), '2018-02-16T20:00:00.000Z')
  assert.equal(instanteDoExpediente('2018-02-19', '18:00').toISOString(), '2018-02-19T21:00:00.000Z')
})

test('calendário indisponível: só fim de semana conta, avisa, e nunca volta vazio', () => {
  const r = calcularInicioDaJanela(sp('2026-10-19', '09:00'), CALENDARIO_SO_FIM_DE_SEMANA, CFG)
  assert.equal(r.inicio.toISOString(), sp('2026-10-16', '18:00').toISOString())
  assert.equal(r.feriadosConsiderados, false)

  const comCalendario = calcularInicioDaJanela(sp('2026-10-19', '09:00'), cal(), CFG)
  assert.equal(comCalendario.feriadosConsiderados, true)
})

test('feriado manual sem importação nacional conta, mas o aviso continua', () => {
  // O gestor cadastrou a emenda antes de a BrasilAPI responder pela primeira vez.
  const c = montarCalendario([{ data: '2026-10-16', origem: 'manual' }])
  const r = calcularInicioDaJanela(sp('2026-10-19', '10:00'), c, CFG)
  assert.equal(r.inicio.toISOString(), sp('2026-10-15', '18:00').toISOString())
  assert.equal(r.feriadosConsiderados, false)
})

test('virada de ano: o aviso aparece se o ano anterior não foi importado', () => {
  // Segunda 4/1/2027, 08:00. Sexta 1/1 é feriado; o último expediente é quinta 31/12/2026.
  const so2027 = montarCalendario([{ data: '2027-01-01', origem: 'brasilapi' }])
  const r = calcularInicioDaJanela(sp('2027-01-04', '08:00'), so2027, CFG)
  assert.equal(r.inicio.toISOString(), sp('2026-12-31', '18:00').toISOString())
  assert.equal(r.feriadosConsiderados, false)
})

test('um calendário absurdo ainda devolve uma janela', () => {
  const tudo: { data: string; origem: string }[] = []
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2026, 9, 19) - i * 86_400_000)
    tudo.push({ data: d.toISOString().slice(0, 10), origem: 'manual' })
  }
  const agora = sp('2026-10-19', '09:00')
  const r = calcularInicioDaJanela(agora, montarCalendario(tudo), CFG)
  assert.ok(r.inicio.getTime() < agora.getTime())
  assert.equal(r.feriadosConsiderados, false)
})

test('as opções do seletor', () => {
  const agora = sp('2026-10-20', '15:00')
  const j = (o: Parameters<typeof resolverJanelaNovidades>[0], p?: { de?: Date; ate?: Date }) =>
    resolverJanelaNovidades(o, agora, cal(), CFG, p)

  assert.equal(j('expediente')?.de.toISOString(), sp('2026-10-19', '18:00').toISOString())
  assert.equal(j('seis_horas')?.de.toISOString(), sp('2026-10-20', '09:00').toISOString())
  assert.equal(j('hoje')?.de.toISOString(), sp('2026-10-20', '09:00').toISOString())
  assert.equal(j('sete_dias')?.de.toISOString(), sp('2026-10-13', '15:00').toISOString())
  assert.equal(j('expediente')?.ate, null)

  // Personalizado sem início não é filtro; com as pontas invertidas, também não.
  assert.equal(j('personalizado'), null)
  assert.equal(j('personalizado', { de: sp('2026-10-10', '08:00'), ate: sp('2026-10-09', '08:00') }), null)
  const p = j('personalizado', { de: sp('2026-10-01', '08:00'), ate: sp('2026-10-09', '18:00') })
  assert.equal(p?.ate?.toISOString(), sp('2026-10-09', '18:00').toISOString())
})

test('"hoje" antes de o expediente abrir começa à meia-noite, não no futuro', () => {
  const r = resolverJanelaNovidades('hoje', sp('2026-10-20', '07:30'), cal(), CFG)
  assert.equal(r?.de.toISOString(), sp('2026-10-20', '00:00').toISOString())
})

test('a janela por extenso', () => {
  const agora = sp('2026-10-19', '09:00')
  assert.equal(
    descreverJanela({ de: sp('2026-10-16', '18:00'), ate: null }, agora, 23),
    'Mostrando o que entrou desde sexta, 16/10, às 18:00 — 23 itens',
  )
  assert.equal(
    descreverJanela({ de: sp('2026-10-19', '03:00'), ate: null }, agora, 1),
    'Mostrando o que entrou desde hoje às 03:00 — 1 item',
  )
  assert.equal(
    descreverJanela({ de: sp('2026-10-18', '18:00'), ate: null }, agora),
    'Mostrando o que entrou desde ontem, 18/10, às 18:00',
  )
  assert.equal(
    descreverJanela({ de: sp('2026-10-01', '08:00'), ate: sp('2026-10-09', '18:00') }, agora, 1234),
    'Mostrando o que entrou entre quinta, 01/10, às 08:00 e sexta, 09/10, às 18:00 — 1.234 itens',
  )
})

test('o carimbo do card', () => {
  const agora = sp('2026-10-19', '10:00')
  assert.equal(textoDeEntrada(sp('2026-10-19', '09:40').toISOString(), agora), 'entrou há 20 min')
  assert.equal(textoDeEntrada(sp('2026-10-19', '08:00').toISOString(), agora), 'entrou há 2h')
  assert.equal(textoDeEntrada(sp('2026-10-18', '19:40').toISOString(), agora), 'entrou ontem 19:40')
  assert.equal(textoDeEntrada(sp('2026-10-16', '19:40').toISOString(), agora), 'entrou sexta 19:40')
  assert.equal(textoDeEntrada(sp('2026-10-03', '19:40').toISOString(), agora), 'entrou em 03/10')
  assert.equal(textoDeEntrada(null, agora), null)
})

test('a reentrada diz o motivo', () => {
  assert.equal(textoDeReentrada('2026-10-19T12:00:00Z', 'sacado_aprovado'), 'voltou ao funil: sacado aprovado')
  assert.equal(textoDeReentrada('2026-10-19T12:00:00Z', 'carteira'), 'voltou ao funil: entrou na sua carteira')
  assert.equal(textoDeReentrada('2026-10-19T12:00:00Z', null), 'voltou ao funil')
  assert.equal(textoDeReentrada(null, 'carteira'), null)
})

test('o selo compara com a visita ANTERIOR', () => {
  assert.equal(ehNovoDesdeAVisita('2026-10-19T12:00:00Z', '2026-10-19T11:00:00Z'), true)
  assert.equal(ehNovoDesdeAVisita('2026-10-19T10:00:00Z', '2026-10-19T11:00:00Z'), false)
  // Primeira visita da vida: sem marcador anterior, nada é "novo" — tudo é.
  assert.equal(ehNovoDesdeAVisita('2026-10-19T12:00:00Z', null), false)
})

test('config torta volta ao padrão em vez de quebrar a tela', () => {
  assert.deepEqual(lerConfigNovidades(null), CFG)
  assert.deepEqual(lerConfigNovidades({ expediente_inicio: '19:00', expediente_fim: '18:00' }), CFG)
  assert.equal(lerConfigNovidades({ expediente_fim: '17:00' }).expediente_fim, '17:00')
})

test('a data digitada no celular é hora de Brasília, e texto pela metade não é data', () => {
  assert.equal(lerDataHoraDigitada('10/10/2026 18:00')?.toISOString(), sp('2026-10-10', '18:00').toISOString())
  assert.equal(lerDataHoraDigitada('1/9/2026')?.toISOString(), sp('2026-09-01', '00:00').toISOString())
  assert.equal(lerDataHoraDigitada('10/10/2026 18'), null)
  assert.equal(lerDataHoraDigitada('31/02/2026 10:00'), null)
  assert.equal(lerDataHoraDigitada('10/13/2026'), null)
  assert.equal(lerDataHoraDigitada(''), null)
})
