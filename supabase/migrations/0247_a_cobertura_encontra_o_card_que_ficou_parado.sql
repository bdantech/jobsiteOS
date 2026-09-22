-- ═════════════════════════════════════════════════════════════════════════════
-- 0247 — A cobertura que voltou encontra o card que ficou parado
--
-- ─── O CASO ─────────────────────────────────────────────────────────────────
-- O CNPJ não está cadastrado como buyer na Atradius, e não existe cadastro por API
-- (0212/0216). O analista abre o pedido direto no portal da seguradora e marca o card
-- como "enviada à mão". A partir daí o card não tem `atradius_case_id` — e é exatamente
-- por ele que `pollDecisoes` pergunta e que `syncAtradius` casa.
--
-- O efeito: a seguradora decide, a análise fica CONCLUÍDA no portal, e o card continua
-- parado na coluna "enviada à seguradora" para sempre. Em 22/09/2026 havia três assim, e
-- dois (HITACHI ENERGY e NEOBETEL) já tinham desfecho do lado de lá.
--
-- ─── AS DUAS PONTES, E POR QUE SÃO DUAS ─────────────────────────────────────
-- 1. AUTOMÁTICA, por CNPJ (worker, `adotarPedidosAbertos`): quando a apólice passa a ter
--    uma cobertura de um CNPJ que está parado aqui, e ela não tem dono, ela vira o
--    `atradius_case_id` daquele card. Roda no sync, duas vezes por dia.
-- 2. À MÃO, por número de cover (esta migração): o `app_vincular_pedido_seguradora`.
--
-- A segunda existe porque a primeira RECUSA ambiguidade: dois cards abertos do mesmo
-- CNPJ, ou duas coberturas livres para ele, não viram escolha automática — escolher entre
-- dois limites aprovados é decisão de gente, e um limite errado só aparece quando alguém
-- já operou em cima dele. E há o caso que CNPJ nenhum resolve: a Atradius cadastrou o
-- buyer sob outra inscrição (a matriz, uma filial), e só quem tem o número do cover na
-- mão consegue dizer que é o mesmo pedido.
--
-- Até aqui o número do cover só podia ser informado NA HORA de marcar o envio à mão
-- (0216) — e o caso comum é justamente mandar hoje e receber o número depois.
--
-- ─── O ÍNDICE ÚNICO ─────────────────────────────────────────────────────────
-- Um cover pertence a UMA análise. O código já mantinha isso (o backfill procura por
-- `atradius_case_id` antes de inserir), mas nada no banco impedia duas linhas de
-- apontarem para a mesma cobertura — e agora existem dois caminhos novos escrevendo esse
-- campo. Duas análises no mesmo cover fariam o poll gravar o mesmo limite aprovado em
-- dois cards, e a conciliação de carteira contaria a cobertura duas vezes.
-- ═════════════════════════════════════════════════════════════════════════════

-- Parcial: `null` é o estado normal de toda análise que ainda não foi à seguradora, e
-- nulo não conflita com nulo em índice único — mas o `where` deixa a intenção escrita e
-- mantém o índice do tamanho do que ele protege.
create unique index if not exists analises_credito_atradius_case_id_unico
  on public.analises_credito (atradius_case_id)
  where atradius_case_id is not null;

comment on index public.analises_credito_atradius_case_id_unico is
  'Um cover da seguradora pertence a uma análise só (0247). Sem isto, o poll gravaria o '
  'mesmo limite aprovado em dois cards e a carteira contaria a cobertura duas vezes.';

