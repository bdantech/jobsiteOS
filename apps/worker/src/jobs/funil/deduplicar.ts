import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { ESTAGIOS_ENCERRADOS } from '../../../../../packages/core/src/antecipacao/schemas.js'
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

/**
 * `('convertida', 'perdida', 'expirada')` a partir da constante do core.
 *
 * Interpolar é seguro aqui e só aqui: a fonte é uma constante literal do core, nunca
 * entrada de ninguém. Parametrizar custaria um `= any($1)` que o planner trata pior
 * do que a lista, e a alternativa real — reescrever os três estágios à mão em cada
 * consulta — é exatamente o que deixou `expirada` de fora.
 */
const SQL_ENCERRADOS = ESTAGIOS_ENCERRADOS.map((e) => `'${e}'`).join(', ')

export interface ResultadoDedup {
  notas: number
  pre_autorizacoes: number
  titulos: number
  ocultados: number
  reexibidos: number
  selos: number
  ambiguidades: number
  /** Parcelas que a oferta encerrou nesta corrida. */
  encerradas: number
  eventos: number
  prioridade: string
}

/**
 * As NFs candidatas: as VIVAS, e só as vivas.
 *
 * Uma nota encerrada não pode esconder uma pré-autorização — ela já saiu do funil,
 * e o card que ela escondesse sumiria atrás de um documento que ninguém mais olha.
 * `operavel is not false` pelo mesmo motivo: uma remessa não esconde uma oferta de
 * antecipação.
 *
 * ── `ESTAGIOS_ENCERRADOS`, E NÃO A LISTA ESCRITA À MÃO ──────────────────────
 * A primeira versão desta consulta escrevia `('convertida', 'perdida')` e esquecia
 * `expirada`. A regra acima estava certa e a lista não a cumpria: medido em
 * 23/09/2026, 22 pré-autorizações em `a_prospectar` escondidas atrás de um original
 * EXPIRADO — 20 títulos e 2 NFs. O card saía das colunas abertas do Kanban e
 * reaparecia em Encerradas, que é o único lugar onde ninguém ia procurá-lo.
 *
 * Por isso a constante, e não a enumeração: ela é a mesma que o Kanban usa para
 * decidir o que é coluna aberta, então "saiu do funil" passa a ter UMA definição.
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
     where n.estagio_funil not in (${SQL_ENCERRADOS})
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

/**
 * As pré-autorizações — TODAS, e o estágio vai junto em vez de virar `where`.
 *
 * Duas razões para não filtrar aqui, e as duas são de papel:
 *
 *   como CARD (contra a parcela) .... a oferta ganha sempre, inclusive encerrada —
 *       é ela que encerra a parcela. Filtrar as encerradas tiraria da lista
 *       exatamente as ofertas que precisam manter a parcela escondida, e a parcela
 *       reapareceria como prospecção nova na recomposição seguinte.
 *   como ESCONDIDA (contra a NF) .... uma oferta expirada atrás de uma nota aberta é
 *       o caso CERTO: o card que fica é a nota, e é nela que o selo pousa.
 *
 * Quem decide por papel é `deduplicarFunil`, onde os dois casos têm teste.
 */
async function carregarPreAutorizacoes(): Promise<PreAuthParaDedup[]> {
  const { rows } = await pool.query<Omit<PreAuthParaDedup, 'valor'> & { valor: string }>(`
    select id_externo, origin, status, criada_em::text as criada_em,
           sacado_matriz_cnpj, fornecedor_cnpj, numero_normalizado,
           valor::text as valor, vencimento::text as vencimento,
           sienge_bill_id, sienge_installment_id,
           estagio_funil, perda_motivo
      from public.pre_autorizacoes
  `)
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }))
}

/**
 * As parcelas — TODAS, pelo mesmo motivo de papel, e o `where` que estava aqui virou
 * a guarda de `ENCERRADOS` dentro de `deduplicarFunil`.
 *
 * A parcela encerrada continua tendo de aparecer na lista para seguir escondida
 * atrás da oferta que a encerrou; o que ela NÃO pode é esconder uma NF aberta, e
 * essa é a regra da 0254, agora com teste no core em vez de um `where` sem teste.
 */
async function carregarTitulos(): Promise<TituloParaDedup[]> {
  const { rows } = await pool.query<TituloParaDedup>(`
    select id_externo, connection_id, bill_id, installment_id,
           bill_access_key, nfe_candidate_access_key, pre_autorizacao_id_externo,
           estagio_funil
      from public.sienge_titulos
  `)
  return rows
}

export async function deduplicarOportunidades(): Promise<ResultadoDedup> {
  const cfg = await lerConfigFunilOportunidades()
  const [notas, preAutorizacoes, titulos] = await Promise.all([
    notasVivas(),
    carregarPreAutorizacoes(),
    carregarTitulos(),
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
    encerradas: 0,
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

    /*
     * A PARCELA HERDA O ENCERRAMENTO DA OFERTA — e este é o único lugar onde a dedup
     * escreve `estagio_funil`.
     *
     * Ocultar sozinho não bastaria: a parcela ficaria escondida com `a_prospectar`
     * gravado, e todo relatório que lê `sienge_titulos` direto continuaria contando
     * uma parcela aberta que não está. Pior, `reclassificar` e o sync a tratariam
     * como trabalho a fazer.
     *
     * `is distinct from` na guarda porque isto roda a cada corrida: sem ela, o
     * `estagio_alterado_em` de toda parcela encerrada seria reescrito de hora em
     * hora, e "quando isto encerrou?" perderia a resposta.
     */
    if (r.encerramentos.length > 0) {
      const { rowCount } = await cliente.query(
        `update public.sienge_titulos t
            set estagio_funil = e.estagio,
                estagio_alterado_em = now(),
                perda_motivo = coalesce(e.perda_motivo, t.perda_motivo)
           from unnest($1::int[], $2::text[], $3::text[]) as e(id, estagio, perda_motivo)
          where t.id_externo = e.id
            and t.estagio_funil is distinct from e.estagio`,
        [
          r.encerramentos.map((e) => Number(e.referencia_id)),
          r.encerramentos.map((e) => e.estagio),
          r.encerramentos.map((e) => e.perda_motivo),
        ],
      )
      acc.encerradas = rowCount ?? 0
    }

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
