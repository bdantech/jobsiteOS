import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  desembrulharTokenNovaVida,
  formaDaResposta,
  enderecoConfere,
  expiracaoTokenNovaVida,
  filtrarContatosDoClaude,
  mapearGooglePlaces,
  mapearSociosNovaVida,
  tokenNovaVidaEhErro,
  tokenNovaVidaExpirado,
} from './provedores.ts'

// ─── Nova Vida ──────────────────────────────────────────────────────────────

const TOKEN = 'AbCdEf0123456789XyZ'

test('o token vem embrulhado de quatro jeitos e sai igual dos quatro', () => {
  assert.equal(desembrulharTokenNovaVida({ d: TOKEN }), TOKEN)
  assert.equal(desembrulharTokenNovaVida({ GerarTokenJsonResult: TOKEN }), TOKEN)
  assert.equal(desembrulharTokenNovaVida({ token: TOKEN }), TOKEN)
  assert.equal(desembrulharTokenNovaVida(TOKEN), TOKEN)
  // Duplo embrulho do ASMX.
  assert.equal(desembrulharTokenNovaVida({ d: { token: TOKEN } }), TOKEN)
  assert.equal(desembrulharTokenNovaVida({ outro: 1 }), null)
})

test('erro com HTTP 200 não é token — é a armadilha central desta integração', () => {
  assert.equal(tokenNovaVidaEhErro('USUARIO OU SENHA INCORRETO'), true)
  assert.equal(tokenNovaVidaEhErro('CLIENTE SEM ACESSO'), true)
  assert.equal(tokenNovaVidaEhErro('COTA ATINGIDA'), true)
  assert.equal(tokenNovaVidaEhErro('INVALID CREDENTIALS'), true)
  assert.equal(tokenNovaVidaEhErro('erro interno'), true)
  assert.equal(tokenNovaVidaEhErro(null), true)
  assert.equal(tokenNovaVidaEhErro(TOKEN), false)
})

test('curto demais é erro mesmo sem casar palavra nenhuma', () => {
  assert.equal(tokenNovaVidaEhErro('NOK'), true)
  assert.equal(tokenNovaVidaEhErro('   '), true)
})

test('o cache do token expira meia hora antes da validade real', () => {
  const agora = new Date('2026-08-25T10:00:00Z')
  const expira = expiracaoTokenNovaVida(agora)
  assert.equal(expira.toISOString(), '2026-08-26T09:30:00.000Z')
  // Às 23h de uso, ainda vale. Às 23h40, já não — e é essa folga que impede o token
  // de expirar no meio do voo e devolver "sem dados" no lugar de "não autenticou".
  assert.equal(tokenNovaVidaExpirado(expira, new Date('2026-08-26T09:00:00Z')), false)
  assert.equal(tokenNovaVidaExpirado(expira, new Date('2026-08-26T09:40:00Z')), true)
  assert.equal(tokenNovaVidaExpirado(null, agora), true)
  assert.equal(tokenNovaVidaExpirado('não é data', agora), true)
})

test('sócios viram contatos com nome, cargo e confiança média', () => {
  const resp = {
    d: {
      Socios: [
        {
          Nome: 'JOAO DA SILVA',
          Qualificacao: 'Sócio-Administrador',
          Telefones: '(11) 98888-7777; 1133334444',
          Emails: 'joao@serralheria.com.br',
        },
      ],
    },
  }
  const contatos = mapearSociosNovaVida(resp)
  assert.equal(contatos.length, 3)
  assert.equal(contatos[0]?.valor, '+5511988887777')
  assert.equal(contatos[0]?.nome_pessoa, 'JOAO DA SILVA')
  assert.equal(contatos[0]?.cargo, 'Sócio-Administrador')
  // Média sempre: é o celular do sócio como pessoa física, não o canal da empresa.
  assert.equal(contatos.every((c) => c.confianca === 'media'), true)
})

test('o mesmo telefone em dois sócios entra uma vez só', () => {
  const contatos = mapearSociosNovaVida({
    Socios: [
      { Nome: 'A', Telefones: ['11988887777'] },
      { Nome: 'B', Telefones: [{ Numero: '(11) 98888-7777' }] },
    ],
  })
  assert.equal(contatos.length, 1)
})

test('resposta serializada dentro do embrulho ainda é lida', () => {
  const contatos = mapearSociosNovaVida({ d: JSON.stringify({ socios: [{ nome: 'X', telefones: '11988887777' }] }) })
  assert.equal(contatos[0]?.valor, '+5511988887777')
})

test('resposta vazia ou quebrada devolve lista vazia, não exceção', () => {
  assert.deepEqual(mapearSociosNovaVida(null), [])
  assert.deepEqual(mapearSociosNovaVida({ d: 'não é json' }), [])
  assert.deepEqual(mapearSociosNovaVida({ Socios: 'texto' }), [])
})

test('a forma da resposta diagnostica um "sem dados" pago sem repetir a consulta', () => {
  // Resposta COM sócios que o mapeamento não pegou: a forma mostra a chave certa.
  assert.equal(
    formaDaResposta({ d: { Documento: '123', QuadroSocios: [{ Nome: 'x', Fones: ['1'] }] } }),
    '{d: {Documento: string, QuadroSocios: [1× {2 chaves}]}}',
  )
  // Resposta genuinamente vazia: a forma mostra que não havia sócio nenhum.
  assert.equal(formaDaResposta({ d: { Socios: [] } }), '{d: {Socios: []}}')
})

