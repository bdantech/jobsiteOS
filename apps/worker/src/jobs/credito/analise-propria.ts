/*
 * Imports RELATIVOS ao fonte do core, e não `@jobsiteos/core` — como os outros 40
 * arquivos deste worker.
 *
 * Não é preferência de estilo: o `rootDir` do worker é a raiz do repo, então o tsc emite
 * `dist/packages/core/...` ao lado de `dist/apps/worker/...` e o caminho relativo resolve
 * dentro do dist. O estágio runner do Dockerfile copia SÓ `apps/worker/dist` — o fonte de
 * packages/core nunca chega lá. Um import pelo nome do pacote compila, passa no
 * typecheck, roda em desenvolvimento, e só falha no boot do container.
 */
import { AI_MODEL, EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  DOCS_EXTRAIVEIS,
  INDICADOR_LABELS,
  PARAMETROS_PADRAO,
  TETO_LABELS,
  achatarExtracao,
  calcularAnalise,
  classificarQuadrante,
  criticosPendentes,
  protestoVencido,
  type ContextoAnalise,
  type OpcoesProtesto,
  type DadosExtraidos,
  type ParametrosAnalise,
} from '../../../../../packages/core/src/credito/analise.js'
import { formatCnpj } from '../../../../../packages/core/src/schemas/cnpj.js'
import { notify } from '../../../../../packages/core/src/server/notify.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { protestosEmpresa } from '../radar/protestos.js'
import { recalcularScoresDeCnpjs } from './potencial.js'

/**
 * Análise de crédito proprietária (04j): as três etapas, no worker.
 *
 *   extração (IA lê)  →  REVISÃO HUMANA  →  cálculo (matemática)  →  parecer (IA escreve)
 *
 * ─── POR QUE ISTO NÃO É UM REQUEST DE TELA ──────────────────────────────────
 * Um balanço de 40 páginas mais um DRE mais uma relação de faturamento é um único
 * request ao modelo que leva minutos. Nenhum handler HTTP de tela sobrevive a isso, e
 * fatiar em N requests menores é pior: o modelo perderia justamente a capacidade de
 * cruzar o DRE com a relação de faturamento e apontar o conflito.
 *
 * ─── POR QUE A REVISÃO INTERROMPE O FLUXO ───────────────────────────────────
 * A extração para em `aguardando_revisao` e só volta quando um humano confirma os campos
 * críticos. O cálculo nunca roda sobre número não conferido: um limite de R$ 4 milhões
 * construído sobre um EBITDA que o modelo leu numa linha errada é indistinguível, na
 * tela, de um limite correto.
 *
 * ─── FALHA NUNCA É SILENCIOSA ───────────────────────────────────────────────
 * Qualquer etapa que estoure grava `status = 'falhou'` com texto legível e a etapa em
 * que parou. Meia extração gravada e nenhum aviso é pior do que erro nenhum.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

/** O modelo aceita PDF nativo e escaneado no mesmo bloco; acima disto, corta-se. */
const LIMITE_BYTES_POR_DOC = 20 * 1024 * 1024
const LIMITE_BYTES_TOTAL = 28 * 1024 * 1024

// ─── Tipos locais ───────────────────────────────────────────────────────────

interface LinhaAnalise {
  id: string
  analise_credito_id: string | null
  empresa_id: string | null
  cnpj: string
  tipo: string
  status: string
  etapa: string | null
  dados_extraidos: DadosExtraidos | null
  parametros_versao: number
  criada_por: string | null
  protestos_opcoes: OpcoesProtesto | null
}

interface DocParaLer {
  id: string
  tipo: string
  nome_arquivo: string | null
  arquivo_url: string
}

interface RespostaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

// ─── Utilitários ────────────────────────────────────────────────────────────

async function marcarFalha(id: string, etapa: string, erro: unknown): Promise<void> {
  const texto = erro instanceof Error ? erro.message : String(erro)
  logger.error({ analise: id, etapa, erro: texto }, 'Análise proprietária falhou.')
  await supabaseAdmin
    .from('analises_proprietarias')
    .update({ status: 'falhou', etapa, erro: texto } as never)
    .eq('id', id)
  await emitirEvento(null, EVENTO_TIPOS.ANALISE_PROPRIA_FALHOU, {
    analise_propria_id: id,
    etapa,
    titulo: 'Análise proprietária falhou',
    url: `/credito/analises`,
  })
}

async function parametros(versao: number): Promise<ParametrosAnalise> {
  const { data } = await supabaseAdmin
    .from('analise_parametros')
    .select('definicao')
    .eq('versao', versao)
    .maybeSingle()
  // Cai no padrão do core se a versão sumir: um cálculo com parâmetro faltando é pior
  // que um cálculo com o padrão declarado, e a versão gravada denuncia a diferença.
  return ((data?.definicao as ParametrosAnalise | undefined) ?? PARAMETROS_PADRAO)
}

