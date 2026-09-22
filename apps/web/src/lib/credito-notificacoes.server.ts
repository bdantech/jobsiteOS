import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { notificarNomeadosPeloDado } from '@/lib/notificacoes.server'

/**
 * Os avisos da esteira de crédito que não cabem numa `notificacao_regras` (0248).
 *
 * ── A DIVISÃO DE TRABALHO ───────────────────────────────────────────────────
 * O gatilho `fanout_evento_para_notificacoes` já escreve a linha do SINO para quem uma
 * regra nomeia, em TODOS os caminhos — inclusive os que nunca passam por Node: o app
 * mobile chamando o RPC direto, a barra de IA. Essa metade é durável e está completa.
 *
 * O que o Postgres não tem como fazer é o PUSH: não há chave VAPID nem cliente Expo
 * dentro do banco. Por isso os caminhos que rodam no servidor chamam estas funções
 * depois de gravar — e elas mandam só o push para quem o fan-out já alcançou, e sino +
 * push para quem ele não alcança (o vendedor que pediu a análise).
 *
 * ── BEST-EFFORT, SEMPRE ─────────────────────────────────────────────────────
 * Nenhuma destas funções lança. A análise já foi criada ou decidida quando elas rodam, e
 * um push que não sai não pode desfazer o que já é fato — nem virar erro numa tela onde
 * a ação deu certo.
 */

/** Ids dos usuários ativos que trabalham a esteira. */
async function analistasDeCredito(): Promise<string[]> {
  const admin = createAdminClient()
  const { data: perfil } = await admin.from('perfis').select('id').eq('nome', 'Crédito').maybeSingle()
  if (!perfil) return []
  const { data: usuarios } = await admin
    .from('usuarios')
    .select('id')
    .eq('perfil_id', perfil.id)
    .eq('ativo', true)
  return (usuarios ?? []).map((u) => u.id)
}

/**
 * Entrou pedido novo na esteira.
 *
 * `tipoEvento` diz qual evento o caminho emitiu, e é o que evita o sino dobrado:
 * `analise.solicitada` (Company 360, esteira, IA, mobile), `credito.analise_solicitada`
 * (pedido nascido no funil comercial, 0129) ou `null` para a API de produção, que insere
 * a linha sem emitir evento nenhum.
 *
 * `quemPediu` sai da lista porque o fan-out também o exclui (`ator_usuario_id`): quem
 * acabou de clicar não precisa ser avisado do próprio clique, e mandar só o push para ele
 * produziria um aviso sem linha no sino — que some ao ser tocado e não deixa rastro.
 */
export async function avisarPedidoDeAnalise(
  analise: { id: string; nome: string },
  opcoes: { tipoEvento: string | null; quemPediu?: string | null },
): Promise<void> {
  try {
    const destinatarios = (await analistasDeCredito()).filter((id) => id !== opcoes.quemPediu)
    if (!destinatarios.length) return
    await notificarNomeadosPeloDado(destinatarios, opcoes.tipoEvento, {
      titulo: 'Nova análise de crédito na esteira',
      corpo: `${analise.nome} entrou na esteira e aguarda o time de Crédito.`,
      url: `/credito/analises/${analise.id}`,
    })
  } catch {
    // Ver o cabeçalho: o pedido já existe, e um push que não sai não o desfaz.
  }
}

/**
 * A esteira decidiu — e quem pediu é quem precisa saber.
 *
 * Vale para a decisão tomada AQUI (`app_concluir_analise`). A que vem da seguradora é
 * avisada pelo worker, dentro de `aplicarDecisao`, que é onde ela chega.
 *
 * `quemDecidiu` sai da lista pelo mesmo motivo de sempre: o analista que acabou de
 * concluir não precisa de um push contando o que ele mesmo fez — e o fan-out já o exclui
 * do sino por ser o ator do evento.
 */
export async function avisarDecisaoAQuemPediu(
  analise: {
    id: string
    estagio: string
    solicitada_por: string | null
    limite_operacional: number | string | null
    motivo: string | null
  },
  nome: string,
  quemDecidiu: string | null,
): Promise<void> {
  if (!analise.solicitada_por || analise.solicitada_por === quemDecidiu) return

  const negada = analise.estagio === 'negada'
  const limite = analise.limite_operacional === null ? null : Number(analise.limite_operacional)
  const tipoEvento =
    analise.estagio === 'aprovada'
      ? 'analise.aprovada'
      : analise.estagio === 'aprovada_parcial'
        ? 'analise.aprovada_parcial'
        : 'analise.negada'

  try {
    await notificarNomeadosPeloDado([analise.solicitada_por], tipoEvento, {
      titulo: negada
        ? 'A análise que você pediu foi negada'
        : analise.estagio === 'aprovada_parcial'
          ? 'A análise que você pediu saiu aprovada em parte'
          : 'A análise que você pediu foi aprovada',
      corpo:
        !negada && limite
          ? `${nome}: R$ ${Math.round(limite).toLocaleString('pt-BR')} de limite operacional.`
          : `${nome}: ${analise.motivo ?? 'veja a decisão na análise.'}`,
      url: `/credito/analises/${analise.id}`,
    })
  } catch {
    // Ver o cabeçalho.
  }
}
