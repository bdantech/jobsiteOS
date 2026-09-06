-- 0189 — O auxiliar do closer.
--
-- Um quarto tipo de vendedor. Ele VÊ o que o closer dele vê — os mesmos funis, a mesma
-- carteira, as mesmas contas — e é remunerado de um jeito que nenhum dos outros três é:
-- por um percentual do que o closer ganhou.
--
-- DUAS COISAS QUE ESTE ARQUIVO PRECISA DEIXAR CLARAS, porque errar qualquer uma delas
-- muda o dinheiro de alguém:
--
--   O REPASSE É ADITIVO, NÃO UM DESCONTO. Se o closer fez R$ 10.000 e o repasse dele é
--   30%, saem R$ 3.000 para os auxiliares e o closer continua com R$ 10.000. A casa paga
--   R$ 13.000. Tratar como desconto seria transformar cada contratação de auxiliar numa
--   redução do salário de quem a pediu — e nenhum closer pediria a segunda.
--
--   O PERCENTUAL É DO CLOSER E É RATEADO. Os 30% são do closer, não de cada auxiliar:
--   com dois auxiliares cada um leva 15%. Quem contrata mais gente divide o mesmo bolo,
--   e o custo da casa por closer não muda com o tamanho da equipe dele.
--
-- A hierarquia mora em `vendedores.superior_id`, e ela responde a DUAS perguntas de uma
-- vez: de quem eu derivo comissão, e o funil de quem eu enxergo. Duas colunas para as
-- duas perguntas seria a primeira chance de a folha discordar da tela.

-- ─── 1. O tipo, o papel e a hierarquia ───────────────────────────────────────

/*
 * Os CHECKs são recriados a partir do estado VIVO do banco, e não da lista da migração
 * que os escreveu: entre uma e outra podem ter entrado valores que a original não
 * conhecia, e recriar pela lista antiga os apagaria em silêncio.
 */
alter table public.vendedores drop constraint if exists vendedores_tipo_check;
alter table public.vendedores add constraint vendedores_tipo_check
  check (tipo in ('sdr', 'vendedor', 'originador', 'auxiliar'));

alter table public.comissao_lancamentos_v2 drop constraint if exists comissao_lancamentos_v2_papel_check;
alter table public.comissao_lancamentos_v2 add constraint comissao_lancamentos_v2_papel_check
  check (papel in ('VENDEDOR', 'ORIGINADOR', 'SDR', 'AUXILIAR'));

alter table public.comissao_regras drop constraint if exists comissao_regras_tipo_check;
alter table public.comissao_regras add constraint comissao_regras_tipo_check
  check (tipo_vendedor in ('sdr', 'vendedor', 'originador', 'auxiliar'));

/*
 * `superior_id` só faz sentido para o auxiliar: os outros três respondem à gestão, não
 * uns aos outros. E `on delete restrict` de propósito — apagar um closer que tem
 * auxiliares pendurados deixaria gente sem origem de comissão e sem visibilidade, o que
 * na tela apareceria como "o sistema esqueceu de mim".
 */
alter table public.vendedores
  add column if not exists superior_id uuid references public.vendedores (id) on delete restrict;

alter table public.vendedores drop constraint if exists vendedores_superior_check;
alter table public.vendedores add constraint vendedores_superior_check
  check (superior_id is null or (tipo = 'auxiliar' and superior_id <> id));

comment on column public.vendedores.superior_id is
  'O closer de quem este auxiliar deriva comissão e visibilidade. Nulo para os outros tipos.';

create index if not exists idx_vendedores_superior on public.vendedores (superior_id)
  where superior_id is not null;

-- ─── 2. O perfil ─────────────────────────────────────────────────────────────

insert into public.perfis (nome, descricao) values
  ('Auxiliar do Closer',
   'Trabalha ao lado de um closer: enxerga os mesmos funis, a mesma carteira e as mesmas '
   'contas que ele. A comissão é um percentual da comissão do closer, rateado entre os '
   'auxiliares dele. Não é gestor do módulo.')
