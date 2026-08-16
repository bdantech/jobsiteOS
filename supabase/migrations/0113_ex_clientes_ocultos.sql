-- =============================================================================
-- 0113 — Ocultar à mão o que a heurística não separa
--
-- O recorte de SPE/filial (0111/0112) usa quatro sinais — flag do universo, SPE/SCP
-- no nome, natureza 2127 e propagação pela raiz do CNPJ — e ainda sobram dez
-- entidades do RFM na lista de clientes principais. Para o banco, `RFME 03
-- EMPREENDIMENTO IMOBILIARIO LTDA` e `MABEX ENGENHARIA` são indistinguíveis: matriz,
-- fora do universo, sem grupo, sem SPE no nome.
--
-- Continuar inventando regra de nome derrubaria construtora legítima junto. Quando a
-- heurística não fecha, a saída honesta é deixar um humano fechar — uma vez, por
-- empresa, com registro de quem foi.
--
-- ESCONDE DA TELA, NÃO DO BANCO. O estágio da empresa não muda, `e_ex_cliente` no
-- Explorador continua valendo, e reexibir devolve a linha inteira. Um "ocultar" que
-- apagasse dado seria irreversível por um clique dado no meio de uma triagem.
--
-- Mesmo desenho de `certificados_ocultos` (0064), de propósito: dois jeitos
-- diferentes de esconder linha na mesma aplicação é um a mais do que o necessário.
-- =============================================================================

create table public.ex_clientes_ocultos (
  cnpj text primary key
    constraint ex_clientes_ocultos_cnpj_check check (cnpj ~ '^[0-9]{14}$'),
  oculto_por uuid references public.usuarios (id) on delete set null,
  oculto_em timestamptz not null default now()
);

comment on table public.ex_clientes_ocultos is
  'Ex-clientes escondidos da lista por decisão humana — o veículo de projeto que nenhum '
  'sinal estrutural distingue de uma operacional. Esconde da TELA, não do banco: o '
  'estágio da empresa não muda, e reexibir devolve a linha inteira.';

alter table public.ex_clientes_ocultos enable row level security;

create policy ex_clientes_ocultos_select on public.ex_clientes_ocultos
  for select to authenticated
  using (public.app_tem_modulo('credito') or public.app_tem_modulo('radar') or public.app_tem_modulo('comercial'));

grant select on public.ex_clientes_ocultos to authenticated;

create or replace function public.app_ocultar_ex_cliente(p_cnpj text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.app_tem_modulo('comercial') or public.app_tem_modulo('credito')
          or public.app_tem_modulo('radar')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  if p_cnpj !~ '^[0-9]{14}$' then
    raise exception 'CNPJ inválido.' using errcode = '22023';
  end if;

  insert into public.ex_clientes_ocultos (cnpj, oculto_por)
  values (p_cnpj, auth.uid())
  on conflict (cnpj) do nothing;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'excliente.ocultado', 'ex_clientes_ocultos', p_cnpj,
          jsonb_build_object('cnpj', p_cnpj));
end; $$;