// ─── §3 Extração ────────────────────────────────────────────────────────────

/**
 * O esquema que o modelo é OBRIGADO a preencher. Vai como tool com `tool_choice`
 * forçado: pedir "responda só JSON" em texto livre funciona quase sempre, e "quase
 * sempre" numa esteira de crédito significa uma análise por semana que morre no parse.
 */
const ESQUEMA_EXTRACAO = {
  type: 'object',
  properties: {
    exercicios: {
      type: 'array',
      description: 'Um bloco por exercício encontrado, no máximo os 3 mais recentes.',
      items: {
        type: 'object',
        properties: {
          exercicio: { type: 'integer', description: 'O ano do exercício, ex.: 2024.' },
          moeda: { type: 'string' },
          campos: {
            type: 'object',
            description:
              'Cada campo é { valor, origem: { documento_id, pagina, trecho_curto } }. ' +
              'Campo não localizado deve ser OMITIDO e listado em lacunas.',
            additionalProperties: {
              type: 'object',
              properties: {
                valor: { type: ['number', 'null'] },
                origem: {
                  type: 'object',
                  properties: {
                    documento_id: { type: 'string' },
                    pagina: { type: ['integer', 'null'] },
                    trecho_curto: { type: 'string' },
                  },
                  required: ['documento_id', 'trecho_curto'],
                },
              },
              required: ['valor', 'origem'],
            },
          },
        },
        required: ['exercicio', 'moeda', 'campos'],
      },
    },
    lacunas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Um item por campo-alvo não localizado, dizendo qual campo e em que exercício.',
    },
    conflitos: {
      type: 'array',
      description: 'Mesmo campo com valores diferentes em documentos diferentes.',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string' },
          exercicio: { type: ['integer', 'null'] },
          valores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                valor: { type: 'number' },
                origem: {
                  type: 'object',
                  properties: {
                    documento_id: { type: 'string' },
                    pagina: { type: ['integer', 'null'] },
                    trecho_curto: { type: 'string' },
                  },
                  required: ['documento_id', 'trecho_curto'],
                },
              },
              required: ['valor', 'origem'],
            },
          },
        },
        required: ['campo', 'valores'],
      },
    },
  },
  required: ['exercicios', 'lacunas', 'conflitos'],
} as const

const CAMPOS_ALVO = [
  'receita_bruta',
  'receita_liquida',
  'cmv',
  'lucro_bruto',
  'despesas_operacionais',
  'depreciacao_amortizacao',
  'resultado_equivalencia_patrimonial',
  'ebitda',
  'resultado_financeiro',
  'lucro_liquido',
  'ativo_circulante',
  'ativo_nao_circulante',
  'caixa',
  'contas_receber',
  'estoques',
  'passivo_circulante',
  'passivo_nao_circulante',
  'emprestimos_curto_prazo',
  'emprestimos_longo_prazo',
  'fornecedores',
  'patrimonio_liquido',
].join(', ')

const INSTRUCOES_EXTRACAO =
  `Você está lendo documentos contábeis de uma empresa brasileira de construção civil ` +
  `para uma análise de crédito. Extraia os dados e registre-os pela ferramenta.\n\n` +
  `CAMPOS-ALVO (por exercício, até os 3 mais recentes): ${CAMPOS_ALVO}.\n\n` +
  `REGRAS INEGOCIÁVEIS:\n` +
  `1. NUNCA infira, estime, calcule por analogia ou preencha um campo que não esteja ` +
  `escrito no documento. Campo ausente é OMITIDO dos campos e vai para lacunas[].\n` +
  `2. Todo campo extraído carrega origem: { documento_id, pagina, trecho_curto }. ` +
  `O documento_id é o identificador que aparece no bloco de texto antes de cada arquivo. ` +
  `O trecho_curto é a linha do documento onde o número está, em até 80 caracteres.\n` +
  `3. Valores numéricos SEM separador de milhar e com ponto decimal. Se o documento ` +
  `estiver em milhares ou milhões, converta para a unidade cheia e diga isso no ` +
  `trecho_curto.\n` +
  `4. SINAL: custos e despesas vão como MAGNITUDE POSITIVA (cmv, despesas_operacionais, ` +
  `depreciacao_amortizacao). A ÚNICA exceção é resultado_financeiro, em que o sinal É a ` +
  `informação: positivo quando as receitas financeiras superam as despesas, negativo no ` +
  `contrário. Não generalize a regra do sinal negativo para as outras linhas.\n` +
  `5. Se o mesmo campo aparecer com valores diferentes em documentos diferentes, ` +
  `registre em conflitos[] com os dois valores e as duas origens — não escolha um.\n` +
  `6. EBITDA: se estiver explícito, use-o. Se não estiver, OMITA — continue não o montando. ` +
  `Em vez disso, extraia com cuidado as três linhas que permitem derivá-lo depois: ` +
  `despesas_operacionais (o total de despesas operacionais/SG&A), depreciacao_amortizacao ` +
  `(some as duas se vierem separadas; omita se nenhuma aparecer) e ` +
  `resultado_equivalencia_patrimonial. Muitos formulários brasileiros — o padrão da CAIXA, ` +
  `por exemplo — não publicam EBITDA nem depreciação, e é normal que esses campos faltem.\n` +
  `7. Lucro líquido NÃO é EBITDA, e resultado antes dos tributos NÃO é EBITDA. Cada um vai ` +
  `para o seu próprio campo; nenhum deles serve de substituto para outro.`

