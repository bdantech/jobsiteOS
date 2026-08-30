import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { CONFIG_COMUNICACAO_PADRAO } from '../comunicacao/schemas.js'
import { termosProibidos, temDescadastroNoCorpo } from './conteudo.js'
import { avaliarDestinatario, contarExclusoes, type FatosDoDestinatario } from './exclusao.js'
import { resolverDestinatario, resolverPorEmpresa, type ContatoCandidato } from './publico.js'
import { capacidadeDoDia, duracaoEstimada, planejarDia, repartirPorFolga } from './ritmo.js'
import { avaliarSaude, contasSuspeitas } from './saude.js'
import {
  LIMITES_PADRAO,
  MOTIVOS_EXCLUSAO,
  criarCampanhaSchema,
  lerLimites,
  preset,
} from './schemas.js'
import { escolherVariante, hash32, proximoPasso, sequenciaCessouPara } from './variantes.js'

// ─── Exclusão: um teste por motivo, como o §9 pede ──────────────────────────

const BASE: FatosDoDestinatario = {
  canal: 'email',
  tipoCampanha: 'prospeccao',
  identificador: 'joao@construtora.com.br',
  suprimido: false,
  baseLegal: 'relacao_comercial',
  temProcessoAtivo: false,
  gestaoOperacao: null,
  empresaJaEscolhida: false,
  emOutraCampanha: false,
  campanhasNoTrimestre: 0,
  maxCampanhas90d: 2,
  temConversaAberta: false,
  excluirConversaAberta: true,
  ultimoToqueEm: null,
  excluirContatadosDias: 14,
  agora: new Date('2026-08-30T12:00:00Z'),
}

describe('motor de exclusão', () => {
  it('inclui quem não bate em nenhuma porta', () => {
    assert.deepEqual(avaliarDestinatario(BASE), { incluir: true })
  })

  it('suprimido', () => {
    const r = avaliarDestinatario({ ...BASE, suprimido: true })
    assert.equal(r.incluir, false)
    assert.equal(r.motivo, 'suprimido')
  })

  it('processo jurídico ativo', () => {
    const r = avaliarDestinatario({ ...BASE, temProcessoAtivo: true })
    assert.equal(r.motivo, 'processo_juridico')
  })

  it('conta passiva sai da PROSPECÇÃO', () => {
    const r = avaliarDestinatario({ ...BASE, gestaoOperacao: 'passivo' })
    assert.equal(r.motivo, 'passivo')
  })

  it('conta passiva continua recebendo campanha operacional', () => {
    // O certificado dela vence do mesmo jeito. Tratar "não prospectar" como
    // "não falar" transformaria uma decisão comercial em silêncio operacional.
    const r = avaliarDestinatario({
      ...BASE,
      gestaoOperacao: 'passivo',
      tipoCampanha: 'operacional',
    })
    assert.equal(r.incluir, true)
  })

  it('sem contato no canal', () => {
    assert.equal(avaliarDestinatario({ ...BASE, identificador: null }).motivo, 'sem_contato')
    assert.equal(avaliarDestinatario({ ...BASE, identificador: '  ' }).motivo, 'sem_contato')
  })

  it('sem base legal', () => {
    assert.equal(avaliarDestinatario({ ...BASE, baseLegal: null }).motivo, 'sem_base_legal')
  })

  it('duplicado: outra pessoa da mesma empresa já entrou', () => {
    assert.equal(avaliarDestinatario({ ...BASE, empresaJaEscolhida: true }).motivo, 'duplicado')
  })

  it('já está em outra campanha ativa', () => {
    assert.equal(avaliarDestinatario({ ...BASE, emOutraCampanha: true }).motivo, 'outra_campanha')
  })

  it('frequência de 90 dias', () => {
    assert.equal(
      avaliarDestinatario({ ...BASE, campanhasNoTrimestre: 2, maxCampanhas90d: 2 }).motivo,
      'frequencia_90d',
    )
    assert.equal(
      avaliarDestinatario({ ...BASE, campanhasNoTrimestre: 1, maxCampanhas90d: 2 }).incluir,
      true,
    )
  })

  it('teto zero desliga a regra de frequência em vez de barrar todo mundo', () => {
    const r = avaliarDestinatario({ ...BASE, campanhasNoTrimestre: 9, maxCampanhas90d: 0 })
    assert.equal(r.incluir, true)
  })

  it('conversa aberta, e só quando a campanha pediu', () => {
    assert.equal(avaliarDestinatario({ ...BASE, temConversaAberta: true }).motivo, 'conversa_aberta')
    assert.equal(
      avaliarDestinatario({ ...BASE, temConversaAberta: true, excluirConversaAberta: false })
        .incluir,
      true,
    )
  })

  it('contatado recentemente, medido pela janela da campanha', () => {
    const ontem = new Date('2026-08-29T12:00:00Z')
    assert.equal(avaliarDestinatario({ ...BASE, ultimoToqueEm: ontem }).motivo, 'contatado_recente')
    const antigo = new Date('2026-07-01T12:00:00Z')
    assert.equal(avaliarDestinatario({ ...BASE, ultimoToqueEm: antigo }).incluir, true)
  })

  it('a ordem devolve o motivo mais grave, não o mais recente', () => {
    // Suprimido E sem base legal E em outra campanha: a pessoa precisa saber da
    // supressão, porque corrigir a base legal não a faria receber nada.
    const r = avaliarDestinatario({
      ...BASE,
      suprimido: true,
      baseLegal: null,
      emOutraCampanha: true,
    })
    assert.equal(r.motivo, 'suprimido')
  })

  it('o placar traz todos os motivos, inclusive os zerados', () => {
    const contagem = contarExclusoes(
      [{ incluir: false, motivo: 'suprimido' }, { incluir: true }],
      MOTIVOS_EXCLUSAO,
    )
    assert.equal(contagem.suprimido, 1)
    assert.equal(contagem.sem_contato, 0)
    assert.equal(Object.keys(contagem).length, MOTIVOS_EXCLUSAO.length)
  })
})

