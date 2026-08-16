-- =============================================================================
-- 0117 — O funil de certificados pelos olhos de um originador
--
-- O recorte por carteira já funcionava: logado como o originador, `certificado_funil()`
-- devolve exatamente as empresas de `vendedor_carteira`. O que faltava era o GESTOR
-- poder olhar por essa janela — ele vê os 47 cards e não tinha como perguntar "e a
-- carteira do Fulano, como está?".
--
-- Sem isso o recorte é invisível para quem administra, e o que é invisível parece
-- quebrado: foi exatamente esse o relato. Mesmo desenho dos outros funis do Comercial,
-- que já recebem `p_vendedor_id`.
--
-- O PARÂMETRO NÃO AMPLIA NADA. Quem não é gestor continua preso à própria carteira,
-- independente do que mandar no argumento — um filtro de tela que virasse porta de
-- acesso seria a pior troca possível por uma conveniência de administração.
-- =============================================================================

create or replace function public.certificado_funil(p_vendedor_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_vendedor uuid;
  v_gestor boolean;
  v_escopo uuid[];
  v_filtrar boolean;
  v_cards jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  v_gestor := public.app_gestor_comercial();
  v_vendedor := public.app_vendedor_atual();

  /*
   * Quem define o escopo:
   *   não-gestor          → a própria carteira, SEMPRE. `p_vendedor_id` é ignorado.
   *   gestor sem filtro   → tudo.
   *   gestor com filtro   → a carteira do vendedor pedido.
   *
   * A ordem importa: checar o gestor primeiro e só então olhar o parâmetro é o que
   * impede o argumento de virar escalada de privilégio.
   */
  v_filtrar := (not v_gestor) or p_vendedor_id is not null;

  if v_filtrar then
    select coalesce(array_agg(c.empresa_id), '{}'::uuid[]) into v_escopo
    from public.vendedor_carteira c
    where c.vendedor_id = case when v_gestor then p_vendedor_id else v_vendedor end
      and c.papel = 'originacao' and c.ate is null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.pendentes desc, x.nome), '[]'::jsonb)
    into v_cards
  from (
    select
      k.id as card_id, k.estagio, k.perdido_motivo, mp.motivo as perdido_motivo_label,
      k.perdido_em, k.ganho_em, k.observacao, k.aberto_em, k.atualizado_em,
      e.id as empresa_id, e.cnpj,
      coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as nome,
      u.total, u.cobertos, u.total - u.cobertos as pendentes,
      u.matriz_coberta, u.matriz_expira_em, u.cnpjs
    from public.certificado_cards k
    join public.empresas e on e.id = k.empresa_id
    left join public.motivos_perda mp on mp.id = k.perdido_motivo
    join lateral (
      select
        count(*)::int as total,
        count(*) filter (where cu.coberto)::int as cobertos,
        coalesce(bool_or(cu.coberto) filter (where cu.e_matriz), false) as matriz_coberta,
        max(cu.expires_at) filter (where cu.e_matriz) as matriz_expira_em,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'cnpj', cu.cnpj, 'nome', cu.razao_social, 'e_matriz', cu.e_matriz,
            'coberto', cu.coberto, 'expires_at', cu.expires_at
          )
          order by cu.e_matriz desc, cu.coberto, cu.expires_at nulls first, cu.razao_social
        ), '[]'::jsonb) as cnpjs
      from public.certificado_universo cu
      where cu.empresa_id = k.empresa_id
    ) u on true
    where (not v_filtrar) or e.id = any(v_escopo)
  ) x;

  return jsonb_build_object(
    'tem_acesso', true,
    'eh_gestor', v_gestor,
    'vendedor_id', case when v_gestor then p_vendedor_id else v_vendedor end,
    'cards', v_cards,
    'sincronizado_em', (select max(sincronizado_em) from public.certificados)
  );
end $$;

comment on function public.certificado_funil(uuid) is
  'O funil inteiro, ou a carteira de um originador quando `p_vendedor_id` vem. Quem '
  'não é gestor fica preso à própria carteira independente do argumento — o filtro é '
  'conveniência de administração, nunca porta de acesso.';

revoke all on function public.certificado_funil(uuid) from public;
grant execute on function public.certificado_funil(uuid) to authenticated;

-- A versão sem argumento sai de cena: duas assinaturas para a mesma pergunta é como se
-- produz uma chamada que resolve para a errada.
drop function if exists public.certificado_funil();

-- ─── Um motivo a mais na saída de cliente ───────────────────────────────────
--
-- RECUPERÁVEL, e a classificação merece a justificativa: "não performou" é sobre o
-- VOLUME que não veio, não sobre risco de crédito nem sobre uma porta que fechamos.
-- Uma obra nova, um ciclo melhor ou uma proposta recalibrada mudam esse número —
-- diferente de default e de crédito cancelado, que são juízo sobre o CNPJ.

insert into public.motivos_perda (contexto, motivo, ordem, retorno_possivel)
values ('ex_cliente', 'Operação não performou', 35, true)
on conflict (contexto, motivo) do update set retorno_possivel = true, ativo = true;
