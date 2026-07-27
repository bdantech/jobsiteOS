-- 0044 — Backfill da contagem de protestos das consultas NACIONAIS (DirectD ProtestosOnline).
-- O parser antigo achava valorTotalProtestos no topo (valor vinha certo) mas não a contagem
-- (chave diferente do SP) e o fallback só rodava quando valor E qtd eram 0 — então qtd ficava 0.
-- O worker foi corrigido (fallback por campo + somarCartorios entende as duas estruturas);
-- aqui recomputamos qtd (e valor, se estava 0) das linhas já gravadas, a partir dos cartórios.
-- Estruturas: SP usa estado.cartoriosProtesto[]/numProtestos; Nacional usa estado.cartorios[]/
-- numeroProtestos. Valor pode vir "R$ 1.234,56" (Nacional) ou "1.234,56" (SP).
with somas as (
  select pc.id,
    sum(coalesce((cart->>'numeroProtestos')::int, (cart->>'numProtestos')::int, 0)) as qtd,
    sum(
      case when cart->>'valorTotalProtestosCartorio' is not null
        then coalesce(nullif(replace(regexp_replace(cart->>'valorTotalProtestosCartorio','[^0-9,]','','g'),',','.'),'')::numeric, 0)
        else 0 end
    ) as valor
  from public.protestos_consultas pc,
    lateral jsonb_array_elements(pc.cartorios) est,
    lateral jsonb_array_elements(
      case when jsonb_typeof(coalesce(est->'cartoriosProtesto', est->'cartorios')) = 'array'
        then coalesce(est->'cartoriosProtesto', est->'cartorios')
        else '[]'::jsonb end
    ) cart
  where jsonb_typeof(pc.cartorios) = 'array'
    and pc.tem_protesto and coalesce(pc.qtd_protestos, 0) = 0
  group by pc.id
)
update public.protestos_consultas pc
set qtd_protestos = s.qtd,
    valor_total = case when coalesce(pc.valor_total, 0) = 0 then s.valor else pc.valor_total end
from somas s where s.id = pc.id;
