import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { ClienteServidor } from './candidatos'

/**
 * Os eventos da importação (§6) — e por que eles são diferentes de todos os
 * outros eventos do sistema.
 *
 * 1. NÃO TÊM `empresa_id`. São eventos de SISTEMA: a importação é um lote, não uma
 *    empresa. O trigger de fan-out da migração 0003 montava o título como
 *    `coalesce(nome_fantasia, razao_social, cnpj) || ' — ' || tipo`, o que para um
 *    evento sem empresa renderiza a string literal "Empresa —
 *    importacao.concluida" no sininho. A migração 0014 mudou isso: se o payload
 *    trouxer `titulo`, ele vence. Por isso `titulo` e `url` são OBRIGATÓRIOS aqui
 *    — sem eles a notificação é inútil.
 *
 * 2. `ator_usuario_id` É NULL, e isso é deliberado. O fan-out não notifica o ator
 *    de um evento (`where new.ator_usuario_id is null or destinatario.id <>
 *    new.ator_usuario_id`) — o que é certo para "fulano mudou o estágio" e seria
 *    FATAL aqui: a regra de `importacao.revisao_pendente` mira justamente o
 *    CRIADOR da importação, que é quem disparou o processamento. Com o ator
 *    preenchido, o único destinatário seria excluído e a notificação nunca
 *    chegaria. O evento é do sistema; o autor da importação está em
 *    `importacoes_listas.criado_por` e no payload.
 */

export type TipoEventoImportacao = 'importacao.revisao_pendente' | 'importacao.concluida'

interface EventoImportacao {
  tipo: TipoEventoImportacao
  titulo: string
  resumo: string
  url: string
  importacao_id: string
}

/**
 * Client do USUÁRIO: `empresa_eventos` tem policy de insert sob
 * `app_tem_modulo('empresas')` (migração 0002), então o RLS decide — como em
 * qualquer outra escrita do app.
 */
export async function emitirEvento(
  supabase: ClienteServidor,
  evento: EventoImportacao,
): Promise<void> {
  const { error } = await supabase.from('empresa_eventos').insert({
    empresa_id: null,
    tipo: evento.tipo,
    ator_usuario_id: null,
    payload: {
      titulo: evento.titulo,
      resumo: evento.resumo,
      url: evento.url,
      importacao_id: evento.importacao_id,
    },
  })

  if (error) throw new Error(`Falha ao registrar o evento ${evento.tipo}: ${error.message}`)
}

/**
 * A regra `importacao.revisao_pendente` → CRIADOR (§6).
 *
 * Ela é POR USUÁRIO, então não pode ser semeada em migração (a 0014 diz isso com
 * todas as letras): só existe um "criador" quando alguém cria uma importação. É
 * aqui, no upload, que ela nasce.
 *
 * ⚠️ CLIENT DE SERVIÇO. `notificacao_regras` tem uma única policy — `for all
 * ... using (app_is_admin())` (migração 0002) —, então um usuário comum não
 * consegue criar nem a própria regra. A escalada é mínima e fechada: um único
 * INSERT, com `usuario_id` lido de `importacoes_listas.criado_por` (do banco, não
 * do cliente) e `tipo_evento` fixo em código. Nada aqui vem de input do usuário.
 */
export async function garantirRegraDeRevisao(criadoPor: string): Promise<void> {
  const admin = createAdminClient()

  const { data, error: erroLeitura } = await admin
    .from('notificacao_regras')
    .select('id')
    .eq('tipo_evento', 'importacao.revisao_pendente')
    .eq('usuario_id', criadoPor)
    .maybeSingle()

  if (erroLeitura) {
    console.error('[importador] falha ao checar a regra de notificação', erroLeitura.message)
    return
  }
  if (data) return

  const { error } = await admin.from('notificacao_regras').insert({
    tipo_evento: 'importacao.revisao_pendente',
    usuario_id: criadoPor,
    perfil_id: null,
    ativo: true,
  })

  // Uma regra que não pôde ser criada não invalida a importação: o lote continua
  // válido e visível na tela. Ela só deixa de tocar o sininho.
  if (error) console.error('[importador] falha ao criar a regra de notificação', error.message)
}

/**
 * `importacao.concluida` também mira o criador. A regra semeada em migração
 * cobre apenas os eventos de ingestão do worker (perfil Admin), então quem
 * importou uma lista precisa da sua própria regra para ser avisado do fim.
 */
export async function garantirRegraDeConclusao(criadoPor: string): Promise<void> {
  const admin = createAdminClient()

  const { data, error: erroLeitura } = await admin
    .from('notificacao_regras')
    .select('id')
    .eq('tipo_evento', 'importacao.concluida')
    .eq('usuario_id', criadoPor)
    .maybeSingle()

  if (erroLeitura) {
    console.error('[importador] falha ao checar a regra de conclusão', erroLeitura.message)
    return
  }
  if (data) return

  const { error } = await admin.from('notificacao_regras').insert({
    tipo_evento: 'importacao.concluida',
    usuario_id: criadoPor,
    perfil_id: null,
    ativo: true,
  })

  if (error) console.error('[importador] falha ao criar a regra de conclusão', error.message)
}
