-- ─────────────────────────────────────────────────────────────────────────────
-- 0261 — O SDR agenda na venda que já está aberta
--
-- Desde a 0260 uma empresa pode entrar no funil de vendas sem passar pelo SDR. Se
-- depois um SDR agendasse reunião com ela, `app_mover_lead_sdr` só procurava venda
-- ligada ao MESMO lead — não achava a do closer — e criava uma segunda venda para a
-- mesma empresa, com dois closers trabalhando a mesma conta.
--
-- Agora a busca tem dois degraus:
--   1. a venda DESTE lead ......... é remarcação, como sempre foi: o closer escolhido
--                                   pelo SDR assume e o estágio vira "reagendada".
--   2. a venda aberta da EMPRESA ... veio por outro caminho. Ela é reaproveitada, e a
--                                   reunião vai para o closer DONO dela, mesmo que o
--                                   SDR tenha escolhido outro: a conta já tem closer,
--                                   e o SDR (que não enxerga vendas alheias) não tinha
--                                   como saber. O estágio não vira "reagendada" — é a
--                                   primeira reunião dessa venda. `sdr_lead_id` é
--                                   preenchido se estava vazio, para a venda saber de
--                                   qual reunião veio. Se o dono estiver inativo, fica
--                                   o closer que o SDR escolheu, e a venda passa a ele.
--
-- "Aberta" é a definição de `vendaNoFunil` no core (`situacao <> 'perdido'` e sem
-- primeira operação), a mesma da 0260. O filtro anterior olhava `estagio not in
-- ('ganho', 'perdido')`, que a 0094 aposentou — uma venda PERDIDA do mesmo lead era
-- reaproveitada e voltava ao funil sem ninguém pedir.
--
-- O resto da função é o da 0213, sem mudança.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app_mover_lead_sdr(p jsonb)
returns public.sdr_leads
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ator uuid := auth.uid();
  v_lead public.sdr_leads;
  v_estagio text := nullif(p ->> 'estagio', '');
  v_tem_fit boolean := p ? 'fit' and jsonb_typeof(p -> 'fit') = 'boolean';
  v_fit boolean := (p ->> 'fit')::boolean;
  v_motivo uuid := nullif(p ->> 'sem_fit_motivo', '')::uuid;
  v_reuniao timestamptz := nullif(p ->> 'reuniao_em', '')::timestamptz;
  v_destino uuid := nullif(p ->> 'vendedor_destino_id', '')::uuid;
  v_modalidade text := coalesce(nullif(p ->> 'modalidade', ''), 'meet');
  v_local text := nullif(p ->> 'local', '');
  v_participantes jsonb := coalesce(p -> 'participantes', '[]'::jsonb);
  v_duracao int := coalesce(nullif(p ->> 'duracao_min', '')::int, 30);
  v_empresa public.empresas;
  v_venda_id uuid;
  v_evento_id uuid;
  v_remarcou boolean := false;
  v_da_empresa boolean := false;
  v_dono_venda uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_lead from public.sdr_leads where id = (p ->> 'lead_id')::uuid;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_lead.empresa_id;

  if v_tem_fit and v_lead.estagio = 'a_contatar' and coalesce(v_estagio, '') = 'a_contatar' then
    raise exception 'Avalie o fit depois de contatar a empresa.' using errcode = '22023';
  end if;
  if v_tem_fit and not v_fit and v_motivo is null then
    raise exception 'Sem fit exige motivo.' using errcode = '22023';
  end if;
  if v_lead.estagio = 'a_contatar' and v_estagio = 'em_conversa' then
    raise exception 'O lead entra em conversa sozinho, quando a primeira mensagem sair.'
      using errcode = '42501';
  end if;
  if v_estagio = 'reuniao_agendada' and (v_reuniao is null or v_destino is null) then
    raise exception 'Agendar exige data e vendedor destino.' using errcode = '22023';
  end if;
  if v_modalidade not in ('meet', 'presencial', 'telefone', 'a_definir') then
    raise exception 'Modalidade inválida.' using errcode = '22023';
  end if;
  if v_estagio = 'reuniao_agendada' and v_modalidade = 'presencial' and v_local is null then
    raise exception 'Reunião presencial exige o local.' using errcode = '22023';
  end if;
  if v_duracao < 15 or v_duracao > 480 then
    raise exception 'Duração fora do razoável: % min.', v_duracao using errcode = '22023';
  end if;

  -- ── A venda que esta reunião vai usar — decidida ANTES de gravar o lead, porque
  --    ela pode trocar o closer, e `vendedor_destino_id` tem de dizer o verdadeiro.
  if v_estagio = 'reuniao_agendada' then
    select id into v_venda_id
    from public.vendas
    where sdr_lead_id = v_lead.id and situacao <> 'perdido' and primeira_operacao_em is null
    order by criada_em desc limit 1;

    if v_venda_id is null then
      select vd.id, vd.vendedor_id into v_venda_id, v_dono_venda
      from public.vendas vd
      where vd.empresa_id = v_lead.empresa_id
        and vd.situacao <> 'perdido' and vd.primeira_operacao_em is null
      order by vd.criada_em desc limit 1;

      if v_venda_id is not null then
        v_da_empresa := true;
        if exists (select 1 from public.vendedores v where v.id = v_dono_venda and v.ativo) then
          v_destino := v_dono_venda;
        end if;
      end if;
    end if;
  end if;

  update public.sdr_leads set
    estagio = coalesce(v_estagio, estagio),
    fit = case when v_tem_fit then v_fit else fit end,
    fit_definido_em = case when v_tem_fit then now() else fit_definido_em end,
    sem_fit_motivo = case when v_tem_fit and not v_fit then v_motivo else sem_fit_motivo end,
    encerrado_em = case
      when v_tem_fit and not v_fit then now()
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_em end,
    encerrado_motivo = case
      when v_tem_fit and not v_fit then 'sem_fit'
      when v_tem_fit and v_fit and encerrado_motivo = 'sem_fit' then null
      else encerrado_motivo end,
    reuniao_em = coalesce(v_reuniao, reuniao_em),
    vendedor_destino_id = coalesce(v_destino, vendedor_destino_id),
    ultimo_toque_em = now(),
    atualizado_em = now()
  where id = v_lead.id
  returning * into v_lead;

  if v_estagio = 'reuniao_agendada' then
    if v_venda_id is null then
      insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
      values (v_lead.empresa_id, v_destino, v_lead.id, 'reuniao_agendada')
      returning id into v_venda_id;
    elsif v_da_empresa then
      update public.vendas set
        vendedor_id = v_destino,
        sdr_lead_id = coalesce(sdr_lead_id, v_lead.id),
        atualizada_em = now()
      where id = v_venda_id;
    else
      v_remarcou := true;
      update public.vendas set
        vendedor_id = v_destino,
        estagio = case when estagio in ('reuniao_agendada', 'reuniao_reagendada')
                       then 'reuniao_reagendada' else estagio end,
        atualizada_em = now()
      where id = v_venda_id;
    end if;

    select id into v_evento_id
    from public.vendedor_eventos
    where sdr_lead_id = v_lead.id and tipo = 'reuniao' and cancelado_em is null
    order by criado_em desc limit 1;

    if v_evento_id is null then
      insert into public.vendedor_eventos (
        vendedor_id, acompanhantes, empresa_id, titulo, inicio_em, duracao_min,
        sdr_lead_id, venda_id,
        modalidade, local, participantes, criado_por, google_pendente_em
      )
      values (
        v_destino,
        case when v_lead.sdr_id = v_destino then '{}'::uuid[] else array[v_lead.sdr_id] end,
        v_lead.empresa_id,
        'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'),
        v_reuniao, v_duracao, v_lead.id, v_venda_id,
        v_modalidade, v_local, v_participantes, v_ator, now()
      )
      returning id into v_evento_id;
    else
      update public.vendedor_eventos set
        vendedor_id = v_destino,
        acompanhantes = case when v_lead.sdr_id = v_destino then '{}'::uuid[]
                             else array[v_lead.sdr_id] end,
        venda_id = v_venda_id,
        inicio_em = v_reuniao,
        modalidade = v_modalidade,
        local = v_local,
        participantes = case when v_participantes = '[]'::jsonb then participantes
                             else v_participantes end,
        google_pendente_em = now(),
        atualizado_em = now()
      where id = v_evento_id;
    end if;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', case when v_remarcou then 'Reunião remarcada para ' else 'Reunião agendada para ' end
                  || to_char(v_reuniao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
                  || case when v_da_empresa then ', na venda que já estava aberta.' else '.' end,
        'url', '/comercial/vendas/' || v_venda_id,
        'lead_id', v_lead.id, 'venda_id', v_venda_id, 'evento_id', v_evento_id,
        'remarcada', v_remarcou, 'venda_reaproveitada', v_da_empresa,
        'modalidade', v_modalidade, 'vendedor_destino_id', v_destino),
      v_ator);
  elsif v_estagio = 'no_show' then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.no_show',
      jsonb_build_object('resumo', 'Reunião marcada e não aconteceu (no-show).', 'lead_id', v_lead.id),
      v_ator);
  end if;

  if v_tem_fit and not v_fit then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.sem_fit',
      jsonb_build_object(
        'resumo', 'Sem fit (' || v_lead.estagio || '): ' ||
                  coalesce((select m.motivo from public.motivos_perda m where m.id = v_motivo), '—') || '.',
        'lead_id', v_lead.id, 'motivo_id', v_motivo, 'estagio', v_lead.estagio, 'origem', v_lead.origem),
      v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sdr.lead_movido', 'sdr_leads', v_lead.id::text, p);

  return v_lead;
end $function$;
