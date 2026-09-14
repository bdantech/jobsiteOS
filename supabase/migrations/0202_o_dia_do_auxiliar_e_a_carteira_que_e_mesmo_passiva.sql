-- ═════════════════════════════════════════════════════════════════════════════
-- 0202 — O dia do auxiliar, a carteira que é mesmo passiva, e o tamanho de quem
--        vai sentar na reunião
--
-- Três pedidos sobre o Meu Dia (04p), e um quarto problema que apareceu ao ir
-- atrás do primeiro.
--
-- ─── 1. O DIA DO AUXILIAR ───────────────────────────────────────────────────
-- Ele já espelhava o do closer — `cargoDeVisao('auxiliar') = 'vendedor'` desde a
-- 0189 —, e espelhava DEMAIS: vinham junto os dois blocos de reunião.
--
-- Reunião é a exceção que o próprio desenho do cargo pede. O auxiliar trabalha o
-- dia a dia do closer (documento parado, proposta sem resposta, crédito decidido,
-- carteira ociosa, certificado vencendo) e não senta nas reuniões dele.
--
-- `reunioes_pendentes_aceite` sai pelo motivo mais forte, e ele não é de tela:
-- aceitar uma reunião CRIA a comissão do SDR (`sdr_valor_reuniao`) e prende o
-- closer a um compromisso. É decisão que gasta o dinheiro de duas outras pessoas,
-- e o silêncio já tem desfecho definido — em 48h ela aceita sozinha. Um auxiliar
-- que não decide não quebra nada; um que decide, decide por dois.
--
-- ─── 2. O DIA DO AUXILIAR ESTAVA VAZIO PARA O GESTOR ────────────────────────
-- Este não foi pedido; apareceu ao conferir o primeiro, e é o mais grave dos
-- quatro.
--
-- `meu_dia()` resolvia o superior ANTES de chamar o agregador: quem entrava como
-- auxiliar já chegava lá como o closer. Isso funcionava para a própria pessoa e
-- quebrava nos outros dois caminhos.
--
--   * O GESTOR escolhendo "Pamela Oliveira" no seletor passa `p_vendedor_id`
--     explícito, que ganha do coalesce — o agregador recebia Pamela, e Pamela tem
--     zero carteira, zero vendas e zero tarefas. O dia vinha VAZIO, e um dia vazio
--     não parece bug: parece que a pessoa não tem trabalho.
--   * E o agregador nunca via `tipo = 'auxiliar'`, porque a tradução acontecia
--     antes dele. Não havia onde pendurar a regra do item 1.
--
-- A separação é a correção: `v_pessoa` é de QUEM é o dia; `v_dados` é de quem são
-- os dados. Para todo mundo os dois são o mesmo; para o auxiliar, `v_dados` é o
-- closer. A regra de reunião pendura em `v_pessoa`, os números em `v_dados`.
--
-- ─── 3. "MINHA CARTEIRA PASSIVA" MOSTRAVA PROSPECÇÃO ATIVA ──────────────────
-- O treemap lê `v_passiva`, que junta os papéis `gestao_passiva` e `vendedor` — e
-- no papel `vendedor` cabem as duas naturezas. Na carteira do Fabio são 19 contas
-- passivas e 10 em prospecção ativa, e as ativas são as MAIORES: a Ribeiro Caram,
-- com R$ 7 milhões de limite, é o maior retângulo de um mapa intitulado "Minha
-- carteira passiva".
--
-- O discriminador é `empresas.gestao_operacao`, que existe para isso e é o mesmo
-- que o bloco "Carteira ociosa" já carrega no `meta`. `is distinct from` e não
-- `= 'passivo'`: conta sem classificação continua aparecendo. Sumir do mapa do
-- dono por causa de um campo em branco é pior que aparecer com a natureza
-- desconhecida — no primeiro caso ninguém descobre, no segundo alguém classifica.
--
-- O bloco "Carteira ociosa" NÃO muda: o nome dele não promete passividade, ele
-- tem filtro de natureza desde a 0190, e o dinheiro parado na prospecção ativa
-- (R$ 13,4 dos R$ 18,0 milhões do Fabio) é trabalho de alguém.
--
-- ─── 4. O VALOR DA REUNIÃO ERA A NOSSA RECEITA, NÃO O TAMANHO DA EMPRESA ────
-- `reunioes_proximas` mostrava `valor_esperado_mensal` — o que esperamos faturar
-- com a empresa. Duas coisas erradas nisso:
--
--   * metade das empresas não tem o campo preenchido. A Metalúrgica RPL, reunião
--     de amanhã, está nula: a linha aparecia sem número nenhum.
--   * não é a pergunta que se faz antes de uma reunião. O que muda a preparação é
--     o TAMANHO de quem vai sentar do outro lado. A Aliança MB fatura R$ 716
--     milhões e vale R$ 29 mil/mês para nós; são conversas diferentes, e a receita
--     esperada não distingue as duas — ela é derivada nossa.
--
-- Passa a ser `empresas.faturamento_anual`, com a origem no `meta` para a tela
-- poder dizer se é declarado ou estimado, e com `valor_esperado_mensal` guardado
-- ao lado para não perder o que já estava sendo mostrado.
--
-- O CUIDADO QUE ISSO EXIGE, e que mora no core: o bloco saiu do "Em jogo hoje".
-- São grandezas com três ordens de magnitude de diferença, e somar faturamento de
-- cliente num indicador chamado "em jogo hoje" transformaria o número que o
-- vendedor usa para se orientar numa ficção. Ver `foraDoEmJogo` no catálogo.
--
-- ─── UM BUG DE LADO, QUE ESTA MIGRAÇÃO NEUTRALIZA SEM CONSERTAR ────────────
-- `app_meu_dia_ocultar` grava em `(app_meu_dia_alvos())[1]`, e `app_meu_dia_alvos`
-- monta o array com `array_agg(distinct ...)` — a ordem é a dos uuids, não a da
-- intenção. Quando a Pamela adia um item, ele é gravado ora sob ela, ora sob o
-- Fabio, conforme qual uuid ordena primeiro.
--
-- Aqui a leitura passa a ser `= any(alvos)`, com os dois. O item adiado some da
-- lista de qualquer um dos dois lados, que é o comportamento que se esperava dos
-- dois desde o começo — eles trabalham a mesma fila. O `[1]` continua lá e
-- continua arbitrário; ele deixou de ter consequência.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 Os blocos comuns passam a aceitar MAIS DE UMA pessoa ────────────────
--
-- Conversa parada, conversa esperando resposta, sugestão do Agente e tarefa
-- manual eram todas de um `p_alvo` só. Para o auxiliar isso significa que as
-- CONVERSAS DELA e as TAREFAS DELA não apareciam em lugar nenhum: o dia inteiro
-- era do closer. Uma tela que existe para ser a lista de trabalho de alguém e não
-- mostra as tarefas dessa pessoa é a tela que ela para de abrir.
--
-- Array e não dois parâmetros: os outros três cargos passam um elemento só e nada
-- muda para eles.

