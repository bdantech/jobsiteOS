-- 0294 — O report "Documentos sem dono e carteiras" (aba Relatórios do Comercial).
--
-- O QUE ENTRA
--   app_report_documentos()
--     Uma leitura só, para a tela inteira: o que está sem originador (NF, pré-autorização
--     e título Sienge), quem concentra esse volume, por que cada documento está sem dono,
--     quais contas dá para atribuir e onde estão os documentos de cada originador.
--
-- POR QUE UMA FUNÇÃO, E NÃO CONSULTAS DA TELA
--   São ~13 mil documentos sem dono e outros ~12 mil com dono. Agregar no cliente seria
--   trazer tudo isso pelo PostgREST para somar no navegador. E a pergunta "por que está
--   sem dono" repete a régua do roteamento (carteira explícita, SPE subindo pelo grupo,
--   conta passiva lida na HOLDING) — que só o banco sabe calcular de uma vez.
--
-- O RECORTE DE "SEM DONO" É O DA TELA DO FUNIL
--   Estágio aberto, operável, exibido (fora de `funil_ocultacoes`, `origem_exibida`). É o
--   que o filtro "sem dono" do Kanban mostra. O aviso `nf.sem_originador` conta também as
--   expiradas — por isso o número dele é cinco vezes maior que o daqui.
--
-- `app_holding_do_sacado` É CHAMADA POR CNPJ DISTINTO, NÃO POR LINHA
--   Por linha seriam dezenas de milhares de chamadas (a cicatriz está em funil-kanban.tsx).
--   São ~2,7 mil sacados distintos, resolvidos antes da consulta e guardados num mapa.
--
-- SEGURANÇA
--   `security definer` com a mesma porta do report semanal: `app_report_gestor()`. O
--   report mostra a carteira de cada pessoa do time.

create or replace function public.app_report_documentos()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  r jsonb;
  v_hold jsonb;
