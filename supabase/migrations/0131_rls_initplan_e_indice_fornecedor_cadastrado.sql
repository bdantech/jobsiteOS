-- =============================================================================
-- 0131 — A tela de fornecedores a prospectar parava de carregar (timeout)
--
-- SINTOMA: `/antecipacao/prospectar-fornecedores` ficava no skeleton e caía no
-- estado de erro. O papel `authenticated` tem `statement_timeout = 8s` no
-- Supabase, e a consulta da tela batia nele.
--
-- A MEDIÇÃO, como o usuário Comercial (perfil `antecipacao`+`comercial`+`empresas`,
-- SEM `mercado`), uma página de 1.000 linhas:
--
--     antes:  5.167 ms   553.391 buffers
--     depois:   460 ms   111.022 buffers
--
-- Como a tela pagina em três requisições de 1.000 (a lista tem 2.095 linhas), o
-- custo real era ~15,5 s de banco por carregamento — com 8 s de teto por
-- requisição, cada página era uma moeda no ar.
--
-- A CAUSA NÃO É A VIEW. É a RLS, em dois pontos:
--
-- 1) `app_tem_modulo()` é STABLE, mas STABLE **não** quer dizer "avaliada uma vez".
--    Chamada direta dentro de um `using`, ela roda POR LINHA VARRIDA. Cada chamada
--    é um join `usuarios × perfil_modulos`: 2 buffers. Sobre as 44.547 linhas de
--    `notas_fiscais` isso vira ~90.000 buffers só para responder uma pergunta cuja
--    resposta é a mesma o tempo todo — "esta pessoa tem o módulo?".
--
--    Envelopar em `(select ...)` transforma a chamada num InitPlan: o planejador
--    avalia UMA vez e reusa o booleano. O resultado é idêntico por definição —
--    a função é STABLE, ou seja, constante dentro da consulta. É a mesma correção
--    que o performance advisor do Supabase aponta como `auth_rls_initplan`.
--
--    Só isso levou 5.167 ms → 752 ms.
--
-- 2) O `EXISTS` da policy de `mercado_universo` tinha um OR DENTRO do predicado:
--    `where nf.fornecedor_cnpj = cnpj or nf.sacado_cnpj = cnpj`. Um OR entre duas
--    colunas obriga BitmapOr + recheck no heap — 7.041 blocos de heap por varredura,
--    e a view toca `mercado_universo` duas vezes. Partido em dois `EXISTS` ligados
--    por OR, cada lado vira Index Only Scan e o segundo nem chega a executar quando
--    o primeiro já achou (curto-circuito). Logicamente é a mesma coisa:
--    `exists(A or B)` ≡ `exists(A) or exists(B)`.
--
-- O ÍNDICE PARCIAL fecha o terceiro ponto, que é da view e não da RLS: o
-- `not exists (... n2 where n2.fornecedor_cadastrado)` de 0104 varria ~18 entradas
-- de `notas_fiscais_fornecedor_faixa_idx` mais heap para cada um dos 7.959
-- fornecedores — 155.756 buffers, mais da metade do total. Com um índice parcial
-- sobre quem É cadastrado, o planejador troca o anti-join aninhado por um Merge
-- Anti Join alimentado por Index Only Scan: 15 buffers.
--
-- ESCOPO: as quatro policies do caminho desta tela. O padrão do item (1) existe em
-- 84 das 109 policies do schema — a correção vale para todas, e as outras 80 ficam
-- para uma migração própria, com medição por tela.
-- =============================================================================

-- ─── (1) As chamadas viram InitPlan ─────────────────────────────────────────

alter policy notas_fiscais_select on public.notas_fiscais
  using ((select public.app_tem_modulo('antecipacao')));

alter policy empresas_select on public.empresas
  using ((select public.app_tem_modulo('empresas')));

alter policy antecipacao_fornecedor_sem_interesse_select
  on public.antecipacao_fornecedor_sem_interesse
  using ((select public.app_tem_modulo('antecipacao')));

-- ─── (1) + (2) juntos, na policy que pagava as duas contas ──────────────────
--
-- Regra inalterada: quem tem `mercado` vê tudo; quem tem `antecipacao` vê o CNPJ
-- que aparece em alguma nota que ele pode ler (dos dois lados, sacado ou
-- fornecedor); quem tem `empresas` vê o CNPJ que já tem ficha.

alter policy mercado_universo_select on public.mercado_universo
  using (
    (select public.app_tem_modulo('mercado'))
    or (
      (select public.app_tem_modulo('antecipacao'))
      and (
        exists (select 1 from public.notas_fiscais nf where nf.fornecedor_cnpj = mercado_universo.cnpj)
        or exists (select 1 from public.notas_fiscais nf where nf.sacado_cnpj = mercado_universo.cnpj)
      )
    )
    or (
      (select public.app_tem_modulo('empresas'))
      and exists (select 1 from public.empresas e where e.cnpj = mercado_universo.cnpj)
    )
  );

-- ─── (3) O anti-join de "já está cadastrado" ────────────────────────────────
--
-- Parcial de propósito: só ~7.200 das 44.547 notas têm `fornecedor_cadastrado`, e
-- a pergunta da view é sempre sobre essas. O índice cheio custaria 6x o tamanho
-- para responder o mesmo.

create index if not exists notas_fiscais_fornecedor_cadastrado_idx
  on public.notas_fiscais (fornecedor_cnpj)
  where fornecedor_cadastrado;

comment on index public.notas_fiscais_fornecedor_cadastrado_idx is
  'Alimenta o `not exists` de antecipacao_fornecedores_a_prospectar (0104), que '
  'elimina da lista o fornecedor que já está na plataforma. Parcial porque a '
  'pergunta só existe para quem é cadastrado.';