/**
 * Sobe os PDFs ao modelo e devolve a extração.
 *
 * Os documentos vão TODOS num request só: é o que permite ao modelo cruzar o DRE com a
 * relação de faturamento e apontar o conflito, que é metade do valor da extração.
 * O que não couber no orçamento de bytes fica de fora — e aparece nas lacunas, nunca em
 * silêncio.
 */
async function extrair(docs: DocParaLer[]): Promise<DadosExtraidos> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada no worker.')

  const conteudo: unknown[] = [{ type: 'text', text: INSTRUCOES_EXTRACAO }]
  const cortados: string[] = []
  let total = 0

  for (const doc of docs) {
    const { data, error } = await supabaseAdmin.storage.from('analise-docs').download(doc.arquivo_url)
    if (error || !data) {
      cortados.push(`${doc.nome_arquivo ?? doc.arquivo_url}: não foi possível baixar do storage.`)
      continue
    }
    const bytes = Buffer.from(await data.arrayBuffer())
    if (bytes.length > LIMITE_BYTES_POR_DOC) {
      cortados.push(`${doc.nome_arquivo ?? doc.tipo}: arquivo grande demais para o modelo (${Math.round(bytes.length / 1e6)}MB).`)
      continue
    }
    if (total + bytes.length > LIMITE_BYTES_TOTAL) {
      cortados.push(`${doc.nome_arquivo ?? doc.tipo}: não coube no orçamento do request e NÃO foi lido.`)
      continue
    }
    total += bytes.length

    const ehPdf = /\.pdf$/i.test(doc.arquivo_url) || data.type === 'application/pdf'
    conteudo.push({
      type: 'text',
      text: `--- documento_id: ${doc.id} | tipo: ${doc.tipo} | arquivo: ${doc.nome_arquivo ?? '—'} ---`,
    })
    conteudo.push(
      ehPdf
        ? {
            // O bloco `document` cobre PDF nativo E escaneado: o modelo lê o texto quando
            // existe e enxerga a página quando não existe. É o que dispensa um extrator de
            // texto e um rasterizador (dependência nativa) no worker.
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
          }
        : {
            type: 'image',
            source: {
              type: 'base64',
              media_type: data.type || 'image/png',
              data: bytes.toString('base64'),
            },
          },
    )
  }

  if (total === 0) {
    throw new Error('Nenhum documento contábil legível foi encontrado nesta análise.')
  }

  const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: {
      model: AI_MODEL,
      max_tokens: 8192,
      tools: [
        {
          name: 'registrar_extracao',
          description: 'Registra os dados contábeis extraídos, com origem por campo.',
          input_schema: ESQUEMA_EXTRACAO,
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_extracao' },
      messages: [{ role: 'user', content: conteudo }],
    },
    timeoutMs: 600_000,
    // Uma tentativa extra apenas: cada retry relê os mesmos PDFs e custa o mesmo tanto.
    tentativas: 2,
  })

  const bloco = (resp.content ?? []).find((c) => c.type === 'tool_use' && c.name === 'registrar_extracao')
  if (!bloco?.input) throw new Error('O modelo não devolveu a extração no formato esperado.')

  const dados = bloco.input as DadosExtraidos
  return {
    exercicios: dados.exercicios ?? [],
    lacunas: [...(dados.lacunas ?? []), ...cortados],
    conflitos: dados.conflitos ?? [],
  }
}

// ─── §5 Parecer ─────────────────────────────────────────────────────────────

const SECOES_PARECER = [
  '1. Resumo e recomendação',
  '2. A empresa',
  '3. Situação financeira',
  '4. Riscos identificados',
  '5. Pontos fortes',
  '6. O que não fecha',
  '7. Perguntas a fazer ao cliente',
  '8. Sanity check do limite sugerido',
]

