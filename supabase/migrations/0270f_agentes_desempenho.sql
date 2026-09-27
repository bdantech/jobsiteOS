-- ============================================================================
-- 0270f — Agentes: o painel de desempenho (§11.5), numa RPC só
--
-- A tela de Desempenho e a tool `agentes.desempenho` da barra de IA leem daqui: duas
-- contas para a mesma pergunta acabariam divergindo, e "quanto custa uma reunião marcada
-- pela IA" é exatamente o número que decide se ela continua.
--
-- ── `agendou` E `converteu` DE VERDADE ──────────────────────────────────────
-- O agente de conversa (05A) declarava esses desfechos e nunca os apurava. Aqui eles são
-- FATOS do banco, não declarações do agente:
--   agendou   o mandato tem `reuniao_id` (a reunião existe em vendedor_eventos);
--   converteu originação: a nota do mandato chegou a `convertida` (quem carimba é o sync
--             da plataforma, não o agente); demais: a empresa ganhou venda depois do
--             mandato começar.
--
-- ── A COLUNA QUE DECIDE SE A IA CONTINUA ────────────────────────────────────
-- A comparação com os humanos NO MESMO RECORTE DE TEMPO: taxa de reunião dos leads dos
-- SDRs humanos e taxa de conversão das notas dos originadores humanos no período. Não é
-- o mesmo escopo linha a linha (o humano não tem filtro), e a tela diz isso.
-- ============================================================================

