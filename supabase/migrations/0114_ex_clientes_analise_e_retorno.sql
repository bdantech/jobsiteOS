-- =============================================================================
-- 0114 — Ex-clientes na aba Análise: quantos dá para trazer de volta
--
-- A lista de ex-clientes responde "quem saiu". O que faltava é a pergunta que vem
-- depois: "quantos dá para reconquistar?" — e ela não se responde contando linhas,
-- porque motivo de saída não é tudo igual. Quem foi embora por preço volta com uma
-- proposta nova; quem deu default não volta com proposta nenhuma.
--
-- A CLASSIFICAÇÃO MORA NO BANCO, em `motivos_perda.retorno_possivel`, e não numa
-- regra em TS: a lista de motivos é editável por admin, e um mapa chaveado por texto
-- de rótulo quebraria no dia em que alguém corrigisse um acento.
--
-- TRÊS ESTADOS, NÃO DOIS. `null` é "indefinido" e é diferente de `false`: "Motivo
-- desconhecido" é o default que o detector grava, não uma resposta que alguém deu.
-- Contá-lo como recuperável inflaria a promessa; como irrecuperável, inventaria uma
-- perda. Ele fica FORA das duas contas, e a tela diz quantos são — hoje 142 de 142,
-- que é o tamanho do trabalho de classificação que ainda não foi feito.
--
-- A CLASSIFICAÇÃO DISCUTÍVEL, registrada de propósito: "Análise não renovada pela
-- plataforma" entra como RECUPERÁVEL, embora seja decisão nossa de crédito como o
-- cancelamento. A diferença é que não renovar é passivo — vence e ninguém refaz —
-- enquanto cancelar é ato. Perfil de risco muda, e uma análise caduca pode ser
-- refeita; um crédito cancelado foi uma decisão tomada contra aquele CNPJ. Como hoje
-- TODOS os ex-clientes detectados vêm de análise `blocked`, esta é também a
-- classificação que mais move o indicador — se estiver errada, erra em cima de tudo.
-- =============================================================================

alter table public.motivos_perda add column retorno_possivel boolean;

comment on column public.motivos_perda.retorno_possivel is
  'Só para o contexto `ex_cliente`: dá para reconquistar quem saiu por este motivo? '
  'NULL = indefinido ("Motivo desconhecido"), que é diferente de "não dá" — é a '
  'ausência de resposta, e some da conta em vez de contar como perda definitiva.';

insert into public.motivos_perda (contexto, motivo, ordem) values
  ('ex_cliente', 'Crédito cancelado', 25)
on conflict (contexto, motivo) do nothing;

update public.motivos_perda set retorno_possivel = false
where contexto = 'ex_cliente' and motivo in (
  'Inadimplência / default',
  'Encerrou atividades / recuperação judicial',
  'Crédito cancelado'
);

update public.motivos_perda set retorno_possivel = true
where contexto = 'ex_cliente' and motivo in (
  'Taxa alta / preço',
  'Limite insuficiente',
  'Migrou para concorrente',
  'Conseguiu crédito mais barato',
  'Fluxo de caixa melhorou',
  'Redução de atividade / obras encerradas',
  'Problemas operacionais / atendimento',
  'Certificado / cadastro vencido e não renovado',
  'Relacionamento (troca de gestão)',
  'Análise não renovada pela plataforma'
);

create or replace function public.ex_clientes_analise()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select e.id, m.motivo, m.retorno_possivel
    from public.empresas e
      left join public.motivos_perda m on m.id = e.ex_cliente_motivo
    where e.estagio = 'ex_cliente'
      -- Só os NÃO OCULTOS: o que a pessoa escondeu da lista não pode voltar pela
      -- porta dos indicadores, senão o número contradiz a tela ao lado.
      and not exists (select 1 from public.ex_clientes_ocultos o where o.cnpj = e.cnpj)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'com_retorno', (select count(*) from base where retorno_possivel is true),
    'sem_retorno', (select count(*) from base where retorno_possivel is false),
    'indefinido', (select count(*) from base where retorno_possivel is null),
    'distribuicao', coalesce((
      select jsonb_agg(t order by t.total desc, t.motivo)
      from (
        select coalesce(motivo, 'Não classificado') as motivo,
               count(*)::int as total,
               bool_or(retorno_possivel) as retorno_possivel
        from base group by 1
      ) t
    ), '[]'::jsonb)
  );
$$;

comment on function public.ex_clientes_analise() is
  'Indicadores de ex-clientes para a aba Análise: total, quantos têm chance de '
  'retorno, quantos não têm, e a distribuição por motivo. Ignora os ocultos.';

grant execute on function public.ex_clientes_analise() to authenticated;
