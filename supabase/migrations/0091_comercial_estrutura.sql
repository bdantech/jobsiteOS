-- 0091 — Estrutura Comercial (Prompt 04g).
--
-- APLICADA EM CINCO PARTES no banco (`0091a_comercial_vendedores` …
-- `0091e_comercial_seeds`), para localizar a falha caso alguma parte fosse recusada.
-- Este arquivo é o conteúdo completo, na mesma ordem.
--
-- A ideia que organiza tudo: **um lançamento de comissão é uma afirmação sobre o
-- passado**. Quem era dono da empresa no dia do evento é quem recebe, mesmo que a
-- carteira tenha mudado ontem. Por isso `vendedor_carteira` é TEMPORAL (desde/até) em
-- vez de uma coluna `vendedor_id` em `empresas`: uma coluna só sabe o presente, e o
-- presente é justamente o que não interessa quando alguém contesta a comissão de
-- março.
--
-- A segunda ideia: **passivo é passivo de verdade**. Não é um filtro visual. Uma NF de
-- sacado passivo não gera outbox, não entra em carteira de originação e não conta na
-- distribuição — senão "passivo" vira um rótulo que não muda nada e o vendedor
-- continua sendo cobrado por trabalhar uma conta que ninguém quer trabalhar.

-- ─── §1 Gestão da operação do cliente: ativo × passivo ──────────────────────
-- Aplica-se a SACADOS. `null` = não-cliente (a pergunta não existe ainda).

alter table public.empresas
  add column gestao_operacao text
    constraint empresas_gestao_operacao_check
    check (gestao_operacao is null or gestao_operacao in ('prospeccao_ativa', 'passivo')),
  add column gestao_definida_por uuid references public.usuarios (id),
  add column gestao_definida_em timestamptz;

comment on column public.empresas.gestao_operacao is
  'Como este cliente é trabalhado. NUNCA muda sozinho: o job mensal sugere passivos e '
  'notifica, uma pessoa aceita. `passivo` tem efeito real — sem outbox, fora da '
  'distribuição e fora da carteira de originação.';

-- ─── §2 Vendedores ──────────────────────────────────────────────────────────

create table public.vendedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null
    constraint vendedores_tipo_check check (tipo in ('sdr', 'vendedor', 'originador')),
  usuario_id uuid references public.usuarios (id),
  -- Vendedor de IA tem NOME PRÓPRIO ("Carina") e aparece no funil como qualquer outro.
  -- A automação dele é do Prompt 05; aqui ele já existe como dono de carteira, porque
  -- a comissão e o roteamento precisam de um dono válido desde o primeiro dia.
  is_ia boolean not null default false,
  whatsapp_conta_id uuid references public.whatsapp_contas (id) on delete set null,
  email_remetente text,
  settings jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint vendedores_dono_check check (usuario_id is not null or is_ia)
);

create unique index vendedores_usuario_idx on public.vendedores (usuario_id) where usuario_id is not null;
create index vendedores_tipo_idx on public.vendedores (tipo) where ativo;

comment on table public.vendedores is
  'Quem vende — humano ou IA. `usuario_id` resolve "Meu Painel" pelo login; um vendedor '
  'de IA não tem login e por isso o CHECK aceita um OU outro.';

create table public.vendedor_territorios (
  vendedor_id uuid primary key references public.vendedores (id) on delete cascade,
  ufs text[] not null default '{}',
  faturamento_min numeric(16, 2),
  faturamento_max numeric(16, 2)
);

comment on table public.vendedor_territorios is
  'Território de ORIGINAÇÃO: UF do sacado + faixa de faturamento. Faixa aberta dos dois '
  'lados quando null — território sem limite é território, não é ausência de território.';

/*
 * A carteira é TEMPORAL, e é o coração da comissão: o lançamento pergunta quem era
 * dono NA DATA DO EVENTO, não quem é dono hoje.
 *
 * O prompt pedia `unique (empresa_id, papel, ate)` para garantir um dono vigente por
 * papel, e isso não funcionaria: em SQL dois nulos nunca são iguais, então duas linhas
 * com `ate` nulo passariam pelo unique — exatamente o caso que precisa ser proibido.
 * Quem garante é o índice PARCIAL logo abaixo.
 */
create table public.vendedor_carteira (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  papel text not null
    constraint vendedor_carteira_papel_check check (papel in ('originacao', 'gestao_passiva', 'sdr')),
  desde timestamptz not null default now(),
  ate timestamptz
);

