-- ═════════════════════════════════════════════════════════════════════════════
-- 0215 — O auxiliar do closer vê só a própria folha
--
-- ─── O QUE ACONTECIA ────────────────────────────────────────────────────────
-- A 0210 já tinha encurtado a régua do dinheiro: `app_vendedores_visiveis_comissao()`
-- devolve a própria pessoa mais os acessos concedidos A ELA, sem herdar os acessos
-- do superior que a régua do TRABALHO tem. Aquilo fechou o vazamento pela herança.
--
-- Ficou aberto o outro caminho, e é por ele que a folha inteira da casa estava
-- passando: o PERFIL. `app_gestor_comercial()` é verdadeiro para quem tem perfil
-- `Admin` ou `Comercial`, e a auxiliar tem perfil `Comercial` — que é o que lhe dá o
-- módulo. Com isso ela caía no primeiro ramo do `case`, o ramo do gestor, e enxergava
-- todos os vendedores: o extrato abria em "Consolidado (todos)", somando a folha da
-- empresa inteira.
--
-- O perfil responde "a que MÓDULOS esta pessoa tem acesso". Ele não foi feito para
-- responder "de quem ela pode ver a remuneração", e usá-lo para isso faz com que dar
-- acesso a uma tela dê, de carona, acesso ao salário dos outros.
--
-- ─── A REGRA ────────────────────────────────────────────────────────────────
-- Ser auxiliar VENCE ser gestor, para efeito de dinheiro. Não é um caso a mais no
-- `case`: é a primeira pergunta, antes do perfil.
--
-- Vence porque as duas afirmações têm pesos diferentes. "Tem perfil Comercial" é uma
-- concessão de acesso a telas, feita no cadastro, que ninguém relê. "É auxiliar de um
-- closer" é uma posição na estrutura comercial, declarada em `vendedores.superior_id`,
-- e é ela que descreve o que a pessoa faz. Entre as duas, a específica ganha — e, no
-- empate, o erro barato é mostrar dinheiro de menos, não de mais.
--
-- O auxiliar NÃO PERDE NADA que seja dele. A linha dele já é a do closer com o
-- percentual aplicado: o motor deriva um lançamento de AUXILIAR de cada lançamento de
-- VENDEDOR do superior, com a mesma descrição e o mesmo sacado, valendo
-- `repasse_auxiliar_pct` ÷ nº de auxiliares. O extrato dele continua inteiro, linha a
-- linha, na escala dele. O que some é o valor cheio do closer — que é remuneração do
-- closer.
--
-- E não mexe no TRABALHO: ele continua enxergando o funil do superior, a carteira e o
-- Meu Dia dele, por `app_vendedores_visiveis()`, que esta migração não toca. Ajudar
-- alguém a tocar as contas dele continua sendo motivo para ver as contas — e nunca foi
-- motivo para ver o contracheque.
--
-- ─── AS QUATRO PORTAS ───────────────────────────────────────────────────────
-- Fechar só a dos lançamentos deixaria a folha alheia entrando pelas outras três,
-- todas guardadas por `app_gestor_comercial()` sozinho:
--
--   comissao_lancamentos / _v2   o extrato, via `app_vendedores_visiveis_comissao()`
--   comissao_competencias        o TOTAL da casa no mês fechado
--   commission_params            a taxa PESSOAL de alguém (`vendedor_id` preenchido)
--   comissao_regras              o mesmo, no modelo antigo
--
-- Os parâmetros GLOBAIS (`vendedor_id is null`) continuam visíveis para todos: são eles
-- que explicam o próprio extrato, e esconder a régua de quem é pago por ela
-- transformaria o valor numa afirmação sem defesa.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app_auxiliar_de_closer()
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.vendedores v
    where v.usuario_id = auth.uid() and v.ativo and v.tipo = 'auxiliar'
  );
$function$;

comment on function public.app_auxiliar_de_closer is
  'Esta pessoa é auxiliar de um closer? Só o dinheiro pergunta isto (0215): para efeito '
  'de FOLHA, ser auxiliar vence ser gestor, e o auxiliar vê apenas a própria. A régua do '
  'TRABALHO (`app_vendedores_visiveis`) não muda — ele segue enxergando o funil do superior.';

revoke execute on function public.app_auxiliar_de_closer() from public, anon;
grant execute on function public.app_auxiliar_de_closer() to authenticated, service_role;

-- ─── 1. O extrato ───────────────────────────────────────────────────────────
--
-- O ramo do auxiliar vem ANTES do de gestor de propósito: é a pergunta mais específica,
-- e pô-la depois faria o perfil continuar vencendo, que é exatamente o defeito.

