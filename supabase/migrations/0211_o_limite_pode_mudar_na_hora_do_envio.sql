-- ═════════════════════════════════════════════════════════════════════════════
-- 0211 — O limite pode mudar na hora do envio
--
-- ─── O QUE ACONTECIA ────────────────────────────────────────────────────────
-- `limite_solicitado` era gravado quando o COMERCIAL pedia a análise e não mudava mais
-- por caminho nenhum antes do envio. Só que quem manda à seguradora é o analista de
-- crédito, dias depois, com a pasta na mão: ele leu o balanço, viu a exposição, e é ele
-- quem sabe qual número faz sentido pedir. Pedir R$ 10 milhões porque foi isso que
-- alguém digitou no funil é submeter à Atradius um número que ninguém mais defende.
--
-- Havia como mudar, mas só por `app_mover_analise`, que muda o ESTÁGIO junto e recusa
-- `docs_recebidos` — exatamente o estágio de quem está prestes a enviar. Na prática, não
-- havia.
--
-- ─── A CERCA ────────────────────────────────────────────────────────────────
-- Só `solicitada` e `docs_recebidos`, que é de onde o envio sai (`ESTAGIOS_QUE_ENVIAM`).
-- Depois de enviada, o limite pedido é um FATO sobre o que a seguradora recebeu:
-- reescrevê-lo faria a tela divergir do pedido que está lá do outro lado, e a divergência
-- apareceria como "eles aprovaram menos do que pedimos" numa conta que ninguém pediu.
--
-- O valor anterior vai no `audit_log`. "Por que pedimos 4 e não 10?" é pergunta de
-- comitê, e a resposta não pode depender de alguém lembrar.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_definir_limite_analise(p jsonb)
returns public.analises_credito language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_antes numeric;
  v_novo numeric := nullif(p ->> 'limite_solicitado', '')::numeric;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  if v_novo is null or v_novo <= 0 then
    raise exception 'Informe um limite maior que zero.' using errcode = '22023';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid for update;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  -- A mesma lista de `ESTAGIOS_QUE_ENVIAM` no core. Fora dela o pedido já saiu (ou nunca
  -- vai sair), e o limite deixa de ser uma intenção nossa para ser um fato lá fora.
  if v_linha.estagio not in ('solicitada', 'docs_recebidos') then
    raise exception 'O limite só muda antes do envio à seguradora.' using errcode = '22023';
  end if;

  v_antes := v_linha.limite_solicitado;
  if v_antes is not distinct from v_novo then
    return v_linha;
  end if;

  update public.analises_credito set
    limite_solicitado = v_novo,
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.limite_alterado', 'analises_credito', v_linha.id::text,
          jsonb_build_object('de', v_antes, 'para', v_novo, 'estagio', v_linha.estagio,
                             'origem', coalesce(p ->> 'origem', 'envio')));

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  select v_linha.empresa_id, 'analise.limite_alterado',
         jsonb_build_object(
           'titulo', 'Limite solicitado alterado',
           'resumo', 'De ' || coalesce(to_char(v_antes, 'FM999G999G999G990D00'), '—')
                   || ' para ' || to_char(v_novo, 'FM999G999G999G990D00') || '.',
           'url', '/credito/analises/' || v_linha.id,
           'cnpj', v_linha.cnpj,
           'analise_id', v_linha.id
         ), v_ator
  where v_linha.empresa_id is not null;

  return v_linha;
end $function$;

comment on function public.app_definir_limite_analise is
  'Ajusta `limite_solicitado` antes do envio à seguradora. Só em `solicitada` e '
  '`docs_recebidos`: depois de enviado, o limite pedido é fato do outro lado. O valor '
  'anterior fica no audit_log e na timeline da empresa.';

revoke execute on function public.app_definir_limite_analise(jsonb) from public, anon;
grant execute on function public.app_definir_limite_analise(jsonb) to authenticated, service_role;
