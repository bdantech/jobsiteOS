import {
  ORIGEM_NF,
  decidirContato,
  normalizarContatoNf,
  type ContatoExistente,
} from '../../../../../packages/core/src/antecipacao/contato-nf.js'
import { supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O contato que veio dentro da NF, promovido a linha de `contatos`.
 *
 * Antes disto o dado ficava só como jsonb DENTRO da nota, servindo de último
 * recurso para a Outbox. O efeito era um CRM vazio com o telefone chegando seis
 * vezes por dia: quem abria a ficha do fornecedor não via contato nenhum, e o
 * Radar era acionado para redescobrir — pagando — o que a API já tinha mandado.
 *
 * Duas entradas para a mesma lógica:
 *
 *   materializarContato   → chamada pelo sync, nota a nota, no fluxo normal
 *   backfillContatosNf    → varre as notas que JÁ ESTÃO no banco
 *
 * A segunda existe porque o sync é incremental: as notas de ontem não voltam a
 * ser buscadas, então sem uma varredura o contato delas continuaria preso no
 * jsonb para sempre. Ela é segura de repetir — `decidirContato` é idempotente —
 * e por isso roda no job diário em vez de ser um script de uma vez só.
 */

export interface ContagemContatos {
  criados: number
  completados: number
}

export const SEM_CONTATO: ContagemContatos = { criados: 0, completados: 0 }

export function somarContatos(a: ContagemContatos, b: ContagemContatos): ContagemContatos {
  return { criados: a.criados + b.criados, completados: a.completados + b.completados }
}

/**
 * Exige `empresaId`, e isso é decisão e não limitação: `contatos.empresa_id` é
 * NOT NULL, um contato órfão não aparece em ficha nenhuma e não é alcançável
 * pela hierarquia de ponto focal. Enquanto o fornecedor de aquisição não for
 * promovido, o contato dele continua acessível pelo jsonb da nota — que é de
 * onde a Outbox já o lê.
 *
 * Toda a decisão (inserir / completar / não tocar) está em core/contato-nf.ts,
 * testada. Aqui fica só a ida ao banco.
 */
export async function materializarContato(
  empresaId: string | null,
  payload: unknown,
): Promise<ContagemContatos> {
  if (!empresaId) return SEM_CONTATO

  const novo = normalizarContatoNf(payload as Parameters<typeof normalizarContatoNf>[0])
  if (!novo) return SEM_CONTATO

  const { data: existentes, error: erroLeitura } = await supabaseAdmin
    .from('contatos')
    .select('id, nome, email, telefone, whatsapp, origem')
    .eq('empresa_id', empresaId)

  // Ler falhou: NÃO inserir às cegas. Sem saber o que já existe, a única saída
  // segura é pular — inserir aqui duplicaria o contato a cada sync.
  if (erroLeitura) {
    logger.error({ empresaId, erro: erroLeitura.message }, 'Falha ao ler contatos (segue sem gravar).')
    return SEM_CONTATO
  }

  const decisao = decidirContato(novo, (existentes ?? []) as ContatoExistente[])
  if (decisao.acao === 'nada') return SEM_CONTATO

  if (decisao.acao === 'inserir') {
    const { error } = await supabaseAdmin
      .from('contatos')
      .insert({ empresa_id: empresaId, ...decisao.contato, origem: ORIGEM_NF })
    if (error) {
      logger.error({ empresaId, erro: error.message }, 'Falha ao criar contato a partir da NF.')
      return SEM_CONTATO
    }
    return { criados: 1, completados: 0 }
  }

  const { error } = await supabaseAdmin.from('contatos').update(decisao.campos).eq('id', decisao.id)
  if (error) {
    logger.error({ empresaId, erro: error.message }, 'Falha ao completar contato da NF.')
    return SEM_CONTATO
  }
  return { criados: 0, completados: 1 }
}

export interface ResultadoBackfillContatos extends ContagemContatos {
  notas_examinadas: number
  pares_considerados: number
}

/**
 * Varre as notas já gravadas e materializa o que estiver no jsonb.
 *
 * Faz DISTINCT por (empresa, lado) em memória antes de ir ao banco: um fornecedor
 * com 40 notas manda o mesmo contato 40 vezes, e `decidirContato` resolveria as 39
 * repetições corretamente — só que pagando 39 leituras de `contatos`. O conjunto
 * abaixo troca isso por uma.
 */
export async function backfillContatosNf(limite = 5000): Promise<ResultadoBackfillContatos> {
  const { data: notas, error } = await supabaseAdmin
    .from('notas_fiscais')
    .select('fornecedor_empresa_id, contato_fornecedor, sacado_empresa_id, contato_sacado')
    .or('contato_fornecedor.not.is.null,contato_sacado.not.is.null')
    .order('sincronizada_em', { ascending: false, nullsFirst: false })
    .limit(limite)

  if (error) {
    logger.error({ erro: error.message }, 'Falha ao ler notas para o backfill de contatos.')
    return { notas_examinadas: 0, pares_considerados: 0, criados: 0, completados: 0 }
  }

  // Chave = empresa + identidade do contato. Duas pessoas diferentes na mesma
  // empresa continuam sendo dois pares; a mesma pessoa repetida vira um.
  const pares = new Map<string, { empresaId: string; payload: unknown }>()
  for (const n of notas ?? []) {
    for (const [empresaId, payload] of [
      [n.fornecedor_empresa_id, n.contato_fornecedor],
      [n.sacado_empresa_id, n.contato_sacado],
    ] as const) {
      if (!empresaId || !payload) continue
      const c = normalizarContatoNf(payload as Parameters<typeof normalizarContatoNf>[0])
      if (!c) continue
      pares.set(`${empresaId}|${c.email ?? ''}|${c.telefone ?? ''}`, { empresaId, payload })
    }
  }

  let acc: ContagemContatos = SEM_CONTATO
  for (const { empresaId, payload } of pares.values()) {
    acc = somarContatos(acc, await materializarContato(empresaId, payload))
  }

  const r = {
    notas_examinadas: notas?.length ?? 0,
    pares_considerados: pares.size,
    ...acc,
  }
  logger.info(r, 'Backfill de contatos da NF concluído.')
  return r
}
