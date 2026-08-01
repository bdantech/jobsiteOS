-- ─────────────────────────────────────────────────────────────────────────────
-- 04e — Sync de antecipações & conversão automática de NFs
--
-- Fecha o loop do funil: antecipação realizada na plataforma → NF marcada como
-- convertida. Até aqui `estagio_funil = 'convertida'` só existia por clique
-- humano (5 notas em 15.870), e a métrica por faixa media intenção, não receita.
--
-- A regra que governa o desenho inteiro: PRECISÃO ACIMA DE RECALL. Casar com a
-- NF errada marca como antecipada uma nota que ninguém antecipou — e nada na
-- tela denuncia. Ambiguidade vai para a fila humana, nunca para a conversão.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── §2 A tabela ────────────────────────────────────────────────────────────

create table if not exists antecipacoes (
  id_externo             int primary key,
  status                 text not null,
  status_anterior        text,
  anticipation_type      text,
  document_number        text,
  -- O NÚCLEO do número (zeros à esquerda fora, série fora), calculado pela mesma
  -- função do core aplicada a `notas_fiscais.numero`. Materializado porque é a
  -- chave de junção e o índice abaixo depende dele.
  numero_normalizado     text,
  sacado_cnpj            text not null check (sacado_cnpj ~ '^[0-9]{14}$'),
  fornecedor_cnpj        text not null check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  -- Os nomes vêm no payload e ficam aqui de propósito: a fila de revisão precisa
  -- dizer de quem é a antecipação mesmo quando a NF não existe — e é exatamente
  -- nesse caso que não há linha de `notas_fiscais` para dar o nome.
  sacado_nome            text,
  fornecedor_nome        text,

  request_date           date,
  created_at_plataforma  timestamptz,
  original_due_date      date,
  completion_date        timestamptz,
  anticipation_days      int,

  gross_value            numeric(14,2),
  withhold_tax           numeric(14,2),
  discounted_amount      numeric(14,2),
  net_value              numeric(14,2),
  total_spread           numeric(14,2),
  monthly_interest_rate  numeric(6,3),

  approval_with_automation boolean,
  invoice_cancelled_at   timestamptz,

  -- ── matching ──
  access_key_casada      text references notas_fiscais(access_key) on delete set null,
  match_confianca        text check (match_confianca in ('exata', 'valor_confirmado', 'manual')),
  match_em               timestamptz,
  match_status           text not null default 'pendente'
                         check (match_status in ('pendente', 'casada', 'sem_nf', 'revisao', 'ignorada')),
  -- O porquê da decisão, no vocabulário do motor. É o que a fila mostra para que
  -- a pessoa escolha em vez de investigar.
  match_motivo           text,
  -- As candidatas plausíveis quando o motor recusou decidir. Sem isto a fila
  -- teria de refazer o raciocínio do job a cada abertura de tela.
  match_candidatas       jsonb not null default '[]'::jsonb,
  match_por              uuid references usuarios(id) on delete set null,
  match_observacao       text,
  -- Quando o `sem_nf` deixou de ser "a NF ainda não chegou" e virou definitivo.
  sem_nf_definitivo_em   timestamptz,
  convertida_em          timestamptz,
  regrediu_em            timestamptz,

  raw                    jsonb,
  sincronizada_em        timestamptz not null default now(),
  atualizada_em          timestamptz not null default now()
);

comment on table antecipacoes is
  'Antecipações realizadas na plataforma Onepay (04e). Idempotente por id_externo; o casamento com notas_fiscais é feito pelo motor do core, e ambiguidade vira fila de revisão em vez de conversão.';

-- O índice do matching: o motor recorta candidatas SEMPRE pelo par
-- fornecedor↔sacado antes de olhar número (a média é 2,6 notas por par).
create index if not exists antecipacoes_par_numero_idx
  on antecipacoes (fornecedor_cnpj, sacado_cnpj, numero_normalizado);
