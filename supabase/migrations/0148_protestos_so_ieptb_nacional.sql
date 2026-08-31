-- ═════════════════════════════════════════════════════════════════════════════
-- 0148 — Protestos: só o IEPTB Nacional, e a contagem que estava sendo perdida
--
-- A DirectD consolidou as consultas de protesto numa integração direta com o
-- IEPTB e desativou o `ProtestosSP` em 01/09/2026. Não é uma troca de URL: é o
-- fim da opção barata. Onde antes se pagava R$ 0,36 por uma resposta que só via
-- os cartórios de SP, paga-se R$ 3,50 por uma que vê o país.
--
-- O código já usava o endpoint substituto (`ProtestosOnline`) para clientes desde
-- sempre — 55 consultas bem-sucedidas, a última em 27/08/2026. O que morre é o
-- ROTEAMENTO por UF, e com ele o parâmetro `incluir_fora_sp`: ele significava
-- "pague dez vezes mais para cobrir fora de SP", e agora todo item custa igual.
--
-- ─── O BUG QUE A MIGRAÇÃO DE ENDPOINT DESENTERROU ───────────────────────────
-- Ao conferir o retorno real do IEPTB antes de trocar, apareceu um zero
-- silencioso: das 24 consultas nacionais COM protesto, 20 tinham
-- `qtd_protestos = 0` e valor gravado. Três bugs de grafia no parser:
--
--   1. a raiz do IEPTB traz `numeroTotalProtestos`, chave que não estava na lista;
--   2. o estado traz `numeroTotalProtestosUF` e o código lia `totalNumProtestosUf`;
--   3. o fallback desistia de descer aos cartórios assim que achava o VALOR — e a
--      contagem estava justamente lá embaixo.
--
-- O parser foi corrigido e testado contra o payload real. Esta migração recompõe
-- o passado: `payload` é guardado inteiro desde o começo (append-only), então a
-- contagem perdida pode ser recalculada sem consultar nada de novo — e sem gastar
-- R$ 3,50 por linha para redescobrir um número que já está no banco.
-- ═════════════════════════════════════════════════════════════════════════════

-- =============================================================================
-- §1 — Backfill: a contagem sai do payload que já está guardado
-- =============================================================================

/*
 * O gêmeo em SQL do `somarCartorios` corrigido, inline.
 *
 * O `coalesce` desce um nível de cada vez e para no primeiro que responder — não
 * SOMA os três. Conferido antes de aplicar: nas 20 linhas afetadas os três níveis
 * dão o mesmo número, e nenhuma das 6 já corretas muda de valor.
 *
 * Os números são grandes (2.564 protestos numa empresa com R$ 62,9 milhões
 * protestados) porque as empresas são. Isso é o dado que estava sendo perdido.
 */
update public.protestos_consultas c
   set qtd_protestos = coalesce(
     -- 1. A raiz, na grafia do IEPTB.
     nullif((c.payload -> 'retorno' ->> 'numeroTotalProtestos')::int, 0),
     -- 2. Soma por estado (`numeroTotalProtestosUF`, com UF maiúsculo).
     nullif((
       select sum(coalesce((uf ->> 'numeroTotalProtestosUF')::int,
                           (uf ->> 'totalNumProtestosUf')::int, 0))::int
       from jsonb_array_elements(coalesce(c.payload -> 'retorno' -> 'protestos', '[]'::jsonb)) uf
     ), 0),
     -- 3. Soma por cartório, que é onde o IEPTB sempre põe.
     nullif((
       select sum(coalesce((car ->> 'numeroProtestos')::int,
                           (car ->> 'numProtestos')::int, 0))::int
       from jsonb_array_elements(coalesce(c.payload -> 'retorno' -> 'protestos', '[]'::jsonb)) uf,
            jsonb_array_elements(coalesce(uf -> 'cartorios', uf -> 'cartoriosProtesto', '[]'::jsonb)) car
     ), 0),
     0
   )
 where c.tem_protesto
   and coalesce(c.qtd_protestos, 0) = 0;

-- =============================================================================
-- §2 — O preço, agora um só
-- =============================================================================

/*
 * A chave `sp` continua no retorno, e de propósito: entre a migração e o deploy
 * da web existe uma janela em que o build ANTIGO ainda está no ar, e ele lê
 * `c.sp`. Removê-la agora faria o botão do funil anunciar "R$ 0,00" por alguns
 * minutos — numa tela cuja única função é pedir aprovação de gasto.
 *
 * Ela devolve o preço NACIONAL, que é o que a consulta passa a custar de fato.
 * Não é um valor de compatibilidade inventado: é o preço certo, sob um nome que
 * deixou de fazer sentido. O build novo ignora a chave.
 */
create or replace function public.antecipacao_custo_protesto()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_nacional numeric;
begin
  if not (public.app_tem_modulo('antecipacao') or public.app_tem_modulo('radar')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  select coalesce((valor ->> 'protesto_nacional')::numeric, 3.5) into v_nacional
  from public.radar_config where chave = 'custos';

  v_nacional := coalesce(v_nacional, 3.5);

  return jsonb_build_object('nacional', v_nacional, 'sp', v_nacional);
end; $$;

comment on function public.antecipacao_custo_protesto is
  'Preço da consulta de protesto para o botão sob demanda do funil. Um preço só desde '
  '01/09/2026 (a DirectD desativou o endpoint de SP); a chave `sp` sobrevive apenas para '
  'que um build da web em voo durante o deploy não mostre R$ 0,00, e devolve o nacional.';

-- =============================================================================
-- §3 — A config perde os botões que não ligam mais nada
-- =============================================================================

/*
 * `protesto_sp` e `prospeccao_incluir_fora_sp_default` viram config morta: nada
 * os lê depois desta versão. Removê-los é melhor que deixá-los — uma tela de
 * settings que oferece um número que ninguém usa é uma armadilha para quem
 * ajustar o número achando que mudou alguma coisa.
 */
update public.radar_config
   set valor = valor - 'protesto_sp'
 where chave = 'custos';

update public.radar_config
   set valor = valor - 'prospeccao_incluir_fora_sp_default'
 where chave = 'protestos';

/*
 * `protestos_consultas.fonte` MANTÉM `directd_sp` no CHECK. As consultas antigas
 * existem e a ficha da empresa lê o payload delas; o histórico não muda de nome
 * quando um fornecedor muda de produto. O que muda é que ninguém escreve mais
 * esse valor.
 */
comment on column public.protestos_consultas.fonte is
  'directd_sp (até 01/09/2026, quando a DirectD desativou o endpoint) | directd_nacional '
  '(IEPTB Online, o único desde então).';
