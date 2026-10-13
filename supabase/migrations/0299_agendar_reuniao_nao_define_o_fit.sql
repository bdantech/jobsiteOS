-- 0299 — Agendar reunião NÃO define o fit: desfaz a 0298
--
-- A 0298 saiu de uma leitura errada do pedido. O que foi pedido é que o lead COM fit que
-- também tem reunião conte nos dois indicadores — e isso o report já fazia, porque são duas
-- contagens independentes. Não foi pedido que agendar marcasse o fit, e não marca: fit é
-- avaliação de uma pessoa, e reunião marcada sem avaliação continua "ainda não avaliado".
--
-- Volta tudo ao estado da 0297a. Entre a 0298 (13/10/2026 20:54 UTC) e esta, nenhum lead
-- teve o fit definido pelo gatilho — conferido antes de aplicar.

-- O gatilho volta a só carimbar QUEM definiu o fit.
create or replace function public.app__sdr_lead_fit_autor()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.fit is distinct from old.fit then
    new.fit_definido_por := case when new.fit is null then null else auth.uid() end;
  end if;
  return new;
end $function$;

drop trigger if exists sdr_leads_fit_autor on public.sdr_leads;
create trigger sdr_leads_fit_autor
  before update of fit on public.sdr_leads
  for each row execute function public.app__sdr_lead_fit_autor();

/*
 * Os cinco leads que a 0298 marcou como "com fit" voltam a não ter avaliação. A assinatura
 * deles é exata: `fit_definido_em` igual, até o microssegundo, ao `criado_em` da primeira
 * reunião — coisa que uma marcação feita à mão no kanban nunca produz.
 */
update public.sdr_leads l
   set fit = null, fit_definido_em = null, fit_definido_por = null
  from (
    select distinct on (e.sdr_lead_id) e.sdr_lead_id, e.criado_em
    from public.vendedor_eventos e
    where e.tipo = 'reuniao' and e.sdr_lead_id is not null
    order by e.sdr_lead_id, e.criado_em
  ) e
 where e.sdr_lead_id = l.id and l.fit is true and l.fit_definido_em = e.criado_em;
