-- 0132 — Motor de Comissões v2 (Prompt 04k).
--
-- APLICADA EM PARTES no banco, para localizar a falha caso alguma fosse recusada:
-- `0132a_comissoes_v2_tabelas`, `0132b_comissoes_v2_rls`, `0132c_comissoes_v2_rpcs`,
-- `0132d_gestao_com_motivo_e_carteira_v2`, `0132e_comissoes_v2_leitura`,
-- `0132f_comissoes_v2_seeds`, `0132g_resumo_le_o_motor_v2` — mais três correções
-- aplicadas em seguida e já incorporadas ao texto abaixo:
-- `0133_reclassificacao_ve_o_que_falta_classificar` (o painel escondia as 191 contas sem
-- classificação, que são exatamente as que não geram lançamento nenhum),
-- `0134_grants_do_motor_v2`, `0135_indice_do_bonus_de_conta_fechada` e
-- `0136_carteira_reatribuir_o_mesmo_dono_nao_e_erro` e
-- `0137_volume_cedido_conta_cessoes_distintas`.
--
-- Este arquivo é o conteúdo completo e final, na mesma ordem.
--
-- Substitui as REGRAS do 04g (valor fixo por milhão, SDR por reunião agendada) sem
-- apagar nada delas: `comissao_regras` e `comissao_lancamentos` continuam de pé como
-- histórico read-only. Recalcular o passado com a régua nova seria mudar folhas já
-- pagas, e "modelo anterior" é uma resposta melhor que um número diferente do que a
-- pessoa recebeu.
--
-- A ideia que organiza o v2 em uma frase: **o fato gerador é a CESSÃO, e a unidade é o
-- VOP**. Não é o valor cedido — é o valor cedido ponderado pelo prazo
-- (`valor × dias / 30`), porque uma antecipação de 45 dias imobiliza uma vez e meia o
-- que uma de 30 imobiliza, e pagar as duas igual premiava a operação mais barata para
-- nós na mesma medida que a mais cara.
--
-- A segunda ideia: **vendedor e originador não correm risco de crédito**. A comissão
-- nasce na CONVERSÃO, não na liquidação. Recompra e inadimplência não geram clawback;
-- só geram estorno os dois casos em que a cessão deixa de existir — status que regride
-- e NF cancelada.
--
-- A terceira: **sempre para frente**. Reclassificar uma conta hoje não reprecifica o que
-- ela já converteu, e fechar uma competência a torna imutável — um estorno descoberto
-- depois entra como linha NEGATIVA no mês corrente, nunca como um update no passado.

-- ─── §1 Parâmetros versionados ──────────────────────────────────────────────
--
-- O 04g tinha UMA regra por tipo de vendedor, com um número dentro de um jsonb. O
-- motor v2 precisa de vinte e três números — taxas, prazos de fase, sunsets, janelas,
-- dormência — e cada um deles muda em data diferente. Guardar isso como jsonb por tipo
-- faria toda alteração de um prazo reescrever o objeto inteiro, e um objeto inteiro não
-- tem vigência: só a linha tem.
--
-- `vigente_ate` é EXCLUSIVO (o daterange é `[)`), ao contrário de `comissao_regras`,
-- onde ele é inclusivo. É o preço de a não-sobreposição ser garantida pelo banco em vez
-- de por convenção: `[)` é o único intervalo que encaixa sem buraco nem sobra quando um
-- parâmetro sucede o outro no mesmo dia. A UI mostra a véspera, que é o que uma pessoa
-- lê como "até".

create extension if not exists btree_gist with schema extensions;

create table public.commission_params (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  -- NULL = parâmetro geral da empresa. Preenchido = override de uma pessoa, e vence.
  vendedor_id uuid references public.vendedores (id) on delete cascade,
  valor numeric not null,
  unidade text not null
    constraint commission_params_unidade_check
    check (unidade in ('BRL_PER_MM', 'BRL', 'MONTHS', 'DAYS', 'HOURS', 'PERCENT', 'BOOL', 'MULTIPLIER')),
  vigente_de date not null,
  /* Primeiro dia que já NÃO vale. Null = vigente sem fim. */
  vigente_ate date,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now(),
  constraint commission_params_vigencia_check check (vigente_ate is null or vigente_ate > vigente_de)
);

/*
 * Não-sobreposição garantida pelo BANCO, não pela tela.
 *
 * Dois parâmetros da mesma chave vigentes no mesmo dia não é um erro de digitação: é uma
 * comissão que depende de qual linha o `order by` devolveu primeiro. O `coalesce` no
 * vendedor existe porque em SQL dois nulos nunca são iguais — sem ele, dois parâmetros
 * GERAIS sobrepostos passariam batido, que é justamente o caso mais comum.
 */
alter table public.commission_params add constraint commission_params_sem_sobreposicao
  exclude using gist (
    chave with =,
    (coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (daterange(vigente_de, coalesce(vigente_ate, 'infinity'::date), '[)')) with &&
  );

create index commission_params_busca_idx on public.commission_params (chave, vigente_de desc);

comment on table public.commission_params is
  'Parâmetros do motor de comissão, com vigência e override por vendedor. Resolução: '
  'override do vendedor vigente na data do evento → senão o parâmetro geral vigente nela. '
  'Ausência de linha é um valor legítimo (ex.: sunset_originador_meses ausente = sem sunset).';

-- ─── §2 Histórico da classificação do sacado ────────────────────────────────
--
-- `empresas.gestao_operacao` sabe o presente. A comissão pergunta pelo passado: uma
-- cessão convertida em março tem de ser precificada pela classificação de março, e o
-- §8 ainda diz que a mudança vige no DIA SEGUINTE. Sem histórico, reclassificar uma
-- conta hoje reprecificaria tudo o que ela já converteu — em silêncio.

create table public.gestao_operacao_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  valor_anterior text,
  valor_novo text not null,
  -- Obrigatório: "por que esta conta virou passiva" é a única pergunta que a folha do
  -- mês seguinte vai fazer, e ninguém lembra a resposta três meses depois.
  motivo text not null,
  alterado_por uuid not null references public.usuarios (id),
  alterado_em timestamptz not null default now()
);

create index gestao_operacao_historico_empresa_idx
  on public.gestao_operacao_historico (empresa_id, alterado_em desc);