create or replace function public.app_vendedores_visiveis_comissao()
returns uuid[] language sql stable security definer set search_path = '' as $function$
  select case
    when public.app_auxiliar_de_closer()
      then coalesce(array[public.app_vendedor_atual()], '{}'::uuid[])
    when public.app_gestor_comercial()
      then coalesce((select array_agg(v.id) from public.vendedores v), '{}'::uuid[])
    else coalesce((
      select array_agg(distinct s.x)
      from (
        select public.app_vendedor_atual() as x
        union
        /*
         * Só o que foi concedido A ELE, nominalmente. Sem a herança dos acessos do
         * superior que a régua do TRABALHO tem: ajudar um closer a tocar as contas
         * dele não é motivo para ver a folha de um terceiro.
         */
        select a.pode_ver_vendedor_id
        from public.vendedor_acessos a
        where a.vendedor_id = public.app_vendedor_atual()
      ) s
      where s.x is not null
    ), '{}'::uuid[])
  end;
$function$;

comment on function public.app_vendedores_visiveis_comissao is
  'De quem esta pessoa pode ver a FOLHA. Mais curta que `app_vendedores_visiveis`, que '
  'responde de quem ela vê o TRABALHO. Auxiliar: só ele mesmo, mesmo com perfil de gestor '
  '(0215). Gestor: todos. Os demais: ele mesmo + os acessos concedidos nominalmente a ele.';

-- ─── 2. O total da casa no mês ──────────────────────────────────────────────

drop policy if exists comissao_competencias_select on public.comissao_competencias;
create policy comissao_competencias_select on public.comissao_competencias
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (select public.app_gestor_comercial())
    -- `total` é a folha da empresa inteira naquele mês. É o consolidado, e consolidado
    -- é pergunta de quem responde pela folha.
    and not (select public.app_auxiliar_de_closer())
  );

-- ─── 3. A taxa pessoal de alguém ────────────────────────────────────────────

drop policy if exists commission_params_select on public.commission_params;
create policy commission_params_select on public.commission_params
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (
      -- Global: a régua que explica o próprio extrato. Vale para todos, auxiliar incluso.
      vendedor_id is null
      or vendedor_id = (select public.app_vendedor_atual())
      or ((select public.app_gestor_comercial()) and not (select public.app_auxiliar_de_closer()))
    )
  );

-- ─── 4. O mesmo, no modelo anterior ─────────────────────────────────────────

drop policy if exists comissao_regras_select on public.comissao_regras;
create policy comissao_regras_select on public.comissao_regras
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (
      vendedor_id = (select public.app_vendedor_atual())
      or (vendedor_id is null and tipo_vendedor = (select public.app_vendedor_tipo()))
      or ((select public.app_gestor_comercial()) and not (select public.app_auxiliar_de_closer()))
    )
  );

-- ─── 5. A PORTA QUE A RLS NÃO ALCANÇA ───────────────────────────────────────
--
-- As quatro acima são políticas de RLS, e RLS não vale dentro de uma função
-- `security definer`. Duas funções assim leem a folha, e as duas perguntavam
-- `app_pode_ver_vendedor()` — que é a régua do TRABALHO.
--
-- É por aqui que passava o vazamento que mais importa, porque é a aba que abre por
-- padrão: `comissao_painel_v2` mostrava à auxiliar o "Mês corrente" da casa inteira,
-- R$ 11.135,59, quebrado POR PAPEL — o que deixa ler a linha de cada um por subtração.
-- A dela é R$ 2.450,16.
--
-- Isto não é regressão da 0210: aquela migração consertou as políticas e não encostou
-- nestas funções. O defeito vinha de antes e sobreviveu a ela justamente porque RLS e
-- `security definer` são dois caminhos diferentes para o mesmo dado — e só um deles
-- tinha sido corrigido.
--
-- A lição que fica escrita: quem mexer na régua do dinheiro tem DOIS lugares para
-- mexer, e `grep app_pode_ver_vendedor` sobre funções que leem `comissao_%` é como se
-- acha o segundo.

