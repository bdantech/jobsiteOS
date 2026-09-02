import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qualifica, selecionarAlvos, type CandidatoCargo, type CargosAlvo } from './cargos.ts'

/**
 * O que estes testes protegem é o corte pago: a busca do Apollo é de graça, mas cada
 * nome que sobra aqui vira uma revelação cobrada. Uma regressão não derruba nada —
 * só troca sócio e CFO por gerente de obra na fatura. Os cargos abaixo são reais,
 * copiados do que o Apollo devolveu nas primeiras levas.
 */

const CFG: CargosAlvo = {
  titulos: [
    'sócio',
    'socio',
    'proprietário',
    'fundador',
    'CEO',
    'diretor',
    'CFO',
    'financeiro',
    'controladoria',
    'controller',
    'suprimentos',
    'compras',
    'procurement',
    'engenheiro',
    'engenharia',
    'gerente de obras',
    'planejamento',
    'COO',
    // O Apollo devolve muito cargo em inglês; sem estes, diretores reais somem.
    'director',
    'chief',
    'head of',
    'engineering',
    'administrative',
    'financial',
    'finance',
  ],
  departamentos: ['finance', 'operations', 'engineering', 'procurement', 'executive'],
  senioridades: ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager'],
  senioridades_qualificam: ['owner', 'founder', 'c_suite', 'partner'],
  excluir_titulos: [
    'recursos humanos',
    'recrutamento',
    'seleção',
    'DHO',
    'gente',
    'cultura',
    'people',
    'talent',
    'business partner',
    'marketing',
    'comercial',
    'vendas',
    'sales',
    'sucesso do cliente',
  ],
  excluir_departamentos: ['human_resources', 'sales', 'marketing'],
  prioritarios: {
    titulos: ['sócio', 'socio', 'proprietário', 'fundador', 'CFO', 'financeiro', 'controladoria', 'controller'],
    departamentos: ['finance'],
    senioridades: ['owner', 'founder', 'partner'],
  },
  max_contatos_por_empresa: 8,
}

const nomes = (ps: Array<CandidatoCargo & { id: string }>): string[] =>
  selecionarAlvos(ps, CFG).map((p) => p.id)

test('Construction Manager é descartado: não casa título e não é prioritário', () => {
  assert.equal(qualifica({ title: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] }, CFG), false)
})

test('Encarregada de Obras é descartada — "gerente de obras" não casa', () => {
  assert.equal(qualifica({ title: 'Encarregada de Obras', seniority: 'manager' }, CFG), false)
})

test('departamento operations não qualifica sozinho', () => {
  // Se departamento qualificasse, todo o pessoal de obra voltaria pela porta dos fundos.
  assert.equal(qualifica({ title: 'Site Supervisor', seniority: 'manager', departments: ['master_operations'] }, CFG), false)
})

test('Owner Partner entra pela senioridade, mesmo sem casar título nenhum', () => {
  assert.equal(qualifica({ title: 'Owner Partner', seniority: 'owner' }, CFG), true)
})

test('Comptroller entra pelo departamento financeiro, mesmo sem casar "controller"', () => {
  // "comptroller" não contém "controller" — sem o critério de departamento, sumiria.
  assert.equal(qualifica({ title: 'Comptroller', seniority: 'director', departments: ['master_finance'] }, CFG), true)
})

test('acento e caixa não atrapalham', () => {
  assert.equal(qualifica({ title: 'SÓCIO-DIRETOR', seniority: 'owner' }, CFG), true)
  assert.equal(qualifica({ title: 'Socio Diretor', seniority: 'director' }, CFG), true)
})

test('cargo sujo do Apollo ainda casa por trecho', () => {
  assert.equal(qualifica({ title: '◾ Head of Procurement at LBX Construtora', seniority: 'head' }, CFG), true)
  assert.equal(qualifica({ title: 'CFO e DRI', seniority: 'c_suite' }, CFG), true)
})

test('donos e financeiro furam a fila, à frente de senioridade maior', () => {
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'coo', title: 'Chief Operating Officer', seniority: 'c_suite', departments: ['c_suite'] },
    { id: 'gerente-fin', title: 'Gerente Financeiro', seniority: 'manager', departments: ['master_finance'] },
    { id: 'socio', title: 'Owner Partner', seniority: 'owner' },
  ]
  // O gerente financeiro passa na frente do COO: prioritário vence senioridade.
  assert.deepEqual(nomes(entrada), ['socio', 'gerente-fin', 'coo'])
})

test('dentro do grupo prioritário, senioridade decide', () => {
  const entrada: Array<CandidatoCargo & { id: string }> = [
    { id: 'gerente-fin', title: 'Gerente Financeiro', seniority: 'manager', departments: ['master_finance'] },
    { id: 'cfo', title: 'CFO', seniority: 'c_suite', departments: ['c_suite'] },
    { id: 'dir-fin', title: 'Diretor Financeiro do Grupo', seniority: 'director', departments: ['master_finance'] },
  ]
  assert.deepEqual(nomes(entrada), ['cfo', 'dir-fin', 'gerente-fin'])
})