on conflict (nome) do nothing;

/*
 * Os mesmos módulos do Closer, sem exceção — é isso que "mesma visualização" quer dizer.
 * Ler a lista do Closer em vez de repetir uma lista literal garante que os dois não
 * divirjam no dia em que um deles ganhar um módulo novo.
 */
insert into public.perfil_modulos (perfil_id, modulo_id)
select aux.id, do_closer.modulo_id
from public.perfis aux
cross join (
  select pm.modulo_id
  from public.perfil_modulos pm
  join public.perfis c on c.id = pm.perfil_id
  where c.nome = 'Closer'
) do_closer
where aux.nome = 'Auxiliar do Closer'
on conflict (perfil_id, modulo_id) do nothing;

-- ─── 3. Visibilidade: o auxiliar enxerga pelos olhos do closer ───────────────

/**
 * Quem eu posso abrir.
 *
 * Ganhou o degrau do auxiliar: além de mim e de quem me foi liberado, entram o meu
 * SUPERIOR e tudo o que o superior enxerga. É o que faz "mesma visualização do closer"
 * ser verdade em todas as telas de uma vez, em vez de virar uma lista de acessos que
 * alguém tem de manter sincronizada à mão a cada mudança de equipe.
 *
 * UM degrau, e não uma recursão: o CHECK de `superior_id` só admite auxiliar como
 * subordinado, e auxiliar não é superior de ninguém. Uma recursão aqui seria capacidade
 * para uma hierarquia que o modelo não permite — e um lugar a mais para um ciclo travar
 * toda consulta do módulo.
 */
create or replace function public.app_vendedores_visiveis()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select case
    when public.app_gestor_comercial()
      then coalesce((select array_agg(v.id) from public.vendedores v), '{}'::uuid[])
    else coalesce((
      select array_agg(distinct s.x)
      from (
        -- eu
        select public.app_vendedor_atual() as x
        union
        -- quem me foi liberado no cadastro
        select a.pode_ver_vendedor_id
        from public.vendedor_acessos a
        where a.vendedor_id = public.app_vendedor_atual()
        union
        -- o meu closer, se eu for auxiliar
        select v.superior_id
        from public.vendedores v
        where v.id = public.app_vendedor_atual() and v.superior_id is not null
        union
        -- e tudo o que o meu closer enxerga
        select a.pode_ver_vendedor_id
        from public.vendedores v
        join public.vendedor_acessos a on a.vendedor_id = v.superior_id
        where v.id = public.app_vendedor_atual() and v.superior_id is not null
      ) s
      where s.x is not null
    ), '{}'::uuid[])
  end;
$$;

/**
 * As empresas da minha carteira vigente — mais as do meu closer, quando sou auxiliar.
 *
 * Sem isto o auxiliar veria o funil de NFs do closer (que vem de `app_vendedores_visiveis`)
 * mas não as notas das CONTAS PASSIVAS dele, que são justamente as que não têm dono de
 * nota nenhum e chegam pela carteira.
 */
create or replace function public.app_carteira_empresas()
returns uuid[] language sql stable security definer set search_path to '' as $$
  select coalesce((
    select array_agg(distinct c.empresa_id)
    from public.vendedor_carteira c
    where c.ate is null
      and (
        c.vendedor_id = public.app_vendedor_atual()
        or c.vendedor_id = (
          select v.superior_id from public.vendedores v where v.id = public.app_vendedor_atual()
        )
      )
  ), '{}'::uuid[]);
$$;

/**
 * "Posso abrir o funil desta pessoa?" — agora com UMA definição só.
 *
 * Ela e `app_vendedores_visiveis()` respondiam a mesma pergunta com dois códigos
 * diferentes, e o auxiliar seria a primeira ocasião de os dois discordarem: a RLS de
 * `vendas` pergunta por aqui, a de `notas_fiscais` pergunta pela outra, e o auxiliar
 * enxergaria a nota do closer sem enxergar a venda dele.
 */
