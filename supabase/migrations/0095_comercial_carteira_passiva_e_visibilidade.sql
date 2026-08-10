-- 0095 — Gestão só para cliente, carteira passiva do closer, visibilidade cruzada.
--
-- Três correções que vieram do uso, e uma consequência de banco cada:
--
--   §1  "ativo × passivo" era pergunta feita a 8.550 empresas quando só faz sentido
--       para as 50 que são cliente. Vira invariante, não convenção de tela.
--   §2  A carteira de passivas do closer só se montava empresa por empresa, na ficha
--       de cada uma. Ganha o caminho inverso — pelo cadastro do vendedor — que é como
--       alguém realmente pensa ao montar carteira.
--   §3  `vendedor_acessos` existia e não fazia nada fora de comissão. Passa a valer
--       para funil e agenda, que é onde "enxergar o outro" tem significado.

-- ─── §1 Gestão da operação é assunto de cliente ─────────────────────────────
--
-- A pergunta "esta conta é trabalhada ou antecipa sozinha?" pressupõe uma conta que
-- antecipa. Numa empresa de mercado ela não tem resposta possível, e responder assim
-- mesmo tem efeito real: `passivo` tira a empresa da distribuição do SDR — ou seja,
-- um rótulo sem sentido bloquearia justamente a prospecção que deveria acontecer.
--
-- O trigger vem ANTES do CHECK de propósito. Um CHECK sozinho recusaria o rebaixamento
-- de um ex-cliente para `mercado` — a operação legítima viraria erro, e quem estivesse
-- corrigindo o estágio de uma empresa levaria uma violação de constraint sem entender
-- o que gestão comercial tem a ver com isso.

create or replace function public.empresas_gestao_so_cliente()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.estagio not in ('cliente', 'ex_cliente') and new.gestao_operacao is not null then
    new.gestao_operacao := null;
    new.gestao_definida_por := null;
    new.gestao_definida_em := null;
  end if;
  return new;
end $$;

comment on function public.empresas_gestao_so_cliente is
  'Limpa a gestão comercial quando a empresa deixa de ser cliente. Limpar em vez de '
  'recusar: quem rebaixa o estágio está corrigindo o cadastro, não mexendo no comercial.';

create trigger empresas_gestao_so_cliente_trg
  before insert or update of estagio, gestao_operacao on public.empresas
  for each row execute function public.empresas_gestao_so_cliente();

alter table public.empresas
  add constraint empresas_gestao_so_cliente_check
  check (gestao_operacao is null or estagio in ('cliente', 'ex_cliente'));

/*
 * Carteira órfã é pior que carteira errada: a comissão de volume passivo lê
 * `vendedor_carteira` mês a mês e não olha `empresas.gestao_operacao`. Uma empresa que
 * deixou de ser passiva mas manteve a linha vigente continuaria pagando comissão de
 * gestão para alguém que não gere mais nada — e ninguém descobriria, porque o valor
 * apareceria na folha do mesmo jeito de sempre.
 */
create or replace function public.empresas_fecha_gestao_passiva()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.gestao_operacao is distinct from 'passivo' then
    update public.vendedor_carteira set ate = now()
    where empresa_id = new.id and papel = 'gestao_passiva' and ate is null;
  end if;
  return null;
end $$;

create trigger empresas_fecha_gestao_passiva_trg
  after update of estagio, gestao_operacao on public.empresas
  for each row
  when (old.gestao_operacao is distinct from new.gestao_operacao)
  execute function public.empresas_fecha_gestao_passiva();

