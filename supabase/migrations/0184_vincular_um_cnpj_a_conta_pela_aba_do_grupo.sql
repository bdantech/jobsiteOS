-- 0184 — Vincular um CNPJ à conta, pela aba do grupo.
--
-- O grafo de grupos econômicos é derivado dos sócios PJ da Receita, e ele erra por baixo
-- de propósito: uma SPE com dois donos PJ é tratada como folha e NÃO une as holdings dela,
-- senão uma joint venture colaria dois grupos que não têm relação. O preço é conhecido —
-- medido em 04/09/2026, 248 SPEs de clientes nossos ficavam fora do grupo do dono, e 9
-- delas operavam: R$ 842 mil de volume que não resolvia para conta nenhuma.
--
-- E há o caso que o grafo NUNCA vai ver: a SPE cujos sócios são as mesmas pessoas físicas
-- do cliente, sem nenhum vínculo societário entre as empresas. O CPF vem mascarado da
-- Receita; não existe aresta para seguir. Só uma pessoa que conhece a operação sabe.
--
-- ── O vínculo aponta para a CONTA, não para o grupo ──
--
-- A tela mora na aba Grupo econômico, mas o que se grava é "este CNPJ pertence à conta X".
-- `app_holding_do_sacado` precisa devolver UMA empresa — o próprio comentário dele avisa
-- que um grupo pode ter dois clientes e que, sem desempate, a mesma antecipação pagaria
-- comissão duas vezes. Amarrar ao grupo reintroduziria exatamente essa ambiguidade, e
-- deixaria de fora a conta sem grupo derivado, que é metade dos nossos clientes.
--
-- Reaproveita `sacado_vinculo` (0177) em vez de criar uma segunda tabela: é a mesma
-- afirmação — "este CNPJ opera por baixo desta conta" — vista de outra tela.

