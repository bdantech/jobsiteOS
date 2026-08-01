-- 0075 — O perfil Crédito precisa do módulo `empresas` para o módulo Crédito funcionar.
--
-- A migração 0073 concedeu `credito` a Admin e a Crédito, e parou aí. Só que quase tudo
-- que as telas de Crédito mostram vem de `empresas`, cuja RLS exige
-- `app_tem_modulo('empresas')`:
--
--   * a esteira faz embed de `empresas(razao_social)` — sem o módulo, os nomes voltavam
--     NULOS e a lista aparecia só com CNPJs;
--   * `/empresas/<id>` era inalcançável, então o botão "Solicitar análise" da Company 360
--     ficava fora do alcance justamente do time que solicita;
--   * `contatos` (mesma policy) some junto, e é onde está o ponto focal.
--
-- Conceder um módulo é decisão de negócio, não de esquema — esta linha foi autorizada
-- explicitamente. O efeito é que Crédito passa a enxergar a base de empresas inteira.
--
-- NÃO concede `mercado`, e isso tem consequência: a prévia de impacto do editor de
-- scorecard lê `mercado_explorador`, que exige aquele módulo. Sem ele a prévia fica sem
-- amostra — e a tela agora DIZ isso, em vez de mostrar "sem amostra" como se a base
-- estivesse vazia.

insert into public.perfil_modulos (perfil_id, modulo_id)
select p.id, 'empresas' from public.perfis p where p.nome = 'Crédito'
on conflict do nothing;
