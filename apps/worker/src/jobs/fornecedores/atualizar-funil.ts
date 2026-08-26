import { EVENTO_TIPOS } from '../../../../../packages/core/src/constants.js'
import { entraNoFunil } from '../../../../../packages/core/src/fornecedores/municao.js'
import { pool, supabaseAdmin } from '../../db.js'
import { logger } from '../../logger.js'
import { emitirEvento } from '../../radar/eventos.js'
import { lerCorteVolume } from './config.js'

/**
 * Alimentação do funil (04l §3). Roda depois de cada sync de NF.
 *
 * ─── QUEM É CANDIDATO SAI DA VIEW, NÃO DE UMA CÓPIA DA REGRA ─────────────────
 *
 * `antecipacao_fornecedores_a_prospectar` (0101/0102) JÁ É a definição de "fornecedor
 * que vale abordar", e ela é mais estrita do que parece: o que qualifica não é o sacado
 * estar cadastrado, é ele ter CRÉDITO APROVADO — inclusive noutro CNPJ do grupo.
 *
 * A primeira versão deste job reimplementou a regra com `sacado_cadastrado`, e o
 * resultado foi medido: dos 390 fornecedores que apareciam aqui e não lá, 388 emitiam
 * contra sacados SEM limite aprovado. Para esses não há operação a oferecer — o lead
 * não era lead. É exatamente o estrago que a 0102 já tinha medido na lista original
 * (70% dela) e corrigido; a cópia o trouxe de volta por outro caminho.
 *
 * Duas telas discordando sobre quem é candidato é como o originador liga para alguém
 * que a operação não consegue atender. Agora existe UMA fonte, e ela é a view.
 *
 * ─── A MUNIÇÃO É CALCULADA POR CIMA ──────────────────────────────────────────
 *
 * A view responde QUEM; ela não traz prazo médio nem os sacados principais com valor,
 * que são o que a ficha de abordagem precisa. Isso é agregado aqui, sobre as notas dos
 * CNPJs que a view já aprovou.
 *
 * ─── A MUNIÇÃO É RECALCULADA; O ESTADO NÃO ───────────────────────────────────
 *
 * Volume, prazo, sacados e potencial se sobrescrevem toda rodada. Estágio, dono e
 * contatos descobertos são estado humano e nunca são tocados aqui — a única exceção é
 * a saída automática por cadastro, que é fato observado, e a reconciliação de
 * supressão, que é fato de outro módulo.
 *
 * ─── POR QUE SQL, E NÃO 700 IDAS AO BANCO ────────────────────────────────────
 *
 * A munição de todos sai de UMA consulta agregada. Puxar as notas de cada fornecedor e
 * agregar em TypeScript faria centenas de round-trips para calcular somas que o
 * Postgres faz num scan. `calcularMunicao` continua sendo a fonte da regra no core (e o
 * que os testes provam); aqui ela é aplicada só onde o SQL não alcança sem ficar
 * ilegível.
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
}

/**
 * A view diz QUEM; esta consulta diz QUANTO.
 *
 * `notas` é restrito aos CNPJs que a view já aprovou — o `join` com ela é o filtro, e
 * é o que impede a regra de divergir. A janela é a mesma da view (90 dias), porque a
 * pergunta é a mesma: quem está emitindo AGORA.
 */
