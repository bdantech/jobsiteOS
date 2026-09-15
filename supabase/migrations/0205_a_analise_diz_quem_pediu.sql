-- ═════════════════════════════════════════════════════════════════════════════
-- 0205 — A análise de crédito diz quem a pediu
--
-- `analises_credito.solicitada_por` existe desde sempre e nunca chegou à tela: o
-- painel devolvia `to_jsonb(v_esteira)`, ou seja, o uuid ia junto e nenhum nome.
-- Quem abre a ficha de uma análise para decidir sobre R$ 3 milhões não tem como
-- perguntar "por que pediram isso?" sem saber a quem perguntar.
--
-- ─── POR QUE NA RPC, E NÃO NUMA SEGUNDA CONSULTA DA TELA ────────────────────
-- A ficha é declaradamente de UMA consulta só (ver o comentário de
-- `analise-detalhe.tsx`): esteira, empresa, score, protestos, NF-e, documentos e
-- a análise proprietária vêm juntos, porque quando vinham separados o cabeçalho
-- dizia "solicitada" enquanto o corpo já mostrava a decisão. Um nome a mais não
-- justifica reabrir esse buraco, e a RPC já faz oito buscas — esta é a nona.
--
-- ─── O CAMPO É NULO NA MAIORIA, E ISSO NÃO É FALTA DE DADO ─────────────────
-- Das 90 análises da base, 5 têm solicitante: são as de `origem = 'jobsiteos'`,
-- pedidas por alguém daqui. As outras 85 não foram pedidas por ninguém nosso —
-- 84 vieram do backfill da apólice da Atradius (já existiam lá quando ligamos a
-- integração) e 1 entrou pela API de produção.
--
-- Por isso a tela não pode escrever "—" e pronto: "ninguém pediu" e "não
-- sabemos quem pediu" são coisas diferentes, e `origem` é quem responde a
-- primeira. O nome vem daqui; a frase certa para cada origem é da tela.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.analise_propria_painel(p_analise_credito_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_esteira public.analises_credito;
  v_empresa public.empresas;
  v_score public.empresa_scores;
  v_propria public.analises_proprietarias;
  v_protesto jsonb;
  v_nfe jsonb;
  v_docs jsonb;
  v_certificado jsonb;
  v_opera boolean;
  v_janela int := 6;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito where id = p_analise_credito_id;
  if v_esteira.id is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select * into v_empresa from public.empresas where id = v_esteira.empresa_id;

  select * into v_score from public.empresa_scores
  where cnpj = v_esteira.cnpj order by calculado_em desc limit 1;

  select * into v_propria from public.analises_proprietarias
  where analise_credito_id = v_esteira.id order by criada_em desc limit 1;

  select to_jsonb(pa) into v_protesto from public.protestos_atual pa where pa.cnpj = v_esteira.cnpj;

  select exists (select 1 from public.clientes_onepay c where c.cnpj = v_esteira.cnpj) into v_opera;

  -- Divide pela JANELA inteira, não pelos meses em que houve nota: quem emitiu em dois
  -- dos seis meses tem média baixa, e é isso que o teto operacional deve enxergar.
  select jsonb_build_object(
           'janela_meses', v_janela,
           'total', coalesce(sum(n.valor), 0),
           'qtd', count(*),
           'media_mensal', coalesce(sum(n.valor), 0) / v_janela
         )
  into v_nfe
  from public.notas_fiscais n
  where n.sacado_cnpj = v_esteira.cnpj
    and n.emitida_em >= (now() - make_interval(months => v_janela));

  select jsonb_agg(to_jsonb(d) order by d.enviado_em desc) into v_docs
  from public.analise_docs d where d.analise_id = v_esteira.id;

  select jsonb_build_object('expires_at', c.expires_at, 'status', c.status)
  into v_certificado
  from public.certificados c where c.cnpj = v_esteira.cnpj;

  return jsonb_build_object(
    'encontrado', true,
    'esteira', to_jsonb(v_esteira),
    /*
     * QUEM PEDIU (0205). Nulo quando ninguém daqui pediu — a esmagadora maioria veio
     * do backfill da apólice. A tela usa `esteira.origem` para dizer qual dos dois
     * casos é, porque "ninguém pediu" e "não sabemos quem" não são a mesma frase.
     *
     * `usuarios` é legível por qualquer usuário ativo, então isto não amplia acesso
     * nenhum; está aqui só para a ficha continuar sendo uma consulta só.
     */
    'solicitante', (
      select jsonb_build_object('id', u.id, 'nome', u.nome, 'email', u.email)
      from public.usuarios u where u.id = v_esteira.solicitada_por
    ),
    'empresa', case when v_empresa.id is null then null else jsonb_build_object(
      'id', v_empresa.id, 'cnpj', v_empresa.cnpj, 'razao_social', v_empresa.razao_social,
      'nome_fantasia', v_empresa.nome_fantasia, 'tipo', v_empresa.tipo, 'estagio', v_empresa.estagio,
      'uf', v_empresa.uf, 'municipio', v_empresa.municipio,
      'faturamento_anual', v_empresa.faturamento_anual, 'faturamento_origem', v_empresa.faturamento_origem,
      'faturamento_confianca', v_empresa.faturamento_confianca,
      'funcionarios', v_empresa.funcionarios,
      'funcionarios_crescimento_12m', v_empresa.funcionarios_crescimento_12m,
      'limite_potencial', v_empresa.limite_potencial,
      'valor_esperado_mensal', v_empresa.valor_esperado_mensal,
      'patrimonio_liquido', v_empresa.patrimonio_liquido
    ) end,
    'metricas', (
      select jsonb_build_object(
               'qtd_filiais', m.qtd_filiais, 'grupo_spes_total', m.grupo_spes_total,
               'grupo_spes_24m', m.grupo_spes_24m, 'obras_ativas', m.obras_ativas,
               'm2_em_execucao', m.m2_em_execucao)
      from public.mercado_metricas m where m.cnpj = v_esteira.cnpj
    ),
    'score', case when v_score.id is null then null else to_jsonb(v_score) end,
    'propria', case when v_propria.id is null then null else to_jsonb(v_propria) end,
    'protestos', v_protesto,
    'certificado', v_certificado,
    'opera_na_plataforma', coalesce(v_opera, false),
    'nfe_observada', v_nfe,
    'docs', coalesce(v_docs, '[]'::jsonb),
    'parametros_ativos', (select definicao from public.analise_parametros where ativa)
  );
end;
$function$;
