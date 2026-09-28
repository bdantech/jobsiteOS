-- ============================================================================
-- 0271b — O agente de conversa e os playbooks: o que a auditoria do 09 achou
--
--   §12   editar um playbook de MANDATO criava a versão nova sem `tipo_mandato`: o
--         worker procura o playbook do tipo por `tipo_mandato = … and ativo` e passava
--         a achar nada. A versão nova herda o tipo, o gestor de agentes pode editá-la,
--         e as regras de mandato que apontavam para a versão anterior seguem a nova;
--   §1.4  mensagem RECEBIDA não devolve mais a conversa `aguardando_humano` ao agente
--         de conversa. Quem devolve é uma pessoa: saída humana (já era) ou mudar o modo
--         do agente no inbox. O mandato continua acordando normalmente;
--   §1.1  conversa presa a mandato ativo não é acordada para o agente de conversa — é
--         do ciclo de mandatos, e acordá-la só a punha na frente da fila do decisor
--         antigo para ser descartada;
--   §6.1  `mudar_estagio_funil` e `pedir_enriquecimento_contato` saem dos playbooks de
--         conversa: nunca tiveram efeito ali.
--
-- As funções recriadas aqui partem de `pg_get_functiondef` em 28/09/2026 (estado vivo),
-- e não só dos arquivos da 0144/0270a/0270b.
-- ============================================================================

-- ─── §12 Salvar playbook: herda o tipo, e o gestor de agentes pode ──────────
--
-- Cada playbook serve a um decisor só. `tipo_mandato` nulo é do agente de conversa
-- (Comunicação › Playbooks, admin); setado é do loop de mandato (Agentes › Configurações
-- › Playbooks, gestão comercial — §12 põe "playbooks por tipo de mandato" nos Settings
-- dos agentes, que são do gestor). O tipo não muda numa versão nova: um playbook de
-- mandato que virasse de conversa levaria consigo nomes de ferramentas que o decisor de
-- conversa não conhece, e vice-versa.
--
-- As regras de mandato que apontavam para a versão anterior passam a apontar para a
-- nova: editar o playbook é para mudar o que os PRÓXIMOS mandatos fazem, e a regra
-- presa na versão inativa ignoraria a edição em silêncio. Os mandatos já criados ficam
-- na versão com que nasceram — é o que o histórico deles explica.

create or replace function public.app_salvar_playbook(p jsonb)
returns public.agente_playbooks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_pb public.agente_playbooks;
  v_anterior uuid;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_versao int := 1;
  v_tipo text := nullif(p ->> 'tipo_mandato', '');