test('o caso real da cury.net: 8 slots deixam de ir para obra', () => {
  const doApollo: Array<CandidatoCargo & { id: string }> = [
    { id: 'construction-1', title: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] },
    { id: 'construction-2', title: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] },
    { id: 'construction-3', title: 'Construction Manager', seniority: 'manager', departments: ['master_operations'] },
    { id: 'comptroller', title: 'Comptroller', seniority: 'director', departments: ['master_finance'] },
    { id: 'eng-rj', title: 'Diretor de Engenharia RJ', seniority: 'director', departments: ['master_engineering_technical'] },
    { id: 'suprimentos', title: 'Gerente de Suprimentos', seniority: 'manager', departments: ['master_operations'] },
    { id: 'controladoria', title: 'Gerente de Controladoria e Planejamento Financeiro', seniority: 'manager', departments: ['master_finance'] },
  ]
  // Os três Construction Manager somem; financeiro vem primeiro, depois o resto por senioridade.
  assert.deepEqual(nomes(doApollo), ['comptroller', 'controladoria', 'eng-rj', 'suprimentos'])
})

test('senioridade fora da lista REBAIXA, não elimina', () => {
  /*
   * Era o contrário, e era a maior fonte de perda: o Apollo classifica boa parte dos
   * cargos brasileiros como 'senior' ou não classifica, e o diretor era descartado
   * pelo rótulo enquanto o título casava perfeitamente.
   */
  assert.equal(qualifica({ title: 'Diretor Técnico' }, CFG), true)
  assert.equal(qualifica({ title: 'Diretor Financeiro', seniority: 'senior' }, CFG), true)
  // E quem não casa título nenhum continua fora, com ou sem senioridade.
  assert.equal(qualifica({ title: 'Motorista' }, CFG), false)
})

test('sem senioridade reconhecida, cai para o FIM da fila', () => {
  // É o que substitui a eliminação: entra, mas só é revelado se sobrar vaga no
  // corte de `max_contatos_por_empresa`.
  const ordenados = selecionarAlvos(
    [
      { id: 'sem-rotulo', title: 'Diretor Financeiro' },
      { id: 'com-rotulo', title: 'Diretor Financeiro', seniority: 'director' },
    ],
    { ...CFG, prioritarios: undefined },
  )
  assert.deepEqual(ordenados.map((p) => p.id), ['com-rotulo', 'sem-rotulo'])
})

/**
 * A leva da 7lm.com.br: 8 contatos pagos e quase nada de financeiro ou dono. Cada
 * caso abaixo é um contato real e a regra que o deixou passar indevidamente.
 */
test('7lm: sigla COO não pode casar "Coordenador"', () => {
  // Era `includes('coo')`: "COOrdenador de Recrutamento" casava a sigla de COO.
  assert.equal(qualifica({ title: 'Coordenador de Recrutamento e Seleção', seniority: 'manager', departments: ['master_human_resources'] }, CFG), false)
  assert.equal(qualifica({ title: 'Coordenadora de DHO', seniority: 'manager', departments: ['master_human_resources'] }, CFG), false)
  // E a sigla de verdade continua casando.
  assert.equal(qualifica({ title: 'COO / Diretor Supply Chain', seniority: 'c_suite' }, CFG), true)
  assert.equal(qualifica({ title: 'CFO e DRI', seniority: 'c_suite' }, CFG), true)
})

test('7lm: estagiário e analista agora dependem de excluir_titulos', () => {
  /*
   * Estes dois eram barrados pela allow-list de senioridade, que saiu. Com ela fora,
   * quem os segura é a exclusão POR TÍTULO — que é a ferramenta certa: ela olha o
   * cargo, e não um rótulo que o provedor pode não ter posto.
   *
   * Sem os termos na configuração, os dois voltam a passar: `Finance Department
   * Intern` casa 'finance' no grupo prioritário e vai para o TOPO da fila paga, que
   * é exatamente o que aconteceu na leva da 7lm.
   */
  const semGuarda: CargosAlvo = { ...CFG, excluir_titulos: [] }
  assert.equal(qualifica({ title: 'Finance Department Intern', seniority: 'intern', departments: ['master_finance'] }, semGuarda), true)

  const comGuarda: CargosAlvo = { ...CFG, excluir_titulos: [...(CFG.excluir_titulos ?? []), 'intern', 'estagi', 'analyst', 'analista'] }
  assert.equal(qualifica({ title: 'Finance Department Intern', seniority: 'intern', departments: ['master_finance'] }, comGuarda), false)
  assert.equal(qualifica({ title: 'Controller Analyst', seniority: 'entry', departments: ['master_finance'] }, comGuarda), false)
  // O mesmo cargo em nível de gestão continua entrando com a guarda ligada.
  assert.equal(qualifica({ title: 'Controller', seniority: 'director', departments: ['master_finance'] }, comGuarda), true)
})

