import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { entraNoFunil } from '../../../../../packages/core/src/fornecedores/municao.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerCorteVolume } from './config.js'

/**
 * Alimentação do funil (04l §3). Roda depois de cada sync de NF.
 *
 * ─── ENTRADA AUTOMÁTICA, SEM CURADORIA ───────────────────────────────────────
 *
 * Ninguém aprova quem entra: quem passa do corte de volume entra. A curadoria
 * manual seria o gargalo que mata o funil — 688 fornecedores é mais do que qualquer
 * gestor revisa, e a revisão não acrescentaria nada que o volume já não diga.
 *
 * ─── A MUNIÇÃO É RECALCULADA; O ESTADO NÃO ───────────────────────────────────
 *
 * Volume, prazo, sacados e potencial são derivados das notas e se sobrescrevem toda
 * rodada. Estágio, dono e contatos descobertos são estado humano e nunca são tocados
 * aqui — a única exceção é a saída automática por cadastro, que é fato observado.
 *
 * ─── POR QUE SQL, E NÃO 688 IDAS AO BANCO ────────────────────────────────────
 *
 * A munição de todos os fornecedores sai de UMA consulta agregada sobre `notas_funil`.
 * A alternativa — puxar as notas de cada fornecedor e agregar em TypeScript — faria
 * 688 round-trips para calcular somas que o Postgres faz num scan. `calcularMunicao`
 * continua sendo a fonte da regra (e o que os testes provam); aqui ela é aplicada
 * só onde o SQL não alcança sem ficar ilegível.
 */

interface LinhaAgregada {
  fornecedor_cnpj: string
  empresa_id: string | null
  volume_90d: string | number
  qtd_nfs_90d: number
  prazo_medio_dias: number | null
  potencial_mensal: string | number
  ultima_nf_em: string | null
  sacados_principais: unknown
  originador_id: string | null
  cadastrado: boolean
}

/**
 * A janela de 180 dias decide quem é CANDIDATO; a de 90, quanto ele vale.
 *
 * São duas perguntas diferentes. Fornecedor que emitiu forte até três meses atrás e
 * parou continua sendo um lead — a relação com o sacado existe. Mas o volume dele
 * hoje é zero, e ordenar a lista por um volume antigo premiaria justamente o passado.
 */
