-- ═════════════════════════════════════════════════════════════════════════════
-- 0220 — A carteira ociosa é a passiva, e o card do funil ganha notas
--
-- ─── §1 "MEU LIMITE OCIOSO" É SOBRE A CARTEIRA PASSIVA ──────────────────────
-- O bloco `carteira_ociosa` do Meu Dia lista e soma sobre `p_passiva`, que junta os
-- papéis `gestao_passiva` e `vendedor` — e no papel `vendedor` cabem as duas
-- naturezas de operação. Resultado: as contas em PROSPECÇÃO ATIVA entravam na conta
-- do limite ocioso do closer.
--
-- A 0204 já tinha corrigido isso no MAPA ("Minha carteira passiva"), com este
-- argumento: `v_passiva` mentia sobre a natureza. Ela deixou o BLOCO de fora de
-- propósito, escrevendo que "o nome não promete passividade, e o dinheiro parado na
-- prospecção ativa é trabalho".
--
-- O dono do indicador discorda, e a discordância é sobre o negócio, não sobre o
-- código: limite ocioso é um problema de CARTEIRA — conta que já opera e parou. Conta
-- em prospecção ativa ainda não começou; o limite dela não está ocioso, está por
-- estrear, e é outro trabalho, com outra conversa. Somar as duas dá um número que não
-- responde nenhuma das duas perguntas.
--
-- Fica com a MESMA régua do mapa (`is distinct from 'prospeccao_ativa'`), e não com
-- `= 'passivo'`, por dois motivos: as duas coisas ficam na mesma tela e divergir seria
-- pior que qualquer das duas escolhas; e conta sem classificação continua aparecendo —
-- sumir do dia do dono por causa de um campo em branco é o erro que ninguém descobre.
-- Na base de hoje são 38 passivas e 10 em prospecção ativa, nenhuma em branco.
--
-- ─── §2 NOTAS NO CARD DO FUNIL ──────────────────────────────────────────────
-- Anotação livre do vendedor nos funis de reunião (SDR), vendas e certificados, com
-- anexos. Publicada na hora e listada da mais recente para a mais antiga.
--
-- DO CARD, E NÃO DA EMPRESA. Foi a escolha de quem pediu, e ela tem consequência: o
-- que o SDR anotou na reunião NÃO aparece no funil de vendas. Cada card tem a sua
-- conversa. O `empresa_id` fica gravado junto mesmo assim — desnormalizado de
-- propósito, para que "todas as notas desta empresa" seja uma consulta e não uma
-- migração, no dia em que alguém quiser a visão unificada.
--
-- O endereçamento `(funil, card_id)` é o mesmo que `funil_transicoes` e
-- `mensagens_outbox` já usam. Três colunas de FK — uma por funil — diriam a mesma
-- coisa com duas sempre nulas, e cada funil novo pediria uma coluna nova.
--
-- SEM FK PARA O CARD, pela mesma razão: não existe uma tabela para apontar. A guarda
-- é a RLS, que confere o card existente no funil declarado — uma nota sobre um card
-- que a pessoa não enxerga não entra.
--
-- ANEXOS EM `jsonb`, E NÃO EM TABELA FILHA. O anexo não tem vida própria: nasce com a
-- nota, morre com ela, e ninguém consulta anexos sem a nota. É o mesmo desenho de
-- `comunicacoes.anexos`. O arquivo mora no bucket `funil-notas`; aqui fica só o
-- caminho, o nome original e o tamanho.
--
-- NOTA NÃO SE EDITA, SÓ SE APAGA, e só pelo autor. Uma anotação é o registro do que
-- alguém sabia NAQUELE momento — reescrevê-la depois de o negócio mudar transforma o
-- histórico em versão dos vencedores. Apagar a própria nota continua possível porque
-- errar o card ao escrever é comum e o texto fica visível para o time.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 ─────────────────────────────────────────────────────────────────────