comment on table public.gestao_operacao_historico is
  'Imutável: só INSERT. A classificação vigente numa data D é a do último registro com '
  'alterado_em < D — mudança feita no dia D só vale a partir de D+1 (§8).';

-- ─── §3 Marco de ativação da conta ──────────────────────────────────────────
--
-- Contrato assinado NÃO inicia o relógio. A idade da conta — que decide crescimento,
-- manutenção e sunset — conta da primeira NF convertida, porque é o primeiro dia em que
-- a conta de fato operou. Medir do contrato pagaria fase de crescimento por meses em que
-- nada aconteceu.

alter table public.empresas
  add column marco_ativacao date;

comment on column public.empresas.marco_ativacao is
  'Data da PRIMEIRA NF convertida deste sacado. Preenchido uma vez pelo motor de comissão '
  'e nunca recuado: é o zero do relógio de fase, e mover o zero move todas as taxas.';

-- ─── §4 Titularidade: os dois papéis novos e o split ────────────────────────
--
-- Os papéis do 04g continuam: `originacao` (roteamento de NF por carteira escolhida a
-- dedo) e `gestao_passiva` (a comissão de volume do modelo anterior). Os dois novos são
-- do motor v2 e têm ENTIDADE diferente: `vendedor` titulariza o SACADO, `originador`
-- titulariza o CEDENTE. Reaproveitar `originacao` para as duas coisas faria um único
-- vínculo responder a duas perguntas diferentes — e a primeira vez que elas divergissem,
-- ninguém saberia qual estava errada.

alter table public.vendedor_carteira
  drop constraint vendedor_carteira_papel_check;

alter table public.vendedor_carteira
  add constraint vendedor_carteira_papel_check
    check (papel in ('originacao', 'gestao_passiva', 'sdr', 'vendedor', 'originador')),
  add column share_pct numeric(6, 3) not null default 100
    constraint vendedor_carteira_share_check check (share_pct > 0 and share_pct <= 100),
  -- Como o vínculo nasceu. `automatica` é o caminho normal do v2 (o funil cria); o
  -- gestor continua podendo sobrepor à mão, e a diferença precisa aparecer na tela.
  add column origem text not null default 'manual'
    constraint vendedor_carteira_origem_check check (origem in ('manual', 'automatica'));

/*
 * O índice de unicidade passa a valer só para o titular INTEIRO.
 *
 * "Um titular vigente por papel/entidade" continua sendo a regra — e é o que o índice
 * garante quando `share_pct = 100`. O split (várias linhas somando 100) fica possível
 * sem que a soma possa passar de 100, o que o trigger abaixo cobre. Sem o recorte no
 * índice, split de 60/40 seria recusado como duplicata.
 */
drop index if exists public.vendedor_carteira_vigente_idx;
create unique index vendedor_carteira_vigente_idx
  on public.vendedor_carteira (empresa_id, papel)
  where ate is null and share_pct = 100;

create or replace function public.vendedor_carteira_share_soma()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_soma numeric;
begin
  select coalesce(sum(share_pct), 0) into v_soma
  from public.vendedor_carteira
  where empresa_id = new.empresa_id and papel = new.papel and ate is null and id <> new.id;

  if v_soma + new.share_pct > 100.001 then
    raise exception 'Titularidade "%" nesta entidade já soma % de 100 — não cabe mais %.',
      new.papel, v_soma, new.share_pct using errcode = '23514';
  end if;
  return new;
end $$;

/*
 * Qualquer insert/update que resulte em linha VIGENTE, não só os de `share_pct`/`ate`:
 * mover uma linha vigente para outra empresa também muda uma soma.
 */
create trigger vendedor_carteira_share_soma_trg
  before insert or update on public.vendedor_carteira
  for each row when (new.ate is null)
  execute function public.vendedor_carteira_share_soma();

-- ─── §5 Fila de aceite do SDR ───────────────────────────────────────────────
--
-- Uma reunião realizada vira dinheiro do SDR, e quem confirma que ela aconteceu é quem
-- sentou nela — o vendedor destino. O SLA existe porque o silêncio do vendedor não pode
-- custar a comissão do SDR: passado o prazo, a reunião conta como aceita. Recusar, sim,
-- exige motivo — é a recusa que precisa ser explicada, não o aceite.

create table public.sdr_aceites (
  id uuid primary key default gen_random_uuid(),
  sdr_lead_id uuid not null references public.sdr_leads (id) on delete cascade,
  sdr_id uuid not null references public.vendedores (id),
  vendedor_destino_id uuid not null references public.vendedores (id),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  reuniao_em timestamptz,
  criado_em timestamptz not null default now(),
  prazo_em timestamptz not null,
  status text not null default 'pendente'
    constraint sdr_aceites_status_check check (status in ('pendente', 'aceita', 'recusada')),
  -- Expirou sem ação: conta como aceita, e a tela diz que foi o relógio que decidiu.
  aceite_automatico boolean not null default false,
  decidido_em timestamptz,
  decidido_por uuid references public.usuarios (id),
  motivo_recusa text,
  -- O lançamento nasce daqui; a marca evita que o job horário pague duas vezes.
  lancado_em timestamptz,
  constraint sdr_aceites_recusa_exige_motivo
    check (status <> 'recusada' or motivo_recusa is not null)
);

-- UM aceite por lead: reagendar a mesma reunião não duplica o evento (§5).
create unique index sdr_aceites_lead_idx on public.sdr_aceites (sdr_lead_id);
create index sdr_aceites_fila_idx on public.sdr_aceites (vendedor_destino_id, status, prazo_em);
create index sdr_aceites_pendentes_idx on public.sdr_aceites (prazo_em) where status = 'pendente';
/* O caminho LIVE: na primeira NF convertida de um sacado, o motor procura a reunião
   aceita daquela conta para decidir o bônus de conta fechada. O índice da fila
   (vendedor_destino_id, …) serve a outra pergunta. */
create index sdr_aceites_empresa_idx on public.sdr_aceites (empresa_id, status);

comment on table public.sdr_aceites is
  'Fila de confirmação da reunião realizada. Expira COMO ACEITA: o silêncio de quem '
  'sentou na reunião não é evidência de que ela não aconteceu, e transferir esse risco '
  'ao SDR o faria pagar pela agenda do outro.';

