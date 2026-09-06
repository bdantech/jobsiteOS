/**
 * Meu Dia (04p) — o vocabulário da lista de trabalho do vendedor.
 *
 * A tela não é um dashboard. É uma lista FINITA e COMPLETÁVEL: cada item responde três
 * coisas num olhar — por que está aqui, quanto vale, e qual o botão que resolve — e o
 * bloco que fica sem item SOME, em vez de aparecer vazio. A página encolhe conforme o
 * dia é trabalhado, e é isso que faz alguém voltar a ela amanhã.
 *
 * ESTE ARQUIVO É O CATÁLOGO, e é a única fonte da verdade sobre os blocos. Ele dirige,
 * de uma vez:
 *
 *   o AGREGADOR   `meu_dia()` lê daqui os limiares e os tetos padrão;
 *   a TELA        o card, o rótulo, a ação primária e a cor do segmento no gráfico;
 *   as SETTINGS   a lista do que dá para ligar, desligar e recalibrar.
 *
 * Três listas em três lugares divergiriam na primeira vez que alguém acrescentasse um
 * bloco — e o sintoma seria um bloco que aparece na tela, não aparece nas settings, e
 * ninguém consegue desligar.
 *
 * PURO: nada aqui lê banco. Recebe o que o agregador devolveu e diz como aquilo se lê.
 */

import {
  CHAVE_FASE_CRESCIMENTO,
  CHAVE_SUNSET_VENDEDOR,
  CHAVE_TAXA_VENDEDOR,
  CHAVE_TAXA_ORIGINADOR,
  arredondar,
  calcularVOP,
  comissaoDoVop,
  determinarFase,
  idadeEmMeses,
  valorParametro,
  type CommissionParam,
} from './comissao-v2.js'
import type { GestaoOperacao } from './schemas.js'
import type { TipoVendedorId } from './schemas.js'

// ─── Os blocos ──────────────────────────────────────────────────────────────

export const BLOCOS_MEU_DIA = [
  // Originador — o dia dele é nota que ninguém trabalhou e cedente que esfriou.
  'nfs_alta_nao_prospectadas',
  'antecipacoes_travadas',
  'cedentes_que_pararam',
  'fornecedores_a_cadastrar',
  'fornecedores_sem_contato',
  'certificados_a_prospectar',
  // SDR — o dia dele é relógio.
  'inbound_nao_contatado',
  'leads_sla',
  'conversas_sem_reuniao',
  'no_shows',
  'fit_sem_agendamento',
  'reunioes_proximas',
  // Closer — o dia dele é conta parada e decisão de crédito esperando.
  'aguardando_documentacao',
  'reunioes_pendentes_aceite',
  'credito_decidido',
  'propostas_sem_resposta',
  'carteira_ociosa',
  'novos_clientes',
  'certificados_vencendo',
  'analises_expirando',
  // De todos.
  'conversas_paradas',
  'conversas_aguardando_resposta',
  'proximos_passos_agente',
  'conversas_nao_vinculadas',
  'tarefas_manuais',
] as const

export type BlocoMeuDiaId = (typeof BLOCOS_MEU_DIA)[number]

/**
 * O que o botão do card faz. É o contrato entre o agregador e a tela: o agregador diz
 * o TIPO da ação e devolve em `meta` o que ela precisa; a tela sabe renderizar cada um.
 */
export type AcaoMeuDia =
  | 'abrir_empresa'
  | 'abrir_conversa'
  | 'abrir_card_nf'
  | 'abrir_card_venda'
  | 'abrir_card_lead'
  | 'abrir_fornecedor'
  | 'abrir_certificado'
  | 'enviar_sugestao'
  | 'vincular_conversa'
  | 'decidir_aceite'
  | 'concluir_tarefa'

/**
 * O agrupamento serve ao GRÁFICO de composição, e é a única razão de ele existir.
 *
 * São cinco fatias porque cinco é o que uma pessoa distingue de relance numa barra
 * empilhada. Vinte e cinco blocos coloridos separadamente seriam um arco-íris que
 * ninguém lê — e o gráfico existe para responder "meu dia é feito de quê?", não para
 * repetir a lista que está logo abaixo dele.
 */