// ─── Resolvedor de destinatário ─────────────────────────────────────────────

function contato(over: Partial<ContatoCandidato>): ContatoCandidato {
  return {
    id: 'c1',
    empresa_id: 'e1',
    nome: 'João',
    cargo: null,
    email: 'joao@x.com.br',
    telefone: null,
    whatsapp: null,
    ponto_focal: false,
    nao_e_o_decisor: false,
    base_legal: 'relacao_comercial',
    criado_em: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('resolvedor de destinatário', () => {
  it('ponto focal ganha de todo o resto', () => {
    const r = resolverDestinatario('email', [
      contato({ id: 'a', cargo: 'CFO', base_legal: 'consentimento' }),
      contato({ id: 'b', ponto_focal: true, cargo: 'estagiário' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('quem não é o decisor perde para quem é', () => {
    const r = resolverDestinatario('email', [
      contato({ id: 'a', nao_e_o_decisor: true, cargo: 'CFO' }),
      contato({ id: 'b' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('aceite explícito ganha das outras bases', () => {
    const r = resolverDestinatario('email', [
      contato({ id: 'a' }),
      contato({ id: 'b', base_legal: 'formulario_aceite' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('cargo relevante desempata', () => {
    const r = resolverDestinatario('email', [
      contato({ id: 'a', cargo: 'Recepção' }),
      contato({ id: 'b', cargo: 'Diretor Financeiro' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('cargo com acento casa com a lista sem acento', () => {
    const r = resolverDestinatario('email', [
      contato({ id: 'a', cargo: 'Recepção' }),
      contato({ id: 'b', cargo: 'Sócio' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('quem não tem o canal nem concorre', () => {
    const r = resolverDestinatario('whatsapp', [
      contato({ id: 'a', ponto_focal: true, whatsapp: null, telefone: null }),
      contato({ id: 'b', whatsapp: '11999998888' }),
    ])
    assert.equal(r?.contato.id, 'b')
  })

  it('telefone serve de reserva quando não há campo whatsapp', () => {
    // A forma canônica é só de dígitos, igual à chave da conversa do 05A. O DDI
    // é acrescentado depois, pelo transporte (`paraE164Brasil`) — se fosse
    // acrescentado aqui, a campanha abriria uma thread com chave diferente da
    // que o webhook devolve, e a resposta cairia numa conversa nova.
    const r = resolverDestinatario('whatsapp', [contato({ telefone: '11 99999-8888' })])
    assert.equal(r?.identificador, '11999998888')
  })

  it('devolve null quando ninguém tem o canal — e isso é sem_contato, não filtro', () => {
    assert.equal(resolverDestinatario('whatsapp', [contato({})]), null)
  })

  it('a escolha é estável entre execuções', () => {
    const lista = [contato({ id: 'z' }), contato({ id: 'a' })]
    const um = resolverDestinatario('email', lista)?.contato.id
    const dois = resolverDestinatario('email', [...lista].reverse())?.contato.id
    assert.equal(um, dois)
  })

  it('uma empresa gera um destinatário', () => {
    const mapa = resolverPorEmpresa('email', [
      contato({ id: 'a', empresa_id: 'e1' }),
      contato({ id: 'b', empresa_id: 'e1', ponto_focal: true }),
      contato({ id: 'c', empresa_id: 'e2' }),
    ])
    assert.equal(mapa.size, 2)
    assert.equal(mapa.get('e1')?.contato.id, 'b')
  })
})

// ─── Ritmo ──────────────────────────────────────────────────────────────────

const JANELA = CONFIG_COMUNICACAO_PADRAO.janela

describe('distribuidor de ritmo', () => {
  it('sem contas declaradas (e-mail), o ritmo manda sozinho', () => {
    assert.equal(capacidadeDoDia(80, []), 80)
  })

  it('a capacidade é o mínimo entre o ritmo e a folga dos números', () => {
    const contas = [
      { id: 'a', numero: '1', tetoHoje: 40, enviadasHoje: 30 },
      { id: 'b', numero: '2', tetoHoje: 40, enviadasHoje: 0 },
    ]
    assert.equal(capacidadeDoDia(80, contas), 50)
    assert.equal(capacidadeDoDia(20, contas), 20)
  })

  it('número já estourado não recebe nada', () => {
    const contas = [{ id: 'a', numero: '1', tetoHoje: 20, enviadasHoje: 20 }]
    const plano = planejarDia({
      quantidade: 10,
      contas,
      janela: JANELA,
      respeitarJanela: true,
      agora: new Date('2026-09-01T13:00:00Z'),
    })
    assert.equal(plano.slots.length, 0)
    assert.equal(plano.adiados, 10)
  })

  it('a repartição é proporcional à folga — e o número novo NÃO fica com zero', () => {
    // O guloso pela maior folga daria as 30 ao maduro, e o número em warmup
    // receberia nada. Número que não envia não aquece: o guloso desligaria o
    // warmup fingindo protegê-lo.
    const contas = [
      { id: 'novo', numero: '1', tetoHoje: 20, enviadasHoje: 0 },
      { id: 'maduro', numero: '2', tetoHoje: 200, enviadasHoje: 0 },
    ]
    const plano = planejarDia({
      quantidade: 30,
      contas,
      janela: JANELA,
      respeitarJanela: true,
      agora: new Date('2026-09-01T13:00:00Z'),
    })
    const porConta = plano.slots.reduce<Record<string, number>>((acc, s) => {
      acc[s.contaId!] = (acc[s.contaId!] ?? 0) + 1
      return acc
    }, {})
    assert.equal(plano.slots.length, 30)
    assert.ok((porConta.novo ?? 0) > 0, 'o número em warmup precisa enviar para aquecer')
    assert.ok(porConta.maduro! > porConta.novo!, 'mas o maduro carrega a maior parte')
    assert.ok(porConta.novo! <= 20, 'e ninguém passa do próprio teto')
  })

  it('a repartição respeita o teto de cada conta mesmo quando a proporção pediria mais', () => {
    const contas = [
      { id: 'a', numero: '1', tetoHoje: 5, enviadasHoje: 0 },
      { id: 'b', numero: '2', tetoHoje: 5, enviadasHoje: 0 },
    ]
    const cotas = repartirPorFolga(10, contas)
    assert.equal(cotas.get('a'), 5)
    assert.equal(cotas.get('b'), 5)
  })

  it('as contas se intercalam no tempo em vez de esgotar uma de cada vez', () => {
    // 20 seguidas do mesmo número é a rajada que a detecção procura, mesmo
    // dentro do teto do dia.
    const contas = [
      { id: 'a', numero: '1', tetoHoje: 100, enviadasHoje: 0 },
      { id: 'b', numero: '2', tetoHoje: 100, enviadasHoje: 0 },
    ]
    const plano = planejarDia({
      quantidade: 10,
      contas,
      janela: JANELA,
      respeitarJanela: true,
      agora: new Date('2026-09-01T13:00:00Z'),
    })
    const sequencia = plano.slots.map((s) => s.contaId)
    const trocas = sequencia.filter((c, i) => i > 0 && c !== sequencia[i - 1]).length
    assert.ok(trocas >= 8, `esperava alternância, veio ${sequencia.join(',')}`)
  })

  it('os horários são crescentes e espalhados, não uma rajada', () => {
    const plano = planejarDia({
      quantidade: 10,
      contas: [],
      janela: JANELA,
      respeitarJanela: true,
      agora: new Date('2026-09-01T13:00:00Z'),
    })
    assert.equal(plano.slots.length, 10)
    for (let i = 1; i < plano.slots.length; i += 1) {
      assert.ok(plano.slots[i]!.quando.getTime() > plano.slots[i - 1]!.quando.getTime())
    }
    const primeiro = plano.slots[0]!.quando.getTime()
    const ultimo = plano.slots.at(-1)!.quando.getTime()
    assert.ok(ultimo - primeiro > 60_000)
  })

  it('fora da janela, o primeiro slot cai na próxima abertura', () => {
    // 03:00 UTC de uma terça = meia-noite em São Paulo.
    const madrugada = new Date('2026-09-01T03:00:00Z')
    const plano = planejarDia({
      quantidade: 3,
      contas: [],
      janela: JANELA,
      respeitarJanela: true,
      agora: madrugada,
    })
    assert.ok(plano.slots[0]!.quando.getTime() > madrugada.getTime())
  })

  it('a duração estimada fala em dias de ENVIO, não de calendário', () => {
    const r = duracaoEstimada({ total: 1240, ritmoPorDia: 80, diasDaSemana: [1, 2, 3, 4, 5] })
    assert.equal(r.dias, 16)
    assert.match(r.texto, /1\.240 mensagens/)
    assert.match(r.texto, /16 dias de envio/)
    assert.match(r.texto, /calendário/)
  })

  it('nada a enviar não vira "0 dias"', () => {
    assert.equal(duracaoEstimada({ total: 0, ritmoPorDia: 10, diasDaSemana: [1] }).texto, 'nada a enviar')
  })
})

// ─── Variantes e sequência ──────────────────────────────────────────────────

const VARIANTES = [
  { id: 'a', template_id: '00000000-0000-0000-0000-0000000000a1', peso: 1, passo: 1, dias_apos: 3 },
  { id: 'b', template_id: '00000000-0000-0000-0000-0000000000b1', peso: 1, passo: 1, dias_apos: 3 },
  { id: 'c', template_id: '00000000-0000-0000-0000-0000000000c1', peso: 1, passo: 2, dias_apos: 4 },
]

describe('variantes', () => {
  it('a mesma pessoa recebe sempre a mesma variante', () => {
    const um = escolherVariante(VARIANTES, 1, 'dest-1')?.id
    const dois = escolherVariante(VARIANTES, 1, 'dest-1')?.id
    assert.equal(um, dois)
  })

  it('a ordem do array não muda quem recebe o quê', () => {
    const um = escolherVariante(VARIANTES, 1, 'dest-42')?.id
    const dois = escolherVariante([...VARIANTES].reverse(), 1, 'dest-42')?.id
    assert.equal(um, dois)
  })

  it('a distribuição é razoavelmente equilibrada', () => {
    let a = 0
    for (let i = 0; i < 1000; i += 1) {
      if (escolherVariante(VARIANTES, 1, `dest-${i}`)?.id === 'a') a += 1
    }
    assert.ok(a > 400 && a < 600, `esperava ~500, veio ${a}`)
  })

  it('o peso desloca a distribuição', () => {
    const pesadas = [
      { ...VARIANTES[0]!, peso: 9 },
      { ...VARIANTES[1]!, peso: 1 },
    ]
    let a = 0
    for (let i = 0; i < 1000; i += 1) {
      if (escolherVariante(pesadas, 1, `dest-${i}`)?.id === 'a') a += 1
    }
    assert.ok(a > 850, `esperava ~900, veio ${a}`)
  })

  it('o passo entra no hash: o toque 2 não repete o toque 1', () => {
    // Se o passo não entrasse, o mesmo destinatário cairia sempre no mesmo
    // índice e metade da base receberia o mesmo texto duas vezes.
    const doisPassos = [
      ...VARIANTES.slice(0, 2),
      { ...VARIANTES[0]!, id: 'a2', passo: 2 },
      { ...VARIANTES[1]!, id: 'b2', passo: 2 },
    ]
    let iguais = 0
    for (let i = 0; i < 200; i += 1) {
      const p1 = escolherVariante(doisPassos, 1, `d${i}`)?.id
      const p2 = escolherVariante(doisPassos, 2, `d${i}`)?.id
      if (p1?.[0] === p2?.[0]) iguais += 1
    }
    assert.ok(iguais < 160, `correlação alta demais entre passos: ${iguais}/200`)
  })

  it('passo sem variante devolve null — é o fim da sequência, não um erro', () => {
    assert.equal(escolherVariante(VARIANTES, 3, 'x'), null)
  })

  it('o próximo passo conta a partir do toque anterior', () => {
    const enviada = new Date('2026-09-01T12:00:00Z')
    const p = proximoPasso(VARIANTES, 1, enviada)
    assert.equal(p?.passo, 2)
    assert.equal(p?.quando.toISOString(), '2026-09-05T12:00:00.000Z')
  })

  it('não existe passo 4', () => {
    const muitas = [...VARIANTES, { ...VARIANTES[0]!, id: 'd', passo: 3 }]
    assert.equal(proximoPasso(muitas, 3, new Date()), null)
  })

  it('para no primeiro sinal, qualquer um dos quatro', () => {
    const base = { respondeu: false, optout: false, suprimido: false, agenteAssumiu: false }
    assert.equal(sequenciaCessouPara(base), false)
    assert.equal(sequenciaCessouPara({ ...base, respondeu: true }), true)
    assert.equal(sequenciaCessouPara({ ...base, optout: true }), true)
    assert.equal(sequenciaCessouPara({ ...base, suprimido: true }), true)
    assert.equal(sequenciaCessouPara({ ...base, agenteAssumiu: true }), true)
  })

  it('o hash é estável', () => {
    assert.equal(hash32('abc'), hash32('abc'))
    assert.notEqual(hash32('abc'), hash32('abd'))
  })
})

// ─── Saúde de canal ─────────────────────────────────────────────────────────

describe('saúde de canal', () => {
  it('amostra pequena não alerta, por maior que seja o percentual', () => {
    const s = avaliarSaude({ enviadas: 3, optouts: 1, bounces: 0 }, LIMITES_PADRAO)
    assert.equal(s.optoutPct, 33.33)
    assert.equal(s.amostraSuficiente, false)
    assert.deepEqual(s.alertas, [])
  })

  it('acima do limiar, com amostra, alerta', () => {
    const s = avaliarSaude({ enviadas: 200, optouts: 8, bounces: 0 }, LIMITES_PADRAO)
    assert.equal(s.optoutPct, 4)
    assert.deepEqual(s.alertas, ['optout'])
  })

  it('bounce e opt-out são alertas independentes', () => {
    const s = avaliarSaude({ enviadas: 200, optouts: 10, bounces: 20 }, LIMITES_PADRAO)
    assert.deepEqual(s.alertas, ['optout', 'bounce'])
  })

  it('sem envio, os percentuais são nulos e não zero', () => {
    // Zero diria "está tudo ótimo"; nulo diz "ainda não sabemos".
    const s = avaliarSaude({ enviadas: 0, optouts: 0, bounces: 0 }, LIMITES_PADRAO)
    assert.equal(s.optoutPct, null)
    assert.equal(s.bouncePct, null)
  })

  it('acha a conta com entrega muito abaixo das irmãs', () => {
    const suspeitas = contasSuspeitas([
      { conta: 'boa1', enviadas: 100, entregues: 95 },
      { conta: 'boa2', enviadas: 100, entregues: 92 },
      { conta: 'ruim', enviadas: 100, entregues: 20 },
    ])
    assert.deepEqual(suspeitas.map((c) => c.conta), ['ruim'])
  })

  it('uma conta só não é comparável com nada', () => {
    assert.deepEqual(contasSuspeitas([{ conta: 'a', enviadas: 100, entregues: 5 }]), [])
  })

  it('conta com pouco volume não é julgada', () => {
    assert.deepEqual(
      contasSuspeitas([
        { conta: 'a', enviadas: 100, entregues: 95 },
        { conta: 'b', enviadas: 100, entregues: 94 },
        { conta: 'nova', enviadas: 3, entregues: 0 },
      ]),
      [],
    )
  })
})

// ─── Conteúdo ───────────────────────────────────────────────────────────────

describe('validação de conteúdo', () => {
  it('pega taxa ao mês', () => {
    const a = termosProibidos('Nossa taxa é de 1,29% a.m. para você.')
    assert.ok(a.some((x) => x.tipo === 'taxa'))
  })

  it('pega valor em reais', () => {
    assert.ok(termosProibidos('Antecipe até R$ 500.000 hoje.').some((x) => x.tipo === 'valor'))
    assert.ok(termosProibidos('Liberamos 2 milhões de reais.').some((x) => x.tipo === 'valor'))
  })

  it('pega limite prometido', () => {
    assert.ok(termosProibidos('Seu limite de 300 mil já está aprovado.').some((x) => x.tipo === 'limite'))
  })

  it('não acusa percentual inocente', () => {
    // "100% dos nossos clientes" não é taxa, e um validador que grita aqui é um
    // validador que as pessoas aprendem a ignorar.
    assert.deepEqual(termosProibidos('100% dos nossos clientes recomendam.'), [])
  })

  it('devolve os achados em ordem de leitura', () => {
    const a = termosProibidos('Antecipe por R$ 10 com taxa de 1% a.m.')
    assert.ok(a.length >= 2)
    assert.ok(a[0]!.posicao < a[1]!.posicao)
  })

  it('a mesma análise roda duas vezes com o mesmo resultado', () => {
    // A RegExp global guarda `lastIndex`; sem zerar, a segunda chamada pularia
    // o começo do texto.
    const texto = 'R$ 1 e R$ 2'
    assert.equal(termosProibidos(texto).length, termosProibidos(texto).length)
  })

  it('reconhece descadastro escrito à mão no corpo', () => {
    assert.equal(temDescadastroNoCorpo('Para sair da lista, clique aqui.'), true)
    assert.equal(temDescadastroNoCorpo('Bom dia, tudo bem?'), false)
  })
})

// ─── Schema ─────────────────────────────────────────────────────────────────

const CAMPANHA_OK = {
  nome: 'Reconquista Q3',
  tipo: 'winback' as const,
  canal: 'email' as const,
  origem_publico: 'segmento' as const,
  segmento_id: '00000000-0000-0000-0000-0000000000e1',
  variantes: [
    { id: 'a', template_id: '00000000-0000-0000-0000-0000000000a1', peso: 1, passo: 1, dias_apos: 3 },
  ],
}

describe('schema da campanha', () => {
  it('aceita o caso feliz', () => {
    assert.equal(criarCampanhaSchema.safeParse(CAMPANHA_OK).success, true)
  })

  it('exige a fonte que a origem do público promete', () => {
    const r = criarCampanhaSchema.safeParse({ ...CAMPANHA_OK, segmento_id: undefined })
    assert.equal(r.success, false)
  })

  it('lista manual vazia não é lista manual', () => {
    const r = criarCampanhaSchema.safeParse({
      ...CAMPANHA_OK,
      origem_publico: 'lista_manual',
      segmento_id: undefined,
      empresas_manuais: [],
    })
    assert.equal(r.success, false)
  })

  it('a sequência precisa começar no passo 1', () => {
    const r = criarCampanhaSchema.safeParse({
      ...CAMPANHA_OK,
      variantes: [{ ...CAMPANHA_OK.variantes[0]!, passo: 2 }],
    })
    assert.equal(r.success, false)
  })

  it('recusa variantes com id repetido', () => {
    const r = criarCampanhaSchema.safeParse({
      ...CAMPANHA_OK,
      variantes: [CAMPANHA_OK.variantes[0]!, CAMPANHA_OK.variantes[0]!],
    })
    assert.equal(r.success, false)
  })

  it('reconquista sem motivo de saída é recusada', () => {
    // Reativação genérica é spam com nostalgia — a regra do §2, verificável.
    const r = criarCampanhaSchema.safeParse({
      ...CAMPANHA_OK,
      origem_publico: 'preset',
      segmento_id: undefined,
      preset: 'winback_ex_clientes',
      preset_params: {},
    })
    assert.equal(r.success, false)
  })

  it('reconquista com motivo, ou com motivo por variante, passa', () => {
    for (const params of [{ motivo_saida: 'taxa_alta' }, { motivo_por_variante: true }]) {
      const r = criarCampanhaSchema.safeParse({
        ...CAMPANHA_OK,
        origem_publico: 'preset',
        segmento_id: undefined,
        preset: 'winback_ex_clientes',
        preset_params: params,
      })
      assert.equal(r.success, true, JSON.stringify(params))
    }
  })

  it('os limites caem no default quando o jsonb vem torto', () => {
    assert.deepEqual(lerLimites(null), LIMITES_PADRAO)
    assert.equal(lerLimites({ max_campanhas_ativas: 'muitas' }).max_campanhas_ativas, 3)
    assert.equal(lerLimites({ max_campanhas_ativas: 7 }).max_campanhas_ativas, 7)
  })

  it('todo preset tem um objetivo que o 05A conhece', () => {
    assert.equal(preset('winback_ex_clientes')?.objetivoSugerido, 'reativar')
    assert.equal(preset('nao_existe'), undefined)
  })
})
