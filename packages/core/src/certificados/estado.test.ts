import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COR_CERTIFICADO,
  avaliarCertificado,
  compararUrgencia,
  contaComoValido,
  diasAte,
  formatarVencimento,
  textoDias,
  type EstadoCertificado,
} from './estado.ts'

/**
 * Esta regra é lida por três consumidores (grid da web, lista do mobile, job de
 * alerta), e o que os testes protegem é que os três digam a MESMA coisa. Um quadrado
 * verde ao lado de uma notificação de "vencido" destrói a confiança na tela inteira,
 * e a notificação seria a que está certa.
 */

const HOJE = new Date('2026-07-30T12:00:00Z')
const estado = (c: { expires_at?: string | null; status?: string | null } | null): EstadoCertificado =>
  avaliarCertificado(c, HOJE).estado

test('ativo e longe do vencimento é válido', () => {
  assert.equal(estado({ expires_at: '2027-01-15T23:59:59', status: 'active' }), 'valido')
})

test('ativo dentro de 30 dias é vencendo', () => {
  assert.equal(estado({ expires_at: '2026-08-15T23:59:59', status: 'active' }), 'vencendo')
  // O limite é inclusive: exatamente 30 dias ainda alerta.
  assert.equal(estado({ expires_at: '2026-08-29T12:00:00', status: 'active' }), 'vencendo')
  assert.equal(estado({ expires_at: '2026-08-30T12:00:00', status: 'active' }), 'valido')
})

test('data no passado é vencido', () => {
  assert.equal(estado({ expires_at: '2026-07-29T23:59:59', status: 'active' }), 'vencido')
})

test('vence hoje ainda é vencendo, não vencido', () => {
  assert.equal(estado({ expires_at: '2026-07-30T23:59:59', status: 'active' }), 'vencendo')
})

test('status diferente de active derruba mesmo com data no futuro', () => {
  // Certificado revogado não ingere nota, e a data dele segue lá, intacta e irrelevante.
  assert.equal(estado({ expires_at: '2027-01-15T23:59:59', status: 'revoked' }), 'vencido')
  assert.equal(estado({ expires_at: '2027-01-15T23:59:59', status: 'expired' }), 'vencido')
  assert.equal(estado({ expires_at: '2027-01-15T23:59:59', status: 'suspended' }), 'vencido')
})

test('sem certificado na base é ausente — e ausente é vermelho, não cinza', () => {
  assert.equal(estado(null), 'ausente')
  assert.equal(estado(undefined as never), 'ausente')
  assert.equal(estado({}), 'ausente')
})

test('ativo sem data é ausente, não verde', () => {
  // Pintar de verde uma empresa sobre a qual não sabemos nada é o pior resultado.
  assert.equal(estado({ status: 'active', expires_at: null }), 'ausente')
})

test('data corrompida não vira verde nem quebra', () => {
  assert.equal(estado({ expires_at: 'não é data', status: 'active' }), 'ausente')
})

test('dias restantes conta DIAS, não horas', () => {
  // 30/07 12:00 → 15/08 23:59 são 16 dias e meio; a contagem é por dia de calendário.
  assert.equal(diasAte('2026-08-15T23:59:59', HOJE), 16)
  assert.equal(diasAte('2026-07-30T00:00:01', HOJE), 0)
  assert.equal(diasAte('2026-07-27T23:59:59', HOJE), -3)
  assert.equal(diasAte(null, HOJE), null)
})

test('vencido é laranja e ausente é vermelho — ações diferentes', () => {
  // Vencido: o cliente tinha certificado e deixou expirar, liga-se para renovar.
  // Ausente: o CNPJ nunca apareceu no endpoint, é investigação de cadastro.
  assert.equal(COR_CERTIFICADO.vencido, 'laranja')
  assert.equal(COR_CERTIFICADO.ausente, 'vermelho')
  assert.equal(COR_CERTIFICADO.valido, 'verde')
  assert.equal(COR_CERTIFICADO.vencendo, 'amarelo')
  // Mudar a cor NÃO muda o que conta como válido: os dois seguem fora do KPI.
  assert.equal(contaComoValido('vencido'), false)
  assert.equal(contaComoValido('ausente'), false)
})

test('os dois KPIs contam verde E amarelo como válido', () => {
  assert.equal(contaComoValido('valido'), true)
  assert.equal(contaComoValido('vencendo'), true)
  assert.equal(contaComoValido('vencido'), false)
  assert.equal(contaComoValido('ausente'), false)
})

