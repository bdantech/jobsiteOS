-- ═════════════════════════════════════════════════════════════════════════════
-- 0207 — Uma lista só de "fornecedor sem interesse"
--
-- ─── DUAS PORTAS, DOIS DESTINOS, NENHUMA TELA MOSTRANDO AS DUAS ─────────────
-- "Sem interesse" tinha dois botões que gravavam em tabelas diferentes:
--
--   a ficha do fornecedor  → `antecipacao_fornecedor_sem_interesse`  (3 CNPJs)
--   o menu do card da nota → `supressao` escopo empresa             (250 CNPJs)
--
-- A lista que a equipe abre é a primeira. As 249 decisões que o Rodrigo tomou
-- entre 02/09 e 14/09, uma a uma, em 145 minutos distintos de trabalho, caíram na
-- segunda — e não aparecem lá. Quem abre "sem interesse" vê três nomes e conclui
-- que ninguém curou nada.
--
-- ─── E ELAS NÃO SÃO A MESMA DECISÃO ────────────────────────────────────────
-- O que o Rodrigo escreveu como motivo, em texto livre, diz o que aquilo é:
--
--     Funcionário PJ ................ 146
--     Não faz antecipação ............  80
--     Imobiliária ...................  10
--     Disse que não tem interesse ...   9
--     Outros ........................   5
--
-- 241 das 250 são RECORTE — "esta nota não é do nosso negócio" —, não recusa. E
-- é por isso que o retorno automático em 90 dias estava errado: um funcionário PJ
-- não deixa de ser funcionário PJ em 24 de novembro. As 617 notas voltariam ao
-- funil e alguém refaria as mesmas 249 decisões.
--
-- ─── O QUE ESTA MIGRAÇÃO FAZ ────────────────────────────────────────────────
-- A LISTA passa a ser uma só, e ela é a decisão de funil: permanente, com motivo
-- de lista fechada, revertível num clique. A SUPRESSÃO continua sendo outra coisa
-- — o bloqueio de canal, com o prazo que quem clicou escolheu — e continua sendo
-- criada pelo mesmo botão, porque não abordar mais quem a gente já descartou é o
-- comportamento que já existia e ninguém pediu para tirar.
--
-- O efeito prático no calendário: em novembro a supressão de canal expira, mas o
-- fornecedor NÃO volta ao funil, porque quem o mantém fora agora é a lista.
--
-- ─── O MOTIVO DE CADA UM, TRADUZIDO E NÃO ADIVINHADO ───────────────────────
-- O texto livre vira o enum da lista só onde a correspondência é literal
-- (`funcionário pj`, `antecipa…`). Todo o resto entra como `outro` COM O TEXTO
-- ORIGINAL PRESERVADO em `observacao` — inclusive "Imobiliária", que descreve um
-- recorte que o enum não tem. Inventar a categoria mais próxima seria transformar
-- 10 decisões de uma pessoa em estatística de outra coisa.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 As 250 entram na lista ──────────────────────────────────────────────
--
-- `on conflict do nothing` protege os três que já estavam lá: o Votorantim está
-- nas duas tabelas, e a linha dele na lista tem o motivo escolhido de um enum —
-- sobrescrevê-la com o texto livre da supressão seria trocar dado bom por pior.

insert into public.antecipacao_fornecedor_sem_interesse
  (cnpj, fornecedor_nome, motivo, observacao, marcado_por, marcado_em)
select
  s.valor,
  coalesce(
    (select e.razao_social from public.empresas e where e.cnpj = s.valor),
    (select u.razao_social from public.mercado_universo u where u.cnpj = s.valor),
    (select nf.fornecedor_nome from public.notas_fiscais nf
      where nf.fornecedor_cnpj = s.valor order by nf.emitida_em desc nulls last limit 1)
  ),
  case
    when s.observacao ilike '%funcion%pj%' then 'funcionario_pj'
    when s.observacao ilike '%antecipa%' or s.observacao ilike '%nao_utiliza%'
      then 'nao_utiliza_antecipacao'
    else 'outro'
  end,
  -- `outro` exige explicação, e aqui ela sempre existe: é o que a pessoa digitou.
  coalesce(nullif(btrim(s.observacao), ''), 'Importado da supressão (0207)'),
  s.criado_por,
  s.criado_em
from public.supressao s
where s.escopo = 'empresa'
  and s.valor ~ '^[0-9]{14}$'
on conflict (cnpj) do nothing;

-- ─── §2 O botão do card da nota passa a alimentar a lista ───────────────────
--
-- Ele já suprimia canal e continua suprimindo. O que muda é que agora ele também
-- registra a decisão na lista — e a lista é quem tira as notas do funil, sem
-- prazo.
--
-- Quem ESCREVE na lista continua sendo `app_marcar_fornecedor_sem_interesse`, e
-- não um segundo insert copiado para cá. Ele resolve o nome do fornecedor, grava
-- o evento na empresa e o audit_log; duplicar isso seria garantir que as duas
-- portas divergissem no primeiro ajuste que alguém fizesse numa delas.
--
-- ── O CONTRATO MUDOU, e de propósito ──
-- `motivo` passa a ser o ENUM da lista fechada (era texto livre) e `observacao`
-- passa a carregar o texto. É o que torna a pergunta "por que descartamos 250
-- fornecedores?" respondível — hoje ela depende de ler 250 frases escritas à mão,
-- com "Funcionário PJ" grafado de duas formas diferentes.

create or replace function public.app_marcar_sem_interesse(p jsonb)
returns public.supressao language plpgsql security definer set search_path = '' as $function$
declare
  v_sup public.supressao;
  v_ator uuid := auth.uid();
  v_cnpj text := p ->> 'fornecedor_cnpj';
  v_motivo text := p ->> 'motivo';
  v_obs text := nullif(btrim(coalesce(p ->> 'observacao', '')), '');
begin
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  /*
   * A LISTA PRIMEIRO, porque é ela a decisão.
   *
   * Se o motivo não for válido, a função de baixo levanta e a transação inteira
   * volta — nada de um fornecedor suprimido no canal e ausente da lista, que é
   * exatamente o estado que esta migração existe para acabar.
   */
  perform public.app_marcar_fornecedor_sem_interesse(jsonb_build_object(
    'cnpj', v_cnpj,
    'motivo', v_motivo,
    'observacao', v_obs,
    'fornecedor_nome', p ->> 'fornecedor_nome'
  ));

  /*
   * E a supressão de canal, como sempre foi. `app__suprimir_fornecedor` guarda o
   * texto em `supressao.observacao` e exige algo não vazio — sem observação, o
   * próprio motivo serve de registro.
   */
  v_sup := public.app__suprimir_fornecedor(
    v_cnpj,
    coalesce(v_obs, v_motivo),
    case when coalesce((p ->> 'eterna')::boolean, false) then null
         else coalesce((p ->> 'dias')::int, 90) end,
    v_ator,
    'antecipacao'
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'antecipacao.sem_interesse', 'supressao', v_sup.id::text, p);

  return v_sup;
end $function$;

comment on function public.app_marcar_sem_interesse is
  'Marca um fornecedor como sem interesse pelo card da nota: entra na LISTA '
  '(`antecipacao_fornecedor_sem_interesse`, permanente, é ela que tira as notas do funil) '
  'e ganha SUPRESSÃO de canal com o prazo escolhido. `motivo` é o enum da lista; o texto '
  'livre vai em `observacao`.';
