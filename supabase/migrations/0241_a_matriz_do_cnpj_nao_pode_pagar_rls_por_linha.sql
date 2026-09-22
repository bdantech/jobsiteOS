-- 0241 — `app__matriz_do_cnpj` não pode pagar RLS por linha
--
-- ─── O SINTOMA ─────────────────────────────────────────────────────────────
-- As colunas GRANDES do funil (A prospectar, Em prospecção, Encerradas) voltavam
-- "Erro ao carregar". As pequenas — 3 e 14 cards — funcionavam perfeitamente.
-- Sintoma clássico de custo POR LINHA: o que é barato em três linhas estoura o
-- statement timeout em quarenta mil.
--
-- ─── A MEDIÇÃO QUE IMPORTAVA, E QUE EU NÃO TINHA FEITO ─────────────────────
-- Contando `a_prospectar` com a RLS LIGADA:
--
--     notas_funil ................    72 ms
--     funil_oportunidades_nf ..... 3.741 ms
--
-- E 2.000 chamadas isoladas de `app__matriz_do_cnpj` estouram o timeout sozinhas.
--
-- As medições anteriores foram feitas como SUPERUSUÁRIO, onde não há RLS: 48 ms.
-- Elas diziam que estava tudo bem e estavam medindo outro banco, na prática.
--
-- ─── A CAUSA ───────────────────────────────────────────────────────────────
-- A função nasceu SECURITY INVOKER e lê `mercado_universo`. Com isso, CADA
-- chamada — uma por linha do funil — reavalia a política de RLS daquela tabela
-- por dentro. Para quem tem `antecipacao` e não tem `mercado`, essa política não
-- é um teste barato: é o recorte "só os CNPJs que aparecem em alguma nota".
--
-- ─── POR QUE SECURITY DEFINER AQUI É CORRETO ───────────────────────────────
-- A função responde uma coisa só: "qual é a matriz desta raiz de CNPJ". Devolve
-- catorze dígitos derivados dos catorze que o chamador JÁ TEM na mão — o CNPJ do
-- sacado está na nota que ele está olhando. Não devolve razão social, capital nem
-- situação cadastral. É dado público da Receita e não amplia o que ninguém vê.
--
-- É a mesma decisão, pelo mesmo motivo, de `app_holding_do_sacado` e
-- `app__limite_da_analise`: uma resolução de identidade chamada por linha não pode
-- carregar a RLS de uma tabela inteira nas costas.
--
-- Depois: contagem da maior coluna (40.614 linhas) em 192 ms, página em 21 ms.
create or replace function public.app__matriz_do_cnpj(p_cnpj text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    -- Filial `0001` já É a matriz. O atalho evita a busca em 99% dos casos.
    when p_cnpj is null or substr(p_cnpj, 9, 4) = '0001' then p_cnpj
    else coalesce(
      (select u.cnpj
         from public.mercado_universo u
        where left(u.cnpj, 8) = left(p_cnpj, 8)
          and substr(u.cnpj, 9, 4) = '0001'
        limit 1),
      p_cnpj)
  end
$$;

comment on function public.app__matriz_do_cnpj(text) is
  'A matriz do CNPJ pela raiz. SECURITY DEFINER de propósito: é chamada UMA VEZ POR '
  'LINHA do funil, e como INVOKER cada chamada pagava a RLS de mercado_universo por '
  'dentro — 72 ms viravam 3.741 ms e as colunas grandes estouravam o timeout.';

-- O grant continua fechado: `authenticated` e `service_role`, nunca `anon`.
revoke execute on function public.app__matriz_do_cnpj(text) from public, anon;
grant execute on function public.app__matriz_do_cnpj(text) to authenticated, service_role;