create index if not exists antecipacoes_match_status_idx on antecipacoes (match_status);
create index if not exists antecipacoes_status_idx on antecipacoes (status);
-- A janela de re-tentativa e a calibração leem por data de criação.
create index if not exists antecipacoes_criada_idx on antecipacoes (created_at_plataforma desc);
create index if not exists antecipacoes_nf_idx on antecipacoes (access_key_casada)
  where access_key_casada is not null;

alter table antecipacoes enable row level security;

-- Mesma política de `notas_fiscais`: quem tem o módulo lê tudo; escrita só pelos
-- RPCs (SECURITY DEFINER) e pelo worker (service role, que ignora RLS).
create policy antecipacoes_select on antecipacoes
  for select using (app_tem_modulo('antecipacao'));

-- ─── §4.5 A NF ganha o vínculo e a flag de disputa ──────────────────────────

alter table notas_fiscais
  add column if not exists conversao_antecipacao_id int
    references antecipacoes(id_externo) on delete set null,
  -- Regressão NÃO reverte o estágio (§4.5). Esta flag é o que torna isso
  -- honesto: a nota continua "convertida" e a tela diz, no card, que a
  -- conversão está em disputa. Reverter em silêncio seria a máquina desfazendo
  -- receita sem que ninguém visse.
  add column if not exists conversao_em_disputa boolean not null default false;

comment on column notas_fiscais.conversao_em_disputa is
  'A antecipação que converteu esta nota voltou atrás (status não-conversor ou NF cancelada). O estágio NÃO é revertido automaticamente — um humano decide (04e §4.5).';

create index if not exists notas_fiscais_conversao_disputa_idx
  on notas_fiscais (conversao_em_disputa) where conversao_em_disputa;

-- ─── A view do funil ganha as duas colunas ──────────────────────────────────
-- Ao FINAL da lista, sempre: `create or replace view` não admite inserir coluna
-- no meio, e tentar isso derruba a migração inteira.

create or replace view notas_funil
with (security_invoker = true) as
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
    -- 04e: o selo "Convertida via antecipação #id" e a disputa.
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value AS conversao_valor,
    ant.monthly_interest_rate AS conversao_taxa,
    ant.status AS conversao_status
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

-- ─── §3 Nova fonte de ingestão ──────────────────────────────────────────────

alter table mercado_ingestoes drop constraint if exists mercado_ingestoes_fonte_check;
alter table mercado_ingestoes add constraint mercado_ingestoes_fonte_check
  check (fonte in ('receita_cnpj', 'cno', 'lista', 'onepay_nf', 'onepay_certificados',
                   'onepay_antecipacoes'));

-- ─── §4.3 Config: os status conversores são settings, não deploy ────────────
-- A plataforma cria status novo (foi assim que nasceu EXTENDED_BILL_SWAPPED). A
-- diferença entre editar settings e esperar um deploy é a diferença entre uma
-- tarde e uma semana de conversões não contadas.

insert into antecipacao_config (chave, valor) values (
  'conversao',
  jsonb_build_object(
    'status_conversores', jsonb_build_array(
      'APPROVED', 'REVISION', 'PAY_OUT', 'BILLET_SWAPPED', 'PROGRAMED_PAYMENT',
      'CONCLUDED', 'EXPIRED_BILL_SWAPPED', 'EXTENDED_BILL_SWAPPED', 'IN_EXTENSION_BILL_SWAPPED'
    ),
    'status_nao_conversores', jsonb_build_array(
      'DRAFT', 'REQUESTED', 'REPROVED', 'DENY_BY_CONTRACTED', 'PAYMENT_REPROVED'
    ),
    'janela_sync_dias', 3,
    'janela_rematch_dias', 7,
    'tolerancia_valor_pct', 1,
    'tolerancia_vencimento_dias', 5,
    'calibracao_dias', 90
  )
) on conflict (chave) do nothing;

-- ─── §6 A fila de revisão: candidatas de uma antecipação ────────────────────

