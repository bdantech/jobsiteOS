-- ─────────────────────────────────────────────────────────────────────────────
-- 0280 — O ignorado pode voltar para a fila
--
-- Ignorar um contato na fila de identificação só tinha volta por acaso: o worker
-- devolve a linha a `pendente` quando a pessoa escreve de novo. Quem ignorou por
-- engano não tinha como desfazer — e, desde a 0278, um ignorado também some do
-- Meu Dia, o que torna o engano mais caro.
--
-- `app_conversa_reabrir` é o espelho exato de `app_conversa_ignorar`: mesmo portão
-- (o módulo), mesma trilha no audit_log, e só mexe numa linha que esteja ignorada —
-- reabrir uma vinculada desfaria um contato criado, e isso não é desfazer engano.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_conversa_reabrir(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ator uuid := auth.uid();
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  update public.conversas_nao_vinculadas
    set status = 'pendente', resolvida_por = null, resolvida_em = null
    where id = (p ->> 'id')::uuid and status = 'ignorada';
  if not found then
    raise exception 'Este contato não está mais entre os ignorados.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.conversa_reaberta', 'conversas_nao_vinculadas', p ->> 'id', p);
end $$;

revoke all on function public.app_conversa_reabrir(jsonb) from public, anon;
grant execute on function public.app_conversa_reabrir(jsonb) to authenticated, service_role;
