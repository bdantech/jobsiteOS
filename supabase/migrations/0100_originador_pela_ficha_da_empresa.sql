-- 0100 — A ficha da empresa também define QUEM trabalha a conta ativa.
--
-- O diálogo "Gestão da operação" perguntava como a conta é trabalhada e, logo abaixo,
-- oferecia um só campo de vendedor — filtrado por `tipo = 'vendedor'`, porque ele existia
-- para o caso PASSIVO (o closer que gere e recebe por volume). Quem escolhia "prospecção
-- ativa" via um seletor vazio e concluía, com razão, que a tela estava quebrada: o único
-- vendedor cadastrado era um originador, e originador não aparecia ali.
--
-- O campo não estava errado — estava incompleto. Cada escolha tem um dono diferente:
--
--   prospecção ativa → ORIGINADOR, que recebe as NFs da conta
--   passivo          → CLOSER, que gere a conta e recebe pelo volume dela
--
-- Faltava a primeira metade. E faltava justamente do lado em que a pergunta nasce: quem
-- acabou de marcar a conta como ativa está, no mesmo pensamento, decidindo quem a trabalha.
--
-- ── Por que escrever em `settings`, e não direto na carteira ──
--
-- Desde o 0098, `settings.empresas_escolhidas` é a FONTE e `vendedor_carteira` é o
-- espelho. Gravar a carteira aqui direto duraria até o próximo save do cadastro do
-- vendedor: o espelho reconcilia contra o `settings`, não veria a empresa lá, e fecharia a
-- vigência que esta tela tinha acabado de abrir. O dono sumiria sozinho, dias depois, sem
-- nada no rastro ligando uma coisa à outra.
--
-- ── Por que aqui REATRIBUI e no cadastro do vendedor RECUSA ──
--
-- No cadastro você edita a LISTA de uma pessoa; puxar uma empresa da lista de outra seria
-- invisível, então lá o conflito é recusado com o nome de quem tem. Aqui você edita UMA
-- empresa, o dono vigente está impresso logo acima no card, e "trocar o dono desta conta"
-- é literalmente o assunto da tela. Recusar seria mandar a pessoa procurar o cadastro do
-- colega para desfazer algo que ela está olhando.

create or replace function public.app_definir_gestao_operacao(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_gestao text := p ->> 'gestao_operacao';
  v_gestor uuid := nullif(p ->> 'vendedor_gestao_id', '')::uuid;
  v_originador uuid := nullif(p ->> 'vendedor_originacao_id', '')::uuid;
  v_tipo text;
  v_ativo boolean;
  r record;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_gestao is not null and v_gestao not in ('prospeccao_ativa', 'passivo') then
    raise exception 'Gestão inválida: %.', v_gestao using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_gestao is not null and v_empresa.estagio not in ('cliente', 'ex_cliente') then
    raise exception
      'Ativo x passivo só se decide para cliente ou ex-cliente da OnePay — esta empresa está em "%".',
      v_empresa.estagio using errcode = '22023';
  end if;
  if v_gestao = 'passivo' and v_gestor is null then
    raise exception 'Empresa passiva precisa de um vendedor de gestão.' using errcode = '22023';
  end if;

  if v_originador is not null then
    /*
     * Carteira é dinheiro, e mexer nela sempre exigiu gestor (`app_definir_carteira`,
     * 0091). Este RPC exigia só o módulo, porque até aqui ele não mexia em carteira
     * nenhuma — decidir ativo × passivo é leitura da conta, não da folha. Agora que ele
     * atribui originador, a checagem tem de vir junto: sem ela um SDR reatribuiria a
     * carteira de um originador pela ficha da empresa, e a comissão junto.
     */
    if not public.app_gestor_comercial() then
      raise exception 'Só gestores definem o originador de uma conta.' using errcode = '42501';
    end if;
    if v_gestao is distinct from 'prospeccao_ativa' then
      raise exception 'Originador só se define em conta de prospecção ativa.' using errcode = '22023';
    end if;
    select tipo, ativo into v_tipo, v_ativo from public.vendedores where id = v_originador;
    if v_tipo is null then
      raise exception 'Originador não encontrado.' using errcode = 'no_data_found';
    end if;
    if v_tipo <> 'originador' or not v_ativo then
      raise exception 'O dono de uma conta ativa é um originador ativo — este é %.', v_tipo
        using errcode = '22023';
    end if;
  end if;

  update public.empresas set
    gestao_operacao = v_gestao,
    gestao_definida_por = case when v_gestao is null then null else v_ator end,
    gestao_definida_em = case when v_gestao is null then null else now() end
  where id = v_empresa.id
  returning * into v_empresa;

  -- Encerra a gestão vigente sempre: mudar de dono e sair de passivo passam pelo mesmo
  -- fechamento, e é ele que congela o intervalo que a comissão vai ler depois.
  update public.vendedor_carteira set ate = now()
  where empresa_id = v_empresa.id and papel = 'gestao_passiva' and ate is null
    and (v_gestao <> 'passivo' or vendedor_id is distinct from v_gestor);

  if v_gestao = 'passivo' then
    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
    select v_gestor, v_empresa.id, 'gestao_passiva'
    where not exists (
      select 1 from public.vendedor_carteira c
      where c.empresa_id = v_empresa.id and c.papel = 'gestao_passiva' and c.ate is null
    );
  end if;

  /*
   * O originador da conta ativa. Tira de quem tinha, põe em quem foi escolhido, e só
   * então reespelha — a ordem importa: reespelhar antes de tirar bateria no índice que
   * garante um dono vigente por (empresa, papel).
   */
  if v_originador is not null then
    update public.vendedores v set settings = jsonb_set(
      coalesce(v.settings, '{}'::jsonb), '{empresas_escolhidas}',
      coalesce((select jsonb_agg(x)
                from jsonb_array_elements_text(v.settings -> 'empresas_escolhidas') x
                where x <> v_empresa.id::text), '[]'::jsonb))
    where v.tipo = 'originador' and v.id <> v_originador
      and coalesce(v.settings -> 'empresas_escolhidas' ? v_empresa.id::text, false);

    update public.vendedores v set settings = jsonb_set(
      coalesce(v.settings, '{}'::jsonb), '{empresas_escolhidas}',
      coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb) || to_jsonb(v_empresa.id::text))
    where v.id = v_originador
      and not coalesce(v.settings -> 'empresas_escolhidas' ? v_empresa.id::text, false);

    for r in
      select v.id,
             coalesce((select array_agg((x)::uuid)
                       from jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
                      '{}'::uuid[]) as ids
      from public.vendedores v where v.tipo = 'originador' and v.ativo
    loop
      perform public.app_sincronizar_carteira_originacao(r.id, r.ids);
    end loop;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'cliente.gestao_alterada',
    jsonb_build_object(
      'resumo', case v_gestao
        when 'passivo' then 'Passou a ser gerida como conta PASSIVA.'
        when 'prospeccao_ativa' then 'Passou a ser trabalhada em prospecção ATIVA.'
        else 'Gestão de operação removida.' end,
      'gestao_operacao', v_gestao, 'vendedor_gestao_id', v_gestor,
      'vendedor_originacao_id', v_originador),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cliente.gestao_alterada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $$;
