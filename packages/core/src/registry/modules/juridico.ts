import { formatCnpj, normalizeCnpj } from '../../schemas/cnpj.js'
import {
  AVISO_PARECER,
  FASE_LABELS,
  SITUACAO_INTERNA_LABELS,
  atualizarProcessoToolSchema,
  gerarCalculoToolSchema,
  gerarParecerToolSchema,
  processosEmpresaSchema,
  resumoCarteiraSchema,
  situacaoEhAtiva,
  type AtualizarProcessoToolInput,
  type Fase,
  type GerarCalculoToolInput,
  type GerarParecerToolInput,
  type ProcessosEmpresaInput,
  type ResumoCarteiraInput,
  type SituacaoInterna,
} from '../../juridico/index.js'
import type { AppModule, ToolContext } from '../types.js'

/**
 * Módulo Jurídico (08): processos judiciais contra sacados devedores.
 *
 * As três mutações deste módulo NÃO decidem nada e NÃO peticionam nada. Elas pedem ao
 * robô do Escavador que vá ao tribunal, rodam um cálculo determinístico e geram um texto.
 * Toda peça, todo prazo e toda estratégia continuam sendo do advogado — e as descrições
 * abaixo dizem isso ao modelo em vez de deixar implícito, porque a resposta dele é lida
 * em voz alta e "gerei o parecer" soa como "resolvi o processo".
 */

const brl = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const faseLabel = (f: string | null): string | null => (f ? (FASE_LABELS[f as Fase] ?? f) : null)
// As colunas da view chegam anuláveis mesmo quando a tabela é NOT NULL — o gerador de
// tipos não sabe disso. Os rótulos absorvem o nulo em vez de o chamador espalhar `??`.
const situacaoLabel = (s: string | null): string =>
  s === null ? '—' : (SITUACAO_INTERNA_LABELS[s as SituacaoInterna] ?? s)

/**
 * Os processos de UMA empresa. Devolve o SALDO LÍQUIDO junto do valor em disputa: um
 * processo de R$ 2 mi com R$ 180 mil já gastos e nada recuperado é uma notícia diferente
 * do mesmo processo com R$ 900 mil penhorados, e o valor da causa sozinho conta a
 * primeira metade das duas.
 */