create or replace function public.app_pode_ver_folha(p_vendedor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select p_vendedor_id = any (coalesce(public.app_vendedores_visiveis_comissao(), '{}'::uuid[]));
$function$;

comment on function public.app_pode_ver_folha is
  'Posso ver a REMUNERAÇÃO desta pessoa? O par de `app_pode_ver_vendedor`, que responde '
  'pelo TRABALHO e é mais permissivo. Toda função `security definer` que lê comissão usa '
  'esta — a RLS não alcança lá dentro (0215).';

revoke execute on function public.app_pode_ver_folha(uuid) from public, anon;
grant execute on function public.app_pode_ver_folha(uuid) to authenticated, service_role;

-- ─── 5a. O painel de comissão ───────────────────────────────────────────────
--
-- Mesma função, com a régua trocada nos seis lugares. O `p_vendedor_id` explícito
-- também passa a ser conferido pelo dinheiro: pedir o painel de alguém pelo id é o
-- caminho mais curto para ler a folha dele.

create or replace function public.comissao_painel_v2(p_vendedor_id uuid default null, p_meses integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  -- O mês é o de São Paulo, não o do servidor: no dia 1º às 00h30 UTC ainda é dia 30 aqui,
  -- e abrir a tela no "mês que vem" antes de o mês acabar é a forma mais rápida de alguém
  -- achar que a comissão sumiu.
  v_comp date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')))::date;
  v_ant date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
  v_desde date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo'))
                   - make_interval(months => greatest(coalesce(p_meses, 12), 1) - 1))::date;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if p_vendedor_id is not null and not public.app_pode_ver_folha(p_vendedor_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  return jsonb_build_object(
    'tem_acesso', true,
    'competencia', v_comp,
    'vendedor_id', p_vendedor_id,
    'consolidado', p_vendedor_id is null,
    'mes_corrente', (
      select jsonb_build_object(
        'total', coalesce(sum(l.valor), 0),
        'lancamentos', count(*)::int,
        -- Cessões DISTINTAS: a mesma NF paga vendedor e originador, e contar linhas
        -- diria que converteram duas notas onde converteu uma.
        'cessoes', count(distinct l.origem_id) filter (where l.origem_tipo = 'nf_convertida')::int,
        'volume_cedido', coalesce((
          select sum(v.valor_cedido)
          from (
            select distinct l2.origem_id, l2.valor_cedido
            from public.comissao_lancamentos_v2 l2
            where l2.competencia = v_comp and l2.origem_tipo = 'nf_convertida'
              and (p_vendedor_id is null or l2.vendedor_id = p_vendedor_id)
              and public.app_pode_ver_folha(l2.vendedor_id)
          ) v
        ), 0),
        'por_papel', coalesce((
          select jsonb_object_agg(x.papel, x.total)
          from (
            select l2.papel, sum(l2.valor) as total
            from public.comissao_lancamentos_v2 l2
            where l2.competencia = v_comp
              and (p_vendedor_id is null or l2.vendedor_id = p_vendedor_id)
              and public.app_pode_ver_folha(l2.vendedor_id)
            group by 1
          ) x
        ), '{}'::jsonb)
      )
      from public.comissao_lancamentos_v2 l
      where l.competencia = v_comp
        and (p_vendedor_id is null or l.vendedor_id = p_vendedor_id)
        and public.app_pode_ver_folha(l.vendedor_id)
    ),
    'mes_anterior', (
      select jsonb_build_object(
        'competencia', v_ant,
        'total', coalesce(sum(l.valor), 0),
        'cessoes', count(distinct l.origem_id) filter (where l.origem_tipo = 'nf_convertida')::int
      )
      from public.comissao_lancamentos_v2 l
      where l.competencia = v_ant
        and (p_vendedor_id is null or l.vendedor_id = p_vendedor_id)
        and public.app_pode_ver_folha(l.vendedor_id)
    ),
    'historico', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.competencia desc)
      from (
        select
          l.competencia,
          sum(l.valor) as total,
          count(*)::int as lancamentos,
          -- Sem linha em comissao_competencias, a competência ainda está ABERTA — que é o
          -- estado do mês corrente e o único em que um lançamento novo ainda pode entrar.
          --
          -- Lida por dentro da função, e não pela tabela: a política da
          -- `comissao_competencias` agora recusa o auxiliar, e sem isto o histórico dele
          -- diria "aberta" sobre um mês já fechado. O status do mês não é dinheiro de
          -- ninguém — o TOTAL da casa é, e esse continua fora do alcance dele.
          coalesce((select c.status from public.comissao_competencias c
                    where c.competencia = l.competencia), 'aberta') as status,
          coalesce((
            select jsonb_object_agg(y.papel, y.total)
            from (
              select l3.papel, sum(l3.valor) as total
              from public.comissao_lancamentos_v2 l3
              where l3.competencia = l.competencia
                and (p_vendedor_id is null or l3.vendedor_id = p_vendedor_id)
                and public.app_pode_ver_folha(l3.vendedor_id)
              group by 1
            ) y
          ), '{}'::jsonb) as por_papel
        from public.comissao_lancamentos_v2 l
        where l.competencia >= v_desde
          and (p_vendedor_id is null or l.vendedor_id = p_vendedor_id)
          and public.app_pode_ver_folha(l.vendedor_id)
        group by l.competencia
      ) h
    ), '[]'::jsonb)
  );
