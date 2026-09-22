-- 0242 — O universo enxerga as fontes novas
--
-- A política de `mercado_universo` deixava quem tem `antecipacao` (e não tem
-- `mercado`) ler apenas os CNPJs que aparecem em `notas_fiscais`. Um fornecedor de
-- pré-autorização que nunca emitiu nota para nós era INVISÍVEL — e o time do funil
-- é exatamente quem não tem `mercado`.
--
-- Isso importa porque o nome do fornecedor sem cadastro vem daqui (0243). Sem esta
-- parte a correção funcionaria só para admin: o originador continuaria vendo "Sem
-- cadastro" e ninguém saberia dizer por quê. É o mesmo defeito que já esvaziou a
-- tela de Sacados a prospectar (0060), repetido pelas fontes novas.
--
-- O recorte continua estreito e continua sendo o mesmo: "só os CNPJs que aparecem
-- em algo que este usuário já pode ver". As duas tabelas novas têm RLS própria,
-- então o EXISTS já respeita a carteira de quem pergunta.
drop policy if exists mercado_universo_select on public.mercado_universo;

create policy mercado_universo_select on public.mercado_universo
  for select using (
    (select public.app_tem_modulo('mercado'))
    or (
      (select public.app_tem_modulo('antecipacao'))
      and (
        exists (select 1 from public.notas_fiscais nf
                 where nf.fornecedor_cnpj = mercado_universo.cnpj)
        or exists (select 1 from public.notas_fiscais nf
                    where nf.sacado_cnpj = mercado_universo.cnpj)
        or exists (select 1 from public.pre_autorizacoes pa
                    where pa.fornecedor_cnpj = mercado_universo.cnpj
                       or pa.sacado_cnpj = mercado_universo.cnpj
                       or pa.sacado_matriz_cnpj = mercado_universo.cnpj)
        or exists (select 1 from public.sienge_titulos st
                    where st.credor_cnpj = mercado_universo.cnpj
                       or st.sacado_cnpj = mercado_universo.cnpj
                       or st.sacado_matriz_cnpj = mercado_universo.cnpj)
      )
    )
    or (
      (select public.app_tem_modulo('empresas'))
      and exists (select 1 from public.empresas e where e.cnpj = mercado_universo.cnpj)
    )
  );

-- Os índices que tornam os EXISTS acima baratos. O de pré-autorizações pelas duas
-- pontas já existe (`pre_autorizacoes_partes_idx`); faltavam estes.
create index if not exists sienge_titulos_credor_idx
  on public.sienge_titulos (credor_cnpj) where credor_cnpj is not null;
create index if not exists sienge_titulos_sacado_matriz_idx
  on public.sienge_titulos (sacado_matriz_cnpj);
create index if not exists pre_autorizacoes_sacado_matriz_idx
  on public.pre_autorizacoes (sacado_matriz_cnpj);