-- ─── §6 Competências ────────────────────────────────────────────────────────
--
-- O status vive no lançamento, mas "esta competência está fechada" é uma afirmação
-- sobre o MÊS, não sobre uma linha: é ela que a trava de parâmetro consulta, e é ela
-- que o gestor aprova de uma vez. Derivar isso do conjunto de lançamentos daria a
-- resposta errada no caso que mais importa — um mês sem nenhum lançamento.

create table public.comissao_competencias (
  competencia date primary key,
  status text not null default 'fechada'
    constraint comissao_competencias_status_check check (status in ('fechada', 'aprovada', 'paga')),
  lancamentos int not null default 0,
  total numeric(14, 2) not null default 0,
  fechada_em timestamptz not null default now(),
  aprovada_por uuid references public.usuarios (id),
  aprovada_em timestamptz,
  paga_por uuid references public.usuarios (id),
  paga_em timestamptz
);

comment on table public.comissao_competencias is
  'Uma linha por mês fechado. Existir aqui já significa IMUTÁVEL: estorno posterior '
  'entra como lançamento negativo na competência corrente, nunca reescreve o passado.';

-- ─── §7 Lançamentos v2 ──────────────────────────────────────────────────────
--
-- Cada linha guarda o SNAPSHOT do que decidiu o valor: classificação, fase, dias, VOP,
-- taxa e o conjunto de parâmetros resolvidos. Não é redundância com `commission_params`
-- — é a diferença entre poder responder "por que R$ 450?" em janeiro do ano que vem e
-- ter de reconstituir a tabela de taxas daquele dia a partir do histórico.

create table public.comissao_lancamentos_v2 (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id),
  papel text not null
    constraint comissao_lancamentos_v2_papel_check check (papel in ('VENDEDOR', 'ORIGINADOR', 'SDR')),
  competencia date not null,
  origem_tipo text not null
    constraint comissao_lancamentos_v2_origem_check
    check (origem_tipo in ('nf_convertida', 'sdr_reuniao', 'sdr_conta_fechada', 'estorno', 'ajuste_manual')),
  -- Texto, não uuid: é access_key, id externo de antecipação ou id de lead conforme a origem.
  origem_id text not null,
  /* Quando o FATO GERADOR aconteceu. A competência é o mês dele — menos no estorno, que
     nasce na competência corrente justamente para não reabrir a do original. */
  evento_em timestamptz not null default now(),
  empresa_id uuid references public.empresas (id),
  cedente_cnpj text,
  cedente_nome text,
  nf_numero text,
  descricao text,
  -- Snapshot do fato gerador.
  gestao_operacao text,
  fase text
    constraint comissao_lancamentos_v2_fase_check
    check (fase is null or fase in ('CRESCIMENTO', 'MANUTENCAO', 'RESIDUAL')),
  valor_cedido numeric(14, 2),
  anticipation_days int,
  vop numeric(16, 2),
  taxa_brl_por_mm numeric(12, 2),
  share_pct numeric(6, 3) not null default 100,
  valor numeric(12, 2) not null,
  params_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'provisionado'
    constraint comissao_lancamentos_v2_status_check
    check (status in ('provisionado', 'fechado', 'aprovado', 'pago', 'estornado')),
  aprovado_por uuid references public.usuarios (id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  -- Idempotência do motor: reprocessar a mesma cessão não paga duas vezes.
  unique (papel, origem_tipo, origem_id, vendedor_id)
);

create index comissao_lancamentos_v2_extrato_idx
  on public.comissao_lancamentos_v2 (vendedor_id, competencia desc, evento_em desc);
create index comissao_lancamentos_v2_competencia_idx
  on public.comissao_lancamentos_v2 (competencia, status);
create index comissao_lancamentos_v2_origem_idx
  on public.comissao_lancamentos_v2 (origem_tipo, origem_id);

comment on table public.comissao_lancamentos_v2 is
  'Lançamento LIVE: nasce provisionado no instante do fato gerador (NF convertida ou '
  'evento de SDR) e o extrato do mês corrente o mostra na hora. Fechamento mensal → '
  'fechado; gestor aprova → aprovado → pago. Estorno é linha NEGATIVA nova, nunca update.';

comment on column public.comissao_lancamentos_v2.status is
  '`estornado` marca o original de um estorno que o alcançou ainda provisionado. O valor '
  'positivo dele permanece — quem zera é a linha negativa espelhada, e é assim que o '
  'extrato mostra os dois lados em vez de fazer uma linha desaparecer.';

-- ─── §8 RLS ─────────────────────────────────────────────────────────────────
--
-- Mesma régua do 04g: quem tem o módulo lê a mecânica (parâmetros, histórico de
-- classificação, fila de aceite, status das competências), porque nada disso é dinheiro
-- de ninguém em particular — é a política. O lançamento é a exceção: ele é dinheiro de
-- UMA pessoa, e passa por `app_pode_ver_vendedor`, que já resolve próprio + acessos
-- cruzados + gestores.
--
-- Escrita: nenhuma tabela tem grant de insert/update para `authenticated`. Não é zelo —
-- "fechar competência" e "aceitar reunião" gravam em três tabelas na mesma transação, e
-- meia transação é um estado que não pode existir numa folha.

alter table public.commission_params          enable row level security;
alter table public.gestao_operacao_historico  enable row level security;
alter table public.sdr_aceites                enable row level security;
alter table public.comissao_competencias      enable row level security;
alter table public.comissao_lancamentos_v2    enable row level security;

create policy commission_params_select on public.commission_params
  for select using ((select public.app_tem_modulo('comercial')));
create policy gestao_operacao_historico_select on public.gestao_operacao_historico
  for select using ((select public.app_tem_modulo('comercial')));
create policy sdr_aceites_select on public.sdr_aceites
  for select using ((select public.app_tem_modulo('comercial')));
create policy comissao_competencias_select on public.comissao_competencias
  for select using ((select public.app_tem_modulo('comercial')));

create policy comissao_lancamentos_v2_select on public.comissao_lancamentos_v2
  for select using (
    (select public.app_tem_modulo('comercial')) and (select public.app_pode_ver_vendedor(vendedor_id))
  );

