import { descreverCron, proximaExecucao, type DescricaoCron } from './expressao.js'

/**
 * O que cada cron da plataforma faz — e por que ele roda no dia em que roda.
 *
 * A AGENDA não está aqui: ela vive em `apps/web/vercel.json`, que é o que a Vercel
 * executa. Duplicar o horário neste arquivo criaria dois donos para o mesmo fato, e
 * o dia em que eles divergissem a tela mostraria com confiança um horário em que
 * nada acontece. Aqui ficam só rótulo, módulo e explicação; a tela cruza os dois
 * pelo `path`.
 *
 * O cruzamento é o ponto: um cron agendado sem entrada aqui aparece assim mesmo (o
 * catálogo não pode esconder execução real), e uma entrada sem agenda aparece como
 * NÃO AGENDADA — que é a falha que ninguém percebe, porque um job que nunca roda
 * não gera erro nenhum.
 */

export interface CronCatalogado {
  /** Casa com o `path` em vercel.json. */
  path: string
  nome: string
  /** Id do módulo no registry, para a tela agrupar/rotular. */
  moduloId: string
  descricao: string
  /** Rota do worker que o cron aciona, quando ele é só o gatilho. */
  destino?: string
  /** Jobs que ESTE cron dispara em seguida, na mesma corrida. */
  encadeia?: string[]
}

