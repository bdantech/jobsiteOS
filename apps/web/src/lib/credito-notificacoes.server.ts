import 'server-only'

import { avisar } from '@/lib/notificacoes.server'

/**
 * Os avisos da esteira de crédito saem dos EVENTOS que as RPCs gravam
 * (`analise.solicitada`, `credito.analise_solicitada`, `analise.aprovada`…): o motor
 * de avisos (0262) entrega ao perfil Crédito — ou ao Admin enquanto ele estiver
 * vazio — e a decisão também a QUEM PEDIU, pelo papel `quem_pediu`. As funções que
 * moravam aqui para mandar o push à parte deixaram de existir: o push agora é canal
 * da regra.
 *
 * Sobra um caso: a API de produção insere a análise sem emitir evento nenhum. É ela
 * que chama isto, e o aviso passa a ter o mesmo tipo dos outros caminhos.
 */
export async function avisarPedidoSemEvento(analise: { id: string; nome: string; empresaId: string | null }): Promise<void> {
  await avisar(
    'analise.solicitada',
    {
      titulo: 'Nova análise de crédito na esteira',
      resumo: `${analise.nome} entrou na esteira e aguarda o time de Crédito.`,
      url: `/credito/analises/${analise.id}`,
      analise_id: analise.id,
    },
    { empresaId: analise.empresaId },
  )
}