create or replace function public.app__md_carteira_passiva(p_passiva uuid[])
returns uuid[] language sql stable set search_path = '' as $function$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.empresas e
  where e.id = any(p_passiva)
    and e.gestao_operacao is distinct from 'prospeccao_ativa';
$function$;

comment on function public.app__md_carteira_passiva is
  'De `vendedor_carteira` para a carteira REALMENTE passiva (0220). `v_passiva` junta os '
  'papéis `gestao_passiva` e `vendedor`, e no segundo cabem as duas naturezas — é o filtro '
  'que o mapa do Meu Dia já aplicava e que o bloco do limite ocioso passou a aplicar também.';

-- ─── §2 ─────────────────────────────────────────────────────────────────────

create table if not exists public.funil_notas (
  id uuid primary key default gen_random_uuid(),
  -- O mesmo vocabulário de `funil_transicoes`: 'sdr' é o funil de reuniões e
  -- 'vendedor' é o de vendas. Os nomes das TELAS mudaram com o tempo; os dos dados não.
  funil text not null check (funil in ('sdr', 'vendedor', 'certificado')),
  card_id uuid not null,
  empresa_id uuid references public.empresas (id) on delete cascade,
  autor_usuario_id uuid not null references public.usuarios (id),
  conteudo text not null check (btrim(conteudo) <> ''),
  /* [{ caminho, nome, mime, tamanho }] — o arquivo mora no bucket `funil-notas`. */
  anexos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);

-- A consulta é sempre "as notas deste card, da mais nova para a mais velha".
create index if not exists funil_notas_card_idx
  on public.funil_notas (funil, card_id, criado_em desc);
-- E a que ainda não existe na tela, mas o `empresa_id` foi gravado para permitir.
create index if not exists funil_notas_empresa_idx
  on public.funil_notas (empresa_id, criado_em desc);

comment on table public.funil_notas is
  'Anotação livre do vendedor num card de funil (0220), com anexos. DO CARD, não da '
  'empresa: o que o SDR anotou na reunião não aparece no funil de vendas. `empresa_id` '
  'fica desnormalizado para a visão por empresa ser uma consulta, não uma migração.';

alter table public.funil_notas enable row level security;

/*
 * Quem enxerga o CARD enxerga as notas dele — e a régua de cada funil é a do próprio
 * funil, repetida aqui porque a RLS de uma tabela não herda a da outra.
 *
 * `security definer` para poder ler `sdr_leads`/`vendas` sem depender da política
 * delas dentro da subconsulta: a resposta tem de ser a mesma esteja quem estiver
 * perguntando, e é esta função que decide.
 */