test('urgência: vencido, ausente, vencendo, válido', () => {
  const itens = [
    { estado: 'valido' as const, diasRestantes: 200, nome: 'D' },
    { estado: 'vencendo' as const, diasRestantes: 10, nome: 'C' },
    { estado: 'ausente' as const, diasRestantes: null, nome: 'B' },
    { estado: 'vencido' as const, diasRestantes: -5, nome: 'A' },
  ]
  assert.deepEqual([...itens].sort(compararUrgencia).map((i) => i.nome), ['A', 'B', 'C', 'D'])
})

test('dentro do mesmo estado, quem vence antes vem primeiro', () => {
  const itens = [
    { estado: 'vencendo' as const, diasRestantes: 25, nome: 'depois' },
    { estado: 'vencendo' as const, diasRestantes: 3, nome: 'antes' },
  ]
  assert.deepEqual([...itens].sort(compararUrgencia).map((i) => i.nome), ['antes', 'depois'])
})

test('ausentes empatam por nome, para a ordem não dançar entre carregamentos', () => {
  const itens = [
    { estado: 'ausente' as const, diasRestantes: null, nome: 'Zeta' },
    { estado: 'ausente' as const, diasRestantes: null, nome: 'Alfa' },
  ]
  assert.deepEqual([...itens].sort(compararUrgencia).map((i) => i.nome), ['Alfa', 'Zeta'])
})

test('data sem fuso é lida como UTC, não como hora local', () => {
  // O endpoint manda "2026-08-15T23:59:59", sem fuso. Como hora local em UTC−3 isso
  // vira 16/08 em UTC, e aí worker (UTC) e browser (UTC−3) discordam da cor do
  // quadrado. Este teste roda igual em qualquer TZ — é o ponto dele.
  assert.equal(diasAte('2026-08-15T23:59:59', HOJE), 16)
  assert.equal(formatarVencimento('2026-08-15T23:59:59'), '15/08/2026')
  // Com fuso explícito, respeita o que veio — e 23:59:59−03:00 É 16/08 em UTC.
  assert.equal(formatarVencimento('2026-08-15T23:59:59Z'), '15/08/2026')
  assert.equal(diasAte('2026-08-15T23:59:59-03:00', HOJE), 17)
  // Só a data, sem hora, e o formato com espaço que o Postgres devolve.
  assert.equal(formatarVencimento('2026-08-15'), '15/08/2026')
  assert.equal(formatarVencimento('2026-08-15 23:59:59'), '15/08/2026')
})

test('offset de dois dígitos do Postgres (+00) é entendido', () => {
  // `timestamptz` sai como "2027-02-15 00:00:00+00". Isso é fuso VÁLIDO em Postgres e
  // INVÁLIDO em ECMAScript — `new Date()` devolve Invalid Date. Sem normalizar, toda
  // data viraria "sem certificado" e o grid inteiro ficaria vermelho.
  assert.equal(estado({ expires_at: '2027-02-15T00:00:00+00', status: 'active' }), 'valido')
  assert.equal(estado({ expires_at: '2026-08-11 00:00:00+00', status: 'active' }), 'vencendo')
  assert.equal(estado({ expires_at: '2026-07-25 00:00:00+00', status: 'active' }), 'vencido')
  assert.equal(formatarVencimento('2026-08-15 00:00:00+00'), '15/08/2026')
  // E o offset de quatro dígitos sem dois-pontos também.
  assert.equal(formatarVencimento('2026-08-15T12:00:00-0300'), '15/08/2026')
})

test('formatação em dd/mm/aaaa, sem escorregar de dia por fuso', () => {
  // Sem timeZone UTC, 23:59:59 em UTC vira o dia anterior no Brasil.
  assert.equal(formatarVencimento('2026-08-15T23:59:59'), '15/08/2026')
  assert.equal(formatarVencimento(null), '—')
  assert.equal(formatarVencimento('lixo'), '—')
})

test('texto de dias em pt-BR, com singular e plural', () => {
  assert.equal(textoDias(12), 'Vence em 12 dias')
  assert.equal(textoDias(1), 'Vence em 1 dia')
  assert.equal(textoDias(0), 'Vence hoje')
  assert.equal(textoDias(-1), 'Venceu há 1 dia')
  assert.equal(textoDias(-3), 'Venceu há 3 dias')
  assert.equal(textoDias(null), 'Sem certificado')
})
