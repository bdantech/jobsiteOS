-- ═════════════════════════════════════════════════════════════════════════════
-- 0208 — Uma decisão de crédito por empresa: a nova substitui a anterior
--
-- ─── O QUE O BACKFILL DE HOJE MOSTROU ───────────────────────────────────────
-- O backfill da apólice não duplica pelo `case_id`: ele procura antes de inserir.
-- Mas a Atradius REANALISA o mesmo comprador, e a reanálise é um caso novo — outro
-- `case_id`, o mesmo `atradius_buyer_id`. Para o backfill isso é uma linha que ainda
-- não existia aqui, e ele faz o certo ao trazê-la. O que estava errado era o que
-- acontecia depois: a decisão ANTIGA continuava viva ao lado da nova.
--
-- A `credito_carteira` soma as coberturas de um mesmo CNPJ ("a apólice pode ter mais
-- de uma cobertura para o mesmo buyer"). Com reanálise, somar é contar duas vezes:
--
--   CNPJ              buyer      cobertura real        a carteira dizia
--   35814530000158    90852114   1.000.000 (26/08)     2.000.000
--   14587169000102    89239290   1.000.000 (10/09)     1.632.000
--   24657951000104    76525820     750.000 (26/08)     1.500.000
--
-- R$ 2.382.000 de seguro que a apólice não tem. E no sentido contrário, a
-- `analise_vigente` pega a linha mais recente de cada CNPJ SEM olhar se ela foi
-- decidida: a 09473239000153 tem 1 milhão aprovado em março e uma reanálise em
-- andamento — e o scorecard passou a lê-la como "sem análise vigente", porque a
-- linha mais nova é a que ainda não tem desfecho.
--
-- ─── A REGRA ────────────────────────────────────────────────────────────────
-- Enquanto não há decisão, uma empresa pode ter quantas análises forem precisas —
-- é assim que uma renovação convive com a cobertura que ela vai renovar. No momento
-- em que a segunda é DECIDIDA (aprovada, aprovada parcial ou negada), ela passa a
-- ser a decisão da empresa e a anterior vira histórico.
--
-- ─── POR QUE UMA COLUNA, E NÃO UM ESTÁGIO `substituida` ─────────────────────
-- Essa lição já foi paga uma vez. Havia um estágio `expirada`, e a 0187 o removeu
-- justamente porque ele APAGAVA O DESFECHO: depois de expirar, ninguém mais sabia se
-- aquilo tinha sido aprovado ou aprovado parcial. Substituição tem a mesma forma —
-- é um fato SOBRE a decisão, não um lugar dela. `estagio` continua dizendo o que a
-- seguradora respondeu; `substituida_em` diz que outra resposta veio depois.
--
-- De brinde, nenhuma das dezenas de `estagio in ('aprovada', ...)` espalhadas pelo
-- sistema muda de significado sozinha — as que precisam do recorte novo estão todas
-- no §4, escolhidas uma a uma.
--
-- ─── QUEM VENCE É A ÚLTIMA A SER DECIDIDA ───────────────────────────────────
-- `decidida_em`, e não a ordem em que a linha chegou aqui. É a data em que a
-- seguradora respondeu, e é ela que diz qual resposta é a resposta atual.
--
-- A diferença entre os dois critérios não é acadêmica: a IMPORTAÇÃO cria linhas com
-- `criada_em = agora` para decisões de meses atrás. Por ordem de chegada, importar a
-- apólice depois de uma reanálise recente derrubaria a reanálise — a linha mais nova
-- do banco carregaria a decisão mais velha da seguradora. Por `decidida_em` isso não
-- acontece: quem chega com uma decisão anterior à vigente já nasce histórica.
--
-- `coalesce(decidida_em, criada_em)` é cinto de segurança. Hoje as 93 análises
-- decididas têm data de decisão, sem exceção; o coalesce existe para que uma linha
-- futura sem ela caia na chegada em vez de comparar contra nulo e sumir do `order by`.
--
-- ── A EXCEÇÃO, E É SÓ UMA: O §3 ──
-- O reparo do estado de hoje roda por `criada_em`, de propósito, e não deve ser
-- reescrito. Ele existe para a ANTONINI INCORPORADORA (59053942000180):
--
--   jobsiteos          criada 17/08   decidida 05/09   limite null   motivo "Motivo de teste"
--   atradius_backfill  criada 23/08   decidida 10/08   R$ 1.500.000  case 143222363
--
-- A primeira nunca foi à seguradora — não tem `atradius_buyer_id` —, e o
-- "decidida 05/09" dela é o instante em que alguém clicou aqui, não uma resposta da
-- Atradius. Por `decidida_em` ela venceria, e o R$ 1,5 mi real sairia do ar por causa
-- de uma linha de teste. Uma decisão de crédito que nunca foi pedida não tem data de
-- decisão de verdade para entrar na disputa, e reparo de dado velho é exatamente onde
-- se olha o caso concreto em vez de aplicar a régua.
--
-- Para tudo que vier depois, a régua é `decidida_em` — e a Antonini não volta à
-- disputa: o gatilho ignora linha que já é histórico.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 As colunas ──────────────────────────────────────────────────────────

alter table public.analises_credito
  add column if not exists substituida_em timestamptz,
  add column if not exists substituida_por uuid
    references public.analises_credito(id) on delete set null;

comment on column public.analises_credito.substituida_em is
  'Quando outra decisão para o mesmo CNPJ tomou o lugar desta. Não apaga o desfecho: '
  '`estagio` continua dizendo o que a seguradora respondeu. Nulo = é ESTA que vale.';
comment on column public.analises_credito.substituida_por is
  'A análise que tomou o lugar. Existe para a tela oferecer o link em vez de deixar '
  'quem abre a linha velha adivinhar onde está a nova.';

-- A leitura quente é "a linha viva deste CNPJ, a mais recente primeiro".
create index if not exists analises_credito_viva_idx
  on public.analises_credito (cnpj, criada_em desc)
  where substituida_em is null;

-- ─── §2 O gatilho ───────────────────────────────────────────────────────────
--
-- POR QUE UM GATILHO E NÃO UMA CHAMADA NO `aplicarDecisao`: são cinco portas que
-- escrevem desfecho (o envio, o poll, o sync, o backfill e `app_concluir_analise`),
-- e a regra tem que valer para as cinco. Uma delas esquecida é uma cobertura contada
-- duas vezes que ninguém vê — foi exatamente assim que os R$ 2,38 mi entraram.
--
-- Ele resolve os dois sentidos. O normal é a linha que chega trazer a decisão mais
-- recente e aposentar as anteriores. Mas a importação traz decisões antigas com data
-- de hoje, e nesse caso quem chega já nasce histórica — senão importar a apólice
-- derrubaria a reanálise que a seguradora acabou de responder.

create or replace function public.app__analise_substitui_anterior()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_mais_nova uuid;
begin
  -- Sem decisão não há substituição: é justamente a renovação em curso convivendo
  -- com a cobertura que ela vai renovar. `cancelada` também não decide nada.
  if new.estagio not in ('aprovada', 'aprovada_parcial', 'negada') then
    return new;
  end if;
  -- Linha que já é histórico não volta a disputar por ter mudado de desfecho.
  if new.substituida_em is not null then
    return new;
  end if;

  select a.id into v_mais_nova
    from public.analises_credito a
   where a.cnpj = new.cnpj
     and a.id <> new.id
     and a.estagio in ('aprovada', 'aprovada_parcial', 'negada')
     and a.substituida_em is null
     -- A ÚLTIMA A SER DECIDIDA, não a última a chegar: a importação grava hoje
     -- decisões de meses atrás, e por ordem de chegada elas derrubariam a reanálise
     -- recente que a apólice já respondeu.
     and (coalesce(a.decidida_em, a.criada_em), a.criada_em, a.id)
       > (coalesce(new.decidida_em, new.criada_em), new.criada_em, new.id)
   order by coalesce(a.decidida_em, a.criada_em) desc, a.criada_em desc, a.id desc
   limit 1;

  if v_mais_nova is not null then
    update public.analises_credito
       set substituida_em = now(), substituida_por = v_mais_nova, atualizada_em = now()
     where id = new.id;
    return new;
  end if;

  -- Nenhum destes `update` mexe em `estagio`, e o gatilho de UPDATE só acorda quando
  -- `estagio` muda. É o que impede a recursão sem precisar de `pg_trigger_depth`.
  update public.analises_credito a
     set substituida_em = now(), substituida_por = new.id, atualizada_em = now()
   where a.cnpj = new.cnpj
     and a.id <> new.id
     and a.estagio in ('aprovada', 'aprovada_parcial', 'negada')
     and a.substituida_em is null;

  return new;
end $function$;

comment on function public.app__analise_substitui_anterior is
  'Mantém UMA decisão viva por CNPJ: a ÚLTIMA A SER DECIDIDA (`decidida_em`), e não a '
  'última linha a chegar — a importação grava hoje decisões de meses atrás. As outras '
  'ganham `substituida_em`/`substituida_por` e viram histórico.';

drop trigger if exists analise_substitui_anterior_ins on public.analises_credito;
create trigger analise_substitui_anterior_ins
  after insert on public.analises_credito
  for each row execute function public.app__analise_substitui_anterior();

drop trigger if exists analise_substitui_anterior_upd on public.analises_credito;
create trigger analise_substitui_anterior_upd
  after update of estagio on public.analises_credito
  for each row when (old.estagio is distinct from new.estagio)
  execute function public.app__analise_substitui_anterior();

-- ─── §3 O estado de hoje ────────────────────────────────────────────────────
--
-- Quatro linhas: os três pares de reanálise da importação das 15:00 e a Antonini.
-- Não dispara o gatilho de UPDATE (não encosta em `estagio`), e por isso não corre
-- o risco de se morder em cadeia.
--
-- POR `criada_em`, E NÃO PELA RÉGUA DO GATILHO: é o único ponto da migração onde os
-- dois critérios divergem, e a divergência é a Antonini — a linha de teste que
-- "decidiu" em 05/09 sem nunca ter ido à seguradora. O cabeçalho conta a história
-- inteira. Reescrever isto para `decidida_em` tiraria do ar o R$ 1,5 mi que a apólice
-- realmente aprovou.

with viva as (
  select distinct on (cnpj) cnpj, id
    from public.analises_credito
   where estagio in ('aprovada', 'aprovada_parcial', 'negada')
   order by cnpj, criada_em desc, id desc
)
update public.analises_credito a
   set substituida_em = now(),
       substituida_por = viva.id,
       atualizada_em = now()
  from viva
 where viva.cnpj = a.cnpj
   and a.id <> viva.id
   and a.estagio in ('aprovada', 'aprovada_parcial', 'negada')
   and a.substituida_em is null;

-- ─── §4 As leituras que precisam do recorte ─────────────────────────────────

-- ── 4.1 `analise_vigente` — duas correções na mesma view ──
-- O histórico sai, e a linha DECIDIDA passa na frente da que ainda está em curso.
-- A segunda é a que devolve o 1 milhão da 09473239000153 ao scorecard: uma
-- renovação aberta não faz a cobertura de março deixar de existir.

create or replace view public.analise_vigente as
select distinct on (a.cnpj)
  a.cnpj,
  a.id as analise_id,
  a.estagio as analise_estagio,
  a.limite_aprovado,
  a.expira_em,
  a.decidida_em,
  (a.estagio in ('aprovada', 'aprovada_parcial')
   and (a.expira_em is null or a.expira_em >= current_date)) as tem_analise_vigente
from public.analises_credito a
where a.substituida_em is null
order by
  a.cnpj,
  (a.estagio in ('aprovada', 'aprovada_parcial', 'negada')) desc,
  -- `criada_em` e não `decidida_em` porque este desempate só é usado ENTRE linhas
  -- não decididas — o gatilho já garante uma decidida viva por CNPJ, e ela vence no
  -- critério de cima. Linha não decidida não tem `decidida_em` para ordenar.
  a.criada_em desc;

comment on view public.analise_vigente is
  'A análise que VALE para cada CNPJ: a decidida mais recente, e só se não foi '
  'substituída. Uma renovação em andamento não desloca a decisão que ainda está de pé.';

-- ── 4.2 `credito_carteira` — a soma volta a ser cobertura, não histórico ──
-- O `sum` fica: se a apólice um dia trouxer duas coberturas SIMULTÂNEAS para o mesmo
-- buyer, é o total delas que ampara o limite. O que ele não pode somar é a mesma
-- cobertura em duas versões.

create or replace view public.credito_carteira
with (security_invoker = true) as
with seguro as (
  select
    cnpj,
    sum(limite_aprovado)                          as limite_segurado,
    max(decidida_em)                              as decidida_em,
    max(rating_seguradora)                        as rating,
    max(rating_classe_seguradora)                 as rating_classe,
    bool_or(origem <> 'atradius_backfill')        as nasceu_na_esteira,
    count(*)                                      as coberturas
  from public.analises_credito
  where estagio in ('aprovada', 'aprovada_parcial')
    and coalesce(limite_aprovado, 0) > 0
    -- Sem `expira_em` = vigente. Não é descuido: é como a Atradius opera.
    and (expira_em is null or expira_em >= current_date)
    -- E sem a versão antiga da mesma cobertura (0208).
    and substituida_em is null
  group by cnpj
),
plataforma as (
  select cnpj, company_name, credit_limit, consumed_limit, available_limit,
         expiration_date, has_insurance
  from public.analises_plataforma_atual
  where status = 'approved'
    and coalesce(credit_limit, 0) > 0
)
select
  coalesce(p.cnpj, s.cnpj)                              as cnpj,
  p.company_name,
  e.id                                                  as empresa_id,
  e.razao_social,
  coalesce(p.credit_limit, 0)::numeric(14,2)            as limite_concedido,
  p.consumed_limit,
  p.available_limit,
  p.expiration_date                                     as limite_expira_em,
  p.has_insurance                                       as plataforma_diz_ter_seguro,
  coalesce(s.limite_segurado, 0)::numeric(14,2)         as limite_segurado,
  s.decidida_em                                         as segurado_em,
  s.rating,
  s.rating_classe,
  s.coberturas,
  greatest(coalesce(p.credit_limit, 0) - coalesce(s.limite_segurado, 0), 0)::numeric(14,2)
                                                        as descoberto,
  case
    when p.cnpj is null and coalesce(s.nasceu_na_esteira, false) then 'aguardando_plataforma'
    when p.cnpj is null then 'ocioso'
    when coalesce(s.limite_segurado, 0) = 0 then 'descoberto'
    when s.limite_segurado >= p.credit_limit then 'coberto'
    else 'parcial'
  end                                                   as situacao
from plataforma p
full join seguro s on s.cnpj = p.cnpj
left join public.empresas e on e.cnpj = coalesce(p.cnpj, s.cnpj);

-- ── 4.3 `precificacao_amostra` — a mesma empresa não entra duas vezes na régua ──
-- Idêntica à 0185, com uma linha a mais no `where`. A amostra calibra a matriz de
-- preço; a versão velha de uma cobertura entraria como se fosse outro caso.

create or replace function public.precificacao_amostra(p_meses int default 3)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_meses int := greatest(1, least(coalesce(p_meses, 3), 36));
  v_janela int := 6;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Sem acesso ao módulo Crédito.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'analise_credito_id', a.id,
             'cnpj', a.cnpj,
             'razao_social', coalesce(e.razao_social, a.cnpj),
             'faturamento_estimado', e.faturamento_anual,
             'faixa_score', s.faixa,
             'cobertura_vigente', (
               a.seguradora is not null
               and coalesce(a.limite_aprovado, 0) > 0
               and (a.expira_em is null or a.expira_em >= current_date)
             ),
             'tem_protesto', pa.tem_protesto,
             'prazo_medio_nf_dias', nf.prazo_medio_dias,
             'ticket_medio_nf', nf.ticket_medio,
             'limite_aprovado', a.limite_aprovado,
             'limite_recomendado', ap.limite_recomendado
           ) order by a.atualizada_em desc)
      from public.analises_credito a
      left join public.empresas e on e.id = a.empresa_id
      left join lateral (
        select es.faixa from public.empresa_scores es
         where es.cnpj = a.cnpj order by es.calculado_em desc limit 1
      ) s on true
      left join public.protestos_atual pa on pa.cnpj = a.cnpj
      left join public.analises_proprietarias ap on ap.id = a.analise_propria_id
      left join lateral (
        select avg(n.valor) as ticket_medio, avg(n.dias_para_vencimento) as prazo_medio_dias
          from public.notas_fiscais n
         where n.sacado_cnpj = a.cnpj
           and n.emitida_em >= (now() - make_interval(months => v_janela))
      ) nf on true
     where a.estagio in ('aprovada', 'aprovada_parcial')
       and a.substituida_em is null
       and a.atualizada_em >= (now() - make_interval(months => v_meses))
     limit 500
  ), '[]'::jsonb);