export const CRONS: readonly CronCatalogado[] = [
  {
    path: '/api/cron/mercado-receita',
    nome: 'Dump da Receita (CNPJ)',
    moduloId: 'mercado',
    descricao:
      'Baixa e ingere o dump mensal de CNPJs da Receita Federal — a base do universo do Mercado. Dia 10 porque o arquivo do mês é publicado na primeira quinzena e só até lá está no ar de forma confiável. Nunca cai no espelho sozinho: usar cópia de terceiro é decisão de admin, na tela de Ingestões.',
    destino: 'POST /jobs/receita',
  },
  {
    path: '/api/cron/mercado-cno',
    nome: 'CNO (obras)',
    moduloId: 'mercado',
    descricao:
      'Obras do Cadastro Nacional de Obras, filtradas pelas raízes de CNPJ que já conhecemos. Roda dois dias depois da Receita para casar contra o universo já atualizado.',
    destino: 'POST /jobs/cno',
  },
  {
    path: '/api/cron/radar-onepay',
    nome: 'Clientes Onepay',
    moduloId: 'radar',
    descricao:
      'Puxa o temperature-report do BI, atualiza os clientes Onepay e grava o snapshot do dia.',
    destino: 'POST /jobs/radar/onepay',
    encadeia: [
      'Certificados digitais (mesmo BI, disparado mesmo se o primeiro falhar)',
      'Análises de crédito da plataforma — detecta ex-clientes (04h); vem depois porque o temperature report é quem decide "cliente atual"',
    ],
  },
  {
    path: '/api/cron/radar-protestos-clientes',
    nome: 'Protestos dos clientes',
    moduloId: 'radar',
    descricao:
      'Consulta protestos de cada cliente Onepay e de cada CNPJ marcado como afiançado no monitoramento, como um lote automático já aprovado (é política), respeitando o teto de orçamento. O custo aparece na aba Análise de Empresas e é avisado cinco dias antes.',
    destino: 'POST /jobs/radar/protestos-clientes',
  },
  {
    path: '/api/cron/radar-protestos-aviso',
    nome: 'Aviso de custo dos protestos',
    moduloId: 'radar',
    descricao:
      'Avisa Admin e Crédito quanto a rodada do dia 5 vai custar — clientes Onepay mais SPEs afiançadas, a preço de consulta nacional. Agendado nos dias 28–31, mas só notifica no ÚLTIMO dia do mês: é sempre exatamente cinco dias antes da rodada, em fevereiro como em março, e um cron marcado no dia 30 nunca dispararia em fevereiro. Cinco dias é o que separa descobrir no extrato de pôr crédito antes.',
    destino: 'POST /jobs/radar/protestos-aviso',
  },
  {
    path: '/api/cron/radar-estimador',
    nome: 'Estimador de faturamento',
    moduloId: 'radar',
    descricao:
      'Calibra nos clientes que declararam faturamento e reestima a base inteira. Dia 6, depois dos protestos (dia 5), para calibrar com o mês já assentado. Sem amostra declarada não estima nada.',
    destino: 'POST /jobs/radar/estimar-faturamento',
  },
  {
    path: '/api/cron/antecipacao-sync',
    nome: 'Sync de notas fiscais',
    moduloId: 'antecipacao',
    descricao:
      'De 4 em 4 horas: puxa as NFs novas da Onepay, resolve cadastro dos CNPJs desconhecidos e reclassifica o funil.',
    destino: 'POST /jobs/antecipacao/sync-nfs',
    encadeia: [
      'Sync de antecipações (conversão de nota em operação)',
      'Funil de cadastro de fornecedores (04l) — a munição dele vem exatamente das notas que acabaram de chegar; num relógio próprio, o card mostraria o volume de até quatro horas atrás e um fornecedor que virou cliente hoje continuaria no kanban como lead',
    ],
  },
  {
    path: '/api/cron/antecipacao-diario',
    nome: 'Diário da Antecipação',
    moduloId: 'antecipacao',
    descricao:
      'Limpa supressões vencidas, consome a fila de lookup cadastral, reclassifica com expiração e regenera a outbox. É o job que impede o funil de apodrecer — as notas não mudam, o calendário muda. Roda antes do primeiro sync do dia.',
    destino: 'POST /jobs/antecipacao/diario',
  },
  {
    path: '/api/cron/antecipacao-calibrar',
    nome: 'Calibração da carteira',
    moduloId: 'antecipacao',
    descricao:
      'Mede a economia real contra a carteira, antes do estimador (dia 6) e do Crédito (dia 7). Só MEDE: aplicar a constante continua sendo um botão em Antecipação → Configurações.',
    destino: 'POST /jobs/antecipacao/calibrar',
  },
  {
    path: '/api/cron/credito-mensal',
    nome: 'Crédito mensal',
    moduloId: 'credito',
    descricao:
      'Calibra na carteira, pontua a base e calcula o limite potencial, nesta ordem e na mesma corrida. Dia 7, um dia depois do estimador: o limite é proporção do faturamento estimado, e rodar antes gravaria snapshot em cima do número do mês passado.',
    destino: 'POST /jobs/credito/mensal',
  },
  {
    path: '/api/cron/credito-sync',
    nome: 'Sync da seguradora',
    moduloId: 'credito',
    descricao:
      'Sincroniza o que já está na apólice, consulta as decisões abertas e expira as aprovações vencidas. Nunca descobre sacado novo — isso só entra pelo envio da esteira, que é ação humana e custa dinheiro.',
    destino: 'POST /jobs/credito/sync',
  },
  {
    path: '/api/cron/credito-reanalises',
    nome: 'Reanálises e retomada',
    moduloId: 'credito',
    descricao:
      'Sugere reanálise do que vence em menos de 60 dias e retoma as análises proprietárias que ficaram paradas. SUGERE, não executa: rodar a análise é ler dez PDFs num modelo, e fazer isso em lote automático seria a forma mais cara possível de descobrir que a maioria não mudou.',
    destino: 'POST /jobs/credito/sugerir-reanalises + /jobs/credito/analises-drenar',
  },
  {
    path: '/api/cron/comercial-distribuir',
    nome: 'Distribuição semanal de SDR',
    moduloId: 'comercial',
    descricao:
      'Distribui empresas da fonte configurada (SOM por padrão) para os SDRs de saída, ordenadas por valor esperado mensal e respeitando território, carga e carência de "sem fit". Segunda de manhã, e não domingo à noite: lead que chega quando ninguém trabalha já nasce com um dia de SLA queimado. SDR de entrada NÃO entra aqui — o canal de inbound é do Prompt 05.',
    destino: 'POST /jobs/comercial/distribuir-sdr',
  },
  {
    path: '/api/cron/leads-enriquecer',
    nome: 'Enriquecimento de leads',
    moduloId: 'comercial',
    descricao:
      'Domínio, faturamento e score dos leads que chegaram pelo formulário — e, só nos formulários com enriquecimento pago ligado, funcionários e contatos Apollo. É rede de segurança: o caminho normal é o próprio formulário acordar o worker no envio. De 5 em 5 minutos, e não de hora em hora, porque em 22/08/2026 o disparo imediato falhou em silêncio e a espera virou a hora cheia — quando o caminho principal é frágil, a rede embaixo dele tem de ser curta.',
    destino: 'POST /jobs/leads/enriquecer',
  },
  {
    path: '/api/cron/comercial-sla',
    nome: 'SLA de leads e inatividade',
    moduloId: 'comercial',
    descricao:
      'Devolve ao pool o lead "a contatar" parado além do SLA (7 dias por padrão) e avisa gestores sobre vendedor sem nenhum movimento em N dias ÚTEIS — corridos fariam o alerta disparar toda terça por causa do fim de semana, e alerta que não importa é alerta que ninguém lê.',
    destino: 'POST /jobs/comercial/sla-leads',
  },
  {
    path: '/api/cron/comercial-comissoes',
    nome: 'Apuração de comissões',
    moduloId: 'comercial',
    descricao:
      'Dia 1: fecha a competência anterior. Cada lançamento consulta a regra vigente e o dono da carteira NA DATA DO EVENTO — trocar carteira ou tabela hoje não reescreve o mês passado. Antecipação que regrediu vira estorno espelhado. Nada sai como pago: o gestor aprova antes.',
    destino: 'POST /jobs/comercial/apurar-comissoes',
  },
  {
    path: '/api/cron/comercial-comissoes-v2',
    nome: 'Diário do motor de comissões',
    moduloId: 'comercial',
    descricao:
      'Às 23h50 de São Paulo: cria as titularidades que o funil gerou (venda ganha → sacado, primeira NF do cedente → originador), devolve ao pool o cedente dormente, recolhe as cessões que o handler live não pegou e — SÓ quando hoje é o último dia útil — fecha a competência. Roda todo dia porque duas das três etapas são diárias por natureza, e porque "último dia útil" não é uma expressão que o cron saiba dizer: um cron marcado no dia 30 nunca dispararia em fevereiro.',
    destino: 'POST /jobs/comercial/comissoes-diario',
  },
  {
    path: '/api/cron/comercial-aceites-sdr',
    nome: 'Fila de aceite do SDR',
    moduloId: 'comercial',
    descricao:
      'De hora em hora: abre a fila para as reuniões realizadas, expira COMO ACEITA o que passou do SLA e lança a comissão do SDR. A tela já acorda o worker ao decidir — este cron é a rede que faz um lançamento perdido aparecer na hora seguinte em vez de nunca. De hora em hora porque o SLA é contado em horas, e um relógio mais grosso que a unidade que mede erra sempre para o mesmo lado.',
    destino: 'POST /jobs/comercial/aceites-sdr',
  },
  {
    path: '/api/cron/fornecedores-descoberta',
    nome: 'Descoberta de contatos de fornecedores',
    moduloId: 'comercial',
    descricao:
      'Camadas 0+1 da cascata (04l §4.1) para os fornecedores do funil de cadastro, na ordem do potencial: varre o XML das NF-e (a melhor fonte para PME — 77% dos 688 fornecedores têm telefone no bloco do emitente, contra 11% no cadastro da Receita), lê o cadastral, cruza com os contatos que já temos, abre a página de contato do site e consulta o Google Places. Às 4h20 porque abre conexão com sites de terceiros e não deve competir com o horário de uso. O único item pago é o Places, e ele sai do orçamento automático da casa — nunca do teto de um originador, que ninguém autorizou para uma varredura noturna. Estourado o orçamento, as quatro etapas grátis continuam rodando: são elas que trazem os 77%.',
    destino: 'POST /jobs/fornecedores/descoberta-automatica',
  },
  {
    path: '/api/cron/fornecedores-validar',
    nome: 'Validação dos contatos descobertos',
    moduloId: 'comercial',
    descricao:
      'Diário (04l §4.4): normaliza o telefone em E.164 e confere o registro MX do domínio de cada e-mail. Não envia nada e não disca — verificação por envio é toque, e toque passa pela supressão e por uma pessoa. Contato inválido é REBAIXADO para confiança baixa e marcado, nunca apagado: a linha ruim é a evidência de que a fonte entrega lixo, e apagá-la faria um provedor com 5% de validade sumir do painel de eficácia parecendo limpo.',
    destino: 'POST /jobs/fornecedores/validar-contatos',
  },
  {
    path: '/api/cron/juridico-sincronizar',
    nome: 'Sincronização do Jurídico',
    moduloId: 'juridico',
    descricao:
      'Dispara TODO DIA, mas nem todo dia roda: a agenda (dias da semana, horário, escopo) vive em `juridico_config.monitoramento` e é conferida DENTRO do job. Codificar os dias aqui obrigaria um deploy para mudá-los — e a agenda é justamente a setting que decide o custo em créditos do Escavador. Nos dias que não são de rodar, o job devolve "não executado" com o motivo, e isso não é falha: é a agenda funcionando. Antes das 8h de São Paulo porque quem abre o Jurídico de manhã precisa das movimentações da noite já classificadas.',
    destino: 'POST /jobs/juridico/sincronizar',
    encadeia: [
      'drenar as solicitações da IA e do botão "Atualizar agora"',
      'processar os callbacks pendentes do Escavador',
      'regerar os resumos de IA que ficaram velhos com a movimentação nova',
    ],
  },
  {
    path: '/api/cron/juridico-alertas',
    nome: 'Alertas do Jurídico',
    moduloId: 'juridico',
    descricao:
      'Fase lenta, processo parado e prazo a vencer (D-3 e D-1). Roda TODO DIA, inclusive nos que não sincronizam: uma audiência de terça precisa do aviso de segunda mesmo que segunda não seja dia de sincronizar — o prazo corre pelo calendário do fórum, não pelo nosso. Uma hora DEPOIS do sync, para contar dias parados sobre o que acabou de chegar. Reconcilia também o knockout de crédito: marcar um processo como "ganho" na tela roda um RPC em SQL que não tem como chamar o worker, e sem esta passagem a empresa continuaria bloqueada depois de a ação ter acabado.',
    destino: 'POST /jobs/juridico/alertas',
  },
  {
    path: '/api/cron/comercial-reclassificacao',
    nome: 'Alerta de reclassificação',
    moduloId: 'comercial',
    descricao:
      'Segunda de manhã: aponta contas passivas cujo volume dos últimos 45 dias ficou abaixo de 50% da média dos três meses anteriores. SINALIZA e para — o número não sabe se a obra parou ou se ninguém registrou nada, e reclassificar sozinho mudaria a comissão de alguém a partir de uma hipótese.',
    destino: 'POST /jobs/comercial/alerta-reclassificacao',
  },
  {
    path: '/api/cron/comercial-passivos',
    nome: 'Candidatas a conta passiva',
    moduloId: 'comercial',
    descricao:
      'Dia 2, depois da apuração: aponta clientes que antecipam sozinhos e não receberam toque nosso na janela. SUGERE e notifica — nunca muda. "Sem toque" é afirmação sobre o nosso registro, não sobre o mundo, e marcar sozinho transformaria falha de anotação em perda de comissão de alguém.',
    destino: 'POST /jobs/comercial/sugerir-passivos',
  },
  {
    path: '/api/cron/perfil-recalcular',
    nome: 'Perfil dos Clientes',
    moduloId: 'mercado',
    descricao:
      'Recalcula o contraste entre a régua e quem realmente opera. Dia 8, depois do estimador (6) e do Crédito (7), porque compara faturamento estimado e score. Não aplica nada: escreve o snapshot e quem muda régua é gente.',
    destino: 'POST /jobs/perfil/recalcular',
  },
  {
    path: '/api/cron/heartbeat',
    nome: 'Heartbeat',
    moduloId: 'admin',
    descricao:
      'Não faz trabalho de negócio: prova o caminho Vercel Cron → CRON_SECRET → handler autenticado. É a sonda que denuncia agenda quebrada ou segredo trocado antes de um job de verdade falhar calado.',
  },
  // ─── Comunicação (05A): os seis relógios do cano ──────────────────────────
  {
    path: '/api/cron/comunicacao-fila',
    nome: 'Fila de envio',
    moduloId: 'comunicacao',
    descricao:
      'Consome as mensagens APROVADAS e envia. De 5 em 5 minutos porque uma mensagem que uma pessoa acabou de aprovar não pode esperar meia hora — e o intervalo entre um envio e o próximo é aplicado DENTRO do job, por conta, com valor sorteado: espaçar aqui, no cron, produziria a cadência perfeitamente regular que denuncia um robô. O portão (supressão, base legal, janela, teto do número, warmup) roda no instante do envio, não na aprovação: quem virou suprimido no meio do caminho é barrado aqui.',
    destino: 'POST /jobs/comunicacao/enviar-fila',
  },
  {
    path: '/api/cron/comunicacao-triagem',
    nome: 'Triagem das respostas',
    moduloId: 'comunicacao',
    descricao:
      'Classifica o que chegou: intenção, urgência e se precisa escalar. É a triagem que ACORDA o agente, então atrasá-la atrasa a resposta a quem acabou de escrever. Desencontrada da fila em 2 minutos de propósito — as duas de 5 em 5 no mesmo minuto disputariam a mesma conexão sem ganhar nada.',
    destino: 'POST /jobs/comunicacao/triagem',
  },
  {
    path: '/api/cron/comunicacao-gmail',
    nome: 'Sync do Gmail',
    moduloId: 'comunicacao',
    descricao:
      'FALLBACK do Pub/Sub, não o caminho principal: o push do Google chega em segundos, e isto existe para o dia em que ele não chega. De 10 em 10 minutos porque uma perda de push é rara e um atraso de dez minutos num e-mail é tolerável — de 1 em 1 minuto seria pagar refresh de token o dia inteiro para cobrir uma falha que quase não acontece. Renova o watch na mesma passada, porque as duas coisas dependem do mesmo access token.',
    destino: 'POST /jobs/comunicacao/gmail-sync',
  },
  {
    path: '/api/cron/comunicacao-lembretes',
    nome: 'Lembretes de reunião',
    moduloId: 'comunicacao',
    descricao:
      'H-1 da reunião agendada. De hora em hora, que é a granularidade que um lembrete de uma hora antes precisa — mais fino não muda nada, mais grosso erra o alvo.',
    destino: 'POST /jobs/comunicacao/lembretes-reuniao',
  },
  {
    path: '/api/cron/comunicacao-plantao',
    nome: 'Plantão interno',
    moduloId: 'comunicacao',
    descricao:
      'Alerta crítico para o time, por um número próprio. É transporte SEPARADO: não passa por warmup, supressão, janela nem teto — um orçamento estourado às 23h de um sábado é exatamente o alerta que precisa sair às 23h de um sábado.',
    destino: 'POST /jobs/comunicacao/plantao',
  },
  {
    path: '/api/cron/agente-decidir',
    nome: 'Agente: decidir o próximo passo',
    moduloId: 'comunicacao',
    descricao:
      'Lê as conversas e decide o que fazer em cada uma, dentro de um espaço de ações FECHADO. De hora em hora: decisão de relação não é de minuto, e um agente que reavalia a cada cinco minutos produz mudança de ideia, não diligência.',
    destino: 'POST /jobs/agente/decidir',
  },
  {
    path: '/api/cron/agente-agendados',
    nome: 'Agente: executar o que foi marcado',
    moduloId: 'comunicacao',
    descricao:
      'O relógio que o próprio agente marcou — o "aguardar até quinta" vira ação na quinta. Apura o desfecho das decisões na mesma passada, porque é sobre as que este job acabou de executar: um segundo relógio só para isso seria um relógio a mais para manter.',
    destino: 'POST /jobs/agente/executar-agendados',
    encadeia: ['apurar o desfecho das decisões executadas'],
  },

  // ─── Campanhas (05B) ──────────────────────────────────────────────────────
  {
    path: '/api/cron/campanhas-executar',
    nome: 'Executor de campanhas',
    moduloId: 'comercial',
    descricao:
      'Materializa o público na primeira passada (e só nela: público que muda depois de aprovado é público que ninguém aprovou), enfileira a leva do dia no ritmo configurado e conclui o que acabou. NÃO envia — quem envia é a fila da Comunicação, e é isso que faz o teto por número ser um só. De 15 em 15 minutos: o próprio job espalha a leva em horários agendados, então ele não precisa ser fino, só precisa acordar antes de a leva anterior acabar.',
    destino: 'POST /jobs/campanhas/executar',
  },
  {
    path: '/api/cron/campanhas-sequencia',
    nome: 'Sequência das campanhas',
    moduloId: 'comercial',
    descricao:
      'O segundo e o terceiro toque, quando existem. Diário porque `dias_apos` é medido em dias — de hora em hora ele acordaria 24 vezes para responder "ainda não". Às 9h, antes da janela de envio abrir, para o toque que vence hoje entrar na fila de hoje. Para no primeiro sinal: resposta, opt-out, supressão ou ação do Agente.',
    destino: 'POST /jobs/campanhas/avancar-sequencia',
  },
  {
    path: '/api/cron/campanhas-metricas',
    nome: 'Saúde das campanhas',
    moduloId: 'comercial',
    descricao:
      'Varre as campanhas vivas atrás de opt-out e bounce acima do limiar. Existe para quando NINGUÉM está olhando — o painel de quem abre a tela é calculado na hora. Alerta uma vez por campanha por tipo, e só com amostra mínima: 1 opt-out em 3 enviadas é 33% e não significa nada, e um alerta que grita cedo é um alerta que o time aprende a ignorar.',
    destino: 'POST /jobs/campanhas/metricas',
  },
]

