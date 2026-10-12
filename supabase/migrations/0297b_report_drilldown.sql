-- 0297b — Report semanal: o drill-down (04u §4). Continua a 0297a.

-- ─── §4 O drill-down ────────────────────────────────────────────────────────

/*
 * Os registros que formam um número do report.
 *
 * Cada ramo repete, PREDICADO POR PREDICADO, o `where` do agregador que produz o número
 * — `app__rp_operacao`, `_comercial`, `_carteira`. Não foi possível fazer o agregador
 * contar esta consulta (seria mudar cálculo existente, que o 04u proíbe), então a
 * igualdade é conferida por `app__rp_conferir()`, que roda os dois lados e compara.
 * Quem mexer num agregador mexe no ramo correspondente aqui, e roda a conferência.
 *
 * Cada ramo devolve `linha` (o registro), `ord` (ordenação, desc) e `val` (o que somar
 * quando o número clicado é um valor em reais, e não uma contagem).
 *
 * Parâmetros do SQL dinâmico: $1 início · $2 fim · $3 retrato · $4 params · $5 dias de
 * referência do VOP.
 */
create or replace function public.app__rp_detalhe(
  p_chave text, p_inicio date, p_fim date, p_retrato date,
  p_params jsonb default '{}'::jsonb, p_limite integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_ret date := coalesce(p_retrato, p_fim);
  v_p jsonb := coalesce(p_params, '{}'::jsonb);
  v_lim int := least(greatest(coalesce(p_limite, 50), 1), 1000);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_n numeric := coalesce((
    select p.valor from public.commission_params p
    where p.chave = 'dias_referencia_vop' and p.vendedor_id is null
      and p.vigente_de <= p_fim and (p.vigente_ate is null or p.vigente_ate >= p_fim)
    order by p.vigente_de desc limit 1
  ), 30);
  v_sql text;
  v_total int; v_soma numeric; v_linhas jsonb;
begin
  -- ── Operação ─────────────────────────────────────────────────────────────
  if p_chave in ('volume_convertido', 'vop_operado', 'receita') then
    v_sql := $q$
      select jsonb_build_object(
               'cedente', coalesce(a.fornecedor_nome, a.fornecedor_cnpj),
               'cnpj', a.fornecedor_cnpj,
               'sacado', coalesce(a.sacado_nome, a.sacado_cnpj),
               'nf', a.document_number,
               'valor', a.gross_value,
               'dias', a.anticipation_days,
               'vop', round(a.gross_value * coalesce(a.anticipation_days, 0) / $5, 2),
               'receita', a.total_spread,
               'taxa_am', a.monthly_interest_rate,
               'retencao', a.withhold_tax,
               'liquido', a.net_value,
               'convertida_em', a.convertida_em,
               'responsavel', (select v.nome from public.notas_fiscais nf
                                 join public.vendedores v on v.id = nf.vendedor_id
                                where nf.access_key = a.access_key_casada limit 1),
               'empresa_id', (select e.id from public.empresas e where e.cnpj = a.fornecedor_cnpj limit 1)
             ) as linha,
             extract(epoch from a.convertida_em)::float8 as ord,
             (case $4 ->> '_val'
                when 'vop' then a.gross_value * coalesce(a.anticipation_days, 0) / $5
                when 'receita' then a.total_spread
                else a.gross_value end)::numeric as val
      from public.antecipacoes a
      where a.convertida_em is not null
        and (a.convertida_em at time zone 'America/Sao_Paulo')::date between $1 and $2
    $q$;
    v_p := v_p || jsonb_build_object('_val', case p_chave when 'vop_operado' then 'vop'
                                                         when 'receita' then 'receita' else 'volume' end);

  elsif p_chave = 'limite_ocioso' then
    v_sql := $q$
      select jsonb_build_object(
               'cliente', coalesce(public.app__md_nome(e.razao_social), c.nome, c.cnpj),
               'cnpj', c.cnpj, 'empresa_id', c.empresa_id,
               'limite', c.credit_limit,
               'utilizado', coalesce(c.credit_limit, 0) - coalesce(c.available_limit, 0),
               'ocioso', c.available_limit,
               'aprovado_em', (select max(ac.decidida_em) from public.analises_credito ac
                                where ac.empresa_id = c.empresa_id
                                  and ac.estagio in ('aprovada', 'aprovada_parcial')),
               'dias_sem_operar', c.days_without_anticipation
             ) as linha,
             c.available_limit::float8 as ord, c.available_limit::numeric as val
      from public.app__rp_carteira_em($3) c
      left join public.empresas e on e.id = c.empresa_id
      where coalesce(c.available_limit, 0) > 0
    $q$;

  -- ── Comercial ────────────────────────────────────────────────────────────
  elsif p_chave = 'funil_etapa' then
    -- O `left join vendas` é o do agregador: um lead com duas vendas contaria duas vezes
    -- lá, e teria de contar duas aqui. (Hoje nenhum lead tem.)
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', l.empresa_id,
               'origem', l.origem, 'estagio', l.estagio,
               'fit', case when l.fit is true then 'com_fit' when l.fit is false then 'sem_fit' else 'nao_avaliado' end,
               'distribuido_em', l.distribuido_em,
               'reuniao_em', l.reuniao_em,
               'ganho_em', v.ganho_em,
               'responsavel', s.nome
             ) as linha,
             extract(epoch from l.distribuido_em)::float8 as ord, null::numeric as val
      from public.sdr_leads l
      left join public.vendas v on v.sdr_lead_id = l.id
      left join public.empresas e on e.id = l.empresa_id
      left join public.vendedores s on s.id = l.sdr_id
      where (l.distribuido_em at time zone 'America/Sao_Paulo')::date between $1 and $2
        and case $4 ->> 'etapa'
              when 'distribuidos' then true
              when 'contatados' then l.estagio <> 'a_contatar'
              when 'com_fit' then l.fit is true
              when 'agendados' then l.reuniao_em is not null
              when 'realizados' then l.estagio in ('reuniao_realizada', 'qualificada')
              when 'ganhos' then v.ganho_em is not null
              else false end
    $q$;

  elsif p_chave = 'fit_avaliados' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', l.empresa_id,
               'origem', l.origem,
               'fit', case when l.fit then 'com_fit' else 'sem_fit' end,
               'motivo', m.motivo,
               'avaliado_em', l.fit_definido_em,
               'avaliador', u.nome,
               'distribuido_em', l.distribuido_em,
               'responsavel', s.nome
             ) as linha,
             extract(epoch from l.fit_definido_em)::float8 as ord, null::numeric as val
      from public.sdr_leads l
      left join public.empresas e on e.id = l.empresa_id
      left join public.vendedores s on s.id = l.sdr_id
      left join public.usuarios u on u.id = l.fit_definido_por
      left join public.motivos_perda m on m.id = l.sem_fit_motivo and l.fit is false
      where l.fit is not null
        and (l.fit_definido_em at time zone 'America/Sao_Paulo')::date between $1 and $2
    $q$;

  elsif p_chave = 'reunioes_realizadas' then
    -- O número do report conta TRANSIÇÕES, e a lista é de transições: o lead que passou
    -- por "reunião realizada" e por "qualificada" na mesma semana aparece duas vezes.
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', l.empresa_id,
               'de', t.de, 'para', t.para, 'quando', t.em,
               'reuniao_em', l.reuniao_em,
               'condutor', vd.nome, 'responsavel', s.nome,
               'transcricao', (select r.url_fireflies from public.reunioes r
                                 join public.vendedor_eventos ve on ve.id = r.evento_id
                                where ve.sdr_lead_id = l.id and r.url_fireflies is not null
                                order by r.criada_em desc limit 1)
             ) as linha,
             extract(epoch from t.em)::float8 as ord, null::numeric as val
      from public.funil_transicoes t
      left join public.sdr_leads l on l.id = t.item_id
      left join public.empresas e on e.id = l.empresa_id
      left join public.vendedores vd on vd.id = l.vendedor_destino_id
      left join public.vendedores s on s.id = l.sdr_id
      where t.funil = 'sdr' and t.para in ('reuniao_realizada', 'qualificada')
        and (t.em at time zone 'America/Sao_Paulo')::date between $1 and $2
    $q$;

  elsif p_chave = 'no_shows' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', l.empresa_id,
               'origem', l.origem,
               'no_show_em', x.em, 'reuniao_em', l.reuniao_em,
               'condutor', vd.nome, 'responsavel', s.nome
             ) as linha,
             extract(epoch from x.em)::float8 as ord, null::numeric as val
      from public.app__rp_estagios_em('sdr', $3) x
      join public.sdr_leads l on l.id = x.item_id
      left join public.empresas e on e.id = l.empresa_id
      left join public.vendedores vd on vd.id = l.vendedor_destino_id
      left join public.vendedores s on s.id = l.sdr_id
      where x.estagio = 'no_show'
        and (l.encerrado_em is null or (l.encerrado_em at time zone 'America/Sao_Paulo')::date > $3)
    $q$;

  elsif p_chave = 'mous' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', v.empresa_id,
               'de', t.de, 'para', t.para, 'quando', t.em,
               'responsavel', vd.nome
             ) as linha,
             extract(epoch from t.em)::float8 as ord, null::numeric as val
      from public.funil_transicoes t
      left join public.vendas v on v.id = t.item_id
      left join public.empresas e on e.id = v.empresa_id
      left join public.vendedores vd on vd.id = v.vendedor_id
      where t.funil = 'vendedor' and t.para in ('mou_assinado', 'onboarding')
        and (t.em at time zone 'America/Sao_Paulo')::date between $1 and $2
    $q$;

  elsif p_chave = 'ciclo' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', v.empresa_id,
               'primeiro_contato', l.distribuido_em,
               'primeira_operacao', v.primeira_operacao_em,
               'duracao_dias', round(extract(epoch from (v.primeira_operacao_em - l.distribuido_em)) / 86400, 1),
               'responsavel', vd.nome
             ) as linha,
             extract(epoch from v.primeira_operacao_em)::float8 as ord, null::numeric as val
      from public.vendas v
      join public.sdr_leads l on l.id = v.sdr_lead_id
      left join public.empresas e on e.id = v.empresa_id
      left join public.vendedores vd on vd.id = v.vendedor_id
      where v.primeira_operacao_em is not null
        and v.primeira_operacao_em >= l.distribuido_em
        and v.primeira_operacao_em <= (($3 + 1)::timestamp at time zone 'America/Sao_Paulo')
    $q$;

  -- ── Notas fiscais ────────────────────────────────────────────────────────
  elsif p_chave in ('nf_faixa', 'nf_capturadas', 'nf_expiradas') then
    v_sql := $q$
      select jsonb_build_object(
               'nf', nf.numero,
               'sacado', coalesce(nf.sacado_nome, nf.sacado_cnpj),
               'fornecedor', coalesce(nf.fornecedor_nome, nf.fornecedor_cnpj),
               'valor', nf.valor, 'vencimento', nf.vencimento,
               'estagio', nf.estagio_funil, 'faixa', coalesce(nf.faixa, 'sem_faixa'),
               'capturada_em', nf.criada_em,
               'estagio_em', nf.estagio_alterado_em,
               'empresa_id', nf.sacado_empresa_id
             ) as linha,
             (case when $4 ->> '_modo' = 'expiradas' then nf.valor
                   else extract(epoch from nf.criada_em) end)::float8 as ord,
             nf.valor::numeric as val
      from public.notas_fiscais nf
      where case $4 ->> '_modo'
              when 'expiradas' then
                nf.estagio_funil = 'expirada'
                and (nf.estagio_alterado_em at time zone 'America/Sao_Paulo')::date between $1 and $2
              when 'faixa_doze' then
                coalesce(nf.faixa, 'sem_faixa') = $4 ->> 'faixa'
                and nf.criada_em >= (date_trunc('month', $2) - interval '11 months')
                and (nf.criada_em at time zone 'America/Sao_Paulo')::date <= $2
              when 'faixa_semana' then
                coalesce(nf.faixa, 'sem_faixa') = $4 ->> 'faixa'
                and nf.criada_em >= (date_trunc('month', $2) - interval '11 months')
                and (nf.criada_em at time zone 'America/Sao_Paulo')::date between $1 and $2
              else
                (nf.criada_em at time zone 'America/Sao_Paulo')::date between $1 and $2
            end
    $q$;
    v_p := v_p || jsonb_build_object('_modo', case
      when p_chave = 'nf_expiradas' then 'expiradas'
      when p_chave = 'nf_faixa' and v_p ->> 'serie' = 'doze' then 'faixa_doze'
      when p_chave = 'nf_faixa' then 'faixa_semana'
      else 'capturadas' end);

  elsif p_chave = 'nf_travadas' then
    v_sql := $q$
      select jsonb_build_object(
               'cedente', coalesce(a.fornecedor_nome, a.fornecedor_cnpj),
               'cnpj', a.fornecedor_cnpj,
               'sacado', coalesce(a.sacado_nome, a.sacado_cnpj),
               'nf', a.document_number,
               'status', a.status, 'valor', a.gross_value,
               'dias_parada', ($3 - (a.atualizada_em at time zone 'America/Sao_Paulo')::date),
               'empresa_id', (select e.id from public.empresas e where e.cnpj = a.fornecedor_cnpj limit 1)
             ) as linha,
             a.gross_value::float8 as ord, a.gross_value::numeric as val
      from public.antecipacoes a
      where a.status in ('DRAFT', 'REQUESTED', 'REPROVED', 'DENY_BY_CONTRACTED')
        and (a.convertida_em is null
             or (a.convertida_em at time zone 'America/Sao_Paulo')::date > $3)
        and (a.atualizada_em at time zone 'America/Sao_Paulo')::date <= $3 - 3
    $q$;

  -- ── Carteira ─────────────────────────────────────────────────────────────
  elsif p_chave in ('contas_paradas', 'carteira_gestor') then
    -- As barras por gestor são somas sobre a LISTA do report, que é das 25 maiores. A
    -- lista aqui é a mesma, cortada no mesmo lugar, e só depois filtrada pelo gestor.
    v_sql := $q$
      select t.linha, t.ord, t.val
      from (
        select jsonb_build_object(
                 'cliente', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), c.nome, c.cnpj),
                 'cnpj', c.cnpj, 'empresa_id', e.id,
                 'gestor', g.nome,
                 'ocioso', coalesce(c.available_limit, 0),
                 'limite', coalesce(c.credit_limit, 0),
                 'dias_sem_operar', c.days_without_anticipation,
                 'status', c.operation_status,
                 'ultima_operacao', co.last_anticipation,
                 'volume_acumulado', (select coalesce(sum(a.gross_value), 0) from public.antecipacoes a
                                       where a.sacado_cnpj = c.cnpj and a.convertida_em is not null)
               ) as linha,
               c.available_limit::float8 as ord,
               coalesce(c.available_limit, 0)::numeric as val,
               coalesce(g.nome, 'Sem gestor') as gestor
        from public.app__rp_carteira_em($3) c
        join public.empresas e on e.id = c.empresa_id
        left join public.clientes_onepay co on co.cnpj = c.cnpj
        left join lateral (
          select v.nome from public.vendedor_carteira vc
            join public.vendedores v on v.id = vc.vendedor_id
           where vc.empresa_id = e.id and vc.ate is null
           order by case vc.papel when 'gestao_passiva' then 1 when 'vendedor' then 2 else 3 end
           limit 1
        ) g on true
        where coalesce(c.available_limit, 0) >= 50000
          and (coalesce(c.days_without_anticipation, 0) >= 30
               or c.operation_status in ('inoperative', 'requires_attention', 'low_operation'))
        order by c.available_limit desc
        limit 25
      ) t
      where $4 ->> 'gestor' is null or t.gestor = $4 ->> 'gestor'
    $q$;

  -- ── Certificados ─────────────────────────────────────────────────────────
  elsif p_chave = 'cert_balde' then
    -- Três baldes DISJUNTOS que somam o universo: válido (folga de 30 dias), vencendo
    -- (válido, cai nos próximos 30) e sem (nunca teve, ou já venceu).
    -- A NF escondida só aparece na MATRIZ: o estimador dá a cada SPE o porte do grupo, e
    -- somar linha a linha contaria o mesmo grupo quarenta vezes.
    -- `offset 0` na razão é cerca de otimização: sem ele o planejador achata a subconsulta
    -- e a função roda a cada matriz — 19,5 s medidos, contra menos de 1 s.
    v_sql := $q$
      select jsonb_build_object(
               'conta', coalesce(public.app__md_nome(cu.razao_social), cu.cnpj),
               'cnpj', cu.cnpj, 'empresa_id', cu.empresa_id,
               'tipo', case when cu.e_matriz then 'Matriz' else 'SPE' end,
               'validade', cu.expires_at,
               'nf_escondida_mes', case when $4 ->> 'balde' = 'sem' and cu.e_matriz
                                        then round(e.faturamento_anual / 12.0 * rz.razao, 2) end
             ) as linha,
             extract(epoch from cu.expires_at)::float8 as ord, null::numeric as val
      from public.certificado_universo cu
      left join public.empresas e on e.id = cu.empresa_id
      cross join (select (public.app__rp_certificados_cegos(1, $3) ->> 'razao')::numeric as razao offset 0) rz
      where case $4 ->> 'balde'
              when 'validos' then cu.expires_at is not null and cu.expires_at > ($3 + 30)
              when 'vencendo' then cu.expires_at > $3 and cu.expires_at <= ($3 + 30)
              when 'sem' then cu.expires_at is null or cu.expires_at <= $3
              else false end
    $q$;

  elsif p_chave = 'cert_topo' then
    v_sql := $q$
      select x.value as linha,
             (x.value ->> 'invisivel_mes')::float8 as ord,
             (x.value ->> 'invisivel_mes')::numeric as val
      from jsonb_array_elements(public.app__rp_certificados_cegos(15, $3) -> 'itens') x
    $q$;

  -- ── Time ─────────────────────────────────────────────────────────────────
  elsif p_chave = 'time_vendedor' then
    v_sql := $q$
      select jsonb_build_object(
               'cedente', coalesce(c.cedente_nome, c.cedente_cnpj),
               'empresa_id', c.empresa_id,
               'nf', c.nf_numero, 'papel', c.papel, 'fase', c.fase,
               'valor_cedido', c.valor_cedido, 'dias', c.anticipation_days,
               'vop', c.vop, 'comissao', c.valor,
               'evento_em', c.evento_em, 'status', c.status
             ) as linha,
             extract(epoch from c.evento_em)::float8 as ord, coalesce(c.vop, 0)::numeric as val
      from public.comissao_lancamentos_v2 c
      where c.vendedor_id::text = $4 ->> 'vendedor_id'
        and (c.evento_em at time zone 'America/Sao_Paulo')::date between $1 and $2
    $q$;

  -- ── Exige atenção ────────────────────────────────────────────────────────
  elsif p_chave = 'atencao' then
    v_sql := case v_p ->> 'item'
      when 'limites_reduzidos' then $q$
        select jsonb_build_object(
                 'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
                 'empresa_id', ev.empresa_id,
                 'antes', (ev.payload ->> 'antes')::numeric,
                 'depois', (ev.payload ->> 'depois')::numeric,
                 'quando', ev.criado_em) as linha,
               extract(epoch from ev.criado_em)::float8 as ord, null::numeric as val
        from public.empresa_eventos ev
        left join public.empresas e on e.id = ev.empresa_id
        where ev.tipo = 'sacado.credito_alterado'
          and (ev.criado_em at time zone 'America/Sao_Paulo')::date between $1 and $2
          and coalesce((ev.payload ->> 'depois')::numeric, 0) < coalesce((ev.payload ->> 'antes')::numeric, 0)
      $q$
      when 'protestos_novos' then $q$
        select jsonb_build_object(
                 'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
                 'empresa_id', e.id,
                 'protestos', pc.qtd_protestos, 'valor', pc.valor_total,
                 'quando', pc.consultado_em) as linha,
               extract(epoch from pc.consultado_em)::float8 as ord, null::numeric as val
        from public.protestos_consultas pc
        join public.empresas e on e.id = pc.empresa_id
        where pc.tem_protesto and e.estagio = 'cliente'
          and (pc.consultado_em at time zone 'America/Sao_Paulo')::date between $1 and $2
      $q$
      when 'processos_com_movimento' then $q$
        select jsonb_build_object(
                 'processo', m.numero_cnj,
                 'movimentacoes', count(*)::int,
                 'tipo', (array_agg(m.tipo order by m.criado_em desc))[1],
                 'quando', max(m.criado_em)) as linha,
               extract(epoch from max(m.criado_em))::float8 as ord, null::numeric as val
        from public.processo_movimentacoes m
        where m.relevante
          and (m.criado_em at time zone 'America/Sao_Paulo')::date between $1 and $2
        group by m.numero_cnj
      $q$
      when 'ex_clientes_sem_motivo' then $q$
        select jsonb_build_object(
                 'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
                 'empresa_id', ev.empresa_id,
                 'quando', ev.criado_em) as linha,
               extract(epoch from ev.criado_em)::float8 as ord, null::numeric as val
        from public.empresa_eventos ev
        left join public.empresas e on e.id = ev.empresa_id
        where ev.tipo = 'cliente.tornou_ex'
          and (ev.criado_em at time zone 'America/Sao_Paulo')::date between $1 and $2
          and coalesce(ev.payload ->> 'motivo', '') = ''
      $q$
      when 'certificados_vencendo_30d' then $q$
        select jsonb_build_object(
                 'conta', coalesce(public.app__md_nome(cu.razao_social), cu.cnpj),
                 'cnpj', cu.cnpj, 'empresa_id', cu.empresa_id,
                 'tipo', case when cu.e_matriz then 'Matriz' else 'SPE' end,
                 'validade', cu.expires_at) as linha,
               -extract(epoch from cu.expires_at)::float8 as ord, null::numeric as val
        from public.certificado_universo cu
        where cu.expires_at > $3 and cu.expires_at <= ($3 + 30)
      $q$
      when 'lotes_aguardando' then $q$
        select jsonb_build_object(
                 'lote', l.nome, 'tipo', l.tipo, 'itens', l.total_itens,
                 'valor', l.custo_estimado_esperado, 'quando', l.criado_em) as linha,
               extract(epoch from l.criado_em)::float8 as ord, null::numeric as val
        from public.lotes_enriquecimento l
        where l.status = 'aguardando_aprovacao'
          and (l.criado_em at time zone 'America/Sao_Paulo')::date <= $3
      $q$
      when 'sugestoes_perfil_pendentes' then $q$
        select jsonb_build_object(
                 'regra', s.regra_tipo, 'chave_regra', s.regra_chave,
                 'sugestao', left(coalesce(s.sugestao ->> 'titulo', s.sugestao ->> 'descricao', s.sugestao::text), 140),
                 'quando', s.em) as linha,
               extract(epoch from s.em)::float8 as ord, null::numeric as val
        from public.perfil_sugestoes_log s
        where s.acao = 'pendente'
          and (s.em at time zone 'America/Sao_Paulo')::date <= $3
      $q$
      when 'fornecedores_sem_contato' then $q$
        select jsonb_build_object(
                 'fornecedor', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), f.fornecedor_cnpj),
                 'cnpj', f.fornecedor_cnpj, 'empresa_id', f.empresa_id,
                 'volume_90d', f.volume_90d, 'potencial_mensal', f.potencial_mensal,
                 'quando', f.entrou_em) as linha,
               coalesce(f.volume_90d, 0)::float8 as ord, null::numeric as val
        from public.fornecedores_funil f
        left join public.empresas e on e.id = f.empresa_id
        where f.estagio = 'sem_contato'
          and (f.entrou_em at time zone 'America/Sao_Paulo')::date <= $3
      $q$
      else null end;

  -- ── Aquisição (04u §2.4) ─────────────────────────────────────────────────
  elsif p_chave = 'aq_leads' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', x.empresa_id,
               'contato', ct.nome,
               'origem', x.origem_bruta,
               'responsavel', s.nome,
               'distribuido_em', x.distribuido_em,
               'estagio', x.estagio,
               'fit', x.fit,
               'avaliado_em', x.fit_definido_em,
               'encerrado', x.encerrado_motivo
             ) as linha,
             extract(epoch from x.distribuido_em)::float8 as ord, null::numeric as val
      from public.app__rp_aq_leads($1, $2) x
      left join public.empresas e on e.id = x.empresa_id
      left join public.vendedores s on s.id = x.sdr_id
      left join lateral (
        select c.nome from public.contatos c
        where c.empresa_id = x.empresa_id and c.nome is not null
        order by c.ponto_focal desc, c.criado_em limit 1
      ) ct on true
      where (coalesce($4 ->> 'origem', 'total') = 'total' or x.origem = $4 ->> 'origem')
        and (coalesce($4 ->> 'fit', 'total') = 'total' or x.fit = $4 ->> 'fit')
    $q$;

  elsif p_chave = 'aq_reunioes' then
    v_sql := $q$
      select jsonb_build_object(
               'empresa', coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia), e.cnpj),
               'empresa_id', x.empresa_id,
               'contato', ct.nome,
               'origem', coalesce(l.origem, 'sem_origem'),
               'responsavel', s.nome,
               'condutor', vd.nome,
               'agendada_em', x.agendada_em,
               'inicio_em', x.inicio_em,
               'quando', x.quando,
               'distribuido_em', l.distribuido_em,
               'estagio', l.estagio,
               'captura', x.captura
             ) as linha,
             extract(epoch from x.quando)::float8 as ord, null::numeric as val
      from public.app__rp_aq_reunioes($1, $2) x
      left join public.sdr_leads l on l.id = x.lead_id
      left join public.empresas e on e.id = x.empresa_id
      left join public.vendedores s on s.id = l.sdr_id
      left join public.vendedores vd on vd.id = x.vendedor_id
      left join lateral (
        select c.nome from public.contatos c
        where c.empresa_id = x.empresa_id and c.nome is not null
        order by c.ponto_focal desc, c.criado_em limit 1
      ) ct on true
      where x.fato = $4 ->> 'fato'
        and (coalesce($4 ->> 'origem', 'total') = 'total' or x.origem = $4 ->> 'origem')
    $q$;
  end if;

  if v_sql is null then
    raise exception 'Detalhe desconhecido: %', p_chave using errcode = '22023';
  end if;

  /* `materialized`: a base é lida uma vez e serve à contagem, à soma e à página. O
     total é o do conjunto INTEIRO, não o da página — é ele que se compara ao número. */
  execute format($w$
    with base as materialized (%s)
    select count(*)::int, coalesce(sum(b.val), 0),
           (select coalesce(jsonb_agg(p.linha order by p.ord desc nulls last, p.txt), '[]'::jsonb)
              from (select b2.linha, b2.ord, b2.linha::text as txt
                      from base b2
                     order by b2.ord desc nulls last, b2.linha::text
                     limit $6 offset $7) p)
    from base b
  $w$, v_sql)
  into v_total, v_soma, v_linhas
  using p_inicio, p_fim, v_ret, v_p, v_n, v_lim, v_off;

  return jsonb_build_object(
    'chave', p_chave, 'total', v_total, 'soma', v_soma,
    'limite', v_lim, 'offset', v_off, 'linhas', v_linhas);
end $function$;

/** A porta autorizada do drill-down. Mesma régua do report: gestor. */
create or replace function public.app_report_detalhe(
  p_chave text, p_inicio date, p_fim date,
  p_params jsonb default '{}'::jsonb, p_limite integer default 50, p_offset integer default 0,
  p_retrato date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not public.app_report_gestor() then
    raise exception 'O Report Semanal é leitura de gestor.' using errcode = '42501';
  end if;
  return public.app__rp_detalhe(p_chave, p_inicio, p_fim, coalesce(p_retrato, current_date),
                                p_params, p_limite, p_offset);
end $function$;