create or replace function public.app_vincular_pedido_seguradora(p jsonb)
returns public.analises_credito
language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_case text := nullif(btrim(p ->> 'atradius_case_id'), '');
  v_anterior text;
  v_dono uuid;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  if v_case is null then
    raise exception 'Informe o número do cover da seguradora.' using errcode = '22023';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  /*
   * Só de "enviada à seguradora" ou "em análise".
   *
   * Vincular um cover é dizer QUAL é o pedido aberto lá fora — e que existe pedido aberto
   * é afirmação da 0216, com porta própria e registro de quem afirmou. Aceitar aqui uma
   * análise em "solicitada" faria a mesma afirmação pela porta dos fundos, sem
   * `envio_manual_por`: daqui a três semanas, "mandaram mesmo?" ficaria sem resposta.
   * Quem ainda não marcou o envio usa o diálogo de envio à mão, que já aceita o número.
   */
  if v_linha.estagio not in ('enviada_seguradora', 'em_analise') then
    raise exception
      'Só dá para vincular o cover de uma análise que já está com a seguradora — esta está em "%".',
      v_linha.estagio using errcode = '22023';
  end if;

  -- Um cover pertence a uma análise. O índice único recusaria de qualquer jeito; aqui a
  -- recusa vem com o nome de quem já o tem, que é o que a pessoa precisa para descobrir
  -- se digitou errado ou se o pedido é mesmo o mesmo.
  select id into v_dono
  from public.analises_credito
  where atradius_case_id = v_case and id <> v_linha.id
  limit 1;
  if v_dono is not null then
    raise exception 'O cover % já está vinculado a outra análise deste sistema.', v_case
      using errcode = '23505';
  end if;

  v_anterior := v_linha.atradius_case_id;
  if v_anterior is not distinct from v_case then
    return v_linha; -- Já era esse. Repetir não é erro, e não vira evento.
  end if;

  update public.analises_credito set
    atradius_case_id = v_case,
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  /*
   * Mesmo tipo de evento da adoção automática (`analise.pedido_vinculado`), com `manual`
   * dizendo por onde veio. O que importa na timeline é o fato — este card passou a
   * apontar para aquele cover —, e quem lê precisa saber se foi o sistema que casou pelo
   * CNPJ ou se foi alguém que digitou o número.
   *
   * Trocar um número já preenchido é permitido e vai escrito: um cover errado faz o poll
   * gravar o limite de outro pedido, e o conserto não pode depender de um UPDATE manual
   * no banco. O valor anterior fica no resumo.
   */
  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_linha.empresa_id, 'analise.pedido_vinculado',
    jsonb_build_object(
      'titulo', 'Pedido da seguradora vinculado ao card',
      'resumo', case
        when v_anterior is null then
          'Cover ' || v_case || ' informado à mão. O acompanhamento automático passa a cuidar desta análise.'
        else
          'Cover trocado de ' || v_anterior || ' para ' || v_case || ', à mão.'
      end,
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id,
      'manual', true,
      'atradius_case_id', v_case,
      'anterior', v_anterior
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.pedido_vinculado', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $function$;

comment on function public.app_vincular_pedido_seguradora is
  'Liga uma análise já enviada ao número do cover da Atradius (0247). É a porta para o '
  'caso que o casamento por CNPJ recusa resolver sozinho — duas coberturas livres, dois '
  'cards abertos, ou buyer cadastrado sob outra inscrição. Com o cover preenchido, o poll '
  'assume a linha na rodada seguinte.';

revoke execute on function public.app_vincular_pedido_seguradora(jsonb) from public, anon;
grant execute on function public.app_vincular_pedido_seguradora(jsonb) to authenticated, service_role;

-- ─── O sino ─────────────────────────────────────────────────────────────────
--
-- Sem regra em `notificacao_regras`, o evento entra na timeline e não acende o sino de
-- ninguém — `fanout_evento_para_notificacoes` só notifica quem alguma regra nomeia.
--
-- Crédito nos dois, porque é quem trabalha a esteira. `analise.vinculo_ambiguo` leva
-- Admin junto, seguindo o precedente da 0193: ele descreve um card que vai ficar parado
-- até alguém agir, que é exatamente o tipo de silêncio que aquela migração existiu para
-- quebrar. O vínculo bem-sucedido não precisa de Admin: ele é o curso normal das coisas,
-- e a decisão que vem logo atrás já notifica por conta própria.
--
-- Idempotente por `not exists` e não por `on conflict`: a tabela só tem PK em `id`, e um
-- `on conflict do nothing` nunca dispararia — a segunda execução criaria regra duplicada
-- e o sino tocaria duas vezes para o mesmo evento.
insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'analise.pedido_vinculado', p.id, true
from public.perfis p
where p.nome in ('Crédito')
  and not exists (
    select 1 from public.notificacao_regras r
    where r.tipo_evento = 'analise.pedido_vinculado' and r.perfil_id = p.id
  );

insert into public.notificacao_regras (tipo_evento, perfil_id, ativo)
select 'analise.vinculo_ambiguo', p.id, true
from public.perfis p
where p.nome in ('Crédito', 'Admin')
  and not exists (
    select 1 from public.notificacao_regras r
    where r.tipo_evento = 'analise.vinculo_ambiguo' and r.perfil_id = p.id
  );
