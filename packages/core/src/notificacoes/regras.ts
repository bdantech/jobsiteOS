/**
 * O vocabulário do painel de avisos (0262): papéis, canais e frequências, com os
 * nomes que a tela mostra. O banco guarda as chaves; o CHECK de
 * `notificacao_regras.papel` e esta lista precisam andar juntos.
 */

export const PAPEIS_NOTIFICACAO = {
  nomeados: {
    rotulo: 'Pessoas citadas no aviso',
    descricao: 'Quem o próprio aviso nomeia: quem pediu a análise, o autor do report, o vendedor do "Bom dia".',
    usa: ['destinatarios'],
  },
  vendedor_citado: {
    rotulo: 'O vendedor do aviso',
    descricao: 'O vendedor que o aviso cita — o originador do card, o dono da comissão.',
    usa: ['vendedor_id', 'originador_id'],
  },
  sdr_do_lead: {
    rotulo: 'O SDR do lead',
    descricao: 'Quem tem o lead na carteira de reuniões.',
    usa: ['lead_id'],
  },
  closer_da_reuniao: {
    rotulo: 'O closer da reunião',
    descricao: 'Quem vai conduzir (ou conduziu) a reunião agendada pelo SDR.',
    usa: ['vendedor_destino_id', 'aceite_id', 'lead_id'],
  },
  vendedor_da_venda: {
    rotulo: 'O dono da venda',
    descricao: 'O closer responsável pelo negócio no funil de vendas.',
    usa: ['venda_id'],
  },
  originador_da_nota: {
    rotulo: 'O originador da nota',
    descricao: 'O originador para quem a nota (ou a pré-autorização) foi roteada.',
    usa: ['access_key', 'pre_autorizacao_id'],
  },
  dono_da_empresa: {
    rotulo: 'O dono da conta',
    descricao: 'Quem tem a empresa na carteira: originação, depois SDR, depois gestão passiva.',
    usa: ['empresa'],
  },
  responsavel_da_conversa: {
    rotulo: 'O responsável da conversa',
    descricao: 'Quem cuida da conversa em Comunicação.',
    usa: ['conversa_id'],
  },
  dono_do_numero: {
    rotulo: 'O dono do número que recebeu',
    descricao: 'Quem responde pela conta de WhatsApp que recebeu a mensagem.',
    usa: ['conta_recebedora', 'vendedor_id'],
  },
  quem_pediu: {
    rotulo: 'Quem pediu a análise',
    descricao: 'A pessoa que solicitou a análise de crédito.',
    usa: ['analise_id', 'analise_credito_id'],
  },
  dono_do_envio: {
    rotulo: 'Quem mandou a mensagem',
    descricao: 'Quem escreveu a mensagem que falhou — ou, se foi automática, o vendedor da conta.',
    usa: ['outbox_id'],
  },
  advogado_do_processo: {
    rotulo: 'O advogado do processo',
    descricao: 'O advogado da casa responsável pelo processo.',
    usa: ['numero_cnj'],
  },
} as const

export type PapelNotificacao = keyof typeof PAPEIS_NOTIFICACAO
export const PAPEIS: readonly PapelNotificacao[] = Object.keys(PAPEIS_NOTIFICACAO) as PapelNotificacao[]

export const CANAIS_NOTIFICACAO = { sino: 'Sino', push: 'Push', email: 'E-mail' } as const
export type CanalNotificacao = keyof typeof CANAIS_NOTIFICACAO

export const FREQUENCIAS_NOTIFICACAO = {
  imediato: 'Na hora',
  resumo_diario: 'No resumo diário (8h)',
} as const
export type FrequenciaNotificacao = keyof typeof FREQUENCIAS_NOTIFICACAO

export const MODULOS_NOTIFICACAO: Record<string, string> = {
  antecipacao: 'Antecipação',
  comercial: 'Comercial',
  comunicacao: 'Comunicação',
  credito: 'Crédito',
  empresas: 'Empresas',
  juridico: 'Jurídico',
  mercado: 'Mercado',
  radar: 'Radar',
  plataforma: 'Plataforma',
}

/** As variáveis que um modelo cita: `{{valor}}` e `{{valor|moeda}}` dão `valor`. */
export function variaveisDoModelo(modelo: string | null | undefined): string[] {
  if (!modelo) return []
  const nomes = new Set<string>()
  for (const m of modelo.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*[a-z]+\s*)?\}\}/g)) nomes.add(m[1]!)
  return [...nomes]
}

/** Os filtros que o motor sabe aplicar (`notificacao__formatar`). */
export const FILTROS_MODELO = ['moeda', 'inteiro', 'data'] as const