export type GrupoMeuDia = 'funil' | 'conversa' | 'carteira' | 'credito' | 'cadastro'

export const GRUPO_MEU_DIA_LABELS: Record<GrupoMeuDia, string> = {
  funil: 'Funil',
  conversa: 'Conversas',
  carteira: 'Carteira',
  credito: 'Crédito',
  cadastro: 'Cadastro',
}

export interface BlocoCatalogado {
  tipo: BlocoMeuDiaId
  rotulo: string
  /** Uma frase: o que este bloco JUNTA, e por que isso é trabalho. */
  descricao: string
  /** Quem vê. Vazio nunca — bloco sem cargo é bloco morto. */
  cargos: readonly TipoVendedorId[]
  grupo: GrupoMeuDia
  acao: AcaoMeuDia
  acaoRotulo: string
  /** Teto de itens. Lista infinita mata a adoção — o topo é o que se trabalha hoje. */
  maxPadrao: number
  /**
   * Limiares editáveis nas settings. A CHAVE é o nome que o agregador lê, e o valor é
   * o default. Bloco sem limiar tem `{}` — não é que ele não seja configurável, é que
   * não há o que calibrar nele.
   */
  limiaresPadrao: Readonly<Record<string, number>>
  /** Rótulo humano de cada limiar, para a tela de settings. */
  limiarRotulos?: Readonly<Record<string, string>>
}

/**
 * O auxiliar do closer NÃO aparece em `cargos`, e não é esquecimento: ele espelha
 * integralmente o Meu Dia do closer a que está vinculado (§3.5). Quem resolve isso é a
 * `cargoDeVisao()` lá embaixo, num lugar só — repetir 'auxiliar' em treze blocos
 * garantiria que o décimo quarto ficasse de fora.
 */
