-- ─────────────────────────────────────────────────────────────────────────────
-- 0287 — Em sombra, a explicação é da nota que seria
--
-- A explicação ("0,50 porque faltou: pergunta respondida") era calculada só sobre itens
-- publicados. Numa rubrica em sombra nenhum item é publicado, e todas as análises saíam
-- "Sem avaliação aplicável" — ao lado de um `score_sombra` de 0,50 na tela do gestor.
-- Em sombra, a explicação (e as contagens) passam a ser da nota que seria; publicada,
-- nada muda. A nota publicada continua nula em sombra.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app__qualidade_recalcular(p_analise uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_peso numeric; v_peso_ok numeric; v_n int; v_ok int; v_score numeric;
  v_sombra numeric; v_faltas text[]; v_expl text;
  v_publicado boolean := (select modo = 'publicado' from public.analises where id = p_analise);
begin
  select coalesce(sum(greatest(ai.peso, 0)), 0),
         coalesce(sum(case when ai.atendido then greatest(ai.peso, 0) else 0 end), 0),
         count(*), count(*) filter (where ai.atendido)
    into v_peso, v_peso_ok, v_n, v_ok
  from public.analise_itens ai
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido is not null and (not ai.em_sombra or not v_publicado);

  v_score := case when v_peso > 0 then round(v_peso_ok / v_peso, 3) end;

  select case when sum(greatest(ai.peso, 0)) > 0
              then round(sum(case when ai.atendido then greatest(ai.peso, 0) else 0 end) / sum(greatest(ai.peso, 0)), 3) end
    into v_sombra
  from public.analise_itens ai
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido is not null;

  select array_agg(ri.rotulo order by ri.ordem) into v_faltas
  from public.analise_itens ai join public.rubrica_itens ri on ri.id = ai.item_id
  where ai.analise_id = p_analise and ai.aplicavel and ai.atendido = false and (not ai.em_sombra or not v_publicado) and ai.peso > 0;

  v_expl := case
    when v_score is null then 'Sem avaliação aplicável.'
    when coalesce(cardinality(v_faltas), 0) = 0 and v_n = 1
      then replace(to_char(v_score, 'FM0.00'), '.', ',') || ' — o único item aplicável foi atendido.'
    when coalesce(cardinality(v_faltas), 0) = 0
      then replace(to_char(v_score, 'FM0.00'), '.', ',') || ' — todos os ' || v_n || ' itens aplicáveis atendidos.'
    when cardinality(v_faltas) = 1
      then replace(to_char(v_score, 'FM0.00'), '.', ',') || ' porque faltou: ' || v_faltas[1] || '.'
    else replace(to_char(v_score, 'FM0.00'), '.', ',') || ' porque faltou: '
         || array_to_string(v_faltas[1:cardinality(v_faltas) - 1], ', ') || ' e ' || v_faltas[cardinality(v_faltas)] || '.'
  end;

  update public.analises set
    score = case when modo = 'publicado' then v_score end,
    score_sombra = v_sombra,
    itens_aplicaveis = v_n,
    itens_atendidos = v_ok,
    explicacao = v_expl
  where id = p_analise;
end $$;

-- As análises em sombra que já existem.
select public.app__qualidade_recalcular(id) from public.analises where modo = 'sombra';