grant select on public.commission_params, public.gestao_operacao_historico,
  public.sdr_aceites, public.comissao_competencias, public.comissao_lancamentos_v2
  to authenticated;

/*
 * Realtime no extrato do mês corrente (§6: "o extrato do mês corrente atualiza em tempo
 * real"). Estar na publicação NÃO fura a RLS: o Realtime avalia
 * `comissao_lancamentos_v2_select` contra o JWT do assinante linha a linha, então o
 * socket de um vendedor nunca recebe o lançamento de outro.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'comissao_lancamentos_v2'
  ) then
    alter publication supabase_realtime add table public.comissao_lancamentos_v2;
  end if;
end
$$;

-- ─── §9 Escrita: só por RPC ─────────────────────────────────────────────────

/* Uma competência fechada é imutável. Esta é a pergunta que a trava de parâmetro faz. */
create or replace function public.app_competencia_fechada(p_data date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comissao_competencias
    where competencia = date_trunc('month', p_data)::date
  );
$$;

comment on function public.app_competencia_fechada is
  'A competência do mês de p_data já foi fechada? Existir em comissao_competencias já '
  'significa fechada — os três status (fechada/aprovada/paga) são todos posteriores ao fecho.';

/*
 * Publicar um parâmetro.
 *
 * Nunca EDITA uma linha existente: publicar é abrir uma vigência nova e encerrar a
 * anterior no mesmo dia. Editar o valor de uma linha vigente desde março reprecificaria
 * março inteiro em silêncio — e é exatamente o que a exclusion constraint e este RPC
 * existem para impedir.
 *
 * `encerrar` publica a AUSÊNCIA: encerra o vigente sem abrir outro. É como se desliga um
 * sunset (ausência = sem sunset) sem inventar um número que signifique "nenhum".
 */
