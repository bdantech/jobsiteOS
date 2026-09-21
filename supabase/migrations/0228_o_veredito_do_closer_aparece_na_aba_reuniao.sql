-- ═════════════════════════════════════════════════════════════════════════════
-- 0228 — O veredito do closer aparece na aba Reunião
--
-- ─── A ABA CONTAVA A REUNIÃO ATÉ O DIA DELA, E PARAVA ───────────────────────
-- A aba Reunião do funil de reuniões diz quando é, onde é, quem foi convidado e
-- se o convite chegou ao Google. Tudo isso é sobre o ANTES. O que aconteceu
-- depois — o vendedor que sentou nela confirmou que ela aconteceu, ou recusou
-- dizendo por quê — morava só na fila de aceite, dentro de Comissões.
--
-- Essa é a informação que decide se a reunião virou dinheiro do SDR. Quem abre
-- o card do lead para entender por que aquela reunião não pagou tinha de sair da
-- tela, ir a outro módulo e procurar a linha da empresa numa lista de vinte.
--
-- ─── UM ACEITE POR LEAD, E É POR ELE QUE SE PROCURA ─────────────────────────
-- `sdr_aceites` tem índice único em `sdr_lead_id`: reagendar não duplica. Então
-- a pergunta "qual o veredito desta reunião" é a mesma que "qual o veredito
-- deste lead" — não há ambiguidade a resolver aqui.
--
-- ─── A VISIBILIDADE É A DA POLICY, REPETIDA À MÃO ───────────────────────────
-- Esta função é `security definer` e a policy de `sdr_aceites` não roda dentro
-- dela. O portão dela é outro: "posso ver o ANFITRIÃO do evento". Deixar por
-- isso entregaria o veredito a quem enxerga quem marcou a reunião mas não
-- enxerga nenhuma das duas pontas da passagem — que é justamente o recorte que
-- a 0188 escreveu. A condição de `sdr_aceites_select` vai repetida aqui, e o
-- aceite volta nulo para quem ela recusaria.
--
-- Quem DECIDIU vem junto e separado de quem recebeu a reunião: um gestor também
-- pode decidir por ele (`app_decidir_aceite_sdr`), e "o Marcelo recusou" quando
-- foi o gestor que recusou é uma frase falsa sobre uma decisão que mexe em
-- comissão.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_reuniao_do_card(p jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_venda uuid := nullif(p ->> 'venda_id', '')::uuid;
  v_lead uuid := nullif(p ->> 'sdr_lead_id', '')::uuid;
  v_e public.vendedor_eventos;
  v_dono public.vendedores;
  v_conta public.gmail_contas;
  v_ac public.sdr_aceites;
  v_visiveis uuid[];
  v_aceite jsonb := null;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_venda is null and v_lead is null then
    raise exception 'Informe venda_id ou sdr_lead_id.' using errcode = '22023';
  end if;

  select * into v_e from public.vendedor_eventos
  where tipo = 'reuniao' and cancelado_em is null
    and ((v_venda is not null and venda_id = v_venda)
      or (v_lead is not null and sdr_lead_id = v_lead))
  order by inicio_em desc limit 1;

  if v_e.id is null then return null; end if;

  if not (public.app_pode_ver_vendedor(v_e.vendedor_id)
          or exists (select 1 from unnest(v_e.acompanhantes) a
                     where public.app_pode_ver_vendedor(a))) then
    return null;
  end if;

  select * into v_dono from public.vendedores where id = v_e.vendedor_id;
  select * into v_conta from public.gmail_contas
  where usuario_id = v_dono.usuario_id and ativo;

  -- O veredito de quem sentou na reunião. Só o funil de reuniões tem um: a
  -- passagem SDR → vendedor é o que a fila de aceite confirma.
  select * into v_ac from public.sdr_aceites
  where sdr_lead_id = coalesce(v_e.sdr_lead_id, v_lead);

  if v_ac.id is not null then
    v_visiveis := coalesce(public.app_vendedores_visiveis(), '{}'::uuid[]);
    if v_ac.sdr_id = any (v_visiveis) or v_ac.vendedor_destino_id = any (v_visiveis) then
      v_aceite := jsonb_build_object(
        'id', v_ac.id,
        'status', v_ac.status,
        'automatico', v_ac.aceite_automatico,
        'motivo_recusa', v_ac.motivo_recusa,
        'prazo_em', v_ac.prazo_em,
        'decidido_em', v_ac.decidido_em,
        'vendedor', (select nome from public.vendedores where id = v_ac.vendedor_destino_id),
        -- Nome de vendedor quando quem decidiu é um; de usuário quando é um
        -- gestor sem ficha de vendedor. Nulo enquanto ninguém decidiu, e
        -- também no aceite por decurso de prazo — ali quem decidiu foi o relógio.
        'decidido_por', (
          select coalesce(
            (select vd.nome from public.vendedores vd
             where vd.usuario_id = u.id order by vd.ativo desc limit 1),
            u.nome)
          from public.usuarios u where u.id = v_ac.decidido_por
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'id', v_e.id,
    'titulo', v_e.titulo,
    'inicio_em', v_e.inicio_em,
    'duracao_min', v_e.duracao_min,
    'modalidade', v_e.modalidade,
    'local', v_e.local,
    'meet_url', v_e.meet_url,
    'descricao', v_e.descricao,
    'venda_id', v_e.venda_id,
    'sdr_lead_id', v_e.sdr_lead_id,
    'participantes', v_e.participantes,
    'anfitriao', jsonb_build_object('vendedor_id', v_dono.id, 'nome', v_dono.nome),
    'acompanhantes', coalesce((
      select jsonb_agg(jsonb_build_object('vendedor_id', v2.id, 'nome', v2.nome))
      from public.vendedores v2 where v2.id = any (v_e.acompanhantes)
    ), '[]'::jsonb),
    'aceite', v_aceite,
    'google', jsonb_build_object(
      'evento_id', v_e.google_evento_id,
      'pendente', v_e.google_pendente_em is not null,
      'sincronizado_em', v_e.google_sincronizado_em,
      'erro', v_e.google_erro,
      'conta', v_conta.endereco,
      'tem_escopo_agenda',
        v_conta.usuario_id is not null
        and 'https://www.googleapis.com/auth/calendar.events' = any (v_conta.escopos)
    )
  );
end $function$;

comment on function public.app_reuniao_do_card is
  'A reunião viva de um card do funil, com o estado da sincronização com o Google e — '
  'quando o card é um lead do funil de reuniões — o veredito do vendedor que a recebeu, '
  'que é o que decide se ela vira comissão do SDR.';
