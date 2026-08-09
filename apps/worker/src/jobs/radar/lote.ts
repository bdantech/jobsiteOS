import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { compileToSql, type Grupo } from '../../../../../packages/core/src/mercado/filters.js'
import type { Json, Tables } from '../../../../../packages/core/src/types/database.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { lerOrcamento, lerTtl, type TtlDias } from '../../radar/config.js'
import { emitirEvento, notificarPerfis } from '../../radar/eventos.js'
import { estadoOrcamento } from '../../radar/orcamento.js'
import { todasAsPaginas } from '../../paginar.js'
import { atualizarItem, registrarEnriquecimento } from '../../radar/persist.js'

/**
 * Harness de execução de lote (§6.3), compartilhado por domínio/contatos/protestos.
 *
 * Materializa os itens a partir do filtro (compileToSql sobre mercado_explorador,
 * excluindo por TTL — não paga de novo por quem foi enriquecido dentro do prazo),
 * processa item a item com throttle, grava CADA tentativa em `enriquecimentos`
 * (inclusive sem_dados — cache negativo) e reconcilia o custo real no lote.
 */

/** Status de enriquecimento gravável (o check de `enriquecimentos`). */
export type ResultadoTipo = 'sucesso' | 'sem_dados' | 'erro' | 'aguardando_webhook'

export interface ResultadoItem {
  // 'pulado' NÃO gera linha em enriquecimentos (nenhuma tentativa/custo) — ex.: item
  // sem domínio, ou domínio já enriquecido (dedup por domínio no Apollo).
  status: ResultadoTipo | 'pulado'
  fonte: string
  custo?: number
  resultado?: unknown
  unidades?: number
  erro?: string
}

export type ProcessarItem = (item: Tables<'lote_itens'>) => Promise<ResultadoItem>

/** Colunas de TTL por tipo de enriquecimento (dias de sucesso / dias de sem_dados). */
function janelaTtl(tipo: string, ttl: TtlDias): { sucesso: number; semDados: number } {
  if (tipo === 'dominio') return { sucesso: ttl.dominio, semDados: ttl.dominio_sem_dados }
  if (tipo === 'contatos') return { sucesso: ttl.contatos, semDados: ttl.contatos_sem_dados }
  // Headcount não custa crédito de revelação, mas custa rate limit e ruído na série:
  // reconsultar toda semana encheria `empresa_metricas` de pontos idênticos e
  // arruinaria a leitura de crescimento, que é o que a série existe para dar.
  if (tipo === 'funcionarios') return { sucesso: ttl.funcionarios, semDados: ttl.funcionarios }
  // protestos de prospecção (o mensal de clientes tem sua própria rotina, §5)
  return { sucesso: ttl.protestos_prospeccao, semDados: ttl.protestos_prospeccao }
}

async function materializarItens(lote: Tables<'lotes_enriquecimento'>): Promise<number> {
  const { count } = await supabaseAdmin
    .from('lote_itens')
    .select('id', { count: 'exact', head: true })
    .eq('lote_id', lote.id)
  if ((count ?? 0) > 0) return count ?? 0 // já materializado (re-execução)

  const ttl = await lerTtl()
  const orc = await lerOrcamento()
  const janela = janelaTtl(lote.tipo, ttl)
  const { text, values } = compileToSql(lote.definicao_filtro as unknown as Grupo, new Date())

  // lote.id (uuid do nosso banco), lote.tipo (enum checado) e os inteiros de TTL/limite
  // são seguros para interpolar; o filtro do usuário vai por placeholders ($1..$n).
  const sql = `
    insert into lote_itens (lote_id, cnpj, dominio, empresa_id)
    select '${lote.id}'::uuid, m.cnpj, m.dominio, m.empresa_id
    from mercado_explorador m
    where (${text})
      and not exists (
        select 1 from enriquecimentos e
        where e.cnpj = m.cnpj and e.tipo = '${lote.tipo}'
          and (
            (e.status = 'sucesso'   and e.executado_em > now() - interval '${janela.sucesso} days')
            or (e.status = 'sem_dados' and e.executado_em > now() - interval '${janela.semDados} days')
          )
      )
    limit ${orc.max_itens_por_lote}`

  // compileToSql aliasa colunas sem prefixo; a view foi aliasada como m acima, mas o
  // texto do filtro usa nomes nus (uf = $1). Como só há uma tabela no FROM, resolvem
  // para m. (Mesma premissa do reclassificar.)
  const res = await pool.query(sql, values)
  return res.rowCount ?? 0
}

