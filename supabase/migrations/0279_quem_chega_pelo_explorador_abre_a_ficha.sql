-- ─────────────────────────────────────────────────────────────────────────────
-- 0279 — Quem chega pelo Explorador abre a ficha
--
-- A 0188 recortou a leitura de `empresas` e `contatos` do SDR ao funil e à carteira
-- dele. Depois disso o perfil SDR ganhou `mercado` (em runtime), e o Explorador lista
-- o universo inteiro por um RPC SECURITY DEFINER — com o `empresa_id` de cada linha
-- já promovida. O SDR clicava, caía em /empresas/<id> e lia "Empresa não encontrada":
-- a lista mostrava a empresa, e a ficha negava que ela existisse.
--
-- A régua passa a ser a do alcance: quem tem `mercado` já enxerga todas as empresas
-- pelo Explorador, então lê a ficha e os contatos dela. Escrita não muda — editar
-- contato continua restrito ao funil e à carteira (`contatos_write` fica como está),
-- e a ficha segue só-leitura para vendedor (`app_vendedor_restrito`).
--
-- O ramo novo é um InitPlan como os outros: `app_tem_modulo` roda uma vez por
-- consulta, não por linha.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
for select using (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or (select public.app_tem_modulo('mercado'))
    or id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);

drop policy if exists contatos_select on public.contatos;
create policy contatos_select on public.contatos
for select using (
  (select public.app_tem_modulo('empresas'))
  and (
    (select not public.app_sdr_restrito())
    or (select public.app_tem_modulo('mercado'))
    or empresa_id = any (coalesce((select public.app_empresas_do_meu_funil()), '{}'::uuid[]))
    or empresa_id = any (coalesce((select public.app_carteira_empresas()), '{}'::uuid[]))
  )
);
