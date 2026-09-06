-- 0188 — A régua de cada vendedor.
--
-- Até aqui quase toda permissão do time comercial parava no MÓDULO: quem tinha
-- `antecipacao` via as 60.733 notas da casa, quem tinha `empresas` via e editava as
-- 8.847 fichas, e quem tinha `comercial` lia a folha do mês inteira. O recorte por
-- pessoa existia só na tela — e tela não é autorização.
--
-- Esta migração move o recorte para onde ele decide: a RLS. Três réguas novas,
-- e cada uma responde a uma pergunta diferente:
--
--   app_vendedores_visiveis()   quem eu posso abrir (eu + vendedor_acessos; gestor: todos)
--   app_carteira_empresas()     as contas que são minhas hoje
--   app_empresas_do_meu_funil() as empresas que passaram pelo meu funil de reuniões
--
-- Elas são SECURITY DEFINER e devolvem ARRAY de propósito: numa policy elas viram
-- InitPlan — calculadas UMA vez por consulta, não por linha. A versão com EXISTS
-- correlacionado seria a mesma regra rodando 60 mil vezes.
--
-- O `coalesce(...)` em volta de cada chamada NÃO é defesa contra nulo (as funções já
-- devolvem '{}'): é sintaxe. `x = any ((select f()))` faz o Postgres ler o parêntese
-- como SUBCONSULTA e comparar uuid com uuid[] — erro 42883. Envolto em coalesce, o
-- operando volta a ser uma expressão de array, e o InitPlan continua valendo.
--
-- E os módulos mudam junto: o Closer ganha Mercado, Radar e Antecipação (agora que
-- Antecipação não é mais tudo-ou-nada), e a gestora do Comercial ganha Notificações,
-- que faltava desde sempre.

-- ─── 1. Módulos por perfil ───────────────────────────────────────────────────

/*
 * `antecipacao` para o Closer só é defensável DEPOIS da régua nova (bloco 4).
 * Concedê-lo antes seria abrir a carteira inteira de notas para quem fecha conta.
 */
insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, m.modulo_id
from public.perfis p
join (values
  ('Comercial', 'notificacoes'),
  ('Closer',    'mercado'),
  ('Closer',    'radar'),
  ('Closer',    'antecipacao')
) as m (perfil, modulo_id) on m.perfil = p.nome
on conflict (perfil_id, modulo_id) do nothing;

-- ─── 2. As réguas ────────────────────────────────────────────────────────────

/**
 * Vendedor cadastrado e ativo que NÃO é gestor. É quem esta migração aperta.
 *
 * Separado de `app_gestor_comercial()` porque as duas perguntas não são
 * complementares: Crédito e Jurídico não são gestores comerciais e também não são
 * vendedores — e nada aqui deve mudar para eles.
 */
create or replace function public.app_vendedor_restrito()
returns boolean language sql stable security definer set search_path to '' as $$
  select not public.app_gestor_comercial()
     and exists (
       select 1 from public.vendedores v
       where v.usuario_id = auth.uid() and v.ativo
     );
$$;

/** O mesmo, mas só para o SDR: é o único tipo cuja lista de empresas é recortada. */
create or replace function public.app_sdr_restrito()
returns boolean language sql stable security definer set search_path to '' as $$
  select not public.app_gestor_comercial()
     and exists (
       select 1 from public.vendedores v
       where v.usuario_id = auth.uid() and v.ativo and v.tipo = 'sdr'
     );
$$;

/** O tipo do vendedor logado, ou null. Usado para achar a regra de comissão dele. */
create or replace function public.app_vendedor_tipo()
returns text language sql stable security definer set search_path to '' as $$
  select v.tipo from public.vendedores v
  where v.usuario_id = auth.uid() and v.ativo
  limit 1;
$$;

/**
 * Todos os vendedores que eu posso abrir. É `app_pode_ver_vendedor()` do avesso:
 * a mesma regra, devolvida de uma vez em vez de uma pergunta por linha.
 *
 * Gestor recebe a lista inteira, inclusive inativos — o histórico de comissão e de
 * carteira de quem saiu continua sendo trabalho dele.
 */
create or replace function public.app_vendedores_visiveis()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select case
    when public.app_gestor_comercial()
      then coalesce((select array_agg(v.id) from public.vendedores v), '{}'::uuid[])
    else coalesce((
      select array_agg(distinct s.x)
      from (
        select public.app_vendedor_atual() as x
        union
        select a.pode_ver_vendedor_id
        from public.vendedor_acessos a
        where a.vendedor_id = public.app_vendedor_atual()
      ) s
      where s.x is not null
    ), '{}'::uuid[])
  end;
