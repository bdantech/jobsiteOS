import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Grupo } from '../mercado/filters.ts'
import { descrever } from '../mercado/filters.ts'
import type { AuditoriaCamada } from './auditoria.ts'
import type { AchadoContraste } from './contraste.ts'
import {
  arredondarParaBaixo,
  corteQueInclui,
  gerarSugestoes,
  variaveisUsadas,
  type EntradaSugestoes,
} from './sugestoes.ts'
import { variaveisDaTrilha } from './variaveis.ts'

/**
 * O que este teste protege é a assimetria do gerador: ele afrouxa e adiciona,
 * mas NUNCA aperta nem exclui. Um gerador que sugerisse "corte o Norte, lá
 * ninguém opera" transformaria o viés de onde historicamente prospectamos numa
 * regra que garante que nunca prospectaremos lá.
 */

const REGRA_SOM: Grupo = {
  operador: 'e',
  condicoes: [
    { variavel: 'situacao_cadastral', operador: 'igual', valor: 'ativa' },
    { variavel: 'idade_anos', operador: 'maior_ou_igual', valor: 6 },
    { variavel: 'uf', operador: 'em', valor: ['SP', 'SC'] },
  ],
}

function auditoria(over: Partial<AuditoriaCamada> = {}): AuditoriaCamada {
  return {
    camada: 'som',
    versao: 7,
    coorte: 'pesados',
    total: 100,
    passam: 70,
    nao_passam: 30,
    sem_cadastro: 0,
    definicao: REGRA_SOM,
    barreiras: [],
    ...over,
  }
}

function entrada(over: Partial<EntradaSugestoes> = {}): EntradaSugestoes {
  return {
    trilha: 'sacados',
    auditorias: [],
    achados: [],
    linhas: [],
    variaveis: variaveisDaTrilha('sacados'),
    alvoSinal: { tipo: 'camada', chave: 'som', versao: 7 },
    definicaoSinal: REGRA_SOM,
    rotuloCoorte: 'sacados pesados',
    descrever,
    rotuloVariavel: (id) => id,
    ...over,
  }
}

// ─── Afrouxar ───────────────────────────────────────────────────────────────

test('afrouxa um piso numérico até incluir a coorte, com número redondo', () => {
  const linhas = Array.from({ length: 100 }, (_, i) => ({ idade_anos: 3 + (i % 20) }))
  const r = gerarSugestoes(
    entrada({
      linhas,
      auditorias: [
        auditoria({
          barreiras: [
            {
              indice: 1,
              descricao: 'Idade (anos) é maior ou igual a 6',
              barrados: 30,
              fracao: 0.3,
              no: REGRA_SOM.condicoes[1] as never,
            },
          ],
        }),
      ],
    }),
  )

  assert.equal(r.length, 1)
  const s = r[0]
  assert.equal(s?.tipo, 'afrouxar')
  assert.equal(s?.alvo.chave, 'som')
  // A proposta é a árvore INTEIRA, com só aquela condição trocada.
  const proposta = s?.definicao_proposta as Grupo
  assert.equal(proposta.condicoes.length, 3)
  assert.deepEqual(proposta.condicoes[0], REGRA_SOM.condicoes[0])
  // Idades vão de 3 a 22, cinco empresas em cada. As de 3 anos são exatamente 5%
  // da coorte, então o corte que inclui 95% é 4 — e não 3. É o percentil fazendo
  // o trabalho dele: um punhado de recém-abertas não derruba a régua inteira.
  assert.equal((proposta.condicoes[1] as { valor: number }).valor, 4)
})

test('não afrouxa quando a condição vigente já é mais frouxa que a coorte pede', () => {
  // Coorte inteira com 20+ anos e a regra exigindo 6: a regra não é o problema.
  const linhas = Array.from({ length: 100 }, () => ({ idade_anos: 25 }))
  const r = gerarSugestoes(
    entrada({
      linhas,
      auditorias: [
        auditoria({
          barreiras: [
            {
              indice: 1,
              descricao: 'Idade (anos) é maior ou igual a 6',
              barrados: 30,
              fracao: 0.3,
              no: REGRA_SOM.condicoes[1] as never,
            },
          ],
        }),
      ],
    }),
  )
  assert.equal(r.length, 0)
})

test('lista ganha os valores que a coorte tem e a regra não', () => {
  const linhas = [
    ...Array.from({ length: 40 }, () => ({ uf: 'SP' })),
    ...Array.from({ length: 30 }, () => ({ uf: 'RS' })),
    ...Array.from({ length: 30 }, () => ({ uf: 'MG' })),
  ]
  const r = gerarSugestoes(
    entrada({
      linhas,
      auditorias: [
        auditoria({
          barreiras: [
            {
              indice: 2,
              descricao: 'UF está em SP, SC',
              barrados: 60,
              fracao: 0.6,
              no: REGRA_SOM.condicoes[2] as never,
            },
          ],
        }),
      ],
    }),
  )

  assert.equal(r.length, 1)
  const lista = ((r[0]?.definicao_proposta as Grupo).condicoes[2] as { valor: string[] }).valor
  assert.deepEqual(lista, ['SP', 'SC', 'MG', 'RS'])
})