-- UM dono vigente por (empresa, papel). Índice PARCIAL porque `unique(...,ate)` com
-- ate nulo não impede duplicata — dois nulos nunca são iguais em SQL.
create unique index vendedor_carteira_vigente_idx
  on public.vendedor_carteira (empresa_id, papel) where ate is null;
create index vendedor_carteira_vendedor_idx on public.vendedor_carteira (vendedor_id, papel) where ate is null;
-- A consulta que a comissão faz: "quem era dono desta empresa NAQUELE dia".
create index vendedor_carteira_janela_idx on public.vendedor_carteira (empresa_id, papel, desde desc);

comment on table public.vendedor_carteira is
  'Dono de uma empresa por papel, com vigência. Toda comissão consulta esta tabela NA '
  'DATA DO EVENTO: trocar a carteira hoje não reatribui o que foi ganho em março.';

create table public.vendedor_acessos (
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  pode_ver_vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  primary key (vendedor_id, pode_ver_vendedor_id)
);

comment on table public.vendedor_acessos is
  'Visibilidade cruzada de painéis. LEITURA apenas: ver o funil do outro não é agir em '
  'nome dele. Admin e Comercial enxergam todos sem precisar de linha aqui.';

create table public.motivos_perda (
  id uuid primary key default gen_random_uuid(),
  contexto text not null
    constraint motivos_perda_contexto_check check (contexto in ('funil_vendedor', 'sdr_sem_fit')),
  motivo text not null,
  ativo boolean not null default true,
  ordem int not null default 100,
  unique (contexto, motivo)
);

comment on table public.motivos_perda is
  'Lista fechada de motivos. Fechada de propósito: "outro" com texto livre não vira '
  'gráfico, e o motivo da perda é o insumo mais barato que o Perfil (04f) tem.';

-- ─── §3 Config do módulo ────────────────────────────────────────────────────
-- Mesmo desenho de radar_config/credito_config: chave/valor jsonb, um assunto por linha.

create table public.comercial_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por uuid references public.usuarios (id),
  atualizado_em timestamptz not null default now()
);

-- ─── §4 Roteamento de NFs ───────────────────────────────────────────────────

alter table public.notas_fiscais
  add column vendedor_id uuid references public.vendedores (id) on delete set null,
  add column vendedor_origem text
    constraint notas_fiscais_vendedor_origem_check
    check (vendedor_origem is null or vendedor_origem in ('carteira', 'territorio', 'manual')),
  add column vendedor_definido_em timestamptz;

create index notas_fiscais_vendedor_idx on public.notas_fiscais (vendedor_id)
  where vendedor_id is not null;
-- A fila sem dono é uma tela: precisa de índice próprio, senão varre a tabela inteira.
create index notas_fiscais_sem_dono_idx on public.notas_fiscais (estagio_funil)
  where vendedor_id is null;

comment on column public.notas_fiscais.vendedor_origem is
  'Como esta NF chegou ao dono: carteira explícita, território, ou atribuição manual do '
  'gestor. `manual` nunca é sobrescrito pelo roteador — decisão humana não é revista.';

-- ─── §5 Funil de reuniões (SDR) ─────────────────────────────────────────────

create table public.sdr_leads (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  sdr_id uuid not null references public.vendedores (id),
  origem text not null
    constraint sdr_leads_origem_check check (origem in ('distribuicao', 'inbound', 'manual')),
  estagio text not null default 'a_contatar'
    constraint sdr_leads_estagio_check check (estagio in (
      'a_contatar', 'em_conversa', 'com_fit', 'sem_fit', 'reuniao_agendada',
      'reuniao_realizada', 'no_show', 'qualificada', 'desqualificada'
    )),
  sem_fit_motivo uuid references public.motivos_perda (id),
  reuniao_em timestamptz,
  vendedor_destino_id uuid references public.vendedores (id),
  distribuido_em timestamptz not null default now(),
  -- O relógio do SLA. Distinto de `atualizado_em`: um job que recalcula algo não é
  -- toque, e não pode fazer um lead parado parecer trabalhado.
  ultimo_toque_em timestamptz,
  atualizado_em timestamptz not null default now()
);

create index sdr_leads_sdr_idx on public.sdr_leads (sdr_id, estagio);
create index sdr_leads_empresa_idx on public.sdr_leads (empresa_id, distribuido_em desc);
-- A varredura do SLA: leads a contatar, ordenados pelo relógio que decide.
create index sdr_leads_sla_idx on public.sdr_leads (estagio, coalesce(ultimo_toque_em, distribuido_em))
  where estagio = 'a_contatar';

