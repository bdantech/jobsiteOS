-- ─────────────────────────────────────────────────────────────────────────────
-- 0146 — Colocar uma empresa no funil de reuniões, à mão
--
-- `sdr_leads.origem` aceita 'manual' desde a 0091 e NADA nunca escreveu esse
-- valor. As duas portas de entrada do funil eram a distribuição semanal
-- (`worker/jobs/comercial/distribuir.ts`, `origem = 'distribuicao'`) e o
-- formulário de inbound (0120, `origem = 'inbound'`). Quem olhava uma empresa no
-- Universo e sabia que ela valia uma reunião não tinha o que clicar: só esperar a
-- distribuição da semana escolhê-la, ou não escolher.
--
-- As regras aqui são as MESMAS da distribuição automática, e de propósito. Se a
-- porta manual fosse mais frouxa, ela viraria o caminho para furar a fila — e a
-- primeira coisa a quebrar seria a promessa de que dois SDRs nunca batem na mesma
-- porta. A única regra que o humano pode furar é a carência de `sem_fit`, porque
-- é exatamente aí que ele sabe algo que a régua não sabe; e ela fica registrada
-- no evento como `carencia_ignorada`.
--
-- O que esta função NÃO faz: mover `empresas.estagio` de `mercado` para `lead`.
-- A distribuição automática também não move, e duas portas para o mesmo funil que
-- deixam a empresa em estados diferentes é como o funil começa a mentir. Quem
-- move o estágio é a pessoa, no seletor do topo da ficha.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function app_criar_lead_sdr(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa_id uuid := nullif(p ->> 'empresa_id', '')::uuid;
  v_sdr_id uuid := nullif(p ->> 'sdr_id', '')::uuid;
  v_empresa public.empresas;
  v_sdr public.vendedores;
  v_eu uuid := public.app_vendedor_atual();
  v_gestor boolean := public.app_gestor_comercial();
  v_vivo uuid;
  v_carencia int;
  v_recusa timestamptz;
  v_lead uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_empresa from public.empresas where id = v_empresa_id;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;

  -- ── A porta que o pedido pediu ────────────────────────────────────────────
  -- Cliente e ex-cliente não entram no funil de reuniões. Para o cliente porque
  -- a conversa dele já é outra (e cair num funil de prospecção é ser tratado
  -- como desconhecido por quem ele paga); para o ex-cliente porque reconquista
  -- não é a mesma coisa que primeira reunião, tem outro dono e outra régua —
  -- é win-back, e win-back é 05B.
  if v_empresa.estagio in ('cliente', 'ex_cliente') then
    raise exception
      'Esta empresa é % da OnePay e não entra no funil de reuniões.',
      case v_empresa.estagio when 'cliente' then 'cliente' else 'ex-cliente' end
      using errcode = '23514';
  end if;
  -- `gestao_operacao <> passivo` NÃO é checado aqui, ao contrário da distribuição
  -- automática: `empresas_gestao_so_cliente_check` já garante que só cliente e
  -- ex-cliente têm gestão definida, e os dois acabaram de ser barrados acima.
  -- Repetir a condição daria a impressão de uma segunda porta que não existe.

  -- ── Um lead vivo não vira dois ────────────────────────────────────────────
  -- Mesma regra da distribuição e do inbound. O id volta no erro para a tela
  -- poder dizer QUEM já está com ela, em vez de só recusar.
  select id into v_vivo from public.sdr_leads
  where empresa_id = v_empresa.id and encerrado_em is null and estagio <> 'qualificada'
  order by distribuido_em desc limit 1;
  if v_vivo is not null then
    raise exception 'Esta empresa já tem um lead vivo no funil de reuniões.'
      using errcode = '23505', detail = v_vivo::text;
  end if;

  -- ── Quem recebe ───────────────────────────────────────────────────────────
  -- Sem gestor, o SDR só pode puxar para si. Deixar um SDR jogar empresa na fila
  -- de outro é como a fila de alguém enche sem que essa pessoa tenha decidido nada.
  v_sdr_id := coalesce(v_sdr_id, v_eu);
  if v_sdr_id is null then
    raise exception 'Escolha o SDR que vai trabalhar esta empresa.' using errcode = '23502';
  end if;
  if not v_gestor and v_sdr_id <> coalesce(v_eu, '00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'Só gestores colocam empresa na fila de outro SDR.' using errcode = '42501';
  end if;

  select * into v_sdr from public.vendedores where id = v_sdr_id and ativo;
  if v_sdr.id is null then
    raise exception 'SDR inativo ou inexistente.' using errcode = '23503';
  end if;
  if v_sdr.tipo <> 'sdr' then
    raise exception '% não é SDR — o funil de reuniões é dele.', v_sdr.nome
      using errcode = '23514';
  end if;

  -- ── A carência de `sem_fit`: aviso, não muro ──────────────────────────────
  select coalesce((valor ->> 'sem_fit_carencia_dias')::int, 90) into v_carencia
  from public.comercial_config where chave = 'distribuicao';

  select encerrado_em into v_recusa from public.sdr_leads
  where empresa_id = v_empresa.id
    and encerrado_motivo = 'sem_fit'
    and encerrado_em > now() - (coalesce(v_carencia, 90) || ' days')::interval
  order by encerrado_em desc limit 1;

  insert into public.sdr_leads (empresa_id, sdr_id, origem, estagio, ultimo_toque_em)
  -- `ultimo_toque_em` fica NULL: pôr uma empresa na fila não é ter falado com ela.
  -- O inbound carimba `now()` porque lá a pessoa REALMENTE escreveu; carimbar aqui
  -- daria a um lead intocado sete dias de folga no relógio do SLA.
  values (v_empresa.id, v_sdr.id, 'manual', 'a_contatar', null)
  returning id into v_lead;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'sdr.lead_distribuido', jsonb_build_object(
    'lead_id', v_lead, 'para', v_sdr.id, 'sdr_nome', v_sdr.nome, 'origem', 'manual',
    'carencia_ignorada', v_recusa is not null,
    'sem_fit_em', v_recusa
  ), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.lead_criado_manual', 'sdr_leads', v_lead::text,
    jsonb_build_object(
      'empresa_id', v_empresa.id, 'sdr_id', v_sdr.id,
      'carencia_ignorada', v_recusa is not null
    ));

  return jsonb_build_object(
    'lead_id', v_lead,
    'sdr_id', v_sdr.id,
    'sdr_nome', v_sdr.nome,
    'carencia_ignorada', v_recusa is not null
  );
end; $$;

comment on function app_criar_lead_sdr(jsonb) is
  'Coloca uma empresa no funil de reuniões à mão (`origem = manual`), vinculada a um SDR. '
  'Recusa cliente e ex-cliente, e recusa segundo lead vivo na mesma empresa. Um SDR só '
  'puxa para si; gestor coloca na fila de qualquer um.';

revoke all on function app_criar_lead_sdr(jsonb) from public;
grant execute on function app_criar_lead_sdr(jsonb) to authenticated;
