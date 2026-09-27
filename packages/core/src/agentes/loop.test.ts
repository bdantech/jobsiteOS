import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IdFerramenta } from './ferramentas.ts'
import { executarCiclo, ferramentasComIntencao, type BlocoModelo, type EntradaCiclo, type RespostaModelo } from './loop.ts'
import { LivroOrcamento } from './orcamento.ts'
import { CONFIG_AGENTES_PADRAO } from './schemas.ts'

const PLANO = {
  plano: {
    objetivo_atual: 'Falar com o financeiro',
    hipotese: 'A Marcia indicou o Carlos',
    proximas_acoes: [{ acao: 'ligar', quando: '2026-09-30T15:30:00-03:00', contato: 'Carlos', por_que: 'horário indicado' }],
    bloqueios: [],
    confianca: 0.7,
  },
  motivo: 'contato novo',
}

const CONTATO = '11111111-1111-4111-8111-111111111111'

let seq = 0
const uso = (name: string, input: Record<string, unknown>): BlocoModelo => ({
  type: 'tool_use',
  id: `t${++seq}`,
  name,
  input: { intencao: `porque sim (${name})`, ...input },
})
const resp = (conteudo: BlocoModelo[], parada = 'tool_use'): RespostaModelo => ({ conteudo, parada, tokens: { entrada: 1000, saida: 200 } })

/** Um "modelo" que devolve as respostas do roteiro, uma por passo. */
function roteiro(respostas: RespostaModelo[]) {
  let i = 0
  const vistas: string[][] = []
  const modelo: EntradaCiclo['modelo'] = async (req) => {
    vistas.push(req.ferramentas.map((f) => f.name))
    const r = respostas[i++]
    if (!r) return resp([{ type: 'text', text: 'fim' }], 'end_turn')
    return r
  }
  return { modelo, vistas }
}

function porta(livro: LivroOrcamento, mandato = 'm1') {
  return {
    reservar: async (_f: IdFerramenta, valor: number) => {
      const r = livro.reservar({ mandatoId: mandato, agenteId: 'ana', valor })
      return r.ok ? { ok: true as const, reservaId: r.reservaId } : { ok: false as const, motivo: r.motivo, saldoCentavos: r.saldoCentavos }
    },
    consumir: async (id: string, v: number) => livro.consumir(id, v),
    estornar: async (id: string) => livro.estornar(id),
    consumirTokens: async (v: number) => livro.consumirDireto(mandato, v),
  }
}

function entrada(extra: Partial<EntradaCiclo>): EntradaCiclo {
  const livro = new LivroOrcamento(100_000)
  livro.definirMandato('m1', 5_000)
  return {
    system: 's',
    contexto: 'c',
    disponiveis: ['consultar_contatos', 'enviar_whatsapp', 'ligar', 'atualizar_plano', 'escalar_humano', 'encerrar_mandato'],
    modelo: roteiro([]).modelo,
    executar: async () => ({ ok: true, resultado: { ok: true } }),
    orcamento: porta(livro),
    precos: CONFIG_AGENTES_PADRAO.precos,
    saldoInicialCentavos: 5_000,
    maxPassos: 8,
    prazoMs: 60_000,
    ...extra,
  }
}

test('o modelo vê `intencao` como argumento obrigatório de toda ferramenta', () => {
  const [t] = ferramentasComIntencao(['enviar_whatsapp'])
  const schema = t!.input_schema as { required: string[]; properties: Record<string, unknown> }
  assert.equal(schema.required[0], 'intencao')
  assert.ok('intencao' in schema.properties)
})

test('ciclo feliz: ferramenta, plano, fim — a intenção vai para a ação registrada', async () => {
  const { modelo } = roteiro([
    resp([uso('enviar_whatsapp', { contato_id: CONTATO, texto: 'Oi, Carlos!' })]),
    resp([uso('atualizar_plano', PLANO)]),
    resp([{ type: 'text', text: 'Feito.' }], 'end_turn'),
  ])
  const registradas: string[] = []
  const r = await executarCiclo(entrada({ modelo, aoExecutar: (a) => void registradas.push(a.intencao) }))
  assert.equal(r.erro, null)
  assert.equal(r.planoAtualizado, true)
  assert.deepEqual(r.acoes.map((a) => a.ferramenta), ['enviar_whatsapp', 'atualizar_plano'])
  assert.equal(registradas[0], 'porque sim (enviar_whatsapp)')
  // Tokens contados em TODO passo (3 chamadas ao modelo).
  assert.deepEqual(r.tokens, { entrada: 3000, saida: 600 })
  assert.ok(r.custoTokensCentavos > 0)
})

test('passo esgotado no meio: sem plano atualizado, o ciclo termina com erro registrado', async () => {
  const { modelo } = roteiro([
    resp([uso('consultar_contatos', {})]),
    resp([uso('consultar_contatos', {})]),
    resp([uso('consultar_contatos', {})]),
  ])
  const r = await executarCiclo(entrada({ modelo, maxPassos: 2 }))
  assert.equal(r.passos, 2)
  assert.equal(r.erro, 'passos_esgotados')
  assert.equal(r.planoAtualizado, false)
})