comment on table public.sdr_leads is
  'Funil de reuniões. `sem_fit` com motivo obrigatório é o dado mais valioso daqui: é o '
  'que diz por que a régua do Mercado está errada, e alimenta o Perfil (04f).';

-- ─── §6 Funil do vendedor (closer) ──────────────────────────────────────────

create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  vendedor_id uuid not null references public.vendedores (id),
  sdr_lead_id uuid references public.sdr_leads (id),
  estagio text not null default 'reuniao_agendada'
    constraint vendas_estagio_check check (estagio in (
      'reuniao_agendada', 'reuniao_reagendada', 'aguardando_documentacao',
      'em_analise_credito', 'proposta_enviada', 'preparacao_mou', 'mou_assinado',
      'onboarding', 'ganho', 'perdido'
    )),
  perdido_motivo uuid references public.motivos_perda (id),
  perdido_em timestamptz,
  analise_credito_id uuid references public.analises_credito (id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  -- Perder exige motivo. Sem isto o "perdido" vira lixeira e o funil deixa de ensinar.
  constraint vendas_perdido_exige_motivo
    check (estagio <> 'perdido' or perdido_motivo is not null)
);

create index vendas_vendedor_idx on public.vendas (vendedor_id, estagio);
create index vendas_empresa_idx on public.vendas (empresa_id, criada_em desc);
create index vendas_analise_idx on public.vendas (analise_credito_id) where analise_credito_id is not null;

-- ─── §7 Calendário ──────────────────────────────────────────────────────────

create table public.vendedor_eventos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete set null,
  tipo text not null default 'reuniao'
    constraint vendedor_eventos_tipo_check check (tipo in ('reuniao', 'follow_up')),
  titulo text not null,
  inicio_em timestamptz not null,
  duracao_min int not null default 60,
  sdr_lead_id uuid references public.sdr_leads (id) on delete cascade,
  venda_id uuid references public.vendas (id) on delete cascade,
  cancelado_em timestamptz,
  criado_por uuid references public.usuarios (id),
  criado_em timestamptz not null default now()
);

create index vendedor_eventos_agenda_idx on public.vendedor_eventos (vendedor_id, inicio_em)
  where cancelado_em is null;

/*
 * O feed .ics é PÚBLICO por natureza — o Google e o Outlook buscam sem cabeçalho de
 * autenticação. Por isso o token é a credencial: aleatório, por vendedor, revogável.
 * E por isso o feed devolve só título e horário, nunca o conteúdo da negociação: um
 * link de calendário vaza com facilidade (fica salvo no celular pessoal, é reencaminhado)
 * e o que vaza junto tem que ser inócuo.
 */
create table public.vendedor_ics_tokens (
  token text primary key,
  vendedor_id uuid not null references public.vendedores (id) on delete cascade,
  criado_em timestamptz not null default now(),
  revogado_em timestamptz
);

create unique index vendedor_ics_vigente_idx on public.vendedor_ics_tokens (vendedor_id)
  where revogado_em is null;

-- ─── §8 Comissões ───────────────────────────────────────────────────────────

create table public.comissao_regras (
  id uuid primary key default gen_random_uuid(),
  tipo_vendedor text not null
    constraint comissao_regras_tipo_check check (tipo_vendedor in ('sdr', 'vendedor', 'originador')),
  -- null = regra padrão do tipo; preenchido = override para uma pessoa.
  vendedor_id uuid references public.vendedores (id) on delete cascade,
  parametros jsonb not null,
  vigente_de date not null,
  vigente_ate date,
  criada_por uuid references public.usuarios (id),
  criada_em timestamptz not null default now(),
  constraint comissao_regras_vigencia_check check (vigente_ate is null or vigente_ate >= vigente_de)
);

create index comissao_regras_busca_idx on public.comissao_regras (tipo_vendedor, vigente_de desc);

comment on table public.comissao_regras is
  'Regra com VIGÊNCIA: mudar o valor por reunião hoje não reescreve o que já foi '
  'apurado. Sem isso, toda revisão de política vira uma revisão do histórico.';

