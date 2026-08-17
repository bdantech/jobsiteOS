-- =============================================================================
-- 0121 — O dono no próprio card, e como trocá-lo
--
-- Num kanban sem filtro de vendedor, "de quem é este card?" era invisível — e, no
-- funil de reuniões, REATRIBUIR não existia em lugar nenhum da interface. Isso
-- apareceu de um jeito concreto: o primeiro lead inbound da base caiu no vendedor
-- errado (não havia SDR cadastrado) e não havia tela para consertar.
--
-- Três funis têm dono no próprio card e ganham RPC de troca:
--   reuniões   `sdr_leads.sdr_id`
--   vendas     `vendas.vendedor_id`
--   NFs        `notas_fiscais.vendedor_id`  (já tinha `app_atribuir_nf`)
--
-- O QUARTO NÃO TEM, e é de propósito que ele fique de fora. No funil de certificados
-- quem enxerga cada cliente vem de `vendedor_carteira`: trocar ali não é editar um
-- card, é mover a empresa de carteira — e isso leva junto o roteamento das NFs dela e
-- a comissão. O card passa a MOSTRAR o dono e manda para a tela de Carteira, onde a
-- decisão tem o contexto que ela exige.
--
-- SÓ GESTOR TROCA, seguindo o precedente de `app_atribuir_nf` (0091). Um vendedor que
-- pudesse se atribuir cards transformaria a fila num self-service, e a distribuição
-- deixaria de significar alguma coisa.
-- =============================================================================

create or replace function public.app_atribuir_lead_sdr(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.sdr_leads;
  v_novo uuid := nullif(p ->> 'sdr_id', '')::uuid;
  v_tipo text;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores reatribuem lead.' using errcode = '42501';
  end if;

  select * into v_lead from public.sdr_leads where id = (p ->> 'lead_id')::uuid;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  -- `sdr_id` é NOT NULL: o funil de reuniões não sabe desenhar card sem dono, e um
  -- lead órfão é exatamente o problema que esta migração existe para consertar.
  if v_novo is null then
    raise exception 'Escolha para quem o lead vai.' using errcode = '23502';
  end if;

  select tipo into v_tipo from public.vendedores where id = v_novo and ativo;
  if v_tipo is null then
    raise exception 'Vendedor inativo ou inexistente.' using errcode = '23503';
  end if;

  if v_novo = v_lead.sdr_id then
    return jsonb_build_object('id', v_lead.id, 'sdr_id', v_novo, 'mudou', false);
  end if;

  update public.sdr_leads set
    sdr_id = v_novo,
    -- O relógio do SLA reinicia: o novo dono não herda o atraso de quem não tocou.
    ultimo_toque_em = null,
    distribuido_em = now(),
    atualizado_em = now()
  where id = v_lead.id;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_lead.empresa_id, 'sdr.lead_distribuido', jsonb_build_object(
    'lead_id', v_lead.id, 'de', v_lead.sdr_id, 'para', v_novo, 'origem', 'manual'
  ), auth.uid());

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'comercial.lead_reatribuido', 'sdr_leads', v_lead.id::text,
          jsonb_build_object('de', v_lead.sdr_id, 'para', v_novo));

  return jsonb_build_object('id', v_lead.id, 'sdr_id', v_novo, 'mudou', true);
end $$;

comment on function public.app_atribuir_lead_sdr(jsonb) is
  'Troca o SDR dono de um lead. Reinicia o relógio do SLA: o novo dono não herda o '
  'atraso de quem não tocou. Só gestor, como em app_atribuir_nf.';

revoke all on function public.app_atribuir_lead_sdr(jsonb) from public;
grant execute on function public.app_atribuir_lead_sdr(jsonb) to authenticated;

create or replace function public.app_atribuir_venda(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venda public.vendas;
  v_novo uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_tipo text;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores reatribuem venda.' using errcode = '42501';
  end if;

  select * into v_venda from public.vendas where id = (p ->> 'venda_id')::uuid;
  if v_venda.id is null then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;
  if v_novo is null then
    raise exception 'Escolha para quem a venda vai.' using errcode = '23502';
  end if;

  select tipo into v_tipo from public.vendedores where id = v_novo and ativo;
  if v_tipo is null then
    raise exception 'Vendedor inativo ou inexistente.' using errcode = '23503';
  end if;

  if v_novo = v_venda.vendedor_id then
    return jsonb_build_object('id', v_venda.id, 'vendedor_id', v_novo, 'mudou', false);
  end if;

  update public.vendas set vendedor_id = v_novo, atualizada_em = now() where id = v_venda.id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'comercial.venda_reatribuida', 'vendas', v_venda.id::text,
          jsonb_build_object('de', v_venda.vendedor_id, 'para', v_novo));

  return jsonb_build_object('id', v_venda.id, 'vendedor_id', v_novo, 'mudou', true);
end $$;

comment on function public.app_atribuir_venda(jsonb) is
  'Troca o closer dono de uma venda. Só gestor. A comissão segue o dono no momento da '
  'apuração, então trocar depois do ganho muda quem recebe — por isso fica no log.';

revoke all on function public.app_atribuir_venda(jsonb) from public;
grant execute on function public.app_atribuir_venda(jsonb) to authenticated;

-- ─── O funil de certificados passa a DIZER de quem é ────────────────────────
-- Só leitura: a troca mora na tela de Carteira, porque mover a empresa de carteira
-- leva junto as NFs e a comissão dela.

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
      u.matriz_coberta, u.matriz_expira_em, u.cnpjs,
      dono.vendedor_id as dono_id, dono.nome as dono_nome
    from public.certificado_cards k
    join public.empresas e on e.id = k.empresa_id
    left join public.motivos_perda mp on mp.id = k.perdido_motivo
    left join lateral (
      select c.vendedor_id, v.nome
      from public.vendedor_carteira c
      join public.vendedores v on v.id = c.vendedor_id
      where c.empresa_id = k.empresa_id and c.papel = 'originacao' and c.ate is null
      limit 1
    ) dono on true
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

revoke all on function public.certificado_funil(uuid) from public;
grant execute on function public.certificado_funil(uuid) to authenticated;
