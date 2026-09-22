import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import {
  deduplicarFunil,
  type NotaParaDedup,
  type PreAuthParaDedup,
  type TituloParaDedup,
} from '../../../../../packages/core/src/funil/dedup.js'
import { lerConfigFunilOportunidades } from '../../funil/config.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'

/**
 * A DEDUPLICAÇÃO (04s §5), depois de cada sync.
 *
 * ── O QUE ELE FAZ E O QUE ELE NUNCA FAZ ─────────────────────────────────────
 * Escreve em `funil_ocultacoes`, em `funil_selos_preauth` e nas colunas
 * `origem_exibida` / `original_*` das duas tabelas novas. NADA É APAGADO: ocultar
 * é uma decisão da regra, regra erra, e o registro guarda o motivo e o original
 * para que "por que este card sumiu?" tenha resposta.
 *
 * ── POR QUE ELE RECOMPÕE TUDO, EM VEZ DE APLICAR DIFERENÇAS ─────────────────
 * Um item deixa de estar escondido por razões que não passam por ele: a NF que o
 * escondia foi cancelada, a parcela foi removida no ERP, a config trocou de
 * `titulo` para `nf`. Aplicar só o que mudou nesta corrida deixaria ocultações
 * órfãs — cards escondidos atrás de originais que não existem mais, invisíveis
 * para sempre e sem ninguém para notar. Recompor é barato e é a única forma
 * honesta de a ocultação ser reversível.
 *
 * ── A DECISÃO MORA NO CORE ──────────────────────────────────────────────────
 * Este arquivo carrega as três listas, chama `deduplicarFunil` e escreve o
 * resultado. É o que permite que os casos difíceis (título de matriz casando com
 * pré-auth de SPE, `billId` repetido entre conexões, ambiguidade) existam como
 * teste em vez de como suposição.
 */

export interface ResultadoDedup {
  notas: number
  pre_autorizacoes: number
  titulos: number
  ocultados: number
  reexibidos: number
  selos: number
  ambiguidades: number
  eventos: number
  prioridade: string
}

/**
 * As NFs candidatas: as VIVAS, e só as vivas.
 *
 * Uma nota convertida ou perdida não pode esconder uma pré-autorização — ela já
 * saiu do funil, e o card que ela escondesse sumiria atrás de um documento que
 * ninguém mais olha. `operavel is not false` pelo mesmo motivo: uma remessa não
 * esconde uma oferta de antecipação.
 */
async function notasVivas(): Promise<NotaParaDedup[]> {
  const { rows } = await pool.query<{
    access_key: string
    sacado_matriz_cnpj: string
    fornecedor_cnpj: string
    numero_normalizado: string | null
    valor: string | null
    vencimento: string | null
  }>(`
    select n.access_key,
           public.app__matriz_do_cnpj(n.sacado_cnpj) as sacado_matriz_cnpj,
           n.fornecedor_cnpj,
           -- O MESMO normalizador do 04e, escrito uma vez em SQL: os não-dígitos
           -- saem, os zeros à ESQUERDA saem, os zeros à direita FICAM (84 e 840 são
           -- notas diferentes). A assimetria é o que dá precisão ao casamento.
           nullif(ltrim(regexp_replace(coalesce(n.numero, ''), '\\D', '', 'g'), '0'), '')
             as numero_normalizado,
           n.valor::text as valor,
           n.vencimento::text as vencimento
      from public.notas_fiscais n
     where n.estagio_funil not in ('convertida', 'perdida')
       and n.situacao = 'valida'
       and coalesce(n.operavel_manual, n.operavel) is not false
  `)

  return rows.map((r) => ({
    access_key: r.access_key,
    sacado_matriz_cnpj: r.sacado_matriz_cnpj,
    fornecedor_cnpj: r.fornecedor_cnpj,
    numero_normalizado: r.numero_normalizado,
    valor: r.valor === null ? null : Number(r.valor),
    vencimento: r.vencimento,
  }))
}

async function preAutorizacoesVivas(): Promise<PreAuthParaDedup[]> {
  const { rows } = await pool.query<Omit<PreAuthParaDedup, 'valor'> & { valor: string }>(`
    select id_externo, origin, status, criada_em::text as criada_em,
           sacado_matriz_cnpj, fornecedor_cnpj, numero_normalizado,
           valor::text as valor, vencimento::text as vencimento,
           sienge_bill_id, sienge_installment_id
      from public.pre_autorizacoes
     where estagio_funil not in ('convertida', 'perdida')
  `)
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }))
}

