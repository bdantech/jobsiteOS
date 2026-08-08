-- ─────────────────────────────────────────────────────────────────────────────
-- A busca de candidatos passa a preferir a MATRIZ
--
-- No dump da Receita a razão social pertence à RAIZ: matriz e filiais têm o mesmo
-- nome e, portanto, a mesma similaridade. O desempate era a ordem em que o índice
-- devolvia — nenhum critério. Uma lista publicada fala da EMPRESA, não de um
-- estabelecimento, então a matriz é a resposta certa quase sempre.
--
-- Aqui a preferência importa duas vezes. Além de ordenar, ela decide quem sobrevive
-- ao `limit`: uma raiz com 30 filiais podia ocupar as 60 vagas sem que a matriz
-- estivesse entre elas, e aí nem o ranqueamento do Node tinha como consertar.
--
-- O Node aplica a mesma regra depois, no empate técnico (ver similaridade.ts). Não é
-- redundância: lá ele já tem o bônus de município no score, aqui é só a peneira.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_buscar_candidatos_universo(p jsonb)
returns table (
  cnpj text,
  razao_social text,
  nome_fantasia text,
  uf text,
  municipio text,
  situacao_cadastral text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_token text := regexp_replace(coalesce(p ->> 'token', ''), '[%_\\]', '', 'g');
  v_nome  text := coalesce(p ->> 'nome', '');
  v_uf    text := nullif(p ->> 'uf', '');
  v_limite int := least(coalesce((p ->> 'limite')::int, 60), 200);
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  if length(v_token) < 3 then
    return;
  end if;

  return query
  select u.cnpj, u.razao_social, u.nome_fantasia, u.uf, u.municipio, u.situacao_cadastral
  from public.mercado_universo u
  where (u.razao_social ilike '%' || v_token || '%'
      or u.nome_fantasia ilike '%' || v_token || '%')
    and (v_uf is null or u.uf = v_uf)
  order by
    greatest(
      public.similarity(v_nome, coalesce(u.razao_social, '')),
      public.similarity(v_nome, coalesce(u.nome_fantasia, ''))
    ) desc,
    -- Os quatro dígitos de ordem: '0001' é matriz, o resto é filial.
    (substring(u.cnpj from 9 for 4) = '0001') desc
  limit v_limite;
end $$;

revoke execute on function public.app_buscar_candidatos_universo(jsonb) from public;
grant execute on function public.app_buscar_candidatos_universo(jsonb) to authenticated, service_role;
