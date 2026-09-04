-- ═════════════════════════════════════════════════════════════════════════════
-- 0186 — O card mostra o CLIENTE, não a SPE
--
-- O rodapé do card de NF (funil) e o cabeçalho da linha de antecipação mostravam
-- o SACADO. Na prática o sacado é quase sempre uma SPE de obra — "PRIDE 06 QD 04",
-- "SPE ILHAS VIRGENS" —, e quem varre a coluna não reconhece de qual cliente é a
-- nota. A conta é a empresa a que tudo está amarrado, e é por ela que se pensa.
--
-- ─── O CAMINHO QUE NÃO DEU CERTO, E POR QUÊ ─────────────────────────────────
-- A primeira tentativa foi uma view `sacado_conta` com a regra reescrita como
-- join. A regra batia — 2.564 de 2.564 CNPJs iguais a `app_holding_do_sacado`,
-- zero divergência. O problema foi outro: um `distinct on` sobre o mapa inteiro
-- não aceita o filtro de CNPJ empurrado para dentro, então CADA consulta
-- materializava os 2.534 sacados. 765 ms fixos, numa tela que carrega nove
-- colunas. E deixava a regra escrita em dois lugares.
--
-- Pôr a função direto na view `notas_funil` seria pior: 58 mil chamadas de
-- ~0,55 ms dão 32 segundos contra o timeout de 8 s do PostgREST. É exatamente o
-- defeito que já derrubou `comercial_contas_fase` — `app_holding_do_sacado` é
-- função POR LINHA, e a cardinalidade é quem decide se ela cabe.
--
-- ─── O QUE FUNCIONA ─────────────────────────────────────────────────────────
-- A tela não mostra 58 mil notas: mostra 40 cards. Resolver só os CNPJs pintados
-- custa 40 × 0,55 ms ≈ 30 ms, e a regra continua tendo um dono só. Otimizar a
-- CHAMADA em vez de reescrever a REGRA é o que impede as duas versões de
-- divergirem seis meses depois — e o repositório já pagou esse preço uma vez.
-- ═════════════════════════════════════════════════════════════════════════════

-- A tentativa descartada, caso ela tenha sido aplicada em algum ambiente.
drop view if exists public.sacado_conta;

/**
 * A conta de VÁRIOS sacados, numa chamada.
 *
 * ─── RECUSA, NÃO CALA ───────────────────────────────────────────────────────
 * A primeira versão tinha o gate de módulo num `where`, e sem acesso devolvia
 * ZERO LINHAS. Numa função que alimenta rótulo de card isso não vira erro na
 * tela: vira o nome do sacado aparecendo no lugar do cliente, exatamente como
 * antes, sem ninguém entender por quê. Sem permissão é exceção.
 *
 * O teto de 500 existe para o "em lote" não virar "a tabela inteira" por descuido
 * de quem chamar.
 */
create or replace function public.app_contas_dos_sacados(p_cnpjs text[])
returns table (cnpj text, conta_id uuid, conta_nome text, conta_fantasia text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.app_tem_modulo('antecipacao') or public.app_tem_modulo('comercial')) then
    raise exception 'Sem acesso aos módulos Antecipação ou Comercial.' using errcode = '42501';
  end if;

  return query
    select c.cnpj, e.id, e.razao_social, e.nome_fantasia
      from unnest(p_cnpjs[1:500]) as c(cnpj)
      left join public.empresas e on e.id = public.app_holding_do_sacado(c.cnpj);
end $$;

comment on function public.app_contas_dos_sacados is
  'A conta (holding) de cada CNPJ informado, para as telas que mostram muitos sacados. '
  'Delega em app_holding_do_sacado — a regra continua tendo um dono só.';

revoke execute on function public.app_contas_dos_sacados(text[]) from public, anon;
grant execute on function public.app_contas_dos_sacados(text[]) to authenticated, service_role;
