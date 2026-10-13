-- 0298 — Agendar reunião confirma o fit
--
-- Regra pedida em 13/10/2026: o que importa é saber quantos leads tiveram fit e quantos
-- não, e um lead com reunião agendada TEM fit — ninguém marca reunião com quem não serve.
-- Ele conta nos dois lugares: em "com fit" e em "reuniões agendadas".
--
-- Até aqui o fit só existia se alguém o marcasse à mão, e agendar não marcava: cinco leads
-- com reunião apareciam como "ainda não avaliado" no funil, no Meu Dia e na Aquisição.
--
-- O que NÃO muda: o veredito explícito. Quem foi dado como "sem fit" continua sem fit mesmo
-- tendo reunião (são três hoje: a reunião aconteceu e mostrou que não servia). A regra só
-- preenche o fit que ninguém definiu.

/*
 * No mesmo gatilho que carimba o autor (0297a), e antes dele: o fit implícito também tem
 * autor — quem agendou. Dispara quando a data da reunião é DEFINIDA ou muda, que é o ato
 * de agendar; um lead antigo com `reuniao_em` parado não ganha fit por ter outra coluna
 * editada.
 */
create or replace function public.app__sdr_lead_fit_autor()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.fit is null and new.reuniao_em is not null
     and (tg_op = 'INSERT' or new.reuniao_em is distinct from old.reuniao_em) then
    new.fit := true;
    new.fit_definido_em := now();
  end if;

  if tg_op = 'INSERT' then
    if new.fit is not null and new.fit_definido_por is null then
      new.fit_definido_por := auth.uid();
    end if;
  elsif new.fit is distinct from old.fit then
    new.fit_definido_por := case when new.fit is null then null else auth.uid() end;
  end if;
  return new;
end $function$;

-- Antes era `before update of fit`: só disparava com `fit` no SET. Agendar por outro
-- caminho que não mexesse em `fit` passaria direto.
drop trigger if exists sdr_leads_fit_autor on public.sdr_leads;
create trigger sdr_leads_fit_autor
  before insert or update on public.sdr_leads
  for each row execute function public.app__sdr_lead_fit_autor();

revoke execute on function public.app__sdr_lead_fit_autor() from public, anon, authenticated;

/*
 * O passado: os leads sem fit definido que TÊM reunião marcada. A data do fit é a de
 * quando a reunião foi marcada, e o autor é quem a marcou — é quando e por quem a decisão
 * foi de fato tomada.
 *
 * Fica de fora um lead de 30/08 em "a contatar", expirado, com `reuniao_em` preenchido e
 * nenhum evento de reunião: não há reunião para sustentar o fit.
 */
alter table public.sdr_leads disable trigger sdr_leads_fit_autor;

update public.sdr_leads l
   set fit = true,
       fit_definido_em = e.criado_em,
       fit_definido_por = e.criado_por
  from (
    select distinct on (e.sdr_lead_id) e.sdr_lead_id, e.criado_em, e.criado_por
    from public.vendedor_eventos e
    where e.tipo = 'reuniao' and e.sdr_lead_id is not null
    order by e.sdr_lead_id, e.criado_em
  ) e
 where e.sdr_lead_id = l.id and l.fit is null;

alter table public.sdr_leads enable trigger sdr_leads_fit_autor;
