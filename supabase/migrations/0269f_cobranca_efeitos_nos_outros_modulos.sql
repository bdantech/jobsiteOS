-- ============================================================================
-- 0269f — Cobrança: o que ela muda nos outros módulos
--
-- ── OS CHECKs VÊM DO BANCO VIVO ─────────────────────────────────────────────
-- As listas abaixo foram lidas de pg_constraint em 26/09/2026, não das migrações
-- que as criaram: `comunicacoes_origem_check` já tinha ganho `celular` e
-- `lembrete` depois da 0144, e recriar a partir da lista original os apagaria.
--
-- ── O BLOQUEIO É TRIGGER, NÃO UMA LINHA EM CADA RPC ─────────────────────────
-- Uma análise de crédito nasce por seis caminhos (três RPCs, uma que insere
-- direto, a API pública com service role, e o backfill da Atradius). Pôr a recusa
-- em cada um seria esquecer o sétimo. Um BEFORE INSERT em `analises_credito`
-- pega todos — e deixa passar só o backfill, que importa uma decisão que a
-- seguradora já tomou (recusar a importação apagaria um fato).
--
-- No funil, o trigger só vale para SESSÃO de usuário (`auth.uid()` presente): o
-- sync da produção move o card para `antecipacao_andamento` quando a operação já
-- aconteceu lá, e recusar o espelho de um fato consumado só esconderia o fato.
-- ============================================================================

-- ─── Comunicação: anexos na fila, e a origem `cobranca` ─────────────────────

alter table public.mensagens_outbox add column if not exists anexos jsonb not null default '[]'::jsonb;

comment on column public.mensagens_outbox.anexos is
  'Arquivos do storage a anexar no envio: [{nome, bucket, caminho, mime, sha256?}]. O worker '
  'baixa com o service role na hora de despachar — URL assinada gravada aqui expiraria na fila.';

alter table public.mensagens_outbox drop constraint mensagens_outbox_origem_check;
alter table public.mensagens_outbox add constraint mensagens_outbox_origem_check
  check (origem = any (array['compositor', 'outbox', 'agente', 'campanha', 'lembrete', 'cobranca']));

alter table public.comunicacoes drop constraint comunicacoes_origem_check;
alter table public.comunicacoes add constraint comunicacoes_origem_check
  check (origem is null or origem = any (array['compositor', 'outbox', 'agente', 'app_toque', 'inbox', 'sistema',
                                               'campanha', 'celular', 'lembrete', 'cobranca']));

-- ─── A fila devolve o resultado para a entrega da notificação ───────────────

create or replace function public.cobranca_entrega_acompanha_fila()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem <> 'cobranca' then
    return new;
  end if;

  update public.cobranca_notificacao_entregas e set
    comunicacao_id = coalesce(new.comunicacao_id, e.comunicacao_id),
    status = case
      when new.status = 'enviada' and e.status = 'pendente' then 'enviado'
      when new.status in ('falhou', 'descartada') and e.status = 'pendente' then 'falhou'
      else e.status end,
    enviado_em = case when new.status = 'enviada' then coalesce(e.enviado_em, now()) else e.enviado_em end,
    observacao = case when new.status in ('falhou', 'descartada') then coalesce(new.erro, new.motivo_descarte, e.observacao)
                      else e.observacao end
  where e.outbox_id = new.id;

  return new;
end;
$$;

create trigger mensagens_outbox_cobranca_entrega
  after update of status, comunicacao_id on public.mensagens_outbox
  for each row
  when (new.origem = 'cobranca')
  execute function public.cobranca_entrega_acompanha_fila();

