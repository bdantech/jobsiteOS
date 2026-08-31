import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { extrair, parseNumero, somarCartorios } from './directd-parser.ts'

/**
 * O parser do IEPTB Online, contra o retorno REAL.
 *
 * O payload abaixo é uma consulta de verdade gravada em `protestos_consultas`
 * (CNPJ mascarado). Ele existe aqui porque três bugs de GRAFIA passaram
 * despercebidos por meses: `numeroTotalProtestos` faltava na lista de chaves da
 * raiz, `numeroTotalProtestosUF` estava escrito `totalNumProtestosUf`, e o
 * fallback desistia de descer aos cartórios assim que achava o valor. O efeito
 * era um zero silencioso: 20 das 24 consultas com protesto gravaram
 * `qtd_protestos = 0` tendo valor.
 *
 * Um teste com payload inventado não teria pego nenhum dos três.
 */

const IEPTB_REAL = {
  metaDados: { consultaNome: 'Protestos Nacional' },
  retorno: {
    observacoes: 'A entidade possui protestos',
    constamProtestos: true,
    documentoConsultado: '00.000.000/0001-00',
    valorTotalProtestos: 'R$ 11.351,49',
    numeroTotalProtestos: 1,
    protestos: [
      {
        estado: 'PR',
        numeroTotalProtestosUF: 1,
        valorTotalProtestosEstado: 'R$ 11.351,49',
        cartorios: [
          {
            cidade: 'CURITIBA',
            codigoCidade: '4106902',
            numeroProtestos: 1,
            valorTotalProtestosCartorio: 'R$ 11.351,49',
            titulos: [
              {
                documento: '00.000.000/0001-00',
                dataProtesto: '07/07/2026',
                valorProtestado: 'R$ 11.351,49',
              },
            ],
          },
        ],
      },
    ],
  },
}

describe('parseNumero', () => {
  it('lê o formato BR, onde ponto é milhar e vírgula é decimal', () => {
    assert.equal(parseNumero('293.265,96'), 293265.96)
    assert.equal(parseNumero('R$ 11.351,49'), 11351.49)
  })

  it('sem vírgula, o ponto é o decimal — e não se apaga', () => {
    assert.equal(parseNumero('1234.56'), 1234.56)
    assert.equal(parseNumero(1234.56), 1234.56)
  })

  it('lixo vira zero em vez de NaN', () => {
    assert.equal(parseNumero(null), 0)
    assert.equal(parseNumero(''), 0)
    assert.equal(parseNumero('não informado'), 0)
    assert.equal(parseNumero(Number.NaN), 0)
  })
})

describe('extrair, sobre o retorno real do IEPTB Online', () => {
  it('lê a contagem de `numeroTotalProtestos` — a chave que faltava', () => {
    const r = extrair(IEPTB_REAL, 3.5)
    assert.equal(r.qtd_protestos, 1)
  })

  it('lê o valor com o prefixo "R$ "', () => {
    assert.equal(extrair(IEPTB_REAL, 3.5).valor_total, 11351.49)
  })

  it('marca que tem protesto e devolve os cartórios', () => {
    const r = extrair(IEPTB_REAL, 3.5)
    assert.equal(r.tem_protesto, true)
    assert.ok(Array.isArray(r.cartorios))
    assert.equal(r.custo, 3.5)
  })
})

describe('o zero silencioso que estava em produção', () => {
  it('sem a contagem no topo, desce aos cartórios MESMO tendo achado o valor', () => {
    // Este é o caso exato dos 20 registros: valor no estado, contagem só no
    // cartório. O `continue` antigo somava o valor e ia embora.
    const semTopo = {
      retorno: {
        constamProtestos: true,
        valorTotalProtestos: 'R$ 11.351,49',
        protestos: [
          {
            estado: 'PR',
            valorTotalProtestosEstado: 'R$ 11.351,49',
            cartorios: [{ numeroProtestos: 3, valorTotalProtestosCartorio: 'R$ 11.351,49' }],
          },
        ],
      },
    }
    const r = extrair(semTopo, 3.5)
    assert.equal(r.qtd_protestos, 3, 'a contagem tem de vir do cartório')
    assert.equal(r.valor_total, 11351.49, 'e o valor não pode ser somado duas vezes')
  })

  it('a grafia do IEPTB no nível do estado é lida', () => {
    // `numeroTotalProtestosUF`, com UF maiúsculo — o código procurava
    // `totalNumProtestosUf`.
    const s = somarCartorios([
      { estado: 'PR', numeroTotalProtestosUF: 4, valorTotalProtestosEstado: 'R$ 100,00' },
    ])
    assert.deepEqual(s, { qtd: 4, valor: 100 })
  })

  it('a comparação de chave ignora maiúsculas', () => {
    const s = somarCartorios([
      { NumeroTotalProtestosUf: 2, ValorTotalProtestosEstado: 'R$ 50,00' },
    ])
    assert.deepEqual(s, { qtd: 2, valor: 50 })
  })

  it('soma vários estados sem contar nada duas vezes', () => {
    const s = somarCartorios([
      { numeroTotalProtestosUF: 1, valorTotalProtestosEstado: 'R$ 10,00' },
      {
        valorTotalProtestosEstado: 'R$ 20,00',
        cartorios: [
          { numeroProtestos: 2, valorTotalProtestosCartorio: 'R$ 20,00' },
        ],
      },
    ])
    assert.deepEqual(s, { qtd: 3, valor: 30 })
  })
})

describe('respostas limpas e degeneradas', () => {
  it('sem protesto é sem protesto, não erro', () => {
    const r = extrair({ retorno: { constamProtestos: false, protestos: [] } }, 3.5)
    assert.equal(r.tem_protesto, false)
    assert.equal(r.qtd_protestos, 0)
    assert.equal(r.valor_total, 0)
  })

  it('`constamProtestos: true` sozinho já marca protesto', () => {
    // Cobertura pobre é melhor que silêncio: se o IEPTB afirma que há protesto e
    // não detalha, a empresa não pode aparecer limpa na ficha.
    const r = extrair({ retorno: { constamProtestos: true } }, 3.5)
    assert.equal(r.tem_protesto, true)
  })

  it('payload vazio ou nulo não derruba o job', () => {
    assert.equal(extrair(null, 3.5).tem_protesto, false)
    assert.equal(extrair({}, 3.5).qtd_protestos, 0)
  })

  it('o formato antigo de SP continua legível — o histórico não muda de forma', () => {
    // As consultas `directd_sp` gravadas antes de 01/09/2026 continuam na tabela,
    // e a tela lê o payload delas.
    const sp = {
      retorno: {
        constaProtesto: true,
        protestos: [
          {
            totalNumProtestosUf: 2,
            cartoriosProtesto: [
              { numProtestos: 2, valorTotalProtestosCartorio: '1.500,00' },
            ],
          },
        ],
      },
    }
    const r = extrair(sp, 0.36)
    assert.equal(r.tem_protesto, true)
    assert.equal(r.qtd_protestos, 2)
    assert.equal(r.valor_total, 1500)
  })
})
