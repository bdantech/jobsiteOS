-- ============================================================================
-- 0014 — Mercado: seed (regras v1, módulo no perfil Admin, regras de notificação)
--
-- The three rules are CUMULATIVE by construction: the SAM tree repeats the TAM
-- conditions, and SOM repeats SAM's. They are not "SAM = TAM + extra" at
-- evaluation time — each rule stands alone, and the worker assigns the HIGHEST
-- layer whose rule matches. Rules that depended on each other would mean a row's
-- layer changes depending on evaluation order, and a company could be SOM
-- without being TAM.
--
-- CNAE: division 41 (construção de edifícios) already contains 4110-7
-- (incorporação), so `cnae_grupo ∈ {41,42,43}` covers the spec's "41*, 42*, 43*,
-- 4110-7" without a fourth clause.
-- ============================================================================

-- ─── TAM ────────────────────────────────────────────────────────────────────
-- Ativa, do ramo, com pelo menos 3 anos e meio milhão de capital.
insert into camada_regras (camada, versao, definicao, ativa)
values (
  'tam',
  1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 }
    ]
  }'::jsonb,
  true
)
on conflict (camada, versao) do nothing;

-- ─── SAM ────────────────────────────────────────────────────────────────────
-- TAM + geografia onde operamos + algum sinal de porte real.
insert into camada_regras (camada, versao, definicao, ativa)
values (
  'sam',
  1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 },
      { "variavel": "uf", "operador": "em", "valor": ["SP", "SC", "PR", "RS", "MG", "RJ", "GO", "DF"] },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "qtd_filiais", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 2000000 },
          { "variavel": "grupo_spes_total", "operador": "maior_ou_igual", "valor": 1 }
        ]
      }
    ]
  }'::jsonb,
  true
)
on conflict (camada, versao) do nothing;

-- ─── SOM ────────────────────────────────────────────────────────────────────
-- SAM + pelo menos um sinal de que dá para vender AGORA.
insert into camada_regras (camada, versao, definicao, ativa)
values (
  'som',
  1,
  '{
    "operador": "e",
    "condicoes": [
      { "variavel": "situacao_cadastral", "operador": "igual", "valor": "ativa" },
      { "variavel": "cnae_grupo", "operador": "contem_algum", "valor": ["41", "42", "43"] },
      { "variavel": "idade_anos", "operador": "maior_ou_igual", "valor": 3 },
      { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 500000 },
      { "variavel": "uf", "operador": "em", "valor": ["SP", "SC", "PR", "RS", "MG", "RJ", "GO", "DF"] },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "qtd_filiais", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "capital_social", "operador": "maior_ou_igual", "valor": 2000000 },
          { "variavel": "grupo_spes_total", "operador": "maior_ou_igual", "valor": 1 }
        ]
      },
      {
        "operador": "ou",
        "condicoes": [
          { "variavel": "no_grafo_sefaz", "operador": "igual", "valor": true },
          { "variavel": "erp_conhecido", "operador": "igual", "valor": true },
          { "variavel": "grupo_spes_24m", "operador": "maior_ou_igual", "valor": 2 },
          { "variavel": "obras_ativas", "operador": "maior_ou_igual", "valor": 1 },
          { "variavel": "churn_erp_concorrente", "operador": "igual", "valor": true }
        ]
      }
    ]
  }'::jsonb,
  true
)
on conflict (camada, versao) do nothing;

-- ─── O módulo precisa existir no perfil Admin ───────────────────────────────
-- Without this, the module is invisible: the sidebar renders grantedModules(),
-- RLS answers app_tem_modulo('mercado') with false, and the AI is offered none
-- of its tools. Every Mercado screen would 403 for everyone, including admins.
insert into perfil_modulos (perfil_id, modulo_id)
select p.id, 'mercado'
from perfis p
where p.nome = 'Admin'
on conflict (perfil_id, modulo_id) do nothing;

-- ─── Regras de notificação (§6) ─────────────────────────────────────────────
-- A failed Receita ingestion is silent otherwise: the run is monthly, so nobody
-- would find out until the pyramid numbers were a month stale.
insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select 'mercado.ingestao_falhou', p.id, true
from perfis p
where p.nome = 'Admin'
  and not exists (
    select 1 from notificacao_regras r
    where r.tipo_evento = 'mercado.ingestao_falhou' and r.perfil_id = p.id
  );

insert into notificacao_regras (tipo_evento, perfil_id, ativo)
select 'mercado.ingestao_concluida', p.id, true
from perfis p
where p.nome = 'Admin'
  and not exists (
    select 1 from notificacao_regras r
    where r.tipo_evento = 'mercado.ingestao_concluida' and r.perfil_id = p.id
  );

-- `importacao.revisao_pendente` targets the CREATOR of the import, not a perfil
-- (§6). That rule is per-user, so it is written by the importer at upload time,
-- when the creator is known — not seeded here.

-- ─── O fan-out precisa saber lidar com eventos SEM empresa ──────────────────
-- Mercado introduces the first system-level events: an ingestion run has no
-- empresa_id. The 0003 trigger builds its title as
--   coalesce(nome_fantasia, razao_social, cnpj) || ' — ' || tipo
-- which for a null empresa renders the literal string "Empresa —
-- mercado.ingestao_falhou". Correct, and useless to the person reading the bell.
--
-- Now: an event may carry `payload.titulo`, and if it does, that wins. Company
-- events are untouched — they don't set it, so they keep the old title.
create or replace function fanout_evento_para_notificacoes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa_nome text;
  v_titulo text;
begin
  select coalesce(e.nome_fantasia, e.razao_social, e.cnpj)
    into v_empresa_nome
  from public.empresas e
  where e.id = new.empresa_id;

  v_titulo := coalesce(
    new.payload ->> 'titulo',                                    -- system events say it outright
    coalesce(v_empresa_nome, 'Empresa') || ' — ' || new.tipo     -- company events, as before
  );

  insert into public.notificacoes (usuario_id, titulo, corpo, url)
  select
    destinatario.id,
    v_titulo,
    new.payload ->> 'resumo',
    coalesce(
      new.payload ->> 'url',                                     -- system events point at their own page
      case when new.empresa_id is not null
           then '/empresas/' || new.empresa_id::text
           else null
      end
    )
  from (
    select u.id
    from public.notificacao_regras r
    join public.usuarios u on u.perfil_id = r.perfil_id
    where r.ativo
      and r.tipo_evento = new.tipo
      and r.perfil_id is not null
      and u.ativo
    union
    select u.id
    from public.notificacao_regras r
    join public.usuarios u on u.id = r.usuario_id
    where r.ativo
      and r.tipo_evento = new.tipo
      and r.usuario_id is not null
      and u.ativo
  ) as destinatario
  where new.ator_usuario_id is null
     or destinatario.id <> new.ator_usuario_id;

  return new;
end;
$$;

revoke execute on function fanout_evento_para_notificacoes() from public, anon, authenticated;