async function gerarParecer(
  dossie: Record<string, unknown>,
  extras: string,
): Promise<{ texto: string; modelo: string; tokens: number }> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada no worker.')

  const prompt =
    `Você é analista de crédito de um FIDC que antecipa recebíveis da construção civil. ` +
    `Escreva um MEMORANDO DE COMITÊ em markdown sobre o sacado abaixo.\n\n` +
    `SEÇÕES FIXAS, nesta ordem, como títulos de nível 2:\n${SECOES_PARECER.map((s) => `## ${s}`).join('\n')}\n\n` +
    `RESTRIÇÕES:\n` +
    `- Use APENAS os dados fornecidos. Não invente número algum, nem "de mercado", nem ` +
    `"típico do setor".\n` +
    `- Cite de onde veio cada afirmação relevante (o indicador, o teto, o scorecard, os ` +
    `protestos, a extração).\n` +
    `- Quando a base for insuficiente para opinar sobre algo, DIGA ISSO explicitamente em ` +
    `vez de opinar mesmo assim.\n` +
    `- A seção 6 lista as lacunas e os conflitos NOMINALMENTE, um a um.\n` +
    `- A seção 8 é uma CRÍTICA ao limite calculado: diga se ele lhe parece alto, baixo ou ` +
    `adequado e por quê. Você NÃO altera o número — o cálculo é determinístico e a sua ` +
    `opinião entra como texto ao lado dele, não no lugar dele.\n` +
    `- Português do Brasil, tom sóbrio, sem adjetivos de venda.\n` +
    (extras ? `\nINSTRUÇÕES ADICIONAIS DA CASA:\n${extras}\n` : '') +
    `\nDOSSIÊ (JSON):\n${JSON.stringify(dossie, null, 2)}`

  const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: { model: AI_MODEL, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] },
    timeoutMs: 300_000,
    tentativas: 2,
  })

  const texto = (resp.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
    .trim()
  if (!texto) throw new Error('O modelo devolveu um parecer vazio.')

  return {
    texto,
    modelo: resp.model ?? AI_MODEL,
    tokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
  }
}

// ─── As etapas, encadeadas ──────────────────────────────────────────────────

/**
 * Etapa 0: os protestos, antes de qualquer leitura de documento.
 *
 * ─── POR QUE ANTES, E NÃO DEPOIS ────────────────────────────────────────────
 * Protesto não entra na análise por uma porta direta — ele é fator do scorecard (04d), o
 * scorecard vira faixa, e a faixa É o teto 5. Consultar depois do cálculo não mudaria
 * nada: o teto já teria saído com o fator inavaliável, que derruba a completude e pode
 * empurrar o score inteiro para `dados_insuficientes`. O limite sairia menor por falta de
 * um dado que ninguém foi buscar.
 *
 * Por isso a consulta roda aqui E o score é recalculado logo em seguida, na mesma corrida.
 * Consultar sem recalcular seria pagar pela informação e não usá-la — o score só se
 * atualizaria sozinho no job mensal.
 *
 * ─── FALHA AQUI NÃO DERRUBA A ANÁLISE ───────────────────────────────────────
 * Protesto é enriquecimento. Se a DirectD estiver fora do ar ou sem chave, o que se perde
 * é um fator do scorecard; perder junto a extração inteira seria trocar um problema por
 * dois. O erro fica gravado em `protestos_resultado` e a análise segue.
 */