const SQL_MUNICAO = `
with notas as (
  select
    f.fornecedor_cnpj,
    f.fornecedor_empresa_id,
    f.sacado_cnpj,
    f.sacado_nome,
    f.valor,
    f.emitida_em,
    f.vencimento,
    f.fornecedor_cadastrado
  from public.notas_funil f
  where f.sacado_cadastrado
    and f.emitida_em >= now() - interval '180 days'
),
por_fornecedor as (
  select
    n.fornecedor_cnpj,
    (array_agg(n.fornecedor_empresa_id) filter (where n.fornecedor_empresa_id is not null))[1] as empresa_id,
    coalesce(sum(n.valor) filter (where n.emitida_em >= now() - interval '90 days'), 0) as volume_90d,
    count(*) filter (where n.emitida_em >= now() - interval '90 days')::int as qtd_nfs_90d,
    max(n.emitida_em)::date as ultima_nf_em,
    /*
     * Prazo médio PONDERADO POR VALOR. Uma nota de R$ 500 a 7 dias e uma de R$ 500
     * mil a 90 não têm o mesmo peso na decisão de quem vai operar essa carteira, e a
     * média simples trata as duas igual.
     */
    (
      -- "date - date" já é INTEIRO de dias em Postgres, não intervalo: um
      -- "extract(day from ...)" aqui não compila.
      sum((n.vencimento - n.emitida_em::date) * n.valor) filter (
        where n.emitida_em >= now() - interval '90 days'
          and n.vencimento is not null
          and n.vencimento >= n.emitida_em::date
          and n.vencimento <= n.emitida_em::date + 365
      )
      / nullif(
        sum(n.valor) filter (
          where n.emitida_em >= now() - interval '90 days'
            and n.vencimento is not null
            and n.vencimento >= n.emitida_em::date
            and n.vencimento <= n.emitida_em::date + 365
        ), 0
      )
    )::int as prazo_medio_dias,
    /*
     * O "não cadastrado" é decidido no GRUPO, não na linha (a mesma cicatriz de
     * 0101): dois CNPJs aparecem com "fornecedor_cadastrado" true numa nota e false
     * noutra, porque o flag vem do endpoint por nota. Uma nota cadastrada elimina o
     * CNPJ inteiro.
     */
    bool_or(n.fornecedor_cadastrado) as cadastrado
  from notas n
  group by n.fornecedor_cnpj
),
sacados as (
  /*
   * "select distinct" no lado esquerdo, e ele é load-bearing: o LATERAL roda uma vez
   * por LINHA da esquerda. Com "from notas n" ele rodava uma vez por NOTA, e o card
   * de um fornecedor com 16 notas trazia a mesma lista de top-5 dezesseis vezes
   * seguidas. A consulta não erra nem fica lenta o bastante para chamar atenção —
   * ela só devolve 80 sacados onde deveria devolver 5.
   */
  select
    n.fornecedor_cnpj,
    jsonb_agg(
      jsonb_build_object('cnpj', s.sacado_cnpj, 'nome', s.nome, 'valor', s.valor, 'notas', s.notas)
      order by s.valor desc
    ) as principais
  from (select distinct fornecedor_cnpj from notas) n
    join lateral (
      select n2.sacado_cnpj, max(n2.sacado_nome) as nome, sum(n2.valor) as valor, count(*)::int as notas
      from notas n2
      where n2.fornecedor_cnpj = n.fornecedor_cnpj
        and n2.emitida_em >= now() - interval '90 days'
      group by n2.sacado_cnpj
      order by sum(n2.valor) desc
      limit 5
    ) s on true
  group by n.fornecedor_cnpj
),
/*
 * O ORIGINADOR vem do SACADO contra o qual ele mais fatura (04l §1: "os sacados
 * vinculados a ele", carteira de originação das settings). O desempate é o volume
 * porque é a porta de entrada mais forte da abordagem: quem trabalha a construtora
 * de R$ 900 mil tem mais o que dizer do que quem trabalha a de R$ 30 mil.
 */
dono as (
  select distinct on (n.fornecedor_cnpj)
    n.fornecedor_cnpj,
    c.vendedor_id as originador_id
  from notas n
    join public.empresas e on e.cnpj = n.sacado_cnpj
    join public.vendedor_carteira c
      on c.empresa_id = e.id and c.papel = 'originacao' and c.ate is null
  where n.emitida_em >= now() - interval '90 days'
  group by n.fornecedor_cnpj, c.vendedor_id
  order by n.fornecedor_cnpj, sum(n.valor) desc
)
select
  p.fornecedor_cnpj, p.empresa_id, p.volume_90d, p.qtd_nfs_90d, p.prazo_medio_dias,
  round(p.volume_90d / 3, 2) as potencial_mensal,
  p.ultima_nf_em, p.cadastrado,
  coalesce(s.principais, '[]'::jsonb) as sacados_principais,
  d.originador_id
from por_fornecedor p
  left join sacados s on s.fornecedor_cnpj = p.fornecedor_cnpj
  left join dono d on d.fornecedor_cnpj = p.fornecedor_cnpj`

export interface ResultadoAtualizarFunil {
  candidatos: number
  entraram: number
  atualizados: number
  cadastrados: number
}

