import { AI_MODEL } from '../../../../../packages/core/src/constants.js'
import {
  resumirCadeiaDoSacado,
  type NotaContraOSacado,
} from '../../../../../packages/core/src/comercial/pitch.js'
import { supabaseAdmin } from '../../db.js'
import { env } from '../../env.js'
import { logger } from '../../logger.js'
import { requisitarJson } from '../../net/http.js'

/**
 * O PITCH DO SDR: o que dizer nesta ligação, sobre ESTA empresa.
 *
 * ─── O BURACO QUE ISTO FECHA ────────────────────────────────────────────────
 * O card do funil de reuniões dava um nome, uma UF e um valor esperado. Com isso o
 * SDR abre a ligação perguntando o que a nossa própria base já responde: onde ela
 * atua, que porte tem, se está abrindo SPE e tocando obra, quem já emite nota
 * contra ela e há quanto tempo. A informação existia — espalhada por seis tabelas
 * que ninguém junta com o telefone chamando.
 *
 * ─── É UM PITCH, NÃO UM RELATÓRIO ───────────────────────────────────────────
 * Quatro parágrafos curtos e uma lista. `abertura` é a única parte que se lê em
 * voz alta; o resto é o que se sabe ao dizê-la. Um dossiê de duas páginas seria
 * lido uma vez, na demonstração, e nunca mais numa ligação real.
 *
 * ─── PREGUIÇOSO, E DE PROPÓSITO ─────────────────────────────────────────────
 * Gera na PRIMEIRA ABERTURA do card, não na criação do lead. A distribuição
 * semanal cria dezenas de leads de uma vez e boa parte nunca é trabalhada —
 * gerar na criação é pagar token para escrever texto que ninguém abre. Como o
 * resultado fica gravado, a segunda abertura é instantânea.
 *
 * ─── O QUE O MODELO NÃO PODE FAZER ──────────────────────────────────────────
 * Prometer taxa, limite ou prazo de aprovação (não é ele que aprova), e citar
 * protesto de fornecedor pelo nome. O protesto entra no dossiê porque MUDA O
 * ÂNGULO — uma cadeia apertada é o melhor motivo para a construtora ouvir sobre
 * antecipação — mas dizer "seu fornecedor X tem protesto" numa ligação fria é
 * expor um terceiro para vender, e não fazemos isso.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

/**
 * A janela do dossiê. 180 dias e não os 90 da munição do 04l: aqui o número não
 * mede apetite corrente, prova conhecimento da cadeia. Um fornecedor de cinco
 * meses atrás continua abrindo conversa.
 */
const JANELA_DIAS = 180

/** Teto de notas lidas. Uma construtora grande tem milhares; as maiores bastam. */
const LIMITE_NOTAS = 1000

interface RespostaAnthropic {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

interface SaidaPitch {
  abertura?: string
  contexto?: string
  angulo?: string
  persona?: string
  pontos?: string[]
  jargoes?: string[]
}

export interface ResultadoPitch {
  lead_id: string
  gerado: boolean
  motivo?: string
  tokens?: number
}

const diaAtras = (dias: number): string =>
  new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)

/**
 * Situação da obra no CNO é CÓDIGO, não texto — '02' é ativa. A mesma tradução de
 * `derivadas/metricas.ts`; escrever "02" no dossiê faria o modelo inventar o que
 * o código significa.
 */
const SITUACAO_OBRA: Record<string, string> = {
  '01': 'em cadastramento',
  '02': 'ativa',
  '03': 'paralisada',
  '15': 'encerrada',
}

/**
 * Gera (ou regenera) o pitch de um lead. `forcar` é o botão "regerar" da tela —
 * para quando o SDR falou com a empresa e o texto não bate com o que ele ouviu.
 */
