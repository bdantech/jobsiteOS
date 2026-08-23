-- ─── A carteira: limite concedido × cobertura da seguradora ─────────────────
--
-- A pergunta que esta view responde é uma só: de tudo que a plataforma concedeu, quanto
-- está amparado por seguro? E ela responde nos dois sentidos, porque as duas sobras
-- importam — limite operando sem cobertura é risco, cobertura sem limite é prêmio parado.

alter table public.analises_credito
  add column if not exists rating_classe_seguradora text;

comment on column public.analises_credito.rating_classe_seguradora is
  'currentBuyerRatingClass da Atradius: a régua grossa ao lado da fina (rating_seguradora).';

-- `validade_padrao_meses` sai da configuração. Cobertura viva na Atradius não tem prazo —
-- ela vale até ser cancelada — e carimbar uma validade inventada fazia a aprovação expirar
-- sozinha meses depois, tirando do ar cobertura que a seguradora nunca retirou.
update public.credito_config
   set valor = valor - 'validade_padrao_meses',
       atualizado_em = now()
 where chave = 'atradius'
   and valor ? 'validade_padrao_meses';

create or replace view public.credito_carteira
with (security_invoker = true) as
with seguro as (
  -- Uma linha por CNPJ. `sum` e não `max` porque a apólice pode ter mais de uma cobertura
  -- para o mesmo buyer, e o que ampara o limite é o total delas.
  --
  -- O recorte é por VALOR, não por estágio: DC05 ("refusal for increase") produz uma
  -- cobertura em vigor cujo pedido foi recusado. Filtrar por estágio deixaria de fora
  -- cobertura real e diria que estamos mais descobertos do que estamos.
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
  group by cnpj
),
plataforma as (
  -- Só `approved`. `blocked` tem limite registrado mas o cliente não opera, e contá-lo
  -- como exposição inflaria o descoberto com risco que não existe.
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
  -- O número que a página existe para mostrar. Nunca negativo: cobertura acima do limite
  -- é folga, não exposição, e somar folga como se fosse dívida inverteria o sinal do total.
  greatest(coalesce(p.credit_limit, 0) - coalesce(s.limite_segurado, 0), 0)::numeric(14,2)
                                                        as descoberto,
  case
    when p.cnpj is null and coalesce(s.nasceu_na_esteira, false) then 'aguardando_plataforma'
    when p.cnpj is null                                          then 'ocioso'
    when coalesce(s.limite_segurado, 0) = 0                      then 'descoberto'
    when s.limite_segurado >= p.credit_limit                     then 'coberto'
    else 'parcial'
  end                                                   as situacao
from plataforma p
full outer join seguro s on s.cnpj = p.cnpj
left join public.empresas e on e.cnpj = coalesce(p.cnpj, s.cnpj);

grant select on public.credito_carteira to authenticated;

comment on view public.credito_carteira is
  'Conciliação entre o limite concedido na plataforma e a cobertura vigente na seguradora, '
  'uma linha por CNPJ. `descoberto` é a exposição sem seguro; `situacao` separa risco '
  '(descoberto/parcial) de prêmio ocioso e de aprovação da esteira ainda sem limite.';
