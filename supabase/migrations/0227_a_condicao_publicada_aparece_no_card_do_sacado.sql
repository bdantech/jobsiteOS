-- ═════════════════════════════════════════════════════════════════════════════
-- 0227 — A condição publicada aparece no card do sacado
--
-- ─── O CARD DIZIA O LIMITE E CALAVA O PREÇO ─────────────────────────────────
-- A tira do card de Sacados por NF passou a mostrar o limite aprovado (0226).
-- Faltava a outra metade da conversa: a TAXA. Quem liga para o cedente não diz
-- só "aprovaram R$ 500 mil para a construtora" — diz a que custo.
--
-- A taxa NÃO vem da análise: `analises_credito` aprova um LIMITE e não tem
-- coluna de preço. O preço nasce depois, quando o Crédito PUBLICA a condição
-- comercial. É essa que o card mostra, e só quando ela existe: enquanto não for
-- publicada, o card fica calado em vez de citar a régua padrão da matriz — que
-- é uma estimativa nossa, não uma condição de ninguém.
--
-- ─── POR QUE UMA FUNÇÃO, E NÃO UM JOIN NA VIEW ──────────────────────────────
-- `condicoes_comerciais` é do módulo CRÉDITO: a policy exige `credito` ou a
-- visibilidade pela venda. A `sacados_prospeccao_view` é `security_invoker`, e
-- quem vive nela é o originador — que não tem o módulo. Medido: o Rodrigo
-- (Originador) enxerga ZERO condições comerciais.
--
-- Um join simples devolveria nulo exatamente para as pessoas para quem o card
-- foi feito, e ninguém perceberia: a tira apareceria sem taxa para sempre, e o
-- primeiro palpite seria "o Crédito não publicou".
--
-- A função é `security definer` e devolve só os campos de PREÇO da condição —
-- não a condição inteira, que tem comissão, invest back e o resto da mesa.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.app__condicao_publicada(p_cnpj text)
returns table (
  taxa_am numeric,
  tac numeric,
  tac_minima numeric,
  limite numeric,
  publicada_em timestamptz,
  expira_em date
)
language sql stable security definer set search_path = '' as $$
  select c.monthly_rate_d0, c.fee_d0, c.fee_min_d0, c.credit_limit,
         c.publicada_em, c.expires_at
    from public.condicoes_comerciais c
   where c.cnpj = p_cnpj
     and c.status = 'publicada'
     -- O gate devolve VAZIO em vez de estourar: esta função é chamada de dentro
     -- de uma view, e uma exceção aqui derrubaria o funil inteiro para quem não
     -- tivesse o módulo, em vez de esconder uma coluna.
     and (public.app_tem_modulo('antecipacao') or public.app_tem_modulo('credito'))
   order by c.publicada_em desc nulls last
   limit 1;
$$;

comment on function public.app__condicao_publicada(text) is
  'Os campos de PREÇO da condição comercial publicada para este CNPJ — taxa '
  'mensal, TAC e limite. security definer porque `condicoes_comerciais` é do '
  'módulo Crédito e quem lê o funil de sacados é o originador, que não o tem. '
  'Devolve só o preço, não a condição inteira.';

revoke execute on function public.app__condicao_publicada(text) from public, anon;
grant execute on function public.app__condicao_publicada(text) to authenticated, service_role;

-- ─── A view mostra a condição ───────────────────────────────────────────────
--
-- A definição VIVA é lida e recebe dois enxertos: as colunas novas antes do
-- `FROM`, e o `left join lateral` no fim. Recolar a definição de um arquivo
-- perderia o que as migrações seguintes acrescentaram — e neste caso perderia
-- coisa já hoje: `sacado_nome` é um `coalesce` com a razão social do universo,
-- e copiá-lo como `s.sacado_nome` apagaria o nome de todos os cards.

do $$
declare
  v_def text;
  v_ancora text := E'\n   FROM sacados_prospeccao s';
  v_novas text;
  v_final text;
begin
  select pg_get_viewdef('public.sacados_prospeccao_view'::regclass, true) into v_def;
  if position(v_ancora in v_def) = 0 then
    raise exception 'A âncora do FROM mudou em sacados_prospeccao_view — revise a 0227 à mão.';
  end if;
  if position('analises_credito a ON a.id = s.analise_credito_id' in v_def) = 0 then
    raise exception 'O join da análise mudou em sacados_prospeccao_view — revise a 0227 à mão.';
  end if;

  v_novas :=
    ',' || E'\n' ||
    '    cc.taxa_am AS condicao_taxa_am,' || E'\n' ||
    '    cc.tac AS condicao_tac,' || E'\n' ||
    '    cc.publicada_em AS condicao_publicada_em,' || E'\n' ||
    '    cc.expira_em AS condicao_expira_em';

  v_def := overlay(v_def placing v_novas || v_ancora
                   from position(v_ancora in v_def) for length(v_ancora));

  -- O lateral entra no fim, depois do último join e antes do ponto-e-vírgula.
  v_final := rtrim(rtrim(v_def), ';');
  execute 'create or replace view public.sacados_prospeccao_view as ' || v_final ||
          E'\n     LEFT JOIN LATERAL public.app__condicao_publicada(s.cnpj_sacado) cc ON true';
end $$;

/*
 * ── A REAFIRMAÇÃO NÃO É REDUNDANTE (0099, 0225) ────────────────────────────
 * `create or replace view` NÃO preserva reloptions, e sem `security_invoker` a
 * view passaria a rodar com as permissões do owner — entregando o funil de
 * sacados inteiro para qualquer usuário logado, sem carteira nem módulo. Foi
 * exatamente assim que a `notas_funil` ficou aberta duas vezes.
 */
alter view public.sacados_prospeccao_view set (security_invoker = true);

comment on view public.sacados_prospeccao_view is
  'O funil de Sacados por NF. `condicao_*` é a condição comercial PUBLICADA pelo '
  'Crédito (0227) — nula enquanto não houver uma, porque a régua padrão da '
  'matriz é estimativa nossa e não condição de ninguém.';