-- O RPC continua sendo a porta de entrada e agora recusa em português, antes do CHECK.
create or replace function public.app_definir_gestao_operacao(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_gestao text := p ->> 'gestao_operacao';
  v_gestor uuid := nullif(p ->> 'vendedor_gestao_id', '')::uuid;
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

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_empresa.id, 'cliente.gestao_alterada',
    jsonb_build_object(
      'resumo', case v_gestao
        when 'passivo' then 'Passou a ser gerida como conta PASSIVA.'
        when 'prospeccao_ativa' then 'Passou a ser trabalhada em prospecção ATIVA.'
        else 'Gestão de operação removida.' end,
      'gestao_operacao', v_gestao, 'vendedor_gestao_id', v_gestor),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cliente.gestao_alterada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $$;

-- ─── §2 Carteira de passivas pelo cadastro do closer ────────────────────────
--
-- O mesmo fato — "esta conta é passiva e quem a gere é fulano" — visto do outro lado.
-- A ficha da empresa responde "quem cuida DESTA conta"; o cadastro do vendedor responde
-- "quais contas são DESTE closer", que é a pergunta de quem monta carteira.
--
-- Recebe o CONJUNTO inteiro, não um delta. Um delta obrigaria a tela a saber o que
-- mudou desde que carregou, e duas abas abertas gravariam metade da intenção cada uma.
--
-- Tirar da carteira devolve a empresa para "não definido", não para "prospecção ativa":
-- parar de gerir passivamente não é o mesmo que decidir prospectar, e inventar a segunda
-- afirmação colocaria a conta na fila do SDR sem ninguém ter pedido.

create or replace function public.app_definir_carteira_passiva(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_vendedor uuid := (p ->> 'vendedor_id')::uuid;
  v_ids uuid[] := coalesce(
    (select array_agg((x)::uuid) from jsonb_array_elements_text(coalesce(p -> 'empresa_ids', '[]'::jsonb)) x),
    '{}'::uuid[]);
  v_tipo text;
  v_invalida text;
  v_removidas int := 0;
  v_add int := 0;
  r record;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam carteira.' using errcode = '42501';
  end if;

  select tipo into v_tipo from public.vendedores where id = v_vendedor;
  if v_tipo is null then
    raise exception 'Vendedor não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_tipo <> 'vendedor' then
    raise exception 'Carteira de contas passivas é do closer — este vendedor é %.', v_tipo
      using errcode = '22023';
  end if;

  -- Recusa o LOTE inteiro se alguma não puder ser passiva. Gravar as boas e ignorar as
  -- ruins deixaria a tela mostrando um sucesso que não corresponde ao que foi salvo.
  select string_agg(coalesce(e.razao_social, e.cnpj), ', ') into v_invalida
  from public.empresas e
  where e.id = any(v_ids) and e.estagio not in ('cliente', 'ex_cliente');
  if v_invalida is not null then
    raise exception 'Só cliente ou ex-cliente pode ser conta passiva. Fora da régua: %.', v_invalida
      using errcode = '22023';
  end if;

  -- Saíram: fecha a vigência e devolve a empresa a "não definido".
  for r in
    select c.empresa_id from public.vendedor_carteira c
    where c.vendedor_id = v_vendedor and c.papel = 'gestao_passiva' and c.ate is null
      and not (c.empresa_id = any(v_ids))
  loop
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.empresa_id and papel = 'gestao_passiva' and ate is null;
    update public.empresas set
      gestao_operacao = null, gestao_definida_por = null, gestao_definida_em = null
    where id = r.empresa_id;
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (r.empresa_id, 'cliente.gestao_alterada',
      jsonb_build_object('resumo', 'Saiu da carteira de contas passivas — gestão não definida.',
        'gestao_operacao', null, 'vendedor_gestao_id', v_vendedor), v_ator);
    v_removidas := v_removidas + 1;
  end loop;

  -- Entraram (ou trocaram de dono): a empresa passa a passiva e a vigência vira dele.
  for r in
    select e.id from public.empresas e
    where e.id = any(v_ids)
      and not exists (
        select 1 from public.vendedor_carteira c
        where c.empresa_id = e.id and c.papel = 'gestao_passiva' and c.ate is null
          and c.vendedor_id = v_vendedor
      )
  loop
    update public.vendedor_carteira set ate = now()
    where empresa_id = r.id and papel = 'gestao_passiva' and ate is null;
    update public.empresas set
      gestao_operacao = 'passivo', gestao_definida_por = v_ator, gestao_definida_em = now()
    where id = r.id;
    insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
    values (v_vendedor, r.id, 'gestao_passiva');
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (r.id, 'cliente.gestao_alterada',
      jsonb_build_object('resumo', 'Entrou na carteira de contas passivas de um closer.',
        'gestao_operacao', 'passivo', 'vendedor_gestao_id', v_vendedor), v_ator);
    v_add := v_add + 1;
  end loop;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.carteira_passiva_definida', 'vendedores', v_vendedor::text, p);

  return jsonb_build_object('adicionadas', v_add, 'removidas', v_removidas,
                            'total', coalesce(array_length(v_ids, 1), 0));
end $$;

comment on function public.app_definir_carteira_passiva is
  'Define o CONJUNTO de contas passivas de um closer. Entrar marca a empresa como '
  'passiva; sair devolve a "não definido" — parar de gerir não é decidir prospectar.';

revoke execute on function public.app_definir_carteira_passiva(jsonb) from public;
grant execute on function public.app_definir_carteira_passiva(jsonb) to authenticated;

-- ─── §3 Visibilidade cruzada vale para funil e agenda ───────────────────────
--
-- Até aqui `vendedor_acessos` só filtrava comissão, e todo o resto era visível para
-- quem tivesse o módulo. Isso era verdade enquanto o módulo só existia para Admin e
-- Comercial — que são gestores e veem tudo por definição. No instante em que existe um
-- perfil de vendedor, "quem eu enxergo" passa a ser uma decisão, e uma decisão que só
-- vale na tela não é uma decisão: basta a URL de outro funil para contorná-la.
--
-- O SDR continua vendo o lead que ele agendou para o closer, e o closer o lead que
-- gerou a reunião dele — o `or` sobre `vendedor_destino_id` é isso. Sem ele, o closer
-- abriria uma reunião sem conseguir ler de onde ela veio.

drop policy if exists sdr_leads_select on public.sdr_leads;
create policy sdr_leads_select on public.sdr_leads
  for select using (
    public.app_tem_modulo('comercial')
    and (public.app_pode_ver_vendedor(sdr_id)
         or (vendedor_destino_id is not null and public.app_pode_ver_vendedor(vendedor_destino_id)))
  );

drop policy if exists vendas_select on public.vendas;
create policy vendas_select on public.vendas
  for select using (
    public.app_tem_modulo('comercial') and public.app_pode_ver_vendedor(vendedor_id)
  );

drop policy if exists vendedor_eventos_select on public.vendedor_eventos;
create policy vendedor_eventos_select on public.vendedor_eventos
  for select using (
    public.app_tem_modulo('comercial') and public.app_pode_ver_vendedor(vendedor_id)
  );

/* Quem o usuário logado pode abrir. A tela monta o seletor com isto, e assim o que ela
   oferece é exatamente o que a RLS deixaria ler — um seletor com opções que devolvem
   tela vazia é pior que um seletor curto. */
create or replace function public.comercial_vendedores_visiveis()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]'::jsonb)
  from (
    select v.id, v.nome, v.tipo, v.is_ia
    from public.vendedores v
    where v.ativo and public.app_tem_modulo('comercial') and public.app_pode_ver_vendedor(v.id)
  ) x;
$$;

revoke execute on function public.comercial_vendedores_visiveis() from public;
grant execute on function public.comercial_vendedores_visiveis() to authenticated;

-- ─── §4 O funil de NFs precisa saber de quem é a nota ───────────────────────
--
-- `notas_funil` não expunha `vendedor_id`, então o originador não tinha como ver o
-- próprio funil — só a fila inteira, que é a tela do gestor. `sacado_gestao_operacao`
-- entra junto porque é o que falta para ocultar do funil a nota de sacado passivo.
--
-- As três colunas entram NO FIM, fora da ordem temática: `create or replace view` só
-- aceita acrescentar na cauda, e trocar por drop/create derrubaria os grants e faria
-- a tela do funil voltar 401 até alguém notar.

create or replace view public.notas_funil as
 SELECT nf.access_key,
    nf.nf_id_externo,
    nf.tipo AS tipo_nf,
    nf.direction,
    nf.numero,
    nf.serie,
    nf.valor,
    nf.emitida_em,
    nf.vencimento,
    nf.vencimento_origem,
    nf.status_sync,
    nf.parcelas,
    nf.faixa,
    nf.faixa_regra_versao,
    nf.faixa_motivo,
    nf.faixa_alterada_em,
    nf.estagio_funil,
    nf.estagio_alterado_em,
    nf.perda_motivo,
    nf.receita_esperada,
    nf.taxa_usada,
    nf.sincronizada_em,
    nf.vencimento - CURRENT_DATE AS dias_para_vencimento,
    nf.fornecedor_cnpj,
    nf.fornecedor_nome,
    COALESCE(nf.fornecedor_cadastrado, false) AS fornecedor_cadastrado,
    nf.fornecedor_empresa_id,
    COALESCE(fe.uf, fu.uf) AS fornecedor_uf,
    COALESCE(fpa.tem_protesto, false) AS fornecedor_tem_protesto,
    fco.cnpj IS NOT NULL AS fornecedor_e_cliente_onepay,
    fco.last_anticipation IS NOT NULL OR fe.ultima_antecipacao IS NOT NULL AS fornecedor_ja_antecipou,
        CASE
            WHEN NOT COALESCE(nf.fornecedor_cadastrado, false) THEN 'aquisicao'::text
            WHEN fco.last_anticipation IS NOT NULL OR fe.ultima_antecipacao IS NOT NULL THEN 'recorrencia'::text
            ELSE 'ativacao'::text
        END AS fornecedor_tipagem,
    fsup.valor IS NOT NULL AS fornecedor_suprimido,
    nf.sacado_cnpj,
    nf.sacado_nome,
    COALESCE(nf.sacado_cadastrado, false) AS sacado_cadastrado,
    nf.sacado_empresa_id,
    nf.contato_sacado,
    COALESCE(se.uf, su.uf) AS sacado_uf,
    nf.credit_status AS sacado_credito_status,
    nf.credit_role AS sacado_credito_role,
    nf.credit_limite AS sacado_limite,
    nf.credit_disponivel AS sacado_limite_disponivel,
    COALESCE(nf.credit_disponivel, 0::numeric) >= nf.valor AS sacado_limite_cobre_nota,
    nf.contato_fornecedor,
    COALESCE(su.cnae_principal, se.cnae_principal) AS sacado_cnae_principal,
    NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) AS sacado_cnae_grupos,
    COALESCE(NULLIF(COALESCE(su.cnae_grupos, cnae_grupos_de(se.cnae_principal, NULL::text[])), '{}'::text[]) && ARRAY['41'::text, '42'::text, '43'::text], false) AS sacado_construcao,
    COALESCE(su.razao_social, se.razao_social) AS sacado_razao_social,
    COALESCE(su.municipio, se.municipio) AS sacado_municipio,
    fu.capital_social AS fornecedor_capital_social,
    fu.situacao_cadastral AS fornecedor_situacao_cadastral,
    fpa.valor_total AS fornecedor_protesto_valor,
    fnf.ultimo_numero_nf AS fornecedor_ultimo_numero_nf,
    nf.natureza_operacao,
    COALESCE(nf.operavel_manual, nf.operavel) AS operavel,
    nf.nao_operavel_motivo,
    su.camada AS sacado_camada,
    fpa.consultado_em AS fornecedor_protesto_em,
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value AS conversao_valor,
    ant.monthly_interest_rate AS conversao_taxa,
    ant.status AS conversao_status,
    nf.vendedor_id,
    nf.vendedor_origem,
    se.gestao_operacao AS sacado_gestao_operacao
   FROM notas_fiscais nf
     LEFT JOIN empresas fe ON fe.id = nf.fornecedor_empresa_id
     LEFT JOIN empresas se ON se.id = nf.sacado_empresa_id
     LEFT JOIN mercado_universo fu ON fu.cnpj = nf.fornecedor_cnpj
     LEFT JOIN mercado_universo su ON su.cnpj = nf.sacado_cnpj
     LEFT JOIN protestos_atual fpa ON fpa.cnpj = nf.fornecedor_cnpj
     LEFT JOIN clientes_onepay fco ON fco.cnpj = nf.fornecedor_cnpj
     LEFT JOIN supressao fsup ON fsup.escopo = 'empresa'::text AND fsup.valor = nf.fornecedor_cnpj AND (fsup.expira_em IS NULL OR fsup.expira_em >= CURRENT_DATE)
     LEFT JOIN antecipacoes ant ON ant.id_externo = nf.conversao_antecipacao_id
     LEFT JOIN LATERAL ( SELECT max(n2.numero::bigint) AS ultimo_numero_nf
           FROM notas_fiscais n2
          WHERE n2.fornecedor_cnpj = nf.fornecedor_cnpj AND n2.tipo = 'NFe'::text AND n2.numero ~ '^[0-9]{1,9}$'::text) fnf ON true;