create or replace function public.app_salvar_commission_param(p jsonb)
returns public.commission_params language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_chave text := p ->> 'chave';
  v_vendedor uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_de date := coalesce(nullif(p ->> 'vigente_de', '')::date, current_date);
  v_encerrar boolean := coalesce((p ->> 'encerrar')::boolean, false);
  v_unidade text := p ->> 'unidade';
  v_valor numeric := nullif(p ->> 'valor', '')::numeric;
  v_linha public.commission_params;
  v_conflito date;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores publicam parâmetros de comissão.' using errcode = '42501';
  end if;
  if v_chave is null or length(v_chave) = 0 then
    raise exception 'Informe a chave do parâmetro.' using errcode = '22023';
  end if;

  -- A trava de §6: não se muda a régua de um mês que já virou folha.
  if public.app_competencia_fechada(v_de) then
    raise exception 'A competência de % já está fechada — publique a partir de %.',
      to_char(v_de, 'MM/YYYY'),
      to_char((date_trunc('month', current_date))::date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  /*
   * Retroagir para DENTRO de uma vigência que já começou seria reescrever o passado por
   * outro caminho: a linha antiga continuaria valendo até ontem e o histórico ficaria com
   * dois donos para o mesmo dia. Publicar é sempre daqui para a frente.
   */
  select vigente_de into v_conflito
  from public.commission_params
  where chave = v_chave and vendedor_id is not distinct from v_vendedor
    and vigente_de > v_de
  order by vigente_de limit 1;
  if v_conflito is not null then
    raise exception 'Já existe parâmetro desta chave vigente a partir de % — publique depois disso.',
      to_char(v_conflito, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  -- Encerra o vigente no dia do novo (o intervalo é `[)`: o fim é o começo do próximo).
  update public.commission_params
  set vigente_ate = v_de
  where chave = v_chave and vendedor_id is not distinct from v_vendedor
    and vigente_de <= v_de and (vigente_ate is null or vigente_ate > v_de);

  if v_encerrar then
    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'comissao.parametro_encerrado', 'commission_params', v_chave, p);
    return null;
  end if;

  if v_valor is null then
    raise exception 'Informe o valor do parâmetro.' using errcode = '22023';
  end if;
  if v_unidade is null then
    raise exception 'Informe a unidade do parâmetro.' using errcode = '22023';
  end if;

  insert into public.commission_params (chave, vendedor_id, valor, unidade, vigente_de, criado_por)
  values (v_chave, v_vendedor, v_valor, v_unidade, v_de, v_ator)
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comissao.parametro_publicado', 'commission_params', v_linha.id::text, p);

  return v_linha;
end $$;

/*
 * Aceitar ou recusar a reunião que o SDR marcou.
 *
 * Quem decide é quem sentou na reunião — ou um gestor, que é quem desempata quando a
 * pessoa saiu ou não responde. Recusar exige motivo porque é a recusa que tira dinheiro
 * de alguém; aceitar não exige nada, e o silêncio também aceita (o job horário).
 *
 * O LANÇAMENTO não nasce aqui. Ele é do motor, no worker, que sabe resolver parâmetro na
 * data e gravar o snapshot — reimplementar isso em plpgsql daria duas respostas para a
 * mesma pergunta. O que fica aqui é a decisão; o worker é acordado logo em seguida e o
 * job horário reconcilia o que não chegou.
 */
create or replace function public.app_decidir_aceite_sdr(p jsonb)
returns public.sdr_aceites language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_aceite public.sdr_aceites;
  v_decisao text := p ->> 'decisao';
  v_motivo text := nullif(trim(p ->> 'motivo_recusa'), '');
  v_resumo text;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_decisao not in ('aceita', 'recusada') then
    raise exception 'Decisão inválida: %.', v_decisao using errcode = '22023';
  end if;

  select * into v_aceite from public.sdr_aceites where id = (p ->> 'aceite_id')::uuid;
  if v_aceite.id is null then
    raise exception 'Aceite não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_aceite.status <> 'pendente' then
    raise exception 'Esta reunião já foi decidida.' using errcode = '22023';
  end if;
  if v_aceite.vendedor_destino_id is distinct from public.app_vendedor_atual()
     and not public.app_gestor_comercial() then
    raise exception 'Só quem recebeu a reunião (ou um gestor) decide o aceite.' using errcode = '42501';
  end if;
  if v_decisao = 'recusada' and v_motivo is null then
    raise exception 'Recusar exige motivo.' using errcode = '22023';
  end if;

  update public.sdr_aceites set
    status = v_decisao,
    motivo_recusa = case when v_decisao = 'recusada' then v_motivo else null end,
    decidido_em = now(),
    decidido_por = v_ator
  where id = v_aceite.id
  returning * into v_aceite;

  v_resumo := case v_decisao
    when 'aceita' then 'Reunião confirmada pelo vendedor — a comissão do SDR foi provisionada.'
    else 'Reunião recusada: ' || v_motivo || '.' end;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_aceite.empresa_id, 'sdr.aceite_pendente',
    jsonb_build_object(
      'resumo', v_resumo,
      'url', '/comercial/comissoes',
      'aceite_id', v_aceite.id, 'decisao', v_decisao, 'lead_id', v_aceite.sdr_lead_id),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sdr.aceite_' || v_decisao, 'sdr_aceites', v_aceite.id::text, p);

  return v_aceite;
end $$;

/*
 * Aprovar e pagar uma competência inteira.
 *
 * Por COMPETÊNCIA e não linha a linha: aprovar quarenta lançamentos um a um é a tarefa
 * que leva alguém a aprovar sem ler. Só avança — `paga` não volta para `aprovada` por um
 * clique distraído, e nada aqui reabre uma competência.
 *
 * As três variáveis intermediárias (v_esperado, v_de_lancamento, v_para_lancamento) não
 * são estilo: um `case` cru dentro de um `if` é cortado pelo plpgsql no primeiro `then`
 * que ele encontra, e o erro sai como "syntax error at end of input" — a três telas do
 * lugar onde está.
 */
create or replace function public.app_mudar_status_competencia(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_comp date := (p ->> 'competencia')::date;
  v_status text := p ->> 'status';
  v_esperado text;
  v_de_lancamento text;
  v_para_lancamento text;
  v_atual text;
  v_n int;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores aprovam ou pagam competência.' using errcode = '42501';
  end if;
  if v_status not in ('aprovada', 'paga') then
    raise exception 'Status inválido: %.', v_status using errcode = '22023';
  end if;

  v_esperado := case v_status when 'aprovada' then 'fechada' else 'aprovada' end;
  v_de_lancamento := case v_status when 'aprovada' then 'fechado' else 'aprovado' end;
  v_para_lancamento := case v_status when 'aprovada' then 'aprovado' else 'pago' end;

  select status into v_atual from public.comissao_competencias where competencia = v_comp;
  if v_atual is null then
    raise exception 'A competência de % ainda não foi fechada.', to_char(v_comp, 'MM/YYYY')
      using errcode = '22023';
  end if;
  if v_atual <> v_esperado then
    raise exception 'A competência de % está "%" — não dá para marcar "%".',
      to_char(v_comp, 'MM/YYYY'), v_atual, v_status using errcode = '22023';
  end if;

  update public.comissao_lancamentos_v2 set
    status = v_para_lancamento,
    aprovado_por = case when v_status = 'aprovada' then v_ator else aprovado_por end,
    aprovado_em = case when v_status = 'aprovada' then now() else aprovado_em end
  where competencia = v_comp and status = v_de_lancamento;
  get diagnostics v_n = row_count;

  update public.comissao_competencias set
    status = v_status,
    aprovada_por = case when v_status = 'aprovada' then v_ator else aprovada_por end,
    aprovada_em = case when v_status = 'aprovada' then now() else aprovada_em end,
    paga_por = case when v_status = 'paga' then v_ator else paga_por end,
    paga_em = case when v_status = 'paga' then now() else paga_em end
  where competencia = v_comp;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (null, 'competencia.aprovada',
    jsonb_build_object(
      'titulo', 'Competência ' || to_char(v_comp, 'MM/YYYY') || ' — ' || v_status,
      'resumo', v_n || ' lançamento(s) agora ' || v_para_lancamento || '.',
      'url', '/comercial/comissoes',
      'competencia', v_comp, 'status', v_status, 'linhas', v_n),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'competencia.' || v_status, 'comissao_competencias', v_comp::text,
          p || jsonb_build_object('linhas', v_n));

  return v_n;
end $$;

/*
 * Ajuste manual: a linha que o motor não sabe fazer.
 *
 * Existe porque toda folha tem um caso que a regra não cobre, e a alternativa a um
 * lançamento explícito e auditado é alguém mexer no valor de um lançamento automático —
 * que é como se perde a única explicação que a linha tinha. Só em competência ABERTA.
 */
create or replace function public.app_ajuste_manual_comissao(p jsonb)
returns public.comissao_lancamentos_v2 language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_comp date := coalesce((p ->> 'competencia')::date,
                          date_trunc('month', now() at time zone 'America/Sao_Paulo')::date);
  v_linha public.comissao_lancamentos_v2;
  v_descricao text := nullif(trim(p ->> 'descricao'), '');
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores lançam ajuste manual.' using errcode = '42501';
  end if;
  if v_descricao is null then
    raise exception 'Ajuste manual exige descrição.' using errcode = '22023';
  end if;
  if public.app_competencia_fechada(v_comp) then
    raise exception 'A competência de % já está fechada.', to_char(v_comp, 'MM/YYYY')
      using errcode = '22023';
  end if;

  insert into public.comissao_lancamentos_v2 (
    vendedor_id, papel, competencia, origem_tipo, origem_id, evento_em,
    descricao, valor, params_snapshot, status
  ) values (
    (p ->> 'vendedor_id')::uuid,
    coalesce(p ->> 'papel', 'VENDEDOR'),
    v_comp,
    'ajuste_manual',
    'ajuste:' || gen_random_uuid()::text,
    now(),
    v_descricao,
    (p ->> 'valor')::numeric,
    jsonb_build_object('ajuste_manual', true, 'por', v_ator),
    'provisionado'
  ) returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comissao.ajuste_manual', 'comissao_lancamentos_v2', v_linha.id::text, p);

  return v_linha;
end $$;

revoke execute on function public.app_salvar_commission_param(jsonb),
  public.app_decidir_aceite_sdr(jsonb), public.app_mudar_status_competencia(jsonb),
  public.app_ajuste_manual_comissao(jsonb) from public;
grant execute on function public.app_salvar_commission_param(jsonb),
  public.app_decidir_aceite_sdr(jsonb), public.app_mudar_status_competencia(jsonb),
  public.app_ajuste_manual_comissao(jsonb) to authenticated, service_role;
revoke execute on function public.app_competencia_fechada(date) from public;
grant execute on function public.app_competencia_fechada(date) to authenticated, service_role;

/*
 * A função de TRIGGER não é chamável por ninguém. Exposta em `/rest/v1/rpc/` ela não faria
 * nada útil (erraria por falta de contexto de trigger), mas uma SECURITY DEFINER pendurada
 * numa rota pública é superfície que não precisa existir.
 */
revoke execute on function public.vendedor_carteira_share_soma() from public, anon, authenticated;

-- ─── §12 O que o 04g já tinha, agora ciente do v2 ───────────────────────────

/*
 * §3 — a classificação passa a exigir MOTIVO e a deixar rastro.
 *
 * Mesma função do 04g, com duas adições: recusa a mudança sem motivo e grava o histórico
 * imutável na mesma transação. As duas coisas existem pelo mesmo fato: a partir de agora
 * `gestao_operacao` decide qual taxa uma cessão paga, e "quem mudou isso, quando e por
 * quê" deixou de ser curiosidade para virar a resposta de uma contestação de folha.
 *
 * O histórico é escrito só quando o valor MUDA. Reabrir o diálogo e salvar o mesmo valor
 * não é um fato — e uma linha por clique transformaria o histórico em log de navegação.
 */
create or replace function public.app_definir_gestao_operacao(p jsonb)
returns public.empresas language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_antes text;
  v_gestao text := p ->> 'gestao_operacao';
  v_gestor uuid := nullif(p ->> 'vendedor_gestao_id', '')::uuid;
  v_originador uuid := nullif(p ->> 'vendedor_originacao_id', '')::uuid;
  v_motivo text := nullif(trim(p ->> 'motivo'), '');
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
  v_antes := v_empresa.gestao_operacao;

  if v_gestao is not null and v_empresa.estagio not in ('cliente', 'ex_cliente') then
    raise exception
      'Ativo x passivo só se decide para cliente ou ex-cliente da OnePay — esta empresa está em "%".',
      v_empresa.estagio using errcode = '22023';
  end if;
  if v_gestao = 'passivo' and v_gestor is null then
    raise exception 'Empresa passiva precisa de um vendedor de gestão.' using errcode = '22023';
  end if;
  -- Só gestor reclassifica: a classificação é a taxa, e a taxa não é decisão de quem recebe.
  if v_gestao is distinct from v_antes then
    if not public.app_gestor_comercial() then
      raise exception 'Só gestores mudam a classificação da conta.' using errcode = '42501';
    end if;
    if v_motivo is null then
      raise exception 'Mudar a classificação exige motivo.' using errcode = '22023';
    end if;
  end if;

  if v_originador is not null then
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

  /*
   * O histórico. `valor_novo` é not null, então "remover a classificação" entra como o
   * texto 'nenhum' em vez de sumir: uma conta que DEIXOU de ser passiva é um fato tão
   * relevante para a comissão quanto uma que passou a ser.
   */
  if v_gestao is distinct from v_antes then
    insert into public.gestao_operacao_historico
      (empresa_id, valor_anterior, valor_novo, motivo, alterado_por)
    values (v_empresa.id, v_antes, coalesce(v_gestao, 'nenhum'), v_motivo, v_ator);
  end if;

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
        else 'Gestão de operação removida.' end
        || case when v_motivo is null then '' else ' Motivo: ' || v_motivo end,
      'gestao_operacao', v_gestao, 'vendedor_gestao_id', v_gestor,
      'vendedor_originacao_id', v_originador, 'motivo', v_motivo,
      -- §3: sempre para frente. A mudança vale a partir de amanhã; o que já converteu
      -- guarda a classificação do dia em que converteu, no próprio lançamento.
      'vigencia', 'a partir do dia seguinte'),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'cliente.gestao_alterada', 'empresas', v_empresa.id::text, p);

  return v_empresa;