$$;

/**
 * As empresas da MINHA carteira vigente, em qualquer papel.
 *
 * Sem filtro de papel de propósito: é isto que faz o Closer enxergar a nota das contas
 * passivas dele mesmo quando quem originou a nota é alguém que ele não pode abrir.
 */
create or replace function public.app_carteira_empresas()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce((
    select array_agg(distinct c.empresa_id)
    from public.vendedor_carteira c
    where c.vendedor_id = public.app_vendedor_atual() and c.ate is null
  ), '{}'::uuid[]);
$$;

/**
 * As empresas que passaram pelo funil de reuniões que eu enxergo — abertas e
 * encerradas.
 *
 * Encerradas entram: quem trabalhou uma empresa e a perdeu precisa poder reabrir a
 * ficha para entender por quê. Esconder o passado do próprio funil transformaria
 * "não deu certo" em "nunca existiu".
 */
create or replace function public.app_empresas_do_meu_funil()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce((
    select array_agg(distinct l.empresa_id)
    from public.sdr_leads l
    where l.sdr_id = any (public.app_vendedores_visiveis())
       or l.vendedor_destino_id = any (public.app_vendedores_visiveis())
  ), '{}'::uuid[]);
$$;

-- ─── 3. Empresas e contatos: o SDR vê o funil dele ───────────────────────────

/*
 * Só o SDR é recortado. Originador e Closer continuam com a base inteira — os dois
 * trabalham conta que ainda não é de ninguém, e o Closer acabou de ganhar Mercado
 * justamente para procurar. O SDR não: a fila dele CHEGA, pela distribuição e pelos
 * formulários, e é essa fila que a tela dele tem de ser.
 */
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
for select using (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);

/*
 * Contato acompanha a ficha: quem não pode abrir a empresa não lê nem escreve o
 * contato dela. Sem isto o recorte acima seria decorativo — a lista de contatos
 * carrega nome, cargo, e-mail e telefone, que é o que a ficha tem de mais sensível.
 */
drop policy if exists contatos_select on public.contatos;
create policy contatos_select on public.contatos
for select using (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or empresa_id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);

drop policy if exists contatos_write on public.contatos;
create policy contatos_write on public.contatos
for all using (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or empresa_id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
) with check (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or empresa_id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);

-- ─── 4. Notas fiscais e antecipações: cada um vê a sua ───────────────────────

/*
 * Três portas, e cada uma existe por um motivo:
 *
 *   vendedor_id ∈ visíveis   a nota é minha, ou de alguém que eu posso abrir
 *   fornecedor_empresa_id    a nota é de uma conta da minha carteira
 *   sacado_empresa_id        idem, do outro lado da nota
 *
 * As duas últimas são o que faz o Closer acompanhar a operação da conta que ele
 * fechou sem precisar ser dono de nota nenhuma. Nota SEM dono (`vendedor_id` nulo)
 * não passa por nenhuma: ela é a Fila sem Dono, que é decisão de distribuição e
 * portanto tela de gestor.
 */