async function etapaProtestos(linha: LinhaAnalise, p: ParametrosAnalise): Promise<void> {
  const opcoes: OpcoesProtesto = linha.protestos_opcoes ?? {
    incluir_spes: false,
    ano_min: null,
    somente_afiancadas: false,
  }
  const recencia = p.protestos?.recencia_dias ?? 90

  const { data: atual } = await supabaseAdmin
    .from('protestos_atual')
    .select('consultado_em')
    .eq('cnpj', linha.cnpj)
    .maybeSingle()

  const matrizVencida = protestoVencido(atual?.consultado_em, recencia, new Date())

  // Nada a fazer: a matriz esta fresca e ninguem pediu SPEs. Nao e um caso de erro — e o
  // caso comum de quem roda a analise duas vezes na mesma semana.
  if (!matrizVencida && !opcoes.incluir_spes) {
    await supabaseAdmin
      .from('analises_proprietarias')
      .update({
        etapa: 'extracao',
        protestos_resultado: {
          consultados: 0,
          custo: 0,
          pulou_matriz_por_recencia: true,
          consultado_em: atual?.consultado_em ?? null,
          recencia_dias: recencia,
        } as never,
      } as never)
      .eq('id', linha.id)
    logger.info({ analise: linha.id, cnpj: linha.cnpj }, 'Protesto recente reaproveitado.')
    return
  }

  if (!linha.empresa_id) {
    await supabaseAdmin
      .from('analises_proprietarias')
      .update({
        etapa: 'extracao',
        protestos_resultado: {
          consultados: 0,
          custo: 0,
          erro: 'A analise nao esta ligada a uma empresa cadastrada; a consulta parte de empresas.id.',
        } as never,
      } as never)
      .eq('id', linha.id)
    return
  }

  try {
    const r = await protestosEmpresa({
      empresaId: linha.empresa_id,
      incluirSpes: opcoes.incluir_spes,
      anoMin: opcoes.ano_min,
      somenteAfiancadas: opcoes.somente_afiancadas,
    })

    // O recalculo e a metade que da sentido a consulta. Sem ele o score continuaria o de
    // antes, e o teto 5 sairia da analise como se o protesto nunca tivesse sido visto.
    await recalcularScoresDeCnpjs([linha.cnpj])

    await supabaseAdmin
      .from('analises_proprietarias')
      .update({
        etapa: 'extracao',
        protestos_resultado: {
          consultados: r.processados,
          itens: r.itens,
          custo: r.custo,
          lote_id: r.lote_id,
          incluiu_spes: opcoes.incluir_spes,
          ano_min: opcoes.ano_min,
          somente_afiancadas: opcoes.somente_afiancadas,
          score_recalculado: true,
        } as never,
      } as never)
      .eq('id', linha.id)

    logger.info(
      { analise: linha.id, cnpj: linha.cnpj, consultados: r.processados, custo: r.custo },
      'Protestos consultados antes da analise.',
    )
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    logger.error({ analise: linha.id, erro: texto }, 'Consulta de protesto falhou; a analise segue.')
    await supabaseAdmin
      .from('analises_proprietarias')
      .update({
        etapa: 'extracao',
        protestos_resultado: { consultados: 0, custo: 0, erro: texto } as never,
      } as never)
      .eq('id', linha.id)
  }
}

async function etapaExtracao(linha: LinhaAnalise): Promise<void> {
  if (!linha.analise_credito_id) {
    throw new Error('Análise sem vínculo com a esteira: não há documentos para ler.')
  }

  const { data: docs } = await supabaseAdmin
    .from('analise_docs')
    .select('id, tipo, nome_arquivo, arquivo_url')
    .eq('analise_id', linha.analise_credito_id)

  const legiveis = ((docs ?? []) as DocParaLer[]).filter((d) =>
    (DOCS_EXTRAIVEIS as readonly string[]).includes(d.tipo),
  )
  if (legiveis.length === 0) {
    throw new Error(
      'Nenhum documento contábil anexado. Anexe ao menos o balanço e o DRE antes de rodar a análise.',
    )
  }

  const dados = await extrair(legiveis)
  const pendentes = criticosPendentes(dados)

  await supabaseAdmin
    .from('analise_docs')
    .update({ extraido_em: new Date().toISOString() } as never)
    .in('id', legiveis.map((d) => d.id))

  if (pendentes.length === 0) {
    // Extração sem nenhum crítico preenchido: não há o que confirmar, e parar numa tela
    // de revisão vazia só adiaria a notícia de que faltou documento.
    await supabaseAdmin
      .from('analises_proprietarias')
      .update({ dados_extraidos: dados as never, etapa: 'calculo', erro: null } as never)
      .eq('id', linha.id)
    return
  }

  await supabaseAdmin
    .from('analises_proprietarias')
    .update({
      dados_extraidos: dados as never,
      status: 'aguardando_revisao',
      etapa: 'revisao',
      erro: null,
    } as never)
    .eq('id', linha.id)

  await emitirEvento(linha.empresa_id, EVENTO_TIPOS.ANALISE_PROPRIA_AGUARDANDO_REVISAO, {
    analise_propria_id: linha.id,
    cnpj: linha.cnpj,
    campos_pendentes: pendentes.length,
    titulo: `Extração aguardando revisão — ${formatCnpj(linha.cnpj)}`,
    url: `/credito/analises/${linha.analise_credito_id}`,
  })

  // O solicitante é notificado NOMINALMENTE, além do perfil: quem pediu a análise é
  // quem está esperando por ela, e uma notificação de perfil se perde entre pares.
  const destinatarios = new Set<string>()
  if (linha.criada_por) destinatarios.add(linha.criada_por)
  if (destinatarios.size > 0) {
    await notify(supabaseAdmin, [...destinatarios], {
      titulo: 'Extração aguardando sua revisão',
      corpo: `${pendentes.length} campo(s) crítico(s) de ${formatCnpj(linha.cnpj)} precisam de confirmação antes do cálculo.`,
      url: `/credito/analises/${linha.analise_credito_id}`,
    })
  }
  await notificarPerfis(['Crédito'], {
    titulo: 'Extração aguardando revisão',
    corpo: `${formatCnpj(linha.cnpj)}: ${pendentes.length} campo(s) crítico(s) a confirmar.`,
    url: `/credito/analises/${linha.analise_credito_id}`,
  })
}