begin
  if v_id is not null then
    select * into v_pb from public.agente_playbooks where id = v_id for update;
    if v_pb.id is null then
      raise exception 'Playbook não encontrado.' using errcode = 'no_data_found';
    end if;
    if not v_pb.ativo then
      raise exception 'Esta versão do playbook já foi substituída. Edite a versão ativa.' using errcode = '22023';
    end if;
    if p ? 'tipo_mandato' and v_tipo is distinct from v_pb.tipo_mandato then
      raise exception 'O tipo de mandato de um playbook não muda numa versão nova.' using errcode = '22023';
    end if;
    v_tipo := v_pb.tipo_mandato;
  end if;

  if v_tipo is null then
    if not public.app_is_admin() then
      raise exception 'Somente administradores editam playbooks do agente de conversa.' using errcode = '42501';
    end if;
  elsif not (public.app_is_admin() or (public.app_tem_modulo('agentes') and public.app_agentes_gestor())) then
    raise exception 'Somente a gestão comercial edita playbooks de mandato.' using errcode = '42501';
  end if;

  if v_id is not null then
    update public.agente_playbooks set ativo = false where id = v_id;
    v_versao := v_pb.versao + 1;
    v_anterior := v_pb.id;
  end if;

  insert into public.agente_playbooks (
    nome, funil, objetivo, instrucoes, acoes_permitidas, templates_disponiveis, prazos, ativo, versao,
    tipo_mandato
  ) values (
    coalesce(p ->> 'nome', v_pb.nome),
    coalesce(p ->> 'funil', v_pb.funil),
    coalesce(p ->> 'objetivo', v_pb.objetivo),
    coalesce(p ->> 'instrucoes', v_pb.instrucoes),
    coalesce((select array_agg(value #>> '{}') from jsonb_array_elements(p -> 'acoes_permitidas')),
             v_pb.acoes_permitidas),
    coalesce((select array_agg((value #>> '{}')::uuid) from jsonb_array_elements(p -> 'templates_disponiveis')),
             coalesce(v_pb.templates_disponiveis, '{}')),
    coalesce(p -> 'prazos', coalesce(v_pb.prazos, '{}'::jsonb)),
    coalesce((p ->> 'ativo')::boolean, true),
    v_versao,
    v_tipo
  ) returning * into v_pb;

  if v_anterior is not null and v_tipo is not null then
    update public.mandato_regras set playbook_id = v_pb.id where playbook_id = v_anterior;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    v_ator,
    case when v_tipo is null then 'comunicacao.playbook_salvo' else 'agentes.playbook_salvo' end,
    'agente_playbooks',
    v_pb.id::text,
    p
  );
  return v_pb;
end $$;

revoke all on function public.app_salvar_playbook(jsonb) from public, anon;
grant execute on function public.app_salvar_playbook(jsonb) to authenticated, service_role;

-- O gestor de agentes nem sempre tem o módulo Comunicação, e a única política de
-- leitura dos playbooks era a dele: a aba de playbooks e o seletor da regra de mandato
-- saíam vazios para quem é justamente o dono deles. Esta vê SÓ os de mandato; os de
-- conversa continuam de quem tem Comunicação.
drop policy if exists agente_playbooks_select_mandato on public.agente_playbooks;
create policy agente_playbooks_select_mandato on public.agente_playbooks
  for select to authenticated
  using (
    tipo_mandato is not null
    and (select public.app_tem_modulo('agentes'))
    and (select public.app_agentes_gestor())
  );

-- ─── §1.4 + §1.1 Quem a mensagem recebida acorda ────────────────────────────
--
-- Duas mudanças no ramo de ENTRADA, e o ramo de saída fica como estava:
--
--   `aguardando_humano` não é acordada. A conversa escalada é de uma pessoa; a
--   resposta do cliente é exatamente o que essa pessoa precisa ler, e não um motivo
--   para o decisor voltar a olhar (e escalar, e notificar de novo). O worker também
--   deixou de trocar o status para `ativa` na entrada (`tocarConversa`), e o contador
--   de não lidas continua subindo — o inbox mostra a mensagem nova do mesmo jeito.
--
--   Conversa de mandato ativo não é acordada para o decisor de conversa: quem a
--   trabalha é o ciclo de mandatos, que esta mesma função acorda logo abaixo. Por isso
--   o vínculo com o mandato da empresa agora é gravado ANTES — a conversa nova do
--   Carlos indicado já nasce "do mandato" para a checagem.

create or replace function public.comunicacoes__acorda_quem_espera()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direcao = 'entrada' then
    if new.empresa_id is not null and new.conversa_id is not null then
      insert into public.mandato_conversas (mandato_id, conversa_id)
      select m.id, new.conversa_id from public.mandatos m
       where m.empresa_id = new.empresa_id
         and m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
      on conflict do nothing;
    end if;

    if new.conversa_id is not null then
      update public.conversas c set proxima_acao_em = now()
       where c.id = new.conversa_id
         and c.modo_agente <> 'desligado'
         and c.status not in ('encerrada', 'aguardando_humano')
         and (c.proxima_acao_em is null or c.proxima_acao_em > now())
         and not exists (
           select 1 from public.mandato_conversas mc
             join public.mandatos m on m.id = mc.mandato_id
            where mc.conversa_id = c.id
              and m.estado in ('aberto', 'em_andamento', 'aguardando_externo'));
    end if;

    update public.mandatos m set
      proxima_acao_em = now(),
      estado = case when m.estado = 'aguardando_externo' then 'em_andamento' else m.estado end
     where m.estado in ('aberto', 'em_andamento', 'aguardando_externo')
       and (
         (new.conversa_id is not null and exists (
            select 1 from public.mandato_conversas mc
             where mc.mandato_id = m.id and mc.conversa_id = new.conversa_id))
         or (new.empresa_id is not null and m.empresa_id = new.empresa_id)
       );
  elsif new.direcao = 'saida' and new.conversa_id is not null and not coalesce(new.por_ia, false) then
    update public.conversas set status = 'aguardando_resposta'
     where id = new.conversa_id and status = 'aguardando_humano';
  end if;
  return new;
end $$;

-- Função de trigger: o privilégio de EXECUTE só é checado no `create trigger`, então
-- ninguém de fora precisa dele.
revoke all on function public.comunicacoes__acorda_quem_espera() from public, anon, authenticated;
grant execute on function public.comunicacoes__acorda_quem_espera() to service_role;

-- ─── §1.4 A ação explícita no inbox que devolve a conversa ──────────────────
--
-- Sem saída humana, a conversa escalada só voltava ao agente se alguém escrevesse para
-- o cliente. Mudar o modo do agente naquela conversa é a outra forma de "uma pessoa
-- olhou e decidiu": em `sugestao` ou `autonomo`, ela volta a `ativa` e é reavaliada no
-- próximo ciclo; em `desligado`, fica onde está (o agente não vai decidir nada nela).

create or replace function public.app_conversa_definir_modo(p jsonb)
returns public.conversas
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_modo text := p ->> 'modo_agente';
  v_conversa public.conversas;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  if v_modo not in ('sugestao', 'autonomo', 'desligado') then
    raise exception 'Modo inválido: %.', v_modo using errcode = '22023';
  end if;

  update public.conversas set
    modo_agente = v_modo,
    objetivo = coalesce(nullif(p ->> 'objetivo', ''), objetivo),
    playbook_id = coalesce(nullif(p ->> 'playbook_id', '')::uuid, playbook_id),
    status = case when status = 'aguardando_humano' and v_modo <> 'desligado' then 'ativa' else status end,
    proxima_acao_em = case
      when status = 'aguardando_humano' and v_modo <> 'desligado' then now()
      else proxima_acao_em
    end
  where id = (p ->> 'id')::uuid
  returning * into v_conversa;

  if v_conversa.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comunicacao.modo_agente_alterado', 'conversas', v_conversa.id::text, p);

  return v_conversa;
end $$;

revoke all on function public.app_conversa_definir_modo(jsonb) from public, anon;
grant execute on function public.app_conversa_definir_modo(jsonb) to authenticated, service_role;

-- ─── §6.1 As ações sem efeito saem dos playbooks de conversa ────────────────
--
-- `mudar_estagio_funil` e `pedir_enriquecimento_contato` estavam no espaço de ações
-- (0144) e o executor devolvia "não executada": o modelo as escolhia, a decisão ia para
-- o log e nada acontecia. Saíram de `ACOES_AGENTE` no core; aqui saem dos playbooks
-- (todas as versões de conversa, para uma conversa presa a uma versão antiga não as
-- oferecer de novo). Os de mandato não são tocados: lá quem move card é
-- `mover_estagio_funil`, que é outra ferramenta e funciona.

update public.agente_playbooks
   set acoes_permitidas = array_remove(array_remove(acoes_permitidas, 'mudar_estagio_funil'),
                                       'pedir_enriquecimento_contato')
 where tipo_mandato is null
   and acoes_permitidas && array['mudar_estagio_funil', 'pedir_enriquecimento_contato']::text[];