export async function gerarPitchLead(
  leadId: string,
  forcar = false,
  geradoPor: string | null = null,
): Promise<ResultadoPitch> {
  if (!env.ANTHROPIC_API_KEY) {
    return { lead_id: leadId, gerado: false, motivo: 'ANTHROPIC_API_KEY não configurada.' }
  }

  const { data: lead } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, empresa_id, origem, estagio, distribuido_em, fit')
    .eq('id', leadId)
    .maybeSingle()

  if (!lead) return { lead_id: leadId, gerado: false, motivo: 'Lead não encontrado.' }

  if (!forcar) {
    const { data: atual } = await supabaseAdmin
      .from('sdr_lead_pitches')
      .select('lead_id')
      .eq('lead_id', leadId)
      .maybeSingle()
    // Não há "desatualizado" automático aqui, ao contrário do briefing jurídico: o
    // que envelhece o pitch é a conversa, não uma linha nova no banco. Quem sabe
    // que envelheceu é quem ligou — e ele tem o botão de regerar.
    if (atual) return { lead_id: leadId, gerado: false, motivo: 'Já gerado.' }
  }

  const { data: empresa } = await supabaseAdmin
    .from('empresas')
    // Uma linha só, e não concatenacao: o parser de tipos do supabase-js so entende
    // o select quando ele e um literal unico -- com `+` a linha compila e o resultado
    // vira `GenericStringError`, ou seja, `data` sem campo nenhum.
    // prettier-ignore
    .select('id, cnpj, razao_social, nome_fantasia, uf, municipio, porte, cnae_principal, estagio, funcionarios, funcionarios_crescimento_12m, faturamento_anual, faturamento_confianca, valor_esperado_mensal, limite_potencial, score_faixa, is_spe, grupo_id, erp_atual, regime_tributario, tipagem_antecipacao, ultima_antecipacao')
    .eq('id', lead.empresa_id)
    .maybeSingle()

  if (!empresa?.cnpj) {
    return { lead_id: leadId, gerado: false, motivo: 'Lead sem empresa ou sem CNPJ.' }
  }
  const cnpj = empresa.cnpj
  const corte = diaAtras(JANELA_DIAS)

  const [
    { data: metricas },
    { data: cadastral },
    { data: contatos },
    { data: obras },
    { data: notasContra },
    { data: notasDela },
    { data: submissao },
  ] = await Promise.all([
    supabaseAdmin
      .from('mercado_metricas')
      // prettier-ignore
      .select('qtd_filiais, grupo_spes_total, grupo_spes_24m, grupo_ufs, grupo_capital_agregado, obras_ativas, obras_iniciadas_24m, m2_em_execucao')
      .eq('cnpj', cnpj)
      .maybeSingle(),
    supabaseAdmin
      .from('mercado_universo')
      // prettier-ignore
      .select('data_inicio_atividade, natureza_juridica, porte_rfb, situacao_cadastral, capital_social, municipio, uf, cnae_principal')
      .eq('cnpj', cnpj)
      .maybeSingle(),
    supabaseAdmin
      .from('contatos')
      .select('nome, cargo, departamento, senioridade, ponto_focal, nao_e_o_decisor')
      .eq('empresa_id', empresa.id)
      .order('ponto_focal', { ascending: false })
      .limit(8),
    supabaseAdmin
      .from('mercado_obras')
      // prettier-ignore
      .select('situacao, municipio, bairro, uf, tipo_obra, destinacao, metragem_m2, data_inicio_obra')
      .eq('ni_responsavel', cnpj)
      .order('data_inicio_obra', { ascending: false })
      .limit(6),
    // Quem emite CONTRA ela: a cadeia de fornecedores, que é o produto do lado sacado.
    supabaseAdmin
      .from('notas_fiscais')
      // prettier-ignore
      .select('fornecedor_cnpj, fornecedor_nome, fornecedor_cadastrado, valor, emitida_em, vencimento')
      .eq('sacado_cnpj', cnpj)
      .gte('emitida_em', corte)
      .limit(LIMITE_NOTAS),
    // E o que ELA emite: uma construtora que também é subempreiteira de outra tem os
    // dois lados, e o pitch do lado cedente é outro ("antecipe o que você emite").
    supabaseAdmin
      .from('notas_fiscais')
      .select('sacado_nome, valor, emitida_em')
      .eq('fornecedor_cnpj', cnpj)
      .gte('emitida_em', corte)
      .limit(LIMITE_NOTAS),
    // O que a pessoa DECLAROU ao preencher a LP. É a única fonte do dossiê em que
    // ela fala por si — vale mais que qualquer inferência nossa sobre o papel dela.
    supabaseAdmin
      .from('formulario_submissoes')
      .select('intencao, divergencia_papel, utm_source, utm_campaign, dados, criada_em')
      .eq('sdr_lead_id', leadId)
      .order('criada_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const cadeia = resumirCadeiaDoSacado((notasContra ?? []) as NotaContraOSacado[], {
    janelaDias: JANELA_DIAS,
  })

  /*
   * Protesto do FORNECEDOR, nunca da empresa do lead.
   *
   * É o sinal que responde "por que ele quer antecipar?" — uma cadeia apertada é o
   * motivo mais concreto que existe para a construtora ouvir a conversa. Entra
   * AGREGADO e sem nome: o prompt proíbe citar, e o que não vai no dossiê não pode
   * escapar por acidente.
   */
  const cnpjsPrincipais = cadeia.principais.map((f) => f.cnpj)
  const { data: protestos } = cnpjsPrincipais.length
    ? await supabaseAdmin
        .from('protestos_atual')
        .select('cnpj, tem_protesto, qtd_protestos, valor_total')
        .in('cnpj', cnpjsPrincipais)
    : { data: [] }

  const comProtesto = (protestos ?? []).filter((p) => p.tem_protesto)

  const emitidasPorEla = (notasDela ?? []).reduce(
    (acc, n) => {
      acc.qtd += 1
      acc.valor += Number(n.valor) || 0
      if (n.sacado_nome) acc.sacados.add(n.sacado_nome)
      return acc
    },
    { qtd: 0, valor: 0, sacados: new Set<string>() },
  )

  const dossie = {
    empresa: {
      razao_social: empresa.razao_social,
      nome_fantasia: empresa.nome_fantasia,
      uf: empresa.uf ?? cadastral?.uf ?? null,
      municipio: empresa.municipio ?? cadastral?.municipio ?? null,
      cnae_principal: empresa.cnae_principal ?? cadastral?.cnae_principal ?? null,
      porte: empresa.porte ?? cadastral?.porte_rfb ?? null,
      funcionarios: empresa.funcionarios,
      crescimento_funcionarios_12m: empresa.funcionarios_crescimento_12m,
      faturamento_anual_estimado: empresa.faturamento_anual,
      confianca_do_faturamento: empresa.faturamento_confianca,
      regime_tributario: empresa.regime_tributario,
      erp_atual: empresa.erp_atual,
      aberta_em: cadastral?.data_inicio_atividade ?? null,
      natureza_juridica: cadastral?.natureza_juridica ?? null,
      capital_social: cadastral?.capital_social ?? null,
      // O modelo precisa saber que o CNPJ é veículo de obra: o pitch para uma SPE é
      // sobre a incorporadora dona dela, não sobre "a empresa".
      e_uma_spe: empresa.is_spe,
      ja_antecipou_conosco_em: empresa.ultima_antecipacao,
    },
    momento_de_vida: {
      obras_ativas: metricas?.obras_ativas ?? 0,
      obras_iniciadas_24m: metricas?.obras_iniciadas_24m ?? 0,
      m2_em_execucao: metricas?.m2_em_execucao ?? 0,
      spes_do_grupo: metricas?.grupo_spes_total ?? 0,
      spes_abertas_24m: metricas?.grupo_spes_24m ?? 0,
      ufs_do_grupo: metricas?.grupo_ufs ?? [],
      filiais: metricas?.qtd_filiais ?? 0,
      obras_recentes: (obras ?? []).map((o) => ({
        situacao: SITUACAO_OBRA[o.situacao ?? ''] ?? o.situacao,
        onde: [o.bairro, o.municipio, o.uf].filter(Boolean).join(', ') || null,
        tipo: o.tipo_obra,
        destinacao: o.destinacao,
        metragem_m2: o.metragem_m2,
        iniciada_em: o.data_inicio_obra,
      })),
    },
    cadeia_de_fornecedores: {
      janela_dias: JANELA_DIAS,
      notas_recebidas: cadeia.notas,
      valor_total: cadeia.valor_total,
      prazo_medio_de_pagamento_dias: cadeia.prazo_medio_dias,
      fornecedores_distintos: cadeia.fornecedores_distintos,
      fornecedores_ja_cadastrados_na_plataforma: cadeia.fornecedores_cadastrados,
      principais: cadeia.principais.map((f) => ({
        nome: f.nome,
        valor: f.valor,
        notas: f.notas,
        ja_e_cliente_da_plataforma: f.cadastrado,
      })),
      ultima_nota_em: cadeia.ultima_nota_em,
      // Agregado e anônimo — ver a nota acima.
      fornecedores_principais_com_protesto: comProtesto.length,
    },
    ela_como_fornecedora: {
      notas_emitidas: emitidasPorEla.qtd,
      valor_emitido: Math.round(emitidasPorEla.valor * 100) / 100,
      clientes_distintos: emitidasPorEla.sacados.size,
    },
    quem_atende: (contatos ?? []).map((c) => ({
      nome: c.nome,
      cargo: c.cargo,
      area: c.departamento,
      senioridade: c.senioridade,
      e_o_contato_curado: c.ponto_focal,
      sabemos_que_nao_decide: c.nao_e_o_decisor,
    })),
    como_o_lead_chegou: {
      origem: lead.origem,
      estagio_atual: lead.estagio,
      entrou_no_funil_em: lead.distribuido_em,
      declarou_no_formulario: submissao?.intencao ?? null,
      campanha: submissao?.utm_campaign ?? submissao?.utm_source ?? null,
      cnae_diverge_do_que_declarou: submissao?.divergencia_papel ?? null,
      o_que_escreveu: submissao?.dados ?? null,
    },
  }

  const prompt =
    `Você prepara a ligação de um SDR da OnePay, que antecipa recebíveis da construção ` +
    `civil. O produto tem dois lados:\n` +
    `- FORNECEDOR (cedente): antecipa as notas que emitiu e recebe à vista.\n` +
    `- CONSTRUTORA/INCORPORADORA (sacado): libera os fornecedores para anteciparem sem ` +
    `custo para ela e, se quiser, ALONGA o próprio prazo — o fornecedor recebe agora, ela ` +
    `paga depois. É esse segundo lado que costuma fechar a conversa com a tesouraria.\n\n` +
    `O objetivo da ligação é MARCAR UMA REUNIÃO. Não é vender, não é fechar, não é ` +
    `explicar o produto inteiro.\n\n` +
    `Escreva o pitch DESTA empresa a partir do dossiê abaixo.\n\n` +
    `RESTRIÇÕES — todas obrigatórias:\n` +
    `- Use APENAS o dossiê para qualquer afirmação sobre a empresa. Não invente número, ` +
    `nome, obra, fornecedor, data nem cargo. Campo nulo, vazio ou zero significa "não ` +
    `sabemos" — nunca "não tem".\n` +
    `- NUNCA prometa taxa, limite, valor de antecipação ou prazo de aprovação: não é o SDR ` +
    `que aprova, e uma promessa aqui vira reclamação na reunião.\n` +
    `- Sobre protesto: o dossiê diz apenas QUANTOS dos principais fornecedores têm protesto, ` +
    `e é leitura INTERNA. Nunca sugira dizer isso na ligação, nunca cite fornecedor nesse ` +
    `contexto e nunca mencione que consultamos protesto de alguém.\n` +
    `- Fornecedor pode ser citado pelo nome como prova de que conhecemos a cadeia ` +
    `("vocês trabalham com a X"), e só nesse sentido.\n` +
    `- Se o dossiê não sustentar um ângulo, diga o que perguntar para descobrir, em vez de ` +
    `inventar um ângulo plausível.\n` +
    `- Português do Brasil, tom de quem conhece obra. Sem adjetivo de marketing, sem ` +
    `"solução inovadora", sem exclamação.\n\n` +
    `DOSSIÊ (JSON):\n${JSON.stringify(dossie, null, 2)}`

  const resp = await requisitarJson<RespostaAnthropic>(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: {
      model: AI_MODEL,
      max_tokens: 2000,
      tools: [
        {
          name: 'registrar_pitch',
          description: 'Registra o pitch que o SDR vai ler antes e durante a ligação.',
          input_schema: {
            type: 'object',
            properties: {
              abertura: {
                type: 'string',
                description:
                  'As duas ou três primeiras frases da ligação, prontas para ler em voz ' +
                  'alta, já ancoradas em algo concreto desta empresa (a obra, a região, um ' +
                  'fornecedor). Máximo 400 caracteres.',
              },
              contexto: {
                type: 'string',
                description:
                  'Quem é a empresa em 2 a 4 frases: região onde atua, porte e momento de ' +
                  'vida (SPEs abertas, obras em execução, crescimento de equipe). Só o que ' +
                  'estiver no dossiê. Máximo 600 caracteres.',
              },
              angulo: {
                type: 'string',
                description:
                  'Por que a antecipação provavelmente interessa a ELA, em 2 a 4 frases. ' +
                  'Escolha entre alongar o prazo de pagamento e destravar a cadeia de ' +
                  'fornecedores conforme o dossiê — e diga por que esse é o ângulo, citando ' +
                  'o número que o sustenta. Máximo 600 caracteres.',
              },
              persona: {
                type: 'string',
                description:
                  'Com quem falar e como esse cargo pensa (o que ele mede, o que o incomoda). ' +
                  'Se não há contato na base, diga qual cargo procurar e por quê. Máximo 300 ' +
                  'caracteres.',
              },
              pontos: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'De 3 a 6 pontos que o SDR deve levantar durante a ligação — perguntas de ' +
                  'qualificação e fatos a confirmar, na ordem em que fazem sentido. Cada um ' +
                  'começa com verbo e cabe em 180 caracteres.',
              },
              jargoes: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'De 0 a 4 expressões que quem trabalha nesse segmento e nessa região usa de ' +
                  'verdade, com o significado entre parênteses. Se não tiver certeza da ' +
                  'expressão regional, devolva lista vazia — soar falso é pior que soar de fora.',
              },
            },
            required: ['abertura', 'contexto', 'angulo', 'pontos', 'jargoes'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'registrar_pitch' },
      messages: [{ role: 'user', content: prompt }],
    },
    timeoutMs: 120_000,
    tentativas: 2,
  })

  const uso = resp.content?.find((c) => c.type === 'tool_use' && c.name === 'registrar_pitch')
  const saida = (uso?.input ?? {}) as SaidaPitch

  if (!saida.abertura || !saida.contexto || !saida.angulo) {
    logger.error({ lead_id: leadId }, 'Pitch veio sem os campos obrigatórios.')
    return { lead_id: leadId, gerado: false, motivo: 'O modelo não devolveu o pitch.' }
  }

  const tokens = (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)

  const { error } = await supabaseAdmin.from('sdr_lead_pitches').upsert(
    {
      lead_id: leadId,
      empresa_id: empresa.id,
      abertura: saida.abertura,
      contexto: saida.contexto,
      angulo: saida.angulo,
      persona: saida.persona ?? null,
      pontos: (saida.pontos ?? []).slice(0, 8),
      jargoes: (saida.jargoes ?? []).slice(0, 6),
      // O dossiê exato que gerou o texto: é o que separa "o modelo inventou" de "a
      // base está errada" quando alguém contesta uma frase.
      fatos: dossie,
      modelo: resp.model ?? AI_MODEL,
      tokens,
      gerado_em: new Date().toISOString(),
      gerado_por: geradoPor,
    },
    { onConflict: 'lead_id' },
  )

  if (error) {
    logger.error({ lead_id: leadId, erro: error.message }, 'Falha ao gravar o pitch.')
    return { lead_id: leadId, gerado: false, motivo: error.message }
  }

  logger.info({ lead_id: leadId, tokens }, 'Pitch do SDR gerado.')
  return { lead_id: leadId, gerado: true, tokens }
}