/** Monta o contexto do cálculo a partir do que o banco sabe hoje. */
async function montarContexto(linha: LinhaAnalise, p: ParametrosAnalise): Promise<ContextoAnalise> {
  const [{ data: score }, { data: cliente }, { data: vigente }] = await Promise.all([
    supabaseAdmin
      .from('empresa_scores')
      .select('faixa, knockout, score, completude, breakdown')
      .eq('cnpj', linha.cnpj)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from('clientes_onepay').select('cnpj').eq('cnpj', linha.cnpj).maybeSingle(),
    supabaseAdmin
      .from('analise_vigente')
      .select('limite_aprovado, tem_analise_vigente')
      .eq('cnpj', linha.cnpj)
      .maybeSingle(),
  ])

  const opera = !!cliente
  let media: number | null = null
  if (opera) {
    const desde = new Date()
    desde.setMonth(desde.getMonth() - p.capacidade_operacional.janela_meses)
    const { data: nfs } = await supabaseAdmin
      .from('notas_fiscais')
      .select('valor')
      .eq('sacado_cnpj', linha.cnpj)
      .gte('emitida_em', desde.toISOString())
    const total = (nfs ?? []).reduce((s, n) => s + Number(n.valor ?? 0), 0)
    // Divide pela JANELA inteira, não pelos meses com nota: quem emitiu em dois dos seis
    // meses tem média baixa, e é isso que o teto operacional deve enxergar.
    media = total / p.capacidade_operacional.janela_meses
  }

  return {
    exercicios: achatarExtracao(linha.dados_extraidos),
    opera_na_plataforma: opera,
    media_mensal_nfe: media,
    limite_seguradora: vigente?.tem_analise_vigente ? Number(vigente.limite_aprovado ?? 0) || null : null,
    faixa_score: (score?.faixa as string | null) ?? null,
    knockout_score: (score?.knockout as string | null) ?? null,
  }
}

