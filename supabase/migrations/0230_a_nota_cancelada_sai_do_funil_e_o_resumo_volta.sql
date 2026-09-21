-- 0230 — A nota cancelada sai do funil, e a nota em resumo volta para ser relida.
--
-- Em 12/09/2026 a plataforma migrou de sistema. Três consequências chegaram
-- juntas no payload de `/invoices`, e as três são invisíveis em typecheck:
--
--   1. `status` passou a ter DOIS vocabulários. As notas migradas seguem em
--      português (`sincronizado`/`cancelado`); as nativas vêm em inglês
--      (`authorized`/`cancelled`/`denied`/`active`). Quem comparava a string crua
--      acertava metade da base.
--   2. A NFe recebida chega primeiro como RESUMO (`resNFe`) — sem itens, sem
--      duplicata e sem vencimento real — e só vira XML completo depois da
--      manifestação. Sem saber quais notas estão em resumo, não há como relê-las.
--   3. Uma nota cancelada DEPOIS do nosso sync nunca mais era revisitada: o
--      incremental só olha 4 horas para trás.
--
-- Esta migração dá nome às três coisas. O que decide o funil passa a ser
-- `situacao` (a LEITURA), e `status_sync` continua cru (a EVIDÊNCIA do que o
-- outro lado disse) — separar os dois é o que permite o vocabulário mudar de novo
-- sem reescrever a regra.

-- ─── As colunas ─────────────────────────────────────────────────────────────

alter table notas_fiscais
  add column if not exists situacao text not null default 'valida',
  add column if not exists cancelada_em timestamptz,
  add column if not exists xml_resumo boolean not null default false,
  -- Quando o resumo foi relido pela última vez. Sem isto a fila de promoção não
  -- tem como andar: ela releria as mesmas notas todo dia e nunca as mais antigas.
  add column if not exists resumo_relido_em timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'notas_fiscais'::regclass and conname = 'notas_fiscais_situacao_check'
  ) then
    alter table notas_fiscais
      add constraint notas_fiscais_situacao_check
      check (situacao = any (array['valida'::text, 'cancelada'::text, 'denegada'::text]));
  end if;
end $$;

comment on column notas_fiscais.situacao is
  'A leitura normalizada de status_sync: valida | cancelada | denegada. Os dois '
  'vocabulários da plataforma (pt e en) caem aqui. É esta coluna que decide o funil.';
comment on column notas_fiscais.xml_resumo is
  'A NFe chegou como resNFe (resumo da SEFAZ, antes da manifestação): sem itens, '
  'sem duplicata e com vencimento estimado. Vira false quando o XML completo chega.';

-- ─── O que já está gravado ──────────────────────────────────────────────────
--
-- `includes` e não igualdade, pela mesma razão do core: `cancelado`, `cancelled` e
-- `cancelada` são a mesma coisa em três grafias, e a lista cresce a cada migração
-- do outro lado.
--
-- `cancelada_em` fica NULO no backfill de propósito: não sabemos QUANDO essas
-- notas foram canceladas, e carimbar `now()` inventaria uma data de cancelamento
-- para 817 notas que já estavam assim antes desta migração existir.
update notas_fiscais
   set situacao = case
                    when lower(coalesce(status_sync, '')) like '%cancel%' then 'cancelada'
                    when lower(coalesce(status_sync, '')) like '%deneg%'
                      or lower(coalesce(status_sync, '')) like '%denied%' then 'denegada'
                    else 'valida'
                  end
 where situacao is distinct from case
                    when lower(coalesce(status_sync, '')) like '%cancel%' then 'cancelada'
                    when lower(coalesce(status_sync, '')) like '%deneg%'
                      or lower(coalesce(status_sync, '')) like '%denied%' then 'denegada'
                    else 'valida'
                  end;

-- Notas em resumo já gravadas: o XML diz, e é a única fonte. Sem isto a fila de
-- promoção nasceria vazia e as notas de material que entraram desde 13/09
-- ficariam para sempre com vencimento estimado.
update notas_fiscais
   set xml_resumo = true
 where raw_xml is not null
   and raw_xml ~* '<(\w+:)?resNFe\y'
   and xml_resumo = false;

