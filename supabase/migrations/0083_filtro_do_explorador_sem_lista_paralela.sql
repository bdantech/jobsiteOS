-- ─────────────────────────────────────────────────────────────────────────────
-- O filtro do Explorador para de manter uma lista paralela de colunas
--
-- Sintoma: filtrar por "Faturamento estimado" devolvia "coluna não permitida".
--
-- Causa: `mercado_pred` valida a coluna contra uma lista escrita à mão, e essa
-- lista parou nas colunas de antes da 0069. A de ORDENAÇÃO, dentro de
-- `mercado_explorar`, foi atualizada na 04c e na 04d; a de FILTRO não — então dava
-- para ordenar por faturamento estimado e não dava para filtrar. Duas listas para o
-- mesmo fato, e uma delas envelheceu.
--
-- Levantado na base: 15 colunas da view `mercado_explorador` estavam bloqueadas, e
-- todas as 15 são oferecidas pelo catálogo do core. Não era um campo esquecido, era
-- um bloco inteiro: faturamento (valor, origem, confiança), funcionários (valor,
-- origem, crescimento 12m), regime tributário e o Crédito completo (limite
-- potencial, receita prevista, valor esperado, score, chance, faixa, análise).
--
-- A correção tira a lista. A pergunta certa nunca foi "esta coluna está na minha
-- lista?" e sim "esta coluna existe na view que a consulta lê?" — e essa o catálogo
-- do Postgres responde sem envelhecer. A fronteira de segurança continua a mesma: a
-- view `mercado_explorador` é o único FROM da consulta, então liberar exatamente as
-- colunas dela não expõe nada que a consulta já não pudesse ler.
--
-- IMMUTABLE → STABLE: ler catálogo depende do estado do banco. A função só é usada
-- para montar o WHERE dentro de `mercado_where`, que é chamada por funções VOLATILE
-- — nenhum índice ou coluna gerada depende dela.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mercado_pred(no jsonb)
returns text language plpgsql stable set search_path to '' as $function$
declare
  col text; op text; v text; arr text[]; parts text[]; child jsonb;
begin
  if no ? 'c' then
    parts := array[]::text[];
    for child in select * from jsonb_array_elements(no->'c') loop
      parts := parts || public.mercado_pred(child);
    end loop;
    if array_length(parts,1) is null then return 'true'; end if;
    return '(' || array_to_string(parts, case when no->>'op' = 'ou' then ' or ' else ' and ' end) || ')';
  end if;

  col := no->>'col';
  -- A view é a fronteira. Coluna que não existe nela não vira SQL — o que também
  -- transforma erro de digitação em mensagem clara em vez de erro de sintaxe.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mercado_explorador'
      and column_name = col
  ) then
    raise exception 'coluna não permitida no filtro: %', col using errcode = '42501';
  end if;

  op := no->>'op';
  v := no->>'v';
  case op
    when 'igual' then return format('%I = %L', col, v);
    when 'diferente' then return format('%I is distinct from %L', col, v);
    when 'maior_que' then return format('%I > %L', col, v);
    when 'maior_ou_igual' then return format('%I >= %L', col, v);
    when 'menor_que' then return format('%I < %L', col, v);
    when 'menor_ou_igual' then return format('%I <= %L', col, v);
    when 'contem' then return format('%I ilike %L', col, '%'||v||'%');
    when 'comeca_com' then return format('%I ilike %L', col, v||'%');
    when 'definido' then return format('%I is not null', col);
    when 'nao_definido' then return format('%I is null', col);
    when 'em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I = any(%L::text[])', col, arr);
    when 'nao_em' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('(%I is null or %I <> all(%L::text[]))', col, col, arr);
    when 'contem_algum' then
      select array_agg(x) into arr from jsonb_array_elements_text(no->'v') x;
      return format('%I && %L::text[]', col, arr);
    when 'entre' then
      return format('%I between %L and %L', col, no->'v'->>0, no->'v'->>1);
    else
      raise exception 'operador não suportado no filtro: %', op using errcode = '42501';
  end case;
end $function$;

comment on function public.mercado_pred is
  'Monta o predicado SQL de um nó da árvore de filtro. A coluna é validada contra as '
  'colunas REAIS da view mercado_explorador — sem lista paralela para envelhecer '
  '(migração 0083).';