end $function$;

/*
 * Carteira manual: agora também nos dois papéis do motor v2.
 *
 * O gestor continua podendo sobrepor o que o funil atribuiu sozinho — é a válvula que
 * torna a automação aceitável. `origem = 'manual'` marca a diferença, e a tela mostra:
 * um vínculo que uma pessoa escolheu não deve parecer o mesmo que um que caiu do funil.
 */
create or replace function public.app_definir_carteira(p jsonb)
returns public.vendedor_carteira language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_papel text := p ->> 'papel';
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_vendedor uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_share numeric := coalesce(nullif(p ->> 'share_pct', '')::numeric, 100);
  v_linha public.vendedor_carteira;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam carteira.' using errcode = '42501';
  end if;
  if v_papel not in ('originacao', 'gestao_passiva', 'sdr', 'vendedor', 'originador') then
    raise exception 'Papel inválido: %.', v_papel using errcode = '22023';
  end if;

  update public.vendedor_carteira set ate = now()
  where empresa_id = v_empresa and papel = v_papel and ate is null
    and vendedor_id is distinct from v_vendedor;

  if v_vendedor is null then
    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'comercial.carteira_liberada', 'empresas', v_empresa::text, p);
    return null;
  end if;

  /*
   * `not exists`, e não `on conflict do nothing`.
   *
   * O trigger de share é BEFORE, e um BEFORE roda ANTES de o ON CONFLICT decidir que a
   * linha já existe: reatribuir quem JÁ é titular deixaria de ser um no-op silencioso e
   * viraria exceção — a soma daria 100 (o vigente) mais 100 (o que nunca chegaria a
   * existir). Reabrir o diálogo e salvar sem mudar nada é um caminho normal.
   */
  insert into public.vendedor_carteira (vendedor_id, empresa_id, papel, share_pct, origem)
  select v_vendedor, v_empresa, v_papel, v_share, 'manual'
  where not exists (
    select 1 from public.vendedor_carteira c
    where c.empresa_id = v_empresa and c.papel = v_papel and c.ate is null
      and c.vendedor_id = v_vendedor
  )
  returning * into v_linha;

  if v_linha.id is null then
    select * into v_linha from public.vendedor_carteira
    where empresa_id = v_empresa and papel = v_papel and ate is null and vendedor_id = v_vendedor;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.carteira_definida', 'empresas', v_empresa::text, p);

  return v_linha;
