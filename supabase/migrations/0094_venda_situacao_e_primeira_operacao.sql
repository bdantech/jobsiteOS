-- 0094 — Ganho e perdido saem do funil e viram SITUAÇÃO do negócio.
--
-- Pelo mesmo motivo do fit no funil de SDR (0093): eram colunas do kanban competindo
-- com a etapa pela mesma posição, e o negócio tem as duas coisas ao mesmo tempo.
--
-- Um negócio GANHO pode estar em ONBOARDING. Como coluna, "ganho" apagava o onboarding
-- — o card saía da etapa onde o trabalho ainda acontece e ia para uma caixa de troféus.
-- Quem tinha de tocar o onboarding perdia o card de vista no exato momento em que ele
-- passou a exigir trabalho de verdade.
--
-- Agora: `estagio` diz ONDE está, `situacao` diz COMO terminou, e `primeira_operacao_em`
-- diz quando parou de ser assunto do comercial.
--
-- Aplicada no banco em `venda_situacao_e_primeira_operacao` + `app_mover_venda_com_situacao`.

alter table public.vendas
  add column situacao text not null default 'em_andamento'
    constraint vendas_situacao_check check (situacao in ('em_andamento', 'ganho', 'perdido')),
  add column ganho_em timestamptz,
  -- O momento em que o cliente novo virou cliente operando. É ele que tira o card do
  -- funil: ganho sem operação ainda é trabalho (onboarding, primeira nota); ganho com
  -- operação é rotina, e rotina não mora em funil.
  add column primeira_operacao_em timestamptz,
  add column primeira_operacao_id int;

comment on column public.vendas.situacao is
  'em_andamento | ganho | perdido. Independe do estágio: um negócio ganho pode estar em '
  'onboarding, e é lá que o trabalho continua.';
comment on column public.vendas.primeira_operacao_em is
  'Primeira antecipação convertida depois do ganho. Some do funil quando preenchido — '
  'já está ganho E operando.';

update public.vendas set situacao = 'ganho', ganho_em = coalesce(atualizada_em, now()),
  estagio = 'onboarding'
where estagio = 'ganho';

update public.vendas set situacao = 'perdido', estagio = 'reuniao_agendada'
where estagio = 'perdido';

alter table public.vendas drop constraint vendas_estagio_check;
alter table public.vendas add constraint vendas_estagio_check
  check (estagio in (
    'reuniao_agendada', 'reuniao_reagendada', 'aguardando_documentacao',
    'em_analise_credito', 'proposta_enviada', 'preparacao_mou', 'mou_assinado', 'onboarding'
  ));

-- Perder continua exigindo motivo — agora amarrado à situação, não ao estágio.
alter table public.vendas drop constraint vendas_perdido_exige_motivo;
alter table public.vendas add constraint vendas_perdido_exige_motivo
  check (situacao <> 'perdido' or perdido_motivo is not null);

-- O funil lê "o que ainda é assunto": em andamento, ou ganho sem operação.
create index vendas_no_funil_idx on public.vendas (vendedor_id, estagio)
  where situacao <> 'perdido' and primeira_operacao_em is null;

-- ─── A RPC passa a tratar ganho/perdido como situação ───────────────────────
-- O payload aceita `estagio` (mover), `situacao` (encerrar) ou os dois. Ganhar promove a
-- empresa a cliente e ABRE a pergunta ativo/passivo — não responde por ela. Nem ganhar
-- nem perder mexem no estágio.
-- Definição completa em `app_mover_venda_com_situacao`; ver pg_get_functiondef.