test('condição de integridade NÃO é afrouxada — isso seria um bug, não um ajuste', () => {
  // `situacao_cadastral = ativa` barra empresas baixadas. Nenhum lift justifica
  // classificar empresa baixada como mercado endereçável.
  const r = gerarSugestoes(
    entrada({
      linhas: Array.from({ length: 100 }, () => ({ situacao_cadastral: 'baixada' })),
      auditorias: [
        auditoria({
          barreiras: [
            {
              indice: 0,
              descricao: 'Situação cadastral é igual a ativa',
              barrados: 90,
              fracao: 0.9,
              no: REGRA_SOM.condicoes[0] as never,
            },
          ],
        }),
      ],
    }),
  )
  assert.equal(r.length, 0)
})

test('barreira pequena não vira sugestão', () => {
  const linhas = Array.from({ length: 100 }, () => ({ idade_anos: 1 }))
  const r = gerarSugestoes(
    entrada({
      linhas,
      auditorias: [
        auditoria({
          barreiras: [
            {
              indice: 1,
              descricao: 'Idade (anos) é maior ou igual a 6',
              barrados: 5,
              fracao: 0.05,
              no: REGRA_SOM.condicoes[1] as never,
            },
          ],
        }),
      ],
    }),
  )
  assert.equal(r.length, 0)
})

// ─── Adicionar sinal ────────────────────────────────────────────────────────

function achado(over: Partial<AchadoContraste> = {}): AchadoContraste {
  const destaque = {
    chave: '3 ou mais',
    n_a: 40,
    n_b: 20,
    prevalencia_a: 0.4,
    prevalencia_b: 0.1,
    lift: 4,
    exclusiva_a: false,
    solida: true,
  }
  return {
    variavel: 'obras_ativas',
    categorias: [destaque],
    destaque,
    n_a: 100,
    n_b: 200,
    cobertura_a: 1,
    cobertura_b: 1,
    confianca: 'solida',
    suprimido: false,
    ...over,
  }
}

test('lift alto de variável ausente da regra vira um novo termo', () => {
  const r = gerarSugestoes(entrada({ achados: [achado()] }))
  assert.equal(r.length, 1)
  const s = r[0]
  assert.equal(s?.tipo, 'adicionar_sinal')
  const proposta = s?.definicao_proposta as Grupo
  assert.equal(proposta.condicoes.length, 4, 'o termo entra no fim, sem tocar nos outros')
  assert.deepEqual(proposta.condicoes[3], {
    variavel: 'obras_ativas',
    operador: 'maior_ou_igual',
    valor: 3,
  })
})

test('variável que já está na regra não é sugerida de novo', () => {
  const r = gerarSugestoes(entrada({ achados: [achado({ variavel: 'idade_anos' })] }))
  assert.equal(r.length, 0)
})

test('lift abaixo de 1 é evidência para apertar — e o gerador não aperta', () => {
  const destaque = {
    chave: 'nenhuma',
    n_a: 20,
    n_b: 160,
    prevalencia_a: 0.2,
    prevalencia_b: 0.8,
    lift: 0.25,
    exclusiva_a: false,
    solida: true,
  }
  const r = gerarSugestoes(entrada({ achados: [achado({ destaque, categorias: [destaque] })] }))
  assert.equal(r.length, 0)
})

test('achado suprimido por cobertura nunca vira sugestão', () => {
  const r = gerarSugestoes(entrada({ achados: [achado({ suprimido: true })] }))
  assert.equal(r.length, 0)
})

test('célula sem N não vira sugestão, por maior que seja o lift', () => {
  const destaque = {
    chave: '3 ou mais',
    n_a: 3,
    n_b: 1,
    prevalencia_a: 0.75,
    prevalencia_b: 0.05,
    lift: 15,
    exclusiva_a: false,
    solida: false,
  }
  const r = gerarSugestoes(entrada({ achados: [achado({ destaque, categorias: [destaque] })] }))
  assert.equal(r.length, 0)
})

test('variável sem mapeamento para regra vira achado, nunca sugestão', () => {
  // `natureza_juridica_categoria` agrupa vários códigos e o catálogo de filtros
  // só oferece o texto cru — não há condição que a expresse sem casar coisa errada.
  const r = gerarSugestoes(
    entrada({ achados: [achado({ variavel: 'natureza_juridica_categoria' })] }),
  )
  assert.equal(r.length, 0)
})

// ─── Auxiliares ─────────────────────────────────────────────────────────────

test('o corte é percentil, não mínimo — um outlier não zera a regra', () => {
  const valores = [0, ...Array.from({ length: 99 }, () => 10)]
  assert.equal(corteQueInclui(valores, 0.95), 10)
  assert.equal(corteQueInclui(valores, 1), 0)
  assert.equal(corteQueInclui([], 0.95), null)
})

test('o corte proposto é um número que alguém defende numa reunião', () => {
  assert.equal(arredondarParaBaixo(3.7), 3)
  assert.equal(arredondarParaBaixo(483_219), 450_000)
  assert.equal(arredondarParaBaixo(1_900_000), 1_500_000)
  assert.equal(arredondarParaBaixo(0.37), 0.35)
  assert.equal(arredondarParaBaixo(0), 0)
})

test('variaveisUsadas enxerga dentro dos grupos aninhados', () => {
  const arvore: Grupo = {
    operador: 'e',
    condicoes: [
      { variavel: 'uf', operador: 'em', valor: ['SP'] },
      {
        operador: 'ou',
        condicoes: [
          { variavel: 'obras_ativas', operador: 'maior_ou_igual', valor: 1 },
          { variavel: 'erp_conhecido', operador: 'igual', valor: true },
        ],
      },
    ],
  }
  assert.deepEqual(variaveisUsadas(arvore).sort(), ['erp_conhecido', 'obras_ativas', 'uf'])
})
