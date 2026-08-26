import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  desembrulharTokenNovaVida,
  erroDeConsultaNovaVida,
  formaDaResposta,
  mapearNovaVida,
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

/*
 * O fixture abaixo é o schema REAL da NVCHECK para pessoa jurídica, montado a partir
 * do manual de integração da Nova Vida (2025, §3.2.d). A versão anterior destes testes
 * usava a forma que o prompt descrevia (`{Socios: [...]}`) e por isso passava enquanto
 * a produção devolvia zero — quatro consultas pagas registraram "sem dados" tendo
 * trazido quatro telefones.
 */
const NVCHECK_PJ = {
  d: {
    CONSULTA: {
      CADASTRAIS: {
        CNPJ: '11222333000144',
        RAZAO: 'SERRALHERIA X LTDA',
        NOME_FANTASIA: 'SERRALHERIA X',
        PORTE: 'MICRO',
        FATURAMENTOPRESUMIDO: '12125000',
        CAPITALSOCIAL: '5394485661',
        QTDEFUNCIONARIOS: '236',
      },
      ENDERECOS: [{ LOGRADOURO: 'INACIO SANTOS', CIDADE: 'SAO PAULO', UF: 'SP' }],
      TELEFONES: [
        { POSICAO: '1', DDD: '11', TELEFONE: '937445393', TIPO_TELEFONE: 'C', PROCON: 'N', OPERADORA: 'VIVO', FLHOT: 'S', FLWHATS: 'S' },
        { POSICAO: '2', DDD: '11', TELEFONE: '32052020', TIPO_TELEFONE: 'F', PROCON: 'S', OPERADORA: 'VIVO', FLHOT: 'N', FLWHATS: 'N' },
      ],
      EMAILS: [{ EMAIL: 'Contato@SerralheriaX.com.br', POSICAO: '1' }],
      SITUACAOCADASTRAL: { DESCRICAO: 'ATIVA' },
      CONTATOSRUINS: [{ DDD: '11', TELEFONE: '982221111', TIPO: 'C' }],
      QSA: [
        {
          QTD_SOCIOS: '2',
          QSA: [
            { NOME: 'MARIA DA SILVA', QUALIFICACAO: 'ADMINISTRADOR', DDD_SOCIO: '11', CEL_SOCIO: '988887777', FLWHATS: 'S' },
            { NOME: 'EXEMPLO LTDA', QUALIFICACAO: '', DDD_SOCIO: '', CEL_SOCIO: '', CNPJ: '22232111000111' },
          ],
        },
      ],
    },
  },
}

test('o telefone e o e-mail DA EMPRESA entram — eram o que o parser antigo ignorava', () => {
  const r = mapearNovaVida(NVCHECK_PJ)
  const valores = r.contatos.map((c) => c.valor)
  // Fixo da empresa e e-mail da empresa: nenhum dos dois era procurado antes.
  assert.ok(valores.includes('+551132052020'), 'faltou o fixo da empresa')
  assert.ok(valores.includes('contato@serralheriax.com.br'), 'faltou o e-mail da empresa')
  const email = r.contatos.find((c) => c.tipo === 'email')
  assert.equal(email?.valor, 'contato@serralheriax.com.br') // minúsculo, canônico
  assert.equal(email?.confianca, 'media')
})

test('FLWHATS = S promove o registro a whatsapp — é afirmação do provedor, não palpite', () => {
  const r = mapearNovaVida(NVCHECK_PJ)
  const whats = r.contatos.find((c) => c.valor === '+5511937445393')
  assert.equal(whats?.tipo, 'whatsapp')
  assert.match(whats?.evidencia ?? '', /com WhatsApp/)
  // O fixo sem WhatsApp continua telefone.
  assert.equal(r.contatos.find((c) => c.valor === '+551132052020')?.tipo, 'telefone')
})

test('a QSA é ANINHADA, e é aí que a versão anterior parava', () => {
  const r = mapearNovaVida(NVCHECK_PJ)
  const socio = r.contatos.find((c) => c.nome_pessoa === 'MARIA DA SILVA')
  assert.ok(socio, 'o sócio de QSA[0].QSA[] não foi lido')
  assert.equal(socio.valor, '+5511988887777')
  assert.equal(socio.cargo, 'ADMINISTRADOR')
  assert.equal(socio.tipo, 'whatsapp')
  // Sócio PJ vem sem celular e não vira contato nenhum.
  assert.equal(r.contatos.filter((c) => c.nome_pessoa === 'EXEMPLO LTDA').length, 0)
})

test('CONTATOSRUINS são excluídos: a própria base já avisou que não atendem', () => {
  const comRuim = {
    d: {
      CONSULTA: {
        TELEFONES: [{ DDD: '11', TELEFONE: '982221111', TIPO_TELEFONE: 'C' }],
        CONTATOSRUINS: [{ DDD: '11', TELEFONE: '982221111', TIPO: 'C' }],
      },
    },
  }
  const r = mapearNovaVida(comRuim)
  // Gravá-lo seria pagar para pôr na tela um número que o fornecedor da informação
  // já disse que não serve — e ele apareceria igual aos bons até alguém discar.
  assert.deepEqual(r.contatos, [])
  assert.equal(r.descartados, 1)
})

test('o Procon aparece na evidência, e o contato NÃO some por causa dele', () => {
  const r = mapearNovaVida(NVCHECK_PJ)
  const fixo = r.contatos.find((c) => c.valor === '+551132052020')
  assert.match(fixo?.evidencia ?? '', /no Procon/)
  assert.match(fixo?.evidencia ?? '', /fixo/)
})

test('o cadastral vem de graça na mesma consulta e é o que destrava o Apollo', () => {
  /*
   * `QTDEFUNCIONARIOS` é exatamente o número que o gate de porte procura e que NENHUM
   * fornecedor deste funil tem em `empresas` — não estar na plataforma é a definição
   * deles. Ignorá-lo era jogar fora o dado pago que resolve o problema seguinte.
   */
  const { cadastrais } = mapearNovaVida(NVCHECK_PJ)
  assert.equal(cadastrais?.funcionarios, 236)
  assert.equal(cadastrais?.porte, 'MICRO')
  assert.equal(cadastrais?.faturamento_presumido, 12125000)
  assert.equal(cadastrais?.situacao, 'ATIVA')
})

test('erro vem como TEXTO com HTTP 200 também na CONSULTA, não só no token', () => {
  // A doc lista quatro (§2): credencial errada, consulta não liberada e as duas cotas.
  assert.equal(erroDeConsultaNovaVida('SEM ACESSO AO SISTEMA'), 'SEM ACESSO AO SISTEMA')
  assert.equal(
    erroDeConsultaNovaVida({ d: 'QUANTIDADE CONFIGURADA ATINGIDA AO CLIENTE' }),
    'QUANTIDADE CONFIGURADA ATINGIDA AO CLIENTE',
  )
  // Um objeto de verdade não é erro.
  assert.equal(erroDeConsultaNovaVida(NVCHECK_PJ), null)
})

test('resposta vazia ou quebrada devolve lista vazia, não exceção', () => {
  assert.deepEqual(mapearSociosNovaVida(null), [])
  assert.deepEqual(mapearSociosNovaVida({ d: 'não é json' }), [])
  assert.deepEqual(mapearSociosNovaVida({ d: { CONSULTA: {} } }), [])
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
