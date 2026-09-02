-- ═════════════════════════════════════════════════════════════════════════════
-- 0156 — Promover criava a empresa e deixava as notas sem saber disso
--
-- Depois de promover um sacado, o botão continuava dizendo "Promover para
-- Empresas" na ficha dele, e ele seguia listado em "sacados a prospectar". Não era
-- a tela: era o banco. `app_promover_empresa` cria a linha em `empresas` e aponta
-- `mercado_universo.empresa_id` — e para por aí.
--
-- Só que quem responde as duas telas é `notas_funil`, que lê COLUNAS GRAVADAS em
-- `notas_fiscais`:
--
--   * o botão vem de `sacado_empresa_id`, que continuava nulo;
--   * a lista "a prospectar" filtra `where not sacado_cadastrado`, que continuava
--     falso.
--
-- As duas só eram corrigidas no próximo sync de NFs. Até lá a tela mostrava um
-- estado que já não existia, e a única saída era promover de novo — o que não
-- fazia nada, porque a promoção é idempotente.
--
-- ─── UMA FUNÇÃO SÓ, CHAMADA PELAS DUAS PORTAS ───────────────────────────────
-- São dois caminhos que criam empresa a partir de um CNPJ (`app_promover_empresa`,
-- do universo de mercado, e `app__promover_fornecedor_para_empresa`, do funil de
-- fornecedores) e o mesmo esquecimento nos dois. A amarração vive num lugar só
-- para não corrigir um e deixar o outro — que é como este defeito nasceu.
--
-- O CNPJ pode ser sacado numa nota e fornecedor noutra: a construtora que compra
-- de um fornecedor também emite para outra. Por isso os dois lados são atualizados
-- sempre, e cada um só onde ainda está vazio.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app__vincular_notas_da_empresa(p_cnpj text, p_empresa uuid)
returns void language sql security definer set search_path = '' as $$
  update public.notas_fiscais
     set sacado_empresa_id = coalesce(sacado_empresa_id, p_empresa),
         sacado_cadastrado = true
   where sacado_cnpj = p_cnpj
     and (sacado_empresa_id is null or sacado_cadastrado is distinct from true);

  update public.notas_fiscais
     set fornecedor_empresa_id = coalesce(fornecedor_empresa_id, p_empresa),
         fornecedor_cadastrado = true
   where fornecedor_cnpj = p_cnpj
     and (fornecedor_empresa_id is null or fornecedor_cadastrado is distinct from true);
$$;

comment on function public.app__vincular_notas_da_empresa is
  'Aponta as notas de um CNPJ para a ficha recém-criada, nos dois papéis. Sem isto o '
  'funil de NFs só descobre a promoção no próximo sync — e as telas ficam oferecendo '
  'promover quem já foi promovido.';

revoke execute on function public.app__vincular_notas_da_empresa(text, uuid) from public, anon;
grant execute on function public.app__vincular_notas_da_empresa(text, uuid) to service_role;

/*
 * O GATILHO, e não uma linha dentro de cada função de promoção.
 *
 * São duas portas hoje (`app_promover_empresa` e
 * `app__promover_fornecedor_para_empresa`) e o mesmo esquecimento nas duas — o que
 * já é a evidência de que uma chamada copiada em cada uma seria esquecida na
 * terceira. No gatilho a regra é da TABELA: toda ficha de empresa que nasce puxa
 * as notas do seu CNPJ, venha ela de onde vier.
 *
 * Os dois updates são indexados por CNPJ (`notas_fiscais_sacado_idx` e
 * `notas_fiscais_fornecedor_faixa_idx`) e só tocam linhas que ainda não apontam
 * para ninguém, então a importação de empresas em lote não vira varredura.
 */
create or replace function public.empresas__vincular_notas() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cnpj is not null then
    perform public.app__vincular_notas_da_empresa(new.cnpj, new.id);
  end if;
  return null;
end $$;

drop trigger if exists empresas_vincular_notas on public.empresas;

create trigger empresas_vincular_notas
  after insert on public.empresas
  for each row execute function public.empresas__vincular_notas();

/*
 * E o passivo: as empresas que já foram promovidas antes deste gatilho existir e
 * cujas notas continuam órfãs. Sem esta linha, o sacado que o usuário promoveu
 * ontem seguiria oferecendo "Promover" até o próximo sync.
 */
do $$
declare r record;
begin
  for r in
    select e.cnpj, e.id from public.empresas e
    where e.cnpj is not null
      and (
        exists (select 1 from public.notas_fiscais n
                 where n.sacado_cnpj = e.cnpj and n.sacado_empresa_id is null)
        or exists (select 1 from public.notas_fiscais n
                    where n.fornecedor_cnpj = e.cnpj and n.fornecedor_empresa_id is null)
      )
  loop
    perform public.app__vincular_notas_da_empresa(r.cnpj, r.id);
  end loop;
end $$;