end $$;

-- ─── §10 Leitura agregada ───────────────────────────────────────────────────
--
-- Uma RPC em vez de seis consultas do cliente. O extrato LINHA A LINHA continua vindo da
-- tabela (é ele que precisa de Realtime, e Realtime não assina função); o que vem daqui
-- é o que exige agregação — total do mês, quebra por papel, contagem de cessões,
-- comparativo com o mês anterior e a série de doze meses com o status de cada competência.

create or replace function public.comissao_painel_v2(
  p_vendedor_id uuid default null,
  p_meses int default 12
)
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
  if p_vendedor_id is not null and not public.app_pode_ver_vendedor(p_vendedor_id) then
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
        /* Sobre as CESSÕES DISTINTAS, não sobre um papel. Filtrar por ORIGINADOR era um
           atalho para não somar a mesma cessão duas vezes (ela paga vendedor E
           originador), e ele mentia no caso mais comum: cedente sem originador titular
           marcava volume zero ao lado de um extrato cheio. */
        'volume_cedido', coalesce((
          select sum(v.valor_cedido)
          from (
            select distinct l2.origem_id, l2.valor_cedido
            from public.comissao_lancamentos_v2 l2
            where l2.competencia = v_comp and l2.origem_tipo = 'nf_convertida'
              and (p_vendedor_id is null or l2.vendedor_id = p_vendedor_id)
              and public.app_pode_ver_vendedor(l2.vendedor_id)
          ) v
        ), 0),
        'por_papel', coalesce((
          select jsonb_object_agg(x.papel, x.total)
          from (
            select l2.papel, sum(l2.valor) as total
            from public.comissao_lancamentos_v2 l2
            where l2.competencia = v_comp
              and (p_vendedor_id is null or l2.vendedor_id = p_vendedor_id)
              and public.app_pode_ver_vendedor(l2.vendedor_id)
            group by 1
          ) x
        ), '{}'::jsonb)
      )
      from public.comissao_lancamentos_v2 l
      where l.competencia = v_comp
        and (p_vendedor_id is null or l.vendedor_id = p_vendedor_id)
        and public.app_pode_ver_vendedor(l.vendedor_id)
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
        and public.app_pode_ver_vendedor(l.vendedor_id)
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
          coalesce((select c.status from public.comissao_competencias c
                    where c.competencia = l.competencia), 'aberta') as status,
          coalesce((
            select jsonb_object_agg(y.papel, y.total)
            from (
              select l3.papel, sum(l3.valor) as total
              from public.comissao_lancamentos_v2 l3
              where l3.competencia = l.competencia
                and (p_vendedor_id is null or l3.vendedor_id = p_vendedor_id)
                and public.app_pode_ver_vendedor(l3.vendedor_id)
              group by 1
            ) y
          ), '{}'::jsonb) as por_papel
        from public.comissao_lancamentos_v2 l
        where l.competencia >= v_desde
          and (p_vendedor_id is null or l.vendedor_id = p_vendedor_id)
          and public.app_pode_ver_vendedor(l.vendedor_id)
        group by l.competencia
      ) h
    ), '[]'::jsonb)
  );
end $function$;

revoke execute on function public.comissao_painel_v2(uuid, int) from public;
grant execute on function public.comissao_painel_v2(uuid, int) to authenticated, service_role;

/*
 * Painel de reclassificação (§7.6).
 *
 * Devolve NÚMEROS, não julgamentos: volume da janela, média dos três meses anteriores,
 * idade da conta. Quem transforma isso em "fase" e em "sugerir revisão" é o core, em
 * TypeScript, com os parâmetros vigentes — reimplementar a régua de fase em SQL criaria
 * uma segunda resposta para a pergunta que decide a taxa.
 *
 * Lista TODO cliente e ex-cliente, inclusive quem ainda não tem classificação. A primeira
 * versão filtrava `gestao_operacao is not null` e, medido na base de 25/08/2026, escondia
 * 191 das 195 contas — justamente as que mais importam, porque **conta sem classificação
 * não gera lançamento nenhum**. O painel que existe para gerir a classificação era o
 * único lugar onde a conta não classificada não aparecia.
 *
 * A agregação vem de um CTE, e não de subconsultas correlacionadas:
 * `app_holding_do_sacado` é uma função por linha, e duas subconsultas por empresa
 * varriam `antecipacoes` inteira duas vezes por conta.
 */
create or replace function public.comissao_reclassificacao(p_janela_dias int default 45)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_de timestamptz := (v_hoje - make_interval(days => p_janela_dias));
  v_base timestamptz := (v_hoje - make_interval(days => p_janela_dias) - interval '90 days');
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  return jsonb_build_object(
    'tem_acesso', true,
    'janela_dias', p_janela_dias,
    'contas', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.volume_janela desc, x.razao_social)
      from (
        with vol as (
          select public.app_holding_do_sacado(a.sacado_cnpj) as empresa_id,
                 coalesce(sum(a.gross_value) filter (where a.convertida_em >= v_de), 0) as janela,
                 /* A média dos TRÊS meses ANTERIORES à janela: incluir a própria janela na
                    base de comparação diluiria a queda que se quer detectar. */
                 coalesce(sum(a.gross_value)
                          filter (where a.convertida_em >= v_base and a.convertida_em < v_de), 0) / 3
                   as media_anterior
          from public.antecipacoes a
          where a.convertida_em is not null and a.regrediu_em is null
          group by 1
        )
        select
          e.id as empresa_id,
          e.cnpj,
          e.razao_social,
          e.gestao_operacao,
          e.marco_ativacao,
          e.gestao_definida_em,
          (select v.nome from public.vendedor_carteira c
             join public.vendedores v on v.id = c.vendedor_id
            where c.empresa_id = e.id and c.papel = 'vendedor' and c.ate is null
            limit 1) as titular,
          coalesce(vol.janela, 0) as volume_janela,
          coalesce(vol.media_anterior, 0) as media_mensal_anterior,
          (select count(*)::int from public.gestao_operacao_historico h where h.empresa_id = e.id) as mudancas
        from public.empresas e
        left join vol on vol.empresa_id = e.id
        where e.estagio in ('cliente', 'ex_cliente')
      ) x
    ), '[]'::jsonb)
  );
