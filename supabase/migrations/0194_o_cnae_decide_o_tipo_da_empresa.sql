-- O CNAE decide o tipo da empresa; o formulário guarda o que a pessoa disse.
--
-- `app_processar_submissao` gravava `empresas.tipo` com o que o lead respondeu, caindo
-- em 'construtora' quando a resposta era "outro" (que o formulário oferece) ou vazia.
-- Duas coisas saíam torto:
--
--   Sevtech "pinturas e impermeabilização" respondeu "outro" e virou construtora. O CNAE
--   dela é 4330404 — pintura de edifícios. É fornecedora.
--
--   H.S. SERVIÇOS DE CONSTRUÇÕES respondeu "construtora" e foi acreditada. CNAE 4399103,
--   obras de alvenaria: subempreiteira. Quem preenche formulário se descreve pelo que
--   vende, não pela taxonomia da nossa régua — e não deveria mesmo precisar conhecê-la.
--
-- A REGRA passa a ser a mesma de `inferirPapel` em packages/core/src/leads/roteamento.ts:
-- CNAE de divisão 41 ou 42, ou o grupo 6810 de incorporação, é quem CONSTRÓI ou INCORPORA
-- — todo o resto presta serviço ou fornece. É o mesmo recorte que o Mercado usa para
-- separar "contrata fornecedor" de "é fornecedor".
--
-- ⚠️ DUAS FONTES PARA A MESMA REGRA. Os prefixos vivem em TypeScript (o roteamento inbound
-- os usa para levantar divergência de papel) e agora também aqui, porque esta função é
-- SQL e roda no momento do insert. Mudou lá, muda aqui. A alternativa — mover a decisão
-- para a aplicação — significaria a empresa nascer sem tipo e ser corrigida depois, e um
-- lead trabalhado no intervalo veria o tipo errado, que é o problema que se quer resolver.
--
-- O QUE A PESSOA RESPONDEU NÃO SE PERDE: continua em `formulario_submissoes.dados`, que é
-- o registro do que ela declarou. O `empresas.tipo` deixa de ser a opinião dela e passa a
-- ser o que a Receita diz — e é ele que calibra estimador, scorecard e pitch.
--
-- SEM CNAE, mantém o default 'construtora'. A empresa entra na fila de lookup cadastral no
-- mesmo insert; quando o CNAE chegar, a reclassificação é assunto de outro job. Chutar
-- 'fornecedor' aqui trocaria um viés por outro sem ganhar informação.

create or replace function public.tipo_por_cnae(p_cnae text)
returns text
language sql
immutable
set search_path to ''
as $function$
  -- Só dígitos: o CNAE chega como '4330404' e como '4330-4/04' dependendo da fonte.
  select case
    when p_cnae is null then null
    when regexp_replace(p_cnae, '\D', '', 'g') = '' then null
    when regexp_replace(p_cnae, '\D', '', 'g') like '6810%' then 'incorporadora'
    when left(regexp_replace(p_cnae, '\D', '', 'g'), 2) in ('41', '42') then 'construtora'
    else 'fornecedor'
  end;
$function$;

comment on function public.tipo_por_cnae(text) is
  'Tipo da empresa a partir do CNAE principal. Espelha inferirPapel() de packages/core/src/leads/roteamento.ts — mudou lá, muda aqui.';