export const CATALOGO_MEU_DIA: readonly BlocoCatalogado[] = [
  // ─── Originador ───────────────────────────────────────────────────────────
  {
    tipo: 'nfs_alta_nao_prospectadas',
    rotulo: 'NFs de alta probabilidade não prospectadas',
    descricao: 'Nota em faixa alta que ninguém tocou. É o topo da fila por receita esperada.',
    cargos: ['originador'],
    grupo: 'funil',
    acao: 'abrir_card_nf',
    acaoRotulo: 'Abrir a nota',
    maxPadrao: 10,
    limiaresPadrao: {},
  },
  {
    tipo: 'antecipacoes_travadas',
    rotulo: 'Antecipações travadas',
    descricao:
      'O cedente ABRIU uma antecipação e não concluiu — rascunho, pedido, reprovada ou '
      + 'negada pelo contratado. É o sinal mais quente do sistema: intenção declarada e '
      + 'operação não fechada.',
    cargos: ['originador'],
    grupo: 'funil',
    acao: 'abrir_empresa',
    acaoRotulo: 'Abrir o cedente',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 3 },
    limiarRotulos: { dias_parada: 'Dias parada no mesmo status' },
  },
  {
    tipo: 'cedentes_que_pararam',
    rotulo: 'Cedentes que pararam',
    descricao: 'Recorrente que antecipava e sumiu. A régua é a distância da última cessão.',
    cargos: ['originador'],
    grupo: 'carteira',
    acao: 'abrir_empresa',
    acaoRotulo: 'Abrir o cedente',
    maxPadrao: 10,
    limiaresPadrao: { dias_sem_antecipar: 45, minimo_antecipacoes: 2 },
    limiarRotulos: {
      dias_sem_antecipar: 'Dias sem antecipar',
      minimo_antecipacoes: 'Antecipações mínimas para contar como recorrente',
    },
  },
  {
    tipo: 'fornecedores_a_cadastrar',
    rotulo: 'Fornecedores a cadastrar',
    descricao: 'Funil de cadastro (04l), pelo maior potencial mensal.',
    cargos: ['originador'],
    grupo: 'cadastro',
    acao: 'abrir_fornecedor',
    acaoRotulo: 'Abrir o fornecedor',
    maxPadrao: 8,
    limiaresPadrao: {},
  },
  {
    tipo: 'fornecedores_sem_contato',
    rotulo: 'Fornecedores sem contato',
    descricao: 'No funil e sem ninguém para falar. A ação é disparar a descoberta.',
    cargos: ['originador'],
    grupo: 'cadastro',
    acao: 'abrir_fornecedor',
    acaoRotulo: 'Buscar contatos',
    maxPadrao: 8,
    limiaresPadrao: {},
  },
  {
    tipo: 'certificados_a_prospectar',
    rotulo: 'Certificados a prospectar',
    descricao:
      'Empresa da carteira sem certificado válido. Sem certificado a ingestão não vê as '
      + 'notas dela — o valor ao lado é o que está cego por isso.',
    cargos: ['originador'],
    grupo: 'cadastro',
    acao: 'abrir_certificado',
    acaoRotulo: 'Abrir no funil',
    maxPadrao: 8,
    limiaresPadrao: {},
  },

  // ─── SDR ──────────────────────────────────────────────────────────────────
  {
    tipo: 'inbound_nao_contatado',
    rotulo: 'Inbound novo não contatado',
    descricao: 'Chegou sozinho e ninguém respondeu. Aqui minutos importam, não dias.',
    cargos: ['sdr'],
    grupo: 'funil',
    acao: 'abrir_card_lead',
    acaoRotulo: 'Abrir o lead',
    maxPadrao: 15,
    limiaresPadrao: { horas_alerta: 4 },
    limiarRotulos: { horas_alerta: 'Horas de espera para virar urgente' },
  },
  {
    tipo: 'leads_sla',
    rotulo: 'Leads perto de expirar',
    descricao: 'Sem toque até o prazo, o lead volta ao pool e alguém perde o trabalho já feito.',
    cargos: ['sdr'],
    grupo: 'funil',
    acao: 'abrir_card_lead',
    acaoRotulo: 'Abrir o lead',
    maxPadrao: 10,
    limiaresPadrao: { sla_dias: 7, avisar_faltando_dias: 2 },
    limiarRotulos: {
      sla_dias: 'SLA do lead, em dias',
      avisar_faltando_dias: 'Avisar quando faltarem N dias',
    },
  },
  {
    tipo: 'conversas_sem_reuniao',
    rotulo: 'Conversas sem reunião marcada',
    descricao: 'Começou a falar e parou antes de agendar.',
    cargos: ['sdr'],
    grupo: 'conversa',
    acao: 'abrir_conversa',
    acaoRotulo: 'Abrir a conversa',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 3 },
    limiarRotulos: { dias_parada: 'Dias sem mensagem' },
  },
  {
    tipo: 'no_shows',
    rotulo: 'No-shows não remarcados',
    descricao: 'A reunião não aconteceu e ninguém remarcou.',
    cargos: ['sdr'],
    grupo: 'funil',
    acao: 'abrir_card_lead',
    acaoRotulo: 'Remarcar',
    maxPadrao: 10,
    limiaresPadrao: {},
  },
  {
    tipo: 'fit_sem_agendamento',
    rotulo: 'Com fit, sem agendamento',
    descricao: 'Você já disse que serve. Falta marcar.',
    cargos: ['sdr'],
    grupo: 'funil',
    acao: 'abrir_card_lead',
    acaoRotulo: 'Agendar',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 2 },
    limiarRotulos: { dias_parada: 'Dias desde o fit' },
  },
  {
    tipo: 'reunioes_proximas',
    rotulo: 'Reuniões de hoje e amanhã',
    descricao: 'A ação é confirmar antes que vire no-show.',
    cargos: ['sdr', 'vendedor'],
    grupo: 'funil',
    acao: 'abrir_card_lead',
    acaoRotulo: 'Confirmar',
    maxPadrao: 10,
    limiaresPadrao: { horizonte_dias: 2 },
    limiarRotulos: { horizonte_dias: 'Horizonte, em dias' },
  },

  // ─── Closer ───────────────────────────────────────────────────────────────
  {
    tipo: 'aguardando_documentacao',
    rotulo: 'Aguardando documentação',
    descricao: 'A venda parou esperando papel. É o estágio onde negócio morre em silêncio.',
    cargos: ['vendedor'],
    grupo: 'funil',
    acao: 'abrir_card_venda',
    acaoRotulo: 'Abrir a venda',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 5 },
    limiarRotulos: { dias_parada: 'Dias no mesmo estágio' },
  },
  {
    tipo: 'reunioes_pendentes_aceite',
    rotulo: 'Reuniões pendentes de aceite',
    descricao: 'O SDR passou a reunião e o relógio de 48h está correndo. Sem decisão, aceita sozinha.',
    cargos: ['vendedor'],
    grupo: 'funil',
    acao: 'decidir_aceite',
    acaoRotulo: 'Decidir',
    maxPadrao: 10,
    limiaresPadrao: {},
  },
  {
    tipo: 'credito_decidido',
    rotulo: 'Crédito decidido',
    descricao:
      'A seguradora respondeu e a bola está com você: aprovado vira proposta, parcial vira '
      + 'decisão, negado vira encerramento com motivo.',
    cargos: ['vendedor'],
    grupo: 'credito',
    acao: 'abrir_card_venda',
    acaoRotulo: 'Abrir a venda',
    maxPadrao: 10,
    limiaresPadrao: {},
  },
  {
    tipo: 'propostas_sem_resposta',
    rotulo: 'Propostas enviadas sem resposta',
    descricao: 'Proposta na mesa do cliente há dias.',
    cargos: ['vendedor'],
    grupo: 'funil',
    acao: 'abrir_card_venda',
    acaoRotulo: 'Abrir a venda',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 4 },
    limiarRotulos: { dias_parada: 'Dias desde o envio' },
  },
  {
    tipo: 'carteira_ociosa',
    rotulo: 'Carteira passiva ociosa',
    descricao:
      'Cliente com limite aprovado e sem operar. O valor ao lado é dinheiro parado que já '
      + 'foi aprovado — não é potencial, é limite ocioso.',
    cargos: ['vendedor'],
    grupo: 'carteira',
    acao: 'abrir_empresa',
    acaoRotulo: 'Abrir o cliente',
    maxPadrao: 12,
    limiaresPadrao: { dias_sem_antecipar: 30, limite_minimo: 50000 },
    limiarRotulos: {
      dias_sem_antecipar: 'Dias sem antecipar',
      limite_minimo: 'Limite ocioso mínimo, em R$',
    },
  },
  {
    tipo: 'novos_clientes',
    rotulo: 'Novos clientes',
    descricao: 'Janela de ativação: o que acontece aqui decide se a conta vira recorrente.',
    cargos: ['vendedor'],
    grupo: 'carteira',
    acao: 'abrir_empresa',
    acaoRotulo: 'Abrir o cliente',
    maxPadrao: 8,
    limiaresPadrao: { janela_dias: 60 },
    limiarRotulos: { janela_dias: 'Janela de ativação, em dias' },
  },
  {
    tipo: 'certificados_vencendo',
    rotulo: 'Certificados vencendo',
    descricao: 'Cliente cego não opera — e o que ele deixa de operar é comissão sua.',
    cargos: ['vendedor'],
    grupo: 'cadastro',
    acao: 'abrir_certificado',
    acaoRotulo: 'Abrir no funil',
    maxPadrao: 8,
    limiaresPadrao: { avisar_faltando_dias: 30 },
    limiarRotulos: { avisar_faltando_dias: 'Avisar quando faltarem N dias' },
  },
  {
    tipo: 'analises_expirando',
    rotulo: 'Análises expirando',
    descricao: 'Limite que vence é limite que some. Renovar antes evita a conta parar.',
    cargos: ['vendedor'],
    grupo: 'credito',
    acao: 'abrir_empresa',
    acaoRotulo: 'Abrir o cliente',
    maxPadrao: 10,
    limiaresPadrao: { avisar_faltando_dias: 60 },
    limiarRotulos: { avisar_faltando_dias: 'Avisar quando faltarem N dias' },
  },

  // ─── De todos ─────────────────────────────────────────────────────────────
  {
    tipo: 'conversas_paradas',
    rotulo: 'Conversas paradas',
    descricao: 'Objetivo aberto, sem toque. A conversa esfria mais rápido que o lead.',
    cargos: ['originador', 'sdr', 'vendedor'],
    grupo: 'conversa',
    acao: 'abrir_conversa',
    acaoRotulo: 'Abrir a conversa',
    maxPadrao: 10,
    limiaresPadrao: { dias_parada: 5 },
    limiarRotulos: { dias_parada: 'Dias sem mensagem' },
  },
  {
    tipo: 'conversas_aguardando_resposta',
    rotulo: 'Aguardando minha resposta',
    descricao: 'A última mensagem foi deles. Enquanto não responder, a bola está com você.',
    cargos: ['originador', 'sdr', 'vendedor'],
    grupo: 'conversa',
    acao: 'abrir_conversa',
    acaoRotulo: 'Responder',
    maxPadrao: 15,
    limiaresPadrao: {},
  },
  {
    tipo: 'proximos_passos_agente',
    rotulo: 'Próximos passos sugeridos',
    descricao: 'O Agente escreveu a mensagem. Falta você concordar.',
    cargos: ['originador', 'sdr', 'vendedor'],
    grupo: 'conversa',
    acao: 'enviar_sugestao',
    acaoRotulo: 'Revisar e enviar',
    maxPadrao: 10,
    limiaresPadrao: { confianca_minima: 0 },
    limiarRotulos: { confianca_minima: 'Confiança mínima da sugestão (0 a 100)' },
  },
  {
    tipo: 'conversas_nao_vinculadas',
    rotulo: 'Conversas não identificadas',
    descricao: 'Chegou mensagem de um número que ninguém sabe de quem é.',
    cargos: ['originador', 'sdr', 'vendedor'],
    grupo: 'conversa',
    acao: 'vincular_conversa',
    acaoRotulo: 'Identificar',
    maxPadrao: 8,
    limiaresPadrao: {},
  },
  {
    tipo: 'tarefas_manuais',
    rotulo: 'Tarefas',
    descricao: 'O que você (ou a gestão) anotou para fazer.',
    cargos: ['originador', 'sdr', 'vendedor'],
    grupo: 'funil',
    acao: 'concluir_tarefa',
    acaoRotulo: 'Concluir',
    maxPadrao: 15,
    limiaresPadrao: {},
  },
]

