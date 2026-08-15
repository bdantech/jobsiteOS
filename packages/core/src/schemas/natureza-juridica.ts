/**
 * A tabela de NATUREZA JURÍDICA (CONCLA/IBGE 2021), que é a mesma que a Receita
 * Federal usa no dump do CNPJ e que chega a `mercado_universo.natureza_juridica`.
 *
 * A CHAVE É O CÓDIGO DE QUATRO DÍGITOS, e não o texto. Três razões, todas medidas
 * na nossa base de 899.295 CNPJs com natureza preenchida:
 *
 *  1. O texto vem em dois formatos. 627.012 linhas trazem "2062 - Sociedade
 *     Empresária Limitada" e 5.597 trazem só "2062" — a mesma natureza, dois
 *     valores diferentes. Um filtro por texto pegaria um grupo e perderia o outro,
 *     sem erro nem aviso.
 *  2. O rótulo muda de revisão para revisão (o 2321 é "Sociedade Unipessoal de
 *     Advocacia" no nosso dump e "Sociedade Unipessoal de Advogados" na tabela
 *     oficial). Uma regra de faixa gravada com o texto quebraria na próxima carga.
 *  3. O código é estável e curto, então é o que fica gravado na definição da regra.
 *
 * O IBGE publica o código com dígito verificador ("206-2"); aqui ele mora
 * concatenado ("2062"), que é a forma do dump da Receita e a que a view normaliza.
 *
 * A lista é COMPLETA de propósito — os 92 códigos oficiais, e não só os 51 que
 * aparecem na nossa base hoje. Uma natureza que ainda não emitiu nota para nós
 * pode emitir amanhã, e um dropdown que só oferece o que já existe faz o operador
 * concluir que a natureza que ele procura não existe.
 */

export interface NaturezaJuridica {
  /** Código de 4 dígitos, sem o hífen do dígito verificador. */
  codigo: string
  label: string
  /** O agrupamento de primeiro nível da tabela do IBGE. */
  grupo: GrupoNaturezaJuridica
}

export const GRUPOS_NATUREZA_JURIDICA = [
  'administracao_publica',
  'empresarial',
  'sem_fins_lucrativos',
  'pessoa_fisica',
  'internacional',
] as const
export type GrupoNaturezaJuridica = (typeof GRUPOS_NATUREZA_JURIDICA)[number]

export const GRUPO_NATUREZA_JURIDICA_LABELS: Record<GrupoNaturezaJuridica, string> = {
  administracao_publica: 'Administração pública',
  empresarial: 'Entidades empresariais',
  sem_fins_lucrativos: 'Entidades sem fins lucrativos',
  pessoa_fisica: 'Pessoas físicas',
  internacional: 'Organizações internacionais',
}