async function etapaCalculoEParecer(linha: LinhaAnalise): Promise<void> {
  const p = await parametros(linha.parametros_versao)
  const ctx = await montarContexto(linha, p)
  const r = calcularAnalise(ctx, p)

  const { data: esteira } = await supabaseAdmin
    .from('analises_credito')
    .select('estagio, limite_aprovado, rating_seguradora, expira_em')
    .eq('id', linha.analise_credito_id ?? '')
    .maybeSingle()

  const quadrante = classificarQuadrante(r.recomendacao, esteira?.estagio ?? null)

  // ── O dossiê do parecer ──────────────────────────────────────────────────
  // Tudo que a IA pode usar, e nada além disso: o prompt manda usar apenas os dados
  // fornecidos, e a única forma de essa regra ter dente é o dossiê ser o limite.
  const [{ data: empresa }, { data: score }, { data: protestos }, { data: metricas }] = await Promise.all([
    supabaseAdmin
      .from('empresas')
      .select('razao_social, nome_fantasia, uf, municipio, tipo, faturamento_anual, faturamento_origem, faturamento_confianca, funcionarios, funcionarios_crescimento_12m, erp_atual')
      .eq('id', linha.empresa_id ?? '')
      .maybeSingle(),
    supabaseAdmin
      .from('empresa_scores')
      .select('score, faixa, completude, knockout, breakdown')
      .eq('cnpj', linha.cnpj)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('protestos_atual')
      .select('tem_protesto, qtd_protestos, valor_total, consultado_em')
      .eq('cnpj', linha.cnpj)
      .maybeSingle(),
    supabaseAdmin
      .from('mercado_metricas')
      .select('qtd_filiais, grupo_spes_total, grupo_spes_24m, obras_ativas, m2_em_execucao')
      .eq('cnpj', linha.cnpj)
      .maybeSingle(),
  ])

  const dossie = {
    empresa: { cnpj: formatCnpj(linha.cnpj), ...(empresa ?? {}) },
    tipo_de_analise: linha.tipo,
    indicadores: r.indicadores.map((i) => ({
      indicador: INDICADOR_LABELS[i.id],
      valor: i.valor,
      unidade: i.unidade,
      semaforo: i.faixa,
      formula: i.formula,
      insumos: i.insumos,
      motivo_sem_valor: i.motivo_sem_valor,
    })),
    tetos: r.tetos.map((t) => ({
      teto: TETO_LABELS[t.id],
      aplicavel: t.aplicavel,
      valor: t.valor,
      formula: t.formula,
      insumos: t.insumos,
      motivo_nao_aplicavel: t.motivo_nao_aplicavel,
      vinculante: t.vinculante,
    })),
    cenarios: r.cenarios,
    recomendacao_calculada: r.recomendacao,
    limite_recomendado: r.limite_recomendado,
    motivos_nao_operar: r.motivos_nao_operar,
    scorecard: score ?? null,
    protestos: protestos ?? null,
    grupo_e_obras: metricas ?? null,
    comportamento_operacional: ctx.opera_na_plataforma
      ? {
          opera: true,
          media_mensal_nfe: ctx.media_mensal_nfe,
          janela_meses: p.capacidade_operacional.janela_meses,
        }
      : { opera: false, observacao: 'Empresa ainda não opera na plataforma.' },
    seguradora: {
      estagio: esteira?.estagio ?? null,
      limite_aprovado: esteira?.limite_aprovado ?? null,
      rating: esteira?.rating_seguradora ?? null,
      validade: esteira?.expira_em ?? null,
      quadrante,
    },
    extracao: {
      exercicios: ctx.exercicios,
      lacunas: linha.dados_extraidos?.lacunas ?? [],
      conflitos: linha.dados_extraidos?.conflitos ?? [],
      revisada: true,
    },
    lacunas_do_calculo: r.lacunas_calculo,
  }

  const parecer = await gerarParecer(dossie, p.parecer?.instrucoes_extras ?? '')

  await supabaseAdmin
    .from('analises_proprietarias')
    .update({
      indicadores: r.indicadores as never,
      tetos: r.tetos as never,
      cenarios: r.cenarios as never,
      recomendacao: r.recomendacao,
      limite_recomendado: r.limite_recomendado,
      motivos_nao_operar: r.motivos_nao_operar as never,
      lacunas_calculo: r.lacunas_calculo as never,
      parecer_markdown: parecer.texto,
      parecer_modelo: parecer.modelo,
      parecer_tokens: parecer.tokens,
      atradius_status: esteira?.estagio ?? null,
      atradius_limite: esteira?.limite_aprovado ?? null,
      quadrante,
      status: 'concluida',
      etapa: null,
      erro: null,
      concluida_em: new Date().toISOString(),
    } as never)
    .eq('id', linha.id)

  await emitirEvento(linha.empresa_id, EVENTO_TIPOS.ANALISE_PROPRIA_CONCLUIDA, {
    analise_propria_id: linha.id,
    cnpj: linha.cnpj,
    recomendacao: r.recomendacao,
    limite_recomendado: r.limite_recomendado,
    quadrante,
    titulo: `Análise proprietária concluída — ${formatCnpj(linha.cnpj)}`,
    url: `/credito/analises/${linha.analise_credito_id}`,
  })

  // Divergência é evento próprio e com push: é o único caso em que duas leituras
  // independentes discordaram, e é o que alguém precisa ver antes de qualquer número.
  if (quadrante === 'so_nos' || quadrante === 'so_seguradora') {
    await emitirEvento(linha.empresa_id, EVENTO_TIPOS.ANALISE_PROPRIA_DIVERGENCIA, {
      analise_propria_id: linha.id,
      cnpj: linha.cnpj,
      quadrante,
      titulo: `Divergência com a seguradora — ${formatCnpj(linha.cnpj)}`,
      url: `/credito/analises/${linha.analise_credito_id}`,
    })
    await notificarPerfis(['Crédito', 'Admin'], {
      titulo:
        quadrante === 'so_nos'
          ? 'Nós aprovamos, a seguradora não'
          : 'A seguradora aprovou, nossa análise não',
      corpo: `${formatCnpj(linha.cnpj)} precisa de decisão com motivo escrito.`,
      url: `/credito/analises/${linha.analise_credito_id}`,
    })
  }

  if (linha.criada_por) {
    await notify(supabaseAdmin, [linha.criada_por], {
      titulo: 'Sua análise proprietária ficou pronta',
      corpo: `${formatCnpj(linha.cnpj)}: ${r.recomendacao === 'operar' ? 'OPERAR' : 'NÃO OPERAR'}.`,
      url: `/credito/analises/${linha.analise_credito_id}`,
    })
  }
}

// ─── Os jobs ────────────────────────────────────────────────────────────────

const COLUNAS =
  'id, analise_credito_id, empresa_id, cnpj, tipo, status, etapa, dados_extraidos, parametros_versao, criada_por, protestos_opcoes'

