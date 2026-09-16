-- ═════════════════════════════════════════════════════════════════════════════
-- 0211 — A Ana liga, e o que ela ouviu volta para o ledger
--
-- ─── O QUE É A ANA ──────────────────────────────────────────────────────────
-- Um serviço de voz da OnePay, fora deste repositório: recebe uma oferta de
-- antecipação, LIGA para o fornecedor, conversa, e devolve o que aconteceu.
-- A fila é dela — uma ligação por vez, em horário comercial, sem rediscar
-- sozinha. Daqui sai o pedido; de lá volta um webhook assinado.
--
-- ─── POR QUE UMA TABELA, SE JÁ EXISTE A OUTBOX ──────────────────────────────
-- `mensagens_outbox` é fila de MENSAGEM: tem assunto e corpo, e o que sai dela
-- é texto que alguém aprovou. Uma ligação não tem corpo para aprovar; tem uma
-- oferta que precisa estar de pé e um telefone que precisa estar liberado. E o
-- ciclo é outro: enfileirada aqui, discada lá, e o desfecho volta minutos
-- depois, quando a conversa acabou.
--
-- Então: fila própria, ledger compartilhado. O que aconteceu na ligação entra em
-- `comunicacoes` como toda comunicação entra — canal `ligacao`, que já existe
-- desde a 0144 — e quem quiser saber "o que foi falado com esse fornecedor" lê
-- um lugar só, como manda a regra do módulo.
--
-- ─── O PORTÃO É DOIS ────────────────────────────────────────────────────────
-- O de sempre (supressão, base legal, cooldown, janela) continua valendo: uma
-- ligação é comunicação de saída como outra qualquer.
--
-- O segundo é novo e mora no core (`packages/core/src/voz/pedido.ts`): a Ana FALA
-- o líquido, a taxa e o vencimento em voz alta, numa ligação gravada, e a
-- proposta escrita chega dois dias depois. Número estimado numa tela é
-- estimativa; o mesmo número dito ao telefone é promessa. Por isso dado
-- duvidoso não vira ligação com ressalva — vira ligação que não acontece, com o
-- motivo gravado em `motivo_recusa` para aparecer na tela.
--
-- ─── O QUE ESTA MIGRAÇÃO FAZ ────────────────────────────────────────────────
-- §1 `voz_ligacoes`: a fila do nosso lado, espelho do que está na Ana.
-- §2 `comunicacoes.provedor` aceita `voz`.
-- §3 `app__voz_registrar_resultado`: o desfecho vira ledger, estágio e supressão.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 A fila ──────────────────────────────────────────────────────────────

create table public.voz_ligacoes (
  -- A nota é a unidade: uma ligação por nota, e a `access_key` é o `id_externo`
  -- que a Ana usa para não ligar duas vezes para a mesma pessoa pelo mesmo
  -- motivo. PK aqui é o que torna o reenvio inofensivo.
  access_key text primary key
    references public.notas_fiscais (access_key) on delete cascade,
  fornecedor_cnpj text not null
    constraint voz_ligacoes_fornecedor_check check (fornecedor_cnpj ~ '^[0-9]{14}$'),
  contato_id uuid references public.contatos (id) on delete set null,
  -- E.164 com o `+`, exatamente como foi mandado para a Ana.
  telefone text
    constraint voz_ligacoes_telefone_check check (telefone is null or telefone ~ '^\+55[0-9]{10,11}$'),

  status text not null default 'a_enviar'
    constraint voz_ligacoes_status_check check (status in
      ('a_enviar', 'recusada', 'enviada', 'concluida', 'nao_atendida', 'falhou', 'cancelada')),
  -- Por que a ligação NÃO saiu. Vem do portão do core; a tela mostra isto no
  -- lugar de um card que some sem explicação.
  motivo_recusa text,

  /* Ids do lado da Ana: `lig_...` (a ligação na fila) e `call_...` (a conversa). */
  ligacao_id text,
  chamada_id text,
  outcome text,
  resumo text,

  /* O que mandamos e o que voltou, crus. Auditoria de uma conversa gravada. */
  pedido jsonb,
  resultado jsonb,

  tentativas int not null default 0,
  ultima_tentativa_em timestamptz,
  erro text,
  -- Fora da janela é adiamento, não descarte — a mesma regra do portão.
  agendada_para timestamptz,

  /* A linha do ledger que esta ligação virou. */
  comunicacao_id uuid references public.comunicacoes (id) on delete set null,

  criada_em timestamptz not null default now(),
  enviada_em timestamptz,
  encerrada_em timestamptz,
  atualizada_em timestamptz not null default now()
);

