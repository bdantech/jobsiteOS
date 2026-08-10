-- 0097 — A conta é a holding E as SPEs dela.
--
-- O Comercial inteiro tratava "empresa" como CNPJ, e uma construtora não opera assim:
-- ela é uma holding com dezenas de SPEs, e é contra a SPE que se fatura. Medido no banco
-- antes de mexer:
--
--   volume antecipado com sacado = a própria holding   R$ 1.882.263
--   volume antecipado com sacado = SPE do mesmo grupo  R$ 1.347.408   ← fora da comissão
--
--   NFs vivas com sacado = cliente                     3.148
--   NFs vivas com sacado = SPE do grupo de um cliente  1.112          ← fora da carteira
--
-- Ou seja: 42% do volume que deveria remunerar a gestão passiva não era contado, e um
-- quarto das notas da carteira do originador nunca chegava nele. Não era um erro de
-- cálculo — era a pergunta errada: "esta antecipação é da empresa X?" em vez de "esta
-- antecipação é do grupo de X?".

-- ─── A amarração, num lugar só ──────────────────────────────────────────────
--
-- Uma função e não a mesma condição repetida em três consultas. Ela decide dinheiro (a
-- comissão de volume) e trabalho (a carteira do originador), e duas cópias divergentes
-- pagariam uma coisa e mostrariam outra — com o agravante de que quem confere olharia a
-- tela e concluiria que o cálculo está certo.
--
-- Três decisões dentro dela, e cada uma tem um jeito plausível de errar:
--
-- 1. Só CLIENTE ou EX-CLIENTE pode ser a dona. Esta é a que quase me pegou: a primeira
--    versão dizia "se o sacado é uma empresa cadastrada, é dela a operação" — e não
--    funcionou, porque 13 dos sacados são SPEs que TÊM linha própria em `empresas`, com
--    `estagio = 'mercado'`. O casamento direto vencia, a SPE virava a dona de si mesma, e
--    a função devolvia um id que não está na carteira de ninguém. Zero linhas mudariam de
--    dono e o bug pareceria corrigido.
--
-- 2. Só sobe pelo grupo quando o sacado é `is_spe`. O grupo econômico também junta
--    empresas OPERACIONAIS irmãs, que são contas próprias e podem ter dono próprio;
--    puxá-las junto daria ao closer de uma holding o volume da concorrente interna dela.
--    Medido: dos 29 casos observados, 28 são SPE e 1 é irmã operacional — a régua estrita
--    cobre o que interessa e não inventa vínculo.
--
-- 3. UMA holding por sacado, sempre. Existe hoje um grupo com DOIS clientes (ATW
--    Instalações e One Construction). Sem o `limit 1` ordenado, a SPE desse grupo seria
--    reivindicada pelos dois e a mesma antecipação pagaria comissão duas vezes. O
--    desempate por id é arbitrário, mas é estável e auditável — e pagar a mais é o erro
--    que ninguém reporta.

create or replace function public.app_holding_do_sacado(p_cnpj text)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id
  from public.empresas e
  left join public.mercado_universo u on u.cnpj = p_cnpj
  where p_cnpj is not null
    and e.estagio in ('cliente', 'ex_cliente')
    and (
      e.cnpj = p_cnpj
      or (coalesce(u.is_spe, false)
          and u.grupo_id is not null
          and e.grupo_id = u.grupo_id)
    )
  order by (e.cnpj = p_cnpj) desc, e.id
  limit 1;
$$;

comment on function public.app_holding_do_sacado is
  'A empresa cadastrada dona de uma operação, dado o CNPJ do sacado: ela mesma, ou a '
  'holding cliente cuja SPE é o sacado. Uma só, sempre — um grupo pode ter dois clientes, '
  'e sem o desempate a mesma antecipação pagaria comissão duas vezes.';

revoke execute on function public.app_holding_do_sacado(text) from public;
grant execute on function public.app_holding_do_sacado(text) to authenticated, service_role;

-- ─── A carteira passiva passa a somar o grupo ───────────────────────────────
--
-- Mesma tela, mesmo número na mesma coluna — só que agora ele bate com o que a comissão
-- vai pagar. `spes_no_volume` entra junto porque um número que triplicou sem explicação
-- é um número que ninguém confia: a tela diz de quantas SPEs ele veio.

create or replace function public.comercial_carteira_vendedor(p_vendedor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_id uuid := coalesce(p_vendedor_id, public.app_vendedor_atual());
  v_tipo text;
  v_de date := date_trunc('month', now())::date;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;
  if v_id is null then
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true);
  end if;
  if not public.app_pode_ver_vendedor(v_id) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  select tipo into v_tipo from public.vendedores where id = v_id;

  return jsonb_build_object(
    'tem_acesso', true,
    'vendedor_id', v_id,
    'tipo', v_tipo,
    'competencia', v_de,
    'passivas', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.volume_mes desc nulls last), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.faturamento_anual,
               c.desde,
               e.gestao_operacao,
               -- Quantas SPEs esta holding tem no grupo. É o tamanho do que ela arrasta.
               (select count(*)::int from public.mercado_universo u
                 where e.grupo_id is not null and u.grupo_id = e.grupo_id and u.is_spe) as spes,
               (select coalesce(sum(a.gross_value), 0) from public.antecipacoes a
                 where a.regrediu_em is null
                   and a.convertida_em >= v_de
                   and a.convertida_em < (v_de + interval '1 month')
                   and public.app_holding_do_sacado(a.sacado_cnpj) = e.id) as volume_mes,
               (select count(*)::int from public.antecipacoes a
                 where a.regrediu_em is null
                   and a.convertida_em >= v_de
                   and a.convertida_em < (v_de + interval '1 month')
                   and a.sacado_cnpj <> e.cnpj
                   and public.app_holding_do_sacado(a.sacado_cnpj) = e.id) as operacoes_via_spe
        from public.vendedor_carteira c
        join public.empresas e on e.id = c.empresa_id
        where c.vendedor_id = v_id and c.papel = 'gestao_passiva' and c.ate is null
      ) x
    ),
    'originacao', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.razao_social), '[]'::jsonb)
      from (
        select e.id, e.cnpj, e.razao_social, e.uf, e.estagio, e.gestao_operacao,
               (select count(*)::int from public.mercado_universo u
                 where e.grupo_id is not null and u.grupo_id = e.grupo_id and u.is_spe) as spes,
               -- Conta a nota da holding E a das SPEs dela: é o que o roteamento entrega.
               (select count(*)::int from public.notas_fiscais nf
                 where nf.vendedor_id = v_id
                   and nf.estagio_funil not in ('convertida', 'perdida')
                   and (nf.fornecedor_empresa_id = e.id
                        or nf.sacado_empresa_id = e.id
                        or public.app_holding_do_sacado(nf.sacado_cnpj) = e.id)) as nfs_vivas
        from public.empresas e
        where e.id::text in (
          select jsonb_array_elements_text(coalesce(v.settings -> 'empresas_escolhidas', '[]'::jsonb))
          from public.vendedores v where v.id = v_id
        )
      ) x
    )
  );
end $function$;

revoke execute on function public.comercial_carteira_vendedor(uuid) from public;
grant execute on function public.comercial_carteira_vendedor(uuid) to authenticated, service_role;