export async function executarLote(loteId: string, processar: ProcessarItem): Promise<{
  processados: number
  custo: number
}> {
  const { data: lote, error } = await supabaseAdmin
    .from('lotes_enriquecimento')
    .select('*')
    .eq('id', loteId)
    .single()
  if (error || !lote) throw new Error(`Lote ${loteId} não encontrado: ${error?.message}`)

  await supabaseAdmin.from('lotes_enriquecimento').update({ status: 'executando' }).eq('id', loteId)

  try {
    const total = await materializarItens(lote)

    // `total_itens` vinha da ESTIMATIVA feita na tela, antes do TTL entrar na conta.
    // Guardar aqui o número real materializado é o que faz "992 de 1.614" ser uma
    // frase verificável em vez de duas contagens que quase batem.
    await supabaseAdmin.from('lotes_enriquecimento').update({ total_itens: total }).eq('id', loteId)
    logger.info({ loteId, tipo: lote.tipo, total }, 'Lote materializado; processando itens.')

    /*
     * Paginado, e isto é uma cicatriz: um `.select()` sem paginação volta no máximo
     * `db-max-rows` linhas (mil, no padrão do Supabase) SEM ERRO NENHUM. Um lote de
     * 1.614 domínios processou exatamente 1.000, marcou-se como concluído e deixou 614
     * pendentes — invisíveis, porque um lote concluído não tem botão de executar.
     */
    const itens = await todasAsPaginas<Tables<'lote_itens'>>((de, ate) =>
      supabaseAdmin
        .from('lote_itens')
        .select('*')
        .eq('lote_id', loteId)
        .eq('status', 'pendente')
        // Ordem estável: sem ela, duas páginas podem repetir ou pular linhas.
        .order('id', { ascending: true })
        .range(de, ate),
    )

    let custo = 0
    let processados = 0
    let alertou = false

    for (const item of itens) {
      // Teto de orçamento: bloqueia ANTES de gastar mais (§6.2).
      const orc = await estadoOrcamento(custo)
      if (orc.estourou) {
        logger.warn({ loteId, gasto: orc.gasto, teto: orc.teto }, 'Teto de orçamento atingido; interrompendo lote.')
        const msg = `Lote interrompido: gasto do mês atingiu o teto (R$ ${orc.teto}).`
        await emitirEvento(null, EVENTO_TIPOS.ORCAMENTO_ESTOURADO, {
          titulo: 'Orçamento estourado', resumo: msg, url: `/radar/lotes/${loteId}`,
        })
        await notificarPerfis(['Admin'], { titulo: 'Orçamento estourado', corpo: msg, url: `/radar/lotes/${loteId}` })
        break
      }
      // Alerta (ex.: 80% do teto): uma vez por corrida.
      if (orc.alerta && !alertou) {
        alertou = true
        await emitirEvento(null, EVENTO_TIPOS.ORCAMENTO_ALERTA, {
          titulo: 'Orçamento em alerta',
          resumo: `Gasto do mês em ${Math.round((orc.gasto / (orc.teto || 1)) * 100)}% do teto (R$ ${orc.teto}).`,
          url: `/radar/lotes/${loteId}`,
        })
      }

      await atualizarItem(item.id, { status: 'processando' })
      let r: ResultadoItem
      try {
        r = await processar(item)
      } catch (e) {
        r = { status: 'erro', fonte: lote.tipo, erro: String(e) }
      }

      // 'pulado': nenhuma tentativa/custo — só marca o item e segue (sem enriquecimento).
      if (r.status === 'pulado') {
        await atualizarItem(item.id, { status: 'pulado', erro: r.erro ?? null })
        processados++
        continue
      }

      await registrarEnriquecimento({
        tipo: lote.tipo,
        fonte: r.fonte,
        empresa_id: item.empresa_id,
        cnpj: item.cnpj,
        dominio: item.dominio,
        lote_id: loteId,
        status: r.status,
        custo_real: r.custo ?? 0,
        unidades_retornadas: r.unidades ?? null,
        payload: (r.resultado ?? null) as Json,
        erro: r.erro ?? null,
      })
      await atualizarItem(item.id, {
        status: r.status,
        custo_real: r.custo ?? 0,
        resultado: (r.resultado ?? null) as Json,
        erro: r.erro ?? null,
      })

      custo += r.custo ?? 0
      processados++
    }

    /*
     * Sobrou pendente? Então NÃO acabou, e dizer que acabou é a pior parte do bug
     * antigo: o número errado alguém confere, mas um lote marcado como concluído
     * ninguém volta a olhar. `interrompido` é re-executável pela tela e retoma de onde
     * parou — os itens já processados não voltam para a fila.
     *
     * O caminho normal para isto é o teto de orçamento, que corta no meio de propósito.
     */
    const { count: pendentes } = await supabaseAdmin
      .from('lote_itens')
      .select('id', { count: 'exact', head: true })
      .eq('lote_id', loteId)
      .eq('status', 'pendente')

    const restaram = pendentes ?? 0
    const concluiu = restaram === 0

    await supabaseAdmin
      .from('lotes_enriquecimento')
      .update({
        status: concluiu ? 'concluido' : 'interrompido',
        concluido_em: concluiu ? new Date().toISOString() : null,
        custo_real: custo,
      })
      .eq('id', loteId)

    await emitirEvento(null, EVENTO_TIPOS.LOTE_CONCLUIDO, {
      titulo: concluiu ? 'Lote concluído' : 'Lote interrompido',
      resumo: concluiu
        ? `${processados} itens processados — custo real R$ ${custo.toFixed(2)}.`
        : `${processados} itens processados, ${restaram} ainda pendentes — custo real R$ ${custo.toFixed(2)}. Execute o lote de novo para retomar.`,
      url: `/radar/lotes/${loteId}`,
    })

    logger.info({ loteId, processados, restaram, custo }, concluiu ? 'Lote concluído.' : 'Lote interrompido.')
    return { processados, custo }
  } catch (e) {
    await supabaseAdmin.from('lotes_enriquecimento').update({ status: 'falhou' }).eq('id', loteId)
    throw e
  }
}