create index voz_ligacoes_fila_idx on public.voz_ligacoes (status, agendada_para)
  where status = 'a_enviar';
create index voz_ligacoes_fornecedor_idx on public.voz_ligacoes (fornecedor_cnpj, criada_em desc);
create index voz_ligacoes_ligacao_idx on public.voz_ligacoes (ligacao_id);

-- `voz_ligacoes` é feminina: set_atualizadA_em (0045), como `conversas`.
create trigger voz_ligacoes_set_atualizada_em
  before update on public.voz_ligacoes
  for each row execute function set_atualizada_em();

comment on table public.voz_ligacoes is
  'Fila de ligações da Ana (serviço de voz da OnePay). Uma linha por nota: a `access_key` é o `id_externo` que torna o reenvio idempotente do outro lado. O texto do que foi falado NÃO mora aqui — mora em `comunicacoes`, como toda comunicação.';
comment on column public.voz_ligacoes.motivo_recusa is
  'Por que o portão do core recusou (sem_iof, taxa_padrao, vencimento_estimado, no_procon...). Existe para a tela explicar a ausência da ligação.';
comment on column public.voz_ligacoes.resultado is
  'O webhook da Ana, cru. Guardado porque o desfecho de uma ligação gravada é evidência, e o mapeamento para estágio/supressão pode mudar.';

alter table public.voz_ligacoes enable row level security;

-- Só leitura para quem tem o módulo: a escrita é do worker (service_role) e da
-- RPC do §3. Mesma régua de `notas_fiscais`.
create policy voz_ligacoes_select on public.voz_ligacoes
  for select to authenticated using ((select public.app_tem_modulo('antecipacao')));

grant select on public.voz_ligacoes to authenticated;

-- ─── §2 O ledger aprende um provedor novo ───────────────────────────────────
--
-- `canal = 'ligacao'` já existe desde a 0144 (é o que o toque manual grava). O
-- que falta é dizer QUEM ligou: `app_link` é o clique de um humano no aparelho
-- dele; esta ligação foi a Ana, sozinha, com áudio gravado do outro lado.

alter table public.comunicacoes drop constraint if exists comunicacoes_provedor_check;
alter table public.comunicacoes add constraint comunicacoes_provedor_check
  check (provedor is null or provedor in
    ('wasender', 'gmail', 'resend', 'app_link', 'manual', 'voz'));

-- ─── §3 O desfecho volta ────────────────────────────────────────────────────
--
-- Uma função só, chamada pelo worker quando o webhook chega. Faz as quatro
-- coisas na MESMA transação, porque metade delas é pior que nenhuma: um ledger
-- sem supressão é uma promessa quebrada com quem pediu para não ser ligado.
--
--   1. fecha a linha da fila;
--   2. grava a conversa no ledger (`comunicacoes`, canal `ligacao`);
--   3. move o estágio da nota quando a ligação fechou algo;
--   4. suprime quando a pessoa pediu para não ser mais procurada.
--
-- Idempotente pela `access_key` + `ligacao_id`: o webhook da Ana pode chegar mais
-- de uma vez (ela reenvia até a nossa ponta confirmar), e reenviar não pode
-- gerar duas linhas de ledger nem duas supressões.

create or replace function public.app__voz_registrar_resultado(p jsonb)
returns public.voz_ligacoes language plpgsql security definer set search_path = '' as $$
declare
  v_access_key text := nullif(btrim(coalesce(p ->> 'id_externo', '')), '');
  v_status text := coalesce(p ->> 'status', 'concluida');
  v_outcome text := nullif(p ->> 'outcome', '');
  v_chamada jsonb := coalesce(p -> 'chamada', '{}'::jsonb);
  v_resumo text := nullif(v_chamada ->> 'resumo', '');
  v_linha public.voz_ligacoes;
  v_nota public.notas_fiscais;
  v_empresa uuid;
  v_nome text;
  v_ident text;
  v_conversa uuid;
  v_comunicacao uuid;
  v_escopo_pedido text;
  v_telefone_digitos text;