create table public.comissao_lancamentos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores (id),
  competencia date not null,
  origem_tipo text not null
    constraint comissao_lancamentos_origem_check
    check (origem_tipo in ('reuniao_agendada', 'nf_convertida', 'volume_passivo', 'estorno')),
  -- Texto, não uuid: a origem pode ser um id externo de antecipação ou um agregado
  -- mensal ("volume:<empresa>:2026-08"), que não são chaves de tabela nenhuma.
  origem_id text not null,
  descricao text,
  valor numeric(12, 2) not null,
  status text not null default 'apurado'
    constraint comissao_lancamentos_status_check check (status in ('apurado', 'aprovado', 'pago')),
  regra_id uuid references public.comissao_regras (id),
  aprovado_por uuid references public.usuarios (id),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  -- A idempotência do job mensal: rodar duas vezes não paga duas vezes.
  unique (origem_tipo, origem_id, vendedor_id)
);

create index comissao_lancamentos_painel_idx
  on public.comissao_lancamentos (vendedor_id, competencia desc, status);

-- ─── §9 RLS ─────────────────────────────────────────────────────────────────
--
-- Leitura: quem tem o módulo `comercial` lê tudo. Não é descuido — é uma equipe
-- pequena onde o funil do colega é contexto de trabalho, e o leaderboard (§7 do
-- prompt) já assume isso. O que NÃO se pode é agir em nome do outro, e isso é
-- garantido pela ausência de grant de escrita: toda mutação passa por RPC.
--
-- A exceção é `comissao_lancamentos`: dinheiro de pessoa. Cada um vê o seu, mais
-- quem tem acesso cruzado explícito, mais Admin e Comercial.

alter table public.vendedores            enable row level security;
alter table public.vendedor_territorios  enable row level security;
alter table public.vendedor_carteira     enable row level security;
alter table public.vendedor_acessos      enable row level security;
alter table public.motivos_perda         enable row level security;
alter table public.comercial_config      enable row level security;
alter table public.sdr_leads             enable row level security;
alter table public.vendas                enable row level security;
alter table public.vendedor_eventos      enable row level security;
alter table public.vendedor_ics_tokens   enable row level security;
alter table public.comissao_regras       enable row level security;
alter table public.comissao_lancamentos  enable row level security;

create policy vendedores_select on public.vendedores
  for select using (public.app_tem_modulo('comercial'));
create policy vendedor_territorios_select on public.vendedor_territorios
  for select using (public.app_tem_modulo('comercial'));
create policy vendedor_carteira_select on public.vendedor_carteira
  for select using (public.app_tem_modulo('comercial'));
create policy vendedor_acessos_select on public.vendedor_acessos
  for select using (public.app_tem_modulo('comercial'));
create policy motivos_perda_select on public.motivos_perda
  for select using (public.app_tem_modulo('comercial'));
create policy comercial_config_select on public.comercial_config
  for select using (public.app_tem_modulo('comercial'));
create policy sdr_leads_select on public.sdr_leads
  for select using (public.app_tem_modulo('comercial'));
create policy vendas_select on public.vendas
  for select using (public.app_tem_modulo('comercial'));
create policy vendedor_eventos_select on public.vendedor_eventos
  for select using (public.app_tem_modulo('comercial'));
create policy comissao_regras_select on public.comissao_regras
  for select using (public.app_tem_modulo('comercial'));

/*
 * Quem é o vendedor logado. STABLE e DEFINER porque é usada dentro de policy: sem
 * DEFINER a policy de `comissao_lancamentos` precisaria ler `vendedores`, cuja policy
 * lê `perfil_modulos`, e a recursão derruba a consulta.
 */
create or replace function public.app_vendedor_atual()
returns uuid language sql stable security definer set search_path = '' as $$
  select v.id from public.vendedores v where v.usuario_id = auth.uid() and v.ativo limit 1;
$$;

create or replace function public.app_pode_ver_vendedor(p_vendedor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    -- Gestor vê todos: é ele quem aprova a comissão.
    exists (
      select 1 from public.usuarios u join public.perfis p on p.id = u.perfil_id
      where u.id = auth.uid() and u.ativo and p.nome in ('Admin', 'Comercial')
    )
    or p_vendedor_id = public.app_vendedor_atual()
    or exists (
      select 1 from public.vendedor_acessos a
      where a.vendedor_id = public.app_vendedor_atual()
        and a.pode_ver_vendedor_id = p_vendedor_id
    );
$$;

comment on function public.app_pode_ver_vendedor is
  'Visibilidade de painel: o próprio, quem tem acesso cruzado, e os gestores. Usada na '
  'RLS de comissão, que é o único dado aqui que é dinheiro de uma pessoa específica.';

create policy comissao_lancamentos_select on public.comissao_lancamentos
  for select using (
    public.app_tem_modulo('comercial') and public.app_pode_ver_vendedor(vendedor_id)
  );

-- `vendedor_ics_tokens` NÃO tem policy de select: o token é uma credencial, e ninguém
-- precisa lê-lo pelo PostgREST. A tela recebe o link pelo RPC que o gera; o feed é
-- resolvido com service role.

grant select on public.vendedores, public.vendedor_territorios, public.vendedor_carteira,
  public.vendedor_acessos, public.motivos_perda, public.comercial_config,
  public.sdr_leads, public.vendas, public.vendedor_eventos,
  public.comissao_regras, public.comissao_lancamentos to authenticated;

-- ─── §10 Escrita: só por RPC ────────────────────────────────────────────────
--
-- Nenhuma tabela deste módulo tem grant de insert/update para `authenticated`. Não é
-- zelo excessivo: "mover card" precisa gravar estágio + evento + calendário + comissão
-- numa transação só, e "trocar dono" precisa ENCERRAR o dono anterior antes de abrir o
-- novo. Deixar isso a cargo de quem chama é deixar meia transação como estado possível.

create or replace function public.app_gestor_comercial()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo and p.nome in ('Admin', 'Comercial')
  );