create or replace function public.app_pode_ver_vendedor(p_vendedor_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_vendedor_id = any (public.app_vendedores_visiveis());
$$;

-- ─── 4. O cadastro aceita o tipo novo e o superior ───────────────────────────

create or replace function public.app_salvar_vendedor(p jsonb)
returns public.vendedores language plpgsql security definer set search_path to '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_superior uuid := nullif(p ->> 'superior_id', '')::uuid;
  v_linha public.vendedores;
  v_ids uuid[];
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores cadastram vendedor.' using errcode = '42501';
  end if;
  if coalesce(p ->> 'tipo', '') not in ('sdr', 'vendedor', 'originador', 'auxiliar') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if nullif(p ->> 'usuario_id', '') is null and not coalesce((p ->> 'is_ia')::boolean, false) then
    raise exception 'Vendedor precisa de um usuário, ou de ser marcado como IA.' using errcode = '22023';
  end if;

  /*
   * O auxiliar EXIGE um closer, e o closer tem de ser um closer.
   *
   * Um auxiliar sem superior não é um caso mais simples do mesmo cadastro — é uma pessoa
   * que não vê funil nenhum e não recebe comissão nenhuma, e que passaria semanas
   * achando que o sistema está quebrado. Recusar na hora do cadastro é a única
   * mensagem que chega a tempo.
   */
  if (p ->> 'tipo') = 'auxiliar' then
    if v_superior is null then
      raise exception 'Escolha o closer de quem este auxiliar é auxiliar.' using errcode = '23502';
    end if;
    if not exists (select 1 from public.vendedores v where v.id = v_superior and v.tipo = 'vendedor') then
      raise exception 'O superior de um auxiliar precisa ser um closer.' using errcode = '23514';
    end if;
  else
    v_superior := null;
  end if;

  if v_id is null then
    insert into public.vendedores (nome, tipo, usuario_id, is_ia, whatsapp_conta_id, email_remetente, settings, ativo, superior_id)
    values (
      p ->> 'nome',
      p ->> 'tipo',
      nullif(p ->> 'usuario_id', '')::uuid,
      coalesce((p ->> 'is_ia')::boolean, false),
      nullif(p ->> 'whatsapp_conta_id', '')::uuid,
      nullif(p ->> 'email_remetente', ''),
      coalesce(p -> 'settings', '{}'::jsonb),
      coalesce((p ->> 'ativo')::boolean, true),
      v_superior
    )
    returning * into v_linha;
  else
    /*
     * `superior_id` sai junto quando o tipo deixa de ser auxiliar — o CHECK da tabela
     * recusaria, e recusar aqui com o motivo escrito é melhor que devolver a violação.
     */
    update public.vendedores set
      nome = coalesce(p ->> 'nome', nome),
      tipo = coalesce(p ->> 'tipo', tipo),
      usuario_id = case when p ? 'usuario_id' then nullif(p ->> 'usuario_id', '')::uuid else usuario_id end,
      is_ia = coalesce((p ->> 'is_ia')::boolean, is_ia),
      whatsapp_conta_id = case when p ? 'whatsapp_conta_id' then nullif(p ->> 'whatsapp_conta_id', '')::uuid else whatsapp_conta_id end,
      email_remetente = case when p ? 'email_remetente' then nullif(p ->> 'email_remetente', '') else email_remetente end,
      settings = coalesce(p -> 'settings', settings),
      ativo = coalesce((p ->> 'ativo')::boolean, ativo),
      superior_id = case when coalesce(p ->> 'tipo', tipo) = 'auxiliar' then v_superior else null end
    where id = v_id
    returning * into v_linha;
    if v_linha.id is null then
      raise exception 'Vendedor não encontrado.' using errcode = 'no_data_found';
    end if;
  end if;

  v_ids := case
    when v_linha.tipo = 'originador' and v_linha.ativo then coalesce(
      (select array_agg((x)::uuid)
       from jsonb_array_elements_text(coalesce(v_linha.settings -> 'empresas_escolhidas', '[]'::jsonb)) x),
      '{}'::uuid[])
    else '{}'::uuid[]
  end;
  perform public.app_sincronizar_carteira_originacao(v_linha.id, v_ids);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, case when v_id is null then 'comercial.vendedor_criado' else 'comercial.vendedor_alterado' end,
          'vendedores', v_linha.id::text, p);

  return v_linha;
