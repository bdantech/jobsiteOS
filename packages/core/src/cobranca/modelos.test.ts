import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indiceDossieTexto, montarIndiceDossie, nomeArquivoDossie, pendenciasDoChecklist } from './dossie.ts'
import {
  contextoDeExemplo,
  ErroModeloCobranca,
  renderizarModeloCobranca,
  tabelaTitulosMarkdown,
  validarModeloCobranca,
  valoresDoContexto,
} from './modelos.ts'
import { gerarRemessaProtestoCsv, lerRetornoProtesto } from './protesto.ts'

test('placeholder desconhecido é erro, na validação e na renderização', () => {
  assert.deepEqual(validarModeloCobranca('notificacao_sacado', 'Valor: {{valr_total}} e {{data_hoje}}').desconhecidos, ['valr_total'])
  assert.throws(
    () => renderizarModeloCobranca('notificacao_sacado', 'Valor: {{valr_total}}', {}),
    (e: unknown) => e instanceof ErroModeloCobranca && e.codigo === 'placeholder_desconhecido',
  )
})

test('placeholders de confissão só valem em modelo de confissão', () => {
  assert.deepEqual(validarModeloCobranca('notificacao_sacado', '{{tabela_parcelas}}').desconhecidos, ['tabela_parcelas'])
  assert.deepEqual(validarModeloCobranca('confissao_divida_aval', '{{tabela_parcelas}} {{avalistas}}').desconhecidos, [])
})

test('placeholder conhecido sem valor recusa a geração dizendo o que falta', () => {
  const ctx = { ...contextoDeExemplo(), credor: { ...contextoDeExemplo().credor, dados_pagamento: null } }
  assert.throws(
    () => renderizarModeloCobranca('notificacao_sacado', 'Pague por: {{dados_pagamento}}', valoresDoContexto(ctx)),
    (e: unknown) => e instanceof ErroModeloCobranca && e.codigo === 'valor_ausente' && /Meios de pagamento/.test(e.message),
  )
})

test('renderiza os placeholders com os dados do contexto', () => {
  const md = renderizarModeloCobranca(
    'notificacao_sacado',
    'Ref {{ cobranca.codigo }} — {{destinatario.cnpj}} — {{prazo_dias}} até {{prazo_data}}',
    valoresDoContexto(contextoDeExemplo()),
  )
  assert.equal(md, 'Ref COB-2026-0001 — 11.222.333/0001-81 — 5 dias úteis até 05/10/2026')
})

test('a tabela da matriz tem a coluna SPE devedora; a da SPE não', () => {
  const linhas = contextoDeExemplo().titulos
  assert.match(tabelaTitulosMarkdown(linhas, true), /SPE devedora/)
  assert.doesNotMatch(tabelaTitulosMarkdown(linhas, false), /SPE devedora/)
})

test('remessa de protesto: CSV com BOM, ; e vírgula decimal, campos com ; entre aspas', () => {
  const csv = gerarRemessaProtestoCsv([
    {
      protesto_titulo_id: 'p1',
      numero_titulo: '123',
      especie: 'DMI',
      nf_chave_acesso: null,
      emissao: '2026-06-01',
      vencimento: '2026-07-10',
      valor: 1234.5,
      saldo: 1234.5,
      devedor_nome: 'ACME; SPE LTDA',
      devedor_cnpj: '11222333000181',
      devedor_endereco: 'Rua X, 1',
      devedor_cep: null,
      devedor_municipio: 'São Paulo',
      devedor_uf: 'SP',
      sacador_nome: 'CONSTRUCREDIT',
      sacador_cnpj: '43738268000138',
      cedente_nome: 'FORNECEDOR',
      cedente_cnpj: '99999999000100',
    },
  ])
  assert.ok(csv.startsWith('﻿id_interno;numero_titulo'))
  assert.match(csv, /;1234,50;1234,50;"ACME; SPE LTDA";/)
})

test('retorno de protesto: casa por id, traduz a situação e ignora o que não é da remessa', () => {
  const texto = [
    'id_interno;situacao;cartorio;protocolo;data_protesto;custas;motivo',
    'p1;PROTESTADO;1º Tabelião de SP;998877;15/08/2026;123,45;',
    'p2;Título pago em cartório;2º Tabelião;112233;16/08/2026;;',
    'p3;DEVOLVIDO - endereço insuficiente;;;;;Endereço insuficiente',
    'x9;PROTESTADO;;;;;',
    'p4;situação estranha;;;;;',
  ].join('\n')
  const r = lerRetornoProtesto(texto, new Set(['p1', 'p2', 'p3', 'p4']))
  assert.deepEqual(
    r.linhas.map((l) => [l.protesto_titulo_id, l.situacao]),
    [
      ['p1', 'protestado'],
      ['p2', 'pago_em_cartorio'],
      ['p3', 'rejeitado'],
    ],
  )
  assert.equal(r.linhas[0]!.data_protesto, '2026-08-15')
  assert.equal(r.linhas[0]!.custas, 123.45)
  assert.equal(r.ignoradas.length, 2)
})

test('dossiê: nomes na ordem do checklist, justificativa no índice, pendência trava', () => {
  assert.equal(nomeArquivoDossie('c', 1, 'Faturas NF 1234', 'pdf'), '04-c-01-faturas-nf-1234.pdf')
  assert.equal(nomeArquivoDossie('sumario', 1, 'Sumário executivo', 'pdf'), '01-sumario-01-sumario-executivo.pdf')

  const itens = [
    { item: 'a', descricao: 'Pedidos/Contratos', obrigatorio: true, status: 'pendente' as const, justificativa_ausencia: null },
    { item: 'e', descricao: 'Letras de câmbio', obrigatorio: false, status: 'pendente' as const, justificativa_ausencia: null },
    { item: 'd', descricao: 'Comprovante de entrega', obrigatorio: true, status: 'nao_aplicavel' as const, justificativa_ausencia: 'Entrega por NF-e com canhoto digital.' },
  ]
  assert.deepEqual(pendenciasDoChecklist(itens), ['a) Pedidos/Contratos'])

  const ind = montarIndiceDossie({
    codigo: 'SIN-2026-0001',
    apolice: '9000373_SUSEP',
    sacado: 'ACME',
    sacado_cnpj: '11222333000181',
    gerado_em: '2026-09-26',
    itens,
    arquivos: [{ item: 'sumario', nome: '01-sumario.pdf', sha256: 'abc', bytes: 10 }],
  })
  const txt = indiceDossieTexto(ind)
  assert.match(txt, /Sumário executivo — Anexado/)
  assert.match(txt, /sha256:abc/)
  assert.match(txt, /Entrega por NF-e com canhoto digital/)
  assert.match(txt, /PENDÊNCIAS/)
})