create or replace function public.app_ve_card_do_funil(p_funil text, p_card_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select case p_funil
    when 'sdr' then exists (
      select 1 from public.sdr_leads l
      where l.id = p_card_id
        and (l.sdr_id = any (coalesce(public.app_vendedores_visiveis(), '{}'::uuid[]))
          or l.vendedor_destino_id = any (coalesce(public.app_vendedores_visiveis(), '{}'::uuid[])))
    )
    when 'vendedor' then exists (
      select 1 from public.vendas v
      where v.id = p_card_id
        and v.vendedor_id = any (coalesce(public.app_vendedores_visiveis(), '{}'::uuid[]))
    )
    -- O funil de certificados é do time todo (`certificado_cards_select` pede só o
    -- módulo). A nota segue o card: mais estreita aqui seria uma régua que o funil não
    -- tem, e o autor veria a própria nota sumir.
    when 'certificado' then exists (
      select 1 from public.certificado_cards c where c.id = p_card_id
    )
    else false
  end;
$function$;

comment on function public.app_ve_card_do_funil is
  'Esta pessoa enxerga este card, no funil declarado? (0220) É a régua de cada funil '
  'repetida — RLS de uma tabela não herda a da outra — e o que guarda `funil_notas`.';

revoke execute on function public.app_ve_card_do_funil(text, uuid) from public, anon;
grant execute on function public.app_ve_card_do_funil(text, uuid) to authenticated, service_role;

drop policy if exists funil_notas_select on public.funil_notas;
create policy funil_notas_select on public.funil_notas
  for select using (
    (select public.app_tem_modulo('comercial'))
    and (select public.app_ve_card_do_funil(funil, card_id))
  );

/*
 * Escrever exige ser o AUTOR. Sem isto, `autor_usuario_id` seria um campo que a tela
 * preenche — e um campo que a tela preenche é um campo que a tela pode mentir. A nota
 * é assinada; a assinatura não pode ser escolhida.
 */
drop policy if exists funil_notas_insert on public.funil_notas;
create policy funil_notas_insert on public.funil_notas
  for insert with check (
    (select public.app_tem_modulo('comercial'))
    and autor_usuario_id = (select auth.uid())
    and (select public.app_ve_card_do_funil(funil, card_id))
  );

drop policy if exists funil_notas_delete on public.funil_notas;
create policy funil_notas_delete on public.funil_notas
  for delete using (
    (select public.app_tem_modulo('comercial'))
    and autor_usuario_id = (select auth.uid())
  );

-- NÃO HÁ POLICY DE UPDATE, e a ausência é a regra: nota não se edita. Ver o cabeçalho.

grant select, insert, delete on public.funil_notas to authenticated;

-- ─── §2.1 O bucket dos anexos ───────────────────────────────────────────────
--
-- Privado, como todos os outros. 20 MB por arquivo: é anexo de anotação — print de
-- conversa, proposta do concorrente, foto de obra —, não o balanço da empresa, que
-- tem lugar próprio em `analise-docs`.

insert into storage.buckets (id, name, public, file_size_limit)
values ('funil-notas', 'funil-notas', false, 20971520)
on conflict (id) do nothing;

/*
 * O caminho é `{funil}/{card_id}/{arquivo}`, e é ele que carrega a permissão: as duas
 * primeiras pastas dizem qual card, e `app_ve_card_do_funil` responde sobre ele.
 *
 * Sem isto a alternativa seria um bucket onde qualquer um do Comercial lê o anexo de
 * qualquer card — e o anexo é justamente a parte da nota que costuma ser um documento
 * do cliente.
 */
drop policy if exists funil_notas_anexo_select on storage.objects;
create policy funil_notas_anexo_select on storage.objects
  for select to authenticated using (
    bucket_id = 'funil-notas'
    and (select public.app_ve_card_do_funil(
      split_part(name, '/', 1),
      nullif(split_part(name, '/', 2), '')::uuid
    ))
  );

drop policy if exists funil_notas_anexo_insert on storage.objects;
create policy funil_notas_anexo_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'funil-notas'
    and (select public.app_ve_card_do_funil(
      split_part(name, '/', 1),
      nullif(split_part(name, '/', 2), '')::uuid
    ))
  );

-- ─── §1.1 O filtro entra ONDE `v_passiva` NASCE ─────────────────────────────
--
-- Em `app__md_montar`, e não no bloco do `app__md_closer`, porque `v_passiva`
-- alimenta as DUAS coisas que a tela mostra lado a lado: o mapa "Minha carteira
-- passiva" e o bloco "Carteira ociosa". Filtrando na origem, as duas concordam por
-- construção — o filtro que o mapa já fazia sozinho vira redundância inofensiva, e
-- não há como alguém corrigir uma e esquecer a outra.
--
-- `do $$` com `regexp_replace` sobre a definição VIVA, e não um `create or replace`
-- com a função inteira copiada: são 8 mil caracteres de onde esta migração precisa
-- mexer em uma linha, e recolar o resto de um arquivo antigo é como se perde uma
-- correção que entrou no meio. A âncora é única; se ela não bater, a migração falha
-- em vez de aplicar pela metade.

