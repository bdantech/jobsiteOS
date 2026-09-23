/*
 * Filtrar o funil por vendedor devolvia UMA pré-autorização, de 806.
 *
 * ── O QUE A MEDIÇÃO MOSTROU (23/09/2026) ────────────────────────────────────
 *     pre_autorizacoes ... 806 linhas,   1 com dono
 *     sienge_titulos ..... 298 linhas, 200 com dono
 *
 * Mesma regra, mesmo laço, a MESMA corrida das 09:29. E o discriminador matou a
 * hipótese de dado: o sacado VENTO SUL ENGENHARIA (`prospeccao_ativa`, na carteira
 * do Rodrigo) tinha 103 títulos COM dono e 19 pré-autorizações SEM. Mesmo CNPJ,
 * mesma holding, mesma gestão.
 *
 * As 43 pré-autorizações visíveis e sem dono tinham `vendedor_definido_em` NULO —
 * nunca foram roteadas, e a mais antiga é de 24/08. Não foram sobrescritas: o
 * roteamento nunca as visitou.
 *
 * ── A CAUSA: O DONO DEPENDIA DO RELÓGIO ─────────────────────────────────────
 * `rotearOportunidadesJob` filtrava `and t.origem_exibida`. Isso amarra a decisão
 * de CARTEIRA à decisão de APRESENTAÇÃO, e as duas rodam em ritmos diferentes:
 * `sincronizarFontesDoFunil` (que termina na dedup, quem mexe em `origem_exibida`)
 * é chamada de TRÊS lugares, e só a corrente diária tinha roteamento atrás. O ciclo
 * de 4h e o botão "sincronizar agora" reexibiam linhas e iam dormir.
 *
 * E sem dono a linha não cai na fila do gestor: a RLS das duas tabelas recorta por
 * `vendedor_id`, então ela desaparece do originador e reaparece só para o gestor.
 *
 * A correção está no worker, em dois pontos, e esta migração é só o acerto do que
 * já está gravado:
 *   1. o roteamento não olha mais `origem_exibida` — esconder é apresentação;
 *   2. `sincronizarFontesDoFunil` roteia logo depois da dedup, nas três entradas.
 *
 * ── O QUE ESTE UPDATE FAZ ───────────────────────────────────────────────────
 * A MESMA regra de `rotearNota`, em SQL, para o que está sem dono agora: sacado
 * passivo fica fora, carteira explícita vence, quem alcança DIRETO vence quem
 * alcança pela SPE do grupo, e o empate resolve por menor carga de NFs vivas e
 * depois por id — a ordem de `menorCarga`, para a decisão ser a mesma que o job
 * tomaria. `vendedor_origem = 'manual'` é intocado: decisão humana não se revisa.
 *
 * Medido antes de aplicar: 108 pré-autorizações e 36 títulos, todas para o Rodrigo,
 * todas por carteira DIRETA e nenhuma com empate.
 *
 * Os três blocos de contexto vivem como CTE dentro de CADA update, e não como
 * tabela temporária: `on commit drop` depende de a migração rodar num bloco de
 * transação, e um update autocontido não depende de nada.
 */

-- ── Pré-autorizações ───────────────────────────────────────────────────────