end $$;

revoke execute on function public.precificacao_amostra(int) from public, anon;
grant execute on function public.precificacao_amostra(int) to authenticated, service_role;
grant select on public.analise_vigente to authenticated;

-- ── 4.4 `app_publicar_condicoes` — não se publica preço de decisão aposentada ──
-- Publicar manda `status: APPROVED` para a produção. De todas as leituras desta
-- migração, é a única com efeito FORA daqui — e por isso é a que ganha uma trava, e
-- não só um filtro. Idêntica à 0185, com o `if` abaixo a mais.

create or replace function public.app_publicar_condicoes(p jsonb)
returns public.condicoes_comerciais
language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_esteira public.analises_credito;
  v_c jsonb := p -> 'condicoes';
  v_erro text := nullif(btrim(coalesce(p ->> 'erro_validacao', '')), '');
  v_status text := case when v_erro is null then 'publicada' else 'falha_validacao' end;
  v_anterior public.condicoes_comerciais;
  v_linha public.condicoes_comerciais;
begin
  if not public.app_tem_modulo('credito') then
    raise exception 'Somente o perfil Crédito publica condições comerciais.' using errcode = '42501';
  end if;

  select * into v_esteira from public.analises_credito
   where id = (p ->> 'analise_credito_id')::uuid for update;
  if v_esteira.id is null then
    raise exception 'Análise não encontrada.' using errcode = '23503';
  end if;

  -- Condição comercial só existe para análise aprovada. Publicar de uma negada
  -- mandaria à produção um `status: APPROVED` que a esteira nunca disse.
  if v_esteira.estagio not in ('aprovada', 'aprovada_parcial') then
    raise exception 'Só análise aprovada recebe condições comerciais.' using errcode = '23514';
  end if;

  -- 0208: outra decisão tomou o lugar desta. O preço sairia de um limite que a
  -- apólice já reviu — e a produção não tem como saber disso.
  if v_esteira.substituida_em is not null then
    raise exception 'Esta análise foi substituída por outra. Publique a partir da vigente.'
      using errcode = '23514';
  end if;

  select * into v_anterior from public.condicoes_comerciais
   where analise_credito_id = v_esteira.id and status = 'publicada';

  if v_erro is null then
    -- Aposenta a vigente e o rascunho ANTES de inserir: o índice parcial único não
    -- deixaria duas publicadas coexistirem nem por um instante dentro da transação.
    update public.condicoes_comerciais
       set status = 'substituida'
     where analise_credito_id = v_esteira.id and status in ('publicada', 'rascunho');
  end if;

  insert into public.condicoes_comerciais (
    analise_credito_id, empresa_id, cnpj,
    credit_limit, max_invoice_amount, max_due_date_days, expires_at,
    monthly_rate_d0, monthly_rate_d1,
    fee_d0, fee_min_d0, fee_d1, fee_min_d1,
    commission_percent, extension_rate_percent, bill_fine_percent,
    invest_back_limit, invest_back_commission_percent,
    has_insurance, has_referral, fidc_ready,
    sugestao, ajustes, matriz_versao, status, definida_por, publicada_em, erro_validacao
  ) values (
    v_esteira.id, v_esteira.empresa_id, v_esteira.cnpj,
    (v_c ->> 'credit_limit')::numeric, (v_c ->> 'max_invoice_amount')::numeric,
    (v_c ->> 'max_due_date_days')::int, (v_c ->> 'expires_at')::date,
    (v_c ->> 'monthly_rate_d0')::numeric, (v_c ->> 'monthly_rate_d1')::numeric,
    (v_c ->> 'fee_d0')::numeric, (v_c ->> 'fee_min_d0')::numeric,
    (v_c ->> 'fee_d1')::numeric, (v_c ->> 'fee_min_d1')::numeric,
    (v_c ->> 'commission_percent')::numeric, (v_c ->> 'extension_rate_percent')::numeric,
    (v_c ->> 'bill_fine_percent')::numeric,
    (v_c ->> 'invest_back_limit')::numeric, (v_c ->> 'invest_back_commission_percent')::numeric,
    (v_c ->> 'has_insurance')::boolean, (v_c ->> 'has_referral')::boolean, (v_c ->> 'fidc_ready')::boolean,
    p -> 'sugestao', p -> 'ajustes', (p ->> 'matriz_versao')::int,
    v_status, v_ator,
    case when v_erro is null then now() else null end,
    v_erro
  )
  returning * into v_linha;

  if v_erro is null then
    /*
     * O evento ACIONÁVEL. A semente carrega só o que este gatilho sabe; o corpo
     * completo — incluindo o `payload_producao` — é montado na hora da entrega pelo
     * builder único do core, o mesmo que o `GET` usa (04n).
     */
    perform public.app__enfileirar_webhook(
      'credito.condicoes_definidas', v_esteira.id,
      jsonb_build_object(
        'condicoes_id', v_linha.id,
        'versao_anterior', v_anterior.id,
        'matriz_versao', v_linha.matriz_versao,
        'estagio_atual', v_esteira.estagio
      )
    );
  end if;

  insert into public.empresa_eventos (empresa_id, tipo, payload, ator_usuario_id)
  select v_esteira.empresa_id,
         case when v_erro is null then 'condicoes.publicadas' else 'condicoes.falha_validacao' end,
         jsonb_build_object(
           'analise_credito_id', v_esteira.id, 'cnpj', v_esteira.cnpj,
           'condicoes_id', v_linha.id, 'matriz_versao', v_linha.matriz_versao,
           'credit_limit', v_linha.credit_limit,
           'monthly_rate_d0', v_linha.monthly_rate_d0,
           'erro_validacao', v_erro
         ), v_ator
  where v_esteira.empresa_id is not null;

  insert into public.audit_log (usuario_id, acao, entidade, entidade_id, payload)
  values (v_ator,
          case when v_erro is null then 'condicoes.publicadas' else 'condicoes.falha_validacao' end,
          'condicoes_comerciais', v_linha.id::text,
          jsonb_build_object(
            'analise_credito_id', v_esteira.id,
            'matriz_versao', v_linha.matriz_versao,
            'ajustes', v_linha.ajustes,
            'erro_validacao', v_erro
          ));

  return v_linha;
end $$;

revoke execute on function public.app_publicar_condicoes(jsonb) from public, anon;
grant execute on function public.app_publicar_condicoes(jsonb) to authenticated, service_role;
