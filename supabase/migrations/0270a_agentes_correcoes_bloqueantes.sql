-- ============================================================================
-- 0270a — Agentes (Prompt 09 §1): as correções que impedem qualquer teste honesto
--
-- Nenhum destes defeitos causou dano até aqui, porque ligação, agente e vendedor de IA
-- nunca agiram em produção (0 ligações, 0 decisões, 0 mensagens `por_ia`). Todos
-- apareceriam no primeiro dia de operação. Esta migração cuida da metade que mora no
-- banco; a outra metade está no worker e no core, no mesmo commit.
--
--   §1.2  o portão da voz passa a rodar DENTRO da transação que enfileira, e o número
--         discado é o mesmo número checado;
--   §1.4  `conversas.status` ganha `aguardando_humano` (a escalação para de repetir);
--   §1.5  desfecho desconhecido é aceito e registrado, a ligação órfã tem varredura e a
--         tela ganha cancelamento;
--   §1.6  links, gravação, transcrição e custo do webhook passam a ser gravados;
--   §4.3  a ligação se desprende da NF: `id` próprio, `access_key` opcional.
--
-- Os CHECKs recriados aqui saíram de `pg_constraint` em 27/09/2026 (estado vivo), e
-- não da 0144/0225 — é a regra da casa desde que a 0081 apagou valores ao recriar um
-- CHECK a partir da migração original.
-- ============================================================================

-- ─── §1.4 A conversa que espera uma pessoa ──────────────────────────────────
--
-- A escalação por guardrail não gravava próximo passo nenhum: a mesma conversa era
-- escolhida de novo na hora seguinte, escalava de novo e mandava outro push. Com o
-- estado próprio ela sai da varredura do agente até alguém tocá-la — e "alguém tocar"
-- é qualquer saída humana, que o trigger de `comunicacoes` abaixo devolve a `ativa`.

alter table public.conversas drop constraint conversas_status_check;
alter table public.conversas add constraint conversas_status_check
  check (status = any (array['ativa', 'aguardando_resposta', 'pausada', 'encerrada',
                             'aguardando_humano']));

-- ─── §4.3 A ligação deixa de ser uma NF ─────────────────────────────────────
--
-- A chave era (nota, tentativa). Um mandato liga para o Carlos indicado pela Marcia, e
-- essa ligação não é sobre nota nenhuma. A linha ganha `id` próprio (é ele que
-- `mandato_acoes.voz_ligacao_id` referencia) e a regra "uma tentativa por nota" vira
-- índice parcial, válida só onde há nota.

alter table public.voz_ligacoes add column id uuid not null default gen_random_uuid();
alter table public.voz_ligacoes drop constraint voz_ligacoes_pkey;
alter table public.voz_ligacoes add constraint voz_ligacoes_pkey primary key (id);
create unique index voz_ligacoes_nota_tentativa_key
  on public.voz_ligacoes (access_key, tentativa) where access_key is not null;

alter table public.voz_ligacoes alter column access_key drop not null;
alter table public.voz_ligacoes alter column fornecedor_cnpj drop not null;
alter table public.voz_ligacoes drop constraint voz_ligacoes_fornecedor_check;
alter table public.voz_ligacoes add constraint voz_ligacoes_fornecedor_check
  check (fornecedor_cnpj is null or fornecedor_cnpj ~ '^[0-9]{14}$');

alter table public.voz_ligacoes drop constraint voz_ligacoes_origem_check;
alter table public.voz_ligacoes add constraint voz_ligacoes_origem_check
  check (origem = any (array['cron', 'manual', 'agente']));

alter table public.voz_ligacoes
  -- A empresa da ligação. Na de NF ela é descoberta pelo CNPJ do fornecedor; na de
  -- mandato ela é o próprio alvo, e não há CNPJ de fornecedor para procurar.
  add column empresa_id uuid references public.empresas (id) on delete set null,
  -- `ofertar_antecipacao` é o único que a v1 da Ana entende (§4.3). Os demais existem
  -- para a v2 e são recusados pelo adapter, com erro claro, enquanto ela não chegar.
  add column objetivo text not null default 'ofertar_antecipacao',
  -- §1.6: o que o zod jogava fora. `links` traz painel e gravação; a tela só mostra o
  -- botão "Ouvir" quando a URL existe e é https.
  add column links jsonb,
  add column transcricao jsonb,
  add column custo_centavos int,
  add column duracao_s int,
  -- §1.5(c): cancelar do nosso lado. `cancelada_por` nulo = o sistema (varredura).
  add column cancelada_por uuid references public.usuarios (id) on delete set null,
  add column cancelada_em timestamptz,
  -- Qual contrato da Ana foi usado neste envio. É o que o painel mostra para ninguém
  -- achar que uma capacidade da v2 está ligada quando o envio saiu em v1.
  add column versao_api text;