export async function atualizarFunilFornecedores(): Promise<ResultadoAtualizarFunil> {
  const corte = await lerCorteVolume()
  const { rows } = await pool.query<LinhaAgregada>(SQL_MUNICAO)

  const { data: existentes, error } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('fornecedor_cnpj, estagio, originador_id, originador_origem')
  if (error) throw new Error(`Falha ao ler o funil: ${error.message}`)

  const noFunil = new Map(existentes?.map((f) => [f.fornecedor_cnpj, f]) ?? [])

  /*
   * A supressão vigente é consultada ANTES de qualquer entrada. Um fornecedor que
   * disse "não me procurem" e voltou a faturar continua dizendo não — reabrir o card
   * porque o volume subiu transformaria o job numa máquina de reabrir conversa
   * encerrada, que é exatamente o que a supressão soft de 90 dias existe para
   * agendar em vez de improvisar.
   */
  const hoje = new Date().toISOString().slice(0, 10)
  const { data: suprimidos } = await supabaseAdmin
    .from('supressao')
    .select('valor, expira_em, contexto')
    .eq('escopo', 'empresa')
    .or(`expira_em.is.null,expira_em.gte.${hoje}`)
  const bloqueados = new Map((suprimidos ?? []).map((s) => [s.valor, s]))

  const paraCadastrado: { cnpj: string; empresaId: string | null }[] = []
  const comDonoAutomatico: Record<string, unknown>[] = []
  const semTocarNoDono: Record<string, unknown>[] = []
  const novos: string[] = []

  let candidatos = 0
  let atualizados = 0

  for (const r of rows) {
    const existente = noFunil.get(r.fornecedor_cnpj)

    // ── Saída automática: virou cliente ────────────────────────────────────
    if (r.cadastrado) {
      if (existente && existente.estagio !== 'cadastrado') {
        paraCadastrado.push({ cnpj: r.fornecedor_cnpj, empresaId: r.empresa_id })
      }
      continue
    }

    const municao = {
      volume_90d: Number(r.volume_90d) || 0,
      qtd_nfs_90d: r.qtd_nfs_90d,
      prazo_medio_dias: r.prazo_medio_dias,
      sacados_principais: [],
      potencial_mensal: Number(r.potencial_mensal) || 0,
      ultima_nf_em: r.ultima_nf_em,
    }

    const qualifica = entraNoFunil(municao, corte)
    if (qualifica) candidatos += 1

    // Entrar exige passar do corte E não estar suprimido. Continuar no funil, não:
    // um card que alguém já pegou continua sendo trabalho dele mesmo que o volume
    // tenha caído — e ele precisa mostrar o número de hoje, não o do dia da entrada.
    if (!existente && (!qualifica || bloqueados.has(r.fornecedor_cnpj))) continue

    /*
     * `estagio` fica FORA do payload de propósito.
     *
     * O upsert do PostgREST atualiza exatamente as colunas enviadas. Mandar
     * `estagio: 'a_cadastrar'` faria a rodada da madrugada devolver ao início todo
     * card que alguém moveu durante o dia — a coluna tem default, e o default só se
     * aplica no INSERT, que é onde ele deve valer.
     */
    const linha: Record<string, unknown> = {
      fornecedor_cnpj: r.fornecedor_cnpj,
      volume_90d: municao.volume_90d,
      qtd_nfs_90d: municao.qtd_nfs_90d,
      prazo_medio_dias: municao.prazo_medio_dias,
      sacados_principais: r.sacados_principais,
      potencial_mensal: municao.potencial_mensal,
      ultima_nf_em: municao.ultima_nf_em,
      empresa_id: r.empresa_id,
    }

    if (!existente) {
      novos.push(r.fornecedor_cnpj)
      comDonoAutomatico.push({ ...linha, originador_id: r.originador_id, originador_origem: 'automatica' })
      continue
    }

    atualizados += 1
    if (existente.originador_origem === 'manual') {
      // A reatribuição do gestor não é desfeita de madrugada.
      semTocarNoDono.push(linha)
    } else {
      comDonoAutomatico.push({ ...linha, originador_id: r.originador_id })
    }
  }

  /*
   * RECONCILIAÇÃO CRUZADA: quem foi suprimido POR OUTRO MÓDULO some daqui também.
   *
   * A tela do Comercial não pode ler `supressao` — a policy daquela tabela exige o
   * módulo `radar`. Então um CNPJ bloqueado pela tela da Antecipação continuaria
   * aparecendo aqui como lead ativo, e o originador ligaria para alguém que o sistema
   * inteiro trata como "não abordar".
   *
   * A conciliação mora AQUI, e não numa consulta da tela, porque este job roda com
   * service_role e é o único lugar que enxerga as duas coisas. A tela lê um dado já
   * resolvido, na própria linha do funil.
   */
  const paraSuprimir = (existentes ?? []).filter(
    (f) => f.estagio !== 'sem_interesse' && f.estagio !== 'cadastrado' && bloqueados.has(f.fornecedor_cnpj),
  )
  for (const f of paraSuprimir) {
    const sup = bloqueados.get(f.fornecedor_cnpj)
    await supabaseAdmin
      .from('fornecedores_funil')
      .update({
        estagio: 'sem_interesse',
        estagio_alterado_em: new Date().toISOString(),
        sem_interesse_motivo: 'sem_contato',
        sem_interesse_observacao: `Suprimido pelo módulo ${sup?.contexto ?? 'geral'}.`,
        sem_interesse_ate: sup?.expira_em ?? null,
      })
      .eq('fornecedor_cnpj', f.fornecedor_cnpj)
  }
  if (paraSuprimir.length > 0) {
    logger.info({ n: paraSuprimir.length }, 'Fornecedores suprimidos por outro módulo saíram do funil.')
  }

  /*
   * O contrário também: supressão vencida devolve o card ao funil.
   *
   * A limpeza de supressões expiradas (`antecipacao/supressoes.ts`) apaga a linha lá e
   * não sabe deste funil. Sem esta volta, "soft 90 dias" seria eterna na prática — o
   * card ficaria em `sem_interesse` para sempre, com uma data de retorno que já passou.
   */
  const paraReabrir = (existentes ?? []).filter(
    (f) => f.estagio === 'sem_interesse' && !bloqueados.has(f.fornecedor_cnpj),
  )
  for (const f of paraReabrir) {
    await supabaseAdmin
      .from('fornecedores_funil')
      .update({
        estagio: 'a_cadastrar',
        estagio_alterado_em: new Date().toISOString(),
        sem_interesse_motivo: null,
        sem_interesse_observacao: null,
        sem_interesse_ate: null,
      })
      .eq('fornecedor_cnpj', f.fornecedor_cnpj)
  }
  if (paraReabrir.length > 0) {
    logger.info({ n: paraReabrir.length }, 'Supressão venceu; fornecedores voltaram ao funil.')
  }

  /*
   * Em lotes, e não linha a linha: são ~700 fornecedores por rodada, e 700
   * round-trips ao PostgREST levam minutos onde um upsert leva segundos. O limite de
   * 500 por chamada é folgado o bastante para caber no payload e pequeno o bastante
   * para uma falha não perder a rodada inteira.
   */
  const LOTE = 500
  async function gravar(linhas: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < linhas.length; i += LOTE) {
      const { error: e } = await supabaseAdmin
        .from('fornecedores_funil')
        .upsert(linhas.slice(i, i + LOTE) as never, { onConflict: 'fornecedor_cnpj' })
      if (e) throw new Error(`Falha ao gravar o funil de fornecedores: ${e.message}`)
    }
  }

  await gravar(comDonoAutomatico)
  await gravar(semTocarNoDono)

  for (const c of paraCadastrado) {
    await supabaseAdmin
      .from('fornecedores_funil')
      .update({ estagio: 'cadastrado', estagio_alterado_em: new Date().toISOString() })
      .eq('fornecedor_cnpj', c.cnpj)
    await emitirEvento(c.empresaId, EVENTO_TIPOS.FORNECEDOR_CADASTRADO, {
      titulo: 'Fornecedor cadastrado',
      resumo: `${c.cnpj} entrou na plataforma. As NFs dele seguem o funil de antecipação.`,
      url: '/comercial/fornecedores',
      cnpj: c.cnpj,
    })
  }

  for (const cnpj of novos) {
    const r = rows.find((x) => x.fornecedor_cnpj === cnpj)
    await emitirEvento(r?.empresa_id ?? null, EVENTO_TIPOS.FORNECEDOR_ENTROU_FUNIL, {
      titulo: 'Fornecedor entrou no funil de cadastro',
      resumo: `${cnpj} faturou ${(Number(r?.volume_90d) || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })} contra nossos sacados em 90 dias.`,
      url: '/comercial/fornecedores',
      cnpj,
      potencial_mensal: Number(r?.potencial_mensal) || 0,
    })
  }

  const entraram = novos.length
  const cadastrados = paraCadastrado.length

  /*
   * Os que saíram da janela inteira (180 dias sem nota) NÃO são removidos.
   *
   * Apagar a linha levaria junto os contatos descobertos, o histórico de estágio e o
   * dinheiro que já foi gasto para achá-los — e o fornecedor voltaria do zero na
   * próxima nota. `ultima_nf_em` já diz que ele esfriou, e um potencial zerado desce
   * sozinho na ordenação.
   */

  logger.info({ candidatos, entraram, atualizados, cadastrados }, 'Funil de fornecedores atualizado.')
  return { candidatos, entraram, atualizados, cadastrados }
}
