-- ═════════════════════════════════════════════════════════════════════════════
-- 0204 — `dados_vendedor_id`: a outra metade do par que o Meu Dia já expunha
--
-- ─── O QUE ESTE CAMPO É ─────────────────────────────────────────────────────
-- A 0202 separou duas perguntas que o Meu Dia misturava: de quem é o DIA
-- (`v_pessoa`) e de quem são os DADOS (`v_dados`, o superior quando quem abre é
-- auxiliar). O payload passou a contar essa separação pela metade — `espelhado`
-- diz QUE o dia é de outra carteira, `vendedor_nome` diz DE QUEM — e nunca deu o
-- id. Sem id, qualquer tela que precise perguntar algo sobre essa pessoa tem de
-- refazer a regra do superior em TypeScript, que é exatamente a terceira cópia
-- que a 0202 apagou.
--
-- Uma chave a mais no mesmo objeto, sem nenhuma outra mudança nesta função.
--
-- ─── O QUE ELE NÃO É ────────────────────────────────────────────────────────
-- Ele NÃO é o escopo padrão da tela, e a correção desta nota é parte da história.
--
-- Este campo nasceu para o indicador de conversas sem identificação: o raciocínio
-- era "a fila é de quem tem número e carteira, então a auxiliar vê a do closer".
-- Estava errado. A fila de identificação é de quem RECEBEU a mensagem — e a
-- auxiliar ganha aparelho próprio. Mostrar a do closer faria duas pessoas olharem
-- para a mesma lista achando cada uma que é sua, e o resultado disso não é a fila
-- trabalhada em dobro: é ninguém pegando nenhuma.
--
-- O indicador ficou em `vendedor_id`. O campo ficou porque completa o par acima,
-- que é razão própria e independente do primeiro uso. Cada consumidor escolhe:
-- carteira e funis seguem os DADOS, o que é de quem recebeu segue a PESSOA.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app__md_montar(p_alvo uuid, p_config jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_tipo text; v_nome text; v_cargo text;
  /* De quem é o dia, e de quem são os dados. Iguais para todo mundo menos o auxiliar. */
  v_dados uuid; v_nome_dados text;
  v_alvos uuid[];
  v_cfg jsonb := p_config;
  v_ocultos text[]; v_orig uuid[]; v_passiva uuid[]; v_carteira uuid[];
  v_blocos jsonb := '[]'::jsonb;
  v_mapa jsonb := '[]'::jsonb;
  v_evolucao jsonb := '[]'::jsonb;
  v_funil jsonb := '[]'::jsonb;
begin
  select v.tipo, v.nome into v_tipo, v_nome from public.vendedores v where v.id = p_alvo;
  if v_tipo is null then
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true, 'blocos', '[]'::jsonb);
  end if;
  v_cargo := case when v_tipo = 'auxiliar' then 'vendedor' else v_tipo end;

  /*
   * O AUXILIAR TRABALHA A CARTEIRA DO CLOSER, e é aqui que isso acontece.
   *
   * Antes a tradução morava em `meu_dia()`, antes desta função — o que tinha dois
   * efeitos ruins. O gestor que escolhia o auxiliar no seletor passava o id dele
   * explicitamente, o coalesce de lá deixava passar, e o dia vinha vazio: o auxiliar
   * não tem carteira, nem vendas, nem tarefas próprias. E esta função nunca via
   * `tipo = 'auxiliar'`, então não havia onde pendurar a regra das reuniões.
   */
  v_dados := coalesce(
    (select s.superior_id from public.vendedores s where s.id = p_alvo and s.tipo = 'auxiliar'),
    p_alvo
  );
  select v.nome into v_nome_dados from public.vendedores v where v.id = v_dados;

  /* Os dois, sem repetir quando são o mesmo. */
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_alvos
  from unnest(array[v_dados, p_alvo]) x;

  /*
   * REUNIÃO É A EXCEÇÃO do espelhamento.
   *
   * O auxiliar não senta nas reuniões do closer, e `reunioes_pendentes_aceite` é
   * pior que só irrelevante: aceitar cria a comissão do SDR e prende o closer ao
   * compromisso. É decisão que gasta o dinheiro de outras duas pessoas, e ela já
   * tem desfecho no silêncio — em 48h aceita sozinha.
   *
   * Desligar pela CONFIG e não por um `if` em cada bloco: a config é o contrato que
   * `app__md_ativo` já lê, e um bloco novo de reunião entra nesta lista em vez de
   * exigir que alguém se lembre de repetir a condição.
   */
  if v_tipo = 'auxiliar' then
    v_cfg := v_cfg
      || jsonb_build_object('reunioes_proximas',
           coalesce(v_cfg -> 'reunioes_proximas', '{}'::jsonb) || jsonb_build_object('ativo', false))
      || jsonb_build_object('reunioes_pendentes_aceite',
           coalesce(v_cfg -> 'reunioes_pendentes_aceite', '{}'::jsonb) || jsonb_build_object('ativo', false));
  end if;

  /*
   * Adiado por um vale pelos dois. `app_meu_dia_ocultar` grava em
   * `(app_meu_dia_alvos())[1]`, e esse array vem de um `array_agg(distinct ...)` —
   * a ordem é a dos uuids, não a da intenção. Lendo os dois, tanto faz sob qual dos
   * dois o item caiu: eles trabalham a mesma fila.
   */
  select coalesce(array_agg(o.tipo_item || '|' || o.referencia_id), '{}'::text[])
    into v_ocultos
  from public.meu_dia_itens_ocultos o
  where o.vendedor_id = any(v_alvos)
    and (o.acao = 'irrelevante' or o.adiado_ate > current_date);

  select
    coalesce(array_agg(distinct c.empresa_id) filter (where c.papel in ('originacao','originador')), '{}'::uuid[]),
    coalesce(array_agg(distinct c.empresa_id) filter (where c.papel in ('gestao_passiva','vendedor')), '{}'::uuid[]),
    coalesce(array_agg(distinct c.empresa_id), '{}'::uuid[])
    into v_orig, v_passiva, v_carteira
  from public.vendedor_carteira c
  where c.vendedor_id = v_dados and c.ate is null;

  if v_cargo = 'originador' then
    v_blocos := v_blocos || public.app__md_originador(v_dados, v_cfg, v_ocultos, v_carteira, v_orig);
  elsif v_cargo = 'sdr' then
    v_blocos := v_blocos || public.app__md_sdr(v_dados, v_cfg, v_ocultos);
  elsif v_cargo = 'vendedor' then
    v_blocos := v_blocos || public.app__md_closer(v_dados, v_cfg, v_ocultos, v_carteira, v_passiva);
    v_blocos := v_blocos || public.app__md_sdr(v_dados, v_cfg, v_ocultos);
  end if;

  /* Conversas, sugestões do Agente e tarefas: as do closer MAIS as do auxiliar. */
  v_blocos := v_blocos || public.app__md_comuns(v_alvos, v_cfg, v_ocultos);

  /*
   * O MAPA É DA CARTEIRA PASSIVA, e ele passou a dizer a verdade.
   *
   * `v_passiva` junta os papéis `gestao_passiva` e `vendedor`, e no papel `vendedor`
   * cabem as duas naturezas. Na carteira do Fabio isso punha as 10 contas em
   * prospecção ativa num mapa chamado "Minha carteira passiva" — e elas são as
   * maiores: a Ribeiro Caram, com R$ 7 milhões de limite, era o maior retângulo.
   *
   * `is distinct from` e não `= 'passivo'`: conta sem classificação continua
   * aparecendo. Sumir do mapa do dono por causa de um campo em branco é pior que
   * aparecer com a natureza desconhecida — no primeiro caso ninguém descobre.
   *
   * O bloco "Carteira ociosa" continua com as duas naturezas e o filtro dele: o nome
   * não promete passividade, e o dinheiro parado na prospecção ativa é trabalho.
   */
  if v_cargo = 'vendedor' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'empresa_id', e.id, 'cnpj', co.cnpj,
             'nome', coalesce(public.app__md_nome(e.nome_fantasia),
                            public.app__md_nome(e.razao_social),
                            public.app__md_nome(co.nome), e.cnpj),
             'limite', coalesce(co.credit_limit, 0),
             'limite_disponivel', coalesce(co.available_limit, 0),
             'consumido_pct', coalesce(co.consumed_pct, 0),
             'dias_sem_antecipar', co.days_without_anticipation,
             'operation_status', co.operation_status
           ) order by coalesce(co.credit_limit, 0) desc), '[]'::jsonb)
      into v_mapa
    from public.clientes_onepay co
    join public.empresas e on e.id = co.empresa_id
    where e.id = any(v_passiva)
      and e.gestao_operacao is distinct from 'prospeccao_ativa';
  end if;

  if v_cargo = 'originador' then
    with meses as (
      select date_trunc('month', a.convertida_em at time zone 'America/Sao_Paulo')::date as competencia,
             sum(a.gross_value) as total
      from public.antecipacoes a
      join public.empresas e on e.cnpj = a.fornecedor_cnpj
      where e.id = any(v_orig) and a.convertida_em is not null
        and a.convertida_em > now() - interval '4 months'
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'competencia', m.competencia, 'total', m.total,
             'media_3m', (select avg(x.total) from meses x where x.competencia < m.competencia)
           ) order by m.competencia), '[]'::jsonb)
      into v_evolucao from meses m;
  end if;

  if v_cargo = 'sdr' then
    select jsonb_build_array(
      jsonb_build_object('etapa', 'Contatados', 'total',
        count(*) filter (where l.ultimo_toque_em > date_trunc('week', now()))),
      jsonb_build_object('etapa', 'Com fit', 'total',
        count(*) filter (where l.fit is true and l.fit_definido_em > date_trunc('week', now()))),
      jsonb_build_object('etapa', 'Agendados', 'total',
        count(*) filter (where l.reuniao_em > date_trunc('week', now()))),
      jsonb_build_object('etapa', 'Realizados', 'total',
        count(*) filter (where l.estagio in ('reuniao_realizada', 'qualificada')
                           and l.atualizado_em > date_trunc('week', now())))
    ) into v_funil
    from public.sdr_leads l where l.sdr_id = v_dados;
  end if;

  /*
   * `vendedor_id` é de quem é o DIA (o seletor do gestor precisa continuar batendo);
   * `vendedor_nome` é de quem é a CARTEIRA, que é o que o cabeçalho anuncia. Para o
   * auxiliar os dois diferem, e é justamente isso que "Carteira de Fabio Pagliarani"
   * no topo do dia da Pamela precisa dizer.
   */
  return jsonb_build_object(
    'tem_acesso', true, 'vendedor_id', p_alvo, 'vendedor_nome', coalesce(v_nome_dados, v_nome),
    'dados_vendedor_id', v_dados,
    'tipo', v_tipo, 'cargo', v_cargo, 'gerado_em', now(),
    'espelhado', v_dados is distinct from p_alvo,
    'blocos', v_blocos, 'mapa_carteira', v_mapa,
    'evolucao', v_evolucao, 'funil_semana', v_funil
  );
end $function$;