-- `create or replace view` NÃO preserva reloptions, e sem esta linha a view roda com as
-- permissões do OWNER e ignora a RLS de `notas_fiscais` — qualquer usuário logado leria
-- todas as notas. Faltou aqui na aplicação original; corrigido no banco pelo 0099, e
-- reafirmado aqui para que um replay limpo nunca passe por um estado aberto.
alter view public.notas_funil set (security_invoker = on);

-- ─── §5 A carteira de um vendedor, com o número que decide a comissão ───────
--
-- Uma RPC e não quatro consultas: a tela de carteira precisa juntar carteira temporal,
-- empresa e volume antecipado do mês, e o volume é o único número da tela que explica
-- por que a conta está ali. Sem ele a lista vira um cadastro; com ele é uma prestação
-- de contas.

create or replace function public.comercial_carteira_vendedor(p_vendedor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_id uuid := coalesce(p_vendedor_id, public.app_vendedor_atual());
  v_tipo text;
  v_de date := date_trunc('month', now())::date;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if v_id is null then
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true);
  end if;
  if not public.app_pode_ver_vendedor(v_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select tipo into v_tipo from public.vendedores where id = v_id;

  return jsonb_build_object(
    'tem_acesso', true,
    'vendedor_id', v_id,
    'tipo', v_tipo,
    'competencia', v_de,
    -- Passivas: a vigência é a fonte, não `empresas.gestao_operacao`. É a vigência que
    -- a comissão lê, então é ela que a tela tem de mostrar.
    'passivas', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.volume_mes desc nulls last), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.faturamento_anual,
               c.desde,
               e.gestao_operacao,
               (select coalesce(sum(a.gross_value), 0) from public.antecipacoes a
                 where a.sacado_cnpj = e.cnpj and a.regrediu_em is null
                   and a.convertida_em >= v_de
                   and a.convertida_em < (v_de + interval '1 month')) as volume_mes
        from public.vendedor_carteira c
        join public.empresas e on e.id = c.empresa_id
        where c.vendedor_id = v_id and c.papel = 'gestao_passiva' and c.ate is null
      ) x
    ),
    -- Originação: a carteira do originador mora em `settings.empresas_escolhidas`, e é
    -- ela que o roteador lê. Ler a mesma lista aqui evita a tela concordar com um lugar
    -- e o roteamento com outro.
    'originacao', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.razao_social), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.estagio, e.gestao_operacao,
               (select count(*)::int from public.notas_fiscais nf
                 where nf.vendedor_id = v_id
                   and (nf.fornecedor_empresa_id = e.id or nf.sacado_empresa_id = e.id)
                   and nf.estagio_funil not in ('convertida', 'perdida')) as nfs_vivas
        from public.empresas e
        where e.id::text in (
          select jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb))
          from public.vendedores v where v.id = v_id
        )
      ) x
    )
  );
end $function$;

revoke execute on function public.comercial_carteira_vendedor(uuid) from public;
grant execute on function public.comercial_carteira_vendedor(uuid) to authenticated, service_role;