test('7lm: "Business Partner" de RH não é sócio', () => {
  // O Apollo marca a senioridade como `partner`; só a exclusão por título segura.
  assert.equal(qualifica({ title: 'Business Partner (BP)', seniority: 'partner', departments: ['master_sales'] }, CFG), false)
  // Sócio de verdade continua entrando.
  assert.equal(qualifica({ title: 'Managing Partner', seniority: 'partner' }, CFG), true)
  assert.equal(qualifica({ title: 'Owner Partner', seniority: 'owner' }, CFG), true)
})

test('7lm: diretoria de RH é excluída, mesmo casando "diretor"', () => {
  assert.equal(qualifica({ title: 'Diretora Gente & Cultura / Sucesso do Cliente', seniority: 'director' }, CFG), false)
  assert.equal(qualifica({ title: 'Diretor De Gente & Gestão', seniority: 'director' }, CFG), false)
  // Diretoria que interessa segue passando.
  assert.equal(qualifica({ title: 'Executive Director', seniority: 'director' }, CFG), true)
  assert.equal(qualifica({ title: 'Diretor Financeiro do Grupo', seniority: 'director', departments: ['master_finance'] }, CFG), true)
})

test('7lm: departamento vetado corta mesmo com título aceitável', () => {
  assert.equal(qualifica({ title: 'Commercial Director', seniority: 'director', departments: ['master_sales'] }, CFG), false)
})

test('exclusão vence prioridade: nada entra por ser financeiro se a área é vetada', () => {
  assert.equal(
    qualifica({ title: 'Business Partner Financeiro', seniority: 'manager', departments: ['master_finance'] }, CFG),
    false,
  )
})

test('C-level em inglês entra pela senioridade, sem casar título', () => {
  // "Chief Operating Officer" não contém 'COO'; "Managing Partner" não contém 'sócio'.
  assert.equal(qualifica({ title: 'Chief Operating Officer', seniority: 'c_suite', departments: ['c_suite'] }, CFG), true)
  assert.equal(qualifica({ title: 'Managing Partner', seniority: 'partner' }, CFG), true)
  // Mas 'manager' fora da lista continua exigindo título — senão a obra volta inteira.
  assert.equal(qualifica({ title: 'Construction Manager', seniority: 'manager' }, CFG), false)
})

test('cargo em inglês não pode ser cortado por falta do termo em português', () => {
  // Regressão real: a lista original só tinha termos em pt, e a simulação sobre os
  // 113 contatos da base descartava 11 diretores legítimos — todos anglófonos.
  const ingles = ['Engineering Director', 'Executive Director', 'Administrative Director', 'Director']
  for (const title of ingles) {
    assert.equal(qualifica({ title, seniority: 'director' }, CFG), true, `${title} deveria entrar`)
  }
  assert.equal(qualifica({ title: 'Engineering Manager', seniority: 'manager' }, CFG), true)
  assert.equal(qualifica({ title: 'Administrative Manager', seniority: 'manager' }, CFG), true)
  // E o que tem de continuar fora: obra.
  assert.equal(qualifica({ title: 'Construction Manager', seniority: 'manager' }, CFG), false)
})

test('sem prioritarios configurado, ninguém fura a fila e nada quebra', () => {
  const semPrio: CargosAlvo = { ...CFG, prioritarios: undefined, senioridades_qualificam: [] }
  const entrada = [
    { id: 'gerente-fin', title: 'Gerente Financeiro', seniority: 'manager', departments: ['master_finance'] },
    { id: 'diretor', title: 'Diretor de Engenharia', seniority: 'director' },
  ]
  assert.deepEqual(
    selecionarAlvos(entrada, semPrio).map((p) => p.id),
    ['diretor', 'gerente-fin'],
  )
  // "Owner Partner" só entrava pelos prioritários: sem eles, é descartado.
  assert.equal(qualifica({ title: 'Owner Partner', seniority: 'owner' }, semPrio), false)
})

test('não muta a lista recebida', () => {
  const entrada = [
    { id: 'gerente-fin', title: 'Gerente Financeiro', seniority: 'manager', departments: ['master_finance'] },
    { id: 'cfo', title: 'CFO', seniority: 'c_suite' },
  ]
  selecionarAlvos(entrada, CFG)
  assert.deepEqual(
    entrada.map((p) => p.id),
    ['gerente-fin', 'cfo'],
  )
})

test('lista vazia e empresa sem ninguém elegível devolvem vazio', () => {
  assert.deepEqual(selecionarAlvos([], CFG), [])
  assert.deepEqual(selecionarAlvos([{ title: 'Construction Manager', seniority: 'manager' }], CFG), [])
})