create or replace function public.app_vincular_cnpj_conta(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g');
  v_conta uuid := (p ->> 'empresa_id')::uuid;
  v_motivo text := nullif(trim(p ->> 'motivo'), '');
  v_monitorar boolean := coalesce((p ->> 'monitorar')::boolean, true);
  v_alvo public.empresas;
  v_universo public.mercado_universo;
  v_criada boolean := false;
  v_empresa_cnpj uuid;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores vinculam um CNPJ a uma conta.' using errcode = '42501';
  end if;
  if length(v_cnpj) <> 14 then
    raise exception 'CNPJ inválido: %.', p ->> 'cnpj' using errcode = '22023';
  end if;
  if v_motivo is null then
    raise exception 'Vincular exige motivo: o parentesco não está no dado público, senão o sistema já o teria achado.'
      using errcode = '22023';
  end if;

  select * into v_alvo from public.empresas where id = v_conta;
  if v_alvo.id is null then
    raise exception 'Conta não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_alvo.estagio not in ('cliente', 'ex_cliente') then
    raise exception 'Só cliente ou ex-cliente recebe vínculo — "%" está em "%".',
      coalesce(v_alvo.razao_social, v_alvo.cnpj), v_alvo.estagio using errcode = '22023';
  end if;
  if v_alvo.cnpj = v_cnpj then
    raise exception 'Este CNPJ já É a conta — não precisa de vínculo.' using errcode = '22023';
  end if;

  select * into v_universo from public.mercado_universo where cnpj = v_cnpj;

  /*
   * A empresa nasce em `mercado`, e isso não é um detalhe de cadastro.
   *
   * A SPE vinculada não é cliente: quem é cliente é a conta acima dela. Criá-la como
   * `cliente` a faria contar duas vezes em toda métrica de carteira, e — pior — o
   * `app_holding_do_sacado` passaria a casá-la pelo CNPJ exato e devolvê-la a ela mesma,
   * que é exatamente o defeito que o vínculo existe para consertar.
   */
  select id into v_empresa_cnpj from public.empresas where cnpj = v_cnpj;
  if v_empresa_cnpj is null then
    insert into public.empresas (cnpj, razao_social, estagio, grupo_id)
    values (
      v_cnpj,
      coalesce(v_universo.razao_social, 'CNPJ ' || v_cnpj),
      'mercado',
      v_alvo.grupo_id
    )
    returning id into v_empresa_cnpj;
    v_criada := true;
  end if;

  insert into public.sacado_vinculo (cnpj, empresa_id, motivo, criado_por)
  values (v_cnpj, v_conta, v_motivo, v_ator)
  on conflict (cnpj) do update
    set empresa_id = excluded.empresa_id, motivo = excluded.motivo, atualizado_em = now();

  /*
   * "Afiançada" liga o monitoramento mensal de protesto, e cada CNPJ monitorado é uma
   * consulta PAGA por mês. Fica explícito no parâmetro para que a tela possa dizer isso
   * antes do clique, e para que um vínculo feito por outro caminho não gaste sozinho.
   */
  if v_monitorar and public.app_tem_modulo('radar') then
    insert into public.protesto_monitoramento (cnpj, empresa_id, grupo_id, criado_por)
    values (v_cnpj, v_empresa_cnpj, coalesce(v_universo.grupo_id, v_alvo.grupo_id), v_ator)
    on conflict (cnpj) do nothing;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_conta, 'sacado.vinculado',
    jsonb_build_object(
      'resumo', 'O CNPJ ' || v_cnpj || ' passa a operar por baixo desta conta. Motivo: ' || v_motivo,
      'cnpj_vinculado', v_cnpj,
      'empresa_criada', v_criada,
      'monitorada', v_monitorar,
      'vigencia', 'as cessões ainda não lançadas'),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.sacado_vinculado', 'sacado_vinculo', v_cnpj, p);

  return jsonb_build_object(
    'cnpj', v_cnpj,
    'empresa_id', v_empresa_cnpj,
    'criada', v_criada,
    'monitorada', v_monitorar,
    'no_universo', v_universo.cnpj is not null,
    'razao_social', coalesce(v_universo.razao_social, (select razao_social from public.empresas where id = v_empresa_cnpj))
  );
end $$;

revoke execute on function public.app_vincular_cnpj_conta(jsonb) from public;
grant execute on function public.app_vincular_cnpj_conta(jsonb) to authenticated, service_role;

-- ─── Desvincular ────────────────────────────────────────────────────────────
--
-- Apaga o vínculo e desliga o monitoramento que o vínculo ligou. NÃO apaga a empresa: ela
-- pode ter timeline, notas e contatos — e "este CNPJ não é desta conta" não é o mesmo que
-- "este CNPJ não existe".

create or replace function public.app_desvincular_cnpj_conta(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g');
  v_conta uuid;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mexem no vínculo de uma conta.' using errcode = '42501';
  end if;

  delete from public.sacado_vinculo where cnpj = v_cnpj returning empresa_id into v_conta;
  if v_conta is null then
    return jsonb_build_object('removido', false);
  end if;

  if coalesce((p ->> 'desmonitorar')::boolean, true) then
    delete from public.protesto_monitoramento where cnpj = v_cnpj;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_conta, 'sacado.vinculado',
    jsonb_build_object('resumo', 'O CNPJ ' || v_cnpj || ' deixou de operar por baixo desta conta.',
      'cnpj_vinculado', v_cnpj, 'removido', true), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.sacado_desvinculado', 'sacado_vinculo', v_cnpj, p);

  return jsonb_build_object('removido', true, 'empresa_id', v_conta);
end $$;

revoke execute on function public.app_desvincular_cnpj_conta(jsonb) from public;
grant execute on function public.app_desvincular_cnpj_conta(jsonb) to authenticated, service_role;

-- ─── Leitura: o que já está pendurado nesta conta ───────────────────────────

create or replace function public.comercial_vinculos_da_conta(p_empresa_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when not public.app_tem_modulo('comercial') then '[]'::jsonb else coalesce(
    (select jsonb_agg(to_jsonb(x) order by x.volume desc nulls last, x.razao_social)
     from (
       select v.cnpj,
              coalesce(u.razao_social, e.razao_social) as razao_social,
              v.motivo,
              v.criado_em,
              us.nome as criado_por_nome,
              (m.cnpj is not null) as monitorada,
              coalesce(u.is_spe, false) as is_spe,
              (select count(*) from public.antecipacoes a
                where a.sacado_cnpj = v.cnpj and a.convertida_em is not null
                  and a.regrediu_em is null)::int as cessoes,
              (select sum(a.gross_value) from public.antecipacoes a
                where a.sacado_cnpj = v.cnpj and a.convertida_em is not null
                  and a.regrediu_em is null) as volume
       from public.sacado_vinculo v
       left join public.mercado_universo u on u.cnpj = v.cnpj
       left join public.empresas e on e.cnpj = v.cnpj
       left join public.protesto_monitoramento m on m.cnpj = v.cnpj
       left join public.usuarios us on us.id = v.criado_por
       where v.empresa_id = p_empresa_id
     ) x),
    '[]'::jsonb) end;
$function$;

comment on function public.comercial_vinculos_da_conta is
  'Os CNPJs pendurados manualmente numa conta, com motivo, autor, se estão monitorados e '
  'quanto já cederam. As subconsultas por linha são baratas aqui: uma conta tem punhados '
  'de vínculos, não centenas — ao contrário da lista de contas, que precisou de CTE.';

revoke execute on function public.comercial_vinculos_da_conta(uuid) from public;
grant execute on function public.comercial_vinculos_da_conta(uuid) to authenticated, service_role;
