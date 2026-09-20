-- ═════════════════════════════════════════════════════════════════════════════
-- 0226 — O cedente também se acha pelo nome
--
-- ─── O CAMPO PEDIA UM CNPJ DECORADO ─────────────────────────────────────────
-- "Seguir um cedente", na tela de NFs por sacado, só aceitava 14 dígitos. Quem
-- opera o funil conhece o cedente pelo NOME — "Esquadrias Vale Verde" —, e o
-- CNPJ é o que ele vai procurar em outra aba para depois colar aqui. O mesmo
-- valia para o filtro de cedente, que listava os seguidos como CNPJ formatado:
-- uma lista de números para escolher entre empresas.
--
-- ─── POR QUE UMA RPC, E NÃO UM `ilike` NA TELA ──────────────────────────────
-- O universo de busca tem de ser o MESMO que o `app_prospeccao_seguir` aceita:
-- cedente nosso, isto é, com nota na base e `fornecedor_cadastrado`. Essa
-- checagem é feita lá dentro, em `security definer`, POR CIMA da RLS — porque
-- seguir um cedente que ainda não está na sua carteira é justamente o ponto do
-- botão.
--
-- Uma busca por `notas_fiscais` no cliente enxergaria só a carteira de quem
-- procura. O originador digitaria o nome certo, não acharia nada, e o mesmo
-- CNPJ colado à mão funcionaria — que é a pior forma de um campo falhar: ele
-- não diz não, ele finge que a empresa não existe.
--
-- ─── O ACENTO NÃO PODE SER O QUE SEPARA ─────────────────────────────────────
-- `unaccent` não está instalada, e ninguém digita "CONSTRUÇÕES" com cedilha num
-- campo de busca. A normalização é o mesmo `translate` da 0061 — duplicado ali,
-- duplicado aqui, e só nestes dois lugares.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1 O nome de um cedente, por cima da RLS ───────────────────────────────
--
-- Uma função e não um join: o nome mora em `notas_fiscais`, que é recortada por
-- carteira, e o CNPJ seguido pode ser de fora dela. Quem decide QUAIS linhas
-- aparecem continua sendo a RLS de `fornecedores_seguidos`; o que esta função
-- resolve é só como se chama o CNPJ que já está na mão.

create or replace function public.app__nome_do_cedente(p_cnpj text)
returns text language sql stable security definer set search_path = '' as $$
  select nf.fornecedor_nome
    from public.notas_fiscais nf
   where nf.fornecedor_cnpj = p_cnpj
     and nf.fornecedor_nome is not null
   order by nf.emitida_em desc nulls last
   limit 1;
$$;

comment on function public.app__nome_do_cedente(text) is
  'A razão social da nota mais RECENTE deste cedente — razão social muda, e a '
  'última é a que a pessoa reconhece. security definer porque o CNPJ seguido '
  'pode estar fora da carteira de quem lê.';

revoke execute on function public.app__nome_do_cedente(text) from public, anon;
grant execute on function public.app__nome_do_cedente(text) to authenticated, service_role;

-- ─── §2 A busca ─────────────────────────────────────────────────────────────

create or replace function public.app_prospeccao_buscar_cedentes(p jsonb)
returns table (
  fornecedor_cnpj text,
  nome text,
  notas bigint,
  ultima_emissao date,
  ja_seguido boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_termo text := btrim(coalesce(p ->> 'termo', ''));
  v_digitos text := regexp_replace(coalesce(p ->> 'termo', ''), '[^0-9]', '', 'g');
  v_limite int := least(greatest(coalesce((p ->> 'limite')::int, 12), 1), 50);
  v_eu uuid := public.app_vendedor_atual();
  v_busca text;
begin
  -- Recusa em voz alta, em vez de devolver lista vazia: um campo que não acha
  -- nada e não diz por quê ensina que a busca está quebrada.
  if not public.app_tem_modulo('antecipacao') then
    raise exception 'Sem acesso ao módulo Antecipação.' using errcode = '42501';
  end if;

  v_busca := lower(translate(v_termo,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));

  return query
  with cedentes as (
    -- Um por CNPJ, com o nome da nota mais recente.
    select distinct on (nf.fornecedor_cnpj)
           nf.fornecedor_cnpj as cnpj,
           nf.fornecedor_nome as nome,
           nf.emitida_em
      from public.notas_fiscais nf
     where nf.fornecedor_cadastrado is true
       and nf.fornecedor_cnpj is not null
     order by nf.fornecedor_cnpj, nf.emitida_em desc nulls last
  ),
  contagem as (
    select nf.fornecedor_cnpj as cnpj, count(*) as notas
      from public.notas_fiscais nf
     where nf.fornecedor_cadastrado is true
     group by nf.fornecedor_cnpj
  )
  select
    c.cnpj,
    c.nome,
    coalesce(n.notas, 0)::bigint,
    c.emitida_em::date,
    exists (
      select 1 from public.fornecedores_seguidos fs
       where fs.fornecedor_cnpj = c.cnpj
         and fs.ate is null
         and fs.originador_id = v_eu
    )
  from cedentes c
  left join contagem n on n.cnpj = c.cnpj
  where
    -- Digitou número: é CNPJ, e um pedaço do começo basta (a raiz).
    (v_digitos <> '' and c.cnpj like v_digitos || '%')
    -- Digitou letra: é nome, sem acento dos dois lados.
    or (v_digitos = '' and v_termo <> '' and
        lower(translate(coalesce(c.nome, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) like '%' || v_busca || '%')
    -- Campo vazio: os cedentes com mais notas, para ele não nascer mudo.
    or v_termo = ''
  -- Quem já é seguido desce: o que se procura aqui é quem ainda NÃO está no funil.
  order by 5, 3 desc, 2
  limit v_limite;
end $$;

comment on function public.app_prospeccao_buscar_cedentes(jsonb) is
  'Acha um cedente pelo nome ou por um pedaço do CNPJ, no MESMO universo que '
  '`app_prospeccao_seguir` aceita (nota na base + fornecedor_cadastrado). '
  'security definer de propósito: seguir um cedente que ainda não está na sua '
  'carteira é o ponto do botão, e uma busca com a RLS do usuário nunca o acharia.';

revoke execute on function public.app_prospeccao_buscar_cedentes(jsonb) from public, anon;
grant execute on function public.app_prospeccao_buscar_cedentes(jsonb) to authenticated, service_role;