with orig as (
  select v.id as vendedor_id,
         coalesce(array(select jsonb_array_elements_text(v.settings->'empresas_escolhidas'))::uuid[],
                  '{}'::uuid[]) as escolhidas
    from public.vendedores v
   where v.tipo = 'originador' and v.ativo
),
-- O grupo econômico de cada empresa escolhida: é por aqui que a SPE dela entra.
grupos as (
  select o.vendedor_id,
         coalesce(array_agg(distinct e.grupo_id) filter (where e.grupo_id is not null),
                  '{}'::uuid[]) as grupos
    from orig o
    left join public.empresas e on e.id = any(o.escolhidas)
   group by o.vendedor_id
),
-- A carga que desempata: NFs vivas, e só elas — como em `originadores()`.
carga as (
  select vendedor_id, count(*)::int as nfs_vivas
    from public.notas_fiscais
   where vendedor_id is not null and estagio_funil not in ('convertida', 'perdida')
   group by vendedor_id
),
cand as (
  select t.id_externo,
         t.sacado_empresa_id,
         t.fornecedor_empresa_id as fornecedor_empresa_id,
         case when su.is_spe then su.grupo_id end as sacado_grupo_spe,
         case when fu.is_spe then fu.grupo_id end as fornecedor_grupo_spe,
         hold.gestao_operacao as sacado_gestao
    from public.pre_autorizacoes t
    left join public.mercado_universo su on su.cnpj = t.sacado_cnpj
    left join public.mercado_universo fu on fu.cnpj = t.fornecedor_cnpj
    left join lateral (select public.app_holding_do_sacado(t.sacado_cnpj) as id) h on true
    left join public.empresas hold on hold.id = h.id
   where t.estagio_funil not in ('convertida', 'perdida')
     and coalesce(t.vendedor_origem, '') <> 'manual'
     and t.vendedor_id is null
),
alcance as (
  select c.id_externo, o.vendedor_id,
         -- 0 = alcança DIRETO, 1 = alcança pela SPE do grupo. Direto vence.
         case when c.sacado_empresa_id = any(o.escolhidas)
                or c.fornecedor_empresa_id = any(o.escolhidas) then 0 else 1 end as prio
    from cand c
    join orig o on true
    join grupos g on g.vendedor_id = o.vendedor_id
   where c.sacado_gestao is distinct from 'passivo'
     and (c.sacado_empresa_id = any(o.escolhidas)
       or c.fornecedor_empresa_id = any(o.escolhidas)
       or (c.sacado_grupo_spe is not null and c.sacado_grupo_spe = any(g.grupos))
       or (c.fornecedor_grupo_spe is not null and c.fornecedor_grupo_spe = any(g.grupos)))
),
-- `distinct on` + esta ordem É `menorCarga`: direto antes de SPE, menor carga
-- antes, e o id como último critério para a decisão ser reprodutível.
escolha as (
  select distinct on (a.id_externo) a.id_externo, a.vendedor_id
    from alcance a
    left join carga k on k.vendedor_id = a.vendedor_id
   order by a.id_externo, a.prio, coalesce(k.nfs_vivas, 0), a.vendedor_id
)
update public.pre_autorizacoes t
   set vendedor_id = e.vendedor_id,
       vendedor_origem = 'carteira',
       vendedor_definido_em = now()
  from escolha e
 where t.id_externo = e.id_externo
   and t.vendedor_id is null
   and coalesce(t.vendedor_origem, '') <> 'manual';

-- ── Títulos do Sienge ──────────────────────────────────────────────────────
-- A ponta "fornecedor" aqui é o CREDOR, e é a única diferença.

with orig as (
  select v.id as vendedor_id,
         coalesce(array(select jsonb_array_elements_text(v.settings->'empresas_escolhidas'))::uuid[],
                  '{}'::uuid[]) as escolhidas
    from public.vendedores v
   where v.tipo = 'originador' and v.ativo
),
grupos as (
  select o.vendedor_id,
         coalesce(array_agg(distinct e.grupo_id) filter (where e.grupo_id is not null),
                  '{}'::uuid[]) as grupos
    from orig o
    left join public.empresas e on e.id = any(o.escolhidas)
   group by o.vendedor_id
),
carga as (
  select vendedor_id, count(*)::int as nfs_vivas
    from public.notas_fiscais
   where vendedor_id is not null and estagio_funil not in ('convertida', 'perdida')
   group by vendedor_id
),
cand as (
  select t.id_externo,
         t.sacado_empresa_id,
         t.credor_empresa_id as fornecedor_empresa_id,
         case when su.is_spe then su.grupo_id end as sacado_grupo_spe,
         case when fu.is_spe then fu.grupo_id end as fornecedor_grupo_spe,
         hold.gestao_operacao as sacado_gestao
    from public.sienge_titulos t
    left join public.mercado_universo su on su.cnpj = t.sacado_cnpj
    left join public.mercado_universo fu on fu.cnpj = t.credor_cnpj
    left join lateral (select public.app_holding_do_sacado(t.sacado_cnpj) as id) h on true
    left join public.empresas hold on hold.id = h.id
   where t.estagio_funil not in ('convertida', 'perdida')
     and coalesce(t.vendedor_origem, '') <> 'manual'
     and t.vendedor_id is null
),
alcance as (
  select c.id_externo, o.vendedor_id,
         case when c.sacado_empresa_id = any(o.escolhidas)
                or c.fornecedor_empresa_id = any(o.escolhidas) then 0 else 1 end as prio
    from cand c
    join orig o on true
    join grupos g on g.vendedor_id = o.vendedor_id
   where c.sacado_gestao is distinct from 'passivo'
     and (c.sacado_empresa_id = any(o.escolhidas)
       or c.fornecedor_empresa_id = any(o.escolhidas)
       or (c.sacado_grupo_spe is not null and c.sacado_grupo_spe = any(g.grupos))
       or (c.fornecedor_grupo_spe is not null and c.fornecedor_grupo_spe = any(g.grupos)))
),
escolha as (
  select distinct on (a.id_externo) a.id_externo, a.vendedor_id
    from alcance a
    left join carga k on k.vendedor_id = a.vendedor_id
   order by a.id_externo, a.prio, coalesce(k.nfs_vivas, 0), a.vendedor_id
)
update public.sienge_titulos t
   set vendedor_id = e.vendedor_id,
       vendedor_origem = 'carteira',
       vendedor_definido_em = now()
  from escolha e
 where t.id_externo = e.id_externo
   and t.vendedor_id is null
   and coalesce(t.vendedor_origem, '') <> 'manual';