begin
  if v_access_key is null then
    raise exception 'id_externo é obrigatório.' using errcode = '23514';
  end if;

  select * into v_linha from public.voz_ligacoes where access_key = v_access_key;
  if not found then
    raise exception 'Ligação desconhecida: %.', v_access_key using errcode = 'no_data_found';
  end if;

  -- Já fechada por um webhook anterior: devolve como está. A Ana reenvia até a
  -- nossa ponta responder 2xx, e a segunda entrega não pode virar segunda ação.
  if v_linha.encerrada_em is not null then
    return v_linha;
  end if;

  select * into v_nota from public.notas_fiscais where access_key = v_access_key;

  update public.voz_ligacoes set
    status = case v_status
      when 'concluida' then 'concluida'
      when 'nao_atendida' then 'nao_atendida'
      when 'falhou' then 'falhou'
      when 'cancelada' then 'cancelada'
      else 'concluida' end,
    ligacao_id = coalesce(nullif(p ->> 'ligacao_id', ''), ligacao_id),
    chamada_id = nullif(v_chamada ->> 'call_id', ''),
    outcome = v_outcome,
    resumo = v_resumo,
    resultado = p,
    erro = nullif(p ->> 'erro', ''),
    encerrada_em = now()
  where access_key = v_access_key
  returning * into v_linha;

  -- ── 2. O ledger ──────────────────────────────────────────────────────────
  -- Só quando houve conversa: "ninguém atendeu" é estado da fila, não algo dito
  -- a alguém. Enchê-lo de não-atendimentos transformaria o histórico da pessoa
  -- num relatório de discagem.
  if v_linha.status = 'concluida' then
    select id, coalesce(razao_social, nome_fantasia) into v_empresa, v_nome
      from public.empresas where cnpj = v_linha.fornecedor_cnpj;

    -- A ligação não abre thread própria: entra na conversa de WhatsApp do mesmo
    -- número, como já faz o toque manual (0174).
    v_ident := public.app__identificador_canonico('whatsapp', v_linha.telefone);
    if v_empresa is not null and v_ident is not null then
      v_conversa := public.app__conversa_para('whatsapp', v_ident, v_empresa, v_linha.contato_id, null);
    end if;

    insert into public.comunicacoes (
      conversa_id, empresa_id, contato_id, canal, direcao,
      por_ia, corpo, preview, provedor, id_externo, status_envio,
      origem, funil, funil_card_id, enviado_em
    ) values (
      v_conversa, v_empresa, v_linha.contato_id, 'ligacao', 'saida',
      true,
      v_resumo,
      'Ana ligou: ' || coalesce(v_outcome, 'sem desfecho') || '.',
      'voz', v_linha.chamada_id, 'enviada',
      'agente', 'nfs', v_access_key, now()
    )
    returning id into v_comunicacao;

    update public.voz_ligacoes set comunicacao_id = v_comunicacao
      where access_key = v_access_key returning * into v_linha;
  end if;

  -- ── 3. O estágio ─────────────────────────────────────────────────────────
  -- Só avança, e só a partir do começo do funil: uma ligação não desfaz o que um
  -- humano já moveu adiante. `convertida` não sai daqui — quem carimba isso é o
  -- sync da plataforma, quando a antecipação existe de verdade.
  if v_outcome in ('antecipacao_solicitada', 'cadastro_iniciado', 'proposta_enviada')
     and v_nota.estagio_funil in ('a_prospectar', 'em_prospeccao') then
    update public.notas_fiscais
      set estagio_funil = 'em_negociacao', estagio_alterado_em = now()
      where access_key = v_access_key;
  end if;

  -- ── 4. A supressão ───────────────────────────────────────────────────────
  -- O único desfecho irreversível. Da recusa comercial se volta em 90 dias (é o
  -- que `expira_em` faz); deste não se volta, e a prova é uma ligação gravada.
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

    -- Quando o pedido foi sobre a empresa toda, e não só sobre aquele número.
    if v_escopo_pedido in ('empresa', 'todos', 'tudo') then
      perform public.app__suprimir_fornecedor(
        v_linha.fornecedor_cnpj,
        'Pedido na ligação da Ana (' || coalesce(v_linha.chamada_id, 'sem id') || ').',
        null, null, 'antecipacao'
      );
    end if;
  end if;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (
    null, 'voz.resultado', 'voz_ligacoes', v_access_key,
    jsonb_build_object('outcome', v_outcome, 'status', v_linha.status,
                       'ligacao_id', v_linha.ligacao_id, 'chamada_id', v_linha.chamada_id)
  );

  return v_linha;
end $$;

comment on function public.app__voz_registrar_resultado(jsonb) is
  'Fecha a ligação na fila e transforma o desfecho em ledger, estágio e supressão — tudo na mesma transação. Idempotente: a Ana reenvia o webhook até receber 2xx.';

revoke execute on function public.app__voz_registrar_resultado(jsonb) from public, anon, authenticated;
grant execute on function public.app__voz_registrar_resultado(jsonb) to service_role;