end $$;

-- ─── 5. O percentual de repasse ──────────────────────────────────────────────

/*
 * Nenhum valor é semeado, e a ausência é a decisão certa.
 *
 * `repasse_auxiliar_pct` entra no catálogo de parâmetros (packages/core) e é publicado
 * pela tela de Comissão → Parâmetros, com override por closer. Sem linha publicada,
 * `valorParametro` devolve null e o motor não lança nada — que é o comportamento certo
 * para um repasse que ninguém definiu ainda. Semear 30% aqui seria a casa se
 * comprometendo com um número que nenhum gestor escolheu.
 *
 * A exclusion constraint de `commission_params` já garante que não existam dois valores
 * vigentes para o mesmo (chave, closer) — a versão por data vem de graça.
 */

-- ─── 6. As policies passam a perguntar uma vez, e não por linha ──────────────

/*
 * `app_pode_ver_vendedor()` continua existindo — os RPCs a chamam uma vez por chamada, e
 * ali ela é a forma mais legível de perguntar. Numa POLICY é outra história: ela recebe
 * a coluna da linha, então é correlacionada, e uma função SECURITY DEFINER não é inlined
 * pelo planner. Resultado: uma chamada de função por lançamento lido.
 *
 * Na forma de array o mesmo teste vira InitPlan — calculado uma vez por consulta — e a
 * semântica é idêntica, porque `app_pode_ver_vendedor` agora é literalmente
 * `= any(app_vendedores_visiveis())`. São 48 lançamentos hoje e 1.101 cessões esperando
 * para virar lançamento; a hora de trocar é antes, não quando a tela ficar lenta.
 */
drop policy if exists comissao_lancamentos_v2_select on public.comissao_lancamentos_v2;
create policy comissao_lancamentos_v2_select on public.comissao_lancamentos_v2
for select using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
);

drop policy if exists comissao_lancamentos_select on public.comissao_lancamentos;
create policy comissao_lancamentos_select on public.comissao_lancamentos
for select using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
);

drop policy if exists vendas_select on public.vendas;
create policy vendas_select on public.vendas
for select using (
  (select public.app_tem_modulo('comercial'))
  and vendedor_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
);

drop policy if exists sdr_leads_select on public.sdr_leads;
create policy sdr_leads_select on public.sdr_leads
for select using (
  (select public.app_tem_modulo('comercial'))
  and (
    sdr_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
    or vendedor_destino_id = any (coalesce((select public.app_vendedores_visiveis()), '{}'::uuid[]))
  )
);

-- ─── 7. O funil de certificados também enxerga pelo closer ───────────────────

/**
 * O escopo do não-gestor tinha dois braços, e só um deles atravessava a hierarquia.
 *
 * "A carteira de originação de quem eu posso abrir" já vinha de `app_vendedores_visiveis()`
 * e portanto já incluía o closer do auxiliar. O segundo braço, "a MINHA carteira em
 * qualquer papel", era literalmente `c.vendedor_id = eu` — e para o auxiliar isso é um
 * conjunto vazio, porque quem titulariza conta é o closer. Resultado medido: o closer via
 * 25 cards e o auxiliar dele via 10, com as 15 contas passivas faltando exatamente no
 * lugar onde "mesma visualização" tinha de valer.
 *
 * `app_carteira_empresas()` já responde "a minha carteira, mais a do meu closer". Usá-la
 * aqui é o que faz o funil de certificados dizer a mesma coisa que o de NFs.
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
    where c.ate is null and c.papel = 'originacao'
      and c.vendedor_id = any (public.app_vendedores_visiveis());
    -- Mais as contas da carteira — a minha e, se eu for auxiliar, a do meu closer.
    v_escopo := v_escopo || public.app_carteira_empresas();
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
