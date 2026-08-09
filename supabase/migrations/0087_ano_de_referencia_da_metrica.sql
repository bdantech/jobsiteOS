-- ─────────────────────────────────────────────────────────────────────────────
-- O ano de referência entra na série — e estimativa não disputa ano que já é sabido
--
-- Faturamento anual é um número de ano FECHADO. A série guardava isso de dois jeitos
-- diferentes sem dizer: a declaração e o ranking gravam `detalhes.ano` (2022, 2024),
-- e a estimativa não gravava nada — ficava só a data em que o job rodou. O resultado
-- na tela eram duas linhas sem como distinguir: "R$ 83M declarado" e "R$ 154M
-- estimado", ambas com a data de ontem, ambas parecendo falar do mesmo ano.
--
-- Duas consequências, e a segunda é a que custa dinheiro: ninguém sabia de que ano
-- era cada número, e o estimador seguia chutando o faturamento de empresas que já
-- tinham nos contado o valor real daquele mesmo ano. A régua do estimador é feita
-- desses declarantes; gravar um chute ao lado da verdade que o calibrou não acrescenta
-- nada e ainda aparece na tela competindo com ela.
--
-- Aqui: (§1) o ano vira uma função, (§2) as estimativas antigas ganham o ano que
-- sempre tiveram implícito, (§3) as que colidem com valor real saem, e (§4/§5)
-- declarar ou importar um valor real apaga a estimativa daquele ano.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── §1 O ano de referência, como função ────────────────────────────────────
-- Espelha anoReferenciaMetrica de packages/core/src/radar/faturamento.ts.
--
-- O fallback é o que dá sentido às leituras gravadas antes de o ano ser explícito:
-- uma MEDIÇÃO (Apollo) descreve o momento em que foi feita, então vale o ano da
-- captura; uma ESTIMATIVA responde "quanto faturaram no ano passado?", porque em
-- agosto de 2026 ninguém sabe quanto a empresa vai faturar em 2026 — nem ela.

create or replace function public.app_ano_referencia_metrica(
  p_detalhes jsonb,
  p_capturado timestamptz,
  p_origem text
)
-- STABLE, e não IMMUTABLE: `extract(year from timestamptz)` depende do TimeZone da
-- sessão. Declarar imutável o que não é já nos custou uma vez (0083).
returns int language sql stable set search_path = '' as $$
  select coalesce(
    nullif(p_detalhes ->> 'ano', '')::int,
    extract(year from p_capturado)::int
      - case when p_origem in ('modelo', 'bracket_simples') then 1 else 0 end
  );
$$;

comment on function public.app_ano_referencia_metrica is
  'A que ano uma leitura da série se refere. `detalhes.ano` manda; sem ele, medição '
  'vale o ano da captura e estimativa vale o último ano fechado. Espelha '
  'anoReferenciaMetrica (packages/core/src/radar/faturamento.ts).';

-- ─── §2 As estimativas antigas ganham o ano que já tinham implícito ─────────

update public.empresa_metricas m
set detalhes = m.detalhes || jsonb_build_object(
  'ano', extract(year from m.capturado_em)::int - 1,
  'ano_inferido', true  -- não foi confirmado por ninguém, foi deduzido da captura
)
where m.metrica = 'faturamento_anual'
  and m.origem in ('modelo', 'bracket_simples')
  and nullif(m.detalhes ->> 'ano', '') is null;

-- ─── §3 Apagar a estimativa quando o ano já tem valor real ──────────────────
-- Uma função, e não um DELETE solto, porque as duas RPCs abaixo precisam da MESMA
-- regra na hora em que o valor real chega. Regra duplicada é regra que diverge.

create or replace function public.app_apagar_estimativas_do_ano(
  p_cnpj text,
  p_metrica text,
  p_ano int
)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_apagadas int;
begin
  if p_ano is null then
    return 0;  -- sem ano não há o que comparar; apagar seria chute sobre chute
  end if;

  delete from public.empresa_metricas m
  where m.cnpj = p_cnpj
    and m.metrica = p_metrica
    and m.origem in ('modelo', 'bracket_simples')
    and public.app_ano_referencia_metrica(m.detalhes, m.capturado_em, m.origem) = p_ano;

  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end $$;

comment on function public.app_apagar_estimativas_do_ano is
  'Remove as estimativas de um (cnpj, métrica, ano) que passou a ter valor real. Não '
  'é perda de histórico: o que sai é um chute nosso sobre um ano que agora é sabido.';

-- A limpeza do que já está no banco. Roda depois do §2 de propósito — sem o ano
-- preenchido, a comparação não encontraria nada.
do $$
declare
  v_total int := 0;
  r record;