end $function$;

revoke execute on function public.comissao_reclassificacao(int) from public;
grant execute on function public.comissao_reclassificacao(int) to authenticated, service_role;

-- ─── §11 Seeds ──────────────────────────────────────────────────────────────
--
-- Vigentes a partir de HOJE. Uma cessão anterior a isto não encontra parâmetro e não
-- gera lançamento — que é o comportamento certo: o modelo v2 não existia naquele dia, e
-- inventar um valor retroativo criaria uma folha que ninguém combinou.
--
-- `sunset_originador_meses` NÃO está aqui de propósito: a ausência da linha é o valor
-- "sem sunset". Um número que significasse "nunca" (0? 9999?) seria uma convenção a mais
-- para alguém interpretar errado.

insert into public.commission_params (chave, valor, unidade, vigente_de)
select t.chave, t.valor, t.unidade, current_date
from (values
  -- Unidade de cálculo do VOP.
  ('dias_referencia_vop',                    30,   'DAYS'),

  -- Taxas do originador: iguais nos dois modos porque o trabalho dele é o mesmo — quem
  -- muda de valor conforme a conta é o vendedor, cujo esforço depende de a conta trazer
  -- operação sozinha ou não.
  ('orig_prospeccao_ativa',                 600,   'BRL_PER_MM'),
  ('orig_passivo',                          600,   'BRL_PER_MM'),

  -- Taxas do vendedor: quatro combinações de (classificação × fase).
  ('vend_prospeccao_ativa_crescimento',    1000,   'BRL_PER_MM'),
  ('vend_prospeccao_ativa_manutencao',      600,   'BRL_PER_MM'),
  ('vend_passivo_crescimento',              400,   'BRL_PER_MM'),
  ('vend_passivo_manutencao',               200,   'BRL_PER_MM'),

  -- Relógio da conta, contado do marco de ativação.
  ('fase_crescimento_prospeccao_ativa_meses', 6,   'MONTHS'),
  ('fase_crescimento_passivo_meses',          6,   'MONTHS'),
  ('sunset_vendedor_prospeccao_ativa_meses', 24,   'MONTHS'),
  ('sunset_vendedor_passivo_meses',          18,   'MONTHS'),

  -- SDR.
  ('sdr_valor_reuniao',                     200,   'BRL'),
  ('sdr_valor_conta_fechada',              1500,   'BRL'),
  ('sdr_sla_recusa_horas',                   48,   'HOURS'),
  ('janela_atribuicao_sdr_dias',            180,   'DAYS'),

  -- Titularidade e sinalizadores.
  ('dormencia_cedente_dias',                 60,   'DAYS'),
  ('alerta_revisao_dias',                    45,   'DAYS'),
  ('alerta_revisao_percentual',              50,   'PERCENT'),

  -- Fora de escopo (§11), com os valores já combinados e a flag DESLIGADA. Ficam aqui
  -- para a tela poder explicar o que existe e por que não está ligado — um parâmetro que
  -- só aparece quando alguém o liga é um parâmetro que ninguém revisa.
  ('premio_transicao_multiplo',               6,   'MULTIPLIER'),
  ('flag_premio_transicao',                   0,   'BOOL'),
  ('carencia_migracao_dias',                 90,   'DAYS'),
  ('flag_carencia_migracao',                  0,   'BOOL'),
  ('reativacao_dormente_dias',               90,   'DAYS'),
  ('flag_reativacao_dormente',                0,   'BOOL')
) as t(chave, valor, unidade)
where not exists (select 1 from public.commission_params p where p.chave = t.chave);

/*
 * Marco de ativação retroativo.
 *
 * Sem isto, toda conta que já opera há dois anos nasceria hoje em CRESCIMENTO e pagaria
 * a taxa mais alta do sistema — o oposto do que o desenho quer. A primeira NF convertida
 * está no banco desde o 04e; o marco é uma leitura dela, não uma invenção.
 */
update public.empresas e
set marco_ativacao = m.primeira
from (
  select public.app_holding_do_sacado(a.sacado_cnpj) as empresa_id,
         min((a.convertida_em at time zone 'America/Sao_Paulo')::date) as primeira
  from public.antecipacoes a
  where a.convertida_em is not null and a.regrediu_em is null
  group by 1
) m
where e.id = m.empresa_id and e.marco_ativacao is null;

-- Notificações: cada evento novo para quem age sobre ele. Comissão lançada NÃO entra —
-- seriam dezenas de sinos por dia, e o extrato live já mostra o número mudando.
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values
  ('competencia.fechada'), ('competencia.aprovada'), ('conta.revisao_sugerida'),
  ('sdr.aceite_pendente'), ('comissao.estornada'), ('titularidade.liberada')
) as t(tipo)
cross join public.perfis p
where p.nome = 'Comercial'
on conflict do nothing;

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values
  ('competencia.fechada'), ('competencia.aprovada'), ('comissao.estornada')
) as t(tipo)
cross join public.perfis p
where p.nome = 'Admin'
on conflict do nothing;

-- ─── §13 O resumo do painel passa a ler o motor v2 ──────────────────────────
--
-- É a mesma RPC do 04g, com três mudanças:
--
--   `comissao_mes` vem de `comissao_lancamentos_v2`. A tabela antiga continua no banco
--   como histórico, mas o número que a pessoa vê no painel e no celular tem de ser o que
--   ela vai receber — e ele agora nasce na conversão, não no fechamento do mês.
--
--   A competência é a de SÃO PAULO. `date_trunc('month', now())` é UTC: no dia 1º às
--   00h30 UTC ainda é dia 30 aqui, e o painel abriria no mês seguinte antes de o mês
--   acabar — a forma mais rápida de alguém achar que a comissão sumiu.
--
--   `aceites_pendentes` entra no resumo: é a única pendência do módulo com PRAZO, e ela
--   decide a comissão de outra pessoa. Um contador no painel é o que a torna visível
--   antes de o SLA vencer sozinho.

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
    'comissao_mes', jsonb_build_object(
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
    )
  );
end $function$;
