import { normalizarTelefoneBr } from '../../../../packages/core/src/fornecedores/telefone.js'
import {
  fatosDaNotaDoFunil,
  montarPedidoDeLigacao,
  type ContatoDaLigacao,
  type MotivoNaoLigar,
  type NotaDoFunil,
} from '../../../../packages/core/src/voz/pedido.js'
import { telefonesNoProcon } from '../../../../packages/core/src/voz/procon.js'
import type { ConfigVoz, PedidoLigacao } from '../../../../packages/core/src/voz/schemas.js'
import { supabaseAdmin } from '../db.js'

/**
 * O PEDIDO REMONTADO NO INSTANTE DO ENVIO (Prompt 09 §1.3).
 *
 * O pedido era montado quando a pessoa clicava e nunca mais revisto. Entre pôr na fila e
 * discar passam trinta minutos — ou dias, se a voz estava desligada: a Ana falaria um
 * líquido calculado com a taxa de antes da nova análise, uma validade já vencida, ou
 * ofereceria uma nota que já tinha convertido. Um número dito ao telefone é promessa.
 *
 * Por isso o `pedido` gravado na fila é só o retrato do que a tela viu; o que vai para a
 * Ana sai daqui, lido de novo de `notas_funil` e passado de novo pelo portão de conteúdo
 * do core — a MESMA `montarPedidoDeLigacao` que a tela usa, para as duas não divergirem.
 */

/*
 * Literal ÚNICO (supabase-js) e a mesma lista de colunas da action da tela.
 */
const COLUNAS_NOTA =
  'access_key, numero, serie, emitida_em, vencimento, vencimento_origem, valor, taxa_usada, taxa_analise_am, taxa_analise_origem, receita_esperada, tac_estimada, seguro_estimado, status_sync, operavel, fornecedor_cnpj, fornecedor_nome, fornecedor_empresa_id, fornecedor_cadastrado, fornecedor_suprimido, sacado_cnpj, sacado_nome, sacado_razao_social, contato_fornecedor, estagio_funil'

export type PedidoFresco =
  | { ok: true; pedido: PedidoLigacao }
  | { ok: false; motivo: MotivoNaoLigar | 'nota_fora_do_funil' | 'nota_sumiu' }

export async function remontarPedidoDaNota(args: {
  accessKey: string
  contatoId: string | null
  telefone: string
  cfg: ConfigVoz
}): Promise<PedidoFresco> {
  const { data: nota } = await supabaseAdmin
    .from('notas_funil')
    .select(COLUNAS_NOTA)
    .eq('access_key', args.accessKey)
    .maybeSingle()
  if (!nota) return { ok: false, motivo: 'nota_sumiu' }

  // Nota que andou no funil desde o clique (negociação, convertida, perdida) não é mais
  // oferta a fazer por telefone: alguém já está com ela, ou ela já virou dinheiro.
  const estagio = (nota as { estagio_funil?: string | null }).estagio_funil ?? null
  if (estagio && !['a_prospectar', 'em_prospeccao'].includes(estagio)) {
    return { ok: false, motivo: 'nota_fora_do_funil' }
  }

  let contato: ContatoDaLigacao | null = null
  if (args.contatoId) {
    const { data: c } = await supabaseAdmin
      .from('contatos')
      .select('id, nome, cargo, email, telefone, whatsapp, base_legal')
      .eq('id', args.contatoId)
      .maybeSingle()
    if (c) {
      contato = {
        nome: c.nome,
        cargo: c.cargo,
        telefone_e164: args.telefone,
        email: c.email,
        base_legal: c.base_legal,
      }
    }
  }
  if (!contato) {
    const doPayload = (nota as { contato_fornecedor?: { name?: string; phone?: string } | null }).contato_fornecedor
    const tel = normalizarTelefoneBr(doPayload?.phone)
    if (tel.valido && tel.e164 === args.telefone) {
      contato = {
        nome: doPayload?.name ?? (nota as { fornecedor_nome?: string | null }).fornecedor_nome ?? null,
        telefone_e164: tel.e164,
        base_legal: 'dado_publico_nfe',
      }
    }
  }

  if (contato?.telefone_e164) {
    const { data: evidencias } = await supabaseAdmin
      .from('contatos_descobertos')
      .select('valor, evidencia')
      .eq('valor', contato.telefone_e164)
    contato.no_procon = telefonesNoProcon(evidencias ?? []).has(contato.telefone_e164)
  }

  const montado = montarPedidoDeLigacao(
    fatosDaNotaDoFunil(nota as unknown as NotaDoFunil, contato, {
      killSwitch: args.cfg.kill_switch,
      validadeDias: args.cfg.validade_dias,
    }),
  )
  return montado.ok ? { ok: true, pedido: montado.pedido } : { ok: false, motivo: montado.motivo }
}
