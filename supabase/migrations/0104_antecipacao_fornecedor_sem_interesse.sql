-- =============================================================================
-- 0104 — Antecipação: fornecedor "sem interesse em se cadastrar"
--
-- A lista de fornecedores a prospectar (0101/0102) é trabalhada por telefone, e o
-- resultado mais comum de uma ligação NÃO é "quero antecipar": é "não uso
-- antecipação", "já opero com outro", "não quero me cadastrar". Sem um lugar para
-- guardar essa resposta, a lista devolve o mesmo CNPJ para a próxima pessoa na
-- semana seguinte — e o custo do lead descartado é pago de novo, indefinidamente.
--
-- POR QUE UMA TABELA NOVA, E NÃO `supressao`.
-- `supressao` já existe e já carrega um "sem interesse" (0045 + app_marcar_sem_interesse):
-- aquele é supressão de CANAL — não tocar este CNPJ por e-mail, telefone ou WhatsApp,
-- com validade e com os dois motivos de gravidade LGPD ('solicitacao_lgpd',
-- 'nao_abordar'). É uma lista que o Radar inteiro consulta antes de qualquer disparo,
-- e que não se desfaz por engano.
--
-- O que esta tabela guarda é outra coisa: o RESULTADO DA QUALIFICAÇÃO de um lead de
-- prospecção — "este fornecedor não vai virar cliente, e este é o motivo". É
-- reversível por um clique (a pessoa muda de ideia, ou quem atendeu o telefone não
-- era quem decide), tem vocabulário próprio de motivo (comercial, não jurídico) e
-- não bloqueia canal nenhum. Enfiar isso em `supressao` significaria ou alargar o
-- CHECK de motivo com valores comerciais, ou perder o motivo dentro de `observacao`
-- — e, pior, faria "não usa antecipação" e "pediu remoção por LGPD" morarem na mesma
-- linha, com o mesmo peso, desfeitas pelo mesmo botão.
--
-- POR QUE AS NOTAS SAEM DO FUNIL.
-- O funil de NFs e a lista de prospecção olham para o mesmo fornecedor por ângulos
-- diferentes: lá é a nota, aqui é o CNPJ. Marcar o CNPJ e continuar vendo as notas
-- dele no Kanban seria pedir que a mesma decisão fosse tomada nota a nota, todo dia.
-- Por isso `notas_funil` ganha a coluna e as duas telas de funil (a do gestor e a do
-- vendedor) filtram por ela.
-- =============================================================================

-- ─── A marcação ─────────────────────────────────────────────────────────────

create table public.antecipacao_fornecedor_sem_interesse (
  -- O CNPJ é a chave, e não `empresa_id`: fornecedor de aquisição não existe em
  -- `empresas` (é essa a definição dele), e exigir a promoção antes de poder
  -- descartar inverteria a ordem — promove-se quem interessa.
  cnpj text primary key
    constraint antecipacao_fornecedor_sem_interesse_cnpj_check check (cnpj ~ '^[0-9]{14}$'),

  -- Cópia do nome no momento da marcação. A lista de descartados precisa continuar
  -- legível quando o fornecedor sair da janela de 90 dias e não houver mais nota
  -- nenhuma de onde tirar um nome.
  fornecedor_nome text,

  motivo text not null
    constraint antecipacao_fornecedor_sem_interesse_motivo_check check (motivo in (
      'nao_utiliza_antecipacao',  -- não antecipa recebível, por política ou por não precisar
      'ja_opera_com_outro',       -- já tem banco/fintech fazendo isso
      'caixa_confortavel',        -- não precisa de antecipação hoje
      'nao_quer_plataforma',      -- antecipa, mas não quer se cadastrar aqui
      'sem_contato',              -- não conseguimos falar com quem decide
      'porte_incompativel',       -- porte ou perfil fora do que a operação atende
      'outro'                     -- exige observação
    )),

  -- Obrigatória quando o motivo é 'outro' (validado no RPC): um descarte sem
  -- explicação é indistinguível de um clique errado.
  observacao text,

  marcado_por uuid references public.usuarios (id) on delete set null,
  marcado_em timestamptz not null default now()
);