const SQL_MUNICAO = `
with candidatos as (
  select
    p.fornecedor_cnpj,
    p.fornecedor_empresa_id,
    p.valor_agregado,
    p.notas,
    p.ultima_nota_em
  from public.antecipacao_fornecedores_a_prospectar p
),
notas as (
  select
    f.fornecedor_cnpj, f.sacado_cnpj, f.sacado_nome,
    f.valor, f.emitida_em, f.vencimento
  from public.notas_funil f
    join candidatos c on c.fornecedor_cnpj = f.fornecedor_cnpj
  where f.emitida_em >= now() - interval '90 days'
),
prazos as (
  select
    n.fornecedor_cnpj,
    /*
     * Prazo médio PONDERADO POR VALOR. Uma nota de R$ 500 a 7 dias e uma de R$ 500
     * mil a 90 não têm o mesmo peso na decisão de quem vai operar essa carteira, e a
     * média simples trata as duas igual.
     *
     * "date - date" já é INTEIRO de dias em Postgres, não intervalo: um
     * "extract(day from ...)" aqui não compila.
     */
    (
      sum((n.vencimento - n.emitida_em::date) * n.valor) filter (
        where n.vencimento is not null
          and n.vencimento >= n.emitida_em::date
          and n.vencimento <= n.emitida_em::date + 365)
      / nullif(sum(n.valor) filter (
        where n.vencimento is not null
          and n.vencimento >= n.emitida_em::date
          and n.vencimento <= n.emitida_em::date + 365), 0)
    )::int as prazo_medio_dias
  from notas n
  group by n.fornecedor_cnpj
),
sacados as (
  /*
   * "select distinct" no lado esquerdo, e ele é load-bearing: o LATERAL roda uma vez
   * por LINHA da esquerda. Com "from notas n" ele rodava uma vez por NOTA, e o card
   * de um fornecedor com 16 notas trazia a mesma lista de top-5 dezesseis vezes
   * seguidas — a consulta não erra nem fica lenta o bastante para chamar atenção,
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
  group by n.fornecedor_cnpj, c.vendedor_id
  order by n.fornecedor_cnpj, sum(n.valor) desc
)
select
  c.fornecedor_cnpj,
  c.fornecedor_empresa_id as empresa_id,
  c.valor_agregado as volume_90d,
  c.notas as qtd_nfs_90d,
  pz.prazo_medio_dias,
  round(c.valor_agregado / 3, 2) as potencial_mensal,
  c.ultima_nota_em::date as ultima_nf_em,
  coalesce(s.principais, '[]'::jsonb) as sacados_principais,
  d.originador_id
from candidatos c
  left join prazos pz on pz.fornecedor_cnpj = c.fornecedor_cnpj
  left join sacados s on s.fornecedor_cnpj = c.fornecedor_cnpj
  left join dono d on d.fornecedor_cnpj = c.fornecedor_cnpj`

/*
 * `estagio` fica FORA do payload de propósito.
 *
 * O upsert do PostgREST atualiza exatamente as colunas enviadas. Mandar
 * `estagio: 'a_cadastrar'` faria a rodada da madrugada devolver ao início todo card
 * que alguém moveu durante o dia — a coluna tem default, e o default só se aplica no
 * INSERT, que é onde ele deve valer.
 */
function campos(r: LinhaAgregada): Record<string, unknown> {
  return {
    fornecedor_cnpj: r.fornecedor_cnpj,
    volume_90d: Number(r.volume_90d) || 0,
    qtd_nfs_90d: r.qtd_nfs_90d,
    prazo_medio_dias: r.prazo_medio_dias,
    sacados_principais: r.sacados_principais,
    potencial_mensal: Number(r.potencial_mensal) || 0,
    ultima_nf_em: r.ultima_nf_em,
    empresa_id: r.empresa_id,
  }
}

export interface ResultadoAtualizarFunil {
  candidatos: number
  entraram: number
  atualizados: number
  cadastrados: number
}

