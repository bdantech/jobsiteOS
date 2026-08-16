import { z } from 'zod'

/**
 * O funil de captura de certificados digitais.
 *
 * Certificado ausente = cegueira de NF-e naquele CNPJ. O grid (04b §4) mostra ONDE
 * está a cegueira; este funil é onde alguém trabalha para fechá-la — e a diferença
 * entre os dois é a diferença entre uma foto e uma fila de trabalho.
 *
 * O CARD É POR CLIENTE, não por CNPJ: a ligação é uma só, com a construtora, e as
 * SPEs do grupo entram dentro do card dela. Com 970 CNPJs de SPE e 961 sem
 * certificado, um card por CNPJ seria uma fila que ninguém encara.
 */

/** As colunas em ORDEM. A ordem é o caminho do trabalho, e a UI depende dela. */
export const ESTAGIOS_CERTIFICADO = [
  'universo',
  'iniciar_prospeccao',
  'prospeccao',
  'emissao_agendada',
  'pendente_spes',
] as const
export type EstagioCertificado = (typeof ESTAGIOS_CERTIFICADO)[number]

/**
 * "Emissão agendada" e não "agendamento para colocação": o que se marca com o cliente
 * é a data em que o certificado será EMITIDO (A1 na contabilidade, A3 no cartório) —
 * "colocação" descreve o nosso lado do processo, e o card existe para conduzir o lado
 * do cliente.
 *
 * "Pendente só SPEs" é a coluna que a MÁQUINA preenche quando a matriz fica coberta.
 * Separa "ainda não falei com o cliente" de "o cliente resolveu o principal e sobrou
 * a cauda": duas ligações diferentes que, na mesma coluna, ninguém prioriza.
 */
export const ESTAGIO_CERTIFICADO_LABELS: Record<EstagioCertificado, string> = {
  universo: 'Universo de certificados',
  iniciar_prospeccao: 'Iniciar prospecção',
  prospeccao: 'Em prospecção',
  emissao_agendada: 'Emissão agendada',
  pendente_spes: 'Pendente só SPEs',
}

/**
 * `iniciar_prospeccao` separa a fila do que foi ESCOLHIDO da fila.
 *
 * Sem ela, "Universo" guardava as duas coisas — tudo que falta e o que se decidiu
 * atacar — e uma coluna que significa duas coisas não prioriza nenhuma. É também a
 * única etapa que não descreve uma conversa: é a decisão que vem antes dela.
 */
export const ESTAGIO_CERTIFICADO_AJUDA: Record<EstagioCertificado, string> = {
  universo: 'Entrou sozinho: falta certificado, ou algum vence em menos de 30 dias.',
  iniciar_prospeccao: 'Escolhido para atacar. A conversa ainda não começou.',
  prospeccao: 'Alguém já está falando com o cliente sobre isto.',
  emissao_agendada: 'Data marcada com o cliente para emitir o certificado.',
  pendente_spes: 'A matriz está coberta. Sobrou a cauda de SPEs — a máquina move para cá.',
}

export const SITUACOES_CERTIFICADO = ['ganho', 'perdido'] as const
export type SituacaoCertificado = (typeof SITUACOES_CERTIFICADO)[number]

export type EstagioCard = EstagioCertificado | SituacaoCertificado

export const moverCertificadoCardSchema = z
  .object({
    card_id: z.string().uuid(),
    estagio: z.enum([...ESTAGIOS_CERTIFICADO, ...SITUACOES_CERTIFICADO]),
    perdido_motivo: z.string().uuid().nullable().optional(),
    observacao: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.estagio !== 'perdido' || !!v.perdido_motivo, {
    message: 'Perder exige motivo.',
    path: ['perdido_motivo'],
  })
export type MoverCertificadoCardInput = z.infer<typeof moverCertificadoCardSchema>

/**
 * A regra que o banco também aplica, repetida aqui só para a tela poder DESABILITAR o
 * botão em vez de deixar clicar e mostrar erro.
 *
 * A duplicação é deliberada e tem uma direção: o banco é a autoridade (`app_mover_
 * certificado_card` levanta exceção), esta função é conveniência. Se as duas
 * divergirem, quem manda é a que roda no servidor — e por isso a tela nunca decide
 * sozinha que algo é permitido, só que algo é obviamente proibido.
 */
export function podeGanhar(matrizCoberta: boolean): boolean {
  return matrizCoberta
}

/** O percentual de cobertura do grupo. `null` quando não há CNPJ nenhum — não 0%. */
export function pctCobertura(cobertos: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.round((cobertos / total) * 100)
}