$$;

/*
 * Ativo × passivo. Sempre manual — inclusive quando vem de uma sugestão do job: o que
 * o job faz é notificar, e é isto aqui que uma pessoa chama ao aceitar.
 *
 * Passar para `passivo` abre carteira de gestão para o vendedor informado; voltar para
 * `prospeccao_ativa` encerra a vigência. A comissão de volume (§6 do prompt) lê essa
 * carteira mês a mês, então a data de virada é a data em que o dinheiro muda de dono.
 */
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
  if v_gestao = 'passivo' and v_gestor is null then
    raise exception 'Empresa passiva precisa de um vendedor de gestão.' using errcode = '22023';
  end if;

  update public.empresas set
    gestao_operacao = v_gestao,
    gestao_definida_por = v_ator,
    gestao_definida_em = now()
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

/* Dono de uma empresa num papel. Encerra o vigente e abre o novo, na mesma transação. */
create or replace function public.app_definir_carteira(p jsonb)
returns public.vendedor_carteira language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_papel text := p ->> 'papel';
  v_empresa uuid := (p ->> 'empresa_id')::uuid;
  v_vendedor uuid := nullif(p ->> 'vendedor_id', '')::uuid;
  v_linha public.vendedor_carteira;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam carteira.' using errcode = '42501';
  end if;
  if v_papel not in ('originacao', 'gestao_passiva', 'sdr') then
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

  insert into public.vendedor_carteira (vendedor_id, empresa_id, papel)
  values (v_vendedor, v_empresa, v_papel)
  on conflict do nothing
  returning * into v_linha;

  if v_linha.id is null then
    select * into v_linha from public.vendedor_carteira
    where empresa_id = v_empresa and papel = v_papel and ate is null;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.carteira_definida', 'empresas', v_empresa::text, p);

  return v_linha;
end $$;

/*
 * Mover um lead do funil de SDR.
 *
 * Três efeitos que não podem ficar a cargo de quem chama:
 *   `sem_fit`          exige motivo (é o dado que alimenta o Perfil 04f);
 *   `reuniao_agendada` cria o card no funil do vendedor destino E os dois eventos de
 *                      calendário — o do SDR e o do closer;
 *   qualquer movimento  marca `ultimo_toque_em`, que é o relógio do SLA.
 */