const POR_TIPO = new Map(CATALOGO_MEU_DIA.map((b) => [b.tipo, b]))

export function blocoCatalogado(tipo: string): BlocoCatalogado | undefined {
  return POR_TIPO.get(tipo as BlocoMeuDiaId)
}

/**
 * O cargo cujo Meu Dia esta pessoa vê.
 *
 * O auxiliar do closer não tem dia próprio: ele espelha o do closer a que está vinculado
 * (§3.5), com a mesma carteira e os mesmos blocos. A tradução mora AQUI, e só aqui —
 * é o mesmo motivo pelo qual a navegação do Comercial normaliza o tipo num lugar só.
 */
export function cargoDeVisao(tipo: string | null | undefined): TipoVendedorId | null {
  if (tipo === 'auxiliar') return 'vendedor'
  if (tipo === 'sdr' || tipo === 'vendedor' || tipo === 'originador') return tipo
  return null
}

export function blocosDoCargo(tipo: string | null | undefined): BlocoCatalogado[] {
  const cargo = cargoDeVisao(tipo)
  if (!cargo) return []
  return CATALOGO_MEU_DIA.filter((b) => b.cargos.includes(cargo))
}

// ─── O que o agregador devolve ──────────────────────────────────────────────

export type UrgenciaMeuDia = 'alta' | 'media' | 'baixa'

