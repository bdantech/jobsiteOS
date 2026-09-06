'use server'

import { revalidatePath } from 'next/cache'
import { blocoCatalogado } from '@jobsiteos/core'
import { getSessionContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * As ações do Meu Dia. São quatro, e todas mexem só na lista de trabalho — nenhuma
 * altera o funil por trás: adiar uma NF não move a nota, descartar um lead não o
 * encerra. Isso é de propósito. A tela é uma LEITURA priorizada do que já existe; se
 * ela também escrevesse no funil, "não é relevante" viraria uma forma silenciosa de
 * perder negócio.
 *
 * Quem escreve o funil continua sendo o card do funil, que o botão primário abre.
 */

export type ResultadoMeuDia = { ok: true } | { ok: false; message: string }

const SEM_SESSAO: ResultadoMeuDia = { ok: false, message: 'Sua sessão expirou. Entre novamente.' }

async function autorizar() {
  const context = await getSessionContext()
  if (!context) return { erro: SEM_SESSAO, supabase: null, usuarioId: null }
  if (!context.grantedModuleIds.includes('comercial')) {
    return {
      erro: { ok: false, message: 'Você não tem acesso ao módulo Comercial.' } as ResultadoMeuDia,
      supabase: null,
      usuarioId: null,
    }
  }
  return { erro: null, supabase: await createClient(), usuarioId: context.usuario.id }
}

/**
 * "Hoje não" e "isto não devia estar aqui".
 *
 * A régua e o evento de calibragem moram no BANCO (`app_meu_dia_ocultar`), e não aqui:
 * o mobile não tem server actions e fala com o Postgres direto, então uma versão em
 * TypeScript seria a segunda implementação de esconder um item — uma emitindo o evento,
 * outra esquecendo. Esta função é o botão; a decisão é do RPC.
 */
export async function ocultarItemAction(input: {
  tipoItem: string
  referenciaId: string
  acao: 'adiado' | 'irrelevante'
  adiadoAte?: string | null
  motivo?: string | null
  empresaId?: string | null
}): Promise<ResultadoMeuDia> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const catalogo = blocoCatalogado(input.tipoItem)
  if (!catalogo) return { ok: false, message: 'Bloco desconhecido.' }

  const { error } = await supabase.rpc('app_meu_dia_ocultar' as never, {
    p: {
      tipo_item: input.tipoItem,
      referencia_id: input.referenciaId,
      acao: input.acao,
      adiado_ate: input.adiadoAte ?? null,
      motivo: input.motivo ?? null,
      empresa_id: input.empresaId ?? null,
      rotulo: catalogo.rotulo,
    },
  } as never)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/meu-dia')
  return { ok: true }
}

/** Traz de volta um item adiado ou descartado. O arrependimento é barato de propósito. */
export async function reexibirItemAction(input: {
  tipoItem: string
  referenciaId: string
}): Promise<ResultadoMeuDia> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const { error } = await supabase.rpc('app_meu_dia_reexibir' as never, {
    p: { tipo_item: input.tipoItem, referencia_id: input.referenciaId },
  } as never)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/meu-dia')
  return { ok: true }
}

export async function criarTarefaAction(input: {
  titulo: string
  detalhe?: string | null
  empresaId?: string | null
  venceEm?: string | null
  /** Gestor criando para alguém do time. Vazio = para mim. */
  vendedorId?: string | null
}): Promise<ResultadoMeuDia> {
  const { erro, supabase, usuarioId } = await autorizar()
  if (erro) return erro

  const titulo = input.titulo.trim()
  if (titulo.length < 3) return { ok: false, message: 'Escreva o que precisa ser feito.' }

  const { data: alvos } = await supabase.rpc('app_meu_dia_alvos' as never)
  const alvo = input.vendedorId ?? ((alvos ?? []) as string[])[0]
  if (!alvo) return { ok: false, message: 'Você não tem um cadastro de vendedor ativo.' }

  const { error } = await supabase.from('meu_dia_tarefas').insert({
    vendedor_id: alvo,
    titulo,
    detalhe: input.detalhe?.trim() || null,
    empresa_id: input.empresaId ?? null,
    vence_em: input.venceEm ?? null,
    criada_por: usuarioId,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/meu-dia')
  return { ok: true }
}

/** Concluir NÃO apaga: a tarefa some da lista e o registro fica. */
export async function concluirTarefaAction(id: string): Promise<ResultadoMeuDia> {
  const { erro, supabase } = await autorizar()
  if (erro) return erro

  const { error } = await supabase.rpc('app_meu_dia_concluir_tarefa' as never, { p_id: id } as never)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/meu-dia')
  return { ok: true }
}

/**
 * A configuração de um cargo. Gestor comercial (Admin ou Comercial) — a mesma régua da
 * policy, e a mesma da tela de Configurações do Comercial onde ela mora.
 *
 * Recebe o objeto de overrides JÁ limpo pela tela: campo que voltou ao padrão não vem.
 * Gravar o padrão junto prenderia quem nunca mexeu num valor antigo no dia em que o
 * catálogo mudasse.
 */
export async function salvarConfigMeuDiaAction(input: {
  tipoVendedor: string
  blocos: Record<string, unknown>
}): Promise<ResultadoMeuDia> {
  const { erro, supabase, usuarioId } = await autorizar()
  if (erro) return erro

  if (!['sdr', 'vendedor', 'originador'].includes(input.tipoVendedor)) {
    return { ok: false, message: 'Cargo inválido.' }
  }

  const { error } = await supabase
    .from('meu_dia_config')
    .update({
      blocos: input.blocos as never,
      atualizado_por: usuarioId,
      atualizado_em: new Date().toISOString(),
    })
    .eq('tipo_vendedor', input.tipoVendedor)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/comercial/meu-dia')
  revalidatePath('/comercial/admin')
  return { ok: true }
}
