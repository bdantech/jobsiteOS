-- ═════════════════════════════════════════════════════════════════════════════
-- 0160 — O checklist completo tira a análise de "documentos pendentes" (04n §2.2)
--
-- A produção manda os documentos aos poucos: cria a análise com o balanço e o
-- resto chega em chamadas separadas, às vezes horas depois. Sem isto, a análise
-- ficaria em `docs_pendentes` com a pasta completa até alguém do Crédito reparar
-- e mover à mão — e o webhook que avisa "pode seguir" nunca sairia.
--
-- O gatilho age só na SUBIDA, e só a partir de `docs_pendentes`: uma análise que
-- já foi enviada à seguradora não volta para 'solicitada' porque chegou uma
-- certidão atrasada. A esteira anda para frente; documento novo não a rebobina.
--
-- Quem avisa o mundo é o gatilho da 0159, que já escuta mudança de estágio. Este
-- só muda a coluna — e ganha o webhook de graça, o que é o ponto de a emissão ser
-- da tabela.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.analise_docs__completar_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_essenciais text[];
  v_recebidos text[];
begin
  select coalesce(array_agg(t ->> 'id'), '{}')
    into v_essenciais
    from public.credito_config c,
         lateral jsonb_array_elements(c.valor -> 'tipos') t
   where c.chave = 'docs' and (t ->> 'essencial')::boolean;

  if v_essenciais = '{}' then return null; end if;

  select coalesce(array_agg(distinct d.tipo), '{}')
    into v_recebidos
    from public.analise_docs d
   where d.analise_id = new.analise_id;

  update public.analises_credito
     set estagio = 'solicitada'
   where id = new.analise_id
     and estagio = 'docs_pendentes'
     and v_essenciais <@ v_recebidos;

  return null;
end $$;

drop trigger if exists analise_docs_completar_checklist on public.analise_docs;

create trigger analise_docs_completar_checklist
  after insert on public.analise_docs
  for each row execute function public.analise_docs__completar_checklist();

/*
 * Os parâmetros da API, na mesma tela de configuração do Crédito. Ficam em config
 * e não no código porque são números que se ajustam olhando o painel do §5 — e
 * subir um teto de rate limit não deveria pedir deploy.
 */
insert into public.credito_config (chave, valor)
values ('api', jsonb_build_object(
  'rate_limit_por_minuto', 60,
  'payload_max_kb', 512,
  'documento_max_mb', 20,
  'retencao_log_dias', 90
))
on conflict (chave) do nothing;
