-- 0176 — A filial do cliente é o cliente.
--
-- `app_holding_do_sacado` casava por CNPJ COMPLETO, ou por SPE do mesmo grupo econômico.
-- A filial de um cliente não é nem uma coisa nem outra: `13863478000359` não é igual a
-- `13863478000197`, e uma filial não é SPE. A nota faturada contra ela não encontrava
-- conta nenhuma — e sem conta não há classificação, não há titular e não há comissão.
--
-- Medido em 04/09/2026, três clientes faturavam pela filial:
--
--   CONSTRUPOWER   matriz cliente, filial ...0359 com 16 cessões e R$ 335.087
--   TRIFOLD        matriz cliente e na carteira de um originador, filial ...0239 com
--                  2 cessões e R$ 164.469 — que deveriam pagar e não pagavam
--   IM2            matriz cliente, filial ...0285 com R$ 20.317
--
-- R$ 519.874 de volume cedido sem dono, e nenhum sintoma: a cessão convertia, a nota
-- saía do funil, e o motor de comissão terminava com `gravados: 0` porque
-- `empresa_id` era nulo.
--
-- A raiz de 8 dígitos é a PESSOA JURÍDICA; os 4 dígitos seguintes são o estabelecimento.
-- Casar por raiz não é uma heurística de grupo econômico — é a definição da Receita, e
-- por isso ela vem ANTES do grupo na ordem de desempate: a filial de um cliente é o
-- próprio cliente, enquanto a SPE do grupo é outra empresa que a gestão trata junto.
--
-- A ordem é exato → raiz → grupo, e ela decide caso a caso: quando matriz e filial estão
-- as duas cadastradas como cliente (acontece), o CNPJ exato ganha e nada muda; quando só a
-- matriz está, a filial passa a resolver para ela.

create or replace function public.app_holding_do_sacado(p_cnpj text)
returns uuid language sql stable security definer set search_path = '' as $function$
  select e.id
  from public.empresas e
  left join public.mercado_universo u on u.cnpj = p_cnpj
  where p_cnpj is not null
    and e.estagio in ('cliente', 'ex_cliente')
    and (
      e.cnpj = p_cnpj
      or left(e.cnpj, 8) = left(p_cnpj, 8)
      or (coalesce(u.is_spe, false)
          and u.grupo_id is not null
          and e.grupo_id = u.grupo_id)
    )
  order by (e.cnpj = p_cnpj) desc,
           (left(e.cnpj, 8) = left(p_cnpj, 8)) desc,
           e.id
  limit 1;
$function$;

comment on function public.app_holding_do_sacado is
  'A empresa cadastrada dona de uma operação, dado o CNPJ do sacado: ela mesma, uma filial '
  'dela (mesma raiz de 8 dígitos = mesma pessoa jurídica), ou a holding cliente cuja SPE é '
  'o sacado. Uma só, sempre — um grupo pode ter dois clientes, e sem o desempate a mesma '
  'antecipação pagaria comissão duas vezes.';
