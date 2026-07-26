-- 0041 — Lista os clientes Onepay de um recorte da aba Análise (menu Empresas), ao
-- clicar num gráfico: dimensão = 'regiao' | 'camada' | 'capital', valor = a chave do
-- segmento clicado. Mesmos buckets/regiões do radar_onepay_analytics (0040). SECURITY
-- DEFINER com gate no Radar; junta clientes_onepay → mercado_universo como owner.
create or replace function public.radar_onepay_clientes(p_dimensao text, p_valor text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.app_tem_modulo('radar') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  with base as (
    select c.cnpj, c.nome, c.empresa_id, u.uf, u.camada, u.capital_social
    from public.clientes_onepay c
    left join public.mercado_universo u on u.cnpj = c.cnpj
  ),
  filtrado as (
    select b.* from base b
    where case p_dimensao
      when 'regiao' then case p_valor
        when 'norte' then b.uf in ('AC','AP','AM','PA','RO','RR','TO')
        when 'nordeste' then b.uf in ('AL','BA','CE','MA','PB','PE','PI','RN','SE')
        when 'centro_oeste' then b.uf in ('DF','GO','MT','MS')
        when 'sudeste' then b.uf in ('ES','MG','RJ','SP')
        when 'sul' then b.uf in ('PR','RS','SC')
        when 'sem_uf' then b.uf is null
        else false end
      when 'camada' then b.camada = p_valor
      when 'capital' then case p_valor
        when 'sem_dado' then b.capital_social is null
        when 'f1' then b.capital_social < 500000
        when 'f2' then b.capital_social >= 500000 and b.capital_social < 2000000
        when 'f3' then b.capital_social >= 2000000 and b.capital_social < 5000000
        when 'f4' then b.capital_social >= 5000000 and b.capital_social < 10000000
        when 'f5' then b.capital_social >= 10000000 and b.capital_social < 20000000
        when 'f6' then b.capital_social >= 20000000 and b.capital_social < 50000000
        when 'f7' then b.capital_social >= 50000000 and b.capital_social < 100000000
        when 'f8' then b.capital_social >= 100000000
        else false end
      else false end
  )
  select coalesce(jsonb_agg(to_jsonb(f) order by f.nome nulls last), '[]'::jsonb) into v
  from (select cnpj, nome, empresa_id, uf, camada, capital_social from filtrado) f;

  return jsonb_build_object('tem_acesso', true, 'clientes', v);
end $$;

revoke execute on function public.radar_onepay_clientes(text, text) from public;
grant execute on function public.radar_onepay_clientes(text, text) to authenticated;