end $function$;

-- ─── 5b. O painel do vendedor ───────────────────────────────────────────────
--
-- Aqui a régua NÃO é trocada, é DESDOBRADA. `comercial_resumo_vendedor` é um painel de
-- TRABALHO — leads, vendas, NFs, carteira, próximas reuniões — e o auxiliar deve mesmo
-- abrir o do closer: é o trabalho que ele ajuda a tocar. O único bloco de dinheiro é
-- `comissao_mes`, e é só ele que passa a responder à régua do dinheiro.
--
-- Vira `null`, e não zero. Zero seria uma afirmação falsa sobre a comissão do closer;
-- `null` é "não é com você", e as duas telas que leem isto já sabem lidar com a
-- ausência.

create or replace function public.comercial_resumo_vendedor(p_vendedor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_id uuid := coalesce(p_vendedor_id, public.app_vendedor_atual());
  v_v public.vendedores;
  v_comp date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')))::date;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if v_id is null then
    -- Gestor sem cadastro de vendedor é caso normal, não erro: ele vê os painéis dos
    -- outros pelo seletor. A tela precisa distinguir isso de "sem acesso".
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true);
  end if;
  if not public.app_pode_ver_vendedor(v_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select * into v_v from public.vendedores where id = v_id;

  return jsonb_build_object(
    'tem_acesso', true,
    'vendedor', jsonb_build_object('id', v_v.id, 'nome', v_v.nome, 'tipo', v_v.tipo, 'is_ia', v_v.is_ia),
    'leads_por_estagio', (
      select coalesce(jsonb_object_agg(estagio, n), '{}'::jsonb)
      from (select estagio, count(*)::int n from public.sdr_leads where sdr_id = v_id group by 1) s
    ),
    'vendas_por_estagio', (
      select coalesce(jsonb_object_agg(estagio, n), '{}'::jsonb)
      from (select estagio, count(*)::int n from public.vendas where vendedor_id = v_id group by 1) s
    ),
    'nfs_vivas', (
      select count(*)::int from public.notas_fiscais nf
      where nf.vendedor_id = v_id and nf.estagio_funil not in ('convertida', 'perdida')
    ),
    'passivas_geridas', (
      select count(*)::int from public.vendedor_carteira c
      where c.vendedor_id = v_id and c.papel = 'gestao_passiva' and c.ate is null
    ),
    'sacados_titularizados', (
      select count(*)::int from public.vendedor_carteira c
      where c.vendedor_id = v_id and c.papel = 'vendedor' and c.ate is null
    ),
    'cedentes_titularizados', (
      select count(*)::int from public.vendedor_carteira c
      where c.vendedor_id = v_id and c.papel = 'originador' and c.ate is null
    ),
    'aceites_pendentes', (
      select count(*)::int from public.sdr_aceites a
      where a.vendedor_destino_id = v_id and a.status = 'pendente'
    ),
    'proximas_reunioes', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.inicio_em), '[]'::jsonb)
      from (
        select e.id, e.titulo, e.inicio_em, e.empresa_id
        from public.vendedor_eventos e
        where e.vendedor_id = v_id and e.cancelado_em is null and e.inicio_em >= now()
        order by e.inicio_em limit 5
      ) x
    ),
    'comissao_mes', case when public.app_pode_ver_folha(v_id) then jsonb_build_object(
      'competencia', v_comp,
      'total', (select coalesce(sum(valor), 0) from public.comissao_lancamentos_v2
                where vendedor_id = v_id and competencia = v_comp),
      'cessoes', (select count(distinct origem_id)::int from public.comissao_lancamentos_v2
                  where vendedor_id = v_id and competencia = v_comp and origem_tipo = 'nf_convertida'),
      'por_status', (
        select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
        from (select status, sum(valor) total from public.comissao_lancamentos_v2
              where vendedor_id = v_id and competencia = v_comp group by 1) s
      ),
      'por_papel', (
        select coalesce(jsonb_object_agg(papel, total), '{}'::jsonb)
        from (select papel, sum(valor) total from public.comissao_lancamentos_v2
              where vendedor_id = v_id and competencia = v_comp group by 1) s
      )
    ) end
  );
end $function$;