comment on table public.antecipacao_fornecedor_sem_interesse is
  'Fornecedores da lista de prospecção que já foram trabalhados e NÃO vão se '
  'cadastrar, com o motivo. Some da lista a prospectar e tira as notas dele dos '
  'funis. Não é `supressao`: aqui é qualificação comercial reversível, lá é bloqueio '
  'de canal com peso de LGPD.';

comment on column public.antecipacao_fornecedor_sem_interesse.fornecedor_nome is
  'Nome no momento da marcação. É o que mantém a lista de descartados legível depois '
  'que o fornecedor sai da janela de 90 dias e não há mais nota de onde tirar o nome.';

create index antecipacao_fornecedor_sem_interesse_marcado_em_idx
  on public.antecipacao_fornecedor_sem_interesse (marcado_em desc);

alter table public.antecipacao_fornecedor_sem_interesse enable row level security;

-- Leitura para quem tem o módulo. A escrita passa pelos RPCs abaixo (SECURITY
-- DEFINER, com audit_log), pelo mesmo motivo das outras mutações do módulo: um
-- descarte é uma decisão comercial, e decisão sem rastro não se audita.
create policy antecipacao_fornecedor_sem_interesse_select
  on public.antecipacao_fornecedor_sem_interesse
  for select to authenticated
  using (public.app_tem_modulo('antecipacao'));

grant select on public.antecipacao_fornecedor_sem_interesse to authenticated;

-- ─── Marcar ─────────────────────────────────────────────────────────────────

create or replace function public.app_marcar_fornecedor_sem_interesse(p jsonb)
returns public.antecipacao_fornecedor_sem_interesse
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.antecipacao_fornecedor_sem_interesse;
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj';
  v_motivo text := p ->> 'motivo';
  v_obs text := nullif(btrim(coalesce(p ->> 'observacao', '')), '');
  v_nome text := nullif(btrim(coalesce(p ->> 'fornecedor_nome', '')), '');
  v_empresa uuid;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo.' using errcode = '23514';
  end if;
  -- 'outro' sem texto é o mesmo que nenhum motivo: a lista de descartados existe
  -- para ser lida por quem não fez a ligação.
  if v_motivo = 'outro' and v_obs is null then
    raise exception 'Descreva o motivo em "outro".' using errcode = '23514';
  end if;

  -- O nome vem da tela quando ela o tem; senão, do cadastro ou da última nota.
  if v_nome is null then
    select coalesce(mu.razao_social, nf.fornecedor_nome) into v_nome
      from public.notas_fiscais nf
      left join public.mercado_universo mu on mu.cnpj = nf.fornecedor_cnpj
     where nf.fornecedor_cnpj = v_cnpj
     order by nf.emitida_em desc nulls last
     limit 1;
  end if;

  insert into public.antecipacao_fornecedor_sem_interesse
    (cnpj, fornecedor_nome, motivo, observacao, marcado_por)
  values (v_cnpj, v_nome, v_motivo, v_obs, v_ator)
  on conflict (cnpj) do update
    set motivo = excluded.motivo,
        observacao = excluded.observacao,
        fornecedor_nome = coalesce(excluded.fornecedor_nome, public.antecipacao_fornecedor_sem_interesse.fornecedor_nome),
        marcado_por = excluded.marcado_por,
        marcado_em = now()
  returning * into v_row;

  select id into v_empresa from public.empresas where cnpj = v_cnpj;

  -- Timeline só existe para quem tem ficha; o audit_log registra sempre.
  if v_empresa is not null then
    insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
    values (
      v_empresa, 'fornecedor.sem_interesse',
      jsonb_build_object(
        'titulo', 'Sem interesse em se cadastrar',
        'resumo', coalesce(v_nome, v_cnpj) || ' marcado como sem interesse em se cadastrar: '
                  || v_motivo || coalesce(' — ' || v_obs, ''),
        'url', '/antecipacao/prospectar-fornecedores/sem-interesse',
        'cnpj', v_cnpj,
        'motivo', v_motivo
      ),
      v_ator
    );
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.fornecedor_sem_interesse', 'antecipacao_fornecedor_sem_interesse', v_cnpj, p);

  return v_row;
