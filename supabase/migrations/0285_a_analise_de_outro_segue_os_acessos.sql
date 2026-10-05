-- ─────────────────────────────────────────────────────────────────────────────
-- 0285 — A análise de outro vendedor segue os acessos que já existem
--
-- A 0283 fechou a análise no "próprio vendedor e gestores". A régua da casa para ver o
-- trabalho de outra pessoa já existe e é outra: `app_pode_ver_vendedor` — o gestor vê
-- todos; os demais veem a si, quem estiver MARCADO para eles em `vendedor_acessos`, e o
-- auxiliar vê o closer a que responde (0189). É a mesma regra de carteira, funil e
-- agenda, e a análise passa a segui-la em vez de inventar uma terceira.
--
-- Muda só QUEM pode ler. Continua igual: análise em sombra é só de gestor (nenhuma nota
-- antes da calibração), contestar é só de quem foi avaliado, e o agregado, a calibração
-- e as rubricas seguem da gestão.
--
-- Uma função só muda, e com ela tudo que a usa: a RLS de `analises`, `analise_itens` e
-- `qualidade_pendencias`, e as RPCs de detalhe, selo, feedback e captura.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.app__qualidade_ve_analise(p_vendedor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.app_gestor_comercial()
      or (p_vendedor_id is not null and public.app_pode_ver_vendedor(p_vendedor_id))
$$;
