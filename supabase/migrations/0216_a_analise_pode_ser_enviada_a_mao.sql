-- ═════════════════════════════════════════════════════════════════════════════
-- 0216 — A análise pode ser enviada à seguradora à mão
--
-- ─── O CASO QUE ISTO RESOLVE ────────────────────────────────────────────────
-- O envio pela esteira morre num ponto que ninguém aqui consegue destravar: o CNPJ
-- não está cadastrado como BUYER na Atradius. `resolverBuyer` devolve "não
-- encontrado", e não existe cadastro por API — o próprio handbook manda falar com o
-- representante comercial. A tela já diz isso e já entrega o CNPJ pronto para copiar
-- (0212).
--
-- O que faltava era o depois. Resolvido o cadastro por fora — por e-mail, pelo
-- representante, pelo portal —, o pedido EXISTE na seguradora e a análise daqui
-- continuava parada em `solicitada`, indistinguível de uma que ninguém tentou. Quem
-- olhava a esteira via uma fila que não anda; quem tinha mandado sabia que tinha
-- mandado, e não tinha onde dizer.
--
-- ─── POR QUE UMA RPC PRÓPRIA, E NÃO MAIS UM VALOR EM `app_mover_analise` ────
-- Os cinco estágios que aquela função aceita são ESCRITURAÇÃO: rascunho, solicitada,
-- docs pendentes, docs recebidos, cancelada. Todos dizem respeito ao nosso lado da
-- mesa e todos se desfazem movendo de volta.
--
-- "Enviada à seguradora" não é escrituração: é uma AFIRMAÇÃO SOBRE O MUNDO LÁ FORA —
-- existe um pedido aberto na Atradius. Ela destrava a conclusão da esteira
-- (`ESTAGIOS_CONCLUIVEIS`), muda o que o funil comercial espera e não se desfaz
-- movendo o card de volta, porque o pedido continua lá. Afirmação com consequência
-- fora do sistema merece porta própria, com guarda própria e registro de quem
-- afirmou.
--
-- ─── O QUE FICA GRAVADO, E POR QUÊ ──────────────────────────────────────────
-- `envio_manual_em` e `envio_manual_por`. Poderia-se inferir pelo `atradius_case_id`
-- nulo — "enviada sem número de caso só pode ter sido à mão" —, e é assim que o poll
-- já distingue as duas. Mas inferência por ausência é frágil: no dia em que qualquer
-- outro caminho criar uma análise enviada sem case id, a leitura vira mentira em
-- silêncio. Duas colunas dizem o que aconteceu em vez de deixar deduzir.
--
-- E `envio_manual_por` não é burocracia: esta é a única forma de uma análise chegar a
-- "enviada" sem que nenhuma chamada tenha saído daqui. Quando a decisão demorar e
-- alguém perguntar "mandaram mesmo?", a resposta tem de ter nome e hora.
--
-- ─── O QUE ESTA MIGRAÇÃO DELIBERADAMENTE NÃO FAZ ────────────────────────────
-- Não inventa um `atradius_case_id`. Sem número de caso o poll (`pollDecisoes`) já
-- pula a linha — ele filtra `atradius_case_id is not null` desde sempre —, e é o
-- comportamento certo: não há o que consultar numa cobertura que a API não conhece.
-- A consequência é que a DECISÃO também virá à mão, pela tela de confronto, que já
-- aceita `enviada_seguradora` como origem. Isso está dito na tela, na hora de
-- confirmar: quem marca precisa saber que ninguém vai avisá-lo do desfecho.
--
-- Se um dia o representante devolver o número do cover, ele pode ser preenchido — e
-- aí o poll passa a cuidar da linha sozinho, sem nada mudar aqui.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.analises_credito
  add column if not exists envio_manual_em timestamptz,
  add column if not exists envio_manual_por uuid references public.usuarios(id);