do $$
declare
  v_def text;
  v_ancora text := E'    into v_orig, v_passiva, v_carteira\n  from public.vendedor_carteira c\n  where c.vendedor_id = v_dados and c.ate is null;';
  v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'app__md_montar';

  if v_def is null then
    raise exception 'app__md_montar não encontrada.';
  end if;
  if position(v_ancora in v_def) = 0 then
    raise exception 'A âncora de `v_passiva` mudou em app__md_montar — revise a 0220 à mão.';
  end if;

  v_novo := replace(v_def, v_ancora, v_ancora || E'\n\n' ||
    '  /*' || E'\n' ||
    '   * A CARTEIRA PASSIVA É A QUE OPERA, não a que ainda vai estrear (0220).' || E'\n' ||
    '   *' || E'\n' ||
    '   * `v_passiva` junta `gestao_passiva` e `vendedor`, e no segundo cabem as duas' || E'\n' ||
    '   * naturezas. Limite ocioso é problema de conta que JÁ opera e parou; conta em' || E'\n' ||
    '   * prospecção ativa tem limite por estrear, que é outro trabalho e outra conversa.' || E'\n' ||
    '   * Somadas, davam um número que não respondia nenhuma das duas perguntas.' || E'\n' ||
    '   */' || E'\n' ||
    '  v_passiva := public.app__md_carteira_passiva(v_passiva);');

  execute v_novo;
end $$;

-- ─── §2.2 A escrita passa por RPC ───────────────────────────────────────────
--
-- A RLS já garante o essencial (autor = quem está logado, card visível, conteúdo não
-- vazio). O que a RPC acrescenta é o `empresa_id`: ele é DERIVADO do card, e não
-- enviado pela tela. Um campo que a tela preenche é um campo que a tela pode errar —
-- e este é o que vai sustentar a visão "todas as notas desta empresa".
--
-- Mesmo desenho de `app_criar_nota` (a nota de empresa, 0069).

create or replace function public.app_criar_nota_funil(p jsonb)
returns public.funil_notas
language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_funil text := p ->> 'funil';
  v_card uuid := (p ->> 'card_id')::uuid;
  v_empresa uuid;
  v_linha public.funil_notas;
begin
  if not public.app_tem_modulo('comercial') then
    raise exception 'Sem acesso ao módulo Comercial.' using errcode = '42501';
  end if;
  if v_funil not in ('sdr', 'vendedor', 'certificado') then
    raise exception 'Funil inválido: %.', v_funil using errcode = '22023';
  end if;
  if not public.app_ve_card_do_funil(v_funil, v_card) then
    raise exception 'Card não encontrado neste funil.' using errcode = '42501';
  end if;
  if nullif(btrim(p ->> 'conteudo'), '') is null then
    raise exception 'A nota está vazia.' using errcode = '23514';
  end if;

  -- Derivado, nunca recebido.
  v_empresa := case v_funil
    when 'sdr' then (select l.empresa_id from public.sdr_leads l where l.id = v_card)
    when 'vendedor' then (select v.empresa_id from public.vendas v where v.id = v_card)
    else (select c.empresa_id from public.certificado_cards c where c.id = v_card)
  end;

  insert into public.funil_notas (funil, card_id, empresa_id, autor_usuario_id, conteudo, anexos)
  values (
    v_funil, v_card, v_empresa, v_ator, btrim(p ->> 'conteudo'),
    coalesce(p -> 'anexos', '[]'::jsonb)
  )
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'funil.nota_criada', 'funil_notas', v_linha.id::text, p - 'conteudo');

  return v_linha;
end $function$;

comment on function public.app_criar_nota_funil is
  'Publica uma nota num card de funil (0220). O `empresa_id` é DERIVADO do card, não '
  'enviado pela tela — é ele que sustenta a visão por empresa. O resto (autor, card '
  'visível, conteúdo não vazio) a RLS e o CHECK já garantiam.';

revoke execute on function public.app_criar_nota_funil(jsonb) from public, anon;
grant execute on function public.app_criar_nota_funil(jsonb) to authenticated, service_role;