/** Uma análise, do ponto em que ela parou até onde der. */
export async function processarAnalisePropria(id: string): Promise<{ id: string; status: string }> {
  const { data, error } = await supabaseAdmin
    .from('analises_proprietarias')
    .select(COLUNAS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Análise não encontrada.')

  const linha = data as unknown as LinhaAnalise
  if (linha.status !== 'processando') return { id, status: linha.status }

  const reler = async (): Promise<LinhaAnalise | null> => {
    const { data: depois } = await supabaseAdmin
      .from('analises_proprietarias')
      .select(COLUNAS)
      .eq('id', id)
      .maybeSingle()
    return (depois as unknown as LinhaAnalise | null) ?? null
  }

  try {
    let atual: LinhaAnalise | null = linha

    // Protestos → extração → (revisão humana) → cálculo → parecer. Cada etapa relê a
    // linha antes de passar adiante: ela grava a própria conclusão no banco, e seguir com
    // a cópia em memória faria a etapa seguinte trabalhar sobre um estado que já mudou.
    if (atual.etapa === 'protestos') {
      await etapaProtestos(atual, await parametros(atual.parametros_versao))
      atual = await reler()
      if (!atual || atual.status !== 'processando') return { id, status: atual?.status ?? 'falhou' }
    }

    if (atual.etapa === 'extracao') {
      await etapaExtracao(atual)
      atual = await reler()
      if (!atual || atual.status !== 'processando') {
        return { id, status: atual?.status ?? 'aguardando_revisao' }
      }
    }

    await etapaCalculoEParecer(atual)
    return { id, status: 'concluida' }
  } catch (e) {
    await marcarFalha(id, linha.etapa ?? 'desconhecida', e)
    return { id, status: 'falhou' }
  }
}

/**
 * A rede de segurança: drena tudo que ficou em `processando`.
 *
 * Existe porque o disparo normal é síncrono ao clique (o web chama o worker logo depois
 * do RPC) e um deploy no meio do caminho deixaria a análise parada para sempre — com o
 * usuário olhando um spinner que nunca resolve.
 */
export async function drenarAnalisesProprias(): Promise<{ processadas: number; falhas: number }> {
  const { data } = await supabaseAdmin
    .from('analises_proprietarias')
    .select('id')
    .eq('status', 'processando')
    .order('criada_em', { ascending: true })
    .limit(20)

  let falhas = 0
  for (const a of data ?? []) {
    const r = await processarAnalisePropria(a.id)
    if (r.status === 'falhou') falhas++
  }
  return { processadas: (data ?? []).length, falhas }
}

/**
 * Sugere reanálise — NOTIFICA, nunca executa (§6).
 *
 * A execução gasta tokens sobre documentos longos, e "em lote automático" é justamente
 * a forma de gastar muito sem ninguém ter decidido nada. O que o job faz é colocar a
 * pergunta na frente de quem decide.
 */
export async function sugerirReanalises(): Promise<{ sugeridas: number }> {
  const limite = new Date()
  limite.setDate(limite.getDate() + 60)

  const { data: vencendo } = await supabaseAdmin
    .from('analises_credito')
    .select('id, cnpj, empresa_id, expira_em, limite_aprovado')
    .in('estagio', ['aprovada', 'aprovada_parcial'])
    .not('expira_em', 'is', null)
    .lte('expira_em', limite.toISOString().slice(0, 10))
    .gte('expira_em', new Date().toISOString().slice(0, 10))

  let sugeridas = 0
  for (const a of vencendo ?? []) {
    // Uma sugestão por análise: reemitir o evento todo dia por 60 dias transformaria o
    // sino num lugar que ninguém olha.
    const { data: ja } = await supabaseAdmin
      .from('empresa_eventos')
      .select('id')
      .eq('tipo', EVENTO_TIPOS.REANALISE_SUGERIDA)
      .contains('payload', { analise_credito_id: a.id } as never)
      .limit(1)
    if (ja && ja.length > 0) continue

    await emitirEvento(a.empresa_id, EVENTO_TIPOS.REANALISE_SUGERIDA, {
      analise_credito_id: a.id,
      cnpj: a.cnpj,
      expira_em: a.expira_em,
      motivo: 'A análise vigente vence em menos de 60 dias.',
      titulo: `Reanálise sugerida — ${formatCnpj(a.cnpj)}`,
      url: `/credito/analises/${a.id}`,
    })
    sugeridas++
  }

  if (sugeridas > 0) {
    await notificarPerfis(['Crédito'], {
      titulo: 'Reanálises sugeridas',
      corpo: `${sugeridas} análise(s) vencem nos próximos 60 dias.`,
      url: '/credito',
    })
  }

  logger.info({ sugeridas }, 'Sugestão de reanálises concluída.')
  return { sugeridas }
}
