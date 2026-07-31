-- 0072 — Empresas criadas fora do Mercado ficavam sem grupo, camada e SPE.
--
-- `empresas.grupo_id`, `camada`, `is_spe` e `grafo_sefaz` são cópias denormalizadas do
-- `mercado_universo`. A promoção do Mercado (promover.ts / app_promover_fornecedor) copia
-- as quatro. Os dois caminhos que nasceram DEPOIS — o sync de NFs da Antecipação e o sync
-- de clientes Onepay — copiam só a identidade da Receita (razão, UF, município, CNAE,
-- porte) e deixam as derivadas em branco.
--
-- Efeito visível: a aba "Grupo econômico" da ficha só aparece quando `grupo_id` existe.
-- Nas 309 empresas criadas por esses dois caminhos ela NUNCA apareceu — o universo sabia
-- o grupo, a empresa não. E `camada` nula tira a empresa da leitura de pirâmide, e
-- `is_spe` falso a esconde da análise financeira do grupo.
--
-- Medido antes desta migração (8.377 empresas):
--   antecipacao — 117 no universo: 30 sem o grupo, 117 sem a camada, 23 sem is_spe
--   onepay      —  22 no universo: 17 sem o grupo,  22 sem a camada
--   lista       — 5.817 no universo: nenhuma perda (a promoção do Mercado copia tudo)
--
-- Os inserts foram corrigidos no mesmo commit; isto repara o que já está gravado.
-- `coalesce` e `or` de propósito: nada que a empresa já tenha é sobrescrito — uma camada
-- posta à mão continua valendo, e a reparação pode rodar de novo sem efeito.

update public.empresas e
set camada      = coalesce(e.camada, u.camada),
    grupo_id    = coalesce(e.grupo_id, u.grupo_id),
    is_spe      = e.is_spe or u.is_spe,
    grafo_sefaz = e.grafo_sefaz or u.grafo_sefaz
from public.mercado_universo u
where u.cnpj = e.cnpj
  -- Só as linhas que realmente ganham algo: sem isto o update reescreveria milhares de
  -- linhas com os mesmos valores e sujaria o mapa de visibilidade de `empresas` à toa.
  and ((e.camada is null and u.camada is not null)
       or (e.grupo_id is null and u.grupo_id is not null)
       or (u.is_spe and not e.is_spe)
       or (u.grafo_sefaz and not e.grafo_sefaz));

-- O elo inverso: o Explorador só chega à ficha por `mercado_universo.empresa_id`. Sem
-- ele, a empresa existe e o universo continua oferecendo "promover" a quem já foi
-- promovido. São 3 linhas hoje, mas é o mesmo descuido dos inserts.
update public.mercado_universo u
set empresa_id = e.id
from public.empresas e
where e.cnpj = u.cnpj and u.empresa_id is null;