create or replace function public.app_reexibir_ex_cliente(p_cnpj text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.app_tem_modulo('comercial') or public.app_tem_modulo('credito')
          or public.app_tem_modulo('radar')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  delete from public.ex_clientes_ocultos where cnpj = p_cnpj;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (auth.uid(), 'excliente.reexibido', 'ex_clientes_ocultos', p_cnpj,
          jsonb_build_object('cnpj', p_cnpj));
end; $$;

revoke all on function public.app_ocultar_ex_cliente(text) from public;
revoke all on function public.app_reexibir_ex_cliente(text) from public;
grant execute on function public.app_ocultar_ex_cliente(text) to authenticated;
grant execute on function public.app_reexibir_ex_cliente(text) to authenticated;

-- A view ganha `oculto`. A lista abre sem eles; a gaveta "Ocultos (N)" os mostra.
create or replace view public.ex_clientes
with (security_invoker = true) as
  select
    e.id as empresa_id, e.cnpj,
    coalesce(e.razao_social, e.nome_fantasia, a.company_name) as nome,
    e.ex_cliente_desde,
    case when e.ex_cliente_desde is null then null
      else greatest(0, (extract(year from age(current_date, e.ex_cliente_desde)) * 12
                        + extract(month from age(current_date, e.ex_cliente_desde)))::int) end as meses_desde,
    e.ex_cliente_motivo, m.motivo as ex_cliente_motivo_label, e.ex_cliente_motivo_obs,
    e.gestao_operacao, e.uf, e.municipio,
    a.credit_limit as ultimo_limite, a.consumed_limit as consumo_historico,
    a.monthly_rate_d0 as ultima_taxa_d0, a.expiration_date as ultima_analise_expirou_em,
    a.status as ultima_analise_status,
    sug.motivo_id as motivo_sugerido, sug.motivo as motivo_sugerido_label,
    sug.evidencia as motivo_sugerido_evidencia,
    substring(e.cnpj from 9 for 4) <> '0001' as e_filial,
    v.e_spe,
    not (substring(e.cnpj from 9 for 4) <> '0001' or v.e_spe) as e_principal,
    v.origem_spe,
    oc.cnpj is not null as oculto
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    left join public.mercado_universo mu on mu.cnpj = e.cnpj
    left join public.ex_clientes_ocultos oc on oc.cnpj = e.cnpj
    -- UMA chamada de `raiz_e_spe` por linha, e não duas. `e_spe` e `origem_spe`
    -- precisam do mesmo resultado, e cada uma chamava a função de novo: a projeção
    -- respondia por 21 dos 27 ms da consulta. Medido: 27,2 ms → 22,8 ms.
    left join lateral (select public.raiz_e_spe(e.cnpj) as raiz_spe) r on true
    left join lateral (
      select
        coalesce(mu.is_spe, e.is_spe, false)
          or coalesce(coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)', false)
          or coalesce(public.natureza_juridica_codigo(mu.natureza_juridica) = '2127', false)
          or r.raiz_spe
          as e_spe,
        case
          when coalesce(mu.is_spe, e.is_spe, false) then 'flag'
          when coalesce(coalesce(e.razao_social, e.nome_fantasia, '') ~* '(^|[^A-Za-z])(SPE|SCP)([^A-Za-z]|$)', false) then 'nome'
          when coalesce(public.natureza_juridica_codigo(mu.natureza_juridica) = '2127', false) then 'natureza_2127'
          when r.raiz_spe then 'raiz'
        end as origem_spe
    ) v on true
    left join lateral (
      select mp.id as motivo_id, mp.motivo, s.evidencia
      from (
        select
          case
            when mu2.situacao_cadastral in ('baixada','nula') then 'Encerrou atividades / recuperação judicial'
            when coalesce(pa.tem_protesto,false) then 'Inadimplência / default'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde then 'Certificado / cadastro vencido e não renovado'
            when a.status = 'blocked' then 'Análise não renovada pela plataforma'
          end as alvo,
          case
            when mu2.situacao_cadastral in ('baixada','nula') then 'Situação cadastral na Receita: ' || mu2.situacao_cadastral || '.'
            when coalesce(pa.tem_protesto,false) then 'Protesto registrado (consulta de ' || to_char(pa.consultado_em,'DD/MM/YYYY') || ').'
            when cert.cnpj is not null and cert.expires_at < e.ex_cliente_desde then 'Certificado digital venceu em ' || to_char(cert.expires_at,'DD/MM/YYYY') || ', antes da saída, e não foi renovado.'
            when a.status = 'blocked' then 'A análise na plataforma está BLOQUEADA — foi a plataforma que fechou a porta.'
          end as evidencia
        from (select 1) _
          left join public.mercado_universo mu2 on mu2.cnpj = e.cnpj
          left join public.protestos_atual pa on pa.cnpj = e.cnpj
          left join public.certificados cert on cert.cnpj = e.cnpj
      ) s
      join public.motivos_perda mp on mp.contexto = 'ex_cliente' and mp.motivo = s.alvo and mp.ativo
      limit 1
    ) sug on true
  where e.estagio = 'ex_cliente';

grant select on public.ex_clientes to authenticated;