end; $$;

comment on function public.app_marcar_fornecedor_sem_interesse(jsonb) is
  'Marca um fornecedor da prospecção como sem interesse em se cadastrar, com motivo. '
  'Tira o CNPJ da lista a prospectar e as notas dele dos funis. Reversível por '
  'app_reverter_fornecedor_sem_interesse.';

revoke all on function public.app_marcar_fornecedor_sem_interesse(jsonb) from public;
grant execute on function public.app_marcar_fornecedor_sem_interesse(jsonb) to authenticated;

-- ─── Reverter ───────────────────────────────────────────────────────────────

create or replace function public.app_reverter_fornecedor_sem_interesse(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'cnpj';
  v_apagou int;
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;
  if v_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  delete from public.antecipacao_fornecedor_sem_interesse where cnpj = v_cnpj;
  get diagnostics v_apagou = row_count;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.fornecedor_sem_interesse_revertido',
          'antecipacao_fornecedor_sem_interesse', v_cnpj, p);

  return v_apagou > 0;
end; $$;

comment on function public.app_reverter_fornecedor_sem_interesse(jsonb) is
  'Desfaz a marcação: o fornecedor volta para a lista a prospectar e as notas dele '
  'voltam aos funis.';

revoke all on function public.app_reverter_fornecedor_sem_interesse(jsonb) from public;
grant execute on function public.app_reverter_fornecedor_sem_interesse(jsonb) to authenticated;

-- ─── notas_funil ganha a coluna ─────────────────────────────────────────────
--
-- `create or replace` com a coluna nova NO FIM: é a única forma de estender a view
-- sem derrubar as sete que dependem dela (antecipacao_fornecedores,
-- antecipacao_sacados, as duas de prospecção, ...). O corpo abaixo é o da view em
-- produção (0095/0099/0100) com o join e a coluna acrescentados.

create or replace view public.notas_funil
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
    nf.conversao_antecipacao_id,
    nf.conversao_em_disputa,
    ant.gross_value AS conversao_valor,
    ant.monthly_interest_rate AS conversao_taxa,
    ant.status AS conversao_status,
    nf.vendedor_id,
    nf.vendedor_origem,
    se.gestao_operacao AS sacado_gestao_operacao,
    -- A coluna nova. Nunca nula: é a existência da linha, não um valor dela.
    fsi.cnpj IS NOT NULL AS fornecedor_sem_interesse
   FROM notas_fiscais nf
     LEFT JOIN empresas fe ON fe.id = nf.fornecedor_empresa_id
     LEFT JOIN empresas se ON se.id = nf.sacado_empresa_id
     LEFT JOIN mercado_universo fu ON fu.cnpj = nf.fornecedor_cnpj
     LEFT JOIN mercado_universo su ON su.cnpj = nf.sacado_cnpj
     LEFT JOIN protestos_atual fpa ON fpa.cnpj = nf.fornecedor_cnpj
     LEFT JOIN clientes_onepay fco ON fco.cnpj = nf.fornecedor_cnpj
     LEFT JOIN supressao fsup ON fsup.escopo = 'empresa'::text AND fsup.valor = nf.fornecedor_cnpj AND (fsup.expira_em IS NULL OR fsup.expira_em >= CURRENT_DATE)
     LEFT JOIN antecipacao_fornecedor_sem_interesse fsi ON fsi.cnpj = nf.fornecedor_cnpj
     LEFT JOIN antecipacoes ant ON ant.id_externo = nf.conversao_antecipacao_id
     LEFT JOIN LATERAL ( SELECT max(n2.numero::bigint) AS ultimo_numero_nf
           FROM notas_fiscais n2
          WHERE n2.fornecedor_cnpj = nf.fornecedor_cnpj AND n2.tipo = 'NFe'::text AND n2.numero ~ '^[0-9]{1,9}$'::text) fnf ON true;

comment on column public.notas_funil.fornecedor_sem_interesse is
  'O fornecedor já foi trabalhado e disse que não vai se cadastrar. As duas telas de '
  'funil (gestor e vendedor) filtram por esta coluna.';

