-- ─────────────────────────────────────────────────────────────────────────────
-- Métricas vindas de lista PUBLICADA (ranking setorial, revista, anuário)
--
-- O caso concreto: o Ranking da Engenharia Brasileira traz receita bruta de dois
-- anos, pessoal graduado e patrimônio líquido de ~320 empresas — sem CNPJ. O
-- importador já sabe casar por nome (fila de resolução, trigrama); o que faltava
-- era onde GRAVAR esses números.
--
-- Três coisas aqui, e as três têm o mesmo motivo: `empresa_metricas` não aceita
-- insert de `authenticated` de propósito (0069), para que "gravar métrica pulando
-- a hierarquia de origem" seja inexprimível e não apenas desencorajado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── §1 Patrimônio líquido é a terceira métrica ─────────────────────────────
-- Anual, datada, vinda de fonte externa: é a mesma forma das outras duas, então
-- é a mesma tabela. E PODE SER NEGATIVO — a Odebrecht do ranking 2025 está com
-- −R$ 21,4 bi. A tabela nunca proibiu sinal; quem proíbe é a RPC de declaração,
-- e a nova (§4) libera só para esta métrica.

-- `limite_potencial` e `receita_prevista` entraram na 0073 (Crédito). Reescrever o
-- CHECK a partir da lista da 0069 os apagaria e derrubaria o job mensal de crédito
-- na primeira gravação — o CHECK tem que ser a UNIÃO do que existe hoje.

alter table public.empresa_metricas
  drop constraint empresa_metricas_metrica_check;

alter table public.empresa_metricas
  add constraint empresa_metricas_metrica_check
  check (metrica in
    ('faturamento_anual', 'funcionarios', 'limite_potencial', 'receita_prevista', 'patrimonio_liquido'));

-- ─── §2 `publicacao` entra ACIMA do Apollo na hierarquia ────────────────────
-- Não é hierarquia nova, é a ordem certa. O Apollo conta perfis indexados no
-- LinkedIn e subconta canteiro de forma brutal; um ranking setorial publica o
-- número que a própria empresa informou à revista. Deixar `publicacao` abaixo de
-- `apollo` (onde `lista` está) faria o dado pior vencer o melhor no cache.
--
-- A ordem em código vive em packages/core/src/radar/faturamento.ts (RANK_ORIGEM)
-- e é replicada em §4. Duas cópias, sim — a alternativa seria a RPC importar
-- TypeScript.

alter table public.empresa_metricas
  drop constraint empresa_metricas_origem_check;

alter table public.empresa_metricas
  add constraint empresa_metricas_origem_check
  check (origem in
    ('declarado_cliente', 'publicacao', 'apollo', 'apollo_search', 'lista', 'modelo', 'bracket_simples'));

alter table public.empresas
  add column patrimonio_liquido numeric(16, 2),
  add column patrimonio_origem text,
  add column patrimonio_atualizado_em timestamptz;

comment on column public.empresas.patrimonio_liquido is
  'Cache do PL vigente. A série está em empresa_metricas. Pode ser NEGATIVO.';

-- ─── §3 O ano de referência de cada coluna da planilha ──────────────────────
-- Uma coluna por ano é a forma natural dessas listas ("Receita Bruta 2023",
-- "Receita Bruta 2024"). O ano é detectado do cabeçalho e CONFIRMADO na tela de
-- mapeamento — este jsonb guarda o que a pessoa confirmou, por coluna.

alter table public.importacoes_listas
  add column anos_colunas jsonb not null default '{}'::jsonb;

comment on column public.importacoes_listas.anos_colunas is
  'Ano de referência por coluna da planilha: { "Receita Bruta 2023 (R$)": 2023 }. '
  'Só as colunas mapeadas em métricas (faturamento/funcionários/PL) precisam dele.';

-- ─── §4 A hierarquia, como função ───────────────────────────────────────────
-- Espelha a RANK_ORIGEM de packages/core/src/radar/faturamento.ts. Uma função em
-- vez de três CASE copiados dentro da RPC: a ordem é uma regra só, e regra
-- duplicada é regra que diverge.