begin
  for r in
    select distinct medida.cnpj, medida.metrica,
           public.app_ano_referencia_metrica(medida.detalhes, medida.capturado_em, medida.origem) as ano
    from public.empresa_metricas medida
    where medida.origem not in ('modelo', 'bracket_simples')
  loop
    v_total := v_total + public.app_apagar_estimativas_do_ano(r.cnpj, r.metrica, r.ano);
  end loop;
  raise notice 'Estimativas apagadas por já existir valor real no mesmo ano: %', v_total;
end $$;

comment on table public.empresa_metricas is
  'Série temporal de faturamento anual, headcount e PL. Cada leitura é um snapshot '
  'novo, nunca um update — a única exceção é a estimativa de um ano que passou a ter '
  'valor real, que é apagada (app_apagar_estimativas_do_ano). O valor vigente fica '
  'cacheado em empresas.';

-- ─── §4 Declarar apaga a estimativa daquele ano ─────────────────────────────
-- Duas mudanças além da limpeza:
--
--   O ano deixa de ser opcional na prática. Sem ano, a declaração não participa do
--   modelo por ano — não apaga estimativa, não aparece datada na tela. O default é o
--   último ano fechado, que é o mesmo que o formulário já sugere.
--
--   O cache não retrocede de ano. Declarar hoje o faturamento de 2022 quando já
--   existe o de 2025 declarado não pode fazer a ficha voltar três anos — e voltava,
--   porque a comparação era só de origem, e a origem é a mesma.

create or replace function public.app_declarar_metrica(p jsonb)
returns public.empresa_metricas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_metrica text := p ->> 'metrica';
  v_valor numeric := (p ->> 'valor')::numeric;
  v_ano int := coalesce(nullif(p ->> 'ano', '')::int, extract(year from now())::int - 1);
  v_linha public.empresa_metricas;
begin
  if not public.app_tem_modulo('empresas') then
    raise exception 'Sem acesso ao módulo Empresas.' using errcode = '42501';
  end if;
  if v_metrica not in ('faturamento_anual', 'funcionarios') then
    raise exception 'Métrica inválida: %.', v_metrica using errcode = '22023';
  end if;
  if v_valor is null or v_valor < 0 then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  insert into public.empresa_metricas (empresa_id, cnpj, metrica, valor, origem, confianca, detalhes)
  values (
    v_empresa.id, v_empresa.cnpj, v_metrica, v_valor, 'declarado_cliente', 'alta',
    jsonb_build_object('ano', v_ano, 'declarado_por', v_ator)
  )
  returning * into v_linha;

  -- O ano agora é sabido: o chute que ocupava esse ano perde a razão de existir.
  perform public.app_apagar_estimativas_do_ano(v_empresa.cnpj, v_metrica, v_ano);

  -- `declarado_cliente` é o topo da hierarquia (0069 §2), então vence qualquer
  -- origem — mas não vence uma declaração de ano MAIS RECENTE, inclusive a sua.
  if not exists (
    select 1 from public.empresa_metricas m
    where m.cnpj = v_empresa.cnpj and m.metrica = v_metrica and m.id <> v_linha.id
      and m.origem = 'declarado_cliente'
      and public.app_ano_referencia_metrica(m.detalhes, m.capturado_em, m.origem) > v_ano
  ) then
    if v_metrica = 'faturamento_anual' then
      update public.empresas set
        faturamento_anual = v_valor,
        faturamento_origem = 'declarado_cliente',
        faturamento_confianca = 'alta',
        faturamento_atualizado_em = now()
      where id = v_empresa.id;
    else
      update public.empresas set
        funcionarios = v_valor::int,
        funcionarios_origem = 'declarado_cliente',
        funcionarios_atualizado_em = now()
      where id = v_empresa.id;
    end if;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'metrica.declarada',
    jsonb_build_object(
      'resumo', case when v_metrica = 'faturamento_anual'
                     then 'Faturamento anual declarado: R$ ' || to_char(v_valor, 'FM999G999G999G990D00')
                          || ' (ref. ' || v_ano || ')'
                     else 'Funcionários declarados: ' || v_valor::int || ' (ref. ' || v_ano || ')' end,
      'metrica', v_metrica, 'valor', v_valor, 'ano', v_ano
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'metrica.declarada', 'empresa_metricas', v_linha.id::text, p);

  return v_linha;
end; $$;

comment on function public.app_declarar_metrica is
  'Registra faturamento ou headcount DECLARADO pelo cliente (topo da hierarquia de '
  'origens), datado pelo ano de referência. Apaga a estimativa daquele ano e nunca '
  'faz o cache retroceder de ano. Snapshot + cache + evento + audit numa transação.';