test('ferramenta paga sem orçamento: não aparece para o modelo', async () => {
  const { modelo, vistas } = roteiro([resp([uso('atualizar_plano', PLANO)]), resp([{ type: 'text', text: 'ok' }], 'end_turn')])
  // Saldo de R$ 1,00: `ligar` (R$ 3,50) some da lista; WhatsApp (R$ 0,02) fica.
  await executarCiclo(entrada({ modelo, saldoInicialCentavos: 100 }))
  assert.ok(!vistas[0]!.includes('ligar'))
  assert.ok(vistas[0]!.includes('enviar_whatsapp'))
  assert.ok(vistas[0]!.includes('atualizar_plano'))
})

test('reserva recusada pelo banco volta como erro ao modelo e a ferramenta some dos passos seguintes', async () => {
  const livro = new LivroOrcamento(100) // o mês só tem R$ 1,00, mas o saldo "achado" era maior
  livro.definirMandato('m1', 5_000)
  const { modelo, vistas } = roteiro([
    resp([uso('ligar', { contato_id: CONTATO, objetivo: 'ofertar_antecipacao', motivo: 'ofertar a NF' })]),
    resp([uso('atualizar_plano', PLANO)]),
  ])
  let executou = false
  const r = await executarCiclo(
    entrada({ modelo, orcamento: porta(livro), executar: async (id) => ((id === 'ligar' && (executou = true)), { ok: true }) }),
  )
  assert.equal(executou, false)
  assert.equal(r.acoes[0]!.ok, false)
  assert.match(r.acoes[0]!.erro!, /Orçamento insuficiente/)
  assert.ok(!vistas[1]!.includes('ligar'))
})

test('ferramenta que falha: a reserva é estornada e o erro volta ao modelo', async () => {
  const livro = new LivroOrcamento(100_000)
  livro.definirMandato('m1', 5_000)
  const { modelo } = roteiro([
    resp([uso('ligar', { contato_id: CONTATO, objetivo: 'ofertar_antecipacao', motivo: 'ofertar a NF' })]),
    resp([uso('atualizar_plano', PLANO)]),
  ])
  const r = await executarCiclo(
    entrada({
      modelo,
      orcamento: porta(livro),
      executar: async (id) => (id === 'ligar' ? { ok: false, erro: 'A Ana (v1) só liga para ofertar antecipação.' } : { ok: true }),
    }),
  )
  assert.equal(r.acoes[0]!.ok, false)
  assert.equal(r.acoes[0]!.custoCentavos, 0)
  assert.equal(livro.estado.reservado, 0)
  assert.equal(r.custoFerramentasCentavos, 0)
  assert.equal(r.planoAtualizado, true)
})

test('ferramenta que lança exceção é tratada como falha, não derruba o ciclo', async () => {
  const { modelo } = roteiro([resp([uso('consultar_contatos', {})]), resp([uso('atualizar_plano', PLANO)])])
  const r = await executarCiclo(
    entrada({
      modelo,
      executar: async (id) => {
        if (id === 'consultar_contatos') throw new Error('banco fora')
        return { ok: true }
      },
    }),
  )
  assert.equal(r.acoes[0]!.ok, false)
  assert.equal(r.erro, null)
})

test('ciclo sem atualizar_plano: o loop cobra uma vez; se não vier, erro `sem_plano`', async () => {
  const { modelo } = roteiro([
    resp([{ type: 'text', text: 'Mandei a mensagem.' }], 'end_turn'),
    resp([{ type: 'text', text: 'Pronto.' }], 'end_turn'),
  ])
  const r = await executarCiclo(entrada({ modelo }))
  assert.equal(r.passos, 2)
  assert.equal(r.erro, 'sem_plano')

  // Com a cobrança atendida, não é erro.
  const obediente = roteiro([
    resp([{ type: 'text', text: 'Mandei.' }], 'end_turn'),
    resp([uso('atualizar_plano', PLANO)]),
    resp([{ type: 'text', text: 'ok' }], 'end_turn'),
  ])
  const r2 = await executarCiclo(entrada({ modelo: obediente.modelo }))
  assert.equal(r2.erro, null)
})

test('ferramenta terminal encerra o ciclo sem exigir plano', async () => {
  const { modelo } = roteiro([
    resp([uso('escalar_humano', { motivo: 'Pediu para falar com uma pessoa.' }), uso('enviar_whatsapp', { contato_id: CONTATO, texto: 'x' })]),
  ])
  let enviou = false
  const r = await executarCiclo(
    entrada({ modelo, executar: async (id) => ((id === 'enviar_whatsapp' && (enviou = true)), { ok: true }) }),
  )
  assert.equal(r.terminal, 'escalar_humano')
  assert.equal(r.erro, null)
  assert.equal(enviou, false)
})

test('argumentos inválidos não executam e voltam como erro', async () => {
  const { modelo } = roteiro([
    resp([uso('enviar_whatsapp', { contato_id: 'nao-e-uuid', texto: '' })]),
    resp([uso('atualizar_plano', PLANO)]),
  ])
  let executou = false
  const r = await executarCiclo(entrada({ modelo, executar: async (id) => ((id === 'enviar_whatsapp' && (executou = true)), { ok: true }) }))
  assert.equal(executou, false)
  assert.match(r.acoes[0]!.erro!, /Argumentos inválidos/)
})

test('limite de tempo encerra o ciclo', async () => {
  let t = 0
  const { modelo } = roteiro([resp([uso('consultar_contatos', {})]), resp([uso('consultar_contatos', {})])])
  const r = await executarCiclo(entrada({ modelo, prazoMs: 1_000, agora: () => (t += 800) }))
  assert.equal(r.erro, 'tempo_esgotado')
})