create or replace function public.app_rank_origem_metrica(p_origem text)
returns int language sql immutable set search_path = '' as $$
  select case p_origem
    when 'declarado_cliente' then 0
    when 'publicacao' then 1
    when 'apollo' then 2
    when 'apollo_search' then 3
    when 'lista' then 4
    when 'modelo' then 5
    when 'bracket_simples' then 6
    else 99  -- desconhecida ou nula: perde para qualquer leitura de verdade
  end;
$$;

comment on function public.app_rank_origem_metrica is
  'Menor é melhor. Espelha RANK_ORIGEM do core (packages/core/src/radar/faturamento.ts).';

-- ─── §5 A RPC de gravação ───────────────────────────────────────────────────

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
  -- Menor vence, igual à RANK_ORIGEM do core. `igual` também vence: a mesma
  -- fonte falando de novo é leitura mais recente, não leitura pior.
  v_rank_nova int;
  v_rank_vigente int;
begin
  -- Quem importa lista é o Mercado. O gate é o mesmo do resto do importador.
  if not public.app_tem_modulo('mercado') then
    raise exception 'Sem acesso ao módulo Mercado.' using errcode = '42501';
  end if;
  if v_metrica not in ('faturamento_anual', 'funcionarios', 'patrimonio_liquido') then
    raise exception 'Métrica inválida: %.', v_metrica using errcode = '22023';
  end if;
  -- Esta RPC é o caminho de LISTA. `declarado_cliente` continua exclusivo da
  -- app_declarar_metrica, que exige uma pessoa afirmando o número.
  if v_origem not in ('publicacao', 'lista') then
    raise exception 'Origem inválida para importação: %.', v_origem using errcode = '22023';
  end if;
  if v_valor is null then
    raise exception 'Valor inválido.' using errcode = '22023';
  end if;
  -- Só o PL pode ser negativo. Faturamento ou headcount negativo é erro de
  -- parsing da planilha, e gravá-lo contaminaria a régua do estimador.
  if v_valor < 0 and v_metrica <> 'patrimonio_liquido' then
    raise exception 'Valor negativo só é aceito em patrimonio_liquido.' using errcode = '22023';
  end if;

  select * into v_empresa from public.empresas where id = (p ->> 'empresa_id')::uuid;
  if v_empresa.id is null then
    raise exception 'Empresa não encontrada.' using errcode = 'no_data_found';
  end if;

  -- O snapshot é datado pelo ANO DO DADO, não pela data do upload. É o que faz a
  -- série ter dois pontos reais (2023 e 2024) e o crescimento 12m sair de graça,
  -- em vez de dois snapshots de hoje que o cálculo de variação leria como um só.
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

  v_rank_nova := public.app_rank_origem_metrica(v_origem);

  v_vigente := case v_metrica
    when 'faturamento_anual' then v_empresa.faturamento_origem
    when 'funcionarios' then v_empresa.funcionarios_origem
    else v_empresa.patrimonio_origem end;

  v_rank_vigente := public.app_rank_origem_metrica(v_vigente);

  -- Duas condições, e as duas foram descobertas testando.
  --
  -- A primeira é a hierarquia: origem nova tem que vencer a vigente.
  --
  -- A segunda impede o RETROCESSO DE ANO — importar "Receita 2023" depois de
  -- "Receita 2024" (a ordem em que as colunas aparecem na planilha) não pode fazer
  -- o valor vigente voltar um ano. Mas a comparação é só contra snapshots de origem
  -- IGUAL OU MELHOR: sem esse recorte, a estimativa que o modelo gravou hoje é
  -- sempre "mais recente" que qualquer ano publicado, e o ranking nunca entraria no
  -- cache — que é exatamente o bug que o teste pegou.
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

revoke execute on function public.app_registrar_metrica_importada(jsonb) from public;
grant execute on function public.app_registrar_metrica_importada(jsonb) to authenticated, service_role;

comment on function public.app_registrar_metrica_importada is
  'Registra faturamento, headcount ou PL vindos de LISTA IMPORTADA. Datado pelo ano '
  'do dado, não pelo upload. Respeita a hierarquia de origem e nunca rebaixa o cache '
  'com um ano mais antigo. Snapshot + cache + evento + audit numa transação.';