create or replace function public.app_mover_lead_sdr(p jsonb)
returns public.sdr_leads language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_lead public.sdr_leads;
  v_estagio text := p ->> 'estagio';
  v_motivo uuid := nullif(p ->> 'sem_fit_motivo', '')::uuid;
  v_reuniao timestamptz := nullif(p ->> 'reuniao_em', '')::timestamptz;
  v_destino uuid := nullif(p ->> 'vendedor_destino_id', '')::uuid;
  v_empresa public.empresas;
  v_venda_id uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_lead from public.sdr_leads where id = (p ->> 'lead_id')::uuid;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'no_data_found';
  end if;
  select * into v_empresa from public.empresas where id = v_lead.empresa_id;

  if v_estagio = 'sem_fit' and v_motivo is null then
    raise exception 'Sem fit exige motivo.' using errcode = '22023';
  end if;
  if v_estagio = 'reuniao_agendada' and (v_reuniao is null or v_destino is null) then
    raise exception 'Agendar exige data e vendedor destino.' using errcode = '22023';
  end if;

  update public.sdr_leads set
    estagio = coalesce(v_estagio, estagio),
    sem_fit_motivo = case when v_estagio = 'sem_fit' then v_motivo else sem_fit_motivo end,
    reuniao_em = coalesce(v_reuniao, reuniao_em),
    vendedor_destino_id = coalesce(v_destino, vendedor_destino_id),
    ultimo_toque_em = now(),
    atualizado_em = now()
  where id = v_lead.id
  returning * into v_lead;

  if v_estagio = 'reuniao_agendada' then
    -- O card do closer nasce aqui, não numa segunda ação: uma reunião agendada que não
    -- aparece no funil de quem vai atendê-la é uma reunião que ninguém preparou.
    insert into public.vendas (empresa_id, vendedor_id, sdr_lead_id, estagio)
    values (v_lead.empresa_id, v_destino, v_lead.id, 'reuniao_agendada')
    returning id into v_venda_id;

    insert into public.vendedor_eventos (vendedor_id, empresa_id, titulo, inicio_em, sdr_lead_id, venda_id, criado_por)
    values
      (v_destino, v_lead.empresa_id,
       'Reunião — ' || coalesce(v_empresa.razao_social, 'empresa'), v_reuniao, v_lead.id, v_venda_id, v_ator),
      (v_lead.sdr_id, v_lead.empresa_id,
       'Reunião (agendada por mim) — ' || coalesce(v_empresa.razao_social, 'empresa'), v_reuniao, v_lead.id, v_venda_id, v_ator);

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.reuniao_agendada',
      jsonb_build_object(
        'resumo', 'Reunião agendada para ' || to_char(v_reuniao at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || '.',
        'url', '/comercial/vendas/' || v_venda_id,
        'lead_id', v_lead.id, 'venda_id', v_venda_id, 'vendedor_destino_id', v_destino),
      v_ator);

  elsif v_estagio = 'sem_fit' then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.sem_fit',
      jsonb_build_object(
        'resumo', 'Sem fit: ' || coalesce((select m.motivo from public.motivos_perda m where m.id = v_motivo), '—') || '.',
        'lead_id', v_lead.id, 'motivo_id', v_motivo, 'origem', v_lead.origem),
      v_ator);

  elsif v_estagio = 'no_show' then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (v_lead.empresa_id, 'sdr.no_show',
      jsonb_build_object('resumo', 'Reunião marcada e não aconteceu (no-show).', 'lead_id', v_lead.id),
      v_ator);
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'sdr.lead_movido', 'sdr_leads', v_lead.id::text, p);

  return v_lead;
end $$;

/*
 * Mover um card do funil do vendedor.
 *
 * `ganho` promove a empresa a cliente e ABRE a pergunta ativo/passivo — não responde
 * por ela. Responder sozinho é o que transformaria o rótulo numa formalidade.
 */
create or replace function public.app_mover_venda(p jsonb)
returns public.vendas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_venda public.vendas;
  v_de text;
  v_estagio text := p ->> 'estagio';
  v_motivo uuid := nullif(p ->> 'perdido_motivo', '')::uuid;
  v_analise uuid := nullif(p ->> 'analise_credito_id', '')::uuid;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;

  select * into v_venda from public.vendas where id = (p ->> 'venda_id')::uuid;
  if v_venda.id is null then
    raise exception 'Venda não encontrada.' using errcode = 'no_data_found';
  end if;
  v_de := v_venda.estagio;

  if v_estagio = 'perdido' and v_motivo is null then
    raise exception 'Perder exige motivo.' using errcode = '22023';
  end if;

  update public.vendas set
    estagio = coalesce(v_estagio, estagio),
    perdido_motivo = case when v_estagio = 'perdido' then v_motivo else perdido_motivo end,
    perdido_em = case when v_estagio = 'perdido' then now() else perdido_em end,
    analise_credito_id = coalesce(v_analise, analise_credito_id),
    atualizada_em = now()
  where id = v_venda.id
  returning * into v_venda;

  if v_estagio = 'ganho' then
    update public.empresas set estagio = 'cliente' where id = v_venda.empresa_id and estagio <> 'cliente';
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (v_venda.empresa_id,
    case v_estagio when 'ganho' then 'venda.ganha' when 'perdido' then 'venda.perdida' else 'venda.estagio_alterado' end,
    jsonb_build_object(
      'resumo', case v_estagio
        when 'ganho' then 'Venda GANHA. Falta definir se a conta será ativa ou passiva.'
        when 'perdido' then 'Venda perdida: ' || coalesce((select m.motivo from public.motivos_perda m where m.id = v_motivo), '—') || '.'
        else 'Funil do vendedor: ' || v_de || ' → ' || v_estagio || '.' end,
      'url', '/comercial/vendas/' || v_venda.id,
      'venda_id', v_venda.id, 'de', v_de, 'para', v_estagio, 'motivo_id', v_motivo),
    v_ator);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'venda.movida', 'vendas', v_venda.id::text, p);

  return v_venda;