-- Confirmação do provedor (entregue/lida) é a prova de entrega do canal digital.
create or replace function public.cobranca_entrega_acompanha_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notif uuid;
begin
  if new.status_envio in ('entregue', 'lida') then
    update public.cobranca_notificacao_entregas set status = 'entregue', confirmado_em = coalesce(confirmado_em, now())
    where comunicacao_id = new.id and status in ('pendente', 'enviado')
    returning notificacao_id into v_notif;
    if v_notif is not null then
      update public.cobranca_notificacoes set status = 'entregue' where id = v_notif and status = 'enviada';
    end if;
  elsif new.status_envio = 'falhou' then
    update public.cobranca_notificacao_entregas set status = 'falhou', observacao = coalesce(new.erro, observacao)
    where comunicacao_id = new.id and status in ('pendente', 'enviado');
  end if;
  return new;
end;
$$;

create trigger comunicacoes_cobranca_entrega
  after update of status_envio on public.comunicacoes
  for each row
  when (new.origem = 'cobranca' and new.status_envio is distinct from old.status_envio)
  execute function public.cobranca_entrega_acompanha_ledger();

revoke all on function public.cobranca_entrega_acompanha_fila() from public, anon, authenticated;
revoke all on function public.cobranca_entrega_acompanha_ledger() from public, anon, authenticated;

-- ─── Crédito: sacado em cobrança não abre análise ───────────────────────────

create or replace function public.analises_credito_recusa_em_cobranca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem is distinct from 'atradius_backfill' and public.app_cobranca_sacado_bloqueado(new.cnpj) then
    raise exception 'Este sacado está em cobrança extrajudicial: novas análises ficam suspensas até a regularização.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger analises_credito_bloqueio_cobranca
  before insert on public.analises_credito
  for each row execute function public.analises_credito_recusa_em_cobranca();

/*
 * §11 item 5: a marca de revisão pós-inadimplência cai quando uma análise ABERTA
 * DEPOIS da regularização é decidida. A decisão humana é o que a marca pedia.
 */
create or replace function public.analises_credito_fecha_revisao_pos_inadimplencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estagio in ('aprovada', 'aprovada_parcial', 'negada') and old.estagio is distinct from new.estagio then
    update public.empresas e set credito_revisao_pos_inadimplencia = false, credito_revisao_desde = null
    where e.credito_revisao_pos_inadimplencia
      and (e.id = new.empresa_id or e.cnpj = new.cnpj)
      and new.criada_em >= e.credito_revisao_desde;
  end if;
  return new;
end;
$$;

create trigger analises_credito_revisao_pos_inadimplencia
  after update of estagio on public.analises_credito
  for each row execute function public.analises_credito_fecha_revisao_pos_inadimplencia();

revoke all on function public.analises_credito_recusa_em_cobranca() from public, anon, authenticated;
revoke all on function public.analises_credito_fecha_revisao_pos_inadimplencia() from public, anon, authenticated;

-- O knockout do scorecard (04d), no mesmo lugar do `processo_nosso_ativo`.
alter table public.empresa_scores drop constraint empresa_scores_knockout_check;
alter table public.empresa_scores add constraint empresa_scores_knockout_check
  check (knockout is null or knockout = any (array['situacao_irregular', 'negada_recente', 'processo_nosso_ativo', 'em_cobranca']));

-- ─── Funil: sacado em cobrança não vai para "antecipação em andamento" ──────

create or replace function public.funil_recusa_operacao_em_cobranca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.estagio_funil = 'antecipacao_andamento'
     and old.estagio_funil is distinct from new.estagio_funil
     and public.app_cobranca_sacado_bloqueado(new.sacado_cnpj) then
    raise exception 'O sacado desta nota está em cobrança: a solicitação de operação fica bloqueada até a regularização.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.funil_recusa_operacao_em_cobranca() from public, anon, authenticated;

create trigger notas_fiscais_bloqueio_cobranca
  before update of estagio_funil on public.notas_fiscais
  for each row execute function public.funil_recusa_operacao_em_cobranca();

create trigger pre_autorizacoes_bloqueio_cobranca
  before update of estagio_funil on public.pre_autorizacoes
  for each row execute function public.funil_recusa_operacao_em_cobranca();

create trigger sienge_titulos_bloqueio_cobranca
  before update of estagio_funil on public.sienge_titulos
  for each row execute function public.funil_recusa_operacao_em_cobranca();