create or replace function antecipacao_candidatas(p jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_ant public.antecipacoes;
  v_notas jsonb;
begin
  select * into v_ant from public.antecipacoes where id_externo = (p ->> 'id_externo')::int;
  if v_ant.id_externo is null then
    return jsonb_build_object('encontrada', false);
  end if;

  -- O MESMO recorte do motor: par fornecedor↔sacado, sem exceção. Uma fila que
  -- oferecesse candidatas de fora do par convidaria a pessoa a cometer, no
  -- clique, o erro que a automação se recusa a cometer.
  select coalesce(jsonb_agg(x order by x ->> 'proximidade', (x ->> 'numero')), '[]'::jsonb)
    into v_notas
  from (
    select jsonb_build_object(
      'access_key', n.access_key,
      'numero', n.numero,
      'serie', n.serie,
      'valor', n.valor,
      'vencimento', n.vencimento,
      'emitida_em', n.emitida_em,
      'estagio_funil', n.estagio_funil,
      'faixa', n.faixa,
      'ja_casada', exists (
        select 1 from public.antecipacoes a2
        where a2.access_key_casada = n.access_key and a2.id_externo <> v_ant.id_externo
      ),
      -- Ordena por proximidade, não por data: quem abre a fila quer a candidata
      -- mais parecida no topo.
      --
      -- `ltrim(numero,'0')` é uma APROXIMAÇÃO do normalizador do core, e é
      -- deliberado: aqui ela só ORDENA. Quem decide continua sendo o motor (no
      -- automático) ou a pessoa (no clique), e nenhum dos dois lê este campo.
      -- Hoje as duas coincidem — as 15.870 notas da base têm número de dígitos
      -- puros, sem zero à esquerda e sem série embutida. Se um dia divergirem, o
      -- pior caso é a candidata certa aparecer em segundo lugar.
      'proximidade', case
        when ltrim(n.numero, '0') = v_ant.numero_normalizado then '0'
        when v_ant.numero_normalizado is not null
             and ltrim(n.numero, '0') like v_ant.numero_normalizado || '%' then '1'
        when v_ant.gross_value is not null and n.valor is not null
             and abs(n.valor - v_ant.gross_value) <= greatest(n.valor, v_ant.gross_value) * 0.01 then '2'
        else '3'
      end
    ) as x
    from public.notas_fiscais n
    where n.fornecedor_cnpj = v_ant.fornecedor_cnpj
      and n.sacado_cnpj = v_ant.sacado_cnpj
    order by n.emitida_em desc nulls last
    limit 50
  ) t;

  return jsonb_build_object(
    'encontrada', true,
    'antecipacao', to_jsonb(v_ant) - 'raw',
    'candidatas', v_notas
  );
end; $$;

comment on function antecipacao_candidatas(jsonb) is
  'A antecipação + as NFs do MESMO par fornecedor↔sacado, ordenadas por proximidade. SECURITY INVOKER: a RLS de notas_fiscais e antecipacoes decide o que a pessoa vê.';

-- ─── §7 Casar (ou ignorar) manualmente ──────────────────────────────────────

create or replace function app_casar_antecipacao(p jsonb)
returns antecipacoes language plpgsql security definer set search_path = '' as $$
declare
  v_ant     public.antecipacoes;
  v_nf      public.notas_fiscais;
  v_ator    uuid := auth.uid();
  v_id      int  := (p ->> 'id_externo')::int;
  v_acao    text := coalesce(p ->> 'acao', 'casar');
  v_chave   text := nullif(p ->> 'access_key', '');
  v_motivo  text := nullif(p ->> 'motivo', '');
  v_cfg     jsonb;
  v_converte boolean;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  select * into v_ant from public.antecipacoes where id_externo = v_id for update;
  if v_ant.id_externo is null then
    raise exception 'Antecipação % não encontrada.', v_id using errcode = 'no_data_found';
  end if;

  -- ── Ignorar: sai da fila, com motivo ──
  if v_acao = 'ignorar' then
    if v_motivo is null then
      raise exception 'Informe o motivo.' using errcode = '23514';
    end if;
    update public.antecipacoes set
      match_status = 'ignorada',
      match_observacao = v_motivo,
      match_por = v_ator,
      match_em = now(),
      atualizada_em = now()
    where id_externo = v_id
    returning * into v_ant;

    insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
    values (v_ator, 'antecipacao.ignorada', 'antecipacoes', v_id::text, p);
    return v_ant;
  end if;

  if v_chave is null then
    raise exception 'Escolha a nota fiscal.' using errcode = '23514';
  end if;

  select * into v_nf from public.notas_fiscais where access_key = v_chave;
  if v_nf.access_key is null then
    raise exception 'Nota fiscal não encontrada.' using errcode = 'no_data_found';
  end if;

  -- O par fornecedor↔sacado é a única parte do casamento que não admite
  -- aproximação — nem no automático, nem no clique. Sem esta guarda, a fila de
  -- revisão seria um caminho para cometer à mão o erro que o motor recusa.
  if v_nf.fornecedor_cnpj <> v_ant.fornecedor_cnpj or v_nf.sacado_cnpj <> v_ant.sacado_cnpj then
    raise exception 'A nota é de outro par fornecedor/sacado.' using errcode = '23514';
  end if;

  select valor into v_cfg from public.antecipacao_config where chave = 'conversao';
  v_converte := coalesce(
    v_cfg -> 'status_conversores' ? upper(v_ant.status),
    false
  );

  update public.antecipacoes set
    access_key_casada = v_chave,
    match_status = 'casada',
    match_confianca = 'manual',
    match_motivo = 'manual',
    match_em = now(),
    match_por = v_ator,
    match_observacao = v_motivo,
    match_candidatas = '[]'::jsonb,
    convertida_em = case when v_converte then now() else convertida_em end,
    atualizada_em = now()
  where id_externo = v_id
  returning * into v_ant;

  -- Só um status conversor converte, mesmo no manual: casar uma antecipação
  -- REPROVED é informação legítima (ela existiu), mas não é dinheiro operado.
  if v_converte then
    update public.notas_fiscais set
      estagio_funil = 'convertida',
      estagio_alterado_em = now(),
      estagio_alterado_por = v_ator,
      conversao_antecipacao_id = v_id,
      conversao_em_disputa = false
    where access_key = v_chave
    returning * into v_nf;

    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_nf.fornecedor_empresa_id,
      'nf.convertida',
      jsonb_build_object(
        'titulo', 'Nota ' || coalesce(v_nf.numero, v_nf.access_key) || ' convertida',
        'resumo', coalesce(v_nf.fornecedor_nome, v_nf.fornecedor_cnpj)
                  || ': antecipação #' || v_id || ' vinculada manualmente. Bruto R$ '
                  || to_char(coalesce(v_ant.gross_value, 0), 'FM999G999G990D00') || '.',
        'url', '/antecipacao?nota=' || v_nf.access_key,
        'access_key', v_nf.access_key,
        'antecipacao_id', v_id,
        'origem', 'manual',
        'gross_value', v_ant.gross_value,
        'taxa', v_ant.monthly_interest_rate,
        'faixa', v_nf.faixa,
        'valor', v_nf.valor
      ),
      v_ator
    );

    -- O fornecedor passa a ser recorrência: ele antecipou de fato.
    update public.empresas
      set ultima_antecipacao = greatest(
            coalesce(ultima_antecipacao, '1900-01-01'::date),
            coalesce(v_ant.created_at_plataforma::date, current_date)
          ),
          tipagem_antecipacao = 'recorrencia'
    where id = v_nf.fornecedor_empresa_id;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.casada_manual', 'antecipacoes', v_id::text, p);

  return v_ant;