-- ─── A lista a prospectar perde os descartados ──────────────────────────────
--
-- O filtro mora na VIEW, não na tela: são duas telas (web e o que vier) lendo a
-- mesma lista, e um descarte que só a web respeita não é um descarte.

create or replace view public.antecipacao_fornecedores_a_prospectar
with (security_invoker = true) as
 SELECT f.fornecedor_cnpj,
    max(COALESCE(fu.razao_social, f.fornecedor_nome)) AS fornecedor_nome,
    (array_agg(f.fornecedor_empresa_id) FILTER (WHERE f.fornecedor_empresa_id IS NOT NULL))[1] AS fornecedor_empresa_id,
    max(f.fornecedor_uf) AS fornecedor_uf,
    max(fu.municipio) AS fornecedor_municipio,
    max(fu.cnae_principal) AS fornecedor_cnae_principal,
    max(fu.situacao_cadastral) AS fornecedor_situacao_cadastral,
    count(*)::integer AS notas,
    count(*) FILTER (WHERE f.operavel)::integer AS notas_operaveis,
    count(DISTINCT f.sacado_cnpj)::integer AS sacados,
    sum(f.valor) AS valor_agregado,
    max(f.emitida_em) AS ultima_nota_em,
    min(f.emitida_em) AS primeira_nota_em
   FROM notas_funil f
     JOIN antecipacao_sacados_com_credito cc ON cc.cnpj = f.sacado_cnpj
     LEFT JOIN mercado_universo fu ON fu.cnpj = f.fornecedor_cnpj
  WHERE f.emitida_em >= (now() - '90 days'::interval)
    AND NOT f.fornecedor_sem_interesse
    AND NOT (EXISTS ( SELECT 1
           FROM notas_fiscais n2
          WHERE n2.fornecedor_cnpj = f.fornecedor_cnpj AND n2.fornecedor_cadastrado))
  GROUP BY f.fornecedor_cnpj;

-- ─── A lista dos descartados ────────────────────────────────────────────────
--
-- Parte da TABELA, não da janela de 90 dias: quem foi descartado há quatro meses
-- precisa continuar visível, com nome e motivo, mesmo sem nota nenhuma no período —
-- senão a lista esvazia sozinha e o mesmo CNPJ volta a ser prospectado.
-- As métricas de nota vêm por lateral, e são as da MESMA janela da lista a
-- prospectar, para que "12 notas" queira dizer a mesma coisa nas duas telas.

create view public.antecipacao_fornecedores_sem_interesse
with (security_invoker = true) as
  select
    si.cnpj as fornecedor_cnpj,
    coalesce(mu.razao_social, si.fornecedor_nome) as fornecedor_nome,
    si.motivo,
    si.observacao,
    si.marcado_em,
    si.marcado_por,
    u.nome as marcado_por_nome,
    e.id as fornecedor_empresa_id,
    coalesce(mu.uf, n.fornecedor_uf) as fornecedor_uf,
    mu.municipio as fornecedor_municipio,
    mu.cnae_principal as fornecedor_cnae_principal,
    coalesce(n.notas, 0) as notas,
    coalesce(n.valor_agregado, 0) as valor_agregado,
    n.ultima_nota_em
  from public.antecipacao_fornecedor_sem_interesse si
    left join public.mercado_universo mu on mu.cnpj = si.cnpj
    left join public.usuarios u on u.id = si.marcado_por
    left join public.empresas e on e.cnpj = si.cnpj
    left join lateral (
      select
        count(*)::int as notas,
        sum(nf.valor) as valor_agregado,
        max(nf.emitida_em) as ultima_nota_em,
        max(nf.fornecedor_uf) as fornecedor_uf
      from public.notas_funil nf
      where nf.fornecedor_cnpj = si.cnpj
        and nf.emitida_em >= (now() - interval '90 days')
    ) n on true;

grant select on public.antecipacao_fornecedores_sem_interesse to authenticated;

comment on view public.antecipacao_fornecedores_sem_interesse is
  'Os fornecedores tirados da lista a prospectar, com o motivo e quem marcou. A '
  'origem é a tabela de marcação, não a janela de 90 dias — o descarte não expira '
  'sozinho, só o botão de reverter o desfaz.';