end $$;

/* Atribuição manual de NF a um originador. Marca `manual`, que o roteador respeita. */
create or replace function public.app_atribuir_nf(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores atribuem NF.' using errcode = '42501';
  end if;

  update public.notas_fiscais set
    vendedor_id = nullif(p ->> 'vendedor_id', '')::uuid,
    vendedor_origem = case when nullif(p ->> 'vendedor_id', '') is null then null else 'manual' end,
    vendedor_definido_em = now()
  where access_key = p ->> 'access_key';

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comercial.nf_atribuida', 'notas_fiscais', p ->> 'access_key', p);
end $$;

/* Aprovar/pagar comissão. Transição logada — é dinheiro, e é decisão de gestor. */
create or replace function public.app_mudar_status_comissao(p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_status text := p ->> 'status';
  v_n int;
begin
  if not public.app_gestor_comercial() then
    raise exception 'Só gestores mudam status de comissão.' using errcode = '42501';
  end if;
  if v_status not in ('aprovado', 'pago') then
    raise exception 'Status inválido: %.', v_status using errcode = '22023';
  end if;

  update public.comissao_lancamentos set
    status = v_status,
    aprovado_por = case when v_status = 'aprovado' then v_ator else aprovado_por end,
    aprovado_em = case when v_status = 'aprovado' then now() else aprovado_em end
  where vendedor_id = (p ->> 'vendedor_id')::uuid
    and competencia = (p ->> 'competencia')::date
    -- Só avança: `pago` não volta para `aprovado` por um clique distraído.
    and status = case v_status when 'aprovado' then 'apurado' else 'aprovado' end;
  get diagnostics v_n = row_count;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'comissao.' || v_status, 'comissao_lancamentos',
          (p ->> 'vendedor_id') || ':' || (p ->> 'competencia'), p || jsonb_build_object('linhas', v_n));

  return v_n;
end $$;

/* O link do calendário. Gera um token novo e revoga o anterior — é como se "revoga". */
create or replace function public.app_gerar_token_ics(p jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_vendedor uuid := coalesce(nullif(p ->> 'vendedor_id', '')::uuid, public.app_vendedor_atual());
  v_token text;
begin
  if v_vendedor is null then
    raise exception 'Sem vendedor.' using errcode = '22023';
  end if;
  if v_vendedor <> public.app_vendedor_atual() and not public.app_gestor_comercial() then
    raise exception 'Só o próprio vendedor ou um gestor gera o link.' using errcode = '42501';
  end if;

  update public.vendedor_ics_tokens set revogado_em = now()
  where vendedor_id = v_vendedor and revogado_em is null;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.vendedor_ics_tokens (token, vendedor_id) values (v_token, v_vendedor);
  return v_token;
end $$;

revoke execute on function public.app_definir_gestao_operacao(jsonb), public.app_definir_carteira(jsonb),
  public.app_mover_lead_sdr(jsonb), public.app_mover_venda(jsonb), public.app_atribuir_nf(jsonb),
  public.app_mudar_status_comissao(jsonb), public.app_gerar_token_ics(jsonb) from public;
grant execute on function public.app_definir_gestao_operacao(jsonb), public.app_definir_carteira(jsonb),
  public.app_mover_lead_sdr(jsonb), public.app_mover_venda(jsonb), public.app_atribuir_nf(jsonb),
  public.app_mudar_status_comissao(jsonb), public.app_gerar_token_ics(jsonb) to authenticated, service_role;
grant execute on function public.app_vendedor_atual(), public.app_pode_ver_vendedor(uuid),
  public.app_gestor_comercial() to authenticated, service_role;

-- ─── §11 Leitura agregada: o resumo do painel ───────────────────────────────
-- Uma RPC em vez de cinco consultas do cliente: o painel abre no celular, muitas vezes
-- em rua com sinal ruim, e cinco viagens é onde a tela "quase carrega".

create or replace function public.comercial_resumo_vendedor(p_vendedor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_id uuid := coalesce(p_vendedor_id, public.app_vendedor_atual());
  v_v public.vendedores;
  v_comp date := date_trunc('month', now())::date;
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
      'total', (select coalesce(sum(valor), 0) from public.comissao_lancamentos
                where vendedor_id = v_id and competencia = v_comp),
      'por_status', (
        select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
        from (select status, sum(valor) total from public.comissao_lancamentos
              where vendedor_id = v_id and competencia = v_comp group by 1) s
      )
    )
  );
end $function$;

revoke execute on function public.comercial_resumo_vendedor(uuid) from public;
grant execute on function public.comercial_resumo_vendedor(uuid) to authenticated, service_role;

-- ─── §12 Seeds ──────────────────────────────────────────────────────────────

insert into public.comercial_config (chave, valor) values
  ('distribuicao', jsonb_build_object(
    -- Onde o SDR vai buscar empresa. `som` é o default porque é a camada com sinal de
    -- compra HOJE; abrir para tam antes de o som acabar é diluir o trabalho.
    'fonte', 'som',
    'empresas_por_semana', 25,
    -- Lead parado apodrece: volta ao pool e é redistribuído. Sem isso, um SDR
    -- sobrecarregado vira o cemitério das melhores empresas da semana.
    'sla_lead_dias', 7,
    -- Não redistribuir quem já foi recusado há pouco: bater na mesma porta em 30 dias
    -- queima a marca e desperdiça a vez de outra empresa.
    'sem_fit_carencia_dias', 90
  )),
  ('painel', jsonb_build_object(
    'leaderboard', false,
    'sem_atividade_dias_uteis', 5
  )),
  ('passivos', jsonb_build_object(
    -- Candidato a passivo: cliente cujos fornecedores antecipam sozinhos e que não
    -- recebeu toque nenhum na janela. É sugestão, nunca mudança automática.
    'min_antecipacoes', 4,
    'janela_meses', 2
  )),
  ('comissao', jsonb_build_object(
    -- Estorno de no-show desligado: a comissão do SDR é por reunião AGENDADA, e punir
    -- o no-show por padrão transfere ao SDR um risco que não é dele.
    'estorno_no_show', false
  ))
on conflict (chave) do nothing;

insert into public.motivos_perda (contexto, motivo, ordem) values
  ('funil_vendedor', 'Sem interesse', 10),
  ('funil_vendedor', 'Crédito negado', 20),
  ('funil_vendedor', 'Taxa/preço', 30),
  ('funil_vendedor', 'Escolheu concorrente', 40),
  ('funil_vendedor', 'Sem urgência/timing', 50),
  ('funil_vendedor', 'Sem documentação', 60),
  ('funil_vendedor', 'Empresa sem fit', 70),
  ('funil_vendedor', 'Sem retorno (ghosting)', 80),
  ('funil_vendedor', 'Outro', 999),
  ('sdr_sem_fit', 'Porte pequeno demais', 10),
  ('sdr_sem_fit', 'Fora de região', 20),
  ('sdr_sem_fit', 'Segmento errado', 30),
  ('sdr_sem_fit', 'Já atendido', 40),
  ('sdr_sem_fit', 'Dados incorretos', 50),
  ('sdr_sem_fit', 'Outro', 999)
on conflict (contexto, motivo) do nothing;

-- Regras padrão por tipo (vendedor_id null). Vigentes desde hoje: apurar competência
-- anterior a isto não encontra regra e não inventa valor — é o comportamento certo.
insert into public.comissao_regras (tipo_vendedor, parametros, vigente_de)
select * from (values
  ('sdr', jsonb_build_object('valor_por_reuniao', 100), current_date),
  ('originador', jsonb_build_object('valor_por_milhao', 550), current_date),
  ('vendedor', jsonb_build_object('valor_por_milhao', 300), current_date)
) as t(tipo, params, de)
where not exists (
  select 1 from public.comissao_regras r where r.tipo_vendedor = t.tipo and r.vendedor_id is null
);

-- Notificações: cada evento para quem age sobre ele.
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values
  ('sdr.lead_distribuido'), ('sdr.reuniao_agendada'), ('sdr.lead_expirado'),
  ('venda.ganha'), ('venda.perdida'), ('comissao.apurada')
) as t(tipo)
cross join public.perfis p
where p.nome = 'Comercial'
on conflict do nothing;

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select t.tipo, p.id, true
from (values
  ('vendedor.sem_atividade'), ('cliente.gestao_alterada'), ('venda.ganha'), ('comissao.apurada')
) as t(tipo)
cross join public.perfis p
where p.nome = 'Admin'
on conflict do nothing;

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'comercial' from public.perfis p where p.nome in ('Admin', 'Comercial')
on conflict do nothing;