test('a forma NUNCA carrega valor — a resposta traz nome, CPF e telefone de pessoa física', () => {
  const forma = formaDaResposta({
    Socios: [{ Nome: 'JOAO DA SILVA', CPF: '12345678901', Telefones: ['11988887777'] }],
  })
  assert.doesNotMatch(forma, /JOAO|12345678901|11988887777/)
  assert.match(forma, /Socios/)
})

test('a forma tem teto: uma resposta com 200 chaves não vira um log de 200 linhas', () => {
  const gigante = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]))
  const forma = formaDaResposta(gigante)
  assert.match(forma, /…\}$/)
  assert.ok(forma.length < 300, `forma longa demais: ${forma.length}`)
})

// ─── Google Places ──────────────────────────────────────────────────────────

const CADASTRAL = { municipio: 'Sorocaba', uf: 'SP', logradouro: 'Rua Ubaldino do Amaral', numero: '120' }

test('endereço que confere dá confiança alta; o que não confere dá baixa', () => {
  const bate = mapearGooglePlaces(
    { id: 'ChIJ1', formattedAddress: 'R. Ubaldino do Amaral, 120 - Sorocaba, SP', nationalPhoneNumber: '(15) 3231-4455' },
    CADASTRAL,
  )
  assert.equal(bate[0]?.confianca, 'alta')
  assert.equal(bate[0]?.valor, '+551532314455')
  assert.match(bate[0]?.evidencia ?? '', /endereço confere/)

  const naoBate = mapearGooglePlaces(
    { id: 'ChIJ2', formattedAddress: 'Av. Paulista, 1000 - São Paulo, SP', nationalPhoneNumber: '(11) 3231-4455' },
    CADASTRAL,
  )
  assert.equal(naoBate[0]?.confianca, 'baixa')
  assert.match(naoBate[0]?.evidencia ?? '', /NÃO confere/)
})

test('o município sozinho não confere: uma rua pode se chamar como outra cidade', () => {
  // "Sorocaba" aparece, mas como nome de rua, numa empresa de Votorantim.
  assert.equal(
    enderecoConfere('Rua Sorocaba, 50 - Centro, Votorantim - SP', { ...CADASTRAL, municipio: 'Votorantim' }),
    true, // aqui o município REALMENTE é Votorantim e ele aparece
  )
  assert.equal(
    enderecoConfere('Rua das Flores, 10 - Campinas - RJ', { municipio: 'Campinas', uf: 'SP', logradouro: null, numero: null }),
    false, // município bate, UF não, sem logradouro para confirmar
  )
})

test('o site do Places vem do dono da ficha e não depende do endereço bater', () => {
  const c = mapearGooglePlaces(
    { formattedAddress: 'Av. Paulista, 1000 - São Paulo, SP', websiteUri: 'https://www.serralheriax.com.br/' },
    CADASTRAL,
  )
  assert.equal(c[0]?.tipo, 'site')
  assert.equal(c[0]?.valor, 'serralheriax.com.br') // sem www — é o que quebra o Apollo
  assert.equal(c[0]?.confianca, 'media')
})

test('lugar nulo ou sem telefone e sem site não produz nada', () => {
  assert.deepEqual(mapearGooglePlaces(null, CADASTRAL), [])
  assert.deepEqual(mapearGooglePlaces({ displayName: { text: 'X' } }, CADASTRAL), [])
})

// ─── Claude com busca web ───────────────────────────────────────────────────

test('contato sem URL de evidência é descartado — sempre', () => {
  const c = filtrarContatosDoClaude({
    contatos: [
      { tipo: 'telefone', valor: '(15) 3231-4455', confianca: 'alta', evidencia: 'https://serralheriax.com.br/contato' },
      { tipo: 'telefone', valor: '(15) 9999-8888', confianca: 'alta', evidencia: 'site oficial' },
      { tipo: 'email', valor: 'x@y.com.br', confianca: 'alta', evidencia: null },
    ],
  })
  assert.equal(c.length, 1)
  assert.equal(c[0]?.valor, '+551532314455')
})

test('"alta" declarada pelo modelo vira média: leitura de página não é campo estruturado', () => {
  const c = filtrarContatosDoClaude({
    contatos: [{ tipo: 'email', valor: 'VENDAS@Serralheriax.com.br', confianca: 'alta', evidencia: 'https://x.com/a' }],
  })
  assert.equal(c[0]?.confianca, 'media')
  assert.equal(c[0]?.valor, 'vendas@serralheriax.com.br')
})

test('"baixa" declarada continua baixa — o rebaixamento é teto, não piso', () => {
  const c = filtrarContatosDoClaude({
    contatos: [{ tipo: 'instagram', valor: 'https://instagram.com/serralheriax/', confianca: 'baixa', evidencia: 'https://x.com/a' }],
  })
  assert.equal(c[0]?.confianca, 'baixa')
  assert.equal(c[0]?.valor, 'serralheriax')
})

test('tipo desconhecido e valor malformado somem em silêncio', () => {
  const c = filtrarContatosDoClaude({
    contatos: [
      { tipo: 'linkedin', valor: 'x', confianca: 'alta', evidencia: 'https://x.com/a' },
      { tipo: 'telefone', valor: 'ligue já', confianca: 'alta', evidencia: 'https://x.com/a' },
      { tipo: 'email', valor: 'sem-arroba', confianca: 'alta', evidencia: 'https://x.com/a' },
    ],
  })
  assert.deepEqual(c, [])
})

test('resposta fora do formato não derruba o job', () => {
  assert.deepEqual(filtrarContatosDoClaude(null), [])
  assert.deepEqual(filtrarContatosDoClaude({ contatos: 'nenhum' }), [])
  assert.deepEqual(filtrarContatosDoClaude('texto solto'), [])
})