-- ─── Índices ────────────────────────────────────────────────────────────────

-- A fila de promoção: parcial porque o resumo é uma minoria transitória, e o job
-- pede exatamente estas linhas ordenadas pela releitura mais antiga.
create index if not exists notas_fiscais_resumo_idx
  on notas_fiscais (resumo_relido_em nulls first, emitida_em desc)
  where xml_resumo;

-- O funil filtra por situação em toda leitura; sem o índice parcial, o predicado
-- vira varredura numa tabela de 77 mil linhas.
create index if not exists notas_fiscais_situacao_idx
  on notas_fiscais (situacao)
  where situacao <> 'valida';

-- ─── A view ─────────────────────────────────────────────────────────────────
--
-- Mesma cirurgia da 0229, e pelo mesmo motivo: `notas_funil` tem mais de oitenta
-- colunas e reescrevê-la inteira a cada migração é como se perde uma delas. As
-- âncoras são conferidas antes; se alguma sumiu, a migração PARA em vez de
-- produzir uma view silenciosamente diferente.
--
-- As colunas novas entram no FIM da lista porque `create or replace view` só
-- aceita acréscimo no fim — no meio, ele recusa com "cannot change name of view
-- column", que é a guarda funcionando.
do $$
declare
  v_def text;
  v_operavel_velho constant text := 'COALESCE(nf.operavel_manual, nf.operavel) AS operavel,
    nf.nao_operavel_motivo,';
  v_operavel_novo constant text := '(nf.situacao = ''valida''::text AND COALESCE(nf.operavel_manual, nf.operavel)) AS operavel,
        CASE
            WHEN nf.situacao = ''cancelada''::text THEN ''Nota cancelada''::text
            WHEN nf.situacao = ''denegada''::text THEN ''Nota denegada''::text
            ELSE nf.nao_operavel_motivo
        END AS nao_operavel_motivo,';
  v_fim_velho constant text := 'nf.limite_sacado_origem AS sacado_limite_origem
   FROM notas_fiscais nf';
  v_fim_novo constant text := 'nf.limite_sacado_origem AS sacado_limite_origem,
    nf.situacao,
    nf.cancelada_em,
    nf.xml_resumo
   FROM notas_fiscais nf';
begin
  select pg_get_viewdef('public.notas_funil'::regclass, true) into v_def;

  if position(v_operavel_velho in v_def) = 0 then
    raise exception 'operavel/nao_operavel_motivo não estão na forma esperada em notas_funil — revise a 0230 à mão.';
  end if;
  if position(v_fim_velho in v_def) = 0 then
    raise exception 'A última coluna de notas_funil mudou — revise a 0230 à mão.';
  end if;

  v_def := replace(v_def, v_operavel_velho, v_operavel_novo);
  v_def := replace(v_def, v_fim_velho, v_fim_novo);

  execute 'create or replace view public.notas_funil as ' || v_def;
end $$;

-- `create or replace view` PRESERVA reloptions, mas a opção é reafirmada aqui de
-- propósito: sem `security_invoker` a view roda com os direitos de quem a criou e
-- entrega a base inteira a qualquer usuário logado, e essa é a diferença que
-- ninguém percebe olhando a tela.
alter view public.notas_funil set (security_invoker = on);

-- ─── Por que a nota cancelada some pelo `operavel` ──────────────────────────
--
-- Já existe um mecanismo para "esta nota não se opera, e o card diz por quê"
-- (0104 para a natureza da operação, 0224 para o piso de R$ 500). Uma segunda
-- porta significaria dois lugares para lembrar de filtrar, e o funil já provou
-- que esquecer um deles custa caro: eram 574 notas e R$ 8,5 milhões de trabalho
-- recusado disputando espaço com o que falta fazer.
--
-- A diferença é que aqui `operavel_manual` NÃO manda. Recuperar à mão uma nota
-- pequena é uma decisão comercial legítima; recuperar à mão uma nota que não
-- existe mais na SEFAZ é operar um recebível que ninguém pode ceder.