drop policy if exists notas_fiscais_select on public.notas_fiscais;
create policy notas_fiscais_select on public.notas_fiscais
for select using (
  (select public.app_tem_modulo('antecipacao'))
  and (
    (select public.app_gestor_comercial())
    or vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
    or fornecedor_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
    or sacado_empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);

/*
 * A cessão segue a nota, e a regra NÃO é repetida aqui: o `exists` abaixo lê
 * `notas_fiscais` com a RLS ligada, então a resposta é sempre a mesma da policy de
 * cima. Duas cópias da mesma régua é uma cópia a mais para divergir.
 *
 * Antecipação sem NF casada fica só com o gestor — ela é a fila de conciliação, não
 * o extrato de ninguém.
 */
drop policy if exists antecipacoes_select on public.antecipacoes;
create policy antecipacoes_select on public.antecipacoes
for select using (
  (select public.app_tem_modulo('antecipacao'))
  and (
    (select public.app_gestor_comercial())
    or (
      access_key_casada is not null
      and exists (
        select 1 from public.notas_fiscais nf
        where nf.access_key = antecipacoes.access_key_casada
      )
    )
  )
);

/*
 * Os dois contadores do topo do funil eram SECURITY DEFINER e só checavam o módulo:
 * a lista passaria a mostrar 4.076 notas embaixo de um cabeçalho dizendo 60.733.
 *
 * A correção é tirar o DEFINER, não repetir a régua dentro deles. Assim existe UMA
 * definição de "nota que eu posso ver" — a policy — e o cabeçalho não tem como
 * discordar da lista.
 */
alter function public.antecipacao_resumo_funil() security invoker;
alter function public.antecipacao_metricas_faixa() security invoker;

-- ─── 5. Fila de aceite: só os handoffs que me dizem respeito ─────────────────

/*
 * Mesma régua de `sdr_leads`: a passagem aparece para quem a entregou, para quem a
 * recebeu, e para quem pode abrir qualquer um dos dois. Decidir já era do
 * destinatário; agora LER também.
 */
drop policy if exists sdr_aceites_select on public.sdr_aceites;
create policy sdr_aceites_select on public.sdr_aceites
for select using (
  (select public.app_tem_modulo('comercial'))
  and (
    sdr_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
    or vendedor_destino_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
  )
);

-- ─── 6. Folha e política de comissão ─────────────────────────────────────────

/*
 * `comissao_competencias` é a folha FECHADA do mês da casa — um número só, o total
 * de todo mundo. Não existe recorte por vendedor possível aqui: ou é do gestor, ou
 * não é de ninguém. O extrato de cada um continua vindo de `comissao_painel_v2`,
 * que filtra por `app_pode_ver_vendedor()` e não passa por esta tabela.
 */
drop policy if exists comissao_competencias_select on public.comissao_competencias;
create policy comissao_competencias_select on public.comissao_competencias
for select using (
  (select public.app_tem_modulo('comercial')) and (select public.app_gestor_comercial())
);

/*
 * A regra de comissão eu leio se ela for MINHA — a nominal, ou a do meu tipo. A do
 * colega não: taxa de outro vendedor é assunto entre ele e a gestão.
 */
drop policy if exists comissao_regras_select on public.comissao_regras;
create policy comissao_regras_select on public.comissao_regras
for select using (
  (select public.app_tem_modulo('comercial'))
  and (
    (select public.app_gestor_comercial())
    or vendedor_id = (select public.app_vendedor_atual())
    or (vendedor_id is null and tipo_vendedor = (select public.app_vendedor_tipo()))
  )
);

/*
 * `commission_params` é o motor v2 e é lido só pelo simulador, pela reclassificação
 * e pelas contas por fase — as três telas do gestor/admin. O parâmetro nominal de
 * alguém continua visível para ele mesmo.
 */
drop policy if exists commission_params_select on public.commission_params;
create policy commission_params_select on public.commission_params
for select using (
  (select public.app_tem_modulo('comercial'))
  and (
    (select public.app_gestor_comercial())
    or vendedor_id = (select public.app_vendedor_atual())
  )
);

-- ─── 7. RPCs que aceitavam qualquer vendedor_id ──────────────────────────────

/**
 * O alcance da carteira de um vendedor: quantas notas vivas as empresas dele tocam.
 *
 * O `p_vendedor_id` chegava e era usado sem pergunta nenhuma — qualquer um com o
 * módulo lia o alcance da carteira de qualquer outro trocando um uuid na chamada.
 * A tela só oferece a troca ao gestor, mas a tela nunca foi a autorização.
 */
create or replace function public.comercial_alcance_da_carteira(p_vendedor_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_ids uuid[];
  v_grupos uuid[];
  v_total int;
  v_via_spe int;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if not public.app_pode_ver_vendedor(p_vendedor_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select coalesce((select array_agg((x)::uuid)
                   from jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
                  '{}'::uuid[])
    into v_ids
  from public.vendedores v where v.id = p_vendedor_id;

  if v_ids is null or array_length(v_ids, 1) is null then
    return jsonb_build_object('tem_acesso', true, 'nfs_vivas', 0, 'via_spe', 0);
  end if;

  select coalesce(array_agg(distinct e.grupo_id), '{}'::uuid[]) into v_grupos
  from public.empresas e where e.id = any(v_ids) and e.grupo_id is not null;

  /*
   * `coalesce(... = any(...), false)` e não `not (... = any(...))`.
   *
   * A SPE quase nunca tem linha em `empresas` — ela vive só no `mercado_universo`, e
   * `nf.sacado_empresa_id` vem NULO. Com `not (null = any(...))` o resultado é NULL, o
   * filter não conta, e a contagem "via SPE" ficava em 25 quando o número real era 706:
   * justamente as notas que a amarração holding↔SPE existe para trazer não apareciam na
   * conta que serve para provar que ela funcionou.
   */
  select count(*),
         count(*) filter (where coalesce(nf.sacado_empresa_id = any(v_ids), false) = false
                            and coalesce(nf.fornecedor_empresa_id = any(v_ids), false) = false)
    into v_total, v_via_spe
  from public.notas_fiscais nf
  left join public.mercado_universo su on su.cnpj = nf.sacado_cnpj
  left join public.mercado_universo fu on fu.cnpj = nf.fornecedor_cnpj
  where nf.estagio_funil not in ('convertida', 'perdida')
    and nf.operavel is not false
    and (
      nf.sacado_empresa_id = any(v_ids)
      or nf.fornecedor_empresa_id = any(v_ids)
      or (su.is_spe and su.grupo_id = any(v_grupos))
      or (fu.is_spe and fu.grupo_id = any(v_grupos))
    );

  return jsonb_build_object('tem_acesso', true, 'nfs_vivas', v_total, 'via_spe', v_via_spe);
end $$;

/**
 * O funil de certificados, agora com escopo de LEITURA e não só de gestor.
 *
 * Antes: gestor via tudo, e qualquer outro via a própria carteira de originação —
 * o que devolvia um funil vazio para o Closer, que não origina nada. Agora o não
 * gestor vê a carteira de originação de TODOS os vendedores que ele pode abrir,
 * mais as contas da carteira dele em qualquer papel. É o mesmo alcance da nota
 * fiscal, e pelo mesmo motivo: quem fecha a conta acompanha o que ela precisa.
 *
 * O `p_vendedor_id` continua sendo o filtro da tela, e agora é conferido: pedir a
 * carteira de alguém que eu não posso abrir devolve `tem_acesso: false`, não a
 * carteira dele.
 */
create or replace function public.certificado_funil(p_vendedor_id uuid default null::uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_vendedor uuid;
  v_gestor boolean;
  v_escopo uuid[];
  v_filtrar boolean;
  v_cards jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  v_gestor := public.app_gestor_comercial();
  v_vendedor := public.app_vendedor_atual();

  if p_vendedor_id is not null then
    if not public.app_pode_ver_vendedor(p_vendedor_id) then
      return jsonb_build_object('tem_acesso', false);
    end if;
    v_filtrar := true;
    select coalesce(array_agg(c.empresa_id), '{}'::uuid[]) into v_escopo
    from public.vendedor_carteira c
    where c.vendedor_id = p_vendedor_id and c.papel = 'originacao' and c.ate is null;
  elsif v_gestor then
    v_filtrar := false;
  else
    v_filtrar := true;
    select coalesce(array_agg(distinct c.empresa_id), '{}'::uuid[]) into v_escopo
    from public.vendedor_carteira c
    where c.ate is null
      and (
        (c.papel = 'originacao' and c.vendedor_id = any (public.app_vendedores_visiveis()))
        or c.vendedor_id = v_vendedor
      );
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.pendentes desc, x.nome), '[]'::jsonb)
    into v_cards
  from (
    select
      k.id as card_id, k.estagio, k.perdido_motivo, mp.motivo as perdido_motivo_label,
      k.perdido_em, k.ganho_em, k.observacao, k.aberto_em, k.atualizado_em,
      e.id as empresa_id, e.cnpj,
      coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as nome,
      u.total, u.cobertos, u.total - u.cobertos as pendentes,
      u.matriz_coberta, u.matriz_expira_em, u.cnpjs,
      dono.vendedor_id as dono_id, dono.nome as dono_nome
    from public.certificado_cards k
    join public.empresas e on e.id = k.empresa_id
    left join public.motivos_perda mp on mp.id = k.perdido_motivo
    left join lateral (
      select c.vendedor_id, v.nome
      from public.vendedor_carteira c
      join public.vendedores v on v.id = c.vendedor_id
      where c.empresa_id = k.empresa_id and c.papel = 'originacao' and c.ate is null
      limit 1
    ) dono on true
    join lateral (
      select
        count(*)::int as total,
        count(*) filter (where cu.coberto)::int as cobertos,
        coalesce(bool_or(cu.coberto) filter (where cu.e_matriz), false) as matriz_coberta,
        max(cu.expires_at) filter (where cu.e_matriz) as matriz_expira_em,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'cnpj', cu.cnpj, 'nome', cu.razao_social, 'e_matriz', cu.e_matriz,
            'coberto', cu.coberto, 'expires_at', cu.expires_at
          )
          order by cu.e_matriz desc, cu.coberto, cu.expires_at nulls first, cu.razao_social
        ), '[]'::jsonb) as cnpjs
      from public.certificado_universo cu
      where cu.empresa_id = k.empresa_id
    ) u on true
    where (not v_filtrar) or e.id = any(v_escopo)
  ) x;

  return jsonb_build_object(
    'tem_acesso', true,
    'eh_gestor', v_gestor,
    'vendedor_id', coalesce(p_vendedor_id, case when v_gestor then null else v_vendedor end),
    'cards', v_cards,
    'sincronizado_em', (select max(sincronizado_em) from public.certificados)
  );