create or replace function public.app_agentes_desempenho(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_desde timestamptz := coalesce(nullif(p ->> 'desde', '')::timestamptz, now() - interval '30 days');
  v_por_agente jsonb;
  v_por_playbook jsonb;
  v_motivos jsonb;
  v_materiais jsonb;
  v_canais jsonb;
  v_humanos jsonb;
begin
  perform public.app_agentes_exige_modulo();
  if not public.app_agentes_gestor() then
    raise exception 'Somente a gestão comercial vê o desempenho.' using errcode = '42501';
  end if;

  with m as (
    select mm.*,
           (mm.reuniao_id is not null) as agendou,
           case when mm.tipo = 'originacao_nf' then
                  exists (select 1 from public.notas_fiscais nf where nf.access_key = mm.nota_access_key and nf.estagio_funil = 'convertida')
                else
                  exists (select 1 from public.vendas vd where vd.empresa_id = mm.empresa_id and vd.situacao = 'ganho'
                           and vd.atualizada_em >= mm.criado_em)
           end as converteu
      from public.mandatos mm
     where mm.criado_em >= v_desde
  )
  select coalesce(jsonb_agg(x order by x ->> 'nome'), '[]'::jsonb) into v_por_agente from (
    select jsonb_build_object(
      'agente_id', v.id, 'nome', v.nome,
      'mandatos', count(m.id),
      'ativos', count(m.id) filter (where m.estado in ('aberto', 'em_andamento', 'aguardando_externo', 'pausado')),
      'concluidos', count(m.id) filter (where m.estado = 'concluido'),
      'encerrados', count(m.id) filter (where m.estado = 'encerrado_sem_sucesso'),
      'escalados', count(m.id) filter (where m.estado = 'escalado'),
      'taxa_sucesso', round(count(m.id) filter (where m.estado = 'concluido')::numeric
                            / nullif(count(m.id) filter (where m.estado in ('concluido', 'encerrado_sem_sucesso', 'escalado')), 0), 3),
      'reunioes', count(m.id) filter (where m.agendou),
      'convertidos', count(m.id) filter (where m.converteu),
      'custo_centavos', coalesce(sum(m.gasto_centavos), 0),
      'custo_por_concluido', round(coalesce(sum(m.gasto_centavos), 0)::numeric / nullif(count(m.id) filter (where m.estado = 'concluido'), 0)),
      'custo_por_reuniao', round(coalesce(sum(m.gasto_centavos), 0)::numeric / nullif(count(m.id) filter (where m.agendou), 0)),
      'custo_por_conversao', round(coalesce(sum(m.gasto_centavos), 0)::numeric / nullif(count(m.id) filter (where m.converteu), 0)),
      'horas_ate_objetivo', round(avg(extract(epoch from (m.encerrado_em - m.criado_em)) / 3600) filter (where m.estado = 'concluido'), 1),
      'por_tipo', (
        select coalesce(jsonb_object_agg(t.tipo, jsonb_build_object('total', t.total, 'concluidos', t.concluidos)), '{}'::jsonb)
          from (select m2.tipo, count(*) as total, count(*) filter (where m2.estado = 'concluido') as concluidos
                  from m m2 where m2.agente_id = v.id group by m2.tipo) t)
    ) as x
      from public.vendedores v
      left join m on m.agente_id = v.id
     where v.is_ia
     group by v.id, v.nome
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playbook', coalesce(pb.nome, 'sem playbook'), 'mandatos', q.total, 'concluidos', q.concluidos,
      'taxa_sucesso', round(q.concluidos::numeric / nullif(q.terminais, 0), 3),
      'custo_por_concluido', round(q.custo::numeric / nullif(q.concluidos, 0))) order by q.total desc), '[]'::jsonb)
    into v_por_playbook
    from (select mm.playbook_id, count(*) as total, count(*) filter (where mm.estado = 'concluido') as concluidos,
                 count(*) filter (where mm.estado in ('concluido', 'encerrado_sem_sucesso', 'escalado')) as terminais,
                 coalesce(sum(mm.gasto_centavos), 0) as custo
            from public.mandatos mm where mm.criado_em >= v_desde group by mm.playbook_id) q
    left join public.agente_playbooks pb on pb.id = q.playbook_id;

  select coalesce(jsonb_object_agg(coalesce(motivo_encerramento, 'sem motivo'), n), '{}'::jsonb) into v_motivos
    from (select motivo_encerramento, count(*) as n from public.mandatos
           where criado_em >= v_desde and estado in ('concluido', 'encerrado_sem_sucesso', 'escalado')
           group by motivo_encerramento) q;

  -- Eficácia do material: resposta do mesmo contato em até 3 dias depois do envio.
  select coalesce(jsonb_agg(jsonb_build_object(
      'material_id', mat.id, 'nome', mat.nome, 'enviados', q.enviados, 'respondidos', q.respondidos,
      'taxa_resposta', round(q.respondidos::numeric / nullif(q.enviados, 0), 3), 'vezes_usado', mat.vezes_usado)
      order by q.enviados desc), '[]'::jsonb)
    into v_materiais
    from (select (a.argumentos ->> 'material_id')::uuid as material_id, count(*) as enviados,
                 count(*) filter (where exists (
                   select 1 from public.comunicacoes c where c.contato_id = a.contato_id and c.direcao = 'entrada'
                      and c.criado_em between a.executada_em and a.executada_em + interval '3 days')) as respondidos
            from public.mandato_acoes a
           where a.ferramenta = 'enviar_material' and a.sucesso and a.executada_em >= v_desde
             and a.argumentos ->> 'material_id' ~ '^[0-9a-f-]{36}$'
           group by 1) q
    join public.materiais mat on mat.id = q.material_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'canal', q.canal, 'enviados', q.enviados, 'respondidos', q.respondidos,
      'taxa_resposta', round(q.respondidos::numeric / nullif(q.enviados, 0), 3)) order by q.canal), '[]'::jsonb)
    into v_canais
    from (select case a.ferramenta when 'ligar' then 'ligacao' when 'enviar_email' then 'email'
                                   when 'enviar_whatsapp' then 'whatsapp'
                                   else coalesce(a.argumentos ->> 'canal', 'outro') end as canal,
                 count(*) as enviados,
                 count(*) filter (where exists (
                   select 1 from public.comunicacoes c where c.contato_id = a.contato_id and c.direcao = 'entrada'
                      and c.criado_em between a.executada_em and a.executada_em + interval '3 days')
                   or exists (select 1 from public.voz_ligacoes v where v.id = a.voz_ligacao_id and v.status = 'concluida')) as respondidos
            from public.mandato_acoes a
           where a.ferramenta in ('enviar_whatsapp', 'enviar_email', 'enviar_material', 'ligar') and a.sucesso
             and a.executada_em >= v_desde
           group by 1) q;

  select jsonb_build_object(
    'sdr_taxa_reuniao', (
      select round(count(*) filter (where l.estagio in ('reuniao_agendada', 'reuniao_realizada', 'qualificada', 'no_show'))::numeric
                   / nullif(count(*), 0), 3)
        from public.sdr_leads l join public.vendedores v on v.id = l.sdr_id
       where not v.is_ia and l.distribuido_em >= v_desde),
    'originacao_taxa_conversao', (
      select round(count(*) filter (where nf.estagio_funil = 'convertida')::numeric / nullif(count(*), 0), 3)
        from public.notas_fiscais nf join public.vendedores v on v.id = nf.vendedor_id
       where not v.is_ia and nf.vendedor_definido_em >= v_desde),
    'observacao', 'Média dos humanos no mesmo período, sem o filtro de escopo do agente: compara ritmo, não o mesmo recorte de empresas.'
  ) into v_humanos;

  return jsonb_build_object(
    'desde', v_desde, 'por_agente', v_por_agente, 'por_playbook', v_por_playbook,
    'motivos_encerramento', v_motivos, 'materiais', v_materiais, 'canais', v_canais, 'humanos', v_humanos);
end $$;

revoke all on function public.app_agentes_desempenho(jsonb) from public, anon;
grant execute on function public.app_agentes_desempenho(jsonb) to authenticated, service_role;