export async function atualizarFunilFornecedores(): Promise<ResultadoAtualizarFunil> {
  const corte = await lerCorteVolume()
  const { rows } = await pool.query<LinhaAgregada>(SQL_MUNICAO)
  const porCnpj = new Map(rows.map((r) => [r.fornecedor_cnpj, r]))

  const { data: existentes, error } = await supabaseAdmin
    .from('fornecedores_funil')
    .select('fornecedor_cnpj, estagio, originador_id, originador_origem')
  if (error) throw new Error(`Falha ao ler o funil: ${error.message}`)

  /*
   * A supressão vigente é consultada ANTES de qualquer entrada. Um fornecedor que
   * disse "não me procurem" e voltou a faturar continua dizendo não — reabrir o card
   * porque o volume subiu transformaria o job numa máquina de reabrir conversa
   * encerrada, que é exatamente o que a supressão soft de 90 dias existe para
   * agendar em vez de improvisar.
   */
  /*
   * DUAS FONTES DE DESCARTE, e ler só uma deixava a outra vazar.
   *
   *   `supressao`                            bloqueio de canal, com validade (0047)
   *   `antecipacao_fornecedor_sem_interesse` qualificação do lead, sem validade (0104)
   *
   * O RPC da lista a prospectar grava SÓ a segunda — medido: 2 marcados lá, zero com
   * supressão. Lendo apenas `supressao`, um fornecedor descartado por aquela tela
   * sumia da lista de candidatos e o card ficava em `a_cadastrar` para sempre, e o
   * originador ligaria para quem outra pessoa já trabalhou e descartou.
   */
  const hoje = new Date().toISOString().slice(0, 10)
  const [{ data: suprimidos }, { data: descartados }] = await Promise.all([
    supabaseAdmin
      .from('supressao')
      .select('valor, expira_em, contexto')
      .eq('escopo', 'empresa')
      .or(`expira_em.is.null,expira_em.gte.${hoje}`),
    supabaseAdmin.from('antecipacao_fornecedor_sem_interesse').select('cnpj, motivo, observacao'),
  ])

  interface Bloqueio {
    ate: string | null
    origem: 'antecipacao' | 'supressao'
    motivo: string
    observacao: string
  }
  const bloqueados = new Map<string, Bloqueio>()

  for (const d of descartados ?? []) {
    bloqueados.set(d.cnpj, {
      ate: null,
      origem: 'antecipacao',
      motivo: d.motivo,
      observacao: d.observacao ?? 'Descartado na lista a prospectar da Antecipação.',
    })
  }
  /*
   * A supressão ENTRA POR CIMA quando existe: ela é a fonte com data, e é a data que
   * a tela mostra. Um card com as duas marcações precisa dizer "volta em 12/11" e não
   * "sem prazo" — a informação mais específica ganha.
   */
  for (const s of suprimidos ?? []) {
    bloqueados.set(s.valor, {
      ate: s.expira_em,
      origem: 'supressao',
      motivo: bloqueados.get(s.valor)?.motivo ?? 'sem_contato',
      observacao: `Suprimido pelo módulo ${s.contexto ?? 'geral'}.`,
    })
  }

  /*
   * SAIR DA VIEW NÃO É A MESMA COISA QUE VIRAR CLIENTE.
   *
   * Um fornecedor some da lista de candidatos por quatro motivos diferentes: entrou na
   * plataforma (ganhamos), o sacado dele perdeu o limite aprovado, ele parou de emitir
   * na janela de 90 dias, ou alguém o marcou sem interesse. Só o primeiro é notícia, e
   * tratar os quatro igual emitiria `fornecedor.cadastrado` para três coisas que não
   * são cadastro nenhum.
   *
   * O flag vem do endpoint POR NOTA, então a leitura é no grupo (a mesma cicatriz de
   * 0101): uma nota cadastrada decide o CNPJ inteiro.
   */
  const cnpjsNoFunil = (existentes ?? []).map((f) => f.fornecedor_cnpj)
  const { data: notasCadastradas } = cnpjsNoFunil.length
    ? await supabaseAdmin
        .from('notas_fiscais')
        .select('fornecedor_cnpj')
        .in('fornecedor_cnpj', cnpjsNoFunil)
        .eq('fornecedor_cadastrado', true)
    : { data: [] }
  const jaCadastrados = new Set((notasCadastradas ?? []).map((n) => n.fornecedor_cnpj))

  const paraCadastrado: { cnpj: string; empresaId: string | null }[] = []
  const comDonoAutomatico: Record<string, unknown>[] = []
  const semTocarNoDono: Record<string, unknown>[] = []
  const novos: string[] = []

  let candidatos = 0
  let atualizados = 0

  // ── Quem JÁ está no funil ────────────────────────────────────────────────
  for (const f of existentes ?? []) {
    if (f.estagio === 'cadastrado') continue

    const r = porCnpj.get(f.fornecedor_cnpj)

    if (!r) {
      // Saiu da lista de candidatos. Só é notícia se virou cliente.
      if (jaCadastrados.has(f.fornecedor_cnpj) && f.estagio !== 'sem_interesse') {
        paraCadastrado.push({ cnpj: f.fornecedor_cnpj, empresaId: null })
      }
      /*
       * Os demais NÃO são removidos nem zerados. Apagar a linha levaria junto os
       * contatos descobertos, o histórico de estágio e o dinheiro que já foi gasto
       * para achá-los — e o fornecedor voltaria do zero na próxima nota.
       * `ultima_nf_em` já diz que ele esfriou, e um potencial parado desce sozinho
       * na ordenação.
       */
      continue
    }

    atualizados += 1
    const linha = campos(r)
    if (f.originador_origem === 'manual') {
      // A reatribuição do gestor não é desfeita de madrugada.
      semTocarNoDono.push(linha)
    } else {
      comDonoAutomatico.push({ ...linha, originador_id: r.originador_id })
    }
  }

  // ── Quem ainda não está ──────────────────────────────────────────────────
  const noFunil = new Set(cnpjsNoFunil)
  for (const r of rows) {
    const volume = Number(r.volume_90d) || 0
    const qualifica = entraNoFunil(
      {
        volume_90d: volume,
        qtd_nfs_90d: r.qtd_nfs_90d,
        prazo_medio_dias: r.prazo_medio_dias,
        sacados_principais: [],
        potencial_mensal: Number(r.potencial_mensal) || 0,
        ultima_nf_em: r.ultima_nf_em,
      },
      corte,
    )
    if (qualifica) candidatos += 1
    if (noFunil.has(r.fornecedor_cnpj)) continue
    if (!qualifica || bloqueados.has(r.fornecedor_cnpj)) continue

    novos.push(r.fornecedor_cnpj)
    comDonoAutomatico.push({
      ...campos(r),
      originador_id: r.originador_id,
      originador_origem: 'automatica',
    })
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
    const b = bloqueados.get(f.fornecedor_cnpj)
    await supabaseAdmin
      .from('fornecedores_funil')
      .update({
        estagio: 'sem_interesse',
        estagio_alterado_em: new Date().toISOString(),
        sem_interesse_motivo: b?.motivo ?? 'sem_contato',
        sem_interesse_observacao: b?.observacao ?? null,
        sem_interesse_ate: b?.ate ?? null,
        // A ORIGEM é o que diz onde o descarte se desfaz. Sem ela, "sem data" na tela
        // significaria tanto "definitivo, peso de LGPD" quanto "reversível num clique
        // na outra tela" — e essas duas coisas pedem ações opostas.
        sem_interesse_origem: b?.origem ?? 'supressao',
      })
      .eq('fornecedor_cnpj', f.fornecedor_cnpj)
  }
  if (paraSuprimir.length > 0) {
    logger.info({ n: paraSuprimir.length }, 'Fornecedores descartados por outro módulo saíram do funil.')
  }

  /*
   * O contrário também: descarte desfeito na origem devolve o card ao funil.
   *
   * Vale para as duas fontes. A limpeza de supressões expiradas
   * (`antecipacao/supressoes.ts`) apaga a linha lá e não sabe deste funil — sem esta
   * volta, "soft 90 dias" seria eterna na prática, com uma data de retorno já vencida
   * estampada no card. E `app_reverter_fornecedor_sem_interesse` (0104) desfaz a
   * qualificação sem tocar em nada daqui.
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
        sem_interesse_origem: null,
      })
      .eq('fornecedor_cnpj', f.fornecedor_cnpj)
  }
  if (paraReabrir.length > 0) {
    logger.info({ n: paraReabrir.length }, 'Descarte desfeito na origem; fornecedores voltaram ao funil.')
  }

  /*
   * Em lotes, e não linha a linha: são centenas de fornecedores por rodada, e outros
   * tantos round-trips ao PostgREST levam minutos onde um upsert leva segundos. O
   * limite de 500 por chamada é folgado para caber no payload e pequeno para uma
   * falha não perder a rodada inteira.
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
    const r = porCnpj.get(cnpj)
    await emitirEvento(r?.empresa_id ?? null, EVENTO_TIPOS.FORNECEDOR_ENTROU_FUNIL, {
      titulo: 'Fornecedor entrou no funil de cadastro',
      resumo: `${cnpj} faturou ${(Number(r?.volume_90d) || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })} contra sacados com crédito aprovado em 90 dias.`,
      url: '/comercial/fornecedores',
      cnpj,
      potencial_mensal: Number(r?.potencial_mensal) || 0,
    })
  }

  const entraram = novos.length
  const cadastrados = paraCadastrado.length

  logger.info({ candidatos, entraram, atualizados, cadastrados }, 'Funil de fornecedores atualizado.')
  return { candidatos, entraram, atualizados, cadastrados }
}
