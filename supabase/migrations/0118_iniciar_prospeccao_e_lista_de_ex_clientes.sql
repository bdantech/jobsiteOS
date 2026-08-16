-- =============================================================================
-- 0118 — Uma etapa a mais no funil, e o indicador de ex-cliente que abre a lista
--
-- ─── 1. `iniciar_prospeccao` ────────────────────────────────────────────────
--
-- Entre "Universo" (tudo que falta, 41 cards hoje) e "Em prospecção" (alguém já está
-- falando com o cliente) não havia onde colocar a decisão de QUE cliente atacar. Sem
-- ela, "Universo" acumulava as duas coisas — a fila inteira e o que foi escolhido — e
-- uma coluna que significa duas coisas não prioriza nenhuma.
--
-- ─── 2. `ex_clientes_lista` ─────────────────────────────────────────────────
--
-- Os indicadores da aba Análise diziam "142 ex-clientes, 1 com chance de retorno" e
-- paravam aí. Um número que não abre é um número em que se acredita ou não se
-- acredita; abrindo, vira lista de quem ligar.
--
-- LÊ A MESMA BASE DOS INDICADORES (`ex_clientes.na_lista`, 0115). Se a lista mostrasse
-- 3 linhas sob um contador que diz 1, o problema não seria a lista — seria ter duas
-- definições outra vez, que é o defeito que a 0115 existiu para apagar.
-- =============================================================================

alter table public.certificado_cards drop constraint if exists certificado_cards_estagio_check;
alter table public.certificado_cards add constraint certificado_cards_estagio_check
  check (estagio in (
    'universo', 'iniciar_prospeccao', 'prospeccao', 'emissao_agendada',
    'pendente_spes', 'ganho', 'perdido'
  ));

create or replace function public.app_mover_certificado_card(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.certificado_cards;
  v_estagio text := p ->> 'estagio';
  v_motivo uuid := nullif(p ->> 'perdido_motivo', '')::uuid;
  v_matriz_coberta boolean;
  v_total int;
  v_cobertos int;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  select * into v_card from public.certificado_cards where id = (p ->> 'card_id')::uuid;
  if v_card.id is null then
    raise exception 'Card não encontrado.' using errcode = 'P0002';
  end if;

  if not public.app_gestor_comercial() and not exists (
    select 1 from public.vendedor_carteira c
    where c.vendedor_id = public.app_vendedor_atual()
      and c.empresa_id = v_card.empresa_id and c.papel = 'originacao' and c.ate is null
  ) then
    raise exception 'Este cliente não está na sua carteira.' using errcode = '42501';
  end if;

  if v_estagio not in ('universo','iniciar_prospeccao','prospeccao','emissao_agendada',
                       'pendente_spes','ganho','perdido') then
    raise exception 'Estágio inválido: %.', v_estagio using errcode = '22023';
  end if;

  select
    count(*)::int,
    count(*) filter (where coberto)::int,
    coalesce(bool_or(coberto) filter (where e_matriz), false)
    into v_total, v_cobertos, v_matriz_coberta
  from public.certificado_universo where empresa_id = v_card.empresa_id;

  if v_estagio = 'ganho' and not v_matriz_coberta then
    raise exception 'Sem o certificado da matriz este card não pode ser ganho.'
      using errcode = '23514';
  end if;

  if v_estagio = 'perdido' and v_motivo is null then
    raise exception 'Perder exige motivo.' using errcode = '23514';
  end if;

  if v_estagio = 'pendente_spes' and not v_matriz_coberta then
    raise exception 'Esta coluna é para quem já tem o certificado da matriz.'
      using errcode = '23514';
  end if;

  update public.certificado_cards set
    estagio = v_estagio,
    estagio_anterior = case when v_estagio = 'pendente_spes' then v_card.estagio else null end,
    perdido_motivo = case when v_estagio = 'perdido' then v_motivo else null end,
    perdido_em = case when v_estagio = 'perdido' then now() else null end,
    ganho_em = case when v_estagio = 'ganho' then now() else null end,
    fechado_matriz_coberta = case when v_estagio in ('ganho','perdido') then v_matriz_coberta end,
    fechado_cobertos = case when v_estagio in ('ganho','perdido') then v_cobertos end,
    observacao = coalesce(nullif(p ->> 'observacao', ''), observacao),
    atualizado_em = now(),
    atualizado_por = auth.uid()
  where id = v_card.id;

  insert into public.certificado_card_eventos (card_id, de, para, motivo, automatico, usuario_id)
  values (v_card.id, v_card.estagio, v_estagio, v_motivo, false, auth.uid());

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'certificado.card.movido', 'certificado_cards', v_card.id::text,
          jsonb_build_object('de', v_card.estagio, 'para', v_estagio, 'motivo', v_motivo));

  return jsonb_build_object('id', v_card.id, 'estagio', v_estagio);
end $$;

revoke all on function public.app_mover_certificado_card(jsonb) from public;
grant execute on function public.app_mover_certificado_card(jsonb) to authenticated;

-- ─── A lista por trás de cada indicador ─────────────────────────────────────

create or replace function public.ex_clientes_lista(
  p_recorte text,
  p_motivos text[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ex_cliente_desde desc nulls last, t.nome), '[]'::jsonb)
  from (
    select
      x.empresa_id, x.cnpj, x.nome, x.ex_cliente_desde, x.meses_desde,
      x.ultimo_limite, x.uf,
      coalesce(mp.motivo, 'Não classificado') as motivo,
      mp.retorno_possivel
    from public.ex_clientes x
      left join public.motivos_perda mp on mp.id = x.ex_cliente_motivo
    where x.na_lista
      and case p_recorte
        when 'todos'       then true
        when 'com_retorno' then mp.retorno_possivel is true
        when 'sem_retorno' then mp.retorno_possivel is false
        when 'indefinido'  then mp.retorno_possivel is null
        -- `motivos` recebe um array porque a fatia "Outros (N motivos)" do donut é uma
        -- soma de vários: mandar o conjunto é o que faz o clique numa fatia agregada
        -- abrir exatamente as linhas que ela somou.
        when 'motivos'     then coalesce(mp.motivo, 'Não classificado') = any(coalesce(p_motivos, '{}'))
        else false
      end
  ) t;
$$;

comment on function public.ex_clientes_lista(text, text[]) is
  'Os ex-clientes por trás de cada indicador da aba Análise. Mesma base dos '
  'contadores (`ex_clientes.na_lista`): a lista que abre nunca pode discordar do '
  'número que foi clicado.';

grant execute on function public.ex_clientes_lista(text, text[]) to authenticated;
