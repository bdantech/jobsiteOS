import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'

/**
 * O DIGEST DIÁRIO DE CADA AGENTE (Prompt 09 §13) — 18h de São Paulo.
 *
 * O que fez, o que conseguiu, quanto custou e o que planeja. É o relatório que um gestor
 * lê em trinta segundos para decidir se o agente continua — por isso números, não prosa:
 * um parágrafo gerado por modelo sobre o próprio dia do modelo é a última coisa que se
 * quer auditar.
 */

interface LinhaDigest {
  agente_id: string
  nome: string
  closer_usuario: string | null
  acoes: number
  mensagens: number
  ligacoes: number
  reunioes: number
  concluidos: number
  encerrados: number
  escalados: number
  custo_centavos: number
  ativos: number
  proximas_24h: number
}

export async function digestDosAgentes(): Promise<{ agentes: number }> {
  const { rows } = await pool.query<LinhaDigest>(
    `with hoje as (
       select (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as inicio
     )
     select v.id as agente_id, v.nome,
            (select c.usuario_id from vendedores c where c.id = v.closer_id) as closer_usuario,
            (select count(*)::int from mandato_acoes a, hoje where a.agente_id = v.id and a.executada_em >= hoje.inicio and a.ferramenta <> 'ciclo') as acoes,
            (select count(*)::int from mandato_acoes a, hoje where a.agente_id = v.id and a.executada_em >= hoje.inicio and a.sucesso
                and a.ferramenta in ('enviar_whatsapp', 'enviar_email', 'enviar_material')) as mensagens,
            (select count(*)::int from mandato_acoes a, hoje where a.agente_id = v.id and a.executada_em >= hoje.inicio and a.sucesso and a.ferramenta = 'ligar') as ligacoes,
            (select count(*)::int from mandato_acoes a, hoje where a.agente_id = v.id and a.executada_em >= hoje.inicio and a.sucesso and a.ferramenta = 'agendar_reuniao') as reunioes,
            (select count(*)::int from mandatos m, hoje where m.agente_id = v.id and m.encerrado_em >= hoje.inicio and m.estado = 'concluido') as concluidos,
            (select count(*)::int from mandatos m, hoje where m.agente_id = v.id and m.encerrado_em >= hoje.inicio and m.estado = 'encerrado_sem_sucesso') as encerrados,
            (select count(*)::int from mandatos m, hoje where m.agente_id = v.id and m.encerrado_em >= hoje.inicio and m.estado = 'escalado') as escalados,
            (select coalesce(sum(o.valor_centavos), 0)::int from agentes_orcamento_movimentos o, hoje
              where o.agente_id = v.id and o.tipo = 'consumo' and o.criado_em >= hoje.inicio) as custo_centavos,
            (select count(*)::int from mandatos m where m.agente_id = v.id and m.estado in ('aberto','em_andamento','aguardando_externo')) as ativos,
            (select count(*)::int from mandatos m where m.agente_id = v.id and m.estado in ('aberto','em_andamento','aguardando_externo')
                and m.proxima_acao_em < now() + interval '24 hours') as proximas_24h
       from vendedores v
      where v.is_ia and v.ativo`,
  )

  for (const d of rows) {
    // Dia sem nada e sem nada planejado não vira aviso: silêncio também é informação, e
    // um digest vazio todo dia ensina a ignorar o digest.
    if (d.acoes === 0 && d.ativos === 0) continue
    const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const { error } = await supabaseAdmin.from('empresa_eventos').insert({
      empresa_id: null,
      tipo: 'agentes.digest',
      payload: {
        titulo: `${d.nome}: o dia em números`,
        resumo:
          `Fez ${d.acoes} ações (${d.mensagens} mensagens, ${d.ligacoes} ligações). ` +
          `Conseguiu: ${d.reunioes} reuniões marcadas, ${d.concluidos} mandatos concluídos` +
          `${d.escalados ? `, ${d.escalados} escalados para humano` : ''}${d.encerrados ? `, ${d.encerrados} encerrados sem sucesso` : ''}. ` +
          `Custou ${brl(d.custo_centavos)}. Amanhã: ${d.proximas_24h} dos ${d.ativos} mandatos ativos têm ação nas próximas 24h.`,
        url: '/agentes/desempenho',
        agente_id: d.agente_id,
        numeros: d,
        destinatarios: d.closer_usuario ? [d.closer_usuario] : [],
      } as never,
    })
    if (error) logger.error({ agente: d.agente_id, erro: error.message }, 'Falha ao gravar o digest do agente.')
  }
  return { agentes: rows.length }
}
