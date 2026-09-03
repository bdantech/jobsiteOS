-- ============================================================================
-- 0170 — Quando foi a última vez que falamos com esta empresa
--
-- A resposta existia no ledger e custava uma varredura por empresa para sair de
-- lá. Toda tela que precisa dela — a ficha, a lista de carteira, a régua de
-- reengajamento, o "quem está esfriando" — teria de fazer a mesma agregação, e a
-- primeira que fizesse errado (esquecendo `interno`, ou contando só o que sai)
-- passaria a discordar das outras sobre um fato simples.
--
-- Vira coluna em `empresas`, mantida por trigger. Não é cache de conveniência: é
-- o mesmo fato, materializado no lugar onde ele é perguntado.
--
-- ─── POR QUE TRIGGER, E NÃO NO CÓDIGO QUE ESCREVE ───────────────────────────
-- O ledger é escrito de cinco lugares (compositor, webhook de entrada, webhook do
-- celular, agente e campanha), e ainda vai ganhar outros. Atualizar a coluna em
-- cada um seria cinco lugares para esquecer — e a coluna esquecida não quebra
-- nada, só passa a mentir devagar.
--
-- ─── E POR QUE TAMBÉM NO UPDATE DE `empresa_id` ─────────────────────────────
-- Uma conversa nova chega SEM empresa: ninguém identificou o contato ainda. Ela
-- só ganha `empresa_id` quando alguém a vincula no inbox, e nesse momento
-- `app_conversa_vincular` reescreve a coluna em todas as mensagens da thread. Sem
-- o gatilho no update, a empresa recém-identificada nasceria "sem conversa
-- nenhuma" — justamente aquela com quem acabamos de falar.
--
-- `interno` fica fora: alerta de plantão para a nossa própria equipe não é
-- conversa com o cliente, e contá-lo faria toda empresa parecer recém-tocada no
-- dia de um incidente.
-- ============================================================================

alter table public.empresas add column if not exists ultima_conversa_em timestamptz;

comment on column public.empresas.ultima_conversa_em is
  'Instante da última mensagem trocada com esta empresa em qualquer canal externo '
  '(entrada ou saída), mantido por trigger sobre `comunicacoes`. `interno` não conta.';

create index if not exists empresas_ultima_conversa_idx
  on public.empresas (ultima_conversa_em desc nulls last);

create or replace function public.comunicacoes__tocar_empresa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.empresa_id is not null and coalesce(new.canal, '') <> 'interno' then
    /*
     * `greatest` e não atribuição direta: a ingestão do Gmail e a reentrega de um
     * webhook trazem mensagem ANTIGA depois de mensagens novas já terem chegado.
     * Sem isto, um e-mail de três semanas atrás recém-ingerido faria a empresa
     * parecer parada há três semanas — e ela falou com a gente hoje de manhã.
     */
    update public.empresas
      set ultima_conversa_em = greatest(ultima_conversa_em, new.criado_em)
      where id = new.empresa_id
        and (ultima_conversa_em is null or ultima_conversa_em < new.criado_em);
  end if;
  return new;
end $$;

drop trigger if exists comunicacoes_tocar_empresa on public.comunicacoes;
create trigger comunicacoes_tocar_empresa
  after insert or update of empresa_id on public.comunicacoes
  for each row execute function public.comunicacoes__tocar_empresa();

-- O que já está gravado.
update public.empresas e
set ultima_conversa_em = s.ultima
from (
  select empresa_id, max(criado_em) as ultima
  from public.comunicacoes
  where empresa_id is not null and coalesce(canal, '') <> 'interno'
  group by empresa_id
) s
where s.empresa_id = e.id
  and (e.ultima_conversa_em is null or e.ultima_conversa_em < s.ultima);
