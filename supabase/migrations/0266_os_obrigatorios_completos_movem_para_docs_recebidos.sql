-- ─────────────────────────────────────────────────────────────────────────────
-- 0266 — Os obrigatórios completos movem a análise para docs_recebidos
--
-- O gatilho da 0160/0187 já movia `docs_pendentes → docs_recebidos` quando o
-- checklist fechava, mas contava os ESSENCIAIS — o que a nossa análise precisa —, e
-- não os OBRIGATÓRIOS — o que a seguradora cobra. Decisão de 25/09/2026: a pasta
-- está recebida quando os obrigatórios chegaram; os essenciais não contam para o
-- estágio (seguem como aviso na tela de documentos). No catálogo vivo, hoje:
-- obrigatórios = balanço patrimonial + DRE; o faturamento declarado, que é só
-- essencial, deixa de segurar a análise.
--
-- Três ajustes junto:
--   de onde ... `solicitada` também. A análise pedida pelo Comercial nasce em
--               `solicitada` (0260), e subir os documentos nela não a movia nunca.
--   o que conta  só documento que CHEGOU: o da API ainda por baixar (URL externa)
--               e o que falhou no download ('[falha ao baixar] …') não contam.
--   quando .... também no UPDATE do arquivo: o documento da API entra como URL e
--               vira arquivo quando o worker o baixa — é aí que ele chega.
--
-- A esteira continua andando só para frente: nada aqui tira uma análise de
-- `docs_recebidos`. A API (`documentosFaltantes`) passou a ler a mesma lista.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.analise_docs__completar_checklist()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_obrigatorios text[];
  v_recebidos text[];
begin
  select coalesce(array_agg(t ->> 'id'), '{}')
    into v_obrigatorios
    from public.credito_config c,
         lateral jsonb_array_elements(c.valor -> 'tipos') t
   where c.chave = 'docs' and coalesce((t ->> 'obrigatorio')::boolean, false);

  -- Catálogo sem obrigatório: sem esta guarda, o primeiro upload moveria tudo.
  if v_obrigatorios = '{}' then return null; end if;

  select coalesce(array_agg(distinct d.tipo), '{}')
    into v_recebidos
    from public.analise_docs d
   where d.analise_id = new.analise_id
     and d.arquivo_url !~* '^https?://'
     and coalesce(d.nome_arquivo, '') not like '[falha ao baixar]%';

  update public.analises_credito
     set estagio = 'docs_recebidos',
         atualizada_em = now()
   where id = new.analise_id
     and estagio in ('solicitada', 'docs_pendentes')
     and v_obrigatorios <@ v_recebidos;

  return null;
end $function$;

drop trigger if exists analise_docs_completar_checklist on public.analise_docs;
create trigger analise_docs_completar_checklist
  after insert or update of arquivo_url, nome_arquivo on public.analise_docs
  for each row execute function public.analise_docs__completar_checklist();

-- ── Quem já estava com a pasta completa ────────────────────────────────────
with obrigatorios as (
  select coalesce(array_agg(t ->> 'id'), '{}') as ids
    from public.credito_config c, lateral jsonb_array_elements(c.valor -> 'tipos') t
   where c.chave = 'docs' and coalesce((t ->> 'obrigatorio')::boolean, false)
)
update public.analises_credito a
   set estagio = 'docs_recebidos', atualizada_em = now()
  from obrigatorios o
 where a.estagio in ('solicitada', 'docs_pendentes')
   and o.ids <> '{}'
   and o.ids <@ array(
     select distinct d.tipo from public.analise_docs d
      where d.analise_id = a.id
        and d.arquivo_url !~* '^https?://'
        and coalesce(d.nome_arquivo, '') not like '[falha ao baixar]%'
   );
