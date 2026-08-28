-- ─── 0142 · A carteira mostra o limite que ainda dá para usar ───────────────
--
-- A carteira dizia o que a empresa JÁ produziu (volume no mês, NFs vivas) e nada
-- sobre o que ela AINDA pode produzir. Essa é a pergunta que o comercial faz antes
-- de ligar: "sobra limite nessa conta?". Sem a resposta na lista, ele abre ficha por
-- ficha — ou, pior, liga para quem está com 100% consumido e não tem o que antecipar.
--
-- Os três números vêm do temperature report da Onepay, que o sync diário já
-- materializa em `clientes_onepay`. Nenhuma coluna nova: só expor o que já existe.
--
--   available_limit   quanto sobra. É a coluna acionável.
--   consumed_pct      quanto já foi. Diz se "sobra pouco" é conta parada ou conta
--                     no talo — R$ 100 mil livres num limite de R$ 200 mil e num de
--                     R$ 20 milhões são situações opostas.
--   operation_status  o veredito da Onepay. Uma conta `inoperative` tem limite
--                     livre no papel e não opera; oferecer limite ali é queimar
--                     ligação.
--
-- O join é por CNPJ, e não por `clientes_onepay.empresa_id`: o CNPJ é a chave
-- primária de lá e a natural daqui, então casa mesmo se o vínculo com `empresas`
-- ainda não tiver sido resolvido pelo sync.
--
-- O limite é do CNPJ da holding, NÃO do grupo — diferente do volume e das NFs, que
-- somam as SPEs. É assim porque é assim na Onepay: hoje nenhuma SPE tem limite
-- próprio, o cadastro de crédito é da holding. Somar SPEs aqui inventaria um total
-- que não existe em lugar nenhum.
--
-- `atualizado_em` vai junto porque o sync é diário: sem a data, um limite de ontem
-- se lê como o de agora, e é a partir dele que alguém promete uma operação.

create or replace function public.comercial_carteira_vendedor(p_vendedor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_id uuid := coalesce(p_vendedor_id, public.app_vendedor_atual());
  v_tipo text;
  v_de date := date_trunc('month', now())::date;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if v_id is null then
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true);
  end if;
  if not public.app_pode_ver_vendedor(v_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select tipo into v_tipo from public.vendedores where id = v_id;

  return jsonb_build_object(
    'tem_acesso', true,
    'vendedor_id', v_id,
    'tipo', v_tipo,
    'competencia', v_de,
    'passivas', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.volume_mes desc nulls last), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.faturamento_anual,
               c.desde,
               e.gestao_operacao,
               -- Quantas SPEs esta holding tem no grupo. É o tamanho do que ela arrasta.
               (select count(*)::int from public.mercado_universo u
                 where e.grupo_id is not null and u.grupo_id = e.grupo_id and u.is_spe) as spes,
               (select coalesce(sum(a.gross_value), 0) from public.antecipacoes a
                 where a.regrediu_em is null
                   and a.convertida_em >= v_de
                   and a.convertida_em < (v_de + interval '1 month')
                   and public.app_holding_do_sacado(a.sacado_cnpj) = e.id) as volume_mes,
               (select count(*)::int from public.antecipacoes a
                 where a.regrediu_em is null
                   and a.convertida_em >= v_de
                   and a.convertida_em < (v_de + interval '1 month')
                   and a.sacado_cnpj <> e.cnpj
                   and public.app_holding_do_sacado(a.sacado_cnpj) = e.id) as operacoes_via_spe,
               -- Onepay: o que ainda dá para antecipar nesta conta.
               o.credit_limit, o.available_limit, o.consumed_pct,
               o.operation_status, o.atualizado_em as limite_em
        from public.vendedor_carteira c
        join public.empresas e on e.id = c.empresa_id
        left join public.clientes_onepay o on o.cnpj = e.cnpj
        where c.vendedor_id = v_id and c.papel = 'gestao_passiva' and c.ate is null
      ) x
    ),
    'originacao', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.razao_social), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.estagio, e.gestao_operacao,
               (select count(*)::int from public.mercado_universo u
                 where e.grupo_id is not null and u.grupo_id = e.grupo_id and u.is_spe) as spes,
               -- Conta a nota da holding E a das SPEs dela: é o que o roteamento entrega.
               (select count(*)::int from public.notas_fiscais nf
                 where nf.vendedor_id = v_id
                   and nf.estagio_funil not in ('convertida', 'perdida')
                   and (nf.fornecedor_empresa_id = e.id
                        or nf.sacado_empresa_id = e.id
                        or public.app_holding_do_sacado(nf.sacado_cnpj) = e.id)) as nfs_vivas,
               o.credit_limit, o.available_limit, o.consumed_pct,
               o.operation_status, o.atualizado_em as limite_em
        from public.empresas e
        left join public.clientes_onepay o on o.cnpj = e.cnpj
        where e.id::text in (
          select jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb))
          from public.vendedores v where v.id = v_id
        )
      ) x
    )
  );
end $function$;

revoke execute on function public.comercial_carteira_vendedor(uuid) from public;
grant execute on function public.comercial_carteira_vendedor(uuid) to authenticated, service_role;