drop function if exists public.app__md_comuns(uuid, jsonb, text[]);

create or replace function public.app__md_comuns(p_alvos uuid[], p_config jsonb, p_ocultos text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_blocos jsonb := '[]'::jsonb;
  v_itens jsonb; v_total int; v_valor numeric; v_max int; v_d numeric;
begin
  if public.app__md_ativo(p_config, 'conversas_paradas') then
    v_max := public.app__md_max(p_config, 'conversas_paradas');
    v_d := public.app__md_lim(p_config, 'conversas_paradas', 'dias_parada', 5);
    with base as (
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      public.app__md_nome(ct.nome), public.app__md_nome(nv.nome_sugerido),
                      c.identificador_externo, 'Contato sem nome') as titulo,
             coalesce(c.objetivo, 'sem objetivo') || ' · ' || c.canal as subtitulo,
             'Objetivo aberto e sem toque há ' || extract(day from now() - c.ultima_mensagem_em)::int || ' dias' as motivo,
             e.valor_esperado_mensal as valor,
             'media'::text as urgencia,
             extract(day from now() - c.ultima_mensagem_em)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('conversa_id', c.id) as meta,
             extract(epoch from now() - c.ultima_mensagem_em) as ord
      from public.conversas c
      left join public.empresas e on e.id = c.empresa_id
      left join public.contatos ct on ct.id = c.contato_id
      left join lateral (
        select n.nome_sugerido from public.conversas_nao_vinculadas n
        where n.identificador_externo = c.identificador_externo
           or (c.lid is not null and n.lid = c.lid)
        order by (n.nome_sugerido is null), n.ultima_mensagem_em desc
        limit 1
      ) nv on true
      where c.responsavel_vendedor_id = any(p_alvos)
        and c.objetivo is not null and c.status <> 'encerrada'
        and c.ultima_mensagem_em < now() - make_interval(days => v_d::int)
        and not (('conversas_paradas|' || c.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('conversas_paradas', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'conversas_aguardando_resposta') then
    v_max := public.app__md_max(p_config, 'conversas_aguardando_resposta');
    with base as (
      /*
       * O TÍTULO NUNCA É "Sem empresa" NEM UM NÚMERO DE TELEFONE.
       *
       * A ordem é a da confiança: razão social, nome fantasia, nome do contato no CRM,
       * nome do perfil de quem escreveu, e só então o número. Trinta e cinco das trinta
       * e oito conversas sem ficha do originador têm nome de perfil.
       */
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      public.app__md_nome(ct.nome), public.app__md_nome(nv.nome_sugerido),
                      c.identificador_externo, 'Contato sem nome') as titulo,
             case when e.id is null then c.canal || ' · sem ficha no CRM'
                  else coalesce(ct.nome, 'contato') || ' · ' || c.canal end as subtitulo,
             'Esperando resposta há '
               || greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int
               || 'h' as motivo,
             null::numeric as valor,
             case when c.ultima_mensagem_em < now() - interval '24 hours' then 'alta' else 'media' end::text as urgencia,
             greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object(
               'conversa_id', c.id,
               'nao_lidas', c.nao_lidas,
               /* O eixo do gráfico: horas esperando, do maior para o menor. */
               'horas', greatest(round(extract(epoch from now() - c.ultima_mensagem_em) / 3600), 0)::int,
               'canal', c.canal
             ) as meta,
             extract(epoch from now() - c.ultima_mensagem_em) as ord
      from public.conversas c
      left join public.empresas e on e.id = c.empresa_id
      left join public.contatos ct on ct.id = c.contato_id
      left join lateral (
        select n.nome_sugerido from public.conversas_nao_vinculadas n
        where n.identificador_externo = c.identificador_externo
           or (c.lid is not null and n.lid = c.lid)
        order by (n.nome_sugerido is null), n.ultima_mensagem_em desc
        limit 1
      ) nv on true
      /* A bola está comigo: a última mensagem foi RECEBIDA. */
      where c.responsavel_vendedor_id = any(p_alvos)
        and c.ultima_direcao = 'entrada' and c.status <> 'encerrada'
        and not (('conversas_aguardando_resposta|' || c.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('conversas_aguardando_resposta', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'proximos_passos_agente') then
    v_max := public.app__md_max(p_config, 'proximos_passos_agente');
    v_d := public.app__md_lim(p_config, 'proximos_passos_agente', 'confianca_minima', 0);
    with base as (
      select c.id::text as referencia_id,
             coalesce(public.app__md_nome(i.empresa_nome), public.app__md_nome(i.contato_nome),
                      i.identificador_externo, 'Contato sem nome') as titulo,
             coalesce(i.contato_nome, 'contato') || ' · ' || i.sugestao_acao as subtitulo,
             coalesce(i.sugestao_justificativa, 'O Agente sugeriu um próximo passo') as motivo,
             null::numeric as valor,
             'media'::text as urgencia,
             extract(day from now() - i.ultima_mensagem_em)::int as dias,
             i.empresa_id, null::timestamptz as quando,
             jsonb_build_object('conversa_id', c.id, 'sugestao_id', i.sugestao_id,
                                'conteudo', i.sugestao_conteudo, 'confianca', i.sugestao_confianca) as meta,
             coalesce(i.sugestao_confianca, 0) as ord
      from public.inbox_conversas i
      join public.conversas c on c.id = i.id
      where i.responsavel_vendedor_id = any(p_alvos)
        and i.sugestao_id is not null
        and coalesce(i.sugestao_confianca, 0) >= v_d
        and not (('proximos_passos_agente|' || c.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('proximos_passos_agente', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'tarefas_manuais') then
    v_max := public.app__md_max(p_config, 'tarefas_manuais');
    with base as (
      select t.id::text as referencia_id,
             t.titulo,
             coalesce(public.app__md_nome(e.razao_social), public.app__md_nome(e.nome_fantasia),
                      t.detalhe) as subtitulo,
             (case
               when t.vence_em is null then 'Sem prazo'
               when t.vence_em < current_date then 'Venceu em ' || to_char(t.vence_em, 'DD/MM')
               when t.vence_em = current_date then 'Vence hoje'
               else 'Vence em ' || to_char(t.vence_em, 'DD/MM')
             end
             /*
              * DE QUEM É A TAREFA, quando não é de quem manda na lista.
              *
              * Só aparece no caso do auxiliar, que é o único em que `p_alvos` tem mais
              * de um nome. Sem isto, a tarefa dela e a do closer ficariam
              * indistinguíveis numa lista só — e "concluir" é um botão que não admite
              * ambiguidade sobre de quem era a obrigação.
              */
             || case when t.vendedor_id is distinct from p_alvos[1]
                     then ' · tarefa de ' || coalesce(vd.nome, 'outro vendedor')
                     else '' end) as motivo,
             null::numeric as valor,
             case
               when t.vence_em is not null and t.vence_em <= current_date then 'alta'
               when t.vence_em is not null and t.vence_em <= current_date + 2 then 'media'
               else 'baixa'
             end::text as urgencia,
             case when t.vence_em is null then null else (current_date - t.vence_em) end as dias,
             t.empresa_id,
             case when t.vence_em is null then null else t.vence_em::timestamptz end as quando,
             jsonb_build_object('tarefa_id', t.id, 'vendedor_id', t.vendedor_id,
                                'vendedor_nome', vd.nome) as meta,
             coalesce(t.vence_em, current_date + 3650) as ord
      from public.meu_dia_tarefas t
      left join public.empresas e on e.id = t.empresa_id
      left join public.vendedores vd on vd.id = t.vendedor_id
      where t.vendedor_id = any(p_alvos) and t.concluida_em is null
        and not (('tarefas_manuais|' || t.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord asc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), 0
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('tarefas_manuais', v_itens, v_total, v_valor);
  end if;

  return v_blocos;
end $function$;

-- ─── §2 O valor da reunião é o tamanho da empresa ───────────────────────────
--
-- Só o bloco `reunioes_proximas` muda; o resto de `app__md_sdr` está aqui porque
-- plpgsql se substitui inteiro.

create or replace function public.app__md_sdr(p_alvo uuid, p_config jsonb, p_ocultos text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_blocos jsonb := '[]'::jsonb;
  v_itens jsonb; v_total int; v_valor numeric; v_max int; v_d numeric; v_d2 numeric;
begin
  if public.app__md_ativo(p_config, 'inbound_nao_contatado') then
    v_max := public.app__md_max(p_config, 'inbound_nao_contatado');
    v_d := public.app__md_lim(p_config, 'inbound_nao_contatado', 'horas_alerta', 4);
    with base as (
      select l.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as titulo,
             coalesce(e.municipio || '/' || e.uf, e.uf, 'sem localização') as subtitulo,
             'Chegou há ' || greatest(round(extract(epoch from now() - l.distribuido_em) / 3600), 0)::int
               || 'h e ninguém respondeu' as motivo,
             e.valor_esperado_mensal as valor,
             case when extract(epoch from now() - l.distribuido_em) / 3600 >= v_d then 'alta' else 'media' end::text as urgencia,
             greatest(round(extract(epoch from now() - l.distribuido_em) / 3600), 0)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('lead_id', l.id, 'horas',
                                greatest(round(extract(epoch from now() - l.distribuido_em) / 3600), 0)::int) as meta,
             extract(epoch from now() - l.distribuido_em) as ord
      from public.sdr_leads l
      join public.empresas e on e.id = l.empresa_id
      where l.sdr_id = p_alvo and l.encerrado_em is null
        and l.origem = 'inbound' and l.estagio = 'a_contatar'
        and coalesce(l.ultimo_toque_em, l.distribuido_em) <= l.distribuido_em
        and not (('inbound_nao_contatado|' || l.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('inbound_nao_contatado', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'leads_sla') then
    v_max := public.app__md_max(p_config, 'leads_sla');
    v_d := public.app__md_lim(p_config, 'leads_sla', 'sla_dias', 7);
    v_d2 := public.app__md_lim(p_config, 'leads_sla', 'avisar_faltando_dias', 2);
    with base as (
      select l.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as titulo,
             'No funil desde ' || to_char(l.distribuido_em, 'DD/MM') as subtitulo,
             'Volta ao pool em ' || greatest(v_d::int - extract(day from now() - coalesce(l.ultimo_toque_em, l.distribuido_em))::int, 0)
               || ' dia(s) sem toque' as motivo,
             e.valor_esperado_mensal as valor,
             'alta'::text as urgencia,
             extract(day from now() - coalesce(l.ultimo_toque_em, l.distribuido_em))::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('lead_id', l.id) as meta,
             extract(epoch from now() - coalesce(l.ultimo_toque_em, l.distribuido_em)) as ord
      from public.sdr_leads l
      join public.empresas e on e.id = l.empresa_id
      where l.sdr_id = p_alvo and l.encerrado_em is null and l.estagio in ('a_contatar', 'em_conversa')
        and coalesce(l.ultimo_toque_em, l.distribuido_em) < now() - make_interval(days => greatest((v_d - v_d2)::int, 0))
        and not (('leads_sla|' || l.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('leads_sla', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'no_shows') then
    v_max := public.app__md_max(p_config, 'no_shows');
    with base as (
      select l.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as titulo,
             'Reunião era ' || to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as subtitulo,
             'Não apareceu e ninguém remarcou' as motivo,
             e.valor_esperado_mensal as valor,
             'alta'::text as urgencia,
             extract(day from now() - coalesce(l.reuniao_em, l.atualizado_em))::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('lead_id', l.id) as meta,
             extract(epoch from now() - coalesce(l.reuniao_em, l.atualizado_em)) as ord
      from public.sdr_leads l
      join public.empresas e on e.id = l.empresa_id
      where l.sdr_id = p_alvo and l.encerrado_em is null and l.estagio = 'no_show'
        and not (('no_shows|' || l.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('no_shows', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'fit_sem_agendamento') then
    v_max := public.app__md_max(p_config, 'fit_sem_agendamento');
    v_d := public.app__md_lim(p_config, 'fit_sem_agendamento', 'dias_parada', 2);
    with base as (
      select l.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as titulo,
             'Fit confirmado em ' || to_char(l.fit_definido_em, 'DD/MM') as subtitulo,
             'Você já disse que serve — falta marcar' as motivo,
             e.valor_esperado_mensal as valor,
             'media'::text as urgencia,
             extract(day from now() - l.fit_definido_em)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('lead_id', l.id) as meta,
             coalesce(e.valor_esperado_mensal, 0) as ord
      from public.sdr_leads l
      join public.empresas e on e.id = l.empresa_id
      where l.sdr_id = p_alvo and l.encerrado_em is null and l.fit is true
        and l.reuniao_em is null and l.estagio not in ('reuniao_agendada', 'reuniao_realizada', 'qualificada')
        and l.fit_definido_em < now() - make_interval(days => v_d::int)
        and not (('fit_sem_agendamento|' || l.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('fit_sem_agendamento', v_itens, v_total, v_valor);
  end if;

  /*
   * REUNIÕES DE HOJE E AMANHÃ — o valor é o FATURAMENTO DA EMPRESA.
   *
   * Era `valor_esperado_mensal`, a receita que esperamos tirar dela, e isso falhava
   * de duas formas de uma vez: metade das empresas tem o campo nulo (a linha saía
   * sem número), e não é a pergunta que se faz antes de uma reunião. O que muda a
   * preparação é o tamanho de quem vai sentar do outro lado.
   *
   * A origem viaja no `meta` porque "estimado pelo modelo" e "declarado pelo
   * cliente" não valem o mesmo, e a tela já distingue os dois em todo lugar. E o
   * `valor_esperado_mensal` vai junto: ele deixou de ser o número principal, não
   * deixou de existir.
   *
   * A ordem continua sendo a HORA da reunião, e não o tamanho: esta é uma lista de
   * agenda. Ordenar por faturamento poria a reunião das 17h antes da das 9h.
   */
  if public.app__md_ativo(p_config, 'reunioes_proximas') then
    v_max := public.app__md_max(p_config, 'reunioes_proximas');
    v_d := public.app__md_lim(p_config, 'reunioes_proximas', 'horizonte_dias', 2);
    with base as (
      select l.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj) as titulo,
             to_char(l.reuniao_em at time zone 'America/Sao_Paulo', 'DD/MM às HH24:MI')
               || case when e.faturamento_anual is null then ''
                       when e.faturamento_origem = 'declarado_cliente'
                         then ' · faturamento declarado'
                       else ' · faturamento estimado' end as subtitulo,
             'Confirme antes que vire no-show' as motivo,
             e.faturamento_anual as valor,
             case when l.reuniao_em < now() + interval '24 hours' then 'alta' else 'media' end::text as urgencia,
             extract(day from l.reuniao_em - now())::int as dias,
             e.id as empresa_id, l.reuniao_em as quando,
             jsonb_build_object('lead_id', l.id,
                                'faturamento_origem', e.faturamento_origem,
                                'valor_esperado_mensal', e.valor_esperado_mensal) as meta,
             extract(epoch from l.reuniao_em) as ord
      from public.sdr_leads l
      join public.empresas e on e.id = l.empresa_id
      where (l.sdr_id = p_alvo or l.vendedor_destino_id = p_alvo)
        and l.encerrado_em is null and l.reuniao_em is not null
        and l.reuniao_em between now() and now() + make_interval(days => v_d::int)
        and not (('reunioes_proximas|' || l.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord asc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('reunioes_proximas', v_itens, v_total, v_valor);
  end if;

  if public.app__md_ativo(p_config, 'conversas_sem_reuniao') then
    v_max := public.app__md_max(p_config, 'conversas_sem_reuniao');
    v_d := public.app__md_lim(p_config, 'conversas_sem_reuniao', 'dias_parada', 3);
    with base as (
      select c.id::text as referencia_id,
             coalesce(e.razao_social, e.nome_fantasia, e.cnpj, 'Sem empresa') as titulo,
             coalesce(ct.nome, 'contato') || ' · ' || c.canal as subtitulo,
             'Conversa começou e parou antes de agendar' as motivo,
             e.valor_esperado_mensal as valor,
             'media'::text as urgencia,
             extract(day from now() - c.ultima_mensagem_em)::int as dias,
             e.id as empresa_id, null::timestamptz as quando,
             jsonb_build_object('conversa_id', c.id) as meta,
             extract(epoch from now() - c.ultima_mensagem_em) as ord
      from public.conversas c
      left join public.empresas e on e.id = c.empresa_id
      left join public.contatos ct on ct.id = c.contato_id
      where c.responsavel_vendedor_id = p_alvo
        and c.status <> 'encerrada'
        and c.ultima_mensagem_em < now() - make_interval(days => v_d::int)
        and not exists (
          select 1 from public.sdr_leads l
          where l.empresa_id = c.empresa_id and l.encerrado_em is null and l.reuniao_em is not null
        )
        and not (('conversas_sem_reuniao|' || c.id::text) = any(p_ocultos))
    )
    select coalesce((select jsonb_agg(to_jsonb(b) - 'ord') from (select * from base order by ord desc limit v_max) b), '[]'::jsonb),
           (select count(*)::int from base), (select coalesce(sum(valor), 0) from base)
      into v_itens, v_total, v_valor;
    v_blocos := v_blocos || public.app__md_bloco('conversas_sem_reuniao', v_itens, v_total, v_valor);
  end if;

  return v_blocos;
end $function$;

-- ─── §3 De quem é o dia × de quem são os dados ──────────────────────────────

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
    'tipo', v_tipo, 'cargo', v_cargo, 'gerado_em', now(),
    'espelhado', v_dados is distinct from p_alvo,
    'blocos', v_blocos, 'mapa_carteira', v_mapa,
    'evolucao', v_evolucao, 'funil_semana', v_funil
  );
end $function$;

-- ─── §4 `meu_dia()` para de traduzir o auxiliar antes da hora ───────────────

create or replace function public.meu_dia(p_vendedor_id uuid default null, p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_eu uuid := public.app_vendedor_atual();
  v_alvo uuid;
  v_res jsonb;
begin
  if not public.app_tem_modulo('comercial') then
    return jsonb_build_object('tem_acesso', false);
  end if;

  /*
   * O SUPERIOR SAIU DAQUI (ver §3). Quem entra como auxiliar chega ao agregador como
   * ele mesmo, e é lá que a carteira do closer é buscada. Resolver antes fazia o
   * gestor que escolhe o auxiliar no seletor receber um dia vazio, e escondia do
   * agregador o único fato de que ele precisa para aplicar a regra das reuniões.
   */
  v_alvo := coalesce(p_vendedor_id, v_eu);

  if v_alvo is null then
    return jsonb_build_object('tem_acesso', true, 'sem_vendedor', true, 'blocos', '[]'::jsonb);
  end if;
  if not public.app_pode_ver_vendedor(v_alvo) then
    return jsonb_build_object('tem_acesso', false);
  end if;

  v_res := public.app__md_montar(v_alvo, p_config);

  /*
   * `espelhado` significa "este dia não é meu" — e agora ele tem duas origens: o
   * gestor olhando o dia de outra pessoa, e o auxiliar olhando a carteira do closer.
   * O cabeçalho usa isso para trocar "Meu Dia" por "Carteira de {nome}"; perder
   * qualquer uma das duas faria o título mentir num dos casos.
   */
  return v_res || jsonb_build_object(
    'espelhado', coalesce((v_res ->> 'espelhado')::boolean, false) or (v_alvo is distinct from v_eu)
  );
end $function$;

comment on function public.meu_dia is
  'O Meu Dia (04p) de quem pergunta, ou de quem o gestor escolher. O auxiliar do closer '
  'chega aqui como ele mesmo: quem troca a carteira pela do superior é `app__md_montar`, '
  'que é quem também sabe que reunião não é assunto do auxiliar.';