end $$;

-- ─── 8. A ficha da empresa não é do vendedor ─────────────────────────────────

/**
 * Vendedor mexe no DOMÍNIO e em mais nada.
 *
 * Razão social, tipo, UF, CNAE, porte, regime, ERP e — principalmente — ESTÁGIO são
 * afirmações sobre a empresa que valem para a casa toda. Estágio decide se ela é
 * cliente, e isso decide de quem é o dinheiro dela.
 *
 * O domínio fica de fora da trava porque é o insumo do enriquecimento: é ele que
 * destrava a busca de contatos, e quem descobre o site certo é justamente quem está
 * ligando para a empresa. Contato continua livre pela policy de `contatos`.
 *
 * A checagem é aqui, e não em GRANT por coluna, porque é aqui que dá para explicar
 * o "não" — um erro de permissão de coluna chegaria à tela como texto do Postgres.
 */
create or replace function public.app_atualizar_empresa(p jsonb)
returns public.empresas language plpgsql set search_path to '' as $$
declare
  v_antes public.empresas;
  v_depois public.empresas;
  v_ator uuid := auth.uid();
begin
  select * into v_antes from public.empresas where id = (p ->> 'id')::uuid;

  if v_antes.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  if public.app_vendedor_restrito()
     and exists (
       select 1 from jsonb_object_keys(p) k where k not in ('id', 'dominio')
     ) then
    raise exception
      'Da ficha da empresa, um vendedor altera só o domínio. O resto (razão social, estágio, ERP) é da gestão.'
      using errcode = '42501';
  end if;

  update public.empresas set
    razao_social    = coalesce(p ->> 'razao_social',    razao_social),
    nome_fantasia   = coalesce(p ->> 'nome_fantasia',   nome_fantasia),
    tipo            = coalesce(p ->> 'tipo',            tipo),
    estagio         = coalesce(p ->> 'estagio',         estagio),
    uf              = coalesce(p ->> 'uf',              uf),
    municipio       = coalesce(p ->> 'municipio',       municipio),
    cnae_principal  = coalesce(p ->> 'cnae_principal',  cnae_principal),
    porte           = coalesce(p ->> 'porte',           porte),
    erp_atual       = coalesce(p ->> 'erp_atual',       erp_atual),
    erp_mrr         = coalesce((p ->> 'erp_mrr')::numeric, erp_mrr),
    erp_canal_venda = coalesce(p ->> 'erp_canal_venda', erp_canal_venda),
    dominio         = coalesce(p ->> 'dominio', dominio),
    regime_tributario = case
                        when p ? 'regime_tributario'
                        then nullif(p ->> 'regime_tributario', '')
                        else regime_tributario end,
    dominio_origem  = case
                        when p ? 'dominio' and (p ->> 'dominio') is distinct from dominio
                        then 'manual' else dominio_origem end,
    dominio_validado_em = case
                        when p ? 'dominio' and (p ->> 'dominio') is distinct from dominio
                        then now() else dominio_validado_em end
  where id = v_antes.id
  returning * into v_depois;

  if v_depois.id is null then
    raise exception 'Sem permissão para alterar esta empresa.' using errcode = '42501';
  end if;

  if v_depois.estagio is distinct from v_antes.estagio then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_depois.id,
      'estagio.alterado',
      jsonb_build_object(
        'resumo', 'Estágio: ' || v_antes.estagio || ' → ' || v_depois.estagio,
        'de', v_antes.estagio,
        'para', v_depois.estagio
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'empresa.atualizada', 'empresas', v_depois.id::text, p);

  return v_depois;
end;
$$;

-- ─── 9. Índices que as réguas novas pedem ────────────────────────────────────

/*
 * `sdr_leads.empresa_id` e o par (vendedor_id) da nota passam a ser lidos em toda
 * consulta de quem não é gestor. O primeiro monta o array do funil do SDR; o
 * segundo é o filtro que sobra depois do InitPlan.
 */
create index if not exists idx_sdr_leads_empresa on public.sdr_leads (empresa_id);
create index if not exists idx_nf_vendedor on public.notas_fiscais (vendedor_id)
  where vendedor_id is not null;
create index if not exists idx_vendedor_carteira_vendedor_vigente
  on public.vendedor_carteira (vendedor_id) where ate is null;
