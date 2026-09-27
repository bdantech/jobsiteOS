-- ============================================================================
-- 0269h — Cobrança: o relógio lembra o que já avisou, e a regularização segue a
-- cl. 17700.20 b
--
-- `alertas_emitidos` guarda, por marco, a data do último aviso. O job diário avisa
-- cada marco UMA vez — a primeira execução em que a antecedência foi alcançada, para
-- que um dia sem job não engula o aviso — e o crítico de D+85 todo dia.
--
-- A 0269d calculava a retroatividade de 30 dias na regularização. Mas regularizar
-- pressupõe que o sacado foi posto em cobrança, e essa interrupção (cl. 17700.20 b)
-- não retroage: o aviso do §6.4 diz exatamente isso a quem aperta o botão. O teste
-- `sacado posto em cobrança: não há retroatividade…` (relogio-apolice.test.ts) é a
-- mesma regra do lado do core.
-- ============================================================================

alter table public.apolice_prazos add column alertas_emitidos jsonb not null default '{}'::jsonb;

create or replace function public.app_cobranca_regularizar_sacado(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_matriz text := p ->> 'sacado_matriz_cnpj';
  v_pendentes int;
  v_protestos int;
  v_restaurar boolean := coalesce((public.app__cobranca_config('regularizacao') ->> 'restaurar_limite_automaticamente')::boolean, false);
  v_pago_em date;
  v_volta date;
  v_empresa uuid;
  v_prazos int;
begin
  perform public.app_cobranca_exige_gestor();

  if not exists (select 1 from public.cobranca_bloqueios_cnpj where sacado_matriz_cnpj = v_matriz)
     and not exists (select 1 from public.empresas where cnpj = v_matriz and bloqueio_cobranca) then
    raise exception 'Este sacado não está bloqueado.' using errcode = '22023';
  end if;

  -- Quitação parcial não regulariza (§11).
  select count(*) into v_pendentes
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz
    and c.estagio not in ('cancelada')
    and ct.situacao not in ('quitado', 'retirado');
  if v_pendentes > 0 then
    raise exception 'Ainda há % título(s) sem quitação nas cobranças deste grupo.', v_pendentes using errcode = '22023';
  end if;

  -- Protesto não retirado depois de pago vira dano moral contra nós (§8, §11 item 3).
  select count(*) into v_protestos
  from public.protesto_titulos pt
  join public.protesto_remessas r on r.id = pt.remessa_id and r.tipo = 'apresentacao'
  join public.cobrancas c on c.id = r.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz
    and pt.situacao in ('enviado', 'apontado', 'protestado')
    and pt.instrucao_cancelamento_em is null
    and nullif(btrim(pt.instrucao_nao_aplicavel_motivo), '') is null;
  if v_protestos > 0 then
    raise exception 'Há % protesto(s) sem instrução de cancelamento. Envie a retirada (ou marque como não aplicável) antes de regularizar.', v_protestos
      using errcode = '22023';
  end if;

  select max(ct.quitado_em) into v_pago_em
  from public.cobranca_titulos ct join public.cobrancas c on c.id = ct.cobranca_id
  where c.sacado_matriz_cnpj = v_matriz and ct.situacao = 'quitado';
  v_pago_em := coalesce(v_pago_em, current_date);

  -- Regularizar pressupõe cobrança (o bloqueio só nasce do envio): é a Interrupção da
  -- cl. 17700.20 b, e ela não tem retroatividade — a cobertura volta para o que for
  -- cedido a partir do pagamento. A retroatividade de 30 dias (§6.3 item 2) é da
  -- parada por D+60 SEM cobrança, e é o relógio que a calcula para esses títulos.
  with fechados as (
    update public.apolice_prazos ap set
      status = 'encerrado_pagamento',
      pago_em = coalesce(ap.pago_em, v_pago_em),
      restabelecimento_retroativo = false,
      cobertura_volta_em = coalesce(ap.pago_em, v_pago_em),
      calculado_em = now()
    from public.titulos t
    where t.id = ap.titulo_id and t.sacado_matriz_cnpj = v_matriz and ap.status = 'ativo'
    returning ap.restabelecimento_retroativo, ap.cobertura_volta_em
  )
  select count(*), max(cobertura_volta_em) into v_prazos, v_volta from fechados;

  delete from public.cobranca_bloqueios_cnpj where sacado_matriz_cnpj = v_matriz;

  update public.empresas e set
    bloqueio_cobranca = false,
    bloqueio_cobranca_motivo = null,
    bloqueio_cobranca_em = null,
    bloqueio_cobranca_cobranca_id = null,
    credito_revisao_pos_inadimplencia = not v_restaurar,
    credito_revisao_desde = case when v_restaurar then null else now() end
  where e.id in (select public.app__cobranca_empresas_do_grupo(v_matriz))
     or e.bloqueio_cobranca_cobranca_id in (select id from public.cobrancas where sacado_matriz_cnpj = v_matriz);

  select id into v_empresa from public.empresas where cnpj = v_matriz;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa, 'cobranca.sacado_regularizado', jsonb_build_object(
    'titulo', 'Sacado regularizado',
    'resumo', 'Bloqueio de cobrança removido. Último pagamento em ' || to_char(v_pago_em, 'DD/MM/YYYY') ||
              case when v_restaurar then '.' else '. O limite fica em revisão pós-inadimplência na esteira de crédito.' end,
    'url', '/cobranca',
    'sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'cobertura_volta_em', v_volta,
    'revisao_pos_inadimplencia', not v_restaurar), v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cobranca.sacado_regularizado', 'empresas', coalesce(v_empresa::text, v_matriz),
          jsonb_build_object('sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'prazos_encerrados', v_prazos));

  return jsonb_build_object(
    'sacado_matriz_cnpj', v_matriz, 'pago_em', v_pago_em, 'prazos_encerrados', v_prazos,
    'cobertura_volta_em', v_volta, 'revisao_pos_inadimplencia', not v_restaurar);
end;
$$;
