import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TEMPLATE_PADRAO,
  ordenarSacadosParaPedido,
  renderizarApresentacao,
  type VariaveisApresentacao,
} from './mensagem.ts'

const VARS: VariaveisApresentacao = {
  fornecedor_nome: 'SERRALHERIA X LTDA',
  fornecedor_cnpj: '21148435000158',
  sacado_nome: 'CONSTRUTORA RIBEIRO CARAM',
  contato_sacado_nome: 'Antônio Carlos de Almeida Filho',
  originador_nome: 'Fábio',
  volume_90d: 340_000,
  qtd_nfs_90d: 12,
  potencial_mensal: 113_333.33,
}

test('o template padrão sai sem chaves sobrando', () => {
  const texto = renderizarApresentacao(TEMPLATE_PADRAO, VARS)
  assert.doesNotMatch(texto, /\{\{/)
  assert.match(texto, /SERRALHERIA X LTDA/)
  assert.match(texto, /CONSTRUTORA RIBEIRO CARAM/)
})

test('só o primeiro nome do contato: ninguém escreve "Oi Antônio Carlos de Almeida Filho"', () => {
  assert.match(renderizarApresentacao('Oi {{contato_sacado_nome}}', VARS), /^Oi Antônio$/)
})

test('o padrão NÃO expõe o volume que o sacado nos confiou', () => {
  const texto = renderizarApresentacao(TEMPLATE_PADRAO, VARS)
  assert.doesNotMatch(texto, /340/)
  assert.doesNotMatch(texto, /113/)
  // Mas a variável existe para quem quiser adaptar o texto.
  assert.match(renderizarApresentacao('{{volume_90d}}', VARS), /R\$\s?340\.000,00/)
})

test('CNPJ sai formatado — é para uma pessoa ler', () => {
  assert.equal(renderizarApresentacao('{{fornecedor_cnpj}}', VARS), '21.148.435/0001-58')
})

test('variável desconhecida fica visível em vez de virar buraco na frase', () => {
  // O erro de digitação do gestor precisa aparecer ANTES de a mensagem ser copiada.
  assert.equal(renderizarApresentacao('Oi {{contao_sacado_nome}}', VARS), 'Oi {{contao_sacado_nome}}')
})

test('nulos viram texto neutro, nunca "null"', () => {
  const texto = renderizarApresentacao(TEMPLATE_PADRAO, {
    ...VARS,
    fornecedor_nome: null,
    sacado_nome: null,
    contato_sacado_nome: null,
    volume_90d: null,
  })
  assert.doesNotMatch(texto, /null|undefined|NaN/)
  assert.match(texto, /o fornecedor/)
  assert.match(texto, /a construtora/)
})

test('o seletor de sacado prioriza quem tem ponto focal, não quem compra mais', () => {
  const ordenado = ordenarSacadosParaPedido([
    { cnpj: '111', nome: 'GRANDE', valor: 2_000_000, tem_ponto_focal: false },
    { cnpj: '222', nome: 'MEDIA', valor: 300_000, tem_ponto_focal: true },
    { cnpj: '333', nome: 'PEQUENA', valor: 100_000, tem_ponto_focal: true },
  ])
  // O pedido é um favor pessoal: ele funciona com quem atende, não com quem compra mais.
  assert.deepEqual(ordenado.map((s) => s.cnpj), ['222', '333', '111'])
})
