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
    encadeia: ['Certificados digitais (mesmo BI, disparado mesmo se o primeiro falhar)'],
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
    encadeia: ['Sync de antecipações (conversão de nota em operação)'],
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