async function titulosVivos(): Promise<TituloParaDedup[]> {
  const { rows } = await pool.query<TituloParaDedup>(`
    select id_externo, connection_id, bill_id, installment_id,
           bill_access_key, nfe_candidate_access_key, pre_autorizacao_id_externo
      from public.sienge_titulos
     where estagio_funil not in ('convertida', 'perdida')
  `)
  return rows
}

export async function deduplicarOportunidades(): Promise<ResultadoDedup> {
  const cfg = await lerConfigFunilOportunidades()
  const [notas, preAutorizacoes, titulos] = await Promise.all([
    notasVivas(),
    preAutorizacoesVivas(),
    titulosVivos(),
  ])

  const r = deduplicarFunil({ notas, preAutorizacoes, titulos }, cfg.prioridade_nf_vs_titulo)

  const acc: ResultadoDedup = {
    notas: notas.length,
    pre_autorizacoes: preAutorizacoes.length,
    titulos: titulos.length,
    ocultados: r.ocultacoes.length,
    reexibidos: 0,
    selos: r.selos.length,
    ambiguidades: r.ambiguidades.length,
    eventos: 0,
    prioridade: cfg.prioridade_nf_vs_titulo,
  }

  const cliente = await pool.connect()
  try {
    await cliente.query('begin')

    // Quem ESTAVA escondido e não está mais — para o evento e para a contagem. A
    // pergunta tem de ser feita antes da reescrita.
    const { rows: antes } = await cliente.query<{ tipo: string; referencia_id: string }>(
      'select tipo, referencia_id from public.funil_ocultacoes',
    )

    await cliente.query('truncate public.funil_ocultacoes')
    await cliente.query('truncate public.funil_selos_preauth')

    if (r.ocultacoes.length > 0) {
      await cliente.query(
        `insert into public.funil_ocultacoes (tipo, referencia_id, motivo, original_tipo, original_id)
         select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [
          r.ocultacoes.map((o) => o.tipo),
          r.ocultacoes.map((o) => o.referencia_id),
          r.ocultacoes.map((o) => o.motivo),
          r.ocultacoes.map((o) => o.original_tipo),
          r.ocultacoes.map((o) => o.original_id),
        ],
      )
    }

    if (r.selos.length > 0) {
      await cliente.query(
        `insert into public.funil_selos_preauth (tipo, referencia_id, pre_autorizacao_id, status, criada_em)
         select * from unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::timestamptz[])
         on conflict (tipo, referencia_id, pre_autorizacao_id) do update
           set status = excluded.status, atualizado_em = now()`,
        [
          r.selos.map((s) => s.tipo),
          r.selos.map((s) => s.referencia_id),
          r.selos.map((s) => s.pre_autorizacao_id),
          r.selos.map((s) => s.status),
          r.selos.map((s) => s.criada_em),
        ],
      )
    }

    /*
     * `origem_exibida` nas tabelas espelha `funil_ocultacoes`, e isso é redundância
     * DE PROPÓSITO. A view filtra pelos dois; a coluna existe para que uma consulta
     * direta à tabela — um relatório, uma conferência no SQL, o próximo job — veja a
     * mesma verdade sem precisar conhecer a tabela lateral.
     *
     * ── DUAS INSTRUÇÕES POR TABELA, E NÃO UMA ───────────────────────────────
     * A versão anterior fazia `update ... from (select 1) _ left join
     * funil_ocultacoes o on o.referencia_id = pa.id_externo::text`, e isso é SQL
     * inválido: o PostgreSQL recusa referenciar a tabela ALVO do update dentro do
     * `ON` de um join no `FROM` ("invalid reference to FROM-clause entry").
     *
     * Ele estourava aqui, depois de já ter calculado tudo e inserido as ocultações —
     * o `rollback` desfazia a transação inteira e a dedup terminava com zero. Nada
     * ficava pela metade (a transação existe para isso), mas 92 pares vivos ficaram
     * sem deduplicar e o erro só apareceria no `meta` de uma corrente que leva uma
     * hora para fechar.
     *
     * Separar em "quem está escondido" e "quem deixou de estar" é mais longo e diz
     * em voz alta o que cada metade faz — inclusive a segunda, que é a que devolve
     * um card à tela quando a regra muda de ideia.
     */
    const marcar = async (tabela: string, tipo: string, chave: string) => {
      await cliente.query(
        `update public.${tabela} t
            set origem_exibida = false,
                original_tipo = o.original_tipo,
                original_id = o.original_id
           from public.funil_ocultacoes o
          where o.tipo = $1
            and o.referencia_id = t.${chave}::text
            and (t.origem_exibida
                 or t.original_tipo is distinct from o.original_tipo
                 or t.original_id is distinct from o.original_id)`,
        [tipo],
      )

      // E quem saiu da lista volta a aparecer. Sem esta metade, um item escondido
      // ontem por uma regra que mudou ficaria invisível para sempre.
      await cliente.query(
        `update public.${tabela} t
            set origem_exibida = true, original_tipo = null, original_id = null
          where not t.origem_exibida
            and not exists (select 1 from public.funil_ocultacoes o
                             where o.tipo = $1 and o.referencia_id = t.${chave}::text)`,
        [tipo],
      )
    }

    await marcar('pre_autorizacoes', 'pre_autorizacao', 'id_externo')
    await marcar('sienge_titulos', 'titulo', 'id_externo')

    await cliente.query('commit')

    const agora = new Set(r.ocultacoes.map((o) => `${o.tipo}:${o.referencia_id}`))
    acc.reexibidos = antes.filter((a) => !agora.has(`${a.tipo}:${a.referencia_id}`)).length
  } catch (erro) {
    await cliente.query('rollback').catch(() => undefined)
    throw erro
  } finally {
    cliente.release()
  }

  /*
   * O evento de ocultação é SÓ para a NF, e só quando ela é escondida por um
   * título. É a única ocultação que tira da vista um card que alguém pode estar
   * trabalhando agora — as outras duas escondem itens que acabaram de nascer.
   */
  acc.eventos = await avisarNotasOcultadas(r.ocultacoes)

  if (r.ambiguidades.length > 0) {
    logger.warn(
      { casos: r.ambiguidades.slice(0, 20), total: r.ambiguidades.length },
      'Deduplicação ambígua: ninguém foi escondido, os dois lados seguem visíveis.',
    )
  }

  logger.info(acc, 'Deduplicação do funil concluída.')
  return acc
}

async function avisarNotasOcultadas(
  ocultacoes: readonly { tipo: string; referencia_id: string; original_tipo: string; original_id: string }[],
): Promise<number> {
  const daNf = ocultacoes.filter((o) => o.tipo === 'nf')
  if (daNf.length === 0) return 0

  const { data } = await supabaseAdmin
    .from('notas_fiscais')
    .select('access_key, numero, valor, fornecedor_empresa_id, fornecedor_nome')
    .in('access_key', daNf.map((o) => o.referencia_id).slice(0, 500))

  let n = 0
  for (const o of daNf) {
    const nota = (data ?? []).find((x) => x.access_key === o.referencia_id)
    if (!nota?.fornecedor_empresa_id) continue

    // Já avisamos desta nota? A dedup recompõe tudo a cada corrida, e sem esta
    // guarda a mesma nota geraria um evento a cada 4 horas, para sempre.
    const { data: jaTem } = await supabaseAdmin
      .from('empresa_eventos')
      .select('id')
      .eq('empresa_id', nota.fornecedor_empresa_id)
      .eq('tipo', EVENTO_TIPOS.FUNIL_ITEM_OCULTADO)
      .contains('payload', { access_key: o.referencia_id } as never)
      .limit(1)
      .maybeSingle()
    if (jaTem) continue

    await emitirEvento(nota.fornecedor_empresa_id, EVENTO_TIPOS.FUNIL_ITEM_OCULTADO, {
      titulo: 'Nota substituída pela parcela do ERP',
      resumo:
        `${nota.fornecedor_nome ?? ''}: a nota ${nota.numero ?? o.referencia_id} saiu do funil porque ` +
        `o mesmo recebível chegou pela conexão Sienge da construtora, parcela a parcela.`,
      url: `/antecipacao?oportunidade=titulo:${o.original_id}`,
      access_key: o.referencia_id,
      original_tipo: o.original_tipo,
      original_id: o.original_id,
    })
    n++
  }
  return n
}