comment on column public.analises_credito.envio_manual_em is
  'Quando alguém afirmou que o pedido foi aberto na seguradora POR FORA da API (0216). '
  'Nulo na esteira normal. Com ele preenchido e `atradius_case_id` nulo, o poll não '
  'consulta nada e a decisão virá pela tela.';

comment on column public.analises_credito.envio_manual_por is
  'Quem afirmou. É a única forma de uma análise chegar a "enviada" sem nenhuma chamada '
  'ter saído daqui — a pergunta "mandaram mesmo?" precisa de resposta com nome e hora.';

create or replace function public.app_enviar_analise_manualmente(p jsonb)
returns public.analises_credito
language plpgsql security definer set search_path = '' as $function$
declare
  v_ator uuid := auth.uid();
  v_linha public.analises_credito;
  v_obs text := nullif(btrim(p ->> 'observacao'), '');
  v_case text := nullif(btrim(p ->> 'atradius_case_id'), '');
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  select * into v_linha from public.analises_credito where id = (p ->> 'id')::uuid;
  if v_linha.id is null then
    raise exception 'Análise não encontrada.' using errcode = 'no_data_found';
  end if;

  /*
   * A MESMA porta de onde o envio automático sai (`ESTAGIOS_QUE_ENVIAM`).
   *
   * Não é simetria por capricho: marcar como enviada um rascunho ou uma análise sem
   * documentos conferidos afirmaria à esteira inteira que existe pedido aberto sobre
   * uma pasta que ninguém olhou. E de `enviada_seguradora` em diante não há o que
   * marcar — já está marcado.
   */
  if v_linha.estagio not in ('solicitada', 'docs_recebidos') then
    raise exception
      'Só dá para marcar como enviada à mão a partir de "Solicitada" ou "Documentos recebidos" — esta está em "%".',
      v_linha.estagio using errcode = '22023';
  end if;

  update public.analises_credito set
    estagio = 'enviada_seguradora',
    envio_manual_em = now(),
    envio_manual_por = v_ator,
    -- O número do cover é OPCIONAL e entra se o representante já o tiver devolvido.
    -- Com ele, o poll passa a cuidar desta linha sozinho na próxima rodada.
    atradius_case_id = coalesce(v_case, atradius_case_id),
    observacoes = case
      when v_obs is null then observacoes
      when observacoes is null or btrim(observacoes) = '' then v_obs
      -- Acrescenta em vez de sobrescrever: a observação anterior costuma ser o motivo
      -- da análise, e trocá-la por "enviei à mão" apaga o porquê de ela existir.
      else observacoes || E'\n\n' || v_obs
    end,
    atualizada_em = now()
  where id = v_linha.id
  returning * into v_linha;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  values (
    v_linha.empresa_id, 'analise.enviada',
    jsonb_build_object(
      'titulo', 'Análise enviada à seguradora (à mão)',
      'resumo', 'Marcada como enviada por fora da API' ||
                case when v_case is not null then ' — pedido ' || v_case else '' end ||
                case when v_obs is not null then '. ' || v_obs else '.' end,
      'url', '/credito/analises/' || v_linha.id,
      'analise_id', v_linha.id,
      'manual', true,
      'atradius_case_id', v_linha.atradius_case_id
    ),
    v_ator
  );

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator, 'analise.enviada_manualmente', 'analises_credito', v_linha.id::text, p);

  return v_linha;
end; $function$;

comment on function public.app_enviar_analise_manualmente is
  'Afirma que o pedido foi aberto na seguradora POR FORA da API (0216) — o caso do buyer '
  'sem cadastro, que não tem solução por API. Só de "solicitada" ou "docs_recebidos". Sem '
  '`atradius_case_id`, o poll não consulta e a decisão vem pela tela de confronto.';

revoke execute on function public.app_enviar_analise_manualmente(jsonb) from public, anon;
grant execute on function public.app_enviar_analise_manualmente(jsonb) to authenticated, service_role;
