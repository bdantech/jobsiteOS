-- 0297c — Report semanal: conferência, permissões e primeira carga (04u). Continua a 0297b.

-- ─── §4.1 A conferência: o agregado bate com o detalhe? ─────────────────────

/*
 * Para cada número clicável, o valor que o report exibe e o total (ou a soma) que o
 * drill-down devolve. `bate = false` é BUG — não arredondamento.
 *
 * É o teste de consistência do 04u, e mora no banco porque é onde os dois lados moram:
 * um teste no core só conseguiria comparar um mock com outro mock.
 */
create or replace function public.app__rp_conferir(
  p_inicio date default null, p_fim date default null, p_retrato date default null
)
returns table (chave text, params jsonb, medida text, agregado numeric, detalhe numeric, bate boolean)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_fim date := coalesce(p_fim, current_date - extract(isodow from current_date)::int);
  v_ini date := coalesce(p_inicio, v_fim - 6);
  v_ret date := coalesce(p_retrato, v_fim);
  r jsonb := public.app__rp_montar(v_ini, v_fim, v_ret);
  v_specs jsonb := '[]'::jsonb;
  s jsonb; d jsonb; x jsonb; k text;
begin
  -- Operação
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('c', 'volume_convertido', 'm', 'total', 'a', r #> '{operacao,antecipacao,operacoes_semana}'),
    jsonb_build_object('c', 'volume_convertido', 'm', 'soma', 'a', r #> '{operacao,kpis,volume_convertido,semana}'),
    jsonb_build_object('c', 'vop_operado', 'm', 'soma', 'a', r #> '{operacao,kpis,vop_operado,semana}'),
    jsonb_build_object('c', 'receita', 'm', 'soma', 'a', r #> '{operacao,kpis,receita,semana}'),
    jsonb_build_object('c', 'limite_ocioso', 'm', 'soma', 'a', r #> '{operacao,kpis,limite_ocioso,foto}'),
    jsonb_build_object('c', 'nf_capturadas', 'm', 'total', 'a', r #> '{operacao,nf,capturadas,semana}'),
    jsonb_build_object('c', 'nf_capturadas', 'm', 'soma', 'a', r #> '{operacao,nf,valor_capturado,semana}'),
    jsonb_build_object('c', 'nf_expiradas', 'm', 'soma', 'a', r #> '{operacao,nf,valor_expirado,semana}'),
    jsonb_build_object('c', 'nf_travadas', 'm', 'total', 'a', r #> '{operacao,nf,travadas,total}'),
    jsonb_build_object('c', 'nf_travadas', 'm', 'soma', 'a', r #> '{operacao,nf,travadas,valor}'));
  for x in select * from jsonb_array_elements(r #> '{operacao,nf,por_faixa}') loop
    v_specs := v_specs || jsonb_build_array(
      jsonb_build_object('c', 'nf_faixa', 'p', jsonb_build_object('faixa', x ->> 'faixa', 'serie', 'semana'),
                         'm', 'total', 'a', x -> 'entradas_semana'),
      jsonb_build_object('c', 'nf_faixa', 'p', jsonb_build_object('faixa', x ->> 'faixa', 'serie', 'doze'),
                         'm', 'total', 'a', x -> 'entradas_12m'));
  end loop;

  -- Comercial
  foreach k in array array['distribuidos', 'contatados', 'com_fit', 'agendados', 'realizados', 'ganhos'] loop
    v_specs := v_specs || jsonb_build_array(
      jsonb_build_object('c', 'funil_etapa', 'p', jsonb_build_object('etapa', k), 'm', 'total',
                         'a', coalesce(r #> array['comercial', 'funil', 'semana', k], '0'::jsonb)));
  end loop;
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('c', 'fit_avaliados', 'm', 'total', 'a', r #> '{comercial,comercial,fit_avaliados}'),
    jsonb_build_object('c', 'reunioes_realizadas', 'm', 'total', 'a', r #> '{comercial,comercial,reunioes_realizadas}'),
    jsonb_build_object('c', 'no_shows', 'm', 'total', 'a', r #> '{comercial,comercial,no_shows_nao_remarcados}'),
    jsonb_build_object('c', 'mous', 'm', 'total', 'a', r #> '{comercial,comercial,mous}'),
    jsonb_build_object('c', 'ciclo', 'm', 'total', 'a', r #> '{comercial,comercial,ciclo_medio_base}'));
  for x in select * from jsonb_array_elements(r #> '{comercial,time,vendedores}') loop
    v_specs := v_specs || jsonb_build_array(
      jsonb_build_object('c', 'time_vendedor', 'p', jsonb_build_object('vendedor_id', x ->> 'vendedor_id'),
                         'm', 'total', 'a', x -> 'conversoes'),
      jsonb_build_object('c', 'time_vendedor', 'p', jsonb_build_object('vendedor_id', x ->> 'vendedor_id'),
                         'm', 'soma', 'a', x -> 'vop'));
  end loop;

  -- Carteira e certificados
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('c', 'contas_paradas', 'm', 'total',
                       'a', jsonb_array_length(r #> '{carteira,listas,nao_performando}')),
    jsonb_build_object('c', 'cert_balde', 'p', '{"balde":"validos"}'::jsonb, 'm', 'total',
                       'a', r #> '{carteira,certificados,cobertos}'),
    jsonb_build_object('c', 'cert_balde', 'p', '{"balde":"vencendo"}'::jsonb, 'm', 'total',
                       'a', r #> '{carteira,certificados,vencendo_30d}'),
    jsonb_build_object('c', 'cert_balde', 'p', '{"balde":"sem"}'::jsonb, 'm', 'total',
                       'a', (r #>> '{carteira,certificados,sem_certificado}')::int
                            - (r #>> '{carteira,certificados,vencendo_30d}')::int),
    jsonb_build_object('c', 'cert_topo', 'm', 'total',
                       'a', jsonb_array_length(r #> '{carteira,certificados,invisivel,itens}')),
    jsonb_build_object('c', 'cert_topo', 'm', 'soma',
                       'a', coalesce(r #> '{carteira,certificados,invisivel,total_mes_do_topo}', '0'::jsonb)));
  for x in
    select jsonb_build_object('g', coalesce(i ->> 'gestor', 'Sem gestor'), 's', sum((i ->> 'ocioso')::numeric))
    from jsonb_array_elements(r #> '{carteira,listas,nao_performando}') i
    group by coalesce(i ->> 'gestor', 'Sem gestor')
  loop
    v_specs := v_specs || jsonb_build_array(
      jsonb_build_object('c', 'carteira_gestor', 'p', jsonb_build_object('gestor', x ->> 'g'),
                         'm', 'soma', 'a', x -> 's'));
  end loop;
  for k in select jsonb_object_keys(r #> '{carteira,atencao}') loop
    v_specs := v_specs || jsonb_build_array(case k
      when 'antecipacoes_travadas' then
        jsonb_build_object('c', 'nf_travadas', 'p', jsonb_build_object('_de', 'atencao'), 'm', 'total',
                           'a', r #> array['carteira', 'atencao', k])
      else
        jsonb_build_object('c', 'atencao', 'p', jsonb_build_object('item', k), 'm', 'total',
                           'a', r #> array['carteira', 'atencao', k]) end);
  end loop;

  -- Aquisição: cada célula da matriz e cada contagem de reunião, por origem
  for x in select * from jsonb_array_elements(r #> '{aquisicao,origens}') loop
    foreach k in array array['com_fit', 'sem_fit', 'nao_avaliado'] loop
      v_specs := v_specs || jsonb_build_array(
        jsonb_build_object('c', 'aq_leads', 'p', jsonb_build_object('origem', x ->> 'origem', 'fit', k),
                           'm', 'total', 'a', x -> k));
    end loop;
    v_specs := v_specs || jsonb_build_array(
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'agendada'), 'm', 'total', 'a', x -> 'agendadas'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'realizada'), 'm', 'total', 'a', x -> 'realizadas'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'cancelada'), 'm', 'total', 'a', x -> 'canceladas'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'remarcada'), 'm', 'total', 'a', x -> 'remarcadas'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'no_show'), 'm', 'total', 'a', x -> 'no_shows'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'sem_captura'), 'm', 'total', 'a', x -> 'sem_captura'),
      jsonb_build_object('c', 'aq_reunioes', 'p', jsonb_build_object('origem', x ->> 'origem', 'fato', 'sem_desfecho'), 'm', 'total', 'a', x -> 'sem_desfecho'));
  end loop;
  -- O total de leads da Aquisição é o mesmo "Leads" do bloco comercial: mesma coorte.
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('c', 'aq_leads', 'p', '{"origem":"total","fit":"total"}'::jsonb, 'm', 'total',
                       'a', r #> '{comercial,comercial,leads_semana}'));

  for s in select * from jsonb_array_elements(v_specs) loop
    d := public.app__rp_detalhe(s ->> 'c', v_ini, v_fim, v_ret, coalesce(s -> 'p', '{}'::jsonb), 1, 0);
    chave := s ->> 'c';
    params := coalesce(s -> 'p', '{}'::jsonb);
    medida := s ->> 'm';
    agregado := coalesce((s ->> 'a')::numeric, 0);
    detalhe := (d ->> (s ->> 'm'))::numeric;
    bate := round(agregado, 2) = round(detalhe, 2);
    return next;
  end loop;
end $function$;

-- ─── Quem pode executar ─────────────────────────────────────────────────────

/*
 * As funções `app__rp_*` são a MECÂNICA: security definer, sem checagem de sessão,
 * feitas para o worker (service role) e para serem chamadas por dentro das portas
 * `app_report_*`, que conferem o gestor.
 *
 * A 0192 as deixou com o grant padrão do Supabase — EXECUTE para `anon` e
 * `authenticated`. Pela API, `rpc/app__rp_montar` devolvia o report inteiro, com a
 * comissão nominal de cada vendedor, a quem tivesse a chave pública do projeto. Fecha
 * aqui, para as antigas e para as novas. Nenhum cliente as chama: só o worker.
 */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_\_rp\_%'
           or p.proname in ('app_report_materializar_series', 'app_report_materializar_aquisicao',
                            'app__sdr_lead_fit_autor'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end $$;

revoke execute on function public.app_report_aquisicao(date, date) from public, anon;
revoke execute on function public.app_report_aquisicao_historico(integer) from public, anon;
revoke execute on function public.app_report_detalhe(text, date, date, jsonb, integer, integer, date) from public, anon;
grant execute on function public.app_report_aquisicao(date, date) to authenticated, service_role;
grant execute on function public.app_report_aquisicao_historico(integer) to authenticated, service_role;
grant execute on function public.app_report_detalhe(text, date, date, jsonb, integer, integer, date) to authenticated, service_role;

-- A primeira carga da série: as treze semanas fechadas mais recentes.
select public.app_report_materializar_aquisicao(13);