begin
  if not public.app_report_gestor() then
    raise exception 'O report de documentos sem dono é leitura de gestor.' using errcode = '42501';
  end if;

  /*
   * A holding de cada sacado sem dono, num MAPA cnpj -> empresa, antes da consulta.
   *
   * Já foi uma CTE juntada à lista de documentos, e custou 18,5 s: o planejador estima
   * em uma linha o filtro sobre a CTE de documentos e escolhe laço aninhado contra outra
   * CTE sem índice — 13 mil x 7 mil comparações. Com o mapa, a consulta principal só faz
   * busca por chave em tabela indexada, e o erro de estimativa deixa de importar.
   */
  select coalesce(jsonb_object_agg(s.cnpj, s.hold_id) filter (where s.hold_id is not null), '{}'::jsonb)
    into v_hold
    from (
      select c.cnpj, public.app_holding_do_sacado(c.cnpj) as hold_id from (
        select nf.sacado_cnpj as cnpj from public.notas_fiscais nf
         where nf.vendedor_id is null and nf.situacao = 'valida'
           and coalesce(nf.operavel_manual, nf.operavel)
           and nf.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
        union
        select pa.sacado_cnpj from public.pre_autorizacoes pa
         where pa.vendedor_id is null and pa.origem_exibida
           and pa.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
        union
        select st.sacado_cnpj from public.sienge_titulos st
         where st.vendedor_id is null and st.origem_exibida
           and st.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
      ) c where c.cnpj is not null
    ) s;

  with docs as materialized (
    select 'nf'::text as tipo, nf.sacado_cnpj, nf.sacado_nome, nf.sacado_empresa_id,
           nf.fornecedor_cnpj, nf.fornecedor_nome, nf.fornecedor_empresa_id,
           nf.valor, nf.receita_esperada, nf.faixa, nf.vencimento, nf.credit_status,
           nf.estagio_funil, nf.vendedor_id,
           (nf.situacao = 'valida' and coalesce(nf.operavel_manual, nf.operavel)) as operavel,
           exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'nf' and o.referencia_id = nf.access_key) as oculto
      from public.notas_fiscais nf
     where nf.vendedor_id is not null
        or nf.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
    union all
    select 'pre_autorizacao', pa.sacado_cnpj, pa.sacado_nome, pa.sacado_empresa_id,
           pa.fornecedor_cnpj, pa.fornecedor_nome, pa.fornecedor_empresa_id,
           pa.valor, pa.receita_esperada, pa.faixa, pa.vencimento, pa.credit_status,
           pa.estagio_funil, pa.vendedor_id,
           true,
           (not pa.origem_exibida) or exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'pre_autorizacao' and o.referencia_id = pa.id_externo::text)
      from public.pre_autorizacoes pa
     where pa.vendedor_id is not null
        or pa.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
    union all
    select 'titulo', st.sacado_cnpj, st.sacado_nome, st.sacado_empresa_id,
           st.credor_cnpj, st.credor_nome, st.credor_empresa_id,
           st.valor, st.receita_esperada, st.faixa, st.vencimento, st.credit_status,
           st.estagio_funil, st.vendedor_id,
           true,
           (not st.origem_exibida) or exists (select 1 from public.funil_ocultacoes o
                    where o.tipo = 'titulo' and o.referencia_id = st.id_externo::text)
      from public.sienge_titulos st
     where st.vendedor_id is not null
        or st.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  ),

  -- ── A carteira explícita de cada originador, como o roteamento a lê ──────────
  orig as materialized (
    select v.id as vendedor_id, e.id::uuid as empresa_id
      from public.vendedores v,
           lateral jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) e(id)
     where v.tipo = 'originador' and v.ativo
  ),
  grupos as materialized (
    select distinct em.grupo_id
      from orig o join public.empresas em on em.id = o.empresa_id
     where em.grupo_id is not null
  ),

  sem_dono as materialized (
    select d.* from docs d
     where d.vendedor_id is null and d.operavel and not d.oculto
       and d.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
  ),
  sd as materialized (
    select d.*,
           left(d.sacado_cnpj, 8) as sacado_raiz,
           left(d.fornecedor_cnpj, 8) as fornecedor_raiz,
           se.razao_social as sacado_razao, se.estagio as sacado_estagio,
           fe.razao_social as fornecedor_razao, fe.estagio as fornecedor_estagio,
           hold.id as hold_id, hold.razao_social as hold_nome, hold.cnpj as hold_cnpj,
           hold.estagio as hold_estagio, hold.gestao_operacao as hold_gestao,
           case
             when hold.gestao_operacao = 'passivo' then 'passivo'
             when exists (select 1 from orig o
                           where o.empresa_id in (d.sacado_empresa_id, d.fornecedor_empresa_id))
               or exists (select 1 from public.mercado_universo mu
                           where mu.cnpj in (d.sacado_cnpj, d.fornecedor_cnpj) and mu.is_spe
                             and mu.grupo_id in (select g.grupo_id from grupos g))
               then 'em_carteira'
             when d.sacado_empresa_id is null then 'sacado_sem_cadastro'
             else 'fora_de_carteira'
           end as motivo
      from sem_dono d
      left join public.empresas hold on hold.id = (v_hold ->> d.sacado_cnpj)::uuid
      left join public.empresas se on se.id = d.sacado_empresa_id
      left join public.empresas fe on fe.id = d.fornecedor_empresa_id
  ),
  tot as (select coalesce(sum(valor), 0) as valor from sd),

  j_totais as (
    select jsonb_build_object(
      'docs', count(*), 'valor', coalesce(sum(valor), 0),
      'receita', coalesce(sum(receita_esperada), 0),
      'sacados', count(distinct sacado_raiz), 'cedentes', count(distinct fornecedor_raiz),
      'docs_nf', count(*) filter (where tipo = 'nf'),
      'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
      'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
      'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
      'docs_ti', count(*) filter (where tipo = 'titulo'),
      'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
    from sd
  ),

  j_motivos as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'motivo', motivo, 'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'sacados', count(distinct sacado_raiz), 'cedentes', count(distinct fornecedor_raiz),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
      from sd group by motivo) x
  ),

  j_sacados as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'raiz', sacado_raiz,
        'nome', mode() within group (order by coalesce(sacado_razao, sacado_nome)),
        'empresa_id', (array_agg(sacado_empresa_id) filter (where sacado_empresa_id is not null))[1],
        'cnpjs', count(distinct sacado_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'pct', round(100 * sum(valor) / nullif((select valor from tot), 0), 1),
        'receita', coalesce(sum(receita_esperada), 0),
        'contrapartes', count(distinct fornecedor_raiz),
        'vence_30d', coalesce(sum(valor) filter (where vencimento between current_date and current_date + 30), 0),
        'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
        'estagio', mode() within group (order by sacado_estagio),
        'cadastrado', bool_or(sacado_empresa_id is not null),
        'gestao', mode() within group (order by hold_gestao),
        'credito', mode() within group (order by credit_status),
        'motivo', mode() within group (order by motivo),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'docs_ti', count(*) filter (where tipo = 'titulo')) as j
      from sd where sacado_raiz is not null
      group by sacado_raiz order by sum(valor) desc limit 30) x
  ),

  maior_sacado as (
    select distinct on (fornecedor_raiz) fornecedor_raiz, nome, valor from (
      select fornecedor_raiz, mode() within group (order by coalesce(sacado_razao, sacado_nome)) as nome,
             sum(valor) as valor
        from sd where fornecedor_raiz is not null group by fornecedor_raiz, sacado_raiz) t
    order by fornecedor_raiz, valor desc
  ),
  j_cedentes as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select c.valor, c.j || jsonb_build_object(
               'maior_sacado', ms.nome, 'maior_sacado_valor', ms.valor,
               'sem_interesse', exists (select 1 from public.antecipacao_fornecedor_sem_interesse si
                                         where left(si.cnpj, 8) = c.raiz),
               'cliente_onepay', exists (select 1 from public.clientes_onepay co
                                          where left(co.cnpj, 8) = c.raiz),
               'protesto', exists (select 1 from public.protestos_atual pr
                                    where left(pr.cnpj, 8) = c.raiz and pr.tem_protesto)) as j
      from (
        select fornecedor_raiz as raiz, sum(valor) as valor, jsonb_build_object(
          'raiz', fornecedor_raiz,
          'nome', mode() within group (order by coalesce(fornecedor_razao, fornecedor_nome)),
          'empresa_id', (array_agg(fornecedor_empresa_id) filter (where fornecedor_empresa_id is not null))[1],
          'cnpjs', count(distinct fornecedor_cnpj),
          'docs', count(*), 'valor', coalesce(sum(valor), 0),
          'pct', round(100 * sum(valor) / nullif((select valor from tot), 0), 1),
          'receita', coalesce(sum(receita_esperada), 0),
          'contrapartes', count(distinct sacado_raiz),
          'vence_30d', coalesce(sum(valor) filter (where vencimento between current_date and current_date + 30), 0),
          'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
          'estagio', mode() within group (order by fornecedor_estagio),
          'cadastrado', bool_or(fornecedor_empresa_id is not null),
          'motivo', mode() within group (order by motivo),
          'docs_nf', count(*) filter (where tipo = 'nf'),
          'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
          'docs_ti', count(*) filter (where tipo = 'titulo')) as j
        from sd where fornecedor_raiz is not null
        group by fornecedor_raiz order by sum(valor) desc limit 30) c
      left join maior_sacado ms on ms.fornecedor_raiz = c.raiz) x
  ),

  -- ── Contas que dá para atribuir: a holding já é cliente, ex-cliente, tem gestão
  --    definida ou crédito aprovado. É onde UMA decisão de carteira esvazia a fila. ──
  j_contas as (
    select coalesce(jsonb_agg(x.j order by x.valor desc), '[]'::jsonb) as j from (
      select sum(valor) as valor, jsonb_build_object(
        'empresa_id', hold_id, 'nome', hold_nome, 'cnpj', hold_cnpj,
        'estagio', hold_estagio, 'gestao', hold_gestao,
        'cnpjs', count(distinct sacado_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'receita', coalesce(sum(receita_esperada), 0),
        'cedentes', count(distinct fornecedor_raiz),
        'alta_boa', count(*) filter (where faixa in ('alta', 'boa')),
        'credito', mode() within group (order by credit_status),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'carteira', (select string_agg(distinct v.nome, ', ')
                       from public.vendedor_carteira vc
                       join public.vendedores v on v.id = vc.vendedor_id
                      where vc.empresa_id = hold_id and vc.ate is null)) as j
      from sd
      where hold_id is not null
        and (hold_estagio in ('cliente', 'ex_cliente') or hold_gestao is not null
             or credit_status = 'APPROVED')
      group by hold_id, hold_nome, hold_cnpj, hold_estagio, hold_gestao
      order by sum(valor) desc limit 40) x
  ),

  -- ── Onde estão os documentos de cada originador ──────────────────────────────
  --    Vivos: a ordem do `case` é a ordem em que a tela descarta — nota não operável
  --    nunca entra no Kanban; card substituído some atrás do original; sem interesse
  --    e supressão saem do filtro padrão. Encerrados contam só o que é exibível, para
  --    a mesma operação não aparecer duas vezes (o título e a pré-autorização dele).
  com_dono as materialized (
    select d.vendedor_id, d.tipo, d.valor, si.motivo as si_motivo, d.fornecedor_cnpj,
           case
             when d.estagio_funil not in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento')
               then d.estagio_funil
             when not d.operavel then 'nao_operavel'
             when d.oculto then 'substituido'
             when si.cnpj is not null then 'sem_interesse'
             when exists (select 1 from public.supressao s
                           where s.escopo = 'empresa' and s.valor = d.fornecedor_cnpj
                             and (s.expira_em is null or s.expira_em >= current_date)) then 'suprimido'
             else 'no_funil'
           end as status
      from docs d
      left join public.antecipacao_fornecedor_sem_interesse si on si.cnpj = d.fornecedor_cnpj
     where d.vendedor_id is not null
       and (not d.oculto
            or d.estagio_funil in ('a_prospectar', 'em_prospeccao', 'em_negociacao', 'antecipacao_andamento'))
  ),
  o_status as (
    select vendedor_id, jsonb_agg(j order by valor desc) as j from (
      select vendedor_id, sum(valor) as valor, jsonb_build_object(
        'status', status, 'docs', count(*), 'valor', coalesce(sum(valor), 0),
        'docs_nf', count(*) filter (where tipo = 'nf'),
        'valor_nf', coalesce(sum(valor) filter (where tipo = 'nf'), 0),
        'docs_pa', count(*) filter (where tipo = 'pre_autorizacao'),
        'valor_pa', coalesce(sum(valor) filter (where tipo = 'pre_autorizacao'), 0),
        'docs_ti', count(*) filter (where tipo = 'titulo'),
        'valor_ti', coalesce(sum(valor) filter (where tipo = 'titulo'), 0)) as j
      from com_dono group by vendedor_id, status) t
    group by vendedor_id
  ),
  o_motivos as (
    select vendedor_id, jsonb_agg(j order by valor desc) as j from (
      select vendedor_id, sum(valor) as valor, jsonb_build_object(
        'motivo', coalesce(si_motivo, 'outro'), 'fornecedores', count(distinct fornecedor_cnpj),
        'docs', count(*), 'valor', coalesce(sum(valor), 0)) as j
      from com_dono where status = 'sem_interesse'
      group by vendedor_id, coalesce(si_motivo, 'outro')) t
    group by vendedor_id
  ),
  j_originadores as (
    select coalesce(jsonb_agg(x.j order by x.vivos desc), '[]'::jsonb) as j from (
      select (select count(*) from com_dono c
               where c.vendedor_id = s.vendedor_id
                 and c.status in ('no_funil', 'sem_interesse', 'suprimido', 'substituido', 'nao_operavel')) as vivos,
             jsonb_build_object(
               'vendedor_id', s.vendedor_id, 'nome', coalesce(v.nome, 'Vendedor removido'),
               'tipo', v.tipo, 'ativo', coalesce(v.ativo, false),
               'status', s.j, 'sem_interesse_motivos', coalesce(m.j, '[]'::jsonb)) as j
        from o_status s
        left join public.vendedores v on v.id = s.vendedor_id
        left join o_motivos m on m.vendedor_id = s.vendedor_id) x
  )

  select jsonb_build_object(
    'gerado_em', now(),
    'totais', (select j from j_totais),
    'motivos', (select j from j_motivos),
    'sacados', (select j from j_sacados),
    'cedentes', (select j from j_cedentes),
    'contas', (select j from j_contas),
    'originadores', (select j from j_originadores))
    into r;

  return r;
end
$function$;

revoke all on function public.app_report_documentos() from public, anon;
grant execute on function public.app_report_documentos() to authenticated, service_role;
