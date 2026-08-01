-- 0076 — Quem enxerga a empresa passa a enxergar o cadastro e o quadro societário DELA.
--
-- A Company 360 mostra o card "Cadastro (Receita Federal)" e ganhou a aba Sócios, mas as
-- duas fontes (`mercado_universo`, `mercado_socios`) exigiam `app_tem_modulo('mercado')`.
-- Efeito: para o perfil Crédito — que tem `empresas` mas não `mercado` — o card já vinha
-- vazio e a aba nova nasceria vazia. O silêncio de sempre: parece falta de dado, é falta
-- de permissão.
--
-- O recorte é o ponto. NÃO é dar o universo (740 mil linhas) a quem tem o CRM: é dar o
-- cadastro das empresas QUE JÁ ESTÃO no CRM. Mesma forma da concessão que `antecipacao`
-- já tinha, pelo mesmo motivo: você enxerga o dado cadastral daquilo que trabalha, não do
-- mercado inteiro.
--
-- Ordem dos OR importa para o plano: `app_tem_modulo('mercado')` é barato e resolve
-- primeiro para quem tem Mercado, então a varredura do Explorador não paga o `exists`.

drop policy mercado_universo_select on public.mercado_universo;

create policy mercado_universo_select on public.mercado_universo
  for select using (
    public.app_tem_modulo('mercado')
    or (
      public.app_tem_modulo('antecipacao')
      and exists (
        select 1 from public.notas_fiscais nf
        where nf.fornecedor_cnpj = mercado_universo.cnpj
           or nf.sacado_cnpj = mercado_universo.cnpj
      )
    )
    or (
      public.app_tem_modulo('empresas')
      and exists (select 1 from public.empresas e where e.cnpj = mercado_universo.cnpj)
    )
  );

drop policy mercado_socios_select on public.mercado_socios;

create policy mercado_socios_select on public.mercado_socios
  for select using (
    public.app_tem_modulo('mercado')
    or (
      public.app_tem_modulo('empresas')
      and exists (select 1 from public.empresas e where e.cnpj = mercado_socios.cnpj)
    )
  );