async function processosEmpresa(input: ProcessosEmpresaInput, ctx: ToolContext) {
  const cnpj = normalizeCnpj(input.cnpj)

  const { data, error } = await ctx.supabase
    .from('juridico_carteira')
    .select('numero_cnj, devedor_nome, classe, comarca, uf, tribunal_sigla, valor_causa, valor_atualizado, situacao_interna, status_predito, fase_atual, dias_na_fase, dias_sem_movimentacao, data_distribuicao, data_ultima_movimentacao, advogado_nome, recuperado, custo_acumulado, saldo_liquido, proximo_prazo, proximo_prazo_em')
    .eq('cnpj_devedor', cnpj)
    .order('data_distribuicao', { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  if (linhas.length === 0) {
    return {
      cnpj: formatCnpj(cnpj),
      total: 0,
      // "Nenhum processo" aqui quer dizer "nenhum processo NOSSO". A empresa pode ter
      // dezenas de ações com terceiros, e este módulo não as enxerga — dizer só "não
      // tem processo" seria uma afirmação que a base não sustenta.
      aviso:
        'Não temos ação judicial contra este CNPJ. Isto não diz nada sobre processos ' +
        'dela com terceiros — este módulo só enxerga os processos em que somos parte.',
    }
  }

  const ativos = linhas.filter((l) => situacaoEhAtiva(l.situacao_interna))

  return {
    cnpj: formatCnpj(cnpj),
    devedor: linhas[0]?.devedor_nome ?? null,
    total: linhas.length,
    ativos: ativos.length,
    valor_em_disputa: brl(ativos.reduce((s, l) => s + Number(l.valor_atualizado ?? l.valor_causa ?? 0), 0)),
    recuperado: brl(linhas.reduce((s, l) => s + Number(l.recuperado ?? 0), 0)),
    custo_acumulado: brl(linhas.reduce((s, l) => s + Number(l.custo_acumulado ?? 0), 0)),
    saldo_liquido: brl(linhas.reduce((s, l) => s + Number(l.saldo_liquido ?? 0), 0)),
    processos: linhas.map((l) => ({
      numero_cnj: l.numero_cnj,
      classe: l.classe,
      foro: [l.comarca, l.uf, l.tribunal_sigla].filter(Boolean).join(' · ') || null,
      valor_causa: brl(l.valor_causa),
      // Nulo é "nunca foi calculado", que é diferente de "vale zero" — e é acionável:
      // significa que ninguém gerou a memória de cálculo ainda.
      valor_atualizado: l.valor_atualizado === null ? 'sem cálculo gerado' : brl(l.valor_atualizado),
      situacao: situacaoLabel(l.situacao_interna),
      fase: faseLabel(l.fase_atual),
      dias_na_fase: l.dias_na_fase,
      dias_sem_movimentacao: l.dias_sem_movimentacao,
      distribuido_em: l.data_distribuicao,
      advogado: l.advogado_nome,
      saldo_liquido: brl(l.saldo_liquido),
      proximo_prazo: l.proximo_prazo ? `${l.proximo_prazo} (${l.proximo_prazo_em})` : null,
      route: `/juridico/${l.numero_cnj}`,
    })),
  }
}

/** A carteira inteira, por situação e por fase, com os alertas em aberto. */
async function resumoCarteira(input: ResumoCarteiraInput, ctx: ToolContext) {
  let q = ctx.supabase
    .from('juridico_carteira')
    .select('numero_cnj, devedor_nome, situacao_interna, fase_atual, dias_na_fase, dias_sem_movimentacao, valor_causa, valor_atualizado, recuperado, custo_acumulado, saldo_liquido')
  if (input.situacao) q = q.eq('situacao_interna', input.situacao)

  const { data, error } = await q.limit(2000)
  if (error) throw new Error(error.message)

  const linhas = data ?? []
  const porSituacao = new Map<string, { qtd: number; valor: number }>()
  const porFase = new Map<string, number>()

  for (const l of linhas) {
    // A coluna é NOT NULL na tabela, mas chega anulável da view. `desconhecida` em vez
    // de pular a linha: um processo somado a lugar nenhum some do total, e um total que
    // não fecha com a lista é o pior dos dois mundos.
    const situacao = l.situacao_interna ?? 'desconhecida'
    const s = porSituacao.get(situacao) ?? { qtd: 0, valor: 0 }
    s.qtd++
    s.valor += Number(l.valor_atualizado ?? l.valor_causa ?? 0)
    porSituacao.set(situacao, s)

    const f = l.fase_atual ?? 'sem_fase_detectada'
    porFase.set(f, (porFase.get(f) ?? 0) + 1)
  }

  const ativos = linhas.filter((l) => situacaoEhAtiva(l.situacao_interna))
  const parados = ativos
    .filter((l) => (l.dias_sem_movimentacao ?? 0) > 60)
    .sort((a, b) => (b.dias_sem_movimentacao ?? 0) - (a.dias_sem_movimentacao ?? 0))

  return {
    filtro: input.situacao ? situacaoLabel(input.situacao) : 'carteira inteira',
    total: linhas.length,
    total_em_litigio: brl(ativos.reduce((s, l) => s + Number(l.valor_causa ?? 0), 0)),
    valor_atualizado: brl(ativos.reduce((s, l) => s + Number(l.valor_atualizado ?? 0), 0)),
    recuperado: brl(linhas.reduce((s, l) => s + Number(l.recuperado ?? 0), 0)),
    custo_acumulado: brl(linhas.reduce((s, l) => s + Number(l.custo_acumulado ?? 0), 0)),
    saldo_liquido: brl(linhas.reduce((s, l) => s + Number(l.saldo_liquido ?? 0), 0)),
    por_situacao: [...porSituacao.entries()].map(([s, v]) => ({
      situacao: situacaoLabel(s),
      quantidade: v.qtd,
      valor: brl(v.valor),
    })),
    por_fase: [...porFase.entries()].map(([f, qtd]) => ({
      fase: f === 'sem_fase_detectada' ? 'Sem fase detectada' : faseLabel(f),
      quantidade: qtd,
    })),
    // Os dez piores, não todos: uma lista de trezentos processos parados numa resposta
    // falada não é informação, é ruído com aparência de completude.
    processos_parados: parados.slice(0, 10).map((l) => ({
      numero_cnj: l.numero_cnj,
      devedor: l.devedor_nome,
      dias_sem_movimentacao: l.dias_sem_movimentacao,
      fase: faseLabel(l.fase_atual),
      route: `/juridico/${l.numero_cnj}`,
    })),
    total_parados: parados.length,
    route: '/juridico',
  }
}

export const juridicoModule: AppModule = {
  id: 'juridico',
  name: 'Jurídico',
  // `gavel` já estava pré-registrado nos dois mapas de ícone desde a fundação,
  // reservado para este módulo. Inventar um token novo obrigaria a mexer nos dois.
  icon: 'gavel',
  route: '/juridico',
  // `operacoes` e não `outros`: aqui é dinheiro que já saiu e está sendo perseguido de
  // volta. Um processo de execução é a última etapa do mesmo funil que começa no Mercado.
  group: 'operacoes',
  tools: [
    {
      id: 'juridico.processos_empresa',
      name: 'Processos de uma empresa',
      description:
        'Ações judiciais NOSSAS contra um CNPJ: número CNJ, classe, foro, valor da causa, ' +
        'valor atualizado do último cálculo, fase com dias parado, advogado e saldo líquido ' +
        '(recuperado − custos). Só enxerga processos em que somos parte — nunca conclua, a ' +
        'partir de uma resposta vazia, que a empresa não tem processos com terceiros. ' +
        '"Sem cálculo gerado" não é zero: é ninguém ter gerado a memória de cálculo ainda.',
      inputSchema: processosEmpresaSchema,
      mutates: false,
      execute: (input, ctx) => processosEmpresa(input as ProcessosEmpresaInput, ctx),
    },
    {
      id: 'juridico.resumo_carteira',
      name: 'Resumo da carteira judicial',
      description:
        'A carteira inteira: total em litígio, valor atualizado, recuperado, custo acumulado ' +
        'e saldo líquido, quebrados por situação interna e por fase, mais os processos ' +
        'parados há mais de 60 dias. Filtro opcional de situação. O saldo líquido é a régua ' +
        'que diz se a carteira paga o próprio custo — cite-o sempre que citar o recuperado.',
      inputSchema: resumoCarteiraSchema,
      mutates: false,
      execute: (input, ctx) => resumoCarteira(input as ResumoCarteiraInput, ctx),
    },
    {
      id: 'juridico.atualizar_processo',
      name: 'Atualizar processo no tribunal',
      description:
        'Pede ao robô do Escavador que vá ao TRIBUNAL buscar movimentações novas deste ' +
        'processo. CUSTA CRÉDITO por chamada e é assíncrono: a resposta volta por callback, ' +
        'em minutos. NÃO peticiona, não altera nada nos autos e não muda a situação interna ' +
        '— só busca. Exige confirmação explícita do usuário.',
      inputSchema: atualizarProcessoToolSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const { numero_cnj } = input as AtualizarProcessoToolInput
        const { data, error } = await ctx.supabase
          .from('processos')
          .select('numero_cnj, ultima_sincronizacao, data_ultima_movimentacao')
          .eq('numero_cnj', numero_cnj)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) {
          return {
            ok: false,
            numero_cnj,
            motivo:
              'Este processo não está na base. A importação roda pelos NOSSOS CNPJs — se ele ' +
              'deveria estar aqui, verifique se o CNPJ da entidade está cadastrado nas ' +
              'configurações do Jurídico.',
          }
        }
        /*
         * A tool NÃO chama o worker por HTTP: o token do Escavador é do worker, e a
         * ferramenta roda com o client do usuário. Ela ENFILEIRA por RPC, e o job
         * drena — `juridico_sync_log` só tem grant de SELECT, porque é log e não
         * caixa de entrada.
         *
         * O RPC deduplica: numa conversa, o modelo pode pedir a mesma atualização
         * três vezes, e cada linha pendente viraria uma chamada PAGA ao tribunal.
         */
        const { data: fila, error: erroFila } = await ctx.supabase.rpc(
          'app_juridico_solicitar_atualizacao',
          { p: { numero_cnj } },
        )
        if (erroFila) throw new Error(erroFila.message)

        const jaSolicitada = (fila as { ja_solicitada?: boolean } | null)?.ja_solicitada === true

        return {
          ok: true,
          numero_cnj,
          ja_solicitada: jaSolicitada,
          ultima_sincronizacao: data.ultima_sincronizacao,
          ultima_movimentacao: data.data_ultima_movimentacao,
          aviso: jaSolicitada
            ? 'JÁ HAVIA um pedido em aberto para este processo — nenhum novo foi criado, e ' +
              'nada foi cobrado. Não anuncie duas solicitações.'
            : 'Solicitação registrada. O robô consulta o tribunal e o resultado chega por ' +
              'callback — a tela mostra o status. Nada nos autos foi tocado.',
          route: `/juridico/${numero_cnj}`,
        }
      },
    },
    {
      id: 'juridico.gerar_calculo',
      name: 'Gerar cálculo da dívida',
      description:
        'Calcula o valor atualizado da dívida executada: soma as operações cobradas e aplica ' +
        'correção monetária, juros de mora, multa, honorários e custas, com os parâmetros ' +
        'configurados. Grava uma versão NOVA — o histórico nunca é sobrescrito. Se faltarem ' +
        'índices de algum mês, o cálculo sai mesmo assim e a resposta DIZ quais competências ' +
        'faltaram; repita esse aviso sempre, porque é ele que impede a memória de ser ' +
        'protocolada com um buraco. Exige confirmação explícita do usuário.',
      inputSchema: gerarCalculoToolSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const { numero_cnj } = input as GerarCalculoToolInput
        const { data, error } = await ctx.supabase
          .from('processo_operacoes')
          .select('id')
          .eq('numero_cnj', numero_cnj)
        if (error) throw new Error(error.message)
        if ((data ?? []).length === 0) {
          return {
            ok: false,
            numero_cnj,
            motivo:
              'Este processo não tem operação cobrada cadastrada. O cálculo soma as ' +
              'operações — sem elas o total seria zero, e um zero aqui pareceria uma dívida ' +
              'quitada. Cadastre as operações na tela do processo antes.',
            route: `/juridico/${numero_cnj}`,
          }
        }
        return {
          ok: true,
          numero_cnj,
          operacoes: (data ?? []).length,
          aviso:
            'O cálculo é gerado na tela do processo, onde os parâmetros aparecem antes de ' +
            'confirmar e o CSV/PDF sai junto. Abra o processo e clique em "Gerar cálculo".',
          route: `/juridico/${numero_cnj}?acao=calculo`,
        }
      },
    },
    {
      id: 'juridico.gerar_parecer',
      name: 'Gerar parecer jurídico',
      description:
        'Gera um parecer em markdown sobre o processo: situação atual, o que aconteceu, ' +
        'riscos, próximo passo recomendado e avaliação de risco. Custa TOKENS sobre todas as ' +
        'movimentações, então exige confirmação explícita. NÃO é peça jurídica, não substitui ' +
        'o advogado responsável e não deve ser juntado aos autos — repita este aviso toda vez ' +
        'que apresentar um parecer, sem exceção.',
      inputSchema: gerarParecerToolSchema,
      mutates: true,
      execute: async (input, ctx) => {
        const { numero_cnj } = input as GerarParecerToolInput
        const { data, error } = await ctx.supabase
          .from('processo_pareceres')
          .select('proximo_passo, risco, criado_em, editado')
          .eq('numero_cnj', numero_cnj)
          .order('criado_em', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw new Error(error.message)

        return {
          ok: true,
          numero_cnj,
          parecer_anterior: data
            ? {
                proximo_passo: data.proximo_passo,
                risco: data.risco,
                em: data.criado_em,
                editado_por_pessoa: data.editado,
              }
            : null,
          aviso:
            'A geração roda na tela do processo (botão "Gerar parecer"), porque o custo em ' +
            'tokens é mostrado antes e o texto precisa ser lido inteiro antes de qualquer ' +
            'uso. ' +
            AVISO_PARECER,
          route: `/juridico/${numero_cnj}?acao=parecer`,
        }
      },
    },
  ],
}