export interface CronAgendado {
  path: string
  schedule: string
}

export interface CronDaPlataforma extends Partial<CronCatalogado> {
  path: string
  nome: string
  /** Ausente quando a entrada do catálogo não tem cron correspondente na Vercel. */
  schedule: string | null
  descricaoAgenda: DescricaoCron | null
  proxima: Date | null
  /** Está no vercel.json mas ninguém descreveu o que ele faz. */
  semCatalogo: boolean
  /** Está no catálogo e NÃO está agendado: roda nunca, e em silêncio. */
  naoAgendado: boolean
  /** A expressão não foi entendida (a agenda continua valendo — quem executa é a Vercel). */
  erro: string | null
}

/**
 * Junta a agenda real (vercel.json) com o catálogo, ordenando pela próxima execução.
 * O que não tem próxima execução (não agendado ou expressão inválida) vai para o fim,
 * onde chama atenção em vez de se perder no meio.
 */
export function listarCrons(agendados: readonly CronAgendado[], agora: Date): CronDaPlataforma[] {
  const porPath = new Map(CRONS.map((c) => [c.path, c]))

  const daVercel: CronDaPlataforma[] = agendados.map((a) => {
    const catalogado = porPath.get(a.path)
    let descricaoAgenda: DescricaoCron | null = null
    let proxima: Date | null = null
    let erro: string | null = null

    try {
      descricaoAgenda = descreverCron(a.schedule)
      proxima = proximaExecucao(a.schedule, agora)
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
    }

    return {
      ...catalogado,
      path: a.path,
      // Sem catálogo, o último segmento da rota já diz mais que nada.
      nome: catalogado?.nome ?? (a.path.split('/').pop() ?? a.path),
      schedule: a.schedule,
      descricaoAgenda,
      proxima,
      semCatalogo: !catalogado,
      naoAgendado: false,
      erro,
    }
  })

  const agendadosPaths = new Set(agendados.map((a) => a.path))
  const orfaos: CronDaPlataforma[] = CRONS.filter((c) => !agendadosPaths.has(c.path)).map((c) => ({
    ...c,
    schedule: null,
    descricaoAgenda: null,
    proxima: null,
    semCatalogo: false,
    naoAgendado: true,
    erro: null,
  }))

  return [...daVercel, ...orfaos].sort((a, b) => {
    if (a.proxima && b.proxima) return a.proxima.getTime() - b.proxima.getTime()
    if (a.proxima) return -1
    if (b.proxima) return 1
    return a.nome.localeCompare(b.nome, 'pt-BR')
  })
}
