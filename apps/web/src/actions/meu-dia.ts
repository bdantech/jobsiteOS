'use server'

import { revalidatePath } from 'next/cache'
import { EVENTO_TIPOS, blocoCatalogado } from '@jobsiteos/core'
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
 * O vendedor cujo dia esta pessoa MEXE.
 *
 * Vem do banco (`app_meu_dia_alvos`), que é a mesma régua da policy de escrita: eu, e o
 * meu closer quando sou auxiliar. Escolher aqui o primeiro da lista é seguro porque o
 * auxiliar e o closer compartilham a fila — adiar por um é adiar pelos dois.
 */
async function vendedorDoDia(
  supabase: NonNullable<Awaited<ReturnType<typeof autorizar>>['supabase']>,
): Promise<string | null> {
  const { data } = await supabase.rpc('app_meu_dia_alvos' as never)
  const alvos = (data ?? []) as string[]
  return alvos[0] ?? null
}

/**
 * "Hoje não" e "isto não devia estar aqui".
 *
 * A distinção é o que alimenta a calibragem dos limiares depois: um adiamento é uma
 * escolha de agenda, um descarte é um voto contra a régua do bloco. Por isso o descarte
 * pede motivo e emite evento — sem o motivo, a única informação que sobraria é que
 * alguém não gostou, e não dá para ajustar um limiar com isso.
 */
export async function ocultarItemAction(input: {
  tipoItem: string
  referenciaId: string
  acao: 'adiado' | 'irrelevante'
  adiadoAte?: string | null
  motivo?: string | null
}): Promise<ResultadoMeuDia> {
  const { erro, supabase, usuarioId } = await autorizar()
  if (erro) return erro

  const catalogo = blocoCatalogado(input.tipoItem)
  if (!catalogo) return { ok: false, message: 'Bloco desconhecido.' }
  if (input.acao === 'adiado' && !input.adiadoAte) {
    return { ok: false, message: 'Escolha até quando adiar — sem data, o item sumiria para sempre.' }
  }

  const vendedorId = await vendedorDoDia(supabase)
  if (!vendedorId) return { ok: false, message: 'Você não tem um cadastro de vendedor ativo.' }

  const { error } = await supabase.from('meu_dia_itens_ocultos').upsert(
    {
      vendedor_id: vendedorId,
      tipo_item: input.tipoItem,
      referencia_id: input.referenciaId,
      acao: input.acao,
      adiado_ate: input.acao === 'adiado' ? input.adiadoAte : null,
      motivo: input.motivo ?? null,
    },
    { onConflict: 'vendedor_id,tipo_item,referencia_id' },
  )
  if (error) return { ok: false, message: error.message }

  /*
   * O evento é best-effort: uma falha ao registrar não desfaz a escolha da pessoa. Ele
   * existe para a calibragem (§6), não para o funcionamento da tela.
   */
  await supabase.from('empresa_eventos').insert({
    empresa_id: null,
    tipo: input.acao === 'adiado' ? EVENTO_TIPOS.MEU_DIA_ITEM_ADIADO : EVENTO_TIPOS.MEU_DIA_ITEM_IRRELEVANTE,
    ator_usuario_id: usuarioId,
    payload: {
      resumo: `${catalogo.rotulo}: item ${input.acao === 'adiado' ? 'adiado' : 'marcado como irrelevante'}.`,
      bloco: input.tipoItem,
      referencia: input.referenciaId,
      motivo: input.motivo ?? null,
      adiado_ate: input.adiadoAte ?? null,
    } as never,
  })

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

  const vendedorId = await vendedorDoDia(supabase)
  if (!vendedorId) return { ok: false, message: 'Você não tem um cadastro de vendedor ativo.' }

  const { error } = await supabase
    .from('meu_dia_itens_ocultos')
    .delete()
    .eq('vendedor_id', vendedorId)
    .eq('tipo_item', input.tipoItem)
    .eq('referencia_id', input.referenciaId)
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

  const alvo = input.vendedorId ?? (await vendedorDoDia(supabase))
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

  const { error } = await supabase
    .from('meu_dia_tarefas')
    .update({ concluida_em: new Date().toISOString() })
    .eq('id', id)
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
