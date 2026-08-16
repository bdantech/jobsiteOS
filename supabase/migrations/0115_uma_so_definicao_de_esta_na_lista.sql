-- =============================================================================
-- 0115 — Uma só definição de "está na lista de ex-clientes"
--
-- Tínhamos dois filtros fazendo a mesma coisa por caminhos diferentes: "só
-- principais" (heurística — filial pelo 0001, SPE por quatro sinais) e "ocultos"
-- (decisão humana, 0113). Os dois respondem à MESMA pergunta — esta empresa deve
-- aparecer como cliente que perdemos? — e estavam em dois lugares, com dois botões,
-- duas contagens e a possibilidade de discordarem.
--
-- Discordavam de fato: os indicadores da aba Análise (0114) descontavam os ocultos e
-- NÃO descontavam filiais e SPEs. Na base de hoje o card dizia 139 ex-clientes
-- enquanto a lista ao lado mostrava 72 — quase o dobro, sem nenhum dos dois estar
-- errado pelas suas próprias regras. É o pior tipo de número divergente: não há bug
-- para achar, há uma definição a mais.
--
-- A partir daqui a definição é UMA e mora na view: `na_lista`. Front e indicadores
-- leem a mesma coluna; quem quiser mudar o recorte muda aqui e as duas telas andam
-- juntas por construção.
--
-- `ex_clientes_por_motivo` passa a ler da view em vez de `empresas`. Ela alimenta o
-- gráfico "por que saíram" no TOPO DA PRÓPRIA LISTA — contar ali quem a tabela
-- logo abaixo não mostra é a mesma contradição, só que a dois centímetros de
-- distância.
-- =============================================================================

-- `create or replace` com a coluna nova NO FIM: qualquer outra posição obrigaria a
-- derrubar a view e tudo que depende dela.
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
    oc.cnpj is not null as oculto,
    -- A definição única. `coalesce` porque `e_spe` já chegou NULO uma vez (0112) e um
    -- nulo aqui reabre exatamente o buraco que aquela migração fechou.
    coalesce(not (substring(e.cnpj from 9 for 4) <> '0001' or v.e_spe), false)
      and oc.cnpj is null as na_lista
  from public.empresas e
    left join public.analises_plataforma_atual a on a.cnpj = e.cnpj
    left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    left join public.mercado_universo mu on mu.cnpj = e.cnpj
    left join public.ex_clientes_ocultos oc on oc.cnpj = e.cnpj
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

comment on column public.ex_clientes.na_lista is
  'A definição única de "conta como cliente que perdemos": é matriz, não é SPE e '
  'ninguém a ocultou à mão. Lista, gráfico de motivos e indicadores da aba Análise '
  'leem esta coluna — antes cada um tinha o seu recorte e os números divergiam.';

grant select on public.ex_clientes to authenticated;

-- ─── Os dois agregados passam a ler a mesma coluna ──────────────────────────

create or replace function public.ex_clientes_analise()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select x.empresa_id, mp.motivo, mp.retorno_possivel
    from public.ex_clientes x
      left join public.motivos_perda mp on mp.id = x.ex_cliente_motivo
    where x.na_lista
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'com_retorno', (select count(*) from base where retorno_possivel is true),
    'sem_retorno', (select count(*) from base where retorno_possivel is false),
    'indefinido', (select count(*) from base where retorno_possivel is null),
    'distribuicao', coalesce((
      select jsonb_agg(t order by t.total desc, t.motivo)
      from (
        select coalesce(motivo, 'Não classificado') as motivo,
               count(*)::int as total,
               bool_or(retorno_possivel) as retorno_possivel
        from base group by 1
      ) t
    ), '[]'::jsonb)
  );
$$;

comment on function public.ex_clientes_analise() is
  'Indicadores de ex-clientes para a aba Análise: total, quantos têm chance de '
  'retorno, quantos não têm, e a distribuição por motivo. Conta exatamente as linhas '
  'que a lista mostra (`ex_clientes.na_lista`): sem filiais, sem SPEs, sem ocultos.';

grant execute on function public.ex_clientes_analise() to authenticated;

create or replace function public.ex_clientes_por_motivo(p_meses int default 12)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by t.total desc), '[]'::jsonb)
  from (
    select
      coalesce(x.ex_cliente_motivo_label, 'Não classificado') as motivo,
      count(*)::int as total
    from public.ex_clientes x
    where x.na_lista
      and (p_meses is null
           or x.ex_cliente_desde is null
           or x.ex_cliente_desde >= (current_date - make_interval(months => p_meses)))
    group by 1
  ) t;
$$;

comment on function public.ex_clientes_por_motivo(int) is
  'Contagem de ex-clientes por motivo de saída na janela, sobre as mesmas linhas da '
  'lista (`na_lista`). "Não classificado" aparece como categoria própria: é diferente '
  'de "Motivo desconhecido", que é uma resposta que alguém deu.';

grant execute on function public.ex_clientes_por_motivo(int) to authenticated;
