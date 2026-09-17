-- ═════════════════════════════════════════════════════════════════════════════
-- 0212 — A análise diz que o envio falhou, e por quê
--
-- ─── O QUE ACONTECEU COM A GEL ──────────────────────────────────────────────
-- Hoje às 13:57 alguém tentou enviar a GEL ENGENHARIA (GOETZE LOBATO) à Atradius. O
-- envio falhou em `resolverBuyer`, o primeiro passo, com um motivo específico:
--
--     "CNPJ não encontrado como buyer na seguradora."
--
-- O worker fez tudo certo: `registrarFalha` gravou o evento em `empresa_eventos`, e a
-- regra de fan-out da 0193 o transformou em notificação no sino de quem cuida da
-- esteira. O que NÃO aconteceu foi o evento chegar à própria análise. Quem abriu
-- `/credito/analises/59abc756...` viu "Solicitada" e mais nada — indistinguível de uma
-- análise que ninguém tinha tentado enviar ainda.
--
-- O resultado é o pior tipo de silêncio: a pessoa clica em "Enviar" de novo, gasta de
-- novo a consulta de buyer (que PODE SER COBRADA) e recebe o mesmo nada.
--
-- ─── POR QUE NA RPC, E NÃO NUMA SEGUNDA CONSULTA DA TELA ────────────────────
-- O mesmo argumento da 0205, que trouxe o solicitante: a ficha é declaradamente de UMA
-- consulta só. Quando esteira e cabeçalho vinham de consultas diferentes, um dizia
-- "solicitada" enquanto o outro já mostrava a decisão. Este campo é a décima busca da
-- função, e reabrir aquele buraco por causa dela não se paga.
--
-- ─── SOBRE O CADASTRO DO BUYER, QUE ESTA MIGRAÇÃO NÃO RESOLVE ──────────────
-- Conferido no handbook oficial da Buyers API da Atradius: NÃO EXISTE endpoint de
-- criação. Os três são GET (`/buyers`, `/buyers/{id}`, `/buyer/my-buyers`), e o próprio
-- handbook diz o que fazer quando a busca volta vazia:
--
--     "In the rare case of a buyer search not bringing back results, the customer can
--      contact the Atradius business representative for support."
--
-- Ou seja: cadastro é contato manual com o representante. Por isso a tarja, no caso de
-- "não encontrado", explica isso e mostra CNPJ e razão social prontos para copiar — em
-- vez de oferecer um botão que não existe do outro lado.
--
-- O que o handbook TAMBÉM diz, e que ainda não usamos: `/buyers` aceita `name` e
-- `address` além de `uId`. Antes de concluir que a empresa não está cadastrada, cabe
-- procurar por nome. Fica para uma próxima — é chamada paga e pede escolha humana entre
-- os resultados, que o handbook avisa que vêm em volume.
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
    /*
     * A ÚLTIMA TENTATIVA DE ENVIO QUE FALHOU (0212).
     *
     * `registrarFalha` no worker já gravava o motivo em `empresa_eventos` — e ele
     * chegava ao sino, pela regra de fan-out da 0193. O que não chegava a lugar nenhum
     * era a PRÓPRIA ANÁLISE: ela ficava em "Solicitada", idêntica a uma que ninguém
     * tinha tentado enviar. A GEL ENGENHARIA passou horas assim, e a pergunta "por que
     * não foi?" só teve resposta com alguém abrindo o banco.
     *
     * Casa por `payload ->> 'analise_id'` e não por empresa: a mesma empresa pode ter
     * mais de uma análise, e mostrar a falha da outra seria pior que não mostrar nada.
     */
    'ultima_falha_envio', (
      select jsonb_build_object('motivo', ev.payload ->> 'resumo', 'em', ev.criado_em)
        from public.empresa_eventos ev
       where ev.tipo = 'analise.envio_falhou'
         and ev.payload ->> 'analise_id' = v_esteira.id::text
       order by ev.criado_em desc
       limit 1
    ),
    'parametros_ativos', (select definicao from public.analise_parametros where ativa)
  );
end;
$function$;