end; $$;

comment on function app_casar_antecipacao(jsonb) is
  'Fila de revisão: vincula a antecipação a uma NF (ou a ignora com motivo). SECURITY DEFINER porque antecipacoes e notas_fiscais não têm grant de update — o gate é app_tem_modulo, e a conversão + evento + audit saem na mesma transação.';

-- ─── §7 Indicador de conversão (tool de leitura e cabeçalho da tela) ────────

create or replace function antecipacao_status_conversoes(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dias int := coalesce((p ->> 'dias')::int, 30);
  v_desde timestamptz := now() - make_interval(days => v_dias);
begin
  if not public.app_tem_modulo('antecipacao') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  return jsonb_build_object(
    'tem_acesso', true,
    'dias', v_dias,
    'por_status', (
      select coalesce(jsonb_object_agg(match_status, n), '{}'::jsonb)
      from (
        select match_status, count(*) n
        from public.antecipacoes
        where created_at_plataforma >= v_desde
        group by match_status
      ) s
    ),
    'total', (select count(*) from public.antecipacoes where created_at_plataforma >= v_desde),
    'casadas', (select count(*) from public.antecipacoes
                 where created_at_plataforma >= v_desde and match_status = 'casada'),
    'pendentes_revisao', (select count(*) from public.antecipacoes where match_status = 'revisao'),
    'sem_nf_definitivo', (select count(*) from public.antecipacoes
                           where match_status = 'sem_nf' and sem_nf_definitivo_em is not null),
    'em_disputa', (select count(*) from public.notas_fiscais where conversao_em_disputa),
    'convertidas', (select count(*) from public.antecipacoes
                     where convertida_em >= v_desde),
    'valor_convertido', (select coalesce(sum(gross_value), 0) from public.antecipacoes
                          where convertida_em >= v_desde),
    'taxa_media', (select round(avg(monthly_interest_rate)::numeric, 3) from public.antecipacoes
                    where convertida_em >= v_desde and monthly_interest_rate > 0)
  );
end; $$;

comment on function antecipacao_status_conversoes(jsonb) is
  'Taxa de casamento automático, conversões do período e pendências de revisão (04e §7).';

-- ─── §5 Calibração com a carteira real ──────────────────────────────────────
-- Só LÊ. Aplicar é decisão de operador: trocar sozinha a constante que define a
-- receita esperada de todo o funil, em cima de um mês atípico, é o tipo de
-- automação que ninguém pede e todo mundo descobre tarde.

create or replace function antecipacao_calibracao_carteira(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dias int := coalesce((p ->> 'dias')::int, 90);
begin
  if not public.app_tem_modulo('antecipacao') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  return (
    select jsonb_build_object(
      'tem_acesso', true,
      'dias', v_dias,
      'amostras', count(*),
      -- Mediana, não média: uma antecipação de R$ 4 milhões numa carteira de
      -- tickets de R$ 30 mil não deve reescrever o ticket médio de ninguém.
      'taxa_am', percentile_cont(0.5) within group (order by monthly_interest_rate)
                   filter (where monthly_interest_rate > 0),
      'n_taxa', count(*) filter (where monthly_interest_rate > 0),
      'prazo_dias', percentile_cont(0.5) within group (order by anticipation_days)
                      filter (where anticipation_days > 0),
      'n_prazo', count(*) filter (where anticipation_days > 0),
      'valor_medio_nf', percentile_cont(0.5) within group (order by gross_value)
                          filter (where gross_value > 0),
      'n_valor', count(*) filter (where gross_value > 0)
    )
    from public.antecipacoes
    where status = 'CONCLUDED'
      and coalesce(completion_date, created_at_plataforma) >= now() - make_interval(days => v_dias)
  );
end; $$;

comment on function antecipacao_calibracao_carteira(jsonb) is
  'Medianas reais de taxa, prazo e ticket das antecipações concluídas na janela (04e §5). Só lê — aplicar é decisão de operador.';

-- ─── §4.5 Notificações ──────────────────────────────────────────────────────
-- `nf.convertida` passa a ter origem automática e vira o evento mais relevante
-- do módulo para quem trabalha o funil.
--
-- `antecipacao.regrediu` NÃO ganha regra de fan-out: o job notifica Admin e
-- Comercial por notify() (sino + push), e as duas coisas somadas duplicariam o
-- sino. É a mesma convenção dos eventos críticos do Radar. Ver 0078, que fez o
-- `on conflict do nothing` abaixo funcionar de verdade.

insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select 'nf.convertida', p.id, true
from perfis p where p.nome in ('Admin', 'Comercial')
on conflict do nothing;
