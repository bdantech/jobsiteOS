-- ─────────────────────────────────────────────────────────────────────────────
-- 0282 — A DF vale pelo balanço e pela DRE
--
-- O checklist obrigatório da análise é balanço patrimonial + DRE (0266). Só que o
-- sacado quase nunca manda as duas peças em arquivos separados: manda as
-- DEMONSTRAÇÕES FINANCEIRAS, um PDF com tudo. O comercial anexava o mesmo arquivo
-- duas vezes, como balanço e como DRE, só para a análise andar — e o Crédito abria
-- dois "documentos" que eram um.
--
-- A DF vira tipo próprio do catálogo, com um campo novo: `substitui`, a lista de
-- tipos que ela cobre. O gatilho passa a contar como recebido também o que um
-- documento recebido substitui. A regra fica: DF, OU balanço + DRE.
--
-- Por que no catálogo e não no gatilho: o catálogo é a régua que o Crédito edita
-- na tela, e o editor preserva campos que não conhece. A cópia do lado do código é
-- `DOCS_SUBSTITUEM` (packages/core/src/credito/analise.ts), usada pela API e pelas
-- telas.
--
-- A DF não é obrigatória nem essencial por si: quem cumpre o obrigatório é o par que
-- ela cobre. Marcá-la obrigatória faria o checklist cobrar DF de quem mandou balanço
-- e DRE separados.
--
-- Sem backfill: o tipo nasce agora, e nenhuma análise tem DF anexada.
-- ─────────────────────────────────────────────────────────────────────────────

update public.credito_config
   set valor = jsonb_set(
         valor, '{tipos}',
         jsonb_build_array(jsonb_build_object(
           'id', 'demonstracoes_financeiras',
           'label', 'Demonstrações financeiras (DF)',
           'obrigatorio', false,
           'essencial', false,
           'extraivel', true,
           'substitui', jsonb_build_array('balanco_patrimonial', 'dre')
         )) || coalesce(valor -> 'tipos', '[]'::jsonb)
       )
 where chave = 'docs'
   and not exists (
     select 1 from jsonb_array_elements(valor -> 'tipos') t
     where t ->> 'id' = 'demonstracoes_financeiras'
   );

create or replace function public.analise_docs__completar_checklist()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_obrigatorios text[];
  v_recebidos text[];
begin
  select coalesce(array_agg(t ->> 'id'), '{}')
    into v_obrigatorios
    from public.credito_config c,
         lateral jsonb_array_elements(c.valor -> 'tipos') t
   where c.chave = 'docs' and coalesce((t ->> 'obrigatorio')::boolean, false);

  if v_obrigatorios = '{}' then return null; end if;

  /* O tipo de cada documento recebido, mais o que ele substitui no catálogo. */
  with recebidos as (
    select distinct d.tipo
      from public.analise_docs d
     where d.analise_id = new.analise_id
       and d.arquivo_url !~* '^https?://'
       and coalesce(d.nome_arquivo, '') not like '[falha ao baixar]%'
  )
  select coalesce(array_agg(distinct x), '{}')
    into v_recebidos
    from (
      select r.tipo as x from recebidos r
      union
      select s.x
        from recebidos r
        join public.credito_config c on c.chave = 'docs'
        cross join lateral jsonb_array_elements(c.valor -> 'tipos') t
        cross join lateral jsonb_array_elements_text(coalesce(t -> 'substitui', '[]'::jsonb)) s(x)
       where t ->> 'id' = r.tipo
    ) u;

  update public.analises_credito
     set estagio = 'docs_recebidos',
         atualizada_em = now()
   where id = new.analise_id
     and estagio in ('solicitada', 'docs_pendentes')
     and v_obrigatorios <@ v_recebidos;

  return null;
end $function$;
