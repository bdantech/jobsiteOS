import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { pool } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { lerPassivos } from '../../comercial/config.js'

/**
 * Quem parece ser conta passiva (04g §1) — e por que isto SUGERE em vez de decidir.
 *
 * O sinal é bom: um sacado cliente cujos fornecedores antecipam com frequência e que
 * não recebeu toque nenhum na janela está, de fato, operando sozinho. Mas "não recebeu
 * toque" é uma afirmação sobre o nosso REGISTRO, não sobre o mundo — uma conversa por
 * telefone que ninguém anotou aparece aqui como ausência. Marcar passivo sozinho
 * transformaria uma falha de registro em perda de comissão de alguém.
 *
 * Por isso o job notifica e para. Quem aceita é gente, pela ficha da empresa.
 */

export interface ResultadoSugestaoPassivos {
  candidatos: number
  ja_passivos: number
}

interface Candidato {
  empresa_id: string
  nome: string | null
  antecipacoes: number
  volume: number
}

export async function sugerirPassivosJob(): Promise<ResultadoSugestaoPassivos> {
  const cfg = await lerPassivos()

  const { rows } = await pool.query<Candidato>(
    `
    with janela as (select now() - ($1 || ' months')::interval as de),
    operando as (
      select a.sacado_cnpj as cnpj,
             count(*)::int as antecipacoes,
             coalesce(sum(a.gross_value), 0) as volume
      from antecipacoes a, janela j
      where a.convertida_em is not null
        and a.convertida_em >= j.de
        and a.regrediu_em is null
      group by 1
    )
    select e.id as empresa_id, e.razao_social as nome, o.antecipacoes, o.volume
    from operando o
    join empresas e on e.cnpj = o.cnpj
    where e.estagio = 'cliente'
      and o.antecipacoes >= $2
      -- Já é passivo: nada a sugerir.
      and coalesce(e.gestao_operacao, '') <> 'passivo'
      -- Toque nosso na janela derruba a hipótese. Qualquer evento com ator humano
      -- conta: se alguém trabalhou a conta, ela não está sozinha.
      and not exists (
        select 1 from empresa_eventos ev, janela j
        where ev.empresa_id = e.id and ev.ator_usuario_id is not null and ev.criado_em >= j.de
      )
    order by o.volume desc
  `,
    [String(cfg.janela_meses), cfg.min_antecipacoes],
  )

  for (const c of rows) {
    await emitirEvento(c.empresa_id, EVENTO_TIPOS.CLIENTE_GESTAO_ALTERADA, {
      titulo: 'Candidata a conta passiva',
      resumo:
        `${c.antecipacoes} antecipações em ${cfg.janela_meses} meses e nenhum toque nosso no período. ` +
        `Sugestão: marcar como PASSIVA e atribuir um gestor. A mudança é manual.`,
      url: `/empresas/${c.empresa_id}`,
      sugestao: 'passivo',
      antecipacoes: c.antecipacoes,
      volume: Number(c.volume),
    })
  }

  if (rows.length > 0) {
    await notificarPerfis(['Admin', 'Comercial'], {
      titulo: 'Candidatas a conta passiva',
      corpo: `${rows.length} cliente(s) antecipam sozinhos há ${cfg.janela_meses} meses. Revise e decida.`,
      url: '/empresas?tab=clientes',
    })
  }

  logger.info({ candidatos: rows.length }, 'Sugestão de contas passivas concluída.')
  return { candidatos: rows.length, ja_passivos: 0 }
}