export const URGENCIA_ORDEM: Record<UrgenciaMeuDia, number> = { alta: 0, media: 1, baixa: 2 }

export interface ItemMeuDia {
  /** O que identifica o item para adiar/descartar: access_key, lead id, cnpj, empresa_id. */
  referencia_id: string
  titulo: string
  subtitulo: string | null
  /** POR QUE está aqui, numa frase. É a coluna que decide se a pessoa confia na lista. */
  motivo: string
  /** R$ em jogo. `null` quando o item não tem valor — e aí a tela não inventa um. */
  valor: number | null
  urgencia: UrgenciaMeuDia
  /** Dias (ou horas, quando o bloco é de minutos) que sustentam o motivo. */
  dias: number | null
  empresa_id: string | null
  /** Instante do compromisso, para a timeline do dia. */
  quando: string | null
  meta: Record<string, unknown>
}

export interface BlocoMeuDia {
  tipo: BlocoMeuDiaId
  itens: ItemMeuDia[]
  /** Quantos existiam ANTES do teto. É o que permite dizer "e mais 14". */
  total: number
  valor_total: number
}

export interface MeuDia {
  tem_acesso: boolean
  vendedor_id: string | null
  vendedor_nome: string | null
  tipo: string | null
  /** Verdadeiro quando estou vendo o dia de OUTRA pessoa (gestor, ou auxiliar). */
  espelhado: boolean
  gerado_em: string
  blocos: BlocoMeuDia[]
  /** Clientes da carteira passiva, para o mapa de calor. Só para o closer. */
  mapa_carteira: {
    empresa_id: string | null
    cnpj: string
    nome: string
    limite: number
    limite_disponivel: number
    dias_sem_antecipar: number | null
  }[]
  /** Série do rodapé: conversões do mês contra a média dos 3 anteriores (originador). */
  evolucao: { competencia: string; total: number; media_3m: number | null }[]
  /** Funil da semana (SDR): contatados → com fit → agendados → realizados. */
  funil_semana: { etapa: string; total: number }[]
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export function itensDoDia(dia: MeuDia): ItemMeuDia[] {
  return dia.blocos.flatMap((b) => b.itens)
}

/**
 * A ordem da lista é URGÊNCIA × VALOR, sempre, e nesta ordem.
 *
 * Valor primeiro faria a pessoa trabalhar o item caro antes do item que vence hoje —
 * e o que vence hoje some sozinho se ninguém o tocar. Urgência primeiro faria uma
 * fila de bagatelas urgentes esconder o negócio grande. A composição das duas é a
 * única que responde "o que eu faço agora".
 */
export function ordenarItens(itens: readonly ItemMeuDia[]): ItemMeuDia[] {
  return [...itens].sort(
    (a, b) =>
      URGENCIA_ORDEM[a.urgencia] - URGENCIA_ORDEM[b.urgencia] ||
      (b.valor ?? 0) - (a.valor ?? 0) ||
      a.titulo.localeCompare(b.titulo, 'pt-BR'),
  )
}

/** R$ em jogo hoje: a soma do que os itens acionáveis valem. Sem valor não soma. */
export function valorEmJogo(dia: MeuDia): number {
  return arredondar(dia.blocos.reduce((s, b) => s + b.valor_total, 0))
}

export function totalDeItens(dia: MeuDia): number {
  return dia.blocos.reduce((s, b) => s + b.itens.length, 0)
}

export function itensUrgentes(dia: MeuDia): ItemMeuDia[] {
  return ordenarItens(itensDoDia(dia).filter((i) => i.urgencia === 'alta'))
}

/** A composição do dia por grupo — as fatias do único gráfico da tela. */
export function composicaoDoDia(dia: MeuDia): { grupo: GrupoMeuDia; itens: number; valor: number }[] {
  const acc = new Map<GrupoMeuDia, { itens: number; valor: number }>()
  for (const bloco of dia.blocos) {
    const cat = blocoCatalogado(bloco.tipo)
    if (!cat) continue
    const atual = acc.get(cat.grupo) ?? { itens: 0, valor: 0 }
    atual.itens += bloco.itens.length
    atual.valor += bloco.valor_total
    acc.set(cat.grupo, atual)
  }
  return [...acc.entries()]
    .map(([grupo, v]) => ({ grupo, itens: v.itens, valor: arredondar(v.valor) }))
    .filter((f) => f.itens > 0)
    .sort((a, b) => b.itens - a.itens)
}

// ─── Comissão projetada ─────────────────────────────────────────────────────

export interface ItemProjetavel {
  /** O valor que seria cedido. Sem ele não há VOP e o item não projeta nada. */
  valor: number
  /** Prazo da antecipação. Quando desconhecido, o agregador manda o default do bloco. */
  dias: number
  gestaoOperacao: GestaoOperacao | null
  marcoAtivacao: string | null
  /** Sou titular do SACADO desta conta? */
  souVendedor: boolean
  /** Sou titular do CEDENTE? */
  souOriginador: boolean
  sharePct?: number
}

/**
 * "Se tudo converter, quanto eu ganho."
 *
 * Roda o MOTOR DE VERDADE (04k) e não uma regra de bolso: a mesma fase, a mesma taxa
 * vigente, o mesmo VOP `valor × dias / N`, o mesmo sunset. Uma segunda fórmula "só para
 * a projeção" é como uma tela passa meses prometendo um número que a folha nunca paga —
 * e a primeira vez que os dois discordassem, o vendedor pararia de acreditar nos dois.
 *
 * Soma SÓ onde a pessoa é titular. Projetar a comissão de uma conta de outro seria
 * mostrar dinheiro que nunca vai chegar.
 */
export function projetarComissao(
  itens: readonly ItemProjetavel[],
  params: readonly CommissionParam[],
  vendedorId: string,
  data: Date | string = new Date(),
): number {
  const quando = typeof data === 'string' ? data : data.toISOString()
  const diasRef = valorParametro(params, 'dias_referencia_vop', null, quando)
  if (diasRef === null || diasRef <= 0) return 0

  let total = 0

  for (const item of itens) {
    const gestao = item.gestaoOperacao
    if (!gestao) continue
    const vop = calcularVOP(item.valor, item.dias, diasRef)
    if (vop <= 0) continue

    const share = item.sharePct ?? 100
    const idade = item.marcoAtivacao ? idadeEmMeses(item.marcoAtivacao, quando) : 0
    const fase = determinarFase({
      marcoAtivacao: item.marcoAtivacao,
      gestaoOperacao: gestao,
      data: quando,
      mesesCrescimento: valorParametro(params, CHAVE_FASE_CRESCIMENTO[gestao], null, quando),
      mesesSunset: valorParametro(params, CHAVE_SUNSET_VENDEDOR[gestao], null, quando),
    })

    if (item.souVendedor && fase !== 'RESIDUAL') {
      const taxa = valorParametro(params, CHAVE_TAXA_VENDEDOR[gestao][fase], vendedorId, quando)
      if (taxa !== null && taxa > 0) total += comissaoDoVop(vop, taxa, share)
    }

    if (item.souOriginador) {
      const sunset = valorParametro(params, 'sunset_originador_meses', null, quando)
      const cortado = sunset !== null && item.marcoAtivacao !== null && idade > sunset
      if (!cortado) {
        const taxa = valorParametro(params, CHAVE_TAXA_ORIGINADOR[gestao], vendedorId, quando)
        if (taxa !== null && taxa > 0) total += comissaoDoVop(vop, taxa, share)
      }
    }
  }

  return arredondar(total)
}

// ─── Config resolvida ───────────────────────────────────────────────────────

export interface OverrideBloco {
  ativo?: boolean
  max_itens?: number
  limiares?: Record<string, number>
}

export interface BlocoResolvido {
  ativo: boolean
  max_itens: number
  limiares: Record<string, number>
}

/**
 * O que o agregador recebe: catálogo + o que o gestor mudou, já mesclado.
 *
 * A MESCLA MORA AQUI, e não no SQL, porque os padrões moram no catálogo — e dois
 * conjuntos de padrões, um em TS e outro em plpgsql, divergiriam na primeira vez que
 * alguém ajustasse um só. O banco guarda apenas o override; o SQL recebe números
 * prontos e não decide nada.
 *
 * Só os blocos DO CARGO entram. É isso que faz `app__md_ativo` poder ter default
 * `false`: bloco ausente da config é bloco que não é daquele cargo.
 */
export function resolverConfig(
  tipo: string | null | undefined,
  overrides: Record<string, OverrideBloco> | null | undefined,
): Record<string, BlocoResolvido> {
  const o = overrides ?? {}
  const out: Record<string, BlocoResolvido> = {}

  for (const bloco of blocosDoCargo(tipo)) {
    const ov = o[bloco.tipo] ?? {}
    out[bloco.tipo] = {
      ativo: ov.ativo ?? true,
      max_itens: Math.max(1, Math.trunc(ov.max_itens ?? bloco.maxPadrao)),
      limiares: { ...bloco.limiaresPadrao, ...(ov.limiares ?? {}) },
    }
  }

  return out
}