comment on column public.voz_ligacoes.objetivo is
  'O que a ligação quer: ofertar_antecipacao (v1), agendar_reuniao, qualificar, reativar (v2). O adapter recusa o que a versão da Ana não suporta.';

-- ─── Helpers de telefone ────────────────────────────────────────────────────
--
-- A MESMA régua de `normalizarTelefoneBr` (core), no pedaço que o portão precisa:
-- tirar `55` só quando o número tem 12/13 casas, tirar o `0` de interurbano, e aceitar
-- apenas o que sobra com 10 ou 11 dígitos. `5533221100` tem 10 casas e É do DDD 55.

create or replace function public.app__telefone_e164(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if left(d, 2) = '55' and length(d) in (12, 13) then
    d := substr(d, 3);
  elsif left(d, 1) = '0' then
    if length(d) in (11, 12) then d := substr(d, 2);
    elsif length(d) in (13, 14) then d := substr(d, 4);
    end if;
  end if;
  if length(d) not in (10, 11) then return null; end if;
  return '+55' || d;
end $$;

comment on function public.app__telefone_e164(text) is
  'Telefone brasileiro em E.164 (+55DDNUMERO), ou nulo. Mesma régua de normalizarTelefoneBr no core.';

-- ─── §1.2 O portão da voz, dentro do banco ──────────────────────────────────
--
-- O portão de CONTEÚDO (taxa, TAC, líquido, vencimento) continua no core, e o worker o
-- reexecuta no instante do envio (§1.3). Este aqui é o de PERMISSÃO — fatos do banco que
-- podem mudar entre a tela abrir e a ligação sair, e que nenhum chamador pode pular:
--
--   telefone_invalido         o número não é um celular/fixo brasileiro discável
--   suprimido                 a pessoa (telefone) ou a empresa pediu para não ser procurada
--   em_cobranca               o grupo do CNPJ está em cobrança (Prompt 07 é humano)
--   no_procon                 o enriquecimento marcou o número como Procon
--   contato_de_outra_empresa  o contato informado não é da empresa da ligação
--   telefone_nao_e_do_contato o número discado não é nenhum dos números do contato
--   sem_base_legal            o contato não tem de onde veio o direito de falar com ele
--
-- Sem contato informado, o único caminho legítimo é a NF: o número tem de ser o do
-- `contato_fornecedor` daquela nota, e a base legal é o dado público da própria NF-e. A
-- action antiga CARIMBAVA 'dado_publico_nfe' em qualquer número; agora o banco confere.

create or replace function public.app__voz_portao(
  p_telefone text,
  p_contato uuid,
  p_empresa uuid,
  p_cnpj text,
  p_access_key text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_e164 text := public.app__telefone_e164(p_telefone);
  v_digitos text;
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
  v_contato public.contatos;
  v_nota public.notas_fiscais;
begin
  if v_e164 is null or p_telefone is distinct from v_e164 then
    return 'telefone_invalido';
  end if;
  v_digitos := substr(v_e164, 2);

  if v_cnpj is null and p_empresa is not null then
    select cnpj into v_cnpj from public.empresas where id = p_empresa;
  end if;

  if exists (
    select 1 from public.supressao s
     where ((s.escopo in ('telefone', 'whatsapp') and s.valor in (v_digitos, substr(v_digitos, 3)))
         or (s.escopo = 'empresa' and v_cnpj is not null and s.valor = v_cnpj))
       and (s.expira_em is null or s.expira_em >= current_date)
  ) then
    return 'suprimido';
  end if;

  if v_cnpj is not null and public.app_cobranca_sacado_bloqueado(v_cnpj) then
    return 'em_cobranca';
  end if;

  -- A marca do Procon mora na evidência do enriquecimento (voz/procon.ts), não numa
  -- coluna. Ausência de linha é "não está na lista" — a mesma leitura do core.
  if exists (
    select 1 from public.contatos_descobertos cd
     where cd.valor = v_e164 and lower(coalesce(cd.evidencia, '')) like '%no procon%'
  ) then
    return 'no_procon';
  end if;

  if p_contato is not null then
    select * into v_contato from public.contatos where id = p_contato;
    if v_contato.id is null then
      return 'sem_base_legal';
    end if;
    if p_empresa is not null and v_contato.empresa_id is distinct from p_empresa then
      return 'contato_de_outra_empresa';
    end if;
    if v_e164 is distinct from public.app__telefone_e164(v_contato.whatsapp)
       and v_e164 is distinct from public.app__telefone_e164(v_contato.telefone) then
      return 'telefone_nao_e_do_contato';
    end if;
    if v_contato.base_legal is null then
      return 'sem_base_legal';
    end if;
    return null;
  end if;

  if p_access_key is not null then
    select * into v_nota from public.notas_fiscais where access_key = p_access_key;
    if v_nota.access_key is not null
       and public.app__telefone_e164(v_nota.contato_fornecedor ->> 'phone') = v_e164 then
      return null;
    end if;
  end if;
  return 'sem_base_legal';
end $$;

comment on function public.app__voz_portao(text, uuid, uuid, text, text) is
  'O portão de permissão da ligação (09 §1.2). Nulo = pode ligar; senão o motivo nomeado. Roda dentro de toda RPC que enfileira.';

revoke all on function public.app__voz_portao(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.app__voz_portao(text, uuid, uuid, text, text) to service_role;

create or replace function public.app__voz_portao_mensagem(p_motivo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_motivo
    when 'telefone_invalido' then 'Telefone precisa estar em E.164 (+55DDNUMERO) e ser um número brasileiro válido.'
    when 'suprimido' then 'Esse contato pediu para não ser procurado.'
    when 'em_cobranca' then 'O grupo desta empresa está em cobrança: contato comercial está suspenso.'
    when 'no_procon' then 'Número na lista do Procon.'
    when 'contato_de_outra_empresa' then 'O contato informado não pertence a esta empresa.'
    when 'telefone_nao_e_do_contato' then 'O número a discar não é nenhum dos números deste contato.'
    when 'sem_base_legal' then 'Contato sem base legal registrada para ligação.'
    when 'pedido_divergente' then 'O telefone do pedido não é o telefone da ligação.'
    else coalesce(p_motivo, 'Ligação recusada.')
  end;
$$;

-- ─── §1.2 A RPC da tela, reescrita ──────────────────────────────────────────
--
-- Três mudanças, e cada uma fecha um caminho que existia:
--   1. `pedido.telefone` tem de ser IGUAL a `telefone`. O que era checado na supressão
--      era a coluna; o que a Ana discava era o pedido. Uma chamada direta à RPC com os
--      dois diferentes passava por um e discava o outro.
--   2. O portão de permissão roda aqui, na transação. Nenhum caminho enfileira sem ele.
--   3. A recusa volta com o MOTIVO nomeado no `detail` (errcode 42501), para a tela
--      poder traduzir sem interpretar texto.
--
-- O conteúdo do pedido não é mais confiado: o worker remonta taxa, TAC e líquido com
-- dados frescos no instante do envio (§1.3), e o `pedido` gravado aqui vira só o
-- retrato do que a tela viu.

create or replace function public.app_voz_enfileirar(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_access_key text := nullif(btrim(coalesce(p ->> 'access_key', '')), '');
  v_telefone text := nullif(btrim(coalesce(p ->> 'telefone', '')), '');
  v_contato uuid := nullif(p ->> 'contato_id', '')::uuid;
  v_pedido jsonb := p -> 'pedido';
  v_nota public.notas_fiscais;
  v_empresa uuid;
  v_motivo text;
  v_tentativa int;
  v_id_externo text;
  v_linha public.voz_ligacoes;
begin
  if not public.app_tem_modulo('comunicacao') or not public.app_tem_modulo('antecipacao') then
    raise exception 'A fila de ligações exige os módulos Comunicação e Antecipação.'
      using errcode = '42501';
  end if;
  if v_access_key is null or v_telefone is null then
    raise exception 'Informe a nota e o telefone.' using errcode = '23514';
  end if;
  if v_pedido is null or jsonb_typeof(v_pedido) <> 'object' then
    raise exception 'Pedido da ligação ausente.' using errcode = '23514';
  end if;

  v_telefone := coalesce(public.app__telefone_e164(v_telefone), v_telefone);
  if coalesce(public.app__telefone_e164(v_pedido ->> 'telefone'), '') <> v_telefone then
    raise exception '%', public.app__voz_portao_mensagem('pedido_divergente')
      using errcode = '42501', detail = 'pedido_divergente';
  end if;

  select * into v_nota from public.notas_fiscais where access_key = v_access_key;
  if not found then
    raise exception 'Nota não encontrada.' using errcode = 'no_data_found';
  end if;
  select id into v_empresa from public.empresas where cnpj = v_nota.fornecedor_cnpj;

  v_motivo := public.app__voz_portao(v_telefone, v_contato, v_empresa, v_nota.fornecedor_cnpj, v_access_key);
  if v_motivo is not null then
    raise exception '%', public.app__voz_portao_mensagem(v_motivo)
      using errcode = '42501', detail = v_motivo;
  end if;

  if exists (
    select 1 from public.voz_ligacoes
     where access_key = v_access_key and status in ('a_enviar', 'enviada')
  ) then
    raise exception 'Já existe uma ligação em andamento para esta nota.' using errcode = '23505';
  end if;

  select coalesce(max(tentativa), 0) + 1 into v_tentativa
    from public.voz_ligacoes where access_key = v_access_key;
  v_id_externo := case when v_tentativa = 1 then v_access_key
                       else v_access_key || ':' || v_tentativa end;

  insert into public.voz_ligacoes (
    access_key, tentativa, id_externo, fornecedor_cnpj, empresa_id, contato_id, telefone,
    status, pedido, origem, enfileirada_por, objetivo
  ) values (
    v_access_key, v_tentativa, v_id_externo, v_nota.fornecedor_cnpj, v_empresa, v_contato, v_telefone,
    'a_enviar',
    jsonb_set(jsonb_set(v_pedido, '{id_externo}', to_jsonb(v_id_externo)), '{telefone}', to_jsonb(v_telefone)),
    'manual', v_ator, 'ofertar_antecipacao'
  )
  returning * into v_linha;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'voz.enfileirar', 'voz_ligacoes', v_id_externo,
          jsonb_build_object('access_key', v_access_key, 'tentativa', v_tentativa,
                             'telefone', v_telefone));

  return v_linha;
end $$;

comment on function public.app_voz_enfileirar(jsonb) is
  'Põe uma ligação de NF na fila a partir da tela. O portão de permissão (app__voz_portao) roda na transação; o de conteúdo o worker reexecuta no envio.';

-- ─── §1.5(c) Cancelar do nosso lado ─────────────────────────────────────────
--
-- `a_enviar` cancela sem conversa: a Ana nunca soube. `enviada` cancela aqui e o worker
-- tenta o DELETE lá (`cancelar_na_ana` volta verdadeiro); se ela já discou, o webhook
-- que chegar depois é aceito e registrado assim mesmo — o que foi dito ao telefone não
-- deixa de ter sido dito porque alguém clicou em cancelar.

create or replace function public.app_voz_cancelar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_linha public.voz_ligacoes;
  v_estava text;
begin
  if not public.app_tem_modulo('comunicacao') then
    raise exception 'Sem acesso ao módulo Comunicação.' using errcode = '42501';
  end if;
  select * into v_linha from public.voz_ligacoes where id = v_id for update;
  if v_linha.id is null then
    raise exception 'Ligação não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_linha.status not in ('a_enviar', 'enviada') then
    raise exception 'Esta ligação já terminou (%).', v_linha.status using errcode = '22023';
  end if;
  v_estava := v_linha.status;

  update public.voz_ligacoes set
    status = 'cancelada',
    motivo_recusa = coalesce(nullif(p ->> 'motivo', ''), 'cancelada_na_tela'),
    cancelada_por = v_ator,
    cancelada_em = now(),
    encerrada_em = now()
  where id = v_id;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'voz.cancelar', 'voz_ligacoes', v_linha.id_externo,
          jsonb_build_object('status_anterior', v_estava, 'ligacao_id', v_linha.ligacao_id));

  return jsonb_build_object(
    'id', v_linha.id,
    'ligacao_id', v_linha.ligacao_id,
    'cancelar_na_ana', v_estava = 'enviada' and v_linha.ligacao_id is not null
  );
end $$;

revoke execute on function public.app_voz_cancelar(jsonb) from public, anon;
grant execute on function public.app_voz_cancelar(jsonb) to authenticated, service_role;

-- ─── §1.5(b) A varredura das órfãs ──────────────────────────────────────────
--
-- `enviada` sem webhook há mais de N minutos é ligação que a Ana perdeu, ou webhook que
-- se perdeu no caminho. Enquanto ela ficasse `enviada`, a nota não aceitava nova
-- tentativa e sumia da lista de candidatas — para sempre. Marcar como `falhou` com o
-- motivo à vista libera a nota; se o webhook chegar depois, ele é aceito (a RPC de
-- resultado reabre uma `falhou` por timeout, ver abaixo).

create or replace function public.app__voz_varrer_orfas(p_minutos int)
returns table (id uuid, id_externo text, mandato_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.voz_ligacoes v set
    status = 'falhou',
    erro = 'timeout: nenhum resultado da Ana em ' || p_minutos || ' minutos',
    motivo_recusa = 'timeout',
    encerrada_em = now()
  where v.status = 'enviada'
    and coalesce(v.enviada_em, v.atualizada_em) < now() - make_interval(mins => greatest(p_minutos, 5))
  returning v.id, v.id_externo, null::uuid;
end $$;

revoke all on function public.app__voz_varrer_orfas(int) from public, anon, authenticated;
grant execute on function public.app__voz_varrer_orfas(int) to service_role;

-- ─── O gancho do mandato ────────────────────────────────────────────────────
--
-- A 0270d substitui este corpo: é ali que o desfecho estruturado vira contato novo e
-- próxima ação do mandato. Existe já aqui, vazio, para a RPC de resultado poder chamá-lo
-- desde a primeira versão — sem que esta migração dependa de uma tabela que ainda não
-- existe.

create or replace function public.app__voz_resultado_para_mandato(p_linha public.voz_ligacoes, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

revoke all on function public.app__voz_resultado_para_mandato(public.voz_ligacoes, jsonb) from public, anon, authenticated;
grant execute on function public.app__voz_resultado_para_mandato(public.voz_ligacoes, jsonb) to service_role;

-- ─── §1.5(a) e §1.6 O resultado, sem descarte ───────────────────────────────
--
-- Corpo de partida: `pg_get_functiondef` em 27/09/2026 (igual à 0225). Mudanças:
--   • `outcome` fora da lista conhecida NÃO derruba mais a gravação: vira 'desconhecido'
--     e o valor cru fica em `resultado.outcome` (o payload inteiro é gravado);
--   • status desconhecido idem: a linha fecha como 'concluida' e o cru fica no payload;
--   • uma linha que a varredura marcou `falhou` por timeout é REABERTA pelo webhook que
--     chega depois — o timeout é a nossa desistência, não um fato da ligação;
--   • links, transcrição, custo e duração vão para colunas próprias (§1.6);
--   • a empresa vem da linha quando ela já sabe (ligação de mandato), e só na falta dela
--     é procurada pelo CNPJ do fornecedor;
--   • `origem` do ledger é 'agente' só quando foi um agente que enfileirou; na ligação
--     posta por uma pessoa é 'sistema', e `usuario_id` continua sendo quem pôs na fila.

create or replace function public.app__voz_registrar_resultado(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_id_externo text := nullif(btrim(coalesce(p ->> 'id_externo', '')), '');
  v_status_cru text := coalesce(nullif(p ->> 'status', ''), 'concluida');
  v_outcome_cru text := nullif(p ->> 'outcome', '');
  v_outcome text;
  v_chamada jsonb := coalesce(p -> 'chamada', '{}'::jsonb);
  v_resumo text := nullif(v_chamada ->> 'resumo', '');
  v_links jsonb := coalesce(p -> 'links', v_chamada -> 'links');
  v_custo numeric := coalesce(nullif(p ->> 'custo_centavos', '')::numeric,
                              nullif(v_chamada ->> 'custo_centavos', '')::numeric,
                              round(nullif(coalesce(p -> 'custo' ->> 'valor_brl', v_chamada -> 'custo' ->> 'valor_brl'), '')::numeric * 100));
  v_linha public.voz_ligacoes;
  v_nota public.notas_fiscais;
  v_empresa uuid;
  v_ident text;
  v_conversa uuid;
  v_comunicacao uuid;
  v_escopo_pedido text;
  v_telefone_digitos text;
  v_origem_ledger text;
begin
  if v_id_externo is null then
    raise exception 'id_externo é obrigatório.' using errcode = '23514';
  end if;

  select * into v_linha from public.voz_ligacoes
   where id_externo = v_id_externo for update;
  if not found then
    raise exception 'Ligação desconhecida: %.', v_id_externo using errcode = 'no_data_found';
  end if;

  -- Já fechada por um webhook anterior: devolve como está. A exceção é a varredura de
  -- órfãs, que fecha por desistência nossa; o resultado real vence o timeout.
  if v_linha.encerrada_em is not null and coalesce(v_linha.motivo_recusa, '') <> 'timeout' then
    return v_linha;
  end if;

  v_outcome := case
    when v_outcome_cru is null then null
    when v_outcome_cru = any (array[
      'antecipacao_solicitada', 'cadastro_iniciado', 'proposta_enviada', 'interesse_futuro',
      'retorno_agendado', 'agendado_com_decisor', 'quer_negociar', 'transferido_humano',
      'pediu_para_nao_contatar', 'recusa', 'objecao_taxa', 'nao_tem_interesse', 'pessoa_errada',
      'caixa_postal', 'nao_atendeu', 'indefinido',
      -- v2 (§4.3): desfechos estruturados que o mandato consome
      'agendar_retorno', 'indicou_outro_contato', 'reuniao_agendada', 'interesse',
      'nao_e_o_decisor']) then v_outcome_cru
    else 'desconhecido'
  end;

  if v_linha.access_key is not null then
    select * into v_nota from public.notas_fiscais where access_key = v_linha.access_key;
  end if;

  update public.voz_ligacoes set
    status = case v_status_cru
      when 'concluida' then 'concluida'
      when 'nao_atendida' then 'nao_atendida'
      when 'falhou' then 'falhou'
      when 'cancelada' then 'cancelada'
      else 'concluida' end,
    ligacao_id = coalesce(nullif(p ->> 'ligacao_id', ''), ligacao_id),
    chamada_id = coalesce(nullif(v_chamada ->> 'call_id', ''), chamada_id),
    outcome = v_outcome,
    resumo = v_resumo,
    resultado = p,
    links = coalesce(v_links, links),
    transcricao = coalesce(v_chamada -> 'transcricao', p -> 'transcricao', transcricao),
    custo_centavos = coalesce(v_custo::int, custo_centavos),
    duracao_s = coalesce(nullif(v_chamada ->> 'duracao_s', '')::numeric::int, duracao_s),
    erro = nullif(p ->> 'erro', ''),
    motivo_recusa = case when motivo_recusa = 'timeout' then null else motivo_recusa end,
    encerrada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  if v_linha.status = 'concluida' then
    v_empresa := v_linha.empresa_id;
    if v_empresa is null and v_linha.fornecedor_cnpj is not null then
      select id into v_empresa from public.empresas where cnpj = v_linha.fornecedor_cnpj;
      if v_empresa is null then
        begin
          v_empresa := (public.app__promover_fornecedor_para_empresa(
            v_linha.fornecedor_cnpj, v_linha.enfileirada_por, 'antecipacao')).id;
        exception when others then
          v_empresa := null;
        end;
      end if;
      if v_empresa is not null then
        update public.voz_ligacoes set empresa_id = v_empresa where id = v_linha.id
          returning * into v_linha;
      end if;
    end if;

    v_ident := public.app__identificador_canonico('whatsapp', v_linha.telefone);
    if v_empresa is not null and v_ident is not null then
      v_conversa := public.app__conversa_para('whatsapp', v_ident, v_empresa, v_linha.contato_id, null);
    end if;

    v_origem_ledger := case when v_linha.origem = 'agente' then 'agente' else 'sistema' end;

    insert into public.comunicacoes (
      conversa_id, empresa_id, contato_id, canal, direcao,
      por_ia, corpo, preview, provedor, id_externo, status_envio,
      origem, funil, funil_card_id, enviado_em, usuario_id
    ) values (
      v_conversa, v_empresa, v_linha.contato_id, 'ligacao', 'saida',
      true,
      v_resumo,
      'Ana ligou: ' || coalesce(v_outcome, 'sem desfecho') || '.',
      'voz', v_linha.chamada_id, 'enviada',
      v_origem_ledger,
      case when v_linha.access_key is not null then 'nfs' else null end,
      v_linha.access_key, now(), v_linha.enfileirada_por
    )
    returning id into v_comunicacao;

    update public.voz_ligacoes set comunicacao_id = v_comunicacao
      where id = v_linha.id returning * into v_linha;
  end if;

  if v_linha.access_key is not null
     and v_outcome in ('antecipacao_solicitada', 'cadastro_iniciado', 'proposta_enviada')
     and v_nota.estagio_funil in ('a_prospectar', 'em_prospeccao') then
    update public.notas_fiscais
      set estagio_funil = 'em_negociacao', estagio_alterado_em = now()
      where access_key = v_linha.access_key;
  end if;

  if v_outcome = 'pediu_para_nao_contatar' then
    v_escopo_pedido := coalesce(v_chamada -> 'nao_contatar' ->> 'escopo', 'telefone');
    v_telefone_digitos := regexp_replace(coalesce(v_linha.telefone, ''), '[^0-9]', '', 'g');

    if v_telefone_digitos <> '' then
      insert into public.supressao (escopo, valor, motivo, observacao, expira_em, contexto)
      values (
        'telefone', v_telefone_digitos, 'solicitacao_lgpd',
        'Pedido na ligação da Ana: ' ||
          coalesce(v_chamada -> 'nao_contatar' ->> 'literal', 'sem transcrição'),
        null, 'antecipacao'
      )
      on conflict (escopo, valor) do update
        set expira_em = null,
            motivo = 'solicitacao_lgpd',
            observacao = excluded.observacao;
    end if;

    if v_escopo_pedido in ('empresa', 'todos', 'tudo') and v_linha.fornecedor_cnpj is not null then
      perform public.app__suprimir_fornecedor(
        v_linha.fornecedor_cnpj,
        'Pedido na ligação da Ana (' || coalesce(v_linha.chamada_id, 'sem id') || ').',
        null, null, 'antecipacao'
      );
    elsif v_escopo_pedido in ('empresa', 'todos', 'tudo') and v_empresa is not null then
      insert into public.supressao (escopo, valor, motivo, observacao, expira_em, contexto)
      select 'empresa', e.cnpj, 'solicitacao_lgpd',
             'Pedido na ligação da Ana (' || coalesce(v_linha.chamada_id, 'sem id') || ').', null, 'comercial'
        from public.empresas e where e.id = v_empresa and e.cnpj is not null
      on conflict (escopo, valor) do update set expira_em = null, motivo = 'solicitacao_lgpd';
    end if;
  end if;

  perform public.app__voz_resultado_para_mandato(v_linha, p);

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    null, 'voz.resultado', 'voz_ligacoes', v_linha.id_externo,
    jsonb_build_object('outcome', v_outcome, 'outcome_cru', v_outcome_cru, 'status', v_linha.status,
                       'ligacao_id', v_linha.ligacao_id, 'chamada_id', v_linha.chamada_id)
  );

  return v_linha;
end $$;

-- ─── §1.8(b) A resposta do cliente acorda quem estava esperando ─────────────
--
-- Nada zerava `proxima_acao_em` quando uma mensagem chegava: depois de um `aguardar` de
-- três dias, o cliente respondia e o agente só olhava de novo na data que tinha marcado.
-- Um trigger alcança toda entrada — WhatsApp, Gmail, e-mail de persona — sem depender de
-- cada caminho lembrar. A 0270b estende esta função aos mandatos.
--
-- E a saída HUMANA devolve a conversa que esperava uma pessoa (§1.4) ao estado normal:
-- "até alguém tocá-la" é isto.

create or replace function public.comunicacoes__acorda_quem_espera()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.conversa_id is null then
    return new;
  end if;

  if new.direcao = 'entrada' then
    update public.conversas set proxima_acao_em = now()
     where id = new.conversa_id
       and modo_agente <> 'desligado'
       and status <> 'encerrada'
       and (proxima_acao_em is null or proxima_acao_em > now());
  elsif new.direcao = 'saida' and not coalesce(new.por_ia, false) then
    update public.conversas set status = 'aguardando_resposta'
     where id = new.conversa_id and status = 'aguardando_humano';
  end if;
  return new;
end $$;

create trigger comunicacoes_acorda_quem_espera
  after insert on public.comunicacoes
  for each row execute function public.comunicacoes__acorda_quem_espera();