export const NATUREZAS_JURIDICAS: readonly NaturezaJuridica[] = [
  // ─── 1. Administração pública ─────────────────────────────────────────────
  { codigo: '1015', label: 'Órgão Público do Poder Executivo Federal', grupo: 'administracao_publica' },
  { codigo: '1023', label: 'Órgão Público do Poder Executivo Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1031', label: 'Órgão Público do Poder Executivo Municipal', grupo: 'administracao_publica' },
  { codigo: '1040', label: 'Órgão Público do Poder Legislativo Federal', grupo: 'administracao_publica' },
  { codigo: '1058', label: 'Órgão Público do Poder Legislativo Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1066', label: 'Órgão Público do Poder Legislativo Municipal', grupo: 'administracao_publica' },
  { codigo: '1074', label: 'Órgão Público do Poder Judiciário Federal', grupo: 'administracao_publica' },
  { codigo: '1082', label: 'Órgão Público do Poder Judiciário Estadual', grupo: 'administracao_publica' },
  { codigo: '1104', label: 'Autarquia Federal', grupo: 'administracao_publica' },
  { codigo: '1112', label: 'Autarquia Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1120', label: 'Autarquia Municipal', grupo: 'administracao_publica' },
  { codigo: '1139', label: 'Fundação Pública de Direito Público Federal', grupo: 'administracao_publica' },
  { codigo: '1147', label: 'Fundação Pública de Direito Público Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1155', label: 'Fundação Pública de Direito Público Municipal', grupo: 'administracao_publica' },
  { codigo: '1163', label: 'Órgão Público Autônomo Federal', grupo: 'administracao_publica' },
  { codigo: '1171', label: 'Órgão Público Autônomo Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1180', label: 'Órgão Público Autônomo Municipal', grupo: 'administracao_publica' },
  { codigo: '1198', label: 'Comissão Polinacional', grupo: 'administracao_publica' },
  { codigo: '1210', label: 'Consórcio Público de Direito Público (Associação Pública)', grupo: 'administracao_publica' },
  { codigo: '1228', label: 'Consórcio Público de Direito Privado', grupo: 'administracao_publica' },
  { codigo: '1236', label: 'Estado ou Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1244', label: 'Município', grupo: 'administracao_publica' },
  { codigo: '1252', label: 'Fundação Pública de Direito Privado Federal', grupo: 'administracao_publica' },
  { codigo: '1260', label: 'Fundação Pública de Direito Privado Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1279', label: 'Fundação Pública de Direito Privado Municipal', grupo: 'administracao_publica' },
  { codigo: '1287', label: 'Fundo Público da Administração Indireta Federal', grupo: 'administracao_publica' },
  { codigo: '1295', label: 'Fundo Público da Administração Indireta Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1309', label: 'Fundo Público da Administração Indireta Municipal', grupo: 'administracao_publica' },
  { codigo: '1317', label: 'Fundo Público da Administração Direta Federal', grupo: 'administracao_publica' },
  { codigo: '1325', label: 'Fundo Público da Administração Direta Estadual ou do Distrito Federal', grupo: 'administracao_publica' },
  { codigo: '1333', label: 'Fundo Público da Administração Direta Municipal', grupo: 'administracao_publica' },
  { codigo: '1341', label: 'União', grupo: 'administracao_publica' },

  // ─── 2. Entidades empresariais ────────────────────────────────────────────
  // Onde moram os fornecedores: 2062 (Ltda) sozinha responde por 632.609 dos
  // 899.295 CNPJs da base, e 2135 (Empresário Individual) por outros 204.094.
  { codigo: '2011', label: 'Empresa Pública', grupo: 'empresarial' },
  { codigo: '2038', label: 'Sociedade de Economia Mista', grupo: 'empresarial' },
  { codigo: '2046', label: 'Sociedade Anônima Aberta', grupo: 'empresarial' },
  { codigo: '2054', label: 'Sociedade Anônima Fechada', grupo: 'empresarial' },
  { codigo: '2062', label: 'Sociedade Empresária Limitada', grupo: 'empresarial' },
  { codigo: '2070', label: 'Sociedade Empresária em Nome Coletivo', grupo: 'empresarial' },
  { codigo: '2089', label: 'Sociedade Empresária em Comandita Simples', grupo: 'empresarial' },
  { codigo: '2097', label: 'Sociedade Empresária em Comandita por Ações', grupo: 'empresarial' },
  { codigo: '2127', label: 'Sociedade em Conta de Participação', grupo: 'empresarial' },
  { codigo: '2135', label: 'Empresário (Individual)', grupo: 'empresarial' },
  { codigo: '2143', label: 'Cooperativa', grupo: 'empresarial' },
  { codigo: '2151', label: 'Consórcio de Sociedades', grupo: 'empresarial' },
  { codigo: '2160', label: 'Grupo de Sociedades', grupo: 'empresarial' },
  { codigo: '2178', label: 'Estabelecimento, no Brasil, de Sociedade Estrangeira', grupo: 'empresarial' },
  { codigo: '2194', label: 'Estabelecimento, no Brasil, de Empresa Binacional Argentino-Brasileira', grupo: 'empresarial' },
  { codigo: '2216', label: 'Empresa Domiciliada no Exterior', grupo: 'empresarial' },
  { codigo: '2224', label: 'Clube/Fundo de Investimento', grupo: 'empresarial' },
  { codigo: '2232', label: 'Sociedade Simples Pura', grupo: 'empresarial' },
  { codigo: '2240', label: 'Sociedade Simples Limitada', grupo: 'empresarial' },
  { codigo: '2259', label: 'Sociedade Simples em Nome Coletivo', grupo: 'empresarial' },
  { codigo: '2267', label: 'Sociedade Simples em Comandita Simples', grupo: 'empresarial' },
  { codigo: '2275', label: 'Empresa Binacional', grupo: 'empresarial' },
  { codigo: '2283', label: 'Consórcio de Empregadores', grupo: 'empresarial' },
  { codigo: '2291', label: 'Consórcio Simples', grupo: 'empresarial' },
  { codigo: '2305', label: 'Empresa Individual de Responsabilidade Limitada (de Natureza Empresária)', grupo: 'empresarial' },
  { codigo: '2313', label: 'Empresa Individual de Responsabilidade Limitada (de Natureza Simples)', grupo: 'empresarial' },
  { codigo: '2321', label: 'Sociedade Unipessoal de Advogados', grupo: 'empresarial' },
  { codigo: '2330', label: 'Cooperativas de Consumo', grupo: 'empresarial' },
  { codigo: '2348', label: 'Empresa Simples de Inovação — Inova Simples', grupo: 'empresarial' },
  { codigo: '2356', label: 'Investidor Não Residente', grupo: 'empresarial' },

  // ─── 3. Entidades sem fins lucrativos ─────────────────────────────────────
  { codigo: '3034', label: 'Serviço Notarial e Registral (Cartório)', grupo: 'sem_fins_lucrativos' },
  { codigo: '3069', label: 'Fundação Privada', grupo: 'sem_fins_lucrativos' },
  { codigo: '3077', label: 'Serviço Social Autônomo', grupo: 'sem_fins_lucrativos' },
  { codigo: '3085', label: 'Condomínio Edilício', grupo: 'sem_fins_lucrativos' },
  { codigo: '3107', label: 'Comissão de Conciliação Prévia', grupo: 'sem_fins_lucrativos' },
  { codigo: '3115', label: 'Entidade de Mediação e Arbitragem', grupo: 'sem_fins_lucrativos' },
  { codigo: '3131', label: 'Entidade Sindical', grupo: 'sem_fins_lucrativos' },
  { codigo: '3204', label: 'Estabelecimento, no Brasil, de Fundação ou Associação Estrangeiras', grupo: 'sem_fins_lucrativos' },
  { codigo: '3212', label: 'Fundação ou Associação Domiciliada no Exterior', grupo: 'sem_fins_lucrativos' },
  { codigo: '3220', label: 'Organização Religiosa', grupo: 'sem_fins_lucrativos' },
  { codigo: '3239', label: 'Comunidade Indígena', grupo: 'sem_fins_lucrativos' },
  { codigo: '3247', label: 'Fundo Privado', grupo: 'sem_fins_lucrativos' },
  { codigo: '3255', label: 'Órgão de Direção Nacional de Partido Político', grupo: 'sem_fins_lucrativos' },
  { codigo: '3263', label: 'Órgão de Direção Regional de Partido Político', grupo: 'sem_fins_lucrativos' },
  { codigo: '3271', label: 'Órgão de Direção Local de Partido Político', grupo: 'sem_fins_lucrativos' },
  { codigo: '3280', label: 'Comitê Financeiro de Partido Político', grupo: 'sem_fins_lucrativos' },
  { codigo: '3298', label: 'Frente Plebiscitária ou Referendária', grupo: 'sem_fins_lucrativos' },
  { codigo: '3301', label: 'Organização Social (OS)', grupo: 'sem_fins_lucrativos' },
  { codigo: '3310', label: 'Demais Condomínios', grupo: 'sem_fins_lucrativos' },
  { codigo: '3328', label: 'Plano de Benefícios de Previdência Complementar Fechada', grupo: 'sem_fins_lucrativos' },
  { codigo: '3999', label: 'Associação Privada', grupo: 'sem_fins_lucrativos' },

  // ─── 4. Pessoas físicas ───────────────────────────────────────────────────
  { codigo: '4014', label: 'Empresa Individual Imobiliária', grupo: 'pessoa_fisica' },
  { codigo: '4022', label: 'Segurado Especial', grupo: 'pessoa_fisica' },
  { codigo: '4081', label: 'Contribuinte Individual', grupo: 'pessoa_fisica' },
  { codigo: '4090', label: 'Candidato a Cargo Político Eletivo', grupo: 'pessoa_fisica' },
  { codigo: '4111', label: 'Leiloeiro', grupo: 'pessoa_fisica' },
  { codigo: '4120', label: 'Produtor Rural (Pessoa Física)', grupo: 'pessoa_fisica' },

  // ─── 5. Organizações internacionais ───────────────────────────────────────
  { codigo: '5010', label: 'Organização Internacional', grupo: 'internacional' },
  { codigo: '5029', label: 'Representação Diplomática Estrangeira', grupo: 'internacional' },
  { codigo: '5037', label: 'Outras Instituições Extraterritoriais', grupo: 'internacional' },
]

export const NATUREZA_JURIDICA_CODIGOS: readonly string[] = NATUREZAS_JURIDICAS.map((n) => n.codigo)

export const NATUREZA_JURIDICA_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(NATUREZAS_JURIDICAS.map((n) => [n.codigo, n.label])),
)

/**
 * O rótulo do jeito que o operador precisa ver num dropdown de 92 linhas: o código
 * na frente, porque é ele que fica gravado na regra e é por ele que se confere.
 */
export function rotuloNaturezaJuridica(codigo: string): string {
  const label = NATUREZA_JURIDICA_LABELS[codigo]
  return label ? `${codigo} — ${label}` : codigo
}

// A extração do código a partir do texto do dump NÃO mora aqui: é
// `codigoNaturezaJuridica()` em `perfil/natureza-juridica.ts`, que já existia e já
// aceita os três formatos ("2062", "206-2", "2062 - Sociedade…"). Este arquivo é a
// TABELA; aquele é o parser. Duas implementações da mesma extração é como a tela e
// a regra passam a discordar sobre o que é uma Ltda.