-- ─── §5 Importar também apaga a estimativa daquele ano ──────────────────────
-- Mesma regra, mesmo motivo: o ranking publicado é o valor real do ano.

create or replace function public.app_registrar_metrica_importada(p jsonb)
returns public.empresa_metricas language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_empresa public.empresas;
  v_metrica text := p ->> 'metrica';
  v_valor numeric := (p ->> 'valor')::numeric;
  v_origem text := coalesce(p ->> 'origem', 'publicacao');
  v_ano int := nullif(p ->> 'ano', '')::int;
  v_fonte text := nullif(p ->> 'fonte', '');
  v_capturado timestamptz;
  v_vigente text;
  v_linha public.empresa_metricas;
  v_rank_nova int;
  v_rank_vigente int;
begin
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  if v_metrica not in ('faturamento_anual', 'funcionarios', 'patrimonio_liquido') then
    raise exception 'Métrica inválida: %.', v_metrica using errcode = '22023';
  end if;
  if v_origem not in ('publicacao', 'lista') then
    raise exception 'Origem inválida para importação: %.', v_origem using errcode = '22023';
  end if;
  if v_valor is null then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  if v_valor < 0 and v_metrica <> 'patrimonio_liquido' then
    raise exception 'Valor negativo só é aceito em patrimonio_liquido.' using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  -- O snapshot é datado pelo ANO DO DADO, não pela data do upload (0081 §5).
  v_capturado := case
    when v_ano is null then now()
    else make_timestamptz(v_ano, 12, 31, 12, 0, 0)
  end;

  insert into public.empresa_metricas (empresa_id, cnpj, metrica, valor, origem, confianca, detalhes, capturado_em)
  values (
    v_empresa.id, v_empresa.cnpj, v_metrica, v_valor, v_origem, 'media',
    jsonb_build_object('ano', v_ano, 'fonte', v_fonte, 'importado_por', v_ator)
      || coalesce(p -> 'detalhes', '{}'::jsonb),
    v_capturado
  )
  returning * into v_linha;

  -- Mesma regra da declaração: o ano passou a ser sabido, o chute sai.
  perform public.app_apagar_estimativas_do_ano(v_empresa.cnpj, v_metrica, v_ano);

  v_rank_nova := public.app_rank_origem_metrica(v_origem);

  v_vigente := case v_metrica
    when 'faturamento_anual' then v_empresa.faturamento_origem
    when 'funcionarios' then v_empresa.funcionarios_origem
    else v_empresa.patrimonio_origem end;

  v_rank_vigente := public.app_rank_origem_metrica(v_vigente);

  -- Hierarquia + não-retrocesso de ano, contra snapshots de origem igual ou melhor
  -- (0081 §5 explica por que o recorte de origem é indispensável aqui).
  if v_rank_nova <= v_rank_vigente
     and not exists (
       select 1 from public.empresa_metricas m
       where m.cnpj = v_empresa.cnpj and m.metrica = v_metrica
         and m.id <> v_linha.id
         and m.capturado_em > v_capturado
         and public.app_rank_origem_metrica(m.origem) <= v_rank_nova
     )
  then
    if v_metrica = 'faturamento_anual' then
      update public.empresas set
        faturamento_anual = v_valor,
        faturamento_origem = v_origem,
        faturamento_confianca = 'media',
        faturamento_atualizado_em = v_capturado
      where id = v_empresa.id;
    elsif v_metrica = 'funcionarios' then
      update public.empresas set
        funcionarios = v_valor::int,
        funcionarios_origem = v_origem,
        funcionarios_atualizado_em = v_capturado
      where id = v_empresa.id;
    else
      update public.empresas set
        patrimonio_liquido = v_valor,
        patrimonio_origem = v_origem,
        patrimonio_atualizado_em = v_capturado
      where id = v_empresa.id;
    end if;
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_empresa.id, 'metrica.importada',
    jsonb_build_object(
      'resumo', case v_metrica
        when 'faturamento_anual' then 'Faturamento de lista: R$ ' || to_char(v_valor, 'FM999G999G999G990D00')
        when 'patrimonio_liquido' then 'Patrimônio líquido de lista: R$ ' || to_char(v_valor, 'FM999G999G999G990D00')
        else 'Funcionários de lista: ' || v_valor::int end
        || coalesce(' (ref. ' || v_ano || ')', '')
        || coalesce(' — ' || v_fonte, ''),
      'metrica', v_metrica, 'valor', v_valor, 'ano', v_ano, 'origem', v_origem, 'fonte', v_fonte
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'metrica.importada', 'empresa_metricas', v_linha.id::text, p);

  return v_linha;
end; $$;
